/**
 * 万字 (~10,000 English words) import enrichment stress tests.
 * Uses mocked tutor responses so CI stays offline and deterministic.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMPORT_LIMITS,
  applyEnrichmentToArticle,
  countWords,
  enrichArticleOnImport,
  prepareImportParagraphs,
  splitArticleParagraphs,
  splitOversizedParagraph,
} from '../src/lib/articleImportEnrichment';
import { validateTutorRequest } from '../src/lib/tutorValidation';
import type { Article } from '../src/types';

/** Build a deterministic ~N-word English article with blank-line paragraphs. */
export function buildTenThousandWordArticle(
  targetWords = IMPORT_LIMITS.TEN_THOUSAND_WORDS,
  wordsPerParagraph = 80
): { text: string; paragraphs: string[]; wordCount: number } {
  const vocab = [
    'active', 'reading', 'learners', 'practice', 'vocabulary', 'grammar',
    'context', 'review', 'english', 'comprehension', 'discussion', 'writing',
    'proficiency', 'stability', 'exposure', 'sentence', 'paragraph', 'article',
    'magazine', 'culture', 'science', 'history', 'economy', 'technology',
    'argument', 'evidence', 'analysis', 'summary', 'opinion', 'clarity',
  ];

  const paragraphs: string[] = [];
  let words = 0;
  let paraIdx = 0;

  while (words < targetWords) {
    const remaining = targetWords - words;
    const size = Math.min(wordsPerParagraph, remaining);
    const tokens: string[] = [];
    for (let i = 0; i < size; i += 1) {
      tokens.push(vocab[(words + i) % vocab.length]);
    }
    // End each paragraph with punctuation so sentence splitters stay happy.
    paragraphs.push(`${tokens.join(' ')}.`);
    words += size;
    paraIdx += 1;
  }

  const text = paragraphs.join('\n\n');
  return { text, paragraphs, wordCount: countWords(text) };
}

function mockTutorFetcher(calls: Array<Record<string, unknown>>) {
  return async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    calls.push(body);

    if (body.intent === 'translate') {
      const msg = String(body.message || '');
      // Reject payloads that would fail production validation.
      const validated = validateTutorRequest(body);
      assert.equal(validated.ok, true, `translate request rejected: ${JSON.stringify(body).slice(0, 200)}`);

      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: {
            originalText: msg,
            translatedText: `【译${body.paragraphIndex}/${body.paragraphTotal}】${msg.slice(0, 40)}…`,
            targetLanguage: 'Chinese',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (body.intent === 'rate_article') {
      const validated = validateTutorRequest(body);
      assert.equal(validated.ok, true, 'rate_article request failed validation');
      const ctx = String(body.articleContext || '');
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'rate_article',
          result: {
            level: 'C1',
            difficultyScore: 72,
            summary: `万字样本文章评级：约 ${countWords(ctx)} 词样本。`,
            vocabularyNotes: '词表多样，学术向。',
            structureNotes: '多段论述，句式偏长。',
            estimatedWordCount: countWords(ctx),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: { code: 'X', message: 'unexpected intent' } }),
      { status: 400 }
    );
  };
}

test('fixture reaches at least 10,000 English words', () => {
  const { text, paragraphs, wordCount } = buildTenThousandWordArticle();
  assert.ok(wordCount >= IMPORT_LIMITS.TEN_THOUSAND_WORDS, `wordCount=${wordCount}`);
  assert.ok(paragraphs.length >= 100, `expected many paragraphs, got ${paragraphs.length}`);
  assert.ok(text.length > 40_000, `char length too small: ${text.length}`);
});

test('splitArticleParagraphs keeps 万字 paragraph count under the hard cap without dropping below 100', () => {
  const { text, wordCount } = buildTenThousandWordArticle();
  const parts = splitArticleParagraphs(text);
  assert.ok(countWords(parts.join(' ')) >= IMPORT_LIMITS.TEN_THOUSAND_WORDS * 0.98);
  assert.ok(parts.length <= IMPORT_LIMITS.MAX_PARAGRAPHS);
  assert.ok(parts.length >= 100);
  assert.equal(wordCount >= IMPORT_LIMITS.TEN_THOUSAND_WORDS, true);
});

test('splitOversizedParagraph breaks multi-thousand-char blocks for translate budget', () => {
  const long = `${'word '.repeat(2_000)}. ${'more '.repeat(2_000)}.`;
  assert.ok(long.length > IMPORT_LIMITS.MAX_CHARS_PER_PARAGRAPH);
  const parts = splitOversizedParagraph(long);
  assert.ok(parts.length >= 2);
  for (const part of parts) {
    assert.ok(part.length <= IMPORT_LIMITS.MAX_CHARS_PER_PARAGRAPH);
  }
  // Rough content preservation
  assert.ok(countWords(parts.join(' ')) >= countWords(long) * 0.95);
});

test('prepareImportParagraphs reports metrics for 万字 content', () => {
  const { paragraphs } = buildTenThousandWordArticle();
  const prepared = prepareImportParagraphs(paragraphs);
  assert.ok(prepared.wordCount >= IMPORT_LIMITS.TEN_THOUSAND_WORDS);
  assert.ok(prepared.paragraphs.length >= 100);
  assert.ok(prepared.charCount > 40_000);
});

test('tutor validation accepts 万字 rating payload (≤ MAX_RATING_CHARS)', () => {
  const { text } = buildTenThousandWordArticle();
  const body = text.slice(0, IMPORT_LIMITS.MAX_RATING_CHARS);
  assert.ok(body.length <= IMPORT_LIMITS.MAX_RATING_CHARS);
  assert.ok(body.length > 40_000);
  const result = validateTutorRequest({
    intent: 'rate_article',
    articleContext: body,
    topic: '万字测试',
  });
  assert.equal(result.ok, true);
});

test('enrichArticleOnImport processes full 万字 article: every paragraph translated + one rating', async () => {
  const { paragraphs, wordCount } = buildTenThousandWordArticle();
  assert.ok(wordCount >= IMPORT_LIMITS.TEN_THOUSAND_WORDS);

  const calls: Array<Record<string, unknown>> = [];
  const progressLog: Array<{ phase: string; index: number; total: number; words?: number }> = [];
  const started = Date.now();

  const result = await enrichArticleOnImport(
    { title: '万字压测样文', content: paragraphs },
    {
      fetcher: mockTutorFetcher(calls) as typeof fetch,
      onProgress: (p) => {
        progressLog.push({
          phase: p.phase,
          index: p.paragraphIndex,
          total: p.paragraphTotal,
          words: p.wordCount,
        });
      },
    }
  );

  const elapsedMs = Date.now() - started;
  const translateCalls = calls.filter((c) => c.intent === 'translate');
  const rateCalls = calls.filter((c) => c.intent === 'rate_article');

  assert.ok(result.wordCount >= IMPORT_LIMITS.TEN_THOUSAND_WORDS, `result.wordCount=${result.wordCount}`);
  assert.equal(translateCalls.length, result.paragraphTranslations.length);
  assert.ok(translateCalls.length >= 100, `translateCalls=${translateCalls.length}`);
  assert.equal(rateCalls.length, 1);
  assert.equal(result.level, 'C1');
  assert.equal(result.levelRating.difficultyScore, 72);
  assert.equal(
    result.ratingTruncated,
    false,
    `10k words should fit in ${IMPORT_LIMITS.MAX_RATING_CHARS} char rating budget (chars=${result.charCount})`
  );

  // Every translate payload must be within message limit
  for (const call of translateCalls) {
    assert.ok(String(call.message || '').length <= IMPORT_LIMITS.MAX_CHARS_PER_PARAGRAPH);
    assert.equal(typeof call.paragraphIndex, 'number');
    assert.equal(typeof call.paragraphTotal, 'number');
  }

  // Rating body should cover most of the article
  const ratingCtx = String(rateCalls[0].articleContext || '');
  assert.ok(countWords(ratingCtx) >= IMPORT_LIMITS.TEN_THOUSAND_WORDS * 0.9);

  // Progress must visit translating → rating → done
  const phases = progressLog.map((p) => p.phase);
  assert.ok(phases.includes('translating'));
  assert.ok(phases.includes('rating'));
  assert.ok(phases.includes('done'));
  assert.equal(progressLog.at(-1)?.phase, 'done');
  assert.equal(progressLog.at(-1)?.total, translateCalls.length);

  // Mock path should finish in reasonable time even for 100+ sequential calls
  assert.ok(elapsedMs < 30_000, `enrichment too slow: ${elapsedMs}ms`);

  // Persist alignment: content length matches translation length after apply
  const draft: Article = {
    id: '10k-test',
    title: '万字压测样文',
    description: 'stress',
    date: 'Jan 1, 2026',
    status: 'In Progress',
    source: 'user_input',
    content: paragraphs,
  };
  const applied = applyEnrichmentToArticle(draft, result);
  assert.equal(applied.content.length, applied.paragraphTranslations?.length);
  assert.equal(applied.level, 'C1');
  assert.ok(applied.levelRating?.summary.includes('万字') || applied.levelRating?.summary.length);
});

test('enrichArticleOnImport continues when some paragraph translations fail', async () => {
  // Enough paragraphs that failures on every 3rd still leave successes + rating.
  const { paragraphs } = buildTenThousandWordArticle(400, 40);
  let n = 0;
  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { intent: string };
    if (body.intent === 'translate') {
      n += 1;
      if (n % 3 === 0) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: 'TUTOR_FAILED', message: 'timeout' } }),
          { status: 500 }
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: { originalText: 'x', translatedText: '译', targetLanguage: 'Chinese' },
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        intent: 'rate_article',
        result: { level: 'B1', difficultyScore: 40, summary: 'ok' },
      }),
      { status: 200 }
    );
  };

  const result = await enrichArticleOnImport(
    { title: 'partial-fail', content: paragraphs },
    { fetcher: fetcher as typeof fetch }
  );

  assert.ok(result.paragraphTranslations.some((t) => t.includes('翻译失败')));
  assert.ok(result.paragraphTranslations.some((t) => t === '译'));
  assert.equal(result.level, 'B1');
});
