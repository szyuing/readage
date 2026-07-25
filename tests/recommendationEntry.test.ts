import assert from 'node:assert/strict';
import test from 'node:test';

import { getRecommendationEntryAction } from '../src/lib/recommendationEntry';

test('starts recommendation immediately for assessed readers', () => {
  assert.equal(getRecommendationEntryAction(true), 'start');
});

test('keeps the assessment step for readers without a completed assessment', () => {
  assert.equal(getRecommendationEntryAction(false), 'assessment');
});
