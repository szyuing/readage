import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecommendedArticle, validateRewrittenArticle } from '../src/lib/articleValidation';

test('accepts an article with all review words and controlled new-word density', () => {
  const paragraphs = [
    Array.from({ length: 80 }, (_, i) => (i === 10 ? 'ephemeral' : 'practice')).join(' '),
    Array.from({ length: 80 }, (_, i) => (i === 20 ? 'ubiquitous' : i === 30 ? 'context' : 'reading')).join(' '),
  ];
  const result = validateRecommendedArticle(
    { title: 'Review', description: 'Review', paragraphs, keyWords: ['ephemeral', 'ubiquitous', 'context'] },
    ['ephemeral', 'ubiquitous']
  );
  assert.equal(result.isValid, true);
  assert.ok(result.metrics.newWordDensity <= 0.04);
});

test('rejects missing review words and excessive new vocabulary density', () => {
  const denseWords = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
  const paragraphs = [
    [...denseWords, ...Array.from({ length: 44 }, () => 'practice')].join(' '),
    Array.from({ length: 50 }, () => 'reading').join(' '),
  ];
  const result = validateRecommendedArticle(
    {
      title: 'Dense',
      description: 'Dense',
      paragraphs,
      keyWords: denseWords,
    },
    ['ephemeral']
  );
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((error) => error.includes('Missing review words')));
  assert.ok(result.errors.some((error) => error.includes('density')));
});


import { buildFallbackReviewArticle } from '../src/data/mockArticles';

test('offline recommendation fallback also respects the new-vocabulary density cap', () => {
  const article = buildFallbackReviewArticle([]);
  const validation = validateRecommendedArticle(
    {
      title: article.title,
      description: article.description,
      paragraphs: article.content,
      keyWords: article.keyWords || [],
    },
    []
  );
  assert.equal(validation.isValid, true, validation.errors.join('; '));
});

test('rejects malformed model output without throwing so the caller can retry', () => {
  const malformed = {
    title: 'Incomplete response',
    description: 'The model omitted array fields.',
  };

  assert.doesNotThrow(() => validateRecommendedArticle(malformed, []));
  const result = validateRecommendedArticle(malformed, []);

  assert.equal(result.isValid, false);
  assert.match(result.errors.join(' '), /paragraphs/i);
  assert.match(result.errors.join(' '), /keyWords/i);
});

test('repairs inflected keyword metadata and drops keywords absent from the article', () => {
  const result = validateRecommendedArticle(
    {
      title: 'Small habits',
      description: 'Practice builds consistency.',
      paragraphs: [
        `Daily practice reinforces useful habits for learners. ${Array.from({ length: 45 }, () => 'practice').join(' ')}`,
        `Over time, learners recognize familiar patterns more quickly. ${Array.from({ length: 45 }, () => 'reading').join(' ')}`,
      ],
      keyWords: ['reinforce', 'recognize', 'hallucinated'],
    },
    []
  );

  assert.equal(result.isValid, true, result.errors.join('; '));
  assert.deepEqual(result.article?.keyWords, ['reinforces', 'recognize']);
});

test('validateRewrittenArticle accepts a structured CEFR rewrite', () => {
  const paragraphs = [
    `${Array.from({ length: 50 }, () => 'practice').join(' ')} climate energy`,
    `${Array.from({ length: 50 }, () => 'reading').join(' ')} scientists observe`,
  ];
  const result = validateRewrittenArticle(
    {
      title: 'Earth Energy',
      description: 'A simpler take on climate imbalance.',
      paragraphs,
      keyWords: ['climate', 'energy'],
    },
    ['climate']
  );
  assert.equal(result.isValid, true, result.errors.join('; '));
  assert.ok((result.metrics.wordCount || 0) >= 80);
});

test('validateRewrittenArticle rejects too-short rewrites', () => {
  const result = validateRewrittenArticle({
    title: 'Tiny',
    description: 'Too short',
    paragraphs: ['Hello world.', 'Bye.'],
    keyWords: ['hello'],
  });
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.toLowerCase().includes('short')));
});

