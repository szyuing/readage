/**
 * Background article import queue (module: translate + CEFR rate).
 *
 * Strategy D: callers store/open articles immediately; this queue enriches
 * them in the background. Multiple articles can be enqueued and up to
 * ARTICLE_CONCURRENCY (default 50) run at the same time.
 */

import type { Article } from '../../types';
import {
  applyEnrichmentToArticle,
  enrichArticleOnImport,
  needsImportEnrichment,
  planImportEnrichment,
  type EnrichProgress,
  type EnrichResult,
} from './enrichment';
import type { ArticleLevelRating } from '../../types';

export type ImportJobStatus = 'queued' | 'processing' | 'done' | 'failed' | 'cancelled';

/** Why the article entered the import module. */
export type ImportJobSource =
  | 'manual'
  | 'magazine'
  | 'recommend'
  | 'history'
  | 'retry'
  | 'resume';

/**
 * Max articles enriching at the same time.
 * DeepSeek Flash supports 2500 account-level requests; product target is 50 articles.
 */
export const ARTICLE_IMPORT_CONCURRENCY = 50;
export const ARTICLE_IMPORT_MAX_CONCURRENCY = 50;

/**
 * Hard cap per job. Without this, a hung LLM call leaves the banner stuck forever
 * (processing slots never free, waiting jobs never start).
 */
export const ARTICLE_IMPORT_JOB_TIMEOUT_MS = 6 * 60_000;

const TERMINAL_JOB_HISTORY_LIMIT = 80;

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
  /**
   * When set, import only translates — rating is already the article's sole CEFR
   * (e.g. user-chosen rewrite level, or a prior complete AI grade).
   * One article → one rating.
   */
  lockedLevelRating?: ArticleLevelRating;
  /** Skip translate when paragraph translations are already complete. */
  skipTranslation?: boolean;
  /** Preserve existing complete translations when skipTranslation is true. */
  existingTranslations?: string[];
}

export interface ImportQueueSnapshot {
  jobs: ImportJob[];
  /** Jobs waiting or running. */
  pendingCount: number;
  /** Jobs currently processing (up to ARTICLE_IMPORT_CONCURRENCY). */
  activeJobs: ImportJob[];
  /** First active job (compat for single-banner UIs). */
  active: ImportJob | null;
  isProcessing: boolean;
  /** Short banner string for global UI. */
  bannerMessage: string | null;
  /** Configured article concurrency. */
  concurrency: number;
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
  /** Override article concurrency (default ARTICLE_IMPORT_CONCURRENCY = 50). */
  concurrency?: number;
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

function isTerminalStatus(status: ImportJobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

export class ArticleImportQueue {
  private jobs: ImportJob[] = [];
  /** Number of runJob promises currently in flight. */
  private inFlight = 0;
  private listeners = new Set<ImportQueueListener>();
  private options: ArticleImportQueueOptions = {};
  /** Prevent double-enqueue of the same article while active/queued. */
  private activeIds = new Set<string>();
  /** Soft-cancel set so in-flight jobs can exit without clobbering a later retry. */
  private cancelledJobs = new Set<ImportJob>();

  configure(options: ArticleImportQueueOptions): void {
    this.options = { ...this.options, ...options };
  }

  get concurrency(): number {
    const n = this.options.concurrency ?? ARTICLE_IMPORT_CONCURRENCY;
    return Math.max(1, Math.min(ARTICLE_IMPORT_MAX_CONCURRENCY, Math.floor(n)));
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
    const activeJobs = jobs.filter((j) => j.status === 'processing');
    const active = activeJobs[0] ?? null;
    const pendingCount = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;
    const concurrency = this.concurrency;

    let bannerMessage: string | null = null;
    if (activeJobs.length > 0) {
      if (activeJobs.length === 1) {
        const detail = activeJobs[0].progress?.message || '后台处理中…';
        const queueTail = pendingCount > 1 ? ` · 队列 ${pendingCount} 篇` : '';
        bannerMessage = `导入模块 · 《${activeJobs[0].title}》 ${detail}${queueTail}`;
      } else {
        const titles = activeJobs
          .slice(0, 3)
          .map((j) => `《${j.title}》`)
          .join('、');
        const more = activeJobs.length > 3 ? ` 等 ${activeJobs.length} 篇` : '';
        const waiting = pendingCount - activeJobs.length;
        const waitTail = waiting > 0 ? ` · 等待 ${waiting} 篇` : '';
        bannerMessage = `导入模块 · ${concurrency} 篇并发中：${titles}${more}${waitTail}`;
      }
    } else if (pendingCount > 0) {
      bannerMessage = `导入模块 · 队列中 ${pendingCount} 篇待处理`;
    }

    return {
      jobs,
      pendingCount,
      activeJobs,
      active,
      isProcessing: activeJobs.length > 0,
      bannerMessage,
      concurrency,
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
   * Only runs missing steps (translate and/or rate); preserves complete fields.
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

    const plan = planImportEnrichment(article);
    // Any complete official grade is locked — never produce a second CEFR.
    const lockedLevelRating = plan.existingLevelRating;
    const skipTranslation = !plan.needTranslation;
    const existingTranslations = plan.existingTranslations
      ? [...plan.existingTranslations]
      : undefined;

    let queueMessage = '已加入导入队列（译文 + 评级）';
    if (skipTranslation && lockedLevelRating) {
      queueMessage = '已齐全，跳过';
    } else if (skipTranslation) {
      queueMessage = '已加入队列（译文已有，仅 CEFR 评级）';
    } else if (lockedLevelRating) {
      queueMessage = `已加入队列（评级已锁定 ${lockedLevelRating.level}，仅翻译）`;
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
        message: queueMessage,
      },
      enqueuedAt: new Date().toISOString(),
      lockedLevelRating,
      skipTranslation,
      existingTranslations,
    };

    this.jobs = [job, ...this.jobs];
    this.trimTerminalHistory();
    this.activeIds.add(article.id);
    this.emit();
    this.pump();
    return { enqueued: true, reason: 'queued' };
  }

  /** Enqueue many articles (processed with article-level concurrency). */
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
   * Includes previously failed jobs; skips articles already in flight.
   */
  resumePending(articles: Article[]): number {
    let n = 0;
    for (const article of articles.filter((a) => needsImportEnrichment(a))) {
      // Failed / cancelled leftover gates must not block a fresh resume.
      if (this.activeIds.has(article.id)) {
        const inflight = this.jobs.find(
          (j) =>
            j.articleId === article.id
            && (j.status === 'queued' || j.status === 'processing')
        );
        if (inflight) continue;
        this.activeIds.delete(article.id);
      }
      const result = this.enqueue(article, 'resume');
      if (result.enqueued && result.reason === 'queued') n += 1;
    }
    return n;
  }

  cancel(articleId: string): boolean {
    const job = this.jobs.find(
      (j) => j.articleId === articleId && (j.status === 'queued' || j.status === 'processing')
    );
    if (!job) return false;
    if (job.status === 'processing') this.cancelledJobs.add(job);
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    this.activeIds.delete(articleId);
    this.trimTerminalHistory();
    this.emit();
    this.pump();
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

  private trimTerminalHistory(): void {
    let terminalCount = 0;
    this.jobs = this.jobs.filter((job) => {
      if (!isTerminalStatus(job.status)) return true;
      terminalCount += 1;
      return terminalCount <= TERMINAL_JOB_HISTORY_LIMIT;
    });
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

  /**
   * Fill free slots up to `concurrency` with queued jobs.
   * Each job runs independently; completion frees a slot and pumps again.
   */
  private pump(): void {
    const limit = this.concurrency;
    while (this.inFlight < limit) {
      const next = this.jobs.find((j) => j.status === 'queued');
      if (!next) break;
      this.inFlight += 1;
      // Mark processing immediately so the next loop iteration picks another job.
      next.status = 'processing';
      next.startedAt = new Date().toISOString();
      next.progress = {
        phase: 'translating',
        paragraphIndex: 0,
        paragraphTotal: next.content.length,
        message: '准备翻译…',
      };
      this.emit();
      this.options.onStarted?.(next.articleId);

      void this.runJob(next).finally(() => {
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.pump();
      });
    }
  }

  private async runJob(job: ImportJob): Promise<void> {
    // status already set to processing in pump()
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      if (job.status !== 'processing') return;
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      const baseMsg = job.progress?.message?.replace(/\s·\s已耗时\s\d+s$/, '') || '处理中…';
      job.progress = {
        phase: job.progress?.phase || 'translating',
        paragraphIndex: job.progress?.paragraphIndex ?? 0,
        paragraphTotal: job.progress?.paragraphTotal ?? job.content.length,
        message: `${baseMsg} · 已耗时 ${elapsedSec}s`,
        wordCount: job.progress?.wordCount,
        charCount: job.progress?.charCount,
      };
      this.emit();
    }, 5_000);

    let jobTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const skipRating = Boolean(job.lockedLevelRating);
      const skipTranslation = Boolean(job.skipTranslation);
      const enrichment = await Promise.race([
        enrichArticleOnImport(
          { title: job.title, content: job.content },
          {
            targetLanguage: this.options.targetLanguage || 'Chinese',
            fetcher: this.options.fetcher,
            // Only run missing steps (preserve complete translations / locked CEFR).
            skipRating,
            skipTranslation,
            onProgress: (progress) => {
              if (this.cancelledJobs.has(job)) return;
              // Ignore late progress after this job already left processing.
              if (job.status !== 'processing') return;
              const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
              job.progress = {
                ...progress,
                message: `${progress.message} · 已耗时 ${elapsedSec}s`,
              };
              this.emit();
            },
          }
        ),
        new Promise<never>((_, reject) => {
          jobTimeoutId = setTimeout(() => {
            reject(
              new Error(
                `导入超时（${Math.round(ARTICLE_IMPORT_JOB_TIMEOUT_MS / 1000)}s）：《${job.title}》`
              )
            );
          }, ARTICLE_IMPORT_JOB_TIMEOUT_MS);
        }),
      ]);
      if (jobTimeoutId) clearTimeout(jobTimeoutId);

      if (this.cancelledJobs.has(job)) {
        this.cancelledJobs.delete(job);
        return;
      }
      // A stale-job watchdog may have finalized this job while its request was still running.
      if (job.status !== 'processing') return;

      const base: Article = {
        id: job.articleId,
        title: job.title,
        description: '',
        date: '',
        status: 'In Progress',
        content: job.content,
      };
      let article = applyEnrichmentToArticle(base, enrichment);
      // Restore already-complete fields that were intentionally skipped.
      if (skipTranslation && job.existingTranslations?.length) {
        article = {
          ...article,
          paragraphTranslations: [...job.existingTranslations],
        };
      }
      if (job.lockedLevelRating) {
        article = {
          ...article,
          levelRating: job.lockedLevelRating,
          level: job.lockedLevelRating.level,
        };
      }
      const doneParts =
        skipTranslation && skipRating
          ? '无需处理'
          : skipTranslation
            ? '评级完成（译文已有）'
            : skipRating
              ? '翻译完成（评级已锁定）'
              : '翻译与评级完成';
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      job.progress = {
        phase: 'done',
        paragraphIndex: job.content.length,
        paragraphTotal: job.content.length,
        message: doneParts,
        wordCount: enrichment.wordCount,
        charCount: enrichment.charCount,
      };
      this.activeIds.delete(job.articleId);
      this.trimTerminalHistory();
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
      if (jobTimeoutId) clearTimeout(jobTimeoutId);
      if (this.cancelledJobs.has(job)) {
        this.cancelledJobs.delete(job);
        return;
      }
      // Already finished by another path (e.g. cancelAll) — do not clobber.
      if (job.status !== 'processing') return;
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
      this.trimTerminalHistory();
      this.emit();
      this.options.onFailed?.(job.articleId, message);
    } finally {
      clearInterval(heartbeat);
      if (jobTimeoutId) clearTimeout(jobTimeoutId);
    }
  }

  /** Fail any processing job older than the hard timeout (safety net for hung timers). */
  failStaleJobs(maxAgeMs = ARTICLE_IMPORT_JOB_TIMEOUT_MS): number {
    const now = Date.now();
    let n = 0;
    for (const job of this.jobs) {
      if (job.status !== 'processing' || !job.startedAt) continue;
      const age = now - Date.parse(job.startedAt);
      if (!Number.isFinite(age) || age < maxAgeMs) continue;
      job.status = 'failed';
      job.error = `导入超时（卡住 ${Math.round(age / 1000)}s）`;
      job.finishedAt = new Date().toISOString();
      job.progress = {
        phase: 'error',
        paragraphIndex: 0,
        paragraphTotal: job.content.length,
        message: `失败：${job.error}`,
      };
      this.activeIds.delete(job.articleId);
      this.options.onFailed?.(job.articleId, job.error);
      n += 1;
    }
    if (n > 0) {
      // The original runJob Promise still owns its slot and releases it in pump().finally().
      this.trimTerminalHistory();
      this.emit();
    }
    return n;
  }

  /** Cancel all queued/processing jobs (user escape hatch for stuck banner). */
  cancelAll(): number {
    let n = 0;
    for (const job of this.jobs) {
      if (job.status !== 'queued' && job.status !== 'processing') continue;
      if (job.status === 'processing') this.cancelledJobs.add(job);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      job.progress = {
        phase: 'error',
        paragraphIndex: 0,
        paragraphTotal: job.content.length,
        message: '已取消',
      };
      this.activeIds.delete(job.articleId);
      n += 1;
    }
    this.trimTerminalHistory();
    this.emit();
    return n;
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
