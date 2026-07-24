/**
 * Interactive recommendation resolution chain:
 * Memory V2 local → library fallback → AI (budgeted) → null
 */

import type { Article } from '../types';
import type { RecommendedArticleCandidate } from './articleValidation';
import {
  memoryV2RecommendationProvider,
  type MemoryV2RecommendationOptions,
} from './memoryV2RecommendationAdapter';
import { selectLibraryFallback } from './recommendationFeed';
import { postTutor, type TutorPostOptions } from './tutorClient';

export type RecommendationSource =
  | 'local_memory'
  | 'library_fallback'
  | 'ai'
  | 'timeout_fallback';

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
  onPhase?: (phase: 'local' | 'library' | 'ai') => void;
  /** Injected for tests; defaults to memoryV2RecommendationProvider. */
  localProvider?: typeof memoryV2RecommendationProvider;
  /** Injected for tests; defaults to postTutor. */
  aiPost?: typeof postTutor;
  /** Injected for tests; defaults to selectLibraryFallback. */
  libraryFallback?: typeof selectLibraryFallback;
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
 * Resolve the next recommendation article without hanging the UI on AI.
 *
 * Order:
 * 1. Memory V2 local ranking over the library
 * 2. Simple unread library fallback
 * 3. Budgeted AI generation (only if still nothing / optional enhancement path)
 *
 * When a local or library article exists, AI is never called for the interactive path.
 */
export async function resolveRecommendationArticle(
  request: ResolveRecommendationRequest,
  context: ResolveRecommendationContext,
  tutorOptions?: TutorPostOptions
): Promise<ResolvedRecommendation | null> {
  const {
    library,
    history,
    userLevel = 'B1',
    memoryOptions,
    onPhase,
    localProvider = memoryV2RecommendationProvider,
    aiPost = postTutor,
    libraryFallback = selectLibraryFallback,
  } = context;
  const { topic, reviewWords, excludeArticleIds } = request;
  const excluded = new Set(excludeArticleIds);

  onPhase?.('local');
  const localArticle = await localProvider(
    { topic, reviewWords, excludeArticleIds },
    library,
    {
      strategy: reviewWords.length > 0 ? 'review-first' : 'balanced',
      userLevel,
      preferredTopics: topic ? [topic] : memoryOptions?.preferredTopics ?? [],
      recentArticleIds: excludeArticleIds,
      ...memoryOptions,
    }
  );

  if (localArticle) {
    return { article: localArticle, source: 'local_memory' };
  }

  onPhase?.('library');
  const libraryArticle = libraryFallback(library, history, excluded);
  if (libraryArticle) {
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
      return { article: finalFallback, source: 'timeout_fallback' };
    }
    throw error;
  }
}
