import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLearningUnits,
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

  // Function words like "and" are stop-words and are not tracked by default.
  assert.deepEqual(
    getNewLemmas('Reading helps learners practice reading and reflect.', exposed),
    ['helps', 'learners', 'practice', 'reflect']
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
  // "i" / "no" are stop-words; content words remain.
  assert.deepEqual(
    extractUniqueLemmas('I can\u2019t choose yes/no ? either works.'),
    ["can't", 'choose', 'yes', 'either', 'works']
  );
});

test('skips function words unless they appear in highlight terms', () => {
  assert.deepEqual(
    extractLearningUnits('A patient reader notices words and continues with confidence.').map(
      (unit) => unit.wordId
    ),
    ['patient', 'reader', 'notices', 'words', 'continues', 'confidence']
  );

  assert.ok(
    extractLearningUnits('Practice over time.', ['over time']).some(
      (unit) => unit.wordId === 'over time'
    )
  );
});

test('uses viewport coverage for paragraphs taller than the viewport', () => {
  assert.equal(hasSufficientExposureVisibility(480, 2000, 800), true);
  assert.equal(hasSufficientExposureVisibility(479, 2000, 800), false);
  assert.equal(hasSufficientExposureVisibility(300, 500, 800), true);
});
