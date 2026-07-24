import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDictionaryExplanation,
  getDictionaryHealth,
  isDictionaryExplainFirstEnabled,
  isSingleWordQuery,
  lookupDictionaryWord,
  lookupDictionaryWords,
} from '../server/dictionary/service';

const originalExplainFirst = process.env.DICTIONARY_EXPLAIN_FIRST;

afterEach(() => {
  if (originalExplainFirst === undefined) delete process.env.DICTIONARY_EXPLAIN_FIRST;
  else process.env.DICTIONARY_EXPLAIN_FIRST = originalExplainFirst;
});

describe('local dictionary health', () => {
  it('reports a usable bundled pack', () => {
    const health = getDictionaryHealth();
    assert.equal(health.available, true);
    assert.equal(health.ok, true);
    assert.equal(health.missingRequired.length, 0);
    assert.ok(health.indexedEntries > 100_000, `expected a large index, got ${health.indexedEntries}`);
  });
});

describe('isSingleWordQuery', () => {
  it('accepts single English tokens including apostrophes and hyphens', () => {
    assert.equal(isSingleWordQuery('running'), true);
    assert.equal(isSingleWordQuery("don't"), true);
    assert.equal(isSingleWordQuery('well-known'), true);
    assert.equal(isSingleWordQuery(' Serendipity '), true);
  });

  it('rejects phrases, punctuation, digits, and empty input', () => {
    assert.equal(isSingleWordQuery('break a leg'), false);
    assert.equal(isSingleWordQuery('hello!'), false);
    assert.equal(isSingleWordQuery('123'), false);
    assert.equal(isSingleWordQuery(''), false);
    assert.equal(isSingleWordQuery(undefined), false);
  });
});

describe('dictionary lookups', () => {
  it('lemmatizes inflected forms and returns core fields', async () => {
    const entry = await lookupDictionaryWord('running');
    assert.ok(entry, 'expected a dictionary hit for "running"');
    assert.equal(entry.lemma, 'run');
    assert.ok(entry.phonetic.startsWith('/'));
    assert.ok(entry.basicMeaningsZh.length > 0);
    assert.ok(entry.partOfSpeech.length > 0);
    if (entry.cefrLevel !== null) {
      assert.match(entry.cefrLevel, /^[ABC][12]$/);
    }
  });

  it('returns null for unknown words without throwing', async () => {
    assert.equal(await lookupDictionaryWord('asdkfjhqwerty'), null);
  });

  it('keeps batch lookup order and nulls for misses', async () => {
    const [hit, miss] = await lookupDictionaryWords(['serendipity', 'asdkfjhqwerty']);
    assert.ok(hit, 'expected "serendipity" to be found');
    assert.equal(miss, null);
  });
});

describe('buildDictionaryExplanation', () => {
  it('maps an entry onto GrammarExplanation with dictionary extras', async () => {
    const entry = await lookupDictionaryWord('studies');
    assert.ok(entry, 'expected "studies" to resolve to its lemma');
    const explanation = buildDictionaryExplanation('studies', entry, 'She studies law at Oxford.');

    assert.equal(explanation.source, 'dictionary');
    assert.equal(explanation.wordOrPhrase, entry.lemma);
    assert.equal(explanation.phonetic, entry.phonetic);
    assert.ok(explanation.definition.trim().length > 0);
    assert.ok((explanation.chineseTranslation ?? '').trim().length > 0);
    assert.deepEqual(explanation.exampleSentences, ['She studies law at Oxford.']);
    assert.ok(Array.isArray(explanation.senses) && explanation.senses.length > 0);
    assert.ok(explanation.senses.every((sense) => sense.definition.trim().length > 0));
  });

  it('omits the example list when no context sentence is available', async () => {
    const entry = await lookupDictionaryWord('run');
    assert.ok(entry);
    const explanation = buildDictionaryExplanation('run', entry);
    assert.deepEqual(explanation.exampleSentences, []);
  });

  it('cleans ECDICT phonetic quirks and exchange noise', async () => {
    const entry = await lookupDictionaryWord('serendipity');
    assert.ok(entry);
    const explanation = buildDictionaryExplanation('serendipity', entry);
    assert.ok(explanation.phonetic);
    assert.doesNotMatch(explanation.phonetic, /^\/[,;\s]/, 'phonetic must not keep a leading comma');

    for (const exchange of explanation.exchanges ?? []) {
      assert.ok(exchange.value.trim().length >= 2, `exchange value looks like noise: ${exchange.value}`);
    }
    const keys = (explanation.exchanges ?? []).map((item) => `${item.label}:${item.value.toLowerCase()}`);
    assert.equal(new Set(keys).size, keys.length, 'exchanges must be deduplicated');
  });
});

describe('isDictionaryExplainFirstEnabled', () => {
  it('defaults to enabled and honors explicit opt-out', () => {
    delete process.env.DICTIONARY_EXPLAIN_FIRST;
    assert.equal(isDictionaryExplainFirstEnabled(), true);

    process.env.DICTIONARY_EXPLAIN_FIRST = 'false';
    assert.equal(isDictionaryExplainFirstEnabled(), false);
    process.env.DICTIONARY_EXPLAIN_FIRST = '0';
    assert.equal(isDictionaryExplainFirstEnabled(), false);

    process.env.DICTIONARY_EXPLAIN_FIRST = 'true';
    assert.equal(isDictionaryExplainFirstEnabled(), true);
  });
});
