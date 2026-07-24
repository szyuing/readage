import assert from 'node:assert/strict';
import test from 'node:test';

import { ArticleImportQueue, needsImportEnrichment } from '../src/lib/articleImport';
import type { Article } from '../src/types';

function mockFetcher(calls: unknown[]) {
  return async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { intent: string; message?: string };
    calls.push(body);
    if (body.intent === 'translate') {
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate',
          result: {
            originalText: body.message,
            translatedText: `译:${body.message}`,
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
          result: {
            level: 'B1',
            difficultyScore: 40,
            summary: '测试评级',
          },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: 'X', message: 'bad' } }), {
      status: 400,
    });
  };
}

function makeArticle(id: string, paragraphs: string[]): Article {
  return {
    id,
    title: `Title ${id}`,
    description: 'd',
    date: 'Jan 1, 2026',
    status: 'In Progress',
    content: paragraphs,
    source: 'user_input',
    importEnrichmentStatus: 'pending',
  };
}

test('queue processes articles serially and invokes onComplete for each', async () => {
  const calls: unknown[] = [];
  const completed: string[] = [];
  const queue = new ArticleImportQueue();
  queue.configure({
    fetcher: mockFetcher(calls) as typeof fetch,
    onComplete: ({ articleId, article }) => {
      completed.push(articleId);
      assert.equal(article.importEnrichmentStatus, 'ready');
      assert.ok(article.paragraphTranslations?.length);
      assert.equal(article.level, 'B1');
    },
  });

  const a = makeArticle('a1', ['Hello one.', 'Hello two.']);
  const b = makeArticle('a2', ['Second article paragraph.']);

  assert.equal(needsImportEnrichment(a), true);
  queue.enqueue(a, 'manual');
  queue.enqueue(b, 'magazine');

  // Wait for pump to drain
  for (let i = 0; i < 50 && completed.length < 2; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.deepEqual(completed, ['a1', 'a2']);
  const translateCount = calls.filter((c) => (c as { intent: string }).intent === 'translate').length;
  assert.equal(translateCount, 3);
  assert.equal(
    calls.filter((c) => (c as { intent: string }).intent === 'rate_article').length,
    2
  );
  assert.equal(queue.getSnapshot().pendingCount, 0);
  assert.equal(queue.isInFlight('a1'), false);
});

test('enqueue skips already enriched articles', () => {
  const queue = new ArticleImportQueue();
  const article = makeArticle('ready', ['Done.']);
  article.paragraphTranslations = ['完成。'];
  article.levelRating = { level: 'A2', difficultyScore: 20, summary: '易' };
  const result = queue.enqueue(article, 'manual');
  assert.equal(result.enqueued, false);
  assert.equal(result.reason, 'already_enriched');
});

test('duplicate enqueue while in flight is idempotent', async () => {
  const calls: unknown[] = [];
  const queue = new ArticleImportQueue();
  let resolveTranslate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    resolveTranslate = resolve;
  });

  queue.configure({
    fetcher: (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { intent: string; message?: string };
      calls.push(body);
      if (body.intent === 'translate') {
        await gate;
        return new Response(
          JSON.stringify({
            ok: true,
            intent: 'translate',
            result: {
              originalText: body.message,
              translatedText: '译',
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
          result: { level: 'B1', difficultyScore: 40, summary: 'ok' },
        }),
        { status: 200 }
      );
    }) as typeof fetch,
  });

  const article = makeArticle('dup', ['Only one.']);
  const first = queue.enqueue(article, 'manual');
  const second = queue.enqueue(article, 'manual');
  assert.equal(first.reason, 'queued');
  assert.equal(second.reason, 'already_in_queue');
  assert.equal(queue.getSnapshot().jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length, 1);

  resolveTranslate?.();
  for (let i = 0; i < 50 && queue.getSnapshot().pendingCount > 0; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(queue.getSnapshot().pendingCount, 0);
});
