import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Rating, State } from 'ts-fsrs';

import type { WordProficiency } from '../src/types';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_IMPLEMENTATION_VERSION,
  FSRS_PARAMETERS,
  FSRS_PARAMETERS_ID,
  createFsrsMemory,
  ensureFsrsMemory,
  getFsrsRetrievability,
  isValidFsrsMemory,
  reviewFsrsMemory,
  upgradeFsrsMemory,
} from '../src/lib/fsrs';
import {
  countByBand,
  getEffectiveProficiency,
  isReviewDue,
} from '../src/lib/proficiency';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-07-23T00:00:00.000Z');

test('persists the complete FSRS-6 card state and review log', () => {
  const empty = createFsrsMemory(start);
  assert.equal(FSRS_ALGORITHM_VERSION, 'FSRS-6');
  assert.equal(empty.version, 2);
  assert.equal(empty.algorithm, FSRS_ALGORITHM_VERSION);
  assert.equal(empty.implementation, FSRS_IMPLEMENTATION_VERSION);
  assert.equal(empty.parametersId, FSRS_PARAMETERS_ID);
  assert.equal(empty.historyStartReps, 0);
  assert.equal(empty.card.state, 0);
  assert.equal(empty.card.reps, 0);
  assert.equal(empty.reviews.length, 0);

  const reviewed = reviewFsrsMemory(empty, Rating.Good, start);
  assert.equal(reviewed.card.reps, 1);
  assert.ok(reviewed.card.stability > 0);
  assert.ok(reviewed.card.difficulty > 0);
  assert.ok(Date.parse(reviewed.card.due) > start.getTime());
  assert.equal(reviewed.card.lastReview, start.toISOString());
  assert.equal(reviewed.lastRating, Rating.Good);
  assert.equal(reviewed.reviews.length, 1);
  assert.equal(reviewed.historyStartReps + reviewed.reviews.length, reviewed.card.reps);
  assert.equal(reviewed.reviews[0].rating, Rating.Good);
  assert.equal(reviewed.reviews[0].review, start.toISOString());
});


test('keeps the persisted parameter fingerprint synchronized with the scheduler', () => {
  const digest = createHash('sha256')
    .update(JSON.stringify(FSRS_PARAMETERS))
    .digest('hex');
  assert.equal(FSRS_PARAMETERS_ID, `sha256:${digest}`);
});

test('uses the FSRS definition of stability: retrievability is about 90% after S days', () => {
  const reviewed = reviewFsrsMemory(createFsrsMemory(start), Rating.Easy, start);
  const atStability = new Date(start.getTime() + reviewed.card.stability * DAY);
  const retrievability = getFsrsRetrievability(reviewed, atStability);

  assert.ok(Math.abs(retrievability - 0.9) < 0.005, String(retrievability));
});

test('Again records a lapse and schedules earlier than a successful recall', () => {
  const first = reviewFsrsMemory(createFsrsMemory(start), Rating.Easy, start);
  const due = new Date(first.card.due);
  const failed = reviewFsrsMemory(first, Rating.Again, due);
  const succeeded = reviewFsrsMemory(first, Rating.Good, due);

  assert.equal(failed.card.lapses, first.card.lapses + 1);
  assert.ok(failed.card.stability < succeeded.card.stability);
  assert.ok(Date.parse(failed.card.due) < Date.parse(succeeded.card.due));
});

test('computes effective proficiency from current FSRS retrievability without mutating stored level', () => {
  const fsrs = reviewFsrsMemory(createFsrsMemory(start), Rating.Easy, start);
  const stored: WordProficiency = {
    lemma: 'durable',
    level: 4,
    recognitionScore: 1,
    productionScore: 0.75,
    stabilityDays: fsrs.card.stability,
    lastReviewedAt: start.toISOString(),
    nextReviewDue: fsrs.card.due,
    exposureCount: 5,
    fsrs,
  };

  const current = getEffectiveProficiency(stored, start);
  const muchLater = getEffectiveProficiency(stored, new Date(start.getTime() + 20 * fsrs.card.stability * DAY));

  assert.equal(current.level, 4);
  assert.ok(muchLater.level < 4);

  const newCardWithStaleCache: WordProficiency = {
    ...stored,
    level: 4,
    recognitionScore: 0.99,
    fsrs: createFsrsMemory(start),
  };
  assert.equal(getEffectiveProficiency(newCardWithStaleCache, start).recognitionScore, 0);
  assert.ok(muchLater.recognitionScore < current.recognitionScore);
  assert.equal(stored.level, 4, 'projection must not mutate persisted compatibility fields');
});

test('band counts and due checks use the requested time instead of persisted level', () => {
  const fsrs = reviewFsrsMemory(createFsrsMemory(start), Rating.Easy, start);
  const word: WordProficiency = {
    lemma: 'durable',
    level: 4,
    recognitionScore: 1,
    productionScore: 0.75,
    stabilityDays: fsrs.card.stability,
    lastReviewedAt: start.toISOString(),
    nextReviewDue: fsrs.card.due,
    exposureCount: 5,
    fsrs,
  };
  const map = { durable: word };

  assert.deepEqual(countByBand(map, start), { learning: 0, mastered: 1 });
  assert.equal(isReviewDue(word, new Date(Date.parse(fsrs.card.due) - 1)), false);
  assert.equal(isReviewDue(word, new Date(fsrs.card.due)), true);

  const longAfterDue = new Date(start.getTime() + 20 * fsrs.card.stability * DAY);
  assert.deepEqual(countByBand(map, longAfterDue), { learning: 1, mastered: 0 });
});



test('rejects malformed persisted FSRS state and rebuilds it from legacy evidence', () => {
  const malformed = createFsrsMemory(start);
  malformed.card.due = 'not-a-date';
  malformed.card.state = 99;
  malformed.card.stability = Number.NaN;

  assert.equal(isValidFsrsMemory(malformed), false);

  const proficiency: WordProficiency = {
    lemma: 'recoverable',
    level: 2,
    recognitionScore: 0.6,
    productionScore: 0.2,
    stabilityDays: 12,
    lastReviewedAt: start.toISOString(),
    nextReviewDue: new Date(start.getTime() + 12 * DAY).toISOString(),
    exposureCount: 4,
    fsrs: malformed,
  };
  const rebuilt = ensureFsrsMemory(proficiency, start);

  assert.equal(rebuilt.card.state, State.Review);
  assert.equal(rebuilt.card.reps, 1);
  assert.equal(rebuilt.card.stability, 12);
  assert.equal(rebuilt.card.due, proficiency.nextReviewDue);
  assert.equal(isValidFsrsMemory(rebuilt), true);
  const reviewed = reviewFsrsMemory(rebuilt, Rating.Good, new Date(rebuilt.card.due));
  assert.equal(isValidFsrsMemory(reviewed), true);
});

test('validates every persisted review log field, not only the card shell', () => {
  const reviewed = reviewFsrsMemory(createFsrsMemory(start), Rating.Good, start);
  const malformed = structuredClone(reviewed);
  malformed.reviews[0].review = 'invalid';

  assert.equal(isValidFsrsMemory(malformed), false);
});


test('upgrades valid v1 memories without inventing missing review history', () => {
  const reviewed = reviewFsrsMemory(createFsrsMemory(start), Rating.Good, start);
  const v1: Record<string, unknown> = structuredClone(reviewed) as unknown as Record<string, unknown>;
  v1.version = 1;
  delete v1.algorithm;
  delete v1.implementation;
  delete v1.parametersId;
  delete v1.historyStartReps;

  const upgraded = upgradeFsrsMemory(v1);
  assert.ok(upgraded);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.historyStartReps, 0);
  assert.equal(upgraded.reviews.length, 1);
  assert.equal(isValidFsrsMemory(upgraded), true);

  const legacyBaseline = structuredClone(v1) as Record<string, unknown>;
  legacyBaseline.reviews = [];
  const baseline = upgradeFsrsMemory(legacyBaseline);
  assert.ok(baseline);
  assert.equal(baseline.historyStartReps, 1);
  assert.equal(baseline.historyStartReps + baseline.reviews.length, baseline.card.reps);
});

test('detects missing, reordered, or metadata-incompatible FSRS history', () => {
  const first = reviewFsrsMemory(createFsrsMemory(start), Rating.Good, start);
  const secondAt = new Date(first.card.due);
  const second = reviewFsrsMemory(first, Rating.Easy, secondAt);

  const missing = structuredClone(second);
  missing.reviews.shift();
  assert.equal(isValidFsrsMemory(missing), false);

  const reordered = structuredClone(second);
  reordered.reviews.reverse();
  reordered.card.lastReview = reordered.reviews.at(-1)?.review;
  reordered.lastRating = reordered.reviews.at(-1)?.rating;
  assert.equal(isValidFsrsMemory(reordered), false);

  const wrongParameters = structuredClone(second);
  wrongParameters.parametersId = 'different-parameters';
  assert.equal(isValidFsrsMemory(wrongParameters), false);
});

test('rejects reviews that move backward in time', () => {
  const first = reviewFsrsMemory(createFsrsMemory(start), Rating.Good, start);
  const beforeFirst = new Date(start.getTime() - 1);
  assert.throws(
    () => reviewFsrsMemory(first, Rating.Good, beforeFirst),
    /earlier than the previous review/
  );
});
