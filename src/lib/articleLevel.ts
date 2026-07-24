import type { Article, ArticleLevelRating } from '../types';

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrBand = (typeof CEFR_ORDER)[number];

/** Mid-band difficulty scores for intentional (user-chosen) ratings. */
const CEFR_DIFFICULTY: Record<string, number> = {
  A1: 15,
  A2: 28,
  B1: 42,
  B2: 58,
  C1: 72,
  C2: 88,
};

export function normalizeCefrBand(raw: string | undefined | null): CefrBand | '' {
  const cleaned = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if ((CEFR_ORDER as readonly string[]).includes(cleaned)) return cleaned as CefrBand;
  const match = cleaned.match(/[ABC][12]/);
  if (match && (CEFR_ORDER as readonly string[]).includes(match[0])) {
    return match[0] as CefrBand;
  }
  return '';
}

/**
 * Single display CEFR for an article (one rating per article).
 * Prefer levelRating.level, then level, then rewriteTargetLevel.
 */
export function getArticleCefrLevel(article: Pick<Article, 'level' | 'levelRating' | 'rewriteTargetLevel'>): string {
  return (
    normalizeCefrBand(article.levelRating?.level)
    || normalizeCefrBand(article.level)
    || normalizeCefrBand(article.rewriteTargetLevel)
    || ''
  );
}

/** Build the sole official rating when the user intentionally picks a CEFR (e.g. rewrite). */
export function buildIntentionalLevelRating(
  levelRaw: string,
  summary?: string
): ArticleLevelRating {
  const level = normalizeCefrBand(levelRaw) || 'B1';
  return {
    level,
    difficultyScore: CEFR_DIFFICULTY[level] ?? 50,
    summary:
      summary
      || `本篇唯一 CEFR 评级为 ${level}（用户选择的改写目标等级）。`,
  };
}

/** Whether this article already has its single official CEFR rating. */
export function hasOfficialLevelRating(
  article: Pick<Article, 'levelRating'>
): boolean {
  return Boolean(article.levelRating?.level && article.levelRating?.summary);
}
