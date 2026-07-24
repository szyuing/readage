import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECOMMENDATION_INTERACTION_BUDGET_MS,
  TUTOR_MAX_RETRIES,
  TUTOR_TIMEOUT_MS,
  postTutor,
} from '../src/lib/tutorClient';

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function hangingFetch(onCall?: () => void): typeof fetch {
  return ((_, init) => {
    onCall?.();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    });
  }) as typeof fetch;
}

test('recommend_article has a short isolated policy while long-running intents keep their budgets', () => {
  assert.equal(RECOMMENDATION_INTERACTION_BUDGET_MS, 15_000);
  assert.equal(TUTOR_TIMEOUT_MS.recommend_article, RECOMMENDATION_INTERACTION_BUDGET_MS);
  assert.equal(TUTOR_MAX_RETRIES.recommend_article, 0);

  assert.equal(TUTOR_TIMEOUT_MS.translate_article, 180_000);
  assert.equal(TUTOR_TIMEOUT_MS.rewrite_article, 180_000);
  assert.equal(TUTOR_MAX_RETRIES.translate_article, 3);
  assert.equal(TUTOR_MAX_RETRIES.rewrite_article, 3);
});

test('recommend_article times out within one interaction budget without retrying', async () => {
  let calls = 0;
  const startedAt = Date.now();

  await assert.rejects(
    () => postTutor(
      { intent: 'recommend_article', topic: 'Test' },
      hangingFetch(() => { calls += 1; }),
      { timeoutMs: 30, totalBudgetMs: 45 }
    ),
    /timeout|超时/i
  );

  const elapsedMs = Date.now() - startedAt;
  assert.equal(calls, 1);
  assert.ok(elapsedMs < 250, `recommendation should fail fast, elapsed=${elapsedMs}ms`);
});

test('the total budget also caps an explicitly enabled recommendation retry', async () => {
  let calls = 0;
  const startedAt = Date.now();

  await assert.rejects(
    () => postTutor(
      { intent: 'recommend_article' },
      hangingFetch(() => { calls += 1; }),
      { timeoutMs: 30, totalBudgetMs: 45, maxRetries: 1 }
    ),
    /timeout|超时/i
  );

  const elapsedMs = Date.now() - startedAt;
  assert.equal(calls, 1, 'the retry must not start after the total interaction budget is exhausted');
  assert.ok(elapsedMs < 250, `total budget should include backoff, elapsed=${elapsedMs}ms`);
});

test('a caller can cancel an in-flight recommendation immediately', async () => {
  const controller = new AbortController();
  let calls = 0;
  const startedAt = Date.now();

  const pending = postTutor(
    { intent: 'recommend_article' },
    hangingFetch(() => { calls += 1; }),
    { signal: controller.signal }
  );
  setTimeout(() => controller.abort(), 20);

  await assert.rejects(pending, /cancel|取消|abort/i);

  const elapsedMs = Date.now() - startedAt;
  assert.equal(calls, 1);
  assert.ok(elapsedMs < 250, `cancellation should be immediate, elapsed=${elapsedMs}ms`);
});


test('non-recommendation requests retain the existing retry behavior', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        ok: false,
        error: { code: 'TEMPORARY', message: '503 temporary failure' },
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      intent: 'translate',
      result: { translatedText: '??' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const response = await postTutor<{ translatedText: string }>(
    { intent: 'translate', selectedText: 'success' },
    fetcher
  );

  assert.equal(response.result.translatedText, '??');
  assert.equal(calls, 2);
});
