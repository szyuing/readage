import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReadingAdvancePayload,
  canAutoAdvanceAtScrollEnd,
  countArticleWords,
  hasArticleExitedViewport,
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

test('scroll-end auto-advance requires a real scroll and enough dwell time', () => {
  const article = { scrollTop: 700, clientHeight: 600, scrollHeight: 1_300 };

  assert.equal(canAutoAdvanceAtScrollEnd(article, 3_999, 4_000), false);
  assert.equal(canAutoAdvanceAtScrollEnd(article, 4_000, 4_000), true);
  assert.equal(
    canAutoAdvanceAtScrollEnd({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 }, 10_000, 4_000),
    false
  );
});

test('article completion waits until the final paragraph leaves the viewport', () => {
  assert.equal(hasArticleExitedViewport(1), false);
  assert.equal(hasArticleExitedViewport(0), true);
  assert.equal(hasArticleExitedViewport(-12), true);
  assert.equal(hasArticleExitedViewport(6, 8), true);
  assert.equal(hasArticleExitedViewport(9, 8), false);
});
