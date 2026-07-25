/**
 * Telemetry for the external recommendation particle visualizer.
 * Emits REAL recommendation pipeline data (due/review words, scores, winner).
 * Default: on in Vite DEV, or when localStorage.recParticles = "1".
 */

import type { RecommendationScore } from './memoryV2/recommendation';
import { toLemma } from './proficiency';

export const REC_PARTICLES_CHANNEL = 'rec-particles';

export type RecPhase = 'catalog' | 'local' | 'library' | 'ai';

export interface RecCandidateItem {
  id: string;
  title: string;
  score: number;
  dueWordsCount: number;
  learningZoneCount: number;
  cefrRelation?: string;
  reason?: string;
  /** Target review/due lemmas that appear in this article (real hits). */
  reviewHits?: string[];
}

export type RecParticleEvent =
  | {
      type: 'session_start';
      sessionId: string;
      at: number;
      topic?: string;
      /** Real due / targeted review lemmas for this run. */
      reviewWords: string[];
      userLevel?: string;
    }
  | {
      type: 'phase';
      sessionId: string;
      at: number;
      phase: RecPhase;
    }
  | {
      type: 'catalog_loaded';
      sessionId: string;
      at: number;
      catalogSize: number;
      loadMs: number;
    }
  | {
      type: 'pool_ready';
      sessionId: string;
      at: number;
      poolSize: number;
      excludedCount?: number;
    }
  | {
      type: 'candidates';
      sessionId: string;
      at: number;
      items: RecCandidateItem[];
      totalScored?: number;
      shortlistSize?: number;
      reviewWords?: string[];
    }
  | {
      type: 'picked';
      sessionId: string;
      at: number;
      articleId: string;
      title?: string;
      source: string;
      totalMs?: number;
      score?: number;
      rank?: number;
      reviewHits?: string[];
      reason?: string;
    }
  | {
      type: 'idle';
      sessionId?: string;
      at: number;
    };

const TITLE_MAX = 80;
const REASON_MAX = 120;
const CANDIDATE_MAX = 48;
const REVIEW_WORD_MAX = 24;
const HIT_WORD_MAX = 12;

let activeSessionId: string | null = null;
let channel: BroadcastChannel | null = null;

function createSessionId(): string {
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isRecTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const flag = window.localStorage.getItem('recParticles');
    if (flag === '0') return false;
    if (flag === '1') return true;
  } catch {
    // ignore
  }
  // Default ON for localhost observation (particle page). Opt out with recParticles=0.
  try {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  } catch {
    // ignore
  }
  try {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
    return Boolean(meta.env?.DEV);
  } catch {
    return false;
  }
}

export function getActiveRecSessionId(): string | null {
  return activeSessionId;
}

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(REC_PARTICLES_CHANNEL);
    } catch {
      channel = null;
    }
  }
  return channel;
}

function postToServer(event: object): void {
  if (typeof fetch === 'undefined') return;
  try {
    void fetch('/api/debug/recommendation-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

/** Accept recommendation + vocabulary telemetry payloads. */
export function emitRecEvent(event: RecParticleEvent | { type: string; at?: number; [key: string]: unknown }): void {
  if (!isRecTelemetryEnabled()) {
    if (typeof console !== 'undefined') {
      console.debug('[rec-particles] telemetry off (set localStorage.recParticles="1")', event.type);
    }
    return;
  }
  try {
    getChannel()?.postMessage(event);
  } catch {
    // ignore
  }
  postToServer(event as RecParticleEvent);
  if (typeof console !== 'undefined' && (event.type === 'session_start' || event.type === 'vocab_click')) {
    console.info('[rec-particles]', event.type, event);
  }
}

export function normalizeReviewWords(words: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of words ?? []) {
    const lemma = toLemma(raw);
    if (!lemma || seen.has(lemma)) continue;
    seen.add(lemma);
    out.push(lemma);
    if (out.length >= REVIEW_WORD_MAX) break;
  }
  return out;
}

export function reviewHitsInLemmas(
  lemmas: readonly string[],
  reviewWords: readonly string[]
): string[] {
  if (reviewWords.length === 0 || lemmas.length === 0) return [];
  const present = new Set(lemmas.map(toLemma).filter(Boolean));
  const hits: string[] = [];
  for (const word of reviewWords) {
    if (present.has(word)) hits.push(word);
    if (hits.length >= HIT_WORD_MAX) break;
  }
  return hits;
}

export function startRecSession(meta: {
  topic?: string;
  reviewWords?: readonly string[];
  userLevel?: string;
}): string {
  const sessionId = createSessionId();
  activeSessionId = sessionId;
  emitRecEvent({
    type: 'session_start',
    sessionId,
    at: Date.now(),
    topic: meta.topic,
    reviewWords: normalizeReviewWords(meta.reviewWords),
    userLevel: meta.userLevel,
  });
  return sessionId;
}

export function emitRecPhase(phase: RecPhase, sessionId = activeSessionId): void {
  if (!sessionId) return;
  emitRecEvent({ type: 'phase', sessionId, at: Date.now(), phase });
}

export function emitRecCatalogLoaded(
  catalogSize: number,
  loadMs: number,
  sessionId = activeSessionId
): void {
  if (!sessionId) return;
  emitRecEvent({
    type: 'catalog_loaded',
    sessionId,
    at: Date.now(),
    catalogSize,
    loadMs,
  });
}

export function summarizeRecCandidates(
  scores: readonly RecommendationScore[],
  titleById?: ReadonlyMap<string, string>,
  options?: {
    reviewWords?: readonly string[];
    lemmasById?: ReadonlyMap<string, readonly string[]>;
  }
): RecCandidateItem[] {
  const reviewWords = normalizeReviewWords(options?.reviewWords);
  return scores.slice(0, CANDIDATE_MAX).map((score) => {
    const rawTitle = titleById?.get(score.articleId) || score.articleId;
    const lemmas = options?.lemmasById?.get(score.articleId);
    const reviewHits = lemmas
      ? reviewHitsInLemmas(lemmas, reviewWords)
      : undefined;
    return {
      id: score.articleId,
      title: rawTitle.length > TITLE_MAX ? `${rawTitle.slice(0, TITLE_MAX - 1)}…` : rawTitle,
      score: Number.isFinite(score.score) ? score.score : 0,
      dueWordsCount: score.dueWordsCount ?? 0,
      learningZoneCount: score.learningZoneCount ?? 0,
      cefrRelation: score.cefrRelation,
      reason: score.reason
        ? score.reason.length > REASON_MAX
          ? `${score.reason.slice(0, REASON_MAX - 1)}…`
          : score.reason
        : undefined,
      reviewHits: reviewHits && reviewHits.length > 0 ? reviewHits : undefined,
    };
  });
}

export function emitRecPoolReady(
  poolSize: number,
  excludedCount?: number,
  sessionId = activeSessionId
): void {
  if (!sessionId) return;
  emitRecEvent({
    type: 'pool_ready',
    sessionId,
    at: Date.now(),
    poolSize,
    excludedCount,
  });
}

export function emitRecCandidates(
  scores: readonly RecommendationScore[],
  titleById?: ReadonlyMap<string, string>,
  meta?: {
    totalScored?: number;
    shortlistSize?: number;
    reviewWords?: readonly string[];
    lemmasById?: ReadonlyMap<string, readonly string[]>;
  },
  sessionId = activeSessionId
): void {
  if (!sessionId || scores.length === 0) return;
  const reviewWords = normalizeReviewWords(meta?.reviewWords);
  const items = summarizeRecCandidates(scores, titleById, {
    reviewWords,
    lemmasById: meta?.lemmasById,
  });
  emitRecEvent({
    type: 'candidates',
    sessionId,
    at: Date.now(),
    items,
    totalScored: meta?.totalScored,
    shortlistSize: meta?.shortlistSize ?? items.length,
    reviewWords: reviewWords.length > 0 ? reviewWords : undefined,
  });
}

export function emitRecPicked(meta: {
  articleId: string;
  title?: string;
  source: string;
  totalMs?: number;
  score?: number;
  rank?: number;
  reviewHits?: string[];
  reason?: string;
  sessionId?: string | null;
}): void {
  const sessionId = meta.sessionId ?? activeSessionId;
  if (!sessionId) return;
  const title = meta.title
    ? meta.title.length > TITLE_MAX
      ? `${meta.title.slice(0, TITLE_MAX - 1)}…`
      : meta.title
    : undefined;
  emitRecEvent({
    type: 'picked',
    sessionId,
    at: Date.now(),
    articleId: meta.articleId,
    title,
    source: meta.source,
    totalMs: meta.totalMs,
    score: meta.score,
    rank: meta.rank,
    reviewHits: meta.reviewHits?.slice(0, HIT_WORD_MAX),
    reason: meta.reason
      ? meta.reason.length > REASON_MAX
        ? `${meta.reason.slice(0, REASON_MAX - 1)}…`
        : meta.reason
      : undefined,
  });
}
