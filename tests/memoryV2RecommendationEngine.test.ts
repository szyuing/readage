import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WordProficiencyView } from '../src/lib/memoryV2/memorySystem';
import {
  RecommendationEngine,
  countUniqueReviewHits,
  rankCandidatesByReviewHits,
  scheduleReviewArticles,
  type ArticleCandidate,
} from '../src/lib/memoryV2/recommendation';

function candidate(id: string, lemmas: string[]): ArticleCandidate {
  return {
    article: {
      id,
      title: id,
      content: [lemmas.join(' ')],
      level: 'B1',
      topic: 'general',
    },
    lemmas,
  };
}

function proficiency(
  wordId: string,
  level: WordProficiencyView['level'] = 1,
  nextReview = '2099-01-01T00:00:00.000Z'
): WordProficiencyView {
  return {
    wordId,
    memoryScore: 50,
    level,
    stability: 1,
    difficulty: 5,
    nextReview,
    lastReview: null,
  };
}

describe('RecommendationEngine cold-start filtering', () => {
  it('keeps local candidates when the proficiency map is empty', () => {
    const engine = new RecommendationEngine();
    const candidates = [
      candidate('first-local', ['alpha', 'beta', 'gamma', 'delta']),
      candidate('second-local', ['epsilon', 'zeta', 'eta', 'theta']),
    ];

    assert.deepEqual(
      engine.filterCandidates(candidates, new Map()).map((item) => item.article.id),
      ['first-local', 'second-local']
    );
  });

  it('keeps candidates while the user has too little proficiency data for reliable filtering', () => {
    const engine = new RecommendationEngine();
    const candidates = [
      candidate('low-coverage-local', [
        'known',
        'unknown-1',
        'unknown-2',
        'unknown-3',
        'unknown-4',
        'unknown-5',
      ]),
    ];
    const proficiencyMap = new Map<string, WordProficiencyView>([
      ['known', proficiency('known', 4)],
      ['unrelated-1', proficiency('unrelated-1', 4)],
      ['unrelated-2', proficiency('unrelated-2', 4)],
      ['unrelated-3', proficiency('unrelated-3', 4)],
    ]);

    assert.deepEqual(engine.filterCandidates(candidates, proficiencyMap), candidates);
  });

  it('keeps candidates when the map is large but article lemma coverage is still low', () => {
    const engine = new RecommendationEngine();
    const proficiencyMap = new Map<string, WordProficiencyView>(
      Array.from({ length: 12 }, (_, index) => {
        const wordId = `tracked-${index + 1}`;
        return [wordId, proficiency(wordId, 4)] as const;
      })
    );
    const candidates = [
      candidate('mostly-untracked-local', [
        'tracked-1',
        'fresh-1',
        'fresh-2',
        'fresh-3',
        'fresh-4',
        'fresh-5',
        'fresh-6',
        'fresh-7',
        'fresh-8',
        'fresh-9',
      ]),
    ];

    // Coverage is 1/10 = 0.1, below the 0.2 threshold → cold-start keep.
    assert.deepEqual(engine.filterCandidates(candidates, proficiencyMap), candidates);

    const ranked = engine.recommend(candidates, proficiencyMap, 1);
    assert.equal(ranked[0]?.articleId, 'mostly-untracked-local');
    assert.ok(ranked[0]!.score > 0);
  });

  it('preserves unknown-ratio and learning-zone constraints once proficiency data is mature', () => {
    const engine = new RecommendationEngine();
    const proficiencyMap = new Map<string, WordProficiencyView>([
      ['learning-1', proficiency('learning-1', 1)],
      ['learning-2', proficiency('learning-2', 1)],
      ['learning-3', proficiency('learning-3', 1)],
      ['learning-4', proficiency('learning-4', 1)],
      ['learning-5', proficiency('learning-5', 1)],
      ['mastered-1', proficiency('mastered-1', 4)],
      ['mastered-2', proficiency('mastered-2', 4)],
      ['mastered-3', proficiency('mastered-3', 4)],
      ['mastered-4', proficiency('mastered-4', 4)],
      ['mastered-5', proficiency('mastered-5', 4)],
    ]);
    const candidates = [
      candidate('too-many-unknown', [
        'learning-1',
        'learning-2',
        'learning-3',
        'learning-4',
        'learning-5',
        'unknown-1',
        'unknown-2',
        'unknown-3',
      ]),
      candidate('too-few-learning-zone-words', [
        'mastered-1',
        'mastered-2',
        'mastered-3',
        'mastered-4',
        'mastered-5',
      ]),
      candidate('eligible', [
        'learning-1',
        'learning-2',
        'learning-3',
        'learning-4',
        'learning-5',
      ]),
    ];

    assert.deepEqual(
      engine.filterCandidates(candidates, proficiencyMap).map((item) => item.article.id),
      ['eligible']
    );
  });

  it('ranks empty-proficiency libraries with a non-zero cold-start score', () => {
    const engine = new RecommendationEngine({
      userLevel: 'B1',
      preferredTopics: ['idioms'],
    });
    const candidates = [
      candidate('level-match', ['alpha', 'beta', 'gamma']),
      {
        ...candidate('topic-and-level', ['delta', 'epsilon', 'zeta']),
        article: {
          id: 'topic-and-level',
          title: 'topic-and-level',
          content: ['delta epsilon zeta'],
          level: 'B1',
          topic: 'idioms',
        },
      },
    ];

    const ranked = engine.recommend(candidates, new Map(), 2);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.articleId, 'topic-and-level');
    assert.ok(ranked[0]!.score > ranked[1]!.score);
    assert.match(ranked[0]!.reason, /冷启动|匹配/);
  });
});

describe('review hit-rate ranking', () => {
  it('counts unique target hits, not repeated lemma occurrences', () => {
    const lemmas = ['target', 'target', 'target', 'other'];
    assert.equal(countUniqueReviewHits(lemmas, new Set(['target', 'miss'])), 1);
    assert.equal(countUniqueReviewHits(lemmas, ['target', 'other']), 2);
  });

  it('prefers articles that cover more distinct review words over longer single-word spam', () => {
    const dueWords = [
      proficiency('alpha', 1, '2020-01-01T00:00:00.000Z'),
      proficiency('beta', 1, '2020-01-01T00:00:00.000Z'),
      proficiency('gamma', 1, '2020-01-01T00:00:00.000Z'),
    ];
    // Old bug: counting lemma occurrences favored "alpha" repeated many times.
    const spamOneWord = candidate('spam-one', [
      'alpha', 'alpha', 'alpha', 'alpha', 'alpha', 'alpha',
    ]);
    const highCoverage = candidate('high-coverage', ['alpha', 'beta', 'gamma', 'filler']);

    const ranked = scheduleReviewArticles(dueWords, [spamOneWord, highCoverage], 3);
    assert.equal(ranked[0]?.article.id, 'high-coverage');
    assert.equal(ranked[1]?.article.id, 'spam-one');
  });

  it('ranks by unique review hits first, then secondary engine score', () => {
    const targets = ['due-a', 'due-b', 'due-c'];
    const lowHitsHighSecondary = candidate('low-hits', ['due-a', 'x', 'y', 'z']);
    const highHits = candidate('high-hits', ['due-a', 'due-b', 'due-c', 'w']);

    const ranked = rankCandidatesByReviewHits(
      [lowHitsHighSecondary, highHits],
      targets,
      new Map([
        ['low-hits', 999],
        ['high-hits', 1],
      ])
    );

    assert.deepEqual(
      ranked.map((item) => item.article.id),
      ['high-hits', 'low-hits']
    );
  });

  it('drops articles with zero review-word hits', () => {
    const ranked = rankCandidatesByReviewHits(
      [candidate('miss', ['unrelated']), candidate('hit', ['due-a'])],
      ['due-a']
    );
    assert.deepEqual(
      ranked.map((item) => item.article.id),
      ['hit']
    );
  });
});
