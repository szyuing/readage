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
  needsImportEnrichment,
  prepareImportParagraphs,
  splitArticleParagraphs,
  splitOversizedParagraph,
  type EnrichPhase,
  type EnrichProgress,
  type EnrichResult,
} from './enrichment';

export {
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
