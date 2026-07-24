/**
 * Memory V2 integration for ReadingScreen.
 * Exposure and click events share the same normalized learning unit and
 * occurrence identifier.
 */

import { useCallback, useRef } from 'react';
import { useMemorySystem } from './memoryV2/hooks';
import { toLemma } from './proficiency';
import type { ReadingLearningUnit } from './readingExposure';

type MemoryEventRecorder = (
  wordId: string,
  articleId: string,
  occurrenceId: string,
) => Promise<void>;

type MemoryBatchRecorder = (
  items: ReadonlyArray<{ wordId: string; articleId: string; occurrenceId: string }>,
) => Promise<void>;

/** Build the stable id used by both exposure and click for one occurrence. */
export function createMemoryOccurrenceId(
  articleId: string,
  paragraphIndex: number,
  unit: ReadingLearningUnit,
): string {
  return `${articleId}:p${paragraphIndex}:w${unit.tokenIndex}:${unit.wordId}`;
}

/**
 * Record a click and, when needed, first create the matching exposure.
 * This prevents fast clicks (before the 800ms paragraph timer) from producing
 * click-only evidence with validExposureCount = 0.
 */
export async function recordMemoryClickWithExposure({
  articleId,
  paragraphIndex,
  unit,
  exposedOccurrenceIds,
  recordExposure,
  recordClick,
}: {
  articleId: string;
  paragraphIndex: number;
  unit: ReadingLearningUnit;
  exposedOccurrenceIds: Set<string>;
  recordExposure: MemoryEventRecorder;
  recordClick: MemoryEventRecorder;
}): Promise<void> {
  const occurrenceId = createMemoryOccurrenceId(articleId, paragraphIndex, unit);

  if (!exposedOccurrenceIds.has(occurrenceId)) {
    exposedOccurrenceIds.add(occurrenceId);
    try {
      await recordExposure(unit.wordId, articleId, occurrenceId);
    } catch (error) {
      exposedOccurrenceIds.delete(occurrenceId);
      throw error;
    }
  }

  await recordClick(unit.wordId, articleId, occurrenceId);
}

/**
 * Optimistically reserve paragraph occurrence ids and roll them back when the
 * persistent batch write fails, allowing a later visibility event to retry.
 */
export async function recordParagraphExposureWithRollback({
  articleId,
  paragraphIndex,
  units,
  exposedOccurrenceIds,
  recordExposures,
}: {
  articleId: string;
  paragraphIndex: number;
  units: readonly ReadingLearningUnit[];
  exposedOccurrenceIds: Set<string>;
  recordExposures: MemoryBatchRecorder;
}): Promise<void> {
  const pending: Array<{ wordId: string; articleId: string; occurrenceId: string }> = [];

  for (const unit of units) {
    const occurrenceId = createMemoryOccurrenceId(articleId, paragraphIndex, unit);
    if (exposedOccurrenceIds.has(occurrenceId)) continue;
    exposedOccurrenceIds.add(occurrenceId);
    pending.push({ wordId: unit.wordId, articleId, occurrenceId });
  }

  if (pending.length === 0) return;

  try {
    await recordExposures(pending);
  } catch (error) {
    for (const item of pending) {
      exposedOccurrenceIds.delete(item.occurrenceId);
    }
    throw error;
  }
}

/**
 * Complete Memory V2 integration hook for ReadingScreen.
 * It tracks exposed occurrence ids across paragraph visibility and fast clicks.
 */
export function useMemoryV2Integration(articleId: string) {
  const { recordExposure, recordExposures, recordClick } = useMemorySystem();
  const exposureStateRef = useRef({
    articleId,
    occurrenceIds: new Set<string>(),
  });

  if (exposureStateRef.current.articleId !== articleId) {
    exposureStateRef.current = {
      articleId,
      occurrenceIds: new Set<string>(),
    };
  }

  const recordParagraphExposure = useCallback(
    async (
      paragraphIndex: number,
      units: readonly ReadingLearningUnit[],
    ) => {
      try {
        await recordParagraphExposureWithRollback({
          articleId,
          paragraphIndex,
          units,
          exposedOccurrenceIds: exposureStateRef.current.occurrenceIds,
          recordExposures,
        });
      } catch (error) {
        console.error('Failed to record paragraph exposures:', error);
      }
    },
    [articleId, recordExposures],
  );

  const recordWordClick = useCallback(
    async (
      unit: ReadingLearningUnit,
      paragraphIndex: number,
    ) => {
      try {
        await recordMemoryClickWithExposure({
          articleId,
          paragraphIndex,
          unit,
          exposedOccurrenceIds: exposureStateRef.current.occurrenceIds,
          recordExposure,
          recordClick,
        });
      } catch (error) {
        console.error('Failed to record click for', unit.wordId, error);
      }
    },
    [articleId, recordClick, recordExposure],
  );

  return {
    recordParagraphExposure,
    recordWordClick,
  };
}

/**
 * Find the first rendered-token index of a normalized word or phrase.
 * Kept for compatibility with callers outside ReadingScreen.
 */
export function findWordIndexInParagraph(
  paragraphText: string,
  targetWord: string
): number {
  const tokens = paragraphText.trim().split(/\s+/).map(toLemma);
  const targetTokens = toLemma(targetWord).split(' ').filter(Boolean);
  if (targetTokens.length === 0) return -1;

  for (let index = 0; index <= tokens.length - targetTokens.length; index += 1) {
    const matches = targetTokens.every(
      (targetToken, offset) => tokens[index + offset] === targetToken,
    );
    if (matches) return index;
  }

  return -1;
}
