import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../src/types';
import { resolveRecommendationArticle } from '../src/lib/resolveRecommendation';

function article(id: string, status: Article['status'] = 'Not Started'): Article {
  return {
    id,
    title: id,
    description: id,
    date: '2026-07-24',
    status,
    content: ['hello world'],
    level: 'B1',
  };
}

describe('resolveRecommendationArticle chain', () => {
  it('returns Memory V2 local hits without calling AI or library fallback', async () => {
    let aiCalls = 0;
    let libraryCalls = 0;
    const local = article('local-hit');

    const resolved = await resolveRecommendationArticle(
      { topic: 'Idioms', reviewWords: [], excludeArticleIds: [] },
      {
        library: [local],
        history: [],
        localProvider: async () => local,
        libraryFallback: () => {
          libraryCalls += 1;
          return null;
        },
        aiPost: async () => {
          aiCalls += 1;
          throw new Error('AI should not run');
        },
      }
    );

    assert.equal(resolved?.source, 'local_memory');
    assert.equal(resolved?.article.id, 'local-hit');
    assert.equal(aiCalls, 0);
    assert.equal(libraryCalls, 0);
  });

  it('uses library fallback before AI when Memory V2 returns null', async () => {
    let aiCalls = 0;
    const libraryHit = article('library-hit');

    const resolved = await resolveRecommendationArticle(
      { topic: 'Idioms', reviewWords: [], excludeArticleIds: [] },
      {
        library: [libraryHit],
        history: [],
        localProvider: async () => null,
        libraryFallback: () => libraryHit,
        aiPost: async () => {
          aiCalls += 1;
          throw new Error('AI should not run when library has candidates');
        },
      }
    );

    assert.equal(resolved?.source, 'library_fallback');
    assert.equal(resolved?.article.id, 'library-hit');
    assert.equal(aiCalls, 0);
  });

  it('calls AI only when both Memory V2 and library fallback miss', async () => {
    let aiCalls = 0;

    const resolved = await resolveRecommendationArticle(
      { topic: 'Idioms', reviewWords: ['target'], excludeArticleIds: [] },
      {
        library: [],
        history: [],
        localProvider: async () => null,
        libraryFallback: () => null,
        aiPost: async () => {
          aiCalls += 1;
          return {
            result: {
              title: 'AI Article',
              description: 'Generated',
              paragraphs: ['Hello target.'],
              keyWords: ['target'],
            },
          } as never;
        },
      }
    );

    assert.equal(aiCalls, 1);
    assert.equal(resolved?.source, 'ai');
    assert.equal(resolved?.article.title, 'AI Article');
    assert.equal(resolved?.article.source, 'ai_generated');
    assert.deepEqual(resolved?.article.embeddedReviewWords, ['target']);
  });

  it('rethrows AbortError so callers can cancel without a false success', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    await assert.rejects(
      () =>
        resolveRecommendationArticle(
          { topic: 'Idioms', reviewWords: [], excludeArticleIds: [] },
          {
            library: [],
            history: [],
            localProvider: async () => null,
            libraryFallback: () => null,
            aiPost: async () => {
              throw abortError;
            },
          }
        ),
      (error: unknown) => error instanceof Error && error.name === 'AbortError'
    );
  });
});
