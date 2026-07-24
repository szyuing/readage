import type { GrammarExplanation } from '../types';
import { postTutor } from './tutorClient';

export interface WordCardRequest {
  selectedText: string;
  contextSentence: string;
}

/** Max lookup text length aligned with tutor validation. */
export const WORD_CARD_MAX_SELECTED_TEXT = 2_000;
export const WORD_CARD_MAX_CONTEXT = 3_000;

/**
 * Normalize a click or selection into a word-card lookup request.
 * Strips punctuation noise while keeping spaces/apostrophes for phrases.
 */
export function createWordCardRequest(
  wordOrPhrase: string,
  contextSentence = '',
): WordCardRequest | null {
  const selectedText = wordOrPhrase
    .replace(/[^a-zA-Z\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WORD_CARD_MAX_SELECTED_TEXT);
  if (!selectedText) return null;
  return {
    selectedText,
    contextSentence: contextSentence.trim().slice(0, WORD_CARD_MAX_CONTEXT),
  };
}

/** Offline / error fallback so the panel always has something to show. */
export function createOfflineWordCard(request: WordCardRequest): GrammarExplanation {
  return {
    wordOrPhrase: request.selectedText,
    type: 'Vocabulary',
    phonetic: '',
    definition: `Context meaning of "${request.selectedText}" in the current article (offline fallback).`,
    definitionChinese: '词卡暂时不可用，请结合上下文理解。',
    chineseTranslation: request.selectedText,
    grammarRules: [
      'Look at the surrounding words to infer part of speech.',
      'Try reusing this word in the discussion box below.',
    ],
    exampleSentences: [
      request.contextSentence || `I learned the word "${request.selectedText}" today.`,
    ],
    source: 'ai',
  };
}

export interface FetchWordCardOptions {
  articleId?: string;
  signal?: AbortSignal;
}

/**
 * Fetch a word card via `/api/tutor` explain.
 * Server path is dictionary-first for single English words; phrases/misses use AI.
 * Network failures return an offline fallback (unless the request was aborted).
 */
export async function fetchWordCard(
  request: WordCardRequest,
  options: FetchWordCardOptions = {},
): Promise<GrammarExplanation> {
  try {
    const response = await postTutor<GrammarExplanation>(
      {
        intent: 'explain',
        articleId: options.articleId,
        selectedText: request.selectedText,
        contextSentence: request.contextSentence,
      },
      fetch,
      { signal: options.signal },
    );
    return response.result;
  } catch (error) {
    if (error instanceof Error && /cancelled|abort/i.test(error.message)) {
      throw error;
    }
    return createOfflineWordCard(request);
  }
}
