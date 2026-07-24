import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOfflineWordCard,
  createWordCardRequest,
  fetchWordCard,
} from '../src/lib/wordCard';

test('word card requests keep the clicked word and its article context', () => {
  assert.deepEqual(
    createWordCardRequest('world.', 'Hello world.'),
    { selectedText: 'world', contextSentence: 'Hello world.' },
  );
});

test('word card requests keep multi-word phrases', () => {
  assert.deepEqual(
    createWordCardRequest('break a leg!', 'I hope you break a leg tonight.'),
    { selectedText: 'break a leg', contextSentence: 'I hope you break a leg tonight.' },
  );
});

test('word card requests reject clicks that contain no lookup text', () => {
  assert.equal(createWordCardRequest('---', 'No lookup.'), null);
  assert.equal(createWordCardRequest('   ', ''), null);
});

test('offline word card always includes the selected text and context example', () => {
  const request = createWordCardRequest('serendipity', 'It was pure serendipity.')!;
  const card = createOfflineWordCard(request);
  assert.equal(card.wordOrPhrase, 'serendipity');
  assert.equal(card.source, 'ai');
  assert.ok(card.definition.includes('serendipity'));
  assert.deepEqual(card.exampleSentences, ['It was pure serendipity.']);
});

test('fetchWordCard uses the tutor explain path and returns the server result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        intent: 'explain',
        result: {
          wordOrPhrase: 'run',
          type: 'verb',
          definition: 'to move quickly on foot',
          grammarRules: [],
          exampleSentences: ['I run every morning.'],
          source: 'dictionary',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const request = createWordCardRequest('running', 'She is running late.')!;
    const card = await fetchWordCard(request, { articleId: 'a1' });
    assert.equal(card.wordOrPhrase, 'run');
    assert.equal(card.source, 'dictionary');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWordCard falls back offline when the network fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  try {
    const request = createWordCardRequest('curious', 'A curious case.')!;
    const card = await fetchWordCard(request);
    assert.equal(card.wordOrPhrase, 'curious');
    assert.match(card.definition, /offline fallback/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
