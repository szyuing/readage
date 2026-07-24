/**
 * Benchmark ranking the full magazine library with Memory V2.
 * Usage: node scripts/bench-full-recommendation.mjs
 */
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { createRequire } from 'module';

// Use tsx-compatible dynamic import path via spawning is heavy; keep pure-js extract here
// and import compiled pieces through tsx when run as: npx tsx scripts/bench-full-recommendation.mjs

const dir = path.join(process.cwd(), 'data/magazines/articles_by_id');
const outPath = path.join(process.cwd(), 'tmp/full-rank-bench2.json');

const { RecommendationEngine } = await import('../src/lib/memoryV2/recommendation.ts');
const { getNewLemmas } = await import('../src/lib/readingExposure.ts');
const { toLemma } = await import('../src/lib/proficiency.ts');
const { shouldTrackMemoryWord } = await import('../src/lib/memoryV2/stopWords.ts');

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const articles = files
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  .filter((a) => a?.id && Array.isArray(a.content) && a.content.length > 0);

function extractHeavy(content) {
  const all = new Set();
  const exposed = new Set();
  for (const p of content || []) {
    for (const lemma of getNewLemmas(p, exposed)) {
      all.add(lemma);
      exposed.add(lemma);
    }
  }
  return [...all];
}

function extractFast(content) {
  const all = new Set();
  const text = (content || []).join(' ');
  const tokens = text.match(/[a-z]+(?:'[a-z]+)?/gi) || [];
  for (const token of tokens) {
    const lemma = toLemma(token);
    if (lemma && shouldTrackMemoryWord(lemma)) all.add(lemma);
  }
  return [...all];
}

let t0 = performance.now();
const heavy = articles.map((a) => ({ article: a, lemmas: extractHeavy(a.content) }));
const heavyMs = Math.round(performance.now() - t0);

t0 = performance.now();
const fast = articles.map((a) => ({ article: a, lemmas: extractFast(a.content) }));
const fastMs = Math.round(performance.now() - t0);

const vocab = [...new Set(heavy.flatMap((c) => c.lemmas.slice(0, 80)))].slice(0, 3000);
const proficiencyMap = new Map(
  vocab.map((w, i) => [
    w,
    {
      wordId: w,
      memoryScore: 40 + (i % 50),
      level: i % 5,
      stability: 1,
      difficulty: 5,
      nextReview:
        i % 7 === 0
          ? new Date(Date.now() - 86400000).toISOString()
          : new Date(Date.now() + 86400000).toISOString(),
      lastReview: null,
    },
  ])
);

const toCandidate = (c) => ({
  article: {
    id: c.article.id,
    title: c.article.title,
    content: c.article.content,
    level: c.article.level,
    topic: c.article.topic,
  },
  lemmas: c.lemmas,
});

const engine = new RecommendationEngine({
  userLevel: 'B1',
  prioritizeDueWords: true,
  dueWordsWeight: 5,
  learningZoneWeight: 3,
});

t0 = performance.now();
const heavyCandidates = heavy.map(toCandidate);
const filteredHeavy = engine.filterCandidates(heavyCandidates, proficiencyMap);
const rankedHeavy = engine.recommend(filteredHeavy, proficiencyMap, 48);
const rankHeavyMs = Math.round(performance.now() - t0);

t0 = performance.now();
const fastCandidates = fast.map(toCandidate);
const filteredFast = engine.filterCandidates(fastCandidates, proficiencyMap);
const rankedFast = engine.recommend(filteredFast, proficiencyMap, 48);
const rankFastMs = Math.round(performance.now() - t0);

const heavyIndex = heavy.map((c) => ({
  id: c.article.id,
  title: c.article.title,
  level: c.article.level,
  topic: c.article.topic,
  lemmas: c.lemmas,
}));
const sharedVocab = [...new Set(heavy.flatMap((c) => c.lemmas))].sort();
const vocabIndex = new Map(sharedVocab.map((w, i) => [w, i]));
const compact = heavy.map((c) => ({
  id: c.article.id,
  title: c.article.title,
  level: c.article.level,
  topic: c.article.topic,
  li: c.lemmas.map((l) => vocabIndex.get(l)),
}));
const compactJson = JSON.stringify({ vocab: sharedVocab, articles: compact });

// Second-pass rank using only cached lemmas (no re-extract)
t0 = performance.now();
const cachedCandidates = heavyIndex.map((row) => ({
  article: {
    id: row.id,
    title: row.title,
    content: [],
    level: row.level,
    topic: row.topic,
  },
  lemmas: row.lemmas,
}));
const rankedCached = engine.recommend(
  engine.filterCandidates(cachedCandidates, proficiencyMap),
  proficiencyMap,
  48
);
const cachedRankMs = Math.round(performance.now() - t0);

const out = {
  articles: articles.length,
  heavyExtractMs: heavyMs,
  fastExtractMs: fastMs,
  rankHeavyWith3kProficiencyMs: rankHeavyMs,
  rankFastWith3kProficiencyMs: rankFastMs,
  cachedLemmaRankOnlyMs: cachedRankMs,
  filteredHeavy: filteredHeavy.length,
  filteredFast: filteredFast.length,
  topHeavy: rankedHeavy.slice(0, 5).map((r) => ({
    id: r.articleId,
    score: Math.round(r.score * 10) / 10,
    due: r.dueWordsCount,
    learn: r.learningZoneCount,
  })),
  topFast: rankedFast.slice(0, 5).map((r) => ({
    id: r.articleId,
    score: Math.round(r.score * 10) / 10,
    due: r.dueWordsCount,
    learn: r.learningZoneCount,
  })),
  topOverlap: rankedHeavy
    .slice(0, 20)
    .filter((r) => rankedFast.slice(0, 20).some((x) => x.articleId === r.articleId)).length,
  sizesKB: {
    heavyLemmaIndex: Math.round(JSON.stringify(heavyIndex).length / 1024),
    compactSharedVocab: Math.round(compactJson.length / 1024),
    vocabSize: sharedVocab.length,
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
