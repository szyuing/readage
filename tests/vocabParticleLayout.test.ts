import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyVocabEvent,
  createVocabSimState,
  getVocabBoardLayout,
  scrollVocabParticles,
} from '../prototypes/rec-particles/src/vocabSim';

test('vocabulary notebook keeps a dense word list inside its scrollable viewport', () => {
  const state = createVocabSimState();
  state.width = 1440;
  state.height = 900;

  applyVocabEvent(state, {
    type: 'vocab_exposure',
    sessionId: 'test-session',
    at: Date.now(),
    articleId: 'article-1',
    paragraphIndex: 0,
    words: Array.from({ length: 180 }, (_, index) => ({
      wordId: `unabridged-word-${index + 1}`,
      memoryScore: index % 100,
      level: (index % 5) as 0 | 1 | 2 | 3 | 4,
    })),
  });

  const board = getVocabBoardLayout(state);
  assert.ok(state.contentHeight > state.contentViewportHeight);
  assert.ok(state.particles.every((particle) => particle.targetX - particle.w / 2 >= board.left));
  assert.ok(state.particles.every((particle) => particle.targetX + particle.w / 2 <= board.left + board.width));

  scrollVocabParticles(state, Number.MAX_SAFE_INTEGER);
  assert.equal(state.scrollOffset, state.contentHeight - state.contentViewportHeight);
});
