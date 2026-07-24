import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARTICLE_IMPORT_CONCURRENCY,
  ArticleImportQueue,
  needsImportEnrichment,
} from '../src/lib/articleImport';
import type { Article } from '../src/types';

function mockFetcher(calls: unknown[]) {
  return async (_url: string, init?: RequestInit) => {
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
            translations: paragraphs.map((p) => `译:${p}`),
          },
        }),
        { status: 200 }
      );
    }
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

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function gatedFetcher(gates: Map<string, ReturnType<typeof createDeferred>>) {
  return async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      intent: string;
      message?: string;
      paragraphs?: string[];
      topic?: string;
    };
    const gate = gates.get(body.topic || '');
    if (gate) await gate.promise;

    if (body.intent === 'translate_article') {
      const paragraphs = body.paragraphs || [];
      return new Response(
        JSON.stringify({
          ok: true,
          intent: 'translate_article',
          result: { translations: paragraphs.map((paragraph) => `?:${paragraph}`) },
        }),
        { status: 200 }
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
    return new Response(
      JSON.stringify({
        ok: true,
        intent: 'rate_article',
        result: { level: 'B1', difficultyScore: 40, summary: 'ok' },
      }),
      { status: 200 }
    );
  };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

test('queue processes multiple articles and invokes onComplete for each', async () => {
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

  for (let i = 0; i < 50 && completed.length < 2; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(new Set(completed).size, 2);
  assert.ok(completed.includes('a1'));
  assert.ok(completed.includes('a2'));
  const fullCount = calls.filter((c) => (c as { intent: string }).intent === 'translate_article').length;
  assert.equal(fullCount, 2);
  assert.equal(
    calls.filter((c) => (c as { intent: string }).intent === 'rate_article').length,
    2
  );
  assert.equal(queue.getSnapshot().pendingCount, 0);
  assert.equal(queue.isInFlight('a1'), false);
});

test('queue runs up to configured article concurrency', async () => {
  assert.equal(ARTICLE_IMPORT_CONCURRENCY, 2);

  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  const completed: string[] = [];

  const queue = new ArticleImportQueue();
  queue.configure({
    concurrency: 2,
    fetcher: (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        intent: string;
        paragraphs?: string[];
        topic?: string;
      };
      if (body.intent === 'translate_article') {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 40));
        inFlight -= 1;
        const paragraphs = body.paragraphs || ['x'];
        return new Response(
          JSON.stringify({
            ok: true,
            intent: 'translate_article',
            result: { translations: paragraphs.map(() => '译') },
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
    onStarted: (id) => {
      started.push(id);
    },
    onComplete: ({ articleId }) => {
      completed.push(articleId);
    },
  });

  // Enqueue 5 articles — only 2 should run at once
  for (let i = 1; i <= 5; i += 1) {
    queue.enqueue(makeArticle(`c${i}`, [`Paragraph for article ${i}.`]), 'magazine');
  }

  // Shortly after enqueue, up to 2 should be processing
  await new Promise((r) => setTimeout(r, 15));
  const mid = queue.getSnapshot();
  assert.ok(mid.activeJobs.length <= 2, `activeJobs=${mid.activeJobs.length}`);
  assert.ok(mid.activeJobs.length >= 1);
  assert.equal(mid.concurrency, 2);

  for (let i = 0; i < 80 && completed.length < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.equal(completed.length, 5);
  assert.ok(maxInFlight <= 2, `maxInFlight=${maxInFlight}`);
  assert.ok(maxInFlight >= 1, `expected concurrent articles, maxInFlight=${maxInFlight}`);
  assert.equal(queue.getSnapshot().pendingCount, 0);
  assert.ok(queue.getSnapshot().bannerMessage === null || !queue.getSnapshot().isProcessing);
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
      const body = JSON.parse(String(init?.body || '{}')) as {
        intent: string;
        message?: string;
        paragraphs?: string[];
      };
      calls.push(body);
      if (body.intent === 'translate_article') {
        await gate;
        const paragraphs = body.paragraphs || ['x'];
        return new Response(
          JSON.stringify({
            ok: true,
            intent: 'translate_article',
            result: { translations: paragraphs.map(() => '译') },
          }),
          { status: 200 }
        );
      }
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


for (const count of [81, 100]) {
  test(`enqueue retains all ${count} queued or processing jobs`, async () => {
    const firstGate = createDeferred();
    const queue = new ArticleImportQueue();
    queue.configure({
      concurrency: 1,
      fetcher: gatedFetcher(new Map([['Title bulk-0', firstGate]])) as typeof fetch,
    });

    for (let i = 0; i < count; i += 1) {
      queue.enqueue(makeArticle(`bulk-${i}`, [`Paragraph ${i}.`]), 'magazine');
    }

    const snapshot = queue.getSnapshot();
    queue.cancelAll();
    firstGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const pendingJobs = snapshot.jobs.filter(
      (job) => job.status === 'queued' || job.status === 'processing'
    );
    assert.equal(pendingJobs.length, count);
    assert.equal(snapshot.pendingCount, count);
    assert.equal(snapshot.jobs.some((job) => job.articleId === 'bulk-0'), true);
  });
}

test('cancelAll keeps the running slot occupied until its late promise settles', async () => {
  const firstGate = createDeferred();
  const thirdGate = createDeferred();
  const fourthGate = createDeferred();
  const started: string[] = [];
  const queue = new ArticleImportQueue();
  queue.configure({
    concurrency: 1,
    fetcher: gatedFetcher(
      new Map([
        ['Title cancel-first', firstGate],
        ['Title cancel-third', thirdGate],
        ['Title cancel-fourth', fourthGate],
      ])
    ) as typeof fetch,
    onStarted: (articleId) => started.push(articleId),
  });

  queue.enqueue(makeArticle('cancel-first', ['First.']), 'manual');
  queue.enqueue(makeArticle('cancel-second', ['Second.']), 'manual');
  await waitFor(() => started.includes('cancel-first'), 'first cancelled job did not start');

  assert.equal(queue.cancelAll(), 2);
  queue.enqueue(makeArticle('cancel-third', ['Third.']), 'manual');
  queue.enqueue(makeArticle('cancel-fourth', ['Fourth.']), 'manual');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ['cancel-first']);

  firstGate.resolve();
  await waitFor(() => started.includes('cancel-third'), 'third job did not start after late settle');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ['cancel-first', 'cancel-third']);

  thirdGate.resolve();
  await waitFor(() => started.includes('cancel-fourth'), 'fourth job did not wait for third');
  fourthGate.resolve();
  await waitFor(() => queue.getSnapshot().pendingCount === 0, 'cancel regression queue did not drain');
});

test('failStaleJobs does not free a slot or let a late promise overwrite failure', async () => {
  const firstGate = createDeferred();
  const secondGate = createDeferred();
  const started: string[] = [];
  const completed: string[] = [];
  const queue = new ArticleImportQueue();
  queue.configure({
    concurrency: 1,
    fetcher: gatedFetcher(
      new Map([
        ['Title stale-first', firstGate],
        ['Title stale-second', secondGate],
      ])
    ) as typeof fetch,
    onStarted: (articleId) => started.push(articleId),
    onComplete: ({ articleId }) => completed.push(articleId),
  });

  queue.enqueue(makeArticle('stale-first', ['First.']), 'manual');
  queue.enqueue(makeArticle('stale-second', ['Second.']), 'manual');
  await waitFor(() => started.includes('stale-first'), 'first stale job did not start');

  assert.equal(queue.failStaleJobs(0), 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ['stale-first']);
  assert.equal(queue.getJob('stale-first')?.status, 'failed');

  firstGate.resolve();
  await waitFor(() => started.includes('stale-second'), 'second job did not start after stale settle');
  assert.equal(queue.getJob('stale-first')?.status, 'failed');
  assert.equal(completed.includes('stale-first'), false);

  secondGate.resolve();
  await waitFor(() => queue.getSnapshot().pendingCount === 0, 'stale regression queue did not drain');
});
