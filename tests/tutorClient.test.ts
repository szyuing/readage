import assert from 'node:assert/strict';
import test from 'node:test';

import { postTutor } from '../src/lib/tutorClient';

test('tutor client returns the unified success envelope', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: true, intent: 'translate', result: { translatedText: '你好' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const response = await postTutor<{ translatedText: string }>({ intent: 'translate', selectedText: 'hello' }, fetcher);
  assert.equal(response.result.translatedText, '你好');
});

test('tutor client rejects both HTTP and envelope errors', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: { code: 'BAD', message: 'Nope' } }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });

  await assert.rejects(
    () => postTutor({ intent: 'recommend_article' }, fetcher),
    /Nope/
  );
});

test('translation requests can use 50 client-side slots', async () => {
  let active = 0;
  let maxActive = 0;
  const fetcher: typeof fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return new Response(
      JSON.stringify({ ok: true, intent: 'translate', result: { translatedText: '译' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  await Promise.all(
    Array.from({ length: 55 }, (_, index) =>
      postTutor(
        { intent: 'translate', selectedText: `article-${index}` },
        fetcher,
        { maxRetries: 0 }
      )
    )
  );

  assert.equal(maxActive, 50);
});

test('article rating requests share the 50-slot DeepSeek pool', async () => {
  let active = 0;
  let maxActive = 0;
  const fetcher: typeof fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return new Response(
      JSON.stringify({
        ok: true,
        intent: 'rate_article',
        result: { level: 'B1', difficultyScore: 40, summary: 'ok' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  await Promise.all(
    Array.from({ length: 55 }, (_, index) =>
      postTutor(
        { intent: 'rate_article', articleContext: `article-${index}` },
        fetcher,
        { maxRetries: 0 }
      )
    )
  );

  assert.equal(maxActive, 50);
});
