import type { Article, ArticleLevelRating } from '../types';
import type { RecommendedArticleCandidate } from './articleValidation';

export interface BuildLevelRewriteArticleOptions {
  sourceArticle: Article;
  candidate: RecommendedArticleCandidate;
  levelRating: ArticleLevelRating;
  id: string;
  date: string;
}

/** Build a rewrite as an ordinary independent article without carrying over review-only metadata. */
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
    source: 'user_input',
    level: levelRating.level,
    levelRating,
    generatedFromArticleId: sourceArticle.id,
    generatedFromArticleTitle: sourceArticle.title,
    generationKind: 'level-rewrite',
    content: candidate.paragraphs,
    topic: sourceArticle.topic,
    importEnrichmentStatus: 'pending',
  };
}
