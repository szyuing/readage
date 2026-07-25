import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRewriteJobs,
  buildGeneratedArticle,
  makeRewriteArticleId,
  selectEconomistSources,
} from '../scripts/economist-rewrite-utils.mjs';

const source = (id: string, date: string, title: string, content = ['A', 'useful', 'article']) => ({
  id,
  title,
  date,
  source: 'magazine',
  magazineSourceId: 'economist',
  magazineIssueId: `economist:${date}`,
  content,
});

test('selectEconomistSources filters invalid input and keeps a stable newest-first order', () => {
  const selected = selectEconomistSources([
    source('old', '2026.07.01', 'Old'),
    source('new', '2026.07.18', 'New'),
    source('duplicate', '2026.07.10', 'Duplicate'),
    { ...source('duplicate', '2026.07.11', 'Duplicate again'), content: [] },
    { ...source('other', '2026.07.20', 'Other'), magazineSourceId: 'atlantic' },
    { ...source('generated', '2026.07.25', 'Generated'), generationKind: 'economist-cefr-rewrite' },
  ], 3);

  assert.deepEqual(selected.map((article) => article.id), ['new', 'duplicate', 'old']);
});

test('buildRewriteJobs assigns each selected source to exactly one target level', () => {
  const sources = Array.from({ length: 6 }, (_, index) =>
    source(`source-${index}`, `2026.07.${String(18 - index).padStart(2, '0')}`, `Title ${index}`)
  );
  const jobs = buildRewriteJobs(sources, { a1Count: 2, a2Count: 2 });

  assert.deepEqual(jobs.map((job) => [job.source.id, job.level]), [
    ['source-0', 'A1'],
    ['source-1', 'A1'],
    ['source-2', 'A2'],
    ['source-3', 'A2'],
  ]);
  assert.equal(new Set(jobs.map((job) => job.source.id)).size, 4);
});

test('rewrite IDs are stable and generated articles look like ordinary magazine articles', () => {
  const original = source('mag:economist:2026.07.18:story-1', '2026.07.18', 'A Story');
  const id = makeRewriteArticleId(original.id, 'A1');
  assert.equal(id, makeRewriteArticleId(original.id, 'A1'));
  assert.notEqual(id, makeRewriteArticleId(original.id, 'A2'));

  const article = buildGeneratedArticle({
    source: original,
    level: 'A1',
    issueId: 'economist:ai-rewrites-v1',
    date: '2026.07.25',
    generated: {
      title: 'A Simple Story',
      description: 'A short description.',
      paragraphs: ['The first paragraph is long enough.', 'The second paragraph is also useful.'],
      keyWords: ['simple'],
    },
    model: 'deepseek-v4-flash',
  });

  assert.equal(article.source, 'magazine');
  assert.equal(article.magazineSourceId, 'economist');
  assert.equal(article.magazineIssueId, 'economist:ai-rewrites-v1');
  assert.equal(article.level, 'A1');
  assert.equal(article.levelRating?.level, 'A1');
  assert.equal(article.parentArticleId, undefined);
  assert.equal(article.generatedFromArticleId, original.id);
  assert.equal(article.generationModel, 'deepseek-v4-flash');
});
