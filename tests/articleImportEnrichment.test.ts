import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEnrichmentToArticle,
  needsImportEnrichment,
  splitArticleParagraphs,
  enrichArticleOnImport,
} from '../src/lib/articleImportEnrichment';
import type { Article } from '../src/types';

test('splitArticleParagraphs prefers blank-line breaks', () => {
  const parts = splitArticleParagraphs('First para.\n\nSecond para.\n\nThird.');
  assert.deepEqual(parts, ['First para.', 'Second para.', 'Third.']);
});

test('splitArticleParagraphs falls back to single newlines', () => {
  const parts = splitArticleParagraphs('Line one\nLine two\nLine three');
  assert.deepEqual(parts, ['Line one', 'Line two', 'Line three']);
});

test('needsImportEnrichment detects missing translations or rating', () => {
  const base: Pick<Article, 'content' | 'paragraphTranslations' | 'levelRating'> = {
    content: ['Hello world.', 'Second paragraph.'],
  };
  assert.equal(needsImportEnrichment(base), true);

  assert.equal(
    needsImportEnrichment({
      ...base,
      paragraphTranslations: ['你好。', '第二段。'],
      levelRating: { level: 'B1', difficultyScore: 42, summary: '中等' },
    }),
    false
  );

  assert.equal(
    needsImportEnrichment({
      ...base,
      paragraphTranslations: ['你好。'],
      levelRating: { level: 'B1', difficultyScore: 42, summary: '中等' },
    }),
    true
  );
});

test('enrichArticleOnImport translates each paragraph then rates', async () => {
  const calls: unknown[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { intent: string; message?: string };
    calls.push(body);
    if (body.intent === 'translate') {
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: {
            originalText: body.message,
            translatedText: `译：${body.message}`,
            targetLanguage: 'Chinese',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (body.intent === 'rate_article') {
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'rate_article',
          result: {
            level: 'B2',
            difficultyScore: 58,
            summary: '词汇偏正式，句式中等复杂。',
            vocabularyNotes: '少量学术词',
            structureNotes: '复合句为主',
            estimatedWordCount: 40,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: 'X', message: 'bad' } }), {
      status: 400,
    });
  };

  const progress: string[] = [];
  const result = await enrichArticleOnImport(
    { title: 'Demo', content: ['Hello one.', 'Hello two.'] },
    {
      fetcher: fetcher as typeof fetch,
      onProgress: (p) => progress.push(p.phase),
    }
  );

  assert.equal(result.level, 'B2');
  assert.equal(result.levelRating.difficultyScore, 58);
  assert.deepEqual(result.paragraphTranslations, ['译：Hello one.', '译：Hello two.']);
  assert.equal(calls.filter((c) => (c as { intent: string }).intent === 'translate').length, 2);
  assert.equal(calls.filter((c) => (c as { intent: string }).intent === 'rate_article').length, 1);
  assert.ok(progress.includes('translating'));
  assert.ok(progress.includes('rating'));
  assert.ok(progress.includes('done'));
});

test('applyEnrichmentToArticle sets level and translations', () => {
  const article: Article = {
    id: 'a1',
    title: 'T',
    description: 'D',
    date: 'Jan 1, 2026',
    status: 'In Progress',
    content: ['One.'],
    source: 'user_input',
  };
  const next = applyEnrichmentToArticle(article, {
    paragraphTranslations: ['一。'],
    levelRating: { level: 'A2', difficultyScore: 28, summary: '较易' },
    level: 'A2',
    wordCount: 1,
    charCount: 4,
    ratingTruncated: false,
    paragraphsSplit: false,
  });
  assert.equal(next.level, 'A2');
  assert.deepEqual(next.paragraphTranslations, ['一。']);
  assert.equal(next.levelRating?.level, 'A2');
});
