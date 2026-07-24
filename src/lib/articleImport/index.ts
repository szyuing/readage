/**
 * Independent Article Import Module
 *
 * Responsibilities:
 * - Paragraph-by-paragraph AI translation
 * - Full-article CEFR rating
 * - Background serial job queue (store first, enrich later)
 *
 * Used by: manual paste/generate, magazine open, recommend, history resume.
 */

export {
  IMPORT_LIMITS,
  applyEnrichmentToArticle,
  countChars,
  countWords,
  enrichArticleOnImport,
  mapPool,
  needsImportEnrichment,
  prepareImportParagraphs,
  splitArticleParagraphs,
  splitOversizedParagraph,
  type EnrichPhase,
  type EnrichProgress,
  type EnrichResult,
  type TranslateMode,
} from './enrichment';

export {
  ARTICLE_IMPORT_CONCURRENCY,
  ARTICLE_IMPORT_JOB_TIMEOUT_MS,
  ArticleImportQueue,
  getArticleImportQueue,
  __setArticleImportQueueForTests,
  type ImportCompletePayload,
  type ImportJob,
  type ImportJobSource,
  type ImportJobStatus,
  type ImportQueueListener,
  type ImportQueueSnapshot,
  type ArticleImportQueueOptions,
} from './queue';

export { useArticleImportQueue } from './useImportQueue';
