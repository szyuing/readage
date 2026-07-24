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

function article(
  id: string,
  word: string,
  status: Article['status'] = 'In Progress'
): Article {
  return {
    id,
    title: `${word} article`,
    description: `An article about ${word}`,
    date: '2026-07-24',
    status,
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

  it('prefers higher unique review-word coverage even when general score favors another article', async () => {
    installMemorySystemStub({
      dueWords: [],
      allProficiency: [
        proficiency('alpha'),
        proficiency('beta'),
        proficiency('gamma'),
      ],
    });

    // Many learning-zone fillers boost the generic engine score for one-hit articles.
    const oneHitBloated: Article = {
      ...article('one-hit', 'alpha'),
      content: [
        'alpha learning1 learning2 learning3 learning4 learning5 learning6 learning7 learning8',
      ],
      status: 'In Progress',
    };
    const threeHitLean: Article = {
      ...article('three-hit', 'alpha'),
      content: ['alpha beta gamma'],
      status: 'In Progress',
    };

    const recommendations = await createMemoryV2Adapter({
      strategy: 'review-first',
    }).recommendForReview([oneHitBloated, threeHitLean], ['alpha', 'beta', 'gamma'], 2);

    assert.equal(recommendations[0]?.articleId, 'three-hit');
    assert.ok(
      (recommendations[0]?.dueWordsCount ?? 0) >= 3
      || (recommendations[0]?.reason ?? '').includes('3')
    );
  });

  it('never returns a Completed article even if it is the only review-word hit', async () => {
    installMemorySystemStub({
      dueWords: [],
      allProficiency: [proficiency('target')],
    });

    const selected = await memoryV2RecommendationProvider(
      {
        topic: '',
        reviewWords: ['target'],
        excludeArticleIds: [],
      },
      [
        article('done-target', 'target', 'Completed'),
        {
          ...article('fresh-other', 'other'),
          content: ['other filler words for length'],
        },
      ]
    );

    // Completed hit must be skipped; fall through may pick nothing or non-completed.
    assert.notEqual(selected?.id, 'done-target');
  });

  it('never returns an article listed in excludeArticleIds', async () => {
    installMemorySystemStub({
      dueWords: [],
      allProficiency: [proficiency('target'), proficiency('other')],
    });

    const selected = await memoryV2RecommendationProvider(
      {
        topic: '',
        reviewWords: ['target'],
        excludeArticleIds: ['best-hit'],
      },
      [
        { ...article('best-hit', 'target'), status: 'In Progress' },
        { ...article('second-hit', 'target'), status: 'In Progress', content: ['target and more'] },
      ]
    );

    assert.equal(selected?.id, 'second-hit');
  });
});
