import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractUniqueLemmas,
  getNewLemmas,
  hasSufficientExposureVisibility,
} from '../src/lib/readingExposure';

test('extracts unique lemmas in first-seen order and filters punctuation', () => {
  assert.deepEqual(
    extractUniqueLemmas("Reading, reading! WELL-being... can't stop; — reading."),
    ['reading', 'well being', "can't", 'stop']
  );
});

test('returns no lemmas for empty or punctuation-only paragraphs', () => {
  assert.deepEqual(extractUniqueLemmas('   ... , — ! ? '), []);
  assert.deepEqual(extractUniqueLemmas(''), []);
});

test('returns only lemmas not already present in the exposed set', () => {
  const exposed = new Set(['reading', 'well being']);

  assert.deepEqual(
    getNewLemmas('Reading helps learners practice reading and reflect.', exposed),
    ['helps', 'learners', 'practice', 'and', 'reflect']
  );
});

test('deduplicates repeated words within a paragraph and across calls via the set', () => {
  const exposed = new Set<string>();

  const first = getNewLemmas('Practice makes progress. Practice.', exposed);
  first.forEach((lemma) => exposed.add(lemma));

  const second = getNewLemmas('Progress requires patience; practice continues.', exposed);

  assert.deepEqual(first, ['practice', 'makes', 'progress']);
  assert.deepEqual(second, ['requires', 'patience', 'continues']);
});


test('normalizes typographic apostrophes without merging slash-separated words', () => {
  assert.deepEqual(
    extractUniqueLemmas('I can\u2019t choose yes/no ? either works.'),
    ['i', "can't", 'choose', 'yes', 'no', 'either', 'works']
  );
});

test('uses viewport coverage for paragraphs taller than the viewport', () => {
  assert.equal(hasSufficientExposureVisibility(480, 2000, 800), true);
  assert.equal(hasSufficientExposureVisibility(479, 2000, 800), false);
  assert.equal(hasSufficientExposureVisibility(300, 500, 800), true);
});
