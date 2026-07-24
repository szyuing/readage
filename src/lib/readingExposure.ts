import { toLemma } from './proficiency';

/** Extract normalized lemmas once, preserving their first-seen order. */
export function extractUniqueLemmas(paragraphText: string): string[] {
  const unique = new Set<string>();

  const tokens = paragraphText.match(/[a-z]+(?:['\u2018\u2019\u02bc][a-z]+)*(?:-[a-z]+(?:['\u2018\u2019\u02bc][a-z]+)*)*/gi) ?? [];

  for (const token of tokens) {
    const lemma = toLemma(token);
    if (lemma) unique.add(lemma);
  }

  return [...unique];
}

/** Return paragraph lemmas that have not already been exposed. */
export function getNewLemmas(
  paragraphText: string,
  exposedLemmas: ReadonlySet<string>
): string[] {
  return extractUniqueLemmas(paragraphText).filter((lemma) => !exposedLemmas.has(lemma));
}


/** Require 60% of the paragraph, capped at 60% of the viewport for long paragraphs. */
export function hasSufficientExposureVisibility(
  visibleHeight: number,
  paragraphHeight: number,
  viewportHeight: number
): boolean {
  if (visibleHeight <= 0 || paragraphHeight <= 0 || viewportHeight <= 0) return false;
  const requiredHeight = Math.min(paragraphHeight * 0.6, viewportHeight * 0.6);
  return visibleHeight >= requiredHeight;
}

