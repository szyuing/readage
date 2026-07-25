/**
 * Supervise enrichment for incomplete history articles via /api/tutor.
 * Uses DeepSeek's article concurrency pool (default 50; server enforces the cap).
 *
 * Input:  local-data/articles-incomplete.json
 * Output: local-data/backfill-results.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'local-data', 'articles-incomplete.json');
const OUTPUT = path.join(ROOT, 'local-data', 'backfill-results.json');
const PROGRESS = path.join(ROOT, 'local-data', 'backfill-progress.json');
const BASE = process.env.APP_URL || 'http://127.0.0.1:3000';
/** DeepSeek article pool target is 50; server semaphore enforces the hard cap. */
const ARTICLE_CONCURRENCY = Math.max(
  1,
  Math.min(50, Number(process.env.BACKFILL_ARTICLE_CONCURRENCY || 50))
);
const PARA_CONCURRENCY = Math.max(1, Number(process.env.BACKFILL_PARA_CONCURRENCY || 2));
const MAX_RETRIES = 5;

function needs(a) {
  const n = (a.content || []).length;
  if (!n) return false;
  const t = a.paragraphTranslations;
  const tc =
    Array.isArray(t) &&
    t.length === n &&
    t.every((x) => typeof x === 'string' && x.trim().length > 0 && !x.includes('翻译失败'));
  const r = Boolean(a.levelRating?.level && a.levelRating?.summary);
  return !tc || !r;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postTutor(body, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        throw new Error(`non-json ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok || json.ok === false) {
        const msg = json?.error?.message || `HTTP ${res.status}`;
        const retryable =
          res.status === 429 ||
          res.status === 503 ||
          res.status >= 500 ||
          /rate|concur|timeout|abort|failed/i.test(msg);
        if (retryable && attempt < MAX_RETRIES) {
          const wait = Math.min(30_000, 1500 * 2 ** attempt + Math.random() * 500);
          console.log(`    retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(wait)}ms (${msg})`);
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
        const wait = Math.min(30_000, 1500 * 2 ** attempt + Math.random() * 500);
        console.log(
          `    retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(wait)}ms (${lastErr.message})`
        );
        await sleep(wait);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('postTutor failed');
}

function isGoodTranslation(t) {
  return typeof t === 'string' && t.trim().length > 0 && !t.includes('翻译失败') && !t.includes('翻译为空');
}

async function translateArticle(article) {
  const paragraphs = (article.content || []).map((p) => String(p || '').trim()).filter(Boolean);
  if (!paragraphs.length) throw new Error('no paragraphs');

  const totalChars = paragraphs.reduce((n, p) => n + p.length, 0);
  // Large articles: skip one-shot (often aborts / mismatches) and go straight to pool.
  const tryFull = paragraphs.length <= 25 && totalChars <= 25_000;

  if (tryFull) {
    try {
      const result = await postTutor(
        {
          intent: 'translate_article',
          paragraphs,
          paragraphTotal: paragraphs.length,
          targetLanguage: 'Chinese',
          topic: article.title || '',
        },
        4 * 60_000
      );
      const translations = (result.translations || []).map((t) =>
        typeof t === 'string' && t.trim() ? t.trim() : ''
      );
      if (translations.length === paragraphs.length && translations.every(isGoodTranslation)) {
        return { translations, mode: 'full_article' };
      }
      throw new Error(
        `segment mismatch/empty: got ${translations.length}, need ${paragraphs.length}`
      );
    } catch (err) {
      console.log(`  full translate failed (${err.message}); paragraph pool×${PARA_CONCURRENCY}…`);
    }
  } else {
    console.log(
      `  skip full translate (paras=${paragraphs.length}, chars=${totalChars}); paragraph pool×${PARA_CONCURRENCY}…`
    );
  }

  const translations = new Array(paragraphs.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(PARA_CONCURRENCY, paragraphs.length) }, async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= paragraphs.length) return;
      try {
        const r = await postTutor(
          {
            intent: 'translate',
            message: paragraphs[i],
            selectedText: paragraphs[i],
            targetLanguage: 'Chinese',
            paragraphIndex: i + 1,
            paragraphTotal: paragraphs.length,
            topic: article.title || '',
          },
          90_000
        );
        const text = (r.translatedText || '').trim();
        translations[i] = isGoodTranslation(text) ? text : `（第 ${i + 1} 段翻译为空）`;
      } catch (e) {
        translations[i] = `（第 ${i + 1} 段翻译失败：${e.message}）`;
      }
      done += 1;
      if (done % 5 === 0 || done === paragraphs.length) {
        const ok = translations.filter(isGoodTranslation).length;
        console.log(`  translate ${done}/${paragraphs.length} (ok ${ok})`);
      }
    }
  });
  await Promise.all(workers);

  // Second pass for any failed paragraphs (serial)
  for (let i = 0; i < translations.length; i++) {
    if (isGoodTranslation(translations[i])) continue;
    console.log(`  repair para ${i + 1}/${translations.length}`);
    try {
      const r = await postTutor(
        {
          intent: 'translate',
          message: paragraphs[i],
          selectedText: paragraphs[i],
          targetLanguage: 'Chinese',
          paragraphIndex: i + 1,
          paragraphTotal: paragraphs.length,
          topic: article.title || '',
        },
        90_000
      );
      const text = (r.translatedText || '').trim();
      if (isGoodTranslation(text)) translations[i] = text;
    } catch (e) {
      console.log(`  repair failed ${i + 1}: ${e.message}`);
    }
  }

  return { translations, mode: 'paragraph_pool' };
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
      90_000
    );
  } catch (e) {
    return {
      level: 'B1',
      difficultyScore: 50,
      summary: `AI 评级失败（${e.message}），暂用默认 B1。`,
    };
  }
}

async function enrichOne(article, prior) {
  const n = (article.content || []).length;
  const priorT = prior?.paragraphTranslations;
  const priorOk =
    Array.isArray(priorT) &&
    priorT.length === n &&
    priorT.every(isGoodTranslation);
  const existingT = priorOk
    ? priorT
    : Array.isArray(article.paragraphTranslations)
      ? article.paragraphTranslations
      : undefined;
  const existingOk =
    Array.isArray(existingT) &&
    existingT.length === n &&
    existingT.every(isGoodTranslation);

  const needT = !existingOk;
  const needR = !(
    (prior?.levelRating?.level && prior?.levelRating?.summary) ||
    (article.levelRating?.level && article.levelRating?.summary)
  );

  console.log(
    `\n▶ ${article.id}\n  ${String(article.title || '').slice(0, 60)} | paras=${n} | needT=${needT} needR=${needR}`
  );
  const started = Date.now();

  // Sequential: translate then rate — never double concurrent LLM storms.
  let translations = existingOk ? existingT : undefined;
  let mode = existingOk ? 'skipped' : 'pending';
  if (needT) {
    const tr = await translateArticle(article);
    translations = tr.translations;
    mode = tr.mode;
  }

  let rating =
    prior?.levelRating?.level && prior?.levelRating?.summary
      ? prior.levelRating
      : article.levelRating?.level && article.levelRating?.summary
        ? article.levelRating
        : undefined;
  if (needR || !rating) {
    rating = await rateArticle(article);
  }

  const ms = Date.now() - started;
  const okCount = (translations || []).filter(isGoodTranslation).length;
  console.log(
    `  ✓ done in ${(ms / 1000).toFixed(1)}s mode=${mode} level=${rating?.level || '?'} T_ok=${okCount}/${n}`
  );

  const translationsGood = okCount === n;
  return {
    id: article.id,
    paragraphTranslations: translations,
    levelRating: rating,
    level: rating?.level || article.level,
    importEnrichmentStatus: translationsGood && rating?.level ? 'ready' : 'failed',
    importEnrichmentError: translationsGood
      ? undefined
      : `仅完成 ${okCount}/${n} 段译文`,
    translateMode: mode,
    enrichedAt: new Date().toISOString(),
    durationMs: ms,
  };
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

function loadResults() {
  if (!fs.existsSync(OUTPUT)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOut(results, articles) {
  const map = new Map();
  for (const r of results) if (r?.id) map.set(r.id, r);
  const list = [...map.values()];
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(list, null, 2));
  const ready = list.filter((r) => r.importEnrichmentStatus === 'ready').length;
  const failed = list.filter((r) => r.importEnrichmentStatus === 'failed').length;
  fs.writeFileSync(
    PROGRESS,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        total: articles.length,
        ready,
        failed,
        items: list.map((r) => ({
          id: r.id,
          status: r.importEnrichmentStatus,
          level: r.level,
          tOk: (r.paragraphTranslations || []).filter(isGoodTranslation).length,
          tN: (r.paragraphTranslations || []).length,
          durationMs: r.durationMs,
          error: r.importEnrichmentError || r.error,
        })),
      },
      null,
      2
    )
  );
}

const PAUSE_FILE = path.join(ROOT, 'local-data', 'import-pause.json');

function setPause(paused, reason) {
  fs.mkdirSync(path.dirname(PAUSE_FILE), { recursive: true });
  fs.writeFileSync(
    PAUSE_FILE,
    JSON.stringify({ paused, reason, updatedAt: new Date().toISOString() }, null, 2)
  );
}

async function waitForDeepSeekCapacity(maxWaitMs = 8 * 60_000) {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < maxWaitMs) {
    attempt += 1;
    try {
      const result = await postTutor(
        {
          intent: 'translate',
          selectedText: 'Capacity probe.',
          message: 'Capacity probe.',
          targetLanguage: 'Chinese',
        },
        60_000
      );
      if (result?.translatedText) {
        console.log(`DeepSeek capacity OK after ${Math.round((Date.now() - started) / 1000)}s`);
        return;
      }
    } catch (e) {
      const wait = Math.min(45_000, 5000 + attempt * 2000);
      console.log(
        `waiting for DeepSeek capacity (${e.message})… sleep ${Math.round(wait / 1000)}s`
      );
      await sleep(wait);
    }
  }
  console.warn('DeepSeek capacity wait timed out; proceeding anyway');
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Missing', INPUT);
    process.exit(1);
  }

  try {
    const st = await fetch(`${BASE}/api/realtime/status`);
    if (!st.ok) throw new Error(`status ${st.status}`);
    console.log('Server OK', BASE);
  } catch (e) {
    console.error('Server not reachable', e.message);
    process.exit(1);
  }

  setPause(true, 'server-side backfill running — free DeepSeek concurrency');
  console.log('Import pause ON (browser translate/rate blocked)');
  await waitForDeepSeekCapacity();

  const articles = JSON.parse(fs.readFileSync(INPUT, 'utf8')).filter((a) => a?.id && a?.content?.length);
  console.log(
    `Backfill candidates=${articles.length} articleConcurrency=${ARTICLE_CONCURRENCY} paraConcurrency=${PARA_CONCURRENCY}`
  );

  let results = loadResults();
  // Force rework entries that look "ready" but have failed translations.
  results = results.map((r) => {
    const t = r.paragraphTranslations || [];
    const bad = t.some((x) => !isGoodTranslation(x));
    if (r.importEnrichmentStatus === 'ready' && bad) {
      return { ...r, importEnrichmentStatus: 'failed', importEnrichmentError: '译文质量不合格，重跑' };
    }
    return r;
  });

  const priorById = new Map(results.map((r) => [r.id, r]));
  const pending = articles.filter((a) => {
    const prior = priorById.get(a.id);
    if (!prior) return true;
    const n = (a.content || []).length;
    const t = prior.paragraphTranslations || [];
    const tOk = t.length === n && t.every(isGoodTranslation);
    const rOk = Boolean(prior.levelRating?.level && prior.levelRating?.summary);
    return !(tOk && rOk);
  });

  console.log(`Already good: ${articles.length - pending.length}; remaining: ${pending.length}`);

  await mapPool(pending, ARTICLE_CONCURRENCY, async (article) => {
    try {
      const enriched = await enrichOne(article, priorById.get(article.id));
      priorById.set(article.id, enriched);
      results = [...priorById.values()];
      writeOut(results, articles);
      return enriched;
    } catch (e) {
      console.error(`  ✗ ${article.id}:`, e.message);
      const failed = {
        id: article.id,
        importEnrichmentStatus: 'failed',
        error: e.message,
        enrichedAt: new Date().toISOString(),
      };
      priorById.set(article.id, { ...priorById.get(article.id), ...failed });
      results = [...priorById.values()];
      writeOut(results, articles);
      return null;
    }
  });

  writeOut([...priorById.values()], articles);
  const final = loadResults();
  const ready = final.filter((r) => r.importEnrichmentStatus === 'ready').length;
  const failed = final.filter((r) => r.importEnrichmentStatus !== 'ready').length;
  console.log(`\n=== BACKFILL COMPLETE === ready=${ready} failed=${failed}`);
  for (const r of final) {
    const t = r.paragraphTranslations || [];
    console.log(
      '-',
      r.id,
      r.importEnrichmentStatus,
      'level',
      r.level,
      `T ${t.filter(isGoodTranslation).length}/${t.length}`
    );
  }

  setPause(false, 'backfill finished');
  console.log('Import pause OFF — browser may resume remaining work');
}

main().catch((e) => {
  console.error(e);
  try {
    setPause(false, 'backfill crashed');
  } catch {
    // ignore
  }
  process.exit(1);
});
