import { textContainsLemma, toLemma } from './proficiency';

export interface RecommendedArticleCandidate {
  title: string;
  description: string;
  paragraphs: string[];
  keyWords: string[];
}

export interface ArticleValidationResult {
  isValid: boolean;
  errors: string[];
  metrics: {
    wordCount: number;
    newWordCount: number;
    newWordDensity: number;
  };
  /** Present only after the untrusted model output passes the response-shape check. */
  article?: RecommendedArticleCandidate;
}

const DEFAULT_MAX_NEW_WORD_DENSITY = 0.04;

function countWords(paragraphs: string[]): number {
  return paragraphs
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function keywordSurfaceForms(keyword: string): Set<string> {
  const normalized = toLemma(keyword);
  const forms = new Set([normalized]);
  if (!normalized || normalized.includes(' ')) return forms;

  forms.add(`${normalized}s`);
  if (/(s|x|z|ch|sh)$/.test(normalized)) forms.add(`${normalized}es`);
  if (/[^aeiou]y$/.test(normalized)) forms.add(`${normalized.slice(0, -1)}ies`);
  if (normalized.endsWith('e')) {
    forms.add(`${normalized}d`);
    forms.add(`${normalized.slice(0, -1)}ing`);
  } else {
    forms.add(`${normalized}ed`);
    forms.add(`${normalized}ing`);
  }
  return forms;
}

function sanitizeKeyWords(text: string, keyWords: string[]): string[] {
  const surfaceTokens = (text.match(/[A-Za-z]+(?:['?][A-Za-z]+)*/g) || []).map(toLemma);
  const uniqueTokens = [...new Set(surfaceTokens.filter(Boolean))];
  const sanitized: string[] = [];

  for (const rawKeyword of keyWords) {
    const keyword = toLemma(rawKeyword);
    if (!keyword) continue;

    let surface: string | undefined;
    if (textContainsLemma(text, keyword)) {
      surface = keyword;
    } else if (!keyword.includes(' ')) {
      const forms = keywordSurfaceForms(keyword);
      surface = uniqueTokens.find((token) => forms.has(token));
    }

    if (surface && !sanitized.includes(surface)) sanitized.push(surface);
  }

  return sanitized;
}

/**
 * Validates untrusted model output before any article fields are read.
 * LLM structured-output settings are guidance, not a runtime guarantee.
 */
function parseRecommendedArticle(value: unknown): {
  article?: RecommendedArticleCandidate;
  errors: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { errors: ['Generated article must be a JSON object.'] };
  }

  const raw = value as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof raw.title !== 'string') errors.push('Generated article field "title" must be a string.');
  if (typeof raw.description !== 'string') errors.push('Generated article field "description" must be a string.');
  if (!isStringArray(raw.paragraphs)) {
    errors.push('Generated article field "paragraphs" must be an array of strings.');
  }
  if (!isStringArray(raw.keyWords)) {
    errors.push('Generated article field "keyWords" must be an array of strings.');
  }

  if (errors.length > 0) return { errors };
  return {
    article: {
      title: raw.title as string,
      description: raw.description as string,
      paragraphs: raw.paragraphs as string[],
      keyWords: raw.keyWords as string[],
    },
    errors: [],
  };
}

export function validateRecommendedArticle(
  article: unknown,
  reviewWords: string[],
  maxNewWordDensity = DEFAULT_MAX_NEW_WORD_DENSITY
): ArticleValidationResult {
  const parsed = parseRecommendedArticle(article);
  if (!parsed.article) {
    return {
      isValid: false,
      errors: parsed.errors,
      metrics: { wordCount: 0, newWordCount: 0, newWordDensity: 0 },
    };
  }

  const candidate = parsed.article;
  const text = candidate.paragraphs.join(' ');
  const wordCount = Math.max(1, countWords(candidate.paragraphs));
  const reviewSet = new Set(reviewWords.map(toLemma).filter(Boolean));
  const keyWords = sanitizeKeyWords(text, candidate.keyWords);
  const missingReviewWords = [...reviewSet].filter((word) => !textContainsLemma(text, word));
  const newWords = keyWords.filter((word) => !reviewSet.has(word));
  const newWordDensity = newWords.length / wordCount;
  const errors: string[] = [];

  if (!candidate.title.trim()) errors.push('Title is required.');
  if (!candidate.description.trim()) errors.push('Description is required.');
  if (candidate.paragraphs.length < 2) errors.push('At least two paragraphs are required.');
  if (missingReviewWords.length > 0) {
    errors.push(`Missing review words: ${missingReviewWords.join(', ')}`);
  }
  if (newWordDensity > maxNewWordDensity) {
    errors.push(
      `New vocabulary density ${(newWordDensity * 100).toFixed(1)}% exceeds ${(maxNewWordDensity * 100).toFixed(1)}%.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    metrics: {
      wordCount,
      newWordCount: newWords.length,
      newWordDensity,
    },
    article: errors.length === 0 ? { ...candidate, keyWords } : undefined,
  };
}
