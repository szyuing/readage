/**
 * Background article import queue (module: translate + CEFR rate).
 *
 * Strategy D: callers store/open articles immediately; this queue enriches
 * them serially in the background. Multiple articles can be enqueued;
 * only one runs at a time (article-level concurrency = 1).
 */

import type { Article } from '../../types';
import {
  applyEnrichmentToArticle,
  enrichArticleOnImport,
  needsImportEnrichment,
  type EnrichProgress,
  type EnrichResult,
} from './enrichment';

export type ImportJobStatus = 'queued' | 'processing' | 'done' | 'failed' | 'cancelled';

/** Why the article entered the import module. */
export type ImportJobSource =
  | 'manual'
  | 'magazine'
  | 'recommend'
  | 'history'
  | 'retry'
  | 'resume';

export interface ImportJob {
  id: string;
  articleId: string;
  title: string;
  content: string[];
  status: ImportJobStatus;
  source: ImportJobSource;
  progress: EnrichProgress | null;
  error?: string;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ImportQueueSnapshot {
  jobs: ImportJob[];
  /** Jobs waiting or running. */
  pendingCount: number;
  /** Currently processing job, if any. */
  active: ImportJob | null;
  isProcessing: boolean;
  /** Short banner string for global UI. */
  bannerMessage: string | null;
}

export interface ImportCompletePayload {
  articleId: string;
  article: Article;
  enrichment: EnrichResult;
}

export type ImportQueueListener = (snapshot: ImportQueueSnapshot) => void;

export interface ArticleImportQueueOptions {
  /** Injected for tests. */
  fetcher?: typeof fetch;
  targetLanguage?: string;
  /**
   * Called when a job finishes successfully so the host can merge into history.
   * Must be set before processing usefully updates app state.
   */
  onComplete?: (payload: ImportCompletePayload) => void;
  /** Called when a job fails after retries exhausted (currently no retry). */
  onFailed?: (articleId: string, error: string) => void;
  /** Called when a job starts so host can mark article status. */
  onStarted?: (articleId: string) => void;
}

function cloneJobs(jobs: ImportJob[]): ImportJob[] {
  return jobs.map((job) => ({
    ...job,
    progress: job.progress ? { ...job.progress } : null,
  }));
}

export class ArticleImportQueue {
  private jobs: ImportJob[] = [];
  private pumping = false;
  private listeners = new Set<ImportQueueListener>();
  private options: ArticleImportQueueOptions = {};
  /** Prevent double-enqueue of the same article while active/queued. */
  private activeIds = new Set<string>();
  /** Soft-cancel set so in-flight jobs can exit without TS status narrowing issues. */
  private cancelledIds = new Set<string>();

  configure(options: ArticleImportQueueOptions): void {
    this.options = { ...this.options, ...options };
  }

  subscribe(listener: ImportQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ImportQueueSnapshot {
    const jobs = cloneJobs(this.jobs);
    const active = jobs.find((j) => j.status === 'processing') ?? null;
    const pendingCount = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;
    let bannerMessage: string | null = null;
    if (active) {
      const detail = active.progress?.message || '后台处理中…';
      const queueTail = pendingCount > 1 ? ` · 队列 ${pendingCount} 篇` : '';
      bannerMessage = `导入模块 · 《${active.title}》 ${detail}${queueTail}`;
    } else if (pendingCount > 0) {
      bannerMessage = `导入模块 · 队列中 ${pendingCount} 篇待处理`;
    }
    return {
      jobs,
      pendingCount,
      active,
      isProcessing: Boolean(active),
      bannerMessage,
    };
  }

  /** True if article is queued or currently processing. */
  isInFlight(articleId: string): boolean {
    return this.activeIds.has(articleId);
  }

  getJob(articleId: string): ImportJob | undefined {
    return this.jobs.find((j) => j.articleId === articleId);
  }

  /**
   * Enqueue enrichment for an article if needed.
   * Returns true when a new job was added (or already in flight).
   */
  enqueue(
    article: Article,
    source: ImportJobSource = 'manual'
  ): { enqueued: boolean; reason: string } {
    if (!article?.id || !article.content?.length) {
      return { enqueued: false, reason: 'invalid_article' };
    }
    if (!needsImportEnrichment(article)) {
      return { enqueued: false, reason: 'already_enriched' };
    }
    if (this.activeIds.has(article.id)) {
      return { enqueued: true, reason: 'already_in_queue' };
    }

    const job: ImportJob = {
      id: `import-${article.id}-${Date.now()}`,
      articleId: article.id,
      title: article.title || 'Untitled',
      content: [...article.content],
      status: 'queued',
      source,
      progress: {
        phase: 'idle',
        paragraphIndex: 0,
        paragraphTotal: article.content.length,
        message: '已加入导入队列',
      },
      enqueuedAt: new Date().toISOString(),
    };

    this.jobs = [job, ...this.jobs].slice(0, 80);
    this.activeIds.add(article.id);
    this.emit();
    void this.pump();
    return { enqueued: true, reason: 'queued' };
  }

  /** Enqueue many articles (serial processing). */
  enqueueMany(articles: Article[], source: ImportJobSource = 'magazine'): number {
    let n = 0;
    for (const article of articles) {
      const result = this.enqueue(article, source);
      if (result.enqueued && result.reason === 'queued') n += 1;
    }
    return n;
  }

  /**
   * Re-queue history items that still need enrichment (e.g. after reload).
   * Skips articles already in flight.
   */
  resumePending(articles: Article[]): number {
    return this.enqueueMany(
      articles.filter((a) => needsImportEnrichment(a)),
      'resume'
    );
  }

  cancel(articleId: string): boolean {
    const job = this.jobs.find(
      (j) => j.articleId === articleId && (j.status === 'queued' || j.status === 'processing')
    );
    if (!job) return false;
    this.cancelledIds.add(articleId);
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    this.activeIds.delete(articleId);
    this.emit();
    return true;
  }

  retry(article: Article): { enqueued: boolean; reason: string } {
    // Allow retry even if last job failed: clear in-flight gate if only failed jobs remain.
    if (this.activeIds.has(article.id)) {
      const inflight = this.jobs.find(
        (j) => j.articleId === article.id && (j.status === 'queued' || j.status === 'processing')
      );
      if (inflight) return { enqueued: true, reason: 'already_in_queue' };
      this.activeIds.delete(article.id);
    }
    return this.enqueue(article, 'retry');
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listeners must not break the queue.
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (true) {
        const next = this.jobs.find((j) => j.status === 'queued');
        if (!next) break;
        await this.runJob(next);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async runJob(job: ImportJob): Promise<void> {
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    job.progress = {
      phase: 'translating',
      paragraphIndex: 0,
      paragraphTotal: job.content.length,
      message: '准备逐段翻译…',
    };
    this.emit();
    this.options.onStarted?.(job.articleId);

    try {
      const enrichment = await enrichArticleOnImport(
        { title: job.title, content: job.content },
        {
          targetLanguage: this.options.targetLanguage || 'Chinese',
          fetcher: this.options.fetcher,
          onProgress: (progress) => {
            if (this.cancelledIds.has(job.articleId)) return;
            job.progress = progress;
            this.emit();
          },
        }
      );

      if (this.cancelledIds.has(job.articleId)) {
        this.cancelledIds.delete(job.articleId);
        this.activeIds.delete(job.articleId);
        this.emit();
        return;
      }

      const base: Article = {
        id: job.articleId,
        title: job.title,
        description: '',
        date: '',
        status: 'In Progress',
        content: job.content,
      };
      const article = applyEnrichmentToArticle(base, enrichment);
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      job.progress = {
        phase: 'done',
        paragraphIndex: job.content.length,
        paragraphTotal: job.content.length,
        message: '翻译与评级完成',
        wordCount: enrichment.wordCount,
        charCount: enrichment.charCount,
      };
      this.activeIds.delete(job.articleId);
      this.emit();
      this.options.onComplete?.({
        articleId: job.articleId,
        article: {
          ...article,
          importEnrichmentStatus: 'ready',
        },
        enrichment,
      });
    } catch (error) {
      if (this.cancelledIds.has(job.articleId)) {
        this.cancelledIds.delete(job.articleId);
        this.activeIds.delete(job.articleId);
        this.emit();
        return;
      }
      const message = error instanceof Error ? error.message : '导入 enrichment 失败';
      job.status = 'failed';
      job.error = message;
      job.finishedAt = new Date().toISOString();
      job.progress = {
        phase: 'error',
        paragraphIndex: 0,
        paragraphTotal: job.content.length,
        message: `失败：${message}`,
      };
      this.activeIds.delete(job.articleId);
      this.emit();
      this.options.onFailed?.(job.articleId, message);
    }
  }
}

/** App-wide singleton import module queue. */
let sharedQueue: ArticleImportQueue | null = null;

export function getArticleImportQueue(): ArticleImportQueue {
  if (!sharedQueue) sharedQueue = new ArticleImportQueue();
  return sharedQueue;
}

/** Test helper: replace singleton. */
export function __setArticleImportQueueForTests(queue: ArticleImportQueue | null): void {
  sharedQueue = queue;
}
