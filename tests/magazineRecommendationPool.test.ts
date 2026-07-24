import test from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../src/types';
import {
  buildRecommendationArticlePool,
  clearMagazineRecommendationPoolCache,
  fetchMagazineRecommendationPool,
} from '../src/lib/magazineRecommendationPool';

function article(id: string, content = ['hello world']): Article {
  return {
    id,
    title: id,
    description: id,
    date: '2026-07-24',
    status: 'In Progress',
    source: id.startsWith('mag:') ? 'magazine' : 'library',
    content,
  };
}

test('buildRecommendationArticlePool prefers history status while keeping richer content', () => {
  const pool = buildRecommendationArticlePool(
    [article('mag:1', ['long magazine body with many words'])],
    [article('lib:1')],
    [
      {
        ...article('mag:1', ['short']),
        status: 'Completed',
      },
    ]
  );

  const mag = pool.find((item) => item.id === 'mag:1');
  const lib = pool.find((item) => item.id === 'lib:1');

  assert.ok(mag);
  assert.ok(lib);
  assert.equal(mag?.status, 'Completed');
  assert.deepEqual(mag?.content, ['long magazine body with many words']);
  assert.equal(pool.length, 2);
});

test('fetchMagazineRecommendationPool caches successful magazine payloads for the same day', async () => {
  clearMagazineRecommendationPoolCache();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        ok: true,
        rotationDate: '2026-07-24',
        universeSize: 100,
        articles: [article('mag:a'), article('mag:b')],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const now = new Date(2026, 6, 24, 10, 0, 0);
  const first = await fetchMagazineRecommendationPool(10, { fetchImpl, now });
  const second = await fetchMagazineRecommendationPool(10, { fetchImpl, now });

  assert.equal(first.source, 'magazine');
  assert.equal(first.rotationDate, '2026-07-24');
  assert.equal(first.articles.length, 2);
  assert.equal(second.articles.length, 2);
  assert.equal(calls, 1);

  clearMagazineRecommendationPoolCache();
});

test('fetchMagazineRecommendationPool refetches when the rotation day changes', async () => {
  clearMagazineRecommendationPoolCache();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    const rotationDate = calls === 1 ? '2026-07-24' : '2026-07-25';
    return new Response(
      JSON.stringify({
        ok: true,
        rotationDate,
        articles: [article(`mag:day-${rotationDate}`)],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const day1 = await fetchMagazineRecommendationPool(10, {
    fetchImpl,
    now: new Date(2026, 6, 24, 23, 0, 0),
  });
  const day2 = await fetchMagazineRecommendationPool(10, {
    fetchImpl,
    now: new Date(2026, 6, 25, 0, 30, 0),
  });

  assert.equal(day1.articles[0]?.id, 'mag:day-2026-07-24');
  assert.equal(day2.articles[0]?.id, 'mag:day-2026-07-25');
  assert.equal(calls, 2);

  clearMagazineRecommendationPoolCache();
});

test('fetchMagazineRecommendationPool returns error source without throwing on HTTP failure', async () => {
  clearMagazineRecommendationPoolCache();
  const fetchImpl: typeof fetch = async () =>
    new Response('boom', { status: 500 });

  const result = await fetchMagazineRecommendationPool(10, {
    fetchImpl,
    force: true,
  });

  assert.equal(result.source, 'error');
  assert.equal(result.articles.length, 0);
  assert.match(result.errorMessage || '', /500|boom/);

  clearMagazineRecommendationPoolCache();
});
