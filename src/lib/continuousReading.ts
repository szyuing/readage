import type { ReadingAdvancePayload, ReadingAdvanceReason } from '../types';
import { toLemma } from './proficiency';

export interface SwipeCoordinates {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface ScrollEndCoordinates {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export interface ViewportArticleBounds {
  articleId: string;
  top: number;
  bottom: number;
}

export function hasArticleExitedViewport(lastParagraphBottom: number, viewportTop = 0): boolean {
  return Number.isFinite(lastParagraphBottom) && lastParagraphBottom <= viewportTop;
}

export function isLeftSwipeGesture(
  coordinates: SwipeCoordinates,
  minimumDistance = 64,
  horizontalDominance = 1.25
): boolean {
  const deltaX = coordinates.endX - coordinates.startX;
  const deltaY = coordinates.endY - coordinates.startY;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  return deltaX <= -minimumDistance
    && horizontalDistance > verticalDistance * horizontalDominance;
}

/** Returns the first article that has not completely scrolled past the viewport. */
export function selectCurrentContinuousArticleId(
  articles: readonly ViewportArticleBounds[],
  viewportTop = 0,
): string | null {
  return articles.find(({ bottom }) => bottom > viewportTop)?.articleId ?? null;
}

/**
 * Auto-advance only after a real scrollable article reaches its end and the
 * reader has spent the minimum amount of time on it.
 */
export function canAutoAdvanceAtScrollEnd(
  coordinates: ScrollEndCoordinates,
  elapsedMs: number,
  minimumDwellMs: number,
  tolerance = 48
): boolean {
  if (coordinates.scrollHeight <= coordinates.clientHeight) return false;
  if (elapsedMs < minimumDwellMs) return false;
  return coordinates.scrollTop + coordinates.clientHeight >= coordinates.scrollHeight - tolerance;
}

/**
 * Minimum dwell before recommendation-feed auto-advance on "all paragraphs read".
 * Short demo articles fit on one screen and would otherwise advance after ~800ms,
 * which feels like a sudden left-swipe skip.
 */
export function minDwellMsBeforeAutoAdvance(
  wordCount: number,
  options?: { minMs?: number; maxMs?: number; wordsPerMinute?: number }
): number {
  const minMs = options?.minMs ?? 4_000;
  const maxMs = options?.maxMs ?? 45_000;
  const wpm = options?.wordsPerMinute ?? 180;
  const estimated = Math.round((Math.max(0, wordCount) / wpm) * 60_000 * 0.35);
  return Math.min(maxMs, Math.max(minMs, estimated));
}

export function countArticleWords(paragraphs: readonly string[]): number {
  return paragraphs
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function buildReadingAdvancePayload(
  articleId: string,
  reason: ReadingAdvanceReason,
  stagedExposures: Iterable<string>
): ReadingAdvancePayload {
  const exposedLemmas = reason === 'completed'
    ? [...new Set([...stagedExposures].map(toLemma).filter(Boolean))]
    : [];
  return { articleId, reason, exposedLemmas };
}
