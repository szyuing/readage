/**
 * Enrich ALL magazine articles on disk (translate + CEFR rate) via Step LLM.
 * Writes results back into data/magazines/articles_by_id/*.json (and issue copies).
 *
 * Resumable: skips articles that already have complete translations + official rating.
 *
 * Env:
 *   APP_URL=http://127.0.0.1:3000
 *   BACKFILL_PARA_CONCURRENCY=2   (fallback only; keep low when articles run in parallel)
 *   BACKFILL_ARTICLE_CONCURRENCY=50
 *   MAGAZINE_ENRICH_LIMIT=0       (0 = all; set N to process only first N pending)
 *   FULL_ARTICLE_TIMEOUT_MS=0  (0 = wait indefinitely)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, 'data', 'magazines', 'articles_by_id');
const ISSUES_ARTICLES_ROOT = path.join(ROOT, 'data', 'magazines', 'articles');
const PROGRESS = path.join(ROOT, 'local-data', 'magazine-enrichment-progress.json');
const LOG = path.join(ROOT, 'local-data', 'magazine-enrichment.log');
const PAUSE_FILE = path.join(ROOT, 'local-data', 'import-pause.json');
const SEED = path.join(ROOT, 'local-data', 'backfill-results.json');
const BASE = process.env.APP_URL || 'http://127.0.0.1:3000';
/** DeepSeek article pool target is 50; server semaphore enforces the hard cap. */
const ARTICLE_CONCURRENCY = Math.max(
  1,
  Math.min(50, Number(process.env.BACKFILL_ARTICLE_CONCURRENCY || 50))
);
/** Paragraph pool is fallback only — keep at 1 when article concurrency is high. */
const PARA_CONCURRENCY = Math.max(1, Number(process.env.BACKFILL_PARA_CONCURRENCY || 2));
const LIMIT = Math.max(0, Number(process.env.MAGAZINE_ENRICH_LIMIT || 0));
const MAX_RETRIES = 6;
/** Align with tutorValidation MAX_TRANSLATE_ARTICLE_* */
const MAX_FULL_PARAS = 400;
const MAX_FULL_CHARS = 120_000;
const FULL_TIMEOUT_MS = Math.max(0, Number(process.env.FULL_ARTICLE_TIMEOUT_MS ?? 0));

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

function safeFileName(id) {
  return id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
}

function isRule(p) {
  return typeof p === 'string' && /^[\s\-\u2013\u2014_=*·•]+$/.test(p.trim());
}

function isGoodTranslation(t) {
  return (
    typeof t === 'string' &&
    t.trim().length > 0 &&
    !t.includes('翻译失败') &&
    !t.includes('翻译为空')
  );
}

function hasCompleteTranslations(article) {
  const content = article.content || [];
  const n = content.length;
  if (!n) return false;
  const t = article.paragraphTranslations;
  if (!Array.isArray(t) || t.length !== n) return false;
  return content.every((p, i) => {
    if (!String(p || '').trim() || isRule(p)) return true;
    return isGoodTranslation(t[i]);
  });
}

function hasOfficialRating(article) {
  return Boolean(article.levelRating?.level && article.levelRating?.summary);
}

function needsEnrichment(article) {
  return !hasCompleteTranslations(article) || !hasOfficialRating(article);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setPause(paused, reason) {
  fs.mkdirSync(path.dirname(PAUSE_FILE), { recursive: true });
  fs.writeFileSync(
    PAUSE_FILE,
    JSON.stringify({ paused, reason, updatedAt: new Date().toISOString() }, null, 2)
  );
}

function writeProgress(state) {
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
  fs.writeFileSync(PROGRESS, JSON.stringify(state, null, 2));
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
  } catch {
    return {
      startedAt: new Date().toISOString(),
      done: [],
      failed: [],
      skipped: [],
      lastId: null,
      stats: { total: 0, ready: 0, failed: 0, pending: 0 },
    };
  }
}

async function postTutor(body, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const res = await fetch(`${BASE}/api/tutor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Import-Backfill': '1',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`non-json ${res.status}: ${text.slice(0, 160)}`);
      }
      if (!res.ok || json.ok === false) {
        const msg = json?.error?.message || `HTTP ${res.status}`;
        const retryable =
          res.status === 429 ||
          res.status === 503 ||
          res.status >= 500 ||
          /rate|concur|timeout|abort|failed|paused/i.test(msg);
        if (retryable && attempt < MAX_RETRIES) {
          const wait = Math.min(45_000, 1500 * 2 ** attempt + Math.random() * 400);
          log(`    retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(wait)}ms (${msg})`);
          await sleep(wait);
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }
      return json.result;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const retryable =
        lastErr.name === 'AbortError' ||
        /rate|concur|timeout|abort|fetch|ECONN|failed/i.test(lastErr.message);
      if (retryable && attempt < MAX_RETRIES) {
        const wait = Math.min(45_000, 1500 * 2 ** attempt + Math.random() * 400);
        log(`    retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(wait)}ms (${lastErr.message})`);
        await sleep(wait);
        continue;
      }
      throw lastErr;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr || new Error('postTutor failed');
}

/**
 * Split units into full-article chunks under tutorValidation limits
 * (≤400 paras / ≤120k chars) so almost everything can use one-shot translate.
 */
function chunkUnitsForFullArticle(units) {
  const chunks = [];
  let cur = [];
  let chars = 0;
  for (const u of units) {
    const len = u.p.length;
    const wouldExceed =
      cur.length > 0 &&
      (cur.length + 1 > MAX_FULL_PARAS || chars + len > MAX_FULL_CHARS);
    if (wouldExceed) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    // Single oversized paragraph: still alone in a chunk (server may reject; falls back later)
    cur.push(u);
    chars += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function translateFullChunk(units, title, chunkLabel) {
  const paragraphs = units.map((u) => u.p);
  log(
    `  full-article ${chunkLabel}: ${paragraphs.length} paras / ${paragraphs.reduce((n, p) => n + p.length, 0)} chars`
  );
  const result = await postTutor(
    {
      intent: 'translate_article',
      paragraphs,
      paragraphTotal: paragraphs.length,
      targetLanguage: 'Chinese',
      topic: title || '',
    },
    FULL_TIMEOUT_MS
  );
  const translations = result.translations || [];
  if (translations.length !== units.length) {
    throw new Error(`segment mismatch ${translations.length}/${units.length}`);
  }
  const mapped = translations.map((t, idx) => {
    if (isRule(units[idx].p)) return '————————';
    const text = typeof t === 'string' ? t.trim() : '';
    return isGoodTranslation(text) ? text : '';
  });
  const ok = mapped.filter((t, idx) => isRule(units[idx].p) || isGoodTranslation(t)).length;
  if (ok < units.length * 0.85) {
    throw new Error(`too many empty segments ${ok}/${units.length}`);
  }
  return mapped;
}

async function translateArticle(article) {
  const paragraphs = (article.content || []).map((p) => String(p || ''));
  const units = paragraphs.map((p, i) => ({ p: p.trim(), i })).filter((x) => x.p);
  if (!units.length) throw new Error('no paragraphs');

  const totalChars = units.reduce((n, x) => n + x.p.length, 0);
  const out = paragraphs.map((p) => {
    if (!p.trim()) return '';
    if (isRule(p)) return '————————';
    return '';
  });

  // --- Prefer whole-article (or few chunked whole-article) calls ---
  const chunks = chunkUnitsForFullArticle(units);
  let fullOk = true;
  let mode = chunks.length === 1 ? 'full_article' : `full_article_chunks×${chunks.length}`;

  log(
    `  prefer full-article path: ${units.length} paras / ${totalChars} chars → ${chunks.length} LLM call(s)`
  );

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    try {
      const mapped = await translateFullChunk(
        chunk,
        article.title,
        chunks.length === 1 ? '1/1' : `${c + 1}/${chunks.length}`
      );
      chunk.forEach((u, k) => {
        out[u.i] = mapped[k] || out[u.i];
      });
    } catch (err) {
      log(`  full chunk ${c + 1}/${chunks.length} failed (${err.message})`);
      fullOk = false;
      // Fall back to paragraph pool only for this chunk's units
      const need = chunk.filter((u) => !isRule(u.p));
      let next = 0;
      let done = 0;
      const workers = Array.from(
        { length: Math.min(PARA_CONCURRENCY, Math.max(1, need.length)) },
        async () => {
          while (true) {
            const k = next;
            next += 1;
            if (k >= need.length) return;
            const { p, i } = need[k];
            try {
              const r = await postTutor(
                {
                  intent: 'translate',
                  message: p,
                  selectedText: p,
                  targetLanguage: 'Chinese',
                  paragraphIndex: k + 1,
                  paragraphTotal: need.length,
                  topic: article.title || '',
                },
                90_000
              );
              const text = (r.translatedText || '').trim();
              out[i] = isGoodTranslation(text) ? text : `（第 ${i + 1} 段翻译为空）`;
            } catch (e) {
              out[i] = `（第 ${i + 1} 段翻译失败：${e.message}）`;
            }
            done += 1;
            if (done % 10 === 0 || done === need.length) {
              log(`  pool ${done}/${need.length}`);
            }
          }
        }
      );
      await Promise.all(workers);
      mode = mode.includes('pool') ? mode : `${mode}+pool_fallback`;
    }
  }

  // Light repair for any remaining bad real paragraphs (serial)
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p.trim() || isRule(p)) {
      out[i] = p.trim() ? '————————' : '';
      continue;
    }
    if (isGoodTranslation(out[i])) continue;
    log(`  repair para ${i + 1}/${paragraphs.length}`);
    try {
      const r = await postTutor(
        {
          intent: 'translate',
          message: p.trim(),
          selectedText: p.trim(),
          targetLanguage: 'Chinese',
          paragraphIndex: i + 1,
          paragraphTotal: paragraphs.length,
          topic: article.title || '',
        },
        90_000
      );
      const text = (r.translatedText || '').trim();
      if (isGoodTranslation(text)) out[i] = text;
    } catch (e) {
      log(`  repair fail ${i + 1}: ${e.message}`);
    }
  }

  if (fullOk && chunks.length === 1) mode = 'full_article';
  return { translations: out, mode };
}

async function rateArticle(article) {
  const body = (article.content || []).join('\n\n').slice(0, 120_000);
  try {
    return await postTutor(
      {
        intent: 'rate_article',
        articleContext: body,
        topic: article.title || '',
      },
      120_000
    );
  } catch (e) {
    return {
      level: article.level || 'B1',
      difficultyScore: 50,
      summary: `AI 评级失败（${e.message}），暂用 ${article.level || 'B1'}。`,
    };
  }
}

function saveArticle(article) {
  const byIdPath = path.join(ARTICLES_DIR, `${safeFileName(article.id)}.json`);
  fs.writeFileSync(byIdPath, JSON.stringify(article, null, 2));

  // Mirror into issue folder copy if present
  if (article.magazineSourceId && article.magazineIssueId) {
    const issueLabel = String(article.magazineIssueId).split(':').slice(1).join(':');
    const key = `${article.magazineSourceId}_${issueLabel}`;
    const issueFile = path.join(ISSUES_ARTICLES_ROOT, key, `${safeFileName(article.id)}.json`);
    if (fs.existsSync(path.dirname(issueFile))) {
      try {
        fs.writeFileSync(issueFile, JSON.stringify(article, null, 2));
      } catch {
        // ignore mirror errors
      }
    }
  }
}

async function enrichOne(article) {
  const n = (article.content || []).length;
  const needT = !hasCompleteTranslations(article);
  const needR = !hasOfficialRating(article);
  log(`▶ ${article.id}`);
  log(`  ${String(article.title || '').slice(0, 70)} | paras=${n} needT=${needT} needR=${needR}`);
  const started = Date.now();

  let translations = article.paragraphTranslations;
  let mode = 'skipped';
  if (needT) {
    const tr = await translateArticle(article);
    translations = tr.translations;
    mode = tr.mode;
  }

  let rating = article.levelRating;
  if (needR || !hasOfficialRating({ levelRating: rating })) {
    rating = await rateArticle(article);
  }

  const next = {
    ...article,
    paragraphTranslations: translations,
    levelRating: rating,
    level: rating?.level || article.level,
    importEnrichmentStatus: hasCompleteTranslations({
      content: article.content,
      paragraphTranslations: translations,
    })
      ? 'ready'
      : 'failed',
  };

  // Count usable real paragraphs
  const real = (article.content || []).filter((p) => p.trim() && !isRule(p)).length;
  const ok = (translations || []).filter(isGoodTranslation).length;
  const ms = Date.now() - started;
  log(
    `  ✓ ${next.importEnrichmentStatus} in ${(ms / 1000).toFixed(1)}s mode=${mode} level=${next.level} T≈${ok}/${real}`
  );
  saveArticle(next);
  return next;
}

function listArticles() {
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ARTICLES_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((a) => a?.id && Array.isArray(a.content) && a.content.length > 0);
}

function seedFromBackfill() {
  if (!fs.existsSync(SEED)) return 0;
  let results;
  try {
    results = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  } catch {
    return 0;
  }
  if (!Array.isArray(results)) return 0;
  let seeded = 0;
  for (const r of results) {
    if (!r?.id || !Array.isArray(r.paragraphTranslations)) continue;
    const file = path.join(ARTICLES_DIR, `${safeFileName(r.id)}.json`);
    if (!fs.existsSync(file)) continue;
    const article = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (hasCompleteTranslations(article) && hasOfficialRating(article)) continue;
    const next = {
      ...article,
      paragraphTranslations: r.paragraphTranslations,
      levelRating: r.levelRating || article.levelRating,
      level: r.level || r.levelRating?.level || article.level,
      importEnrichmentStatus: 'ready',
    };
    if (hasCompleteTranslations(next)) {
      saveArticle(next);
      seeded += 1;
    }
  }
  return seeded;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()));
  return results;
}

async function waitForDeepSeekCapacity() {
  log('probing DeepSeek capacity…');
  for (let i = 0; i < 40; i++) {
    try {
      const r = await postTutor(
        {
          intent: 'translate',
          selectedText: 'Capacity probe.',
          message: 'Capacity probe.',
          targetLanguage: 'Chinese',
        },
        60_000
      );
      if (r?.translatedText) {
        log(`capacity OK (attempt ${i + 1})`);
        return;
      }
    } catch (e) {
      log(`capacity wait: ${e.message}`);
      await sleep(Math.min(30_000, 3000 + i * 1000));
    }
  }
  log('capacity probe timed out — continuing');
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'local-data'), { recursive: true });
  if (!fs.existsSync(ARTICLES_DIR)) {
    log('missing', ARTICLES_DIR);
    process.exit(1);
  }

  try {
    const st = await fetch(`${BASE}/api/realtime/status`);
    if (!st.ok) throw new Error(`status ${st.status}`);
    log('Server OK', BASE);
  } catch (e) {
    log('Server not reachable', e.message);
    process.exit(1);
  }

  setPause(true, 'full magazine enrichment — free DeepSeek concurrency');
  log('import pause ON');

  const seeded = seedFromBackfill();
  log(`seeded ${seeded} from backfill-results`);

  await waitForDeepSeekCapacity();

  const all = listArticles();
  const pending = all.filter(needsEnrichment);
  const already = all.length - pending.length;
  const queue = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;

  log(
    `corpus=${all.length} alreadyReady=${already} pending=${pending.length} thisRun=${queue.length} articleConc=${ARTICLE_CONCURRENCY} paraConc=${PARA_CONCURRENCY}`
  );

  const progress = loadProgress();
  progress.stats = {
    total: all.length,
    ready: already,
    pending: pending.length,
    thisRun: queue.length,
    failed: progress.failed?.length || 0,
  };
  progress.startedAt = progress.startedAt || new Date().toISOString();
  writeProgress(progress);

  let doneThisRun = 0;
  let failedThisRun = 0;

  await mapPool(queue, ARTICLE_CONCURRENCY, async (article) => {
    try {
      // re-read from disk in case another worker finished it
      const freshPath = path.join(ARTICLES_DIR, `${safeFileName(article.id)}.json`);
      const fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'));
      if (!needsEnrichment(fresh)) {
        progress.skipped = progress.skipped || [];
        progress.skipped.push(fresh.id);
        progress.stats.ready += 1;
        progress.stats.pending = Math.max(0, progress.stats.pending - 1);
        writeProgress(progress);
        return fresh;
      }
      const enriched = await enrichOne(fresh);
      progress.done = progress.done || [];
      progress.done.push({
        id: enriched.id,
        at: new Date().toISOString(),
        level: enriched.level,
        status: enriched.importEnrichmentStatus,
      });
      progress.lastId = enriched.id;
      if (enriched.importEnrichmentStatus === 'ready') {
        doneThisRun += 1;
        progress.stats.ready += 1;
      } else {
        failedThisRun += 1;
        progress.failed = progress.failed || [];
        progress.failed.push({ id: enriched.id, at: new Date().toISOString() });
      }
      progress.stats.pending = Math.max(0, progress.stats.pending - 1);
      progress.updatedAt = new Date().toISOString();
      writeProgress(progress);
      return enriched;
    } catch (e) {
      failedThisRun += 1;
      log(`  ✗ ${article.id}: ${e.message}`);
      progress.failed = progress.failed || [];
      progress.failed.push({ id: article.id, error: e.message, at: new Date().toISOString() });
      progress.updatedAt = new Date().toISOString();
      writeProgress(progress);
      return null;
    }
  });

  // Final recount
  const final = listArticles();
  const ready = final.filter((a) => !needsEnrichment(a)).length;
  const still = final.length - ready;
  log(`=== RUN COMPLETE === ready=${ready}/${final.length} stillPending=${still} thisRunOk=${doneThisRun} thisRunFail=${failedThisRun}`);
  progress.stats = { total: final.length, ready, pending: still, failed: progress.failed?.length || 0 };
  progress.finishedAt = new Date().toISOString();
  writeProgress(progress);

  setPause(false, still > 0 ? 'partial enrichment complete — may resume' : 'all magazine articles enriched');
  log('import pause OFF');
}

main().catch((e) => {
  console.error(e);
  try {
    setPause(false, 'enrichment crashed');
  } catch {
    // ignore
  }
  process.exit(1);
});
