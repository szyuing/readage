import type { Article } from '../types';

/**
 * Stable body fingerprint used to identify the same imported article across
 * magazine issues. Whitespace, casing, and paragraph boundaries are metadata,
 * not article identity, so they are normalized away.
 */
export function articleContentFingerprint(article: Pick<Article, 'content'>): string {
  return article.content
    .map((paragraph) => paragraph.normalize('NFKC').toLocaleLowerCase())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
