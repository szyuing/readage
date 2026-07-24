import type { ChatMessage, TutorIntent, TutorRequest } from '../types';

const INTENTS = new Set<TutorIntent>([
  'explain',
  'translate',
  'translate_article',
  'recommend_article',
  'rewrite_article',
  'rate_article',
  'discuss',
]);

/** Max paragraphs for a single full-article translate call. */
export const MAX_TRANSLATE_ARTICLE_PARAGRAPHS = 400;
/** Max total characters across all paragraphs in one translate_article call. */
export const MAX_TRANSLATE_ARTICLE_CHARS = 120_000;

const STRING_LIMITS: Partial<Record<keyof TutorRequest, number>> = {
  articleId: 200,
  /** Full article for CEFR rating; sized for ~10k English words (万字, up to ~120k chars). */
  articleContext: 120_000,
  /** Paragraph body for import translation (one paragraph per call). */
  message: 6_000,
  selectedText: 2_000,
  contextSentence: 3_000,
  targetLanguage: 50,
  topic: 500,
  level: 20,
};

export type TutorRequestValidation =
  | { ok: true; value: TutorRequest }
  | { ok: false; code: string; message: string };

function fail(message: string): Extract<TutorRequestValidation, { ok: false }> {
  return { ok: false, code: 'INVALID_REQUEST', message };
}

export function validateTutorRequest(input: unknown): TutorRequestValidation {
  if (!input || typeof input !== 'object') return fail('Request body must be a JSON object.');
  const body = input as Record<string, unknown>;
  if (typeof body.intent !== 'string' || !INTENTS.has(body.intent as TutorIntent)) {
    return fail('Unknown tutor intent.');
  }

  const value: TutorRequest = { intent: body.intent as TutorIntent };
  for (const [field, limit] of Object.entries(STRING_LIMITS) as Array<
    [keyof TutorRequest, number]
  >) {
    const candidate = body[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'string') return fail(`${String(field)} must be a string.`);
    if (candidate.length > limit) return fail(`${String(field)} exceeds ${limit} characters.`);
    (value as unknown as Record<string, unknown>)[field] = candidate;
  }

  if (body.reviewWords !== undefined) {
    if (!Array.isArray(body.reviewWords)) return fail('reviewWords must be an array.');
    const reviewWords = body.reviewWords.slice(0, 20);
    if (reviewWords.some((word) => typeof word !== 'string' || word.length > 80)) {
      return fail('Each review word must be a string of at most 80 characters.');
    }
    value.reviewWords = reviewWords as string[];
  }

  if (body.history !== undefined) {
    if (!Array.isArray(body.history)) return fail('history must be an array.');
    const history = body.history.slice(-12);
    if (
      history.some(
        (message) =>
          !message ||
          typeof message !== 'object' ||
          !['user', 'ai'].includes(String((message as ChatMessage).sender)) ||
          typeof (message as ChatMessage).text !== 'string' ||
          (message as ChatMessage).text.length > 2_000
      )
    ) {
      return fail('history contains an invalid message.');
    }
    value.history = history.map((message, index) => {
      const item = message as Partial<ChatMessage>;
      return {
        id: typeof item.id === 'string' ? item.id : `history-${index}`,
        sender: item.sender as 'user' | 'ai',
        text: item.text as string,
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
      };
    });
  }

  if (body.paragraphIndex !== undefined) {
    if (typeof body.paragraphIndex !== 'number' || !Number.isInteger(body.paragraphIndex) || body.paragraphIndex < 1) {
      return fail('paragraphIndex must be a positive integer.');
    }
    value.paragraphIndex = body.paragraphIndex;
  }

  if (body.paragraphTotal !== undefined) {
    if (typeof body.paragraphTotal !== 'number' || !Number.isInteger(body.paragraphTotal) || body.paragraphTotal < 1) {
      return fail('paragraphTotal must be a positive integer.');
    }
    value.paragraphTotal = body.paragraphTotal;
  }

  if (body.paragraphs !== undefined) {
    if (!Array.isArray(body.paragraphs)) return fail('paragraphs must be an array.');
    if (body.paragraphs.length === 0) return fail('paragraphs must not be empty.');
    if (body.paragraphs.length > MAX_TRANSLATE_ARTICLE_PARAGRAPHS) {
      return fail(`paragraphs exceeds ${MAX_TRANSLATE_ARTICLE_PARAGRAPHS} items.`);
    }
    if (body.paragraphs.some((p) => typeof p !== 'string')) {
      return fail('Each paragraph must be a string.');
    }
    const paragraphs = (body.paragraphs as string[]).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return fail('paragraphs must contain non-empty strings.');
    const totalChars = paragraphs.reduce((sum, p) => sum + p.length, 0);
    if (totalChars > MAX_TRANSLATE_ARTICLE_CHARS) {
      return fail(`paragraphs total characters exceed ${MAX_TRANSLATE_ARTICLE_CHARS}.`);
    }
    value.paragraphs = paragraphs;
    value.paragraphTotal = paragraphs.length;
  }

  return { ok: true, value };
}

