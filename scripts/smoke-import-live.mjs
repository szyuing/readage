/**
 * Live smoke: enrich one real magazine article via local /api/tutor.
 * Usage: node scripts/smoke-import-live.mjs
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.APP_BASE || 'http://localhost:3000';
const FILE =
  process.argv[2] ||
  'data/magazines/articles/economist_2026-07-18/mag_economist_2026.07.18_the-rate-at-which-earth-is-absorbing-energy-is-alarming-clim-61.json';

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function postTutor(body) {
  const res = await fetch(`${BASE}/api/tutor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok !== true) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.result;
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  console.log('health:', health);

  const raw = JSON.parse(fs.readFileSync(path.resolve(FILE), 'utf8'));
  const content = (raw.content || [])
    .map((p) => String(p).trim())
    .filter((p) => p.length > 40 && !/Section menu|Main menu|Previous|Next \|/i.test(p));

  const words = countWords(content.join(' '));
  const chars = content.join('').length;
  console.log('\nARTICLE');
  console.log(' title:', raw.title);
  console.log(' file :', FILE);
  console.log(' paras:', content.length, 'words:', words, 'chars:', chars);

  const started = Date.now();
  const tick = (msg) => {
    const sec = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[${sec}s] ${msg}`);
  };

  tick(`start full-article translate (${content.length} paragraphs)…`);
  let translations;
  let translateMode = 'full_article';
  try {
    const result = await postTutor({
      intent: 'translate_article',
      paragraphs: content,
      paragraphTotal: content.length,
      targetLanguage: 'Chinese',
      topic: raw.title,
    });
    translations = result.translations || [];
    if (translations.length !== content.length) {
      throw new Error(`segment mismatch: got ${translations.length}, want ${content.length}`);
    }
    tick(`full-article translate OK (${translations.length} segments)`);
  } catch (err) {
    translateMode = 'paragraph_pool';
    tick(`full-article failed: ${err.message}`);
    tick('fallback: 4-way paragraph concurrent translate…');
    translations = new Array(content.length);
    let next = 0;
    let done = 0;
    const CONC = 4;
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= content.length) return;
        try {
          const r = await postTutor({
            intent: 'translate',
            message: content[i].slice(0, 6000),
            targetLanguage: 'Chinese',
            paragraphIndex: i + 1,
            paragraphTotal: content.length,
            topic: raw.title,
          });
          translations[i] = (r.translatedText || '').trim() || `（第 ${i + 1} 段为空）`;
        } catch (e) {
          translations[i] = `（第 ${i + 1} 段失败：${e.message}）`;
        }
        done += 1;
        if (done % 5 === 0 || done === content.length) {
          tick(`paragraph pool ${done}/${content.length}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONC }, () => worker()));
  }

  tick('start CEFR rating…');
  let rating;
  try {
    rating = await postTutor({
      intent: 'rate_article',
      articleContext: content.join('\n\n').slice(0, 120_000),
      topic: raw.title,
    });
    tick(`rating OK: CEFR ${rating.level} / score ${rating.difficultyScore}`);
  } catch (err) {
    rating = { level: '?', difficultyScore: -1, summary: `评级失败：${err.message}` };
    tick(`rating failed: ${err.message}`);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const failCount = translations.filter(
    (t) => !t || t.includes('失败') || t.includes('为空')
  ).length;

  console.log('\nRESULT');
  console.log(JSON.stringify({
    elapsedSec: Number(elapsed),
    translateMode,
    level: rating.level,
    difficultyScore: rating.difficultyScore,
    summary: rating.summary,
    vocabularyNotes: rating.vocabularyNotes,
    structureNotes: rating.structureNotes,
    paragraphs: translations.length,
    failCount,
    sampleEn0: content[0]?.slice(0, 160),
    sampleZh0: translations[0]?.slice(0, 200),
    sampleEn3: content[3]?.slice(0, 160),
    sampleZh3: translations[3]?.slice(0, 200),
  }, null, 2));

  const outDir = 'tmp';
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'smoke-import-live-result.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        title: raw.title,
        file: FILE,
        elapsedSec: Number(elapsed),
        translateMode,
        rating,
        paragraphTranslations: translations,
        content,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log('\nSaved full result to', outPath);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
