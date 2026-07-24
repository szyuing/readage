import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReviewWord } from '../src/types';
import {
  applyIncorrectUse,
  applyProductionUse,
  seedFromReviewWords,
} from '../src/lib/proficiency';
import { applyStructuredProduction } from '../src/lib/structuredProduction';

const at = new Date('2026-07-23T08:00:00.000Z');

function reviewWord(word: string): ReviewWord {
  return {
    id: `word-${word}`,
    word,
    phonetic: '',
    definition: 'test',
    exampleSentence: 'test',
    mastered: false,
    nextReviewDate: 'Today',
  };
}

test('normalizes and deduplicates correct words before applying production credit', () => {
  const map = seedFromReviewWords([reviewWord('resilient')], at);
  const expected = applyProductionUse(map, 'resilient', 0.2, at);

  const actual = applyStructuredProduction(
    map,
    [' Resilient ', 'RESILIENT', 'resilient!!!', ''],
    [],
    0.2,
    at
  );

  assert.deepEqual(actual, expected);
  assert.deepEqual(map, seedFromReviewWords([reviewWord('resilient')], at), 'input map is not mutated');
});

test('normalizes and deduplicates incorrect words before applying the existing penalty', () => {
  const map = applyProductionUse(
    seedFromReviewWords([reviewWord('break a leg')], at),
    'break a leg',
    0.4,
    at
  );
  const expected = applyIncorrectUse(map, ['break a leg'], at);

  const actual = applyStructuredProduction(
    map,
    [],
    [' Break-a-leg ', 'BREAK A LEG', 'break a leg!!!'],
    0.2,
    at
  );

  assert.deepEqual(actual, expected);
});

test('incorrect results take priority over correct results in the same batch', () => {
  const map = applyProductionUse(
    seedFromReviewWords([reviewWord('resilient')], at),
    'resilient',
    0.4,
    at
  );
  const expected = applyIncorrectUse(map, ['resilient'], at);

  const actual = applyStructuredProduction(
    map,
    ['resilient', 'RESILIENT'],
    [' Resilient '],
    0.3,
    at
  );

  assert.deepEqual(actual, expected);
});

test('only explicitly assessed known lemmas are updated', () => {
  const map = seedFromReviewWords(
    [reviewWord('break a leg'), reviewWord('leg'), reviewWord('steady')],
    at
  );
  const expectedPhrase = applyProductionUse(
    { 'break a leg': map['break a leg'] },
    'break a leg',
    0.25,
    at
  )['break a leg'];

  const actual = applyStructuredProduction(
    map,
    ['break-a-leg', 'unknown'],
    ['missing'],
    0.25,
    at
  );

  assert.deepEqual(actual['break a leg'], expectedPhrase);
  assert.deepEqual(actual.leg, map.leg);
  assert.deepEqual(actual.steady, map.steady);
  assert.equal(actual.unknown, undefined);
});
