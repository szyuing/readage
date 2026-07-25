/**
 * Real Memory V2 → particle visualizer bridge.
 * Emits vocabulary exposure / click / article-complete events to the same
 * debug bus used by recommendation particles (BroadcastChannel + HTTP ring).
 */

import { isRecTelemetryEnabled, emitRecEvent } from './recommendationTelemetry';

export type VocabLevel = 0 | 1 | 2 | 3 | 4;

export interface VocabWordSnapshot {
  wordId: string;
  memoryScore: number;
  level: VocabLevel;
  nextReview?: string | null;
  lastReview?: string | null;
}

export type VocabParticleEvent =
  | {
      type: 'vocab_session';
      sessionId: string;
      at: number;
      articleId?: string;
      dueWords?: VocabWordSnapshot[];
    }
  | {
      type: 'vocab_exposure';
      sessionId: string;
      at: number;
      articleId: string;
      paragraphIndex: number;
      words: VocabWordSnapshot[];
    }
  | {
      type: 'vocab_click';
      sessionId: string;
      at: number;
      articleId: string;
      paragraphIndex: number;
      word: VocabWordSnapshot;
    }
  | {
      type: 'vocab_article_complete';
      sessionId: string;
      at: number;
      articleId: string;
      exposedLemmas: string[];
      words?: VocabWordSnapshot[];
    };

let vocabSessionId: string | null = null;

function createSessionId(): string {
  return `vocab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isVocabTelemetryEnabled(): boolean {
  return isRecTelemetryEnabled();
}

export function getVocabSessionId(): string {
  if (!vocabSessionId) vocabSessionId = createSessionId();
  return vocabSessionId;
}

export function startVocabSession(meta?: {
  articleId?: string;
  dueWords?: VocabWordSnapshot[];
}): string {
  vocabSessionId = createSessionId();
  if (!isVocabTelemetryEnabled()) return vocabSessionId;
  emitRecEvent({
    type: 'vocab_session',
    sessionId: vocabSessionId,
    at: Date.now(),
    articleId: meta?.articleId,
    dueWords: meta?.dueWords?.slice(0, 40),
  } as never);
  return vocabSessionId;
}

export function emitVocabExposure(meta: {
  articleId: string;
  paragraphIndex: number;
  words: VocabWordSnapshot[];
}): void {
  if (!isVocabTelemetryEnabled() || meta.words.length === 0) return;
  emitRecEvent({
    type: 'vocab_exposure',
    sessionId: getVocabSessionId(),
    at: Date.now(),
    articleId: meta.articleId,
    paragraphIndex: meta.paragraphIndex,
    words: meta.words.slice(0, 48),
  } as never);
}

export function emitVocabClick(meta: {
  articleId: string;
  paragraphIndex: number;
  word: VocabWordSnapshot;
}): void {
  if (!isVocabTelemetryEnabled()) return;
  emitRecEvent({
    type: 'vocab_click',
    sessionId: getVocabSessionId(),
    at: Date.now(),
    articleId: meta.articleId,
    paragraphIndex: meta.paragraphIndex,
    word: meta.word,
  } as never);
}

export function emitVocabArticleComplete(meta: {
  articleId: string;
  exposedLemmas: string[];
  words?: VocabWordSnapshot[];
}): void {
  if (!isVocabTelemetryEnabled()) return;
  emitRecEvent({
    type: 'vocab_article_complete',
    sessionId: getVocabSessionId(),
    at: Date.now(),
    articleId: meta.articleId,
    exposedLemmas: meta.exposedLemmas.slice(0, 80),
    words: meta.words?.slice(0, 80),
  } as never);
}

/** Map optional proficiency into a particle-safe snapshot. */
export function toVocabSnapshot(
  wordId: string,
  proficiency?: {
    memoryScore?: number;
    level?: number;
    nextReview?: string | null;
    lastReview?: string | null;
  } | null
): VocabWordSnapshot {
  const level = Math.max(0, Math.min(4, Math.floor(proficiency?.level ?? 0))) as VocabLevel;
  const memoryScore = Number.isFinite(proficiency?.memoryScore)
    ? Math.max(0, Math.min(100, Number(proficiency!.memoryScore)))
    : 0;
  return {
    wordId,
    memoryScore,
    level,
    nextReview: proficiency?.nextReview ?? null,
    lastReview: proficiency?.lastReview ?? null,
  };
}
