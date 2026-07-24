import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../src/types';
import type { WordProficiencyView } from '../src/lib/memoryV2/memorySystem';
import {
  createMemoryV2Adapter,
  memoryV2RecommendationProvider,
} from '../src/lib/memoryV2RecommendationAdapter';
import { memoryV2 } from '../src/lib/memoryV2/hooks';

const originalGetSystem = memoryV2.getSystem;
const originalGetUserId = memoryV2.getUserId;

function article(id: string, word: string): Article {
  return {
    id,
    title: `${word} article`,
    description: `An article about ${word}`,
    date: '2026-07-24',
    status: 'Completed',
    content: [word],
    level: 'B1',
  };
}

function proficiency(wordId: string): WordProficiencyView {
  return {
    wordId,
    memoryScore: 45,
    level: 1,
    stability: 1,
    difficulty: 5,
    nextReview: '2020-01-01T00:00:00.000Z',
    lastReview: null,
  };
}

function installMemorySystemStub(options: {
  dueWords: WordProficiencyView[];
  allProficiency: WordProficiencyView[];
  onGetDueWords?: (limit: number) => void;
}): void {
  const fakeSystem = {
    async getDueWords(_userId: string, _now: Date, limit: number) {
      options.onGetDueWords?.(limit);
      return options.dueWords;
    },
    async getAllWordProficiency() {
      return options.allProficiency;
    },
  };

  (memoryV2 as unknown as { getSystem: () => typeof fakeSystem }).getSystem = () => fakeSystem;
  (memoryV2 as unknown as { getUserId: () => string }).getUserId = () => 'test-user';
}

afterEach(() => {
  (memoryV2 as unknown as { getSystem: typeof originalGetSystem }).getSystem = originalGetSystem;
  (memoryV2 as unknown as { getUserId: typeof originalGetUserId }).getUserId = originalGetUserId;
});

describe('MemoryV2RecommendationAdapter targeted review', () => {
  it('provider prioritizes the requested reviewWords instead of the system due words', async () => {
    let dueWordQueries = 0;
    installMemorySystemStub({
      dueWords: [proficiency('other')],
      allProficiency: [proficiency('target'), proficiency('other')],
      onGetDueWords: () => {
        dueWordQueries += 1;
      },
    });

    const selected = await memoryV2RecommendationProvider(
      {
        topic: '',
        reviewWords: ['target'],
        excludeArticleIds: [],
      },
      [article('target-article', 'target'), article('other-article', 'other')]
    );

    assert.equal(selected?.id, 'target-article');
    assert.equal(dueWordQueries, 0, 'explicit reviewWords must not trigger a due-word query');
  });

  it('falls back to querying due words when no explicit target words are provided', async () => {
    const requestedLimits: number[] = [];
    installMemorySystemStub({
      dueWords: [proficiency('other')],
      allProficiency: [proficiency('other')],
      onGetDueWords: (limit) => {
        requestedLimits.push(limit);
      },
    });

    const recommendations = await createMemoryV2Adapter().recommendForReview(
      [article('other-article', 'other')],
      [],
      5
    );

    assert.equal(recommendations[0]?.articleId, 'other-article');
    assert.deepEqual(requestedLimits, [10]);
  });

  it('keeps the legacy numeric targetReviewCount API compatible', async () => {
    const requestedLimits: number[] = [];
    installMemorySystemStub({
      dueWords: [proficiency('other')],
      allProficiency: [proficiency('other')],
      onGetDueWords: (limit) => {
        requestedLimits.push(limit);
      },
    });

    const recommendations = await createMemoryV2Adapter().recommendForReview(
      [article('other-article', 'other')],
      1,
      5
    );

    assert.equal(recommendations[0]?.articleId, 'other-article');
    assert.deepEqual(requestedLimits, [1]);
  });
});
