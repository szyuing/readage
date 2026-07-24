import type { Article, ArticleLevelRating, TranslationResult } from '../../types';
import { postTutor } from '../tutorClient';

export type EnrichPhase = 'idle' | 'translating' | 'rating' | 'done' | 'error';

export interface EnrichProgress {
  phase: EnrichPhase;
  /** 1-based when translating; 0 otherwise. */
  paragraphIndex: number;
  paragraphTotal: number;
  message: string;
  /** Optional metrics for long-form (万字) imports. */
  wordCount?: number;
  charCount?: number;
}

export interface EnrichResult {
  paragraphTranslations: string[];
  levelRating: ArticleLevelRating;
  level: string;
  /** English word count of processed body. */
  wordCount: number;
  /** Character count of processed body. */
  charCount: number;
  /** True when rating body was truncated to MAX_RATING_CHARS. */
  ratingTruncated: boolean;
  /** True when some source paragraphs were split to fit translate limits. */
  paragraphsSplit: boolean;
}

/** Limits sized for ~10,000-word (万字) active-reading imports. */
export const IMPORT_LIMITS = {
  /** Hard ceiling on paragraph units after split (≈ 10k words / ~30 wpp). */
  MAX_PARAGRAPHS: 400,
  /** Must stay ≤ tutorValidation `message` limit. */
  MAX_CHARS_PER_PARAGRAPH: 6_000,
  /**
   * Must stay ≤ tutorValidation `articleContext` limit.
   * ~10k English words often span 55–100k characters depending on vocabulary length.
   */
  MAX_RATING_CHARS: 120_000,
  /** Product target for long-form smoke tests. */
  TEN_THOUSAND_WORDS: 10_000,
} as const;

const {
  MAX_PARAGRAPHS,
  MAX_CHARS_PER_PARAGRAPH,
  MAX_RATING_CHARS,
} = IMPORT_LIMITS;

/** Count whitespace-separated English tokens. */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function countChars(text: string): number {
  return text.length;
}

/** Split pasted text into paragraphs for import. */
export function splitArticleParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const byDouble = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (byDouble.length > 1) {
    return expandAndCapParagraphs(byDouble);
  }

  const bySingle = normalized
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (bySingle.length > 1) {
    return expandAndCapParagraphs(bySingle);
  }

  return expandAndCapParagraphs([normalized]);
}

/**
 * Split any paragraph that exceeds the per-call translate budget so 万字 bodies
 * are not silently clipped mid-paragraph.
 */
export function splitOversizedParagraph(
  text: string,
  maxChars = MAX_CHARS_PER_PARAGRAPH
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  // Prefer sentence boundaries; fall back to hard cuts.
  const sentences = trimmed.match(/[^.!?]+[.!?]+["']?|\S+$/g) || [trimmed];
  let buf = '';

  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;

    if (piece.length > maxChars) {
      flush();
      for (let i = 0; i < piece.length; i += maxChars) {
        chunks.push(piece.slice(i, i + maxChars));
      }
      continue;
    }

    const next = buf ? `${buf} ${piece}` : piece;
    if (next.length > maxChars) {
      flush();
      buf = piece;
    } else {
      buf = next;
    }
  }
  flush();
  return chunks.length ? chunks : [trimmed.slice(0, maxChars)];
}

function expandAndCapParagraphs(paragraphs: string[]): string[] {
  const expanded: string[] = [];
  for (const para of paragraphs) {
    for (const part of splitOversizedParagraph(para)) {
      expanded.push(part);
      if (expanded.length >= MAX_PARAGRAPHS) return expanded;
    }
  }
  return expanded;
}

/**
 * Normalize article.content into translate units (split oversized, cap count).
 */
export function prepareImportParagraphs(content: string[]): {
  paragraphs: string[];
  paragraphsSplit: boolean;
  wordCount: number;
  charCount: number;
} {
  const raw = content.map((p) => p.trim()).filter(Boolean);
  let paragraphsSplit = false;
  const expanded: string[] = [];

  for (const para of raw) {
    const parts = splitOversizedParagraph(para);
    if (parts.length > 1) paragraphsSplit = true;
    for (const part of parts) {
      expanded.push(part);
      if (expanded.length >= MAX_PARAGRAPHS) {
        const body = expanded.join('\n\n');
        return {
          paragraphs: expanded,
          paragraphsSplit,
          wordCount: countWords(body),
          charCount: countChars(body),
        };
      }
    }
  }

  const body = expanded.join('\n\n');
  return {
    paragraphs: expanded,
    paragraphsSplit,
    wordCount: countWords(body),
    charCount: countChars(body),
  };
}

export function needsImportEnrichment(
  article: Pick<Article, 'content'> & Partial<Pick<Article, 'paragraphTranslations' | 'levelRating'>>
): boolean {
  const n = article.content?.length ?? 0;
  if (n === 0) return false;
  const translations = article.paragraphTranslations;
  const translationsComplete =
    Array.isArray(translations)
    && translations.length === n
    && translations.every((t) => typeof t === 'string' && t.trim().length > 0);
  const hasRating = Boolean(article.levelRating?.level && article.levelRating?.summary);
  return !translationsComplete || !hasRating;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Import pipeline: translate each paragraph with AI, then rate the full article.
 * Continues on per-paragraph failures so rating can still run.
 * Sized for 万字 (~10k English words) via IMPORT_LIMITS.
 */
export async function enrichArticleOnImport(
  article: Pick<Article, 'title' | 'content'>,
  options?: {
    targetLanguage?: string;
    onProgress?: (progress: EnrichProgress) => void;
    /** Skip paragraph translation (rate only). */
    skipTranslation?: boolean;
    /** Skip CEFR rating (translate only). */
    skipRating?: boolean;
    fetcher?: typeof fetch;
  }
): Promise<EnrichResult> {
  const prepared = prepareImportParagraphs(article.content);
  const paragraphs = prepared.paragraphs;
  const total = paragraphs.length;
  const onProgress = options?.onProgress;
  const fetcher = options?.fetcher;
  const targetLanguage = options?.targetLanguage || 'Chinese';

  if (total === 0) {
    throw new Error('文章没有可处理的段落。');
  }

  const paragraphTranslations: string[] = [];

  if (!options?.skipTranslation) {
    for (let i = 0; i < total; i += 1) {
      onProgress?.({
        phase: 'translating',
        paragraphIndex: i + 1,
        paragraphTotal: total,
        message: `正在翻译第 ${i + 1}/${total} 段…`,
        wordCount: prepared.wordCount,
        charCount: prepared.charCount,
      });

      const source = clip(paragraphs[i], MAX_CHARS_PER_PARAGRAPH);
      try {
        const response = await postTutor<TranslationResult>(
          {
            intent: 'translate',
            message: source,
            targetLanguage,
            paragraphIndex: i + 1,
            paragraphTotal: total,
            topic: article.title,
          },
          fetcher
        );
        const translated = response.result.translatedText?.trim() || '';
        paragraphTranslations.push(translated || `（第 ${i + 1} 段翻译为空）`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : '翻译失败';
        paragraphTranslations.push(`（第 ${i + 1} 段翻译失败：${reason}）`);
      }
    }
  } else {
    paragraphTranslations.push(...paragraphs.map(() => ''));
  }

  let levelRating: ArticleLevelRating = {
    level: 'B1',
    difficultyScore: 50,
    summary: '未能完成 AI 评级，暂用默认 B1。',
  };

  const fullBody = paragraphs.join('\n\n');
  const ratingBody = clip(fullBody, MAX_RATING_CHARS);
  const ratingTruncated = ratingBody.length < fullBody.length;

  if (!options?.skipRating) {
    onProgress?.({
      phase: 'rating',
      paragraphIndex: 0,
      paragraphTotal: total,
      message: ratingTruncated
        ? `正在对全文进行 CEFR 评级（已截断至 ${MAX_RATING_CHARS} 字符）…`
        : '正在对全文进行 CEFR 评级…',
      wordCount: prepared.wordCount,
      charCount: prepared.charCount,
    });

    try {
      const response = await postTutor<ArticleLevelRating>(
        {
          intent: 'rate_article',
          articleContext: ratingBody,
          topic: article.title,
        },
        fetcher
      );
      levelRating = response.result;
      if (ratingTruncated) {
        levelRating = {
          ...levelRating,
          summary: `${levelRating.summary}（注：正文超过 ${MAX_RATING_CHARS} 字符，评级基于截断样本。）`,
        };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '评级失败';
      levelRating = {
        level: 'B1',
        difficultyScore: 50,
        summary: `AI 评级失败（${reason}），暂用默认 B1。可稍后重新导入。`,
      };
    }
  }

  onProgress?.({
    phase: 'done',
    paragraphIndex: total,
    paragraphTotal: total,
    message: '导入 enrichment 完成',
    wordCount: prepared.wordCount,
    charCount: prepared.charCount,
  });

  return {
    paragraphTranslations,
    levelRating,
    level: levelRating.level,
    wordCount: prepared.wordCount,
    charCount: prepared.charCount,
    ratingTruncated,
    paragraphsSplit: prepared.paragraphsSplit,
  };
}

/** Merge enrichment fields onto an article draft. */
export function applyEnrichmentToArticle<T extends Article>(
  article: T,
  enrichment: EnrichResult
): T {
  // If import expanded/split paragraphs, persist the processed units so
  // translations stay index-aligned with content.
  const prepared = prepareImportParagraphs(article.content);
  const content =
    prepared.paragraphs.length === article.content.length
    && prepared.paragraphs.every((p, i) => p === article.content[i]?.trim())
      ? article.content
      : prepared.paragraphs;

  return {
    ...article,
    content,
    paragraphTranslations: enrichment.paragraphTranslations,
    levelRating: enrichment.levelRating,
    level: enrichment.level,
  };
}

