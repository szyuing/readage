import type { Article, ArticleLevelRating } from '../types';
import type { RecommendedArticleCandidate } from './articleValidation';

export interface BuildLevelRewriteArticleOptions {
  sourceArticle: Article;
  candidate: RecommendedArticleCandidate;
  levelRating: ArticleLevelRating;
  id: string;
  date: string;
}

/** Build a rewrite as a new article without carrying over review-only metadata. */
export function buildLevelRewriteArticle({
  sourceArticle,
  candidate,
  levelRating,
  id,
  date,
}: BuildLevelRewriteArticleOptions): Article {
  return {
    id,
    title: candidate.title,
    description: candidate.description,
    date,
    status: 'In Progress',
    source: 'level_rewrite',
    level: levelRating.level,
    levelRating,
    rewriteTargetLevel: levelRating.level,
    parentArticleId: sourceArticle.id,
    parentArticleTitle: sourceArticle.title,
    content: candidate.paragraphs,
    keyWords: candidate.keyWords,
    topic: sourceArticle.topic,
    importEnrichmentStatus: 'pending',
  };
}
