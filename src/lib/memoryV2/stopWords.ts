/**
 * High-frequency function words that should not consume Memory storage by default.
 * Highlighted / review / keyword terms are always tracked even if they appear here.
 */

const STOP_WORD_LIST = [
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'into', 'about',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'have', 'has', 'had',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those',
  'not', 'no', 'so', 'if', 'than', 'then',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'there', 'here', 'up', 'out', 'off', 'over', 'under', 'again',
  'just', 'also', 'only', 'very', 'too', 'more', 'most', 'such',
] as const;

export const MEMORY_STOP_WORDS: ReadonlySet<string> = new Set(STOP_WORD_LIST);

/** True when the normalized wordId is a single-token function word. */
export function isMemoryStopWord(wordId: string): boolean {
  const normalized = wordId.trim().toLowerCase();
  if (!normalized || normalized.includes(' ')) return false;
  return MEMORY_STOP_WORDS.has(normalized);
}

/**
 * Whether Memory should track this unit.
 * Multi-word phrases are always tracked; single stop words are skipped unless allowlisted.
 */
export function shouldTrackMemoryWord(
  wordId: string,
  allowlist: ReadonlySet<string> = new Set()
): boolean {
  const normalized = wordId.trim().toLowerCase();
  if (!normalized) return false;
  if (allowlist.has(normalized)) return true;
  return !isMemoryStopWord(normalized);
}
