import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupDictionaryWord, type DictionaryEntry } from '../src/lib/dictionaryClient';

const entry: DictionaryEntry = {
  query: 'running',
  lemma: 'run',
  phonetic: '/rʌn/',
  cefrLevel: 'A1',
  partOfSpeech: 'v.',
  basicMeaningsZh: ['跑；奔跑'],
  definitionEn: 'move at a speed faster than a walk',
  definitionsEn: [
    {
      partOfSpeech: 'v.',
      definition: 'move at a speed faster than a walk',
      definitionZh: '跑；奔跑',
    },
  ],
};

test('dictionary client looks up one word and returns the first result', async () => {
  let request: RequestInit | undefined;
  let url = '';
  const result = await lookupDictionaryWord(' running ', {
    fetcher: (async (input, init) => {
      url = String(input);
      request = init;
      return new Response(JSON.stringify({ ok: true, results: [entry] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  assert.equal(url, '/api/dictionary/lookup');
  assert.equal(request?.method, 'POST');
  assert.equal(request?.headers && new Headers(request.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(String(request?.body)), { words: ['running'] });
  assert.deepEqual(result, entry);
});

test('dictionary client returns null for a dictionary miss', async () => {
  const result = await lookupDictionaryWord('asdkfjhqwerty', {
    fetcher: (async () =>
      new Response(JSON.stringify({ ok: true, results: [null] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
  });

  assert.equal(result, null);
});

test('dictionary client rejects unsuccessful responses', async () => {
  await assert.rejects(
    lookupDictionaryWord('run', {
      fetcher: (async () =>
        new Response(JSON.stringify({ ok: false, error: { message: 'unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    }),
    /unavailable/,
  );
});
