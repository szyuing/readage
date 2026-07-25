import { toLemma } from './proficiency';
import { getPhraseHighlightMatches } from './textHighlight';
import { shouldTrackMemoryWord } from './memoryV2/stopWords';

export interface ReadingLearningUnit {
  /** Normalized word or phrase tracked by Memory V2. */
  wordId: string;
  /** Zero-based index of the first rendered token in this occurrence. */
  tokenIndex: number;
  /** Number of rendered tokens covered by this occurrence. */
  tokenLength: number;
}

function tokenizeParagraph(paragraphText: string): string[] {
  const trimmed = paragraphText.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

function isMetadataParagraph(paragraphText: string): boolean {
  // Imported magazine bodies can contain provenance lines such as
  // "downloaded from https://...". Do not turn a URL slug into one lemma.
  return /(?:https?:\/\/|www\.)/i.test(paragraphText);
}

/**
 * Extract Memory V2 learning-unit occurrences in rendered-token order.
 * Highlighted phrases replace their component words so exposure and click
 * operate on the same unit.
 */
export function extractLearningUnits(
  paragraphText: string,
  highlightTerms: readonly string[] = [],
): ReadingLearningUnit[] {
  if (isMetadataParagraph(paragraphText)) return [];

  const tokens = tokenizeParagraph(paragraphText);
  const matches = getPhraseHighlightMatches(tokens, [...highlightTerms]);
  const allowlist = new Set(
    highlightTerms.map((term) => toLemma(term)).filter(Boolean)
  );
  const units: ReadingLearningUnit[] = [];

  for (let tokenIndex = 0; tokenIndex < tokens.length;) {
    const matchedTerm = matches[tokenIndex];
    if (matchedTerm) {
      const wordId = toLemma(matchedTerm);
      const tokenLength = Math.max(1, wordId.split(' ').filter(Boolean).length);
      // Highlighted phrases/terms are always tracked (including stop-word exceptions).
      if (wordId) {
        units.push({ wordId, tokenIndex, tokenLength });
      }
      tokenIndex += tokenLength;
      continue;
    }

    const lexicalTokens = tokens[tokenIndex].match(
      /[a-z]+(?:['\u2018\u2019\u02bc][a-z]+)*(?:-[a-z]+(?:['\u2018\u2019\u02bc][a-z]+)*)*/gi,
    ) ?? [];
    for (const lexicalToken of lexicalTokens) {
      const wordId = toLemma(lexicalToken);
      if (wordId && shouldTrackMemoryWord(wordId, allowlist)) {
        units.push({ wordId, tokenIndex, tokenLength: 1 });
      }
    }
    tokenIndex += 1;
  }

  return units;
}

/** Resolve a rendered token click to its containing word or phrase unit. */
export function findLearningUnitAtTokenIndex(
  paragraphText: string,
  highlightTerms: readonly string[],
  tokenIndex: number,
): ReadingLearningUnit | null {
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0) return null;

  return extractLearningUnits(paragraphText, highlightTerms).find(
    (unit) => tokenIndex >= unit.tokenIndex
      && tokenIndex < unit.tokenIndex + unit.tokenLength,
  ) ?? null;
}

/** Extract normalized lemmas once, preserving their first-seen order. */
export function extractUniqueLemmas(paragraphText: string): string[] {
  const unique = new Set<string>();

  for (const unit of extractLearningUnits(paragraphText)) {
    unique.add(unit.wordId);
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
