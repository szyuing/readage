/**
 * Batch-trigger import enrichment (translate + rate) against local server.
 *
 * Default: stratified sample (short/medium/long) to surface real failures fast.
 * Full catalog offline analysis always runs first.
 *
 * Usage:
 *   node scripts/batch-import-live.mjs
 *   node scripts/batch-import-live.mjs --live-limit=20
 *   node scripts/batch-import-live.mjs --live-limit=0   # offline analysis only
 *   node scripts/batch-import-live.mjs --concurrency=50
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.APP_BASE || 'http://localhost:3000';
const ROOT = 'data/magazines/articles';

/** Match product rule: full-article unless > 120k chars. */
const MAX_FULL_CHARS = 120_000;
const MAX_PARAS_HARD = 400;
const DEFAULT_LIVE_LIMIT = 15;
const DEFAULT_CONCURRENCY = 50;

function parseArgs(argv) {
  const out = { liveLimit: DEFAULT_LIVE_LIMIT, concurrency: DEFAULT_CONCURRENCY };
  for (const a of argv) {
    if (a.startsWith('--live-limit=')) out.liveLimit = Number(a.split('=')[1]);
    if (a.startsWith('--concurrency=')) {
      out.concurrency = Math.max(1, Math.min(50, Number(a.split('=')[1])));
    }
  }
  return out;
}

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

function cleanParagraphs(content) {
  return (content || [])
    .map((p) => String(p).trim())
    .filter(
      (p) =>
        p.length > 40
        && !/Section menu|Main menu|Previous|Next \|/i.test(p)
    );
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function bucket(meta) {
  if (meta.chars > MAX_FULL_CHARS) return 'long';
  if (meta.words < 400) return 'short';
  return 'medium';
}

function loadAll() {
  const files = walk(ROOT);
  const articles = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const paras = cleanParagraphs(raw.content);
      if (paras.length === 0) continue;
      const body = paras.join('\n\n');
      const meta = {
        file,
        id: raw.id || path.basename(file, '.json'),
        title: raw.title || path.basename(file),
        paras: paras.length,
        words: countWords(body),
        chars: body.length,
        content: paras,
        levelHint: raw.level,
      };
      meta.bucket = bucket(meta);
      meta.mode =
        meta.paras > MAX_PARAS_HARD
          ? 'capped'
          : meta.chars > MAX_FULL_CHARS
            ? 'paragraph_pool'
            : 'full_article';
      articles.push(meta);
    } catch {
      // skip corrupt
    }
  }
  return articles;
}

async function postTutor(body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok !== true) {
      throw new Error(json?.error?.message || `HTTP ${res.status}`);
    }
    return json.result;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`timeout ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichOne(article) {
  const started = Date.now();
  const log = (msg) => {
    const s = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  [${s}s] ${msg}`);
  };

  // Live smoke: hard-cap paragraphs so 200p monsters do not block the whole batch for hours.
  // Full offline catalog still reports true sizes.
  const LIVE_PARA_CAP = Number(process.env.LIVE_PARA_CAP || 40);
  const content = article.content.slice(0, Math.min(MAX_PARAS_HARD, LIVE_PARA_CAP));
  if (article.content.length > content.length) {
    log(`NOTE: capped ${article.content.length} → ${content.length} paragraphs for live smoke`);
  }
  let translateMode = article.mode === 'full_article' ? 'full_article' : 'paragraph_pool';
  let translations = [];
  let translateError = null;

  // --- translate ---
  if (translateMode === 'full_article') {
    log(`full translate (${content.length} paras, ${article.chars} chars)…`);
    try {
      const r = await postTutor(
        {
          intent: 'translate_article',
          paragraphs: content,
          paragraphTotal: content.length,
          targetLanguage: 'Chinese',
          topic: article.title,
        },
        180_000
      );
      translations = r.translations || [];
      if (translations.length !== content.length) {
        throw new Error(`segment mismatch ${translations.length}/${content.length}`);
      }
      log(`full translate OK`);
    } catch (e) {
      translateError = e.message;
      translateMode = 'paragraph_pool_fallback';
      log(`full failed → pool: ${e.message}`);
    }
  }

  if (translateMode !== 'full_article' || translations.length !== content.length) {
    if (translateMode !== 'paragraph_pool_fallback') {
      log(`paragraph pool 4-way (${content.length} paras)…`);
    }
    translations = new Array(content.length);
    let next = 0;
    let done = 0;
    const CONC = 4; // product: oversized → 4-way paragraph concurrency
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= content.length) return;
        try {
          const r = await postTutor(
            {
              intent: 'translate',
              message: content[i].slice(0, 6000),
              targetLanguage: 'Chinese',
              paragraphIndex: i + 1,
              paragraphTotal: content.length,
              topic: article.title,
            },
            90_000
          );
          translations[i] = (r.translatedText || '').trim() || `（空 ${i + 1}）`;
        } catch (e) {
          translations[i] = `（失败 ${i + 1}: ${e.message}）`;
        }
        done += 1;
        if (done % 10 === 0 || done === content.length) {
          log(`pool ${done}/${content.length}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONC, content.length) }, () => worker()));
  }

  const failCount = translations.filter(
    (t) => !t || t.includes('失败') || t.includes('空')
  ).length;

  // --- rate ---
  let rating = null;
  let ratingError = null;
  log('rate…');
  try {
    rating = await postTutor(
      {
        intent: 'rate_article',
        articleContext: content.join('\n\n').slice(0, 120_000),
        topic: article.title,
      },
      180_000
    );
    log(`rate OK CEFR ${rating.level} / ${rating.difficultyScore}`);
  } catch (e) {
    ratingError = e.message;
    log(`rate failed: ${e.message}`);
  }

  const elapsedSec = Number(((Date.now() - started) / 1000).toFixed(1));
  return {
    id: article.id,
    title: article.title,
    bucket: article.bucket,
    paras: content.length,
    words: article.words,
    chars: article.chars,
    expectedMode: article.mode,
    translateMode,
    translateError,
    failCount,
    rating,
    ratingError,
    elapsedSec,
    ok: failCount === 0 && !ratingError && Boolean(rating?.level),
  };
}

async function mapPool(items, concurrency, worker) {
  const results = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => run()));
  return results;
}

function pickStratified(articles, limit) {
  if (limit <= 0) return [];
  const by = { short: [], medium: [], long: [] };
  for (const a of articles) by[a.bucket]?.push(a);
  for (const k of Object.keys(by)) {
    by[k].sort((a, b) => a.words - b.words);
  }
  const out = [];
  const quotas = {
    short: Math.ceil(limit / 3),
    medium: Math.ceil(limit / 3),
    long: Math.floor(limit / 3),
  };
  // pick evenly spaced samples from each bucket
  for (const [k, q] of Object.entries(quotas)) {
    const list = by[k];
    if (!list.length) continue;
    for (let n = 0; n < q && out.length < limit; n += 1) {
      const idx = Math.min(list.length - 1, Math.floor((n / Math.max(1, q - 1)) * (list.length - 1)));
      const pick = list[idx];
      if (!out.find((x) => x.id === pick.id)) out.push(pick);
    }
  }
  // fill if short
  for (const a of articles) {
    if (out.length >= limit) break;
    if (!out.find((x) => x.id === a.id)) out.push(a);
  }
  return out.slice(0, limit);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('=== batch import live ===');
  console.log('base:', BASE);
  console.log('liveLimit:', args.liveLimit, 'concurrency:', args.concurrency);

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error('Server not healthy. Start with: npm run dev');
    process.exit(1);
  }
  console.log('health:', health.llmProvider, health.stepChatModel);

  const all = loadAll();
  console.log('\n--- offline catalog ---');
  console.log('articles with content:', all.length);

  const summary = {
    short: all.filter((a) => a.bucket === 'short').length,
    medium: all.filter((a) => a.bucket === 'medium').length,
    long: all.filter((a) => a.bucket === 'long').length,
    full_article: all.filter((a) => a.mode === 'full_article').length,
    paragraph_pool: all.filter((a) => a.mode === 'paragraph_pool').length,
    capped: all.filter((a) => a.mode === 'capped').length,
    over100paras: all.filter((a) => a.paras > 100).length,
    over50kchars: all.filter((a) => a.chars > 50_000).length,
    maxParas: Math.max(...all.map((a) => a.paras)),
    maxWords: Math.max(...all.map((a) => a.words)),
    maxChars: Math.max(...all.map((a) => a.chars)),
  };
  console.log(JSON.stringify(summary, null, 2));

  const heaviest = [...all].sort((a, b) => b.chars - a.chars).slice(0, 8);
  console.log('\nheaviest 8:');
  for (const a of heaviest) {
    console.log(
      `  [${a.mode}] ${a.paras}p ${a.words}w ${a.chars}c · ${a.title.slice(0, 60)}`
    );
  }

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(
    'tmp/batch-import-offline.json',
    JSON.stringify({ summary, heaviest: heaviest.map(({ content, ...r }) => r), count: all.length }, null, 2)
  );

  if (args.liveLimit <= 0) {
    console.log('\n(offline only — set --live-limit=N to call LLM)');
    return;
  }

  const sample = pickStratified(all, args.liveLimit);
  console.log(`\n--- live enrich ${sample.length} articles (concurrency ${args.concurrency}) ---`);
  for (const a of sample) {
    console.log(`  · [${a.bucket}/${a.mode}] ${a.paras}p ${a.words}w · ${a.title.slice(0, 50)}`);
  }

  const results = await mapPool(sample, args.concurrency, async (article, idx) => {
    console.log(`\n## [${idx + 1}/${sample.length}] ${article.title}`);
    try {
      const r = await enrichOne(article);
      console.log(
        `  => ${r.ok ? 'OK' : 'ISSUE'} mode=${r.translateMode} fails=${r.failCount} rate=${r.rating?.level || r.ratingError} ${r.elapsedSec}s`
      );
      return r;
    } catch (e) {
      console.log(`  => CRASH ${e.message}`);
      return {
        id: article.id,
        title: article.title,
        ok: false,
        crash: e.message,
        elapsedSec: 0,
      };
    }
  });

  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok);
  const report = {
    at: new Date().toISOString(),
    liveLimit: args.liveLimit,
    concurrency: args.concurrency,
    offline: summary,
    live: {
      total: results.length,
      ok,
      bad: bad.length,
      avgSec: Number(
        (results.reduce((s, r) => s + (r.elapsedSec || 0), 0) / Math.max(1, results.length)).toFixed(1)
      ),
      maxSec: Math.max(...results.map((r) => r.elapsedSec || 0)),
      failures: bad,
      all: results,
    },
  };

  fs.writeFileSync('tmp/batch-import-live-report.json', JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    offline: summary,
    liveOk: ok,
    liveBad: bad.length,
    avgSec: report.live.avgSec,
    maxSec: report.live.maxSec,
    failureTitles: bad.map((b) => ({
      title: b.title,
      mode: b.translateMode,
      failCount: b.failCount,
      translateError: b.translateError,
      ratingError: b.ratingError || b.crash,
      elapsedSec: b.elapsedSec,
    })),
  }, null, 2));
  console.log('\nWrote tmp/batch-import-live-report.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
