import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMPORT_LIMITS,
  applyEnrichmentToArticle,
  enrichArticleOnImport,
  mapPool,
  needsImportEnrichment,
  splitArticleParagraphs,
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

test('planImportEnrichment only requests missing steps', async () => {
  const { planImportEnrichment, hasCompleteParagraphTranslations, hasOfficialLevelRating } =
    await import('../src/lib/articleImport');

  const base = {
    content: ['Hello world.', 'Second paragraph.'],
  };

  const none = planImportEnrichment(base);
  assert.equal(none.needTranslation, true);
  assert.equal(none.needRating, true);

  const withRating = {
    ...base,
    levelRating: { level: 'B2' as const, difficultyScore: 55, summary: '已有评级' },
  };
  const translateOnly = planImportEnrichment(withRating);
  assert.equal(translateOnly.needTranslation, true);
  assert.equal(translateOnly.needRating, false);
  assert.equal(translateOnly.existingLevelRating?.level, 'B2');
  assert.equal(hasOfficialLevelRating(withRating), true);

  const withTranslations = {
    ...base,
    paragraphTranslations: ['你好。', '第二段。'],
  };
  const rateOnly = planImportEnrichment(withTranslations);
  assert.equal(rateOnly.needTranslation, false);
  assert.equal(rateOnly.needRating, true);
  assert.equal(hasCompleteParagraphTranslations(withTranslations), true);

  const done = planImportEnrichment({
    ...base,
    paragraphTranslations: ['你好。', '第二段。'],
    levelRating: { level: 'B1', difficultyScore: 40, summary: 'ok' },
  });
  assert.equal(done.needTranslation, false);
  assert.equal(done.needRating, false);
});

test('mapPool respects concurrency and preserves order', async () => {
  assert.equal(IMPORT_LIMITS.TRANSLATE_CONCURRENCY, 4);
  assert.equal(IMPORT_LIMITS.MAX_FULL_ARTICLE_TRANSLATE_CHARS, 120_000);
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [0, 1, 2, 3, 4, 5, 6, 7];
  const results = await mapPool(items, 4, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(results, [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.ok(maxInFlight <= 4, `maxInFlight=${maxInFlight}`);
  assert.ok(maxInFlight >= 2, 'expected some parallelism');
});

test('enrichArticleOnImport prefers full-article translate then rates', async () => {
  const calls: unknown[] = [];

  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      intent: string;
      message?: string;
      paragraphs?: string[];
    };
    calls.push(body);
    if (body.intent === 'translate_article') {
      const paragraphs = body.paragraphs || [];
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate_article',
          result: {
            translations: paragraphs.map((p) => `译：${p}`),
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
  const paragraphs = [
    'Hello one.',
    'Hello two.',
    'Hello three.',
    'Hello four.',
    'Hello five.',
    'Hello six.',
  ];
  const result = await enrichArticleOnImport(
    { title: 'Demo', content: paragraphs },
    {
      fetcher: fetcher as typeof fetch,
      onProgress: (p) => progress.push(p.phase),
    }
  );

  assert.equal(result.level, 'B2');
  assert.equal(result.translateMode, 'full_article');
  assert.equal(result.levelRating.difficultyScore, 58);
  assert.deepEqual(
    result.paragraphTranslations,
    paragraphs.map((p) => `译：${p}`)
  );
  assert.equal(calls.filter((c) => (c as { intent: string }).intent === 'translate_article').length, 1);
  assert.equal(calls.filter((c) => (c as { intent: string }).intent === 'translate').length, 0);
  assert.equal(calls.filter((c) => (c as { intent: string }).intent === 'rate_article').length, 1);
  // Translate + rate run in parallel when both are needed.
  assert.ok(progress.includes('parallel') || progress.includes('translating'));
  assert.ok(progress.includes('done'));
});

test('enrichArticleOnImport starts translate and rate concurrently', async () => {
  let translateStarted = false;
  let rateStarted = false;
  let bothInFlight = false;
  let translateInFlight = false;
  let rateInFlight = false;

  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      intent: string;
      paragraphs?: string[];
    };
    if (body.intent === 'translate_article') {
      translateStarted = true;
      translateInFlight = true;
      if (rateInFlight) bothInFlight = true;
      await new Promise((r) => setTimeout(r, 40));
      translateInFlight = false;
      const paragraphs = body.paragraphs || [];
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate_article',
          result: { translations: paragraphs.map((p) => `译：${p}`) },
        }),
        { status: 200 }
      );
    }
    if (body.intent === 'rate_article') {
      rateStarted = true;
      rateInFlight = true;
      if (translateInFlight) bothInFlight = true;
      await new Promise((r) => setTimeout(r, 40));
      rateInFlight = false;
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'rate_article',
          result: { level: 'B1', difficultyScore: 40, summary: '并行评级' },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: 'X', message: 'bad' } }), {
      status: 400,
    });
  };

  const result = await enrichArticleOnImport(
    { title: 'Parallel', content: ['Hello one.', 'Hello two.'] },
    { fetcher: fetcher as typeof fetch }
  );

  assert.equal(translateStarted, true);
  assert.equal(rateStarted, true);
  assert.equal(bothInFlight, true, 'translate and rate should overlap in flight');
  assert.equal(result.level, 'B1');
  assert.equal(result.translateMode, 'full_article');
});

test('enrichArticleOnImport falls back to paragraph pool when full-article mismatches', async () => {
  const calls: unknown[] = [];
  let translateInFlight = 0;
  let maxTranslateInFlight = 0;

  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      intent: string;
      message?: string;
      paragraphs?: string[];
    };
    calls.push(body);
    if (body.intent === 'translate_article') {
      // Wrong segment count → client falls back
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate_article',
          result: { translations: ['只有一段'] },
        }),
        { status: 200 }
      );
    }
    if (body.intent === 'translate') {
      translateInFlight += 1;
      maxTranslateInFlight = Math.max(maxTranslateInFlight, translateInFlight);
      await new Promise((r) => setTimeout(r, 15));
      translateInFlight -= 1;
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: {
            originalText: body.message,
            translatedText: `回退：${body.message}`,
            targetLanguage: 'Chinese',
          },
        }),
        { status: 200 }
      );
    }
    if (body.intent === 'rate_article') {
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'rate_article',
          result: { level: 'B1', difficultyScore: 40, summary: 'ok' },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: 'X', message: 'bad' } }), {
      status: 400,
    });
  };

  const paragraphs = ['A one.', 'A two.', 'A three.', 'A four.', 'A five.'];
  const result = await enrichArticleOnImport(
    { title: 'Fallback', content: paragraphs },
    { fetcher: fetcher as typeof fetch }
  );

  assert.equal(result.translateMode, 'paragraph_pool');
  assert.equal(result.paragraphTranslations.length, 5);
  assert.ok(result.paragraphTranslations[0].startsWith('回退：'));
  assert.equal(calls.filter((c) => (c as { intent: string }).intent === 'translate_article').length, 1);
  assert.equal(calls.filter((c) => (c as { intent: string }).intent === 'translate').length, 5);
  assert.ok(maxTranslateInFlight <= 4);
  assert.ok(maxTranslateInFlight >= 2);
  assert.equal(IMPORT_LIMITS.TRANSLATE_CONCURRENCY, 4);
});

test('article under 120k chars uses full-article even with many paragraphs', async () => {
  // Many short paragraphs but total chars well under 120k → must be full_article path.
  const paragraphs = Array.from({ length: 50 }, (_, i) => `Short paragraph number ${i + 1} about climate.`);
  let fullCalls = 0;
  let paraCalls = 0;
  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { intent: string; paragraphs?: string[] };
    if (body.intent === 'translate_article') {
      fullCalls += 1;
      const ps = body.paragraphs || [];
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate_article',
          result: { translations: ps.map((p) => `译:${p}`) },
        }),
        { status: 200 }
      );
    }
    if (body.intent === 'translate') {
      paraCalls += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: { originalText: 'x', translatedText: '段', targetLanguage: 'Chinese' },
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
    { title: 'Many paras', content: paragraphs },
    { fetcher: fetcher as typeof fetch, skipRating: true }
  );
  assert.equal(result.translateMode, 'full_article');
  assert.equal(fullCalls, 1);
  assert.equal(paraCalls, 0);
  assert.equal(result.paragraphTranslations.length, 50);
});

test('oversized article (>120k chars) skips full-article and uses 4-way paragraph pool', async () => {
  let fullArticleCalls = 0;
  let translateInFlight = 0;
  let maxTranslateInFlight = 0;

  // Build content that exceeds MAX_FULL_ARTICLE_TRANSLATE_CHARS without huge RAM:
  // many medium paragraphs whose total char count is just over the limit.
  const chunk = 'word '.repeat(200).trim(); // ~1000 chars
  const need = Math.ceil(IMPORT_LIMITS.MAX_FULL_ARTICLE_TRANSLATE_CHARS / chunk.length) + 2;
  const paragraphs = Array.from({ length: need }, (_, i) => `${chunk} para-${i}.`);

  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { intent: string; message?: string };
    if (body.intent === 'translate_article') {
      fullArticleCalls += 1;
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'X', message: 'should not call full' } }),
        { status: 400 }
      );
    }
    if (body.intent === 'translate') {
      translateInFlight += 1;
      maxTranslateInFlight = Math.max(maxTranslateInFlight, translateInFlight);
      await new Promise((r) => setTimeout(r, 5));
      translateInFlight -= 1;
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: {
            originalText: body.message,
            translatedText: '段译',
            targetLanguage: 'Chinese',
          },
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        intent: 'rate_article',
        result: { level: 'C1', difficultyScore: 70, summary: '长文' },
      }),
      { status: 200 }
    );
  };

  const result = await enrichArticleOnImport(
    { title: '超长', content: paragraphs },
    { fetcher: fetcher as typeof fetch, skipRating: true }
  );

  assert.equal(fullArticleCalls, 0);
  assert.equal(result.translateMode, 'paragraph_pool');
  assert.equal(result.paragraphTranslations.length, paragraphs.length);
  assert.ok(maxTranslateInFlight <= 4);
  assert.ok(maxTranslateInFlight >= 2, `expected 4-way pool, max=${maxTranslateInFlight}`);
});


test('enrichment preserves all 401 source paragraphs and keeps translations aligned', async () => {
  const paragraphs = Array.from(
    { length: IMPORT_LIMITS.MAX_PARAGRAPHS + 1 },
    (_, index) => `Source paragraph ${index + 1}.`
  );
  let fullArticleCalls = 0;

  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      intent: string;
      message?: string;
    };
    if (body.intent === 'translate_article') {
      fullArticleCalls += 1;
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'TOO_MANY_PARAGRAPHS', message: 'batch required' } }),
        { status: 400 }
      );
    }
    if (body.intent === 'translate') {
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: {
            originalText: body.message,
            translatedText: `?:${body.message}`,
            targetLanguage: 'Chinese',
          },
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected intent: ${body.intent}`);
  };

  const result = await enrichArticleOnImport(
    { title: '401 paragraphs', content: paragraphs },
    { fetcher: fetcher as typeof fetch, skipRating: true }
  );
  const article: Article = {
    id: '401-paragraphs',
    title: '401 paragraphs',
    description: 'regression',
    date: 'Jul 24, 2026',
    status: 'In Progress',
    source: 'user_input',
    content: paragraphs,
  };
  const applied = applyEnrichmentToArticle(article, result);

  assert.equal(fullArticleCalls, 0, 'more than 400 units must use the paragraph pool');
  assert.equal(result.translateMode, 'paragraph_pool');
  assert.equal(result.paragraphTranslations.length, paragraphs.length);
  assert.equal(result.paragraphTranslations.at(-1), `?:${paragraphs.at(-1)}`);
  assert.deepEqual(applied.content, paragraphs, 'enrichment must never replace or truncate source content');
  assert.equal(applied.paragraphTranslations?.length, applied.content.length);
});

test('split translation units are merged back onto their original paragraph', async () => {
  const longParagraph = `${'A complete sentence. '.repeat(400)}THE-END.`;
  const article: Article = {
    id: 'split-mapping',
    title: 'Split mapping',
    description: 'regression',
    date: 'Jul 24, 2026',
    status: 'In Progress',
    source: 'user_input',
    content: [longParagraph, 'Second original paragraph.'],
  };

  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      intent: string;
      paragraphs?: string[];
    };
    if (body.intent !== 'translate_article') throw new Error(`Unexpected intent: ${body.intent}`);
    return new Response(
      JSON.stringify({
        ok: true,
        intent: 'translate_article',
        result: { translations: (body.paragraphs || []).map((_, index) => `unit-${index + 1}`) },
      }),
      { status: 200 }
    );
  };

  const result = await enrichArticleOnImport(article, {
    fetcher: fetcher as typeof fetch,
    skipRating: true,
  });
  const applied = applyEnrichmentToArticle(article, result);

  assert.equal(result.paragraphsSplit, true);
  assert.deepEqual(applied.content, article.content);
  assert.equal(applied.paragraphTranslations?.length, article.content.length);
  assert.match(applied.paragraphTranslations?.[0] || '', /unit-1/);
  assert.match(applied.paragraphTranslations?.[0] || '', /unit-2/);
  assert.equal(applied.paragraphTranslations?.[1], `unit-${result.paragraphTranslations.length + 1}`);
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
    translateMode: 'full_article',
  });
  assert.equal(next.level, 'A2');
  assert.deepEqual(next.paragraphTranslations, ['一。']);
  assert.equal(next.levelRating?.level, 'A2');
});
