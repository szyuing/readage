import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReadingAdvancePayload,
  countArticleWords,
  isLeftSwipeGesture,
  minDwellMsBeforeAutoAdvance,
} from '../src/lib/continuousReading';

test('completed reading commits unique staged exposures', () => {
  assert.deepEqual(
    buildReadingAdvancePayload('article-1', 'completed', ['Read', 'read', 'context']),
    {
      articleId: 'article-1',
      reason: 'completed',
      exposedLemmas: ['read', 'context'],
    }
  );
});

test('skipped reading discards every staged exposure', () => {
  assert.deepEqual(
    buildReadingAdvancePayload('article-1', 'skipped', ['read', 'context']),
    {
      articleId: 'article-1',
      reason: 'skipped',
      exposedLemmas: [],
    }
  );
});

test('left swipe requires distance and horizontal dominance', () => {
  assert.equal(isLeftSwipeGesture({ startX: 200, startY: 100, endX: 120, endY: 110 }), true);
  assert.equal(isLeftSwipeGesture({ startX: 200, startY: 100, endX: 150, endY: 100 }), false);
  assert.equal(isLeftSwipeGesture({ startX: 200, startY: 100, endX: 120, endY: 180 }), false);
  assert.equal(isLeftSwipeGesture({ startX: 100, startY: 100, endX: 180, endY: 100 }), false);
});

test('short articles require a multi-second dwell before auto-advance', () => {
  assert.ok(minDwellMsBeforeAutoAdvance(40) >= 4_000);
  assert.ok(minDwellMsBeforeAutoAdvance(40) < 10_000);
  assert.ok(minDwellMsBeforeAutoAdvance(2_000) > minDwellMsBeforeAutoAdvance(40));
  assert.equal(countArticleWords(['one two', 'three']), 3);
});
