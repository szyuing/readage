/**
 * Interactive recommendation resolution chain:
 * Full-catalog lemma rank (optional) → Memory V2 local library → library fallback → AI
 */

import type { Article } from '../types';
import type { RecommendedArticleCandidate } from './articleValidation';
import {
  memoryV2RecommendationProvider,
  rankMagazineLemmaCandidates,
  type MemoryV2RecommendationOptions,
} from './memoryV2RecommendationAdapter';
import {
  expandLemmaIndexToCandidates,
  fetchMagazineArticleById,
  fetchMagazineLemmaIndex,
  type MagazineLemmaIndex,
} from './magazineLemmaIndex';
import {
  collectExcludedArticleIds,
  selectLibraryFallback,
} from './recommendationFeed';
import {
  getRecommendationPoolRotationDate,
  seededShuffle,
} from './recommendationPoolRotation';
import { postTutor, type TutorPostOptions } from './tutorClient';
import type { ArticleCandidate, RecommendationScore } from './memoryV2/recommendation';

export type RecommendationSource =
  | 'local_memory'
  | 'library_fallback'
  | 'ai'
  | 'timeout_fallback'
  | 'full_catalog';

export interface ResolveRecommendationRequest {
  topic: string;
  reviewWords: string[];
  excludeArticleIds: string[];
}

export interface ResolveRecommendationContext {
  library: Article[];
  history: Article[];
  userLevel?: string;
  memoryOptions?: MemoryV2RecommendationOptions;
  /** Optional UI progress hook. */
  onPhase?: (phase: 'local' | 'library' | 'ai' | 'catalog') => void;
  /** Injected for tests; defaults to memoryV2RecommendationProvider. */
  localProvider?: typeof memoryV2RecommendationProvider;
  /** Injected for tests; defaults to postTutor. */
  aiPost?: typeof postTutor;
  /** Injected for tests; defaults to selectLibraryFallback. */
  libraryFallback?: typeof selectLibraryFallback;
  /**
   * When true (default), rank the full magazine lemma index (~658) then hydrate
   * only the winning article body.
   */
  useFullCatalog?: boolean;
  /** Injected catalog loader (tests). */
  loadLemmaIndex?: () => Promise<MagazineLemmaIndex | null>;
  /** Injected article body loader (tests). */
  loadArticleById?: (articleId: string) => Promise<Article | null>;
  /** Injected ranker (tests). */
  rankCatalog?: typeof rankMagazineLemmaCandidates;
  /** Optional timing diagnostics callback. */
  onTiming?: (timing: RecommendationTiming) => void;
}

export interface RecommendationTiming {
  catalogLoadMs?: number;
  rankMs?: number;
  hydrateMs?: number;
  totalMs: number;
  catalogSize?: number;
  source: RecommendationSource | 'miss';
}

export interface ResolvedRecommendation {
  article: Article;
  source: RecommendationSource;
}

function buildAiArticle(
  data: RecommendedArticleCandidate,
  topic: string,
  reviewWords: string[]
): Article {
  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: data.title,
    description: data.description,
    date: new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    status: 'In Progress',
    source: 'ai_generated',
    level: 'B1',
    topic,
    content: data.paragraphs,
    keyWords: data.keyWords,
    embeddedReviewWords: reviewWords,
  };
}

/**
 * Among the top ranked scores, apply a stable daily shuffle so the interactive
 * feed explores the head of the list instead of always locking onto #1 when
 * cold-start scores are flat.
 */
export function pickDailyRankedRecommendation(
  scores: readonly RecommendationScore[],
  rotationDate: string,
  exploreTop = 24
): RecommendationScore | null {
  if (scores.length === 0) return null;
  const topScore = scores[0]?.score;
  if (topScore === undefined) return null;
  const head = scores
    .slice(0, Math.max(1, exploreTop))
    .filter((candidate) => candidate.score === topScore);
  const shuffled = seededShuffle(head, `full-catalog-explore:${rotationDate}`);
  return shuffled[0] ?? scores[0] ?? null;
}

async function resolveFromFullCatalog(
  request: ResolveRecommendationRequest,
  context: ResolveRecommendationContext,
  excluded: ReadonlySet<string>,
  expandedExcludeIds: string[],
  timing: Partial<RecommendationTiming>,
  signal?: AbortSignal
): Promise<ResolvedRecommendation | null> {
  const {
    library,
    history,
    userLevel = 'B1',
    memoryOptions,
    onPhase,
    loadLemmaIndex,
    loadArticleById,
    rankCatalog = rankMagazineLemmaCandidates,
  } = context;

  onPhase?.('catalog');
  const catalogStarted = Date.now();
  let index: MagazineLemmaIndex | null = null;
  if (loadLemmaIndex) {
    index = await loadLemmaIndex();
  } else {
    const loaded = await fetchMagazineLemmaIndex({ signal });
    index = loaded.index;
  }
  timing.catalogLoadMs = Date.now() - catalogStarted;
  timing.catalogSize = index?.articleCount;

  if (!index || index.articleCount === 0) return null;

  const candidates: ArticleCandidate[] = expandLemmaIndexToCandidates(
    index,
    excluded
  );
  // Merge small built-in / history rows that have content but are not in the catalog.
  for (const article of [...library, ...history]) {
    if (!article?.id || excluded.has(article.id)) continue;
    if (candidates.some((row) => row.article.id === article.id)) continue;
    if (!Array.isArray(article.content) || article.content.length === 0) continue;
    // Tokenize only non-catalog extras (usually ≤5 demo + user pastes).
    const { getNewLemmas } = await import('./readingExposure');
    const lemmas = new Set<string>();
    const exposed = new Set<string>();
    for (const paragraph of article.content) {
      for (const lemma of getNewLemmas(paragraph, exposed)) {
        lemmas.add(lemma);
        exposed.add(lemma);
      }
    }
    if (lemmas.size === 0) continue;
    candidates.push({
      article: {
        id: article.id,
        title: article.title,
        content: article.content,
        level: article.level,
        topic: article.topic,
      },
      lemmas: Array.from(lemmas),
    });
  }

  const rankStarted = Date.now();
  const scores = await rankCatalog(candidates, {
    reviewWords: request.reviewWords,
    excludeArticleIds: expandedExcludeIds,
    userLevel,
    preferredTopics: request.topic ? [request.topic] : memoryOptions?.preferredTopics,
    recentArticleIds: expandedExcludeIds,
    limit: 48,
    ...memoryOptions,
    applyHardFilters: false,
  });
  timing.rankMs = Date.now() - rankStarted;

  const rotationDate = getRecommendationPoolRotationDate();
  const picked = pickDailyRankedRecommendation(scores, rotationDate, 24);
  if (!picked) return null;

  // Prefer in-memory body when already loaded (history / small library pool).
  const localHit =
    library.find((article) => article.id === picked.articleId)
    || history.find((article) => article.id === picked.articleId);
  if (localHit?.content?.length) {
    return { article: localHit, source: 'full_catalog' };
  }

  const hydrateStarted = Date.now();
  const loader =
    loadArticleById
    ?? ((articleId: string) => fetchMagazineArticleById(articleId, { signal }));
  const article = await loader(picked.articleId);
  timing.hydrateMs = Date.now() - hydrateStarted;
  if (!article) return null;
  return { article, source: 'full_catalog' };
}

/**
 * Resolve the next recommendation article without hanging the UI on AI.
 *
 * Order:
 * 1. Full magazine lemma-index ranking (all ~658) + hydrate winner
 * 2. Memory V2 local ranking over the in-memory library pool
 * 3. Simple unread library fallback
 * 4. Budgeted AI generation (only if still nothing)
 *
 * When a local/catalog article exists, AI is never called for the interactive path.
 */
export async function resolveRecommendationArticle(
  request: ResolveRecommendationRequest,
  context: ResolveRecommendationContext,
  tutorOptions?: TutorPostOptions
): Promise<ResolvedRecommendation | null> {
  const started = Date.now();
  const {
    library,
    history,
    userLevel = 'B1',
    memoryOptions,
    onPhase,
    localProvider = memoryV2RecommendationProvider,
    aiPost = postTutor,
    libraryFallback = selectLibraryFallback,
    useFullCatalog = true,
    onTiming,
  } = context;
  const { topic, reviewWords, excludeArticleIds } = request;
  // Never re-recommend pieces the user already opened (history) or saw in this feed.
  const excluded = collectExcludedArticleIds(excludeArticleIds, history);
  const expandedExcludeIds = Array.from(excluded);
  const timing: Partial<RecommendationTiming> = {};

  if (useFullCatalog) {
    try {
      const catalogHit = await resolveFromFullCatalog(
        request,
        context,
        excluded,
        expandedExcludeIds,
        timing,
        tutorOptions?.signal
      );
      if (catalogHit) {
        const finalTiming: RecommendationTiming = {
          ...timing,
          totalMs: Date.now() - started,
          source: catalogHit.source,
        };
        onTiming?.(finalTiming);
        return catalogHit;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      console.warn('Full-catalog recommendation failed; falling back to pool ranking.', error);
    }
  }

  onPhase?.('local');
  const localArticle = await localProvider(
    { topic, reviewWords, excludeArticleIds: expandedExcludeIds },
    library,
    {
      strategy: reviewWords.length > 0 ? 'review-first' : 'balanced',
      userLevel,
      preferredTopics: topic ? [topic] : memoryOptions?.preferredTopics ?? [],
      recentArticleIds: expandedExcludeIds,
      ...memoryOptions,
    }
  );

  if (localArticle) {
    onTiming?.({
      ...timing,
      totalMs: Date.now() - started,
      source: 'local_memory',
    });
    return { article: localArticle, source: 'local_memory' };
  }

  onPhase?.('library');
  const libraryArticle = libraryFallback(library, history, excluded);
  if (libraryArticle) {
    onTiming?.({
      ...timing,
      totalMs: Date.now() - started,
      source: 'library_fallback',
    });
    return { article: libraryArticle, source: 'library_fallback' };
  }

  // Only spend the interaction budget on AI when the library has no candidate.
  onPhase?.('ai');
  try {
    const response = await aiPost<RecommendedArticleCandidate>(
      {
        intent: 'recommend_article',
        topic,
        reviewWords,
        level: userLevel,
      },
      fetch,
      tutorOptions
    );
    onTiming?.({
      ...timing,
      totalMs: Date.now() - started,
      source: 'ai',
    });
    return {
      article: buildAiArticle(response.result, topic, reviewWords),
      source: 'ai',
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    // Last-ditch: re-check library in case history/status changed mid-flight.
    const finalFallback = libraryFallback(library, history, excluded);
    if (finalFallback) {
      onTiming?.({
        ...timing,
        totalMs: Date.now() - started,
        source: 'timeout_fallback',
      });
      return { article: finalFallback, source: 'timeout_fallback' };
    }
    onTiming?.({
      ...timing,
      totalMs: Date.now() - started,
      source: 'miss',
    });
    throw error;
  }
}
