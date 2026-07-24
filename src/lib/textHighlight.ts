import { toLemma } from './proficiency';

interface NormalizedTerm {
  original: string;
  words: string[];
}

/**
 * Returns the full matched term for every token that belongs to an exact
 * word/phrase match. Longer phrases win over overlapping shorter terms.
 */
export function getPhraseHighlightMatches(
  tokens: string[],
  terms: string[]
): Array<string | null> {
  const normalizedTokens = tokens.map(toLemma);
  const normalizedTerms: NormalizedTerm[] = terms
    .map((original) => ({
      original,
      words: toLemma(original).split(' ').filter(Boolean),
    }))
    .filter((term) => term.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length);
  const matches: Array<string | null> = Array(tokens.length).fill(null);

  for (let index = 0; index < normalizedTokens.length; index += 1) {
    for (const term of normalizedTerms) {
      if (index + term.words.length > normalizedTokens.length) continue;
      if (matches.slice(index, index + term.words.length).some(Boolean)) continue;

      const isExactMatch = term.words.every(
        (word, offset) => normalizedTokens[index + offset] === word
      );
      if (!isExactMatch) continue;

      for (let offset = 0; offset < term.words.length; offset += 1) {
        matches[index + offset] = term.original;
      }
      break;
    }
  }

  return matches;
}
