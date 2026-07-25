import test from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../src/types';
import type { RecommendedArticleCandidate } from '../src/lib/articleValidation';
import { buildLevelRewriteArticle } from '../src/lib/rewriteArticle';

function sourceArticle(): Article {
  return {
    id: 'source-article',
    title: 'Original article',
    description: 'Original description',
    date: 'Jul 25, 2026',
    status: 'In Progress',
    content: ['Original paragraph.'],
    topic: 'Technology',
    embeddedReviewWords: ['old review word'],
  };
}

const candidate: RecommendedArticleCandidate = {
  title: 'A new article',
  description: 'A standalone rewrite.',
  paragraphs: ['The rewritten paragraph.', 'Another rewritten paragraph.'],
  keyWords: ['rewritten'],
};

test('buildLevelRewriteArticle creates a standalone article without inherited review words', () => {
  const article = buildLevelRewriteArticle({
    sourceArticle: sourceArticle(),
    candidate,
    targetLevel: 'A2',
    levelRating: {
      level: 'A2',
      difficultyScore: 28,
      summary: 'A2 rewrite.',
    },
    id: 'rewrite-article',
    date: 'Jul 25, 2026',
  });

  assert.equal(article.source, 'level_rewrite');
  assert.deepEqual(article.content, candidate.paragraphs);
  assert.deepEqual(article.keyWords, candidate.keyWords);
  assert.equal(article.embeddedReviewWords, undefined);
});
