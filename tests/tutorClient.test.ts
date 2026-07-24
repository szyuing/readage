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
