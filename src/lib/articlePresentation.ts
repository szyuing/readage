export type ArticleParagraphKind = 'body' | 'title' | 'author' | 'furniture';

const NAVIGATION_LABELS = ['next', 'section menu', 'main menu', 'previous'];
const AUTHOR_PREFIX_RE = /^(?:by|written by|words by|text by|authors?|作者)\s*[:：]?\s*\S/i;

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”‘’]/g, "'")
    .replace(/[|｜]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function isNavigationParagraph(value: string): boolean {
  const tokens = normalizeComparableText(value).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;

  let tokenIndex = 0;
  let labelCount = 0;
  while (tokenIndex < tokens.length) {
    const label = NAVIGATION_LABELS.find((candidate) => {
      const parts = candidate.split(' ');
      return parts.every((part, index) => tokens[tokenIndex + index] === part);
    });
    if (!label) return false;
    tokenIndex += label.split(' ').length;
    labelCount += 1;
  }

  return labelCount >= 2;
}

function isSeparatorParagraph(value: string): boolean {
  return /^[\s\-_=*.:·•—–]{8,}$/u.test(value.trim());
}

function isTitleParagraph(value: string, articleTitle: string): boolean {
  const paragraph = normalizeComparableText(value);
  const title = normalizeComparableText(articleTitle);
  return Boolean(title) && paragraph === title;
}

export function classifyArticleParagraph(
  paragraph: string,
  articleTitle: string,
): ArticleParagraphKind {
  if (isNavigationParagraph(paragraph) || isSeparatorParagraph(paragraph)) return 'furniture';
  if (isTitleParagraph(paragraph, articleTitle)) return 'title';
  if (AUTHOR_PREFIX_RE.test(paragraph.trim())) return 'author';
  return 'body';
}
