import type { WordProficiency } from '../types';
import {
  applyIncorrectUse,
  applyProductionUse,
  toLemma,
} from './proficiency';

type ProficiencyMap = Record<string, WordProficiency>;

function normalizeUnique(words: string[]): string[] {
  return [...new Set(words.map(toLemma).filter(Boolean))];
}

/**
 * Apply one structured speaking assessment batch.
 * Incorrect assessments override correct assessments for the same normalized lemma.
 */
export function applyStructuredProduction(
  map: ProficiencyMap,
  correctWords: string[],
  incorrectWords: string[],
  boost: number,
  at = new Date()
): ProficiencyMap {
  const normalizedIncorrect = normalizeUnique(incorrectWords);
  const incorrectSet = new Set(normalizedIncorrect);
  const normalizedCorrect = normalizeUnique(correctWords)
    .filter((lemma) => !incorrectSet.has(lemma) && Boolean(map[lemma]));

  let next = { ...map };

  if (normalizedCorrect.length > 0) {
    const correctEntries = Object.fromEntries(
      normalizedCorrect.map((lemma) => [lemma, map[lemma]])
    ) as ProficiencyMap;
    const credited = applyProductionUse(
      correctEntries,
      normalizedCorrect.join(' '),
      boost,
      at
    );

    for (const lemma of normalizedCorrect) {
      next[lemma] = credited[lemma];
    }
  }

  return applyIncorrectUse(next, normalizedIncorrect, at);
}
