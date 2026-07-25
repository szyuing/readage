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

export function isVocabParticleEvent(value: unknown): value is VocabParticleEvent {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'vocab_session'
    || type === 'vocab_exposure'
    || type === 'vocab_click'
    || type === 'vocab_article_complete'
  );
}

export const LEVEL_LABELS: Record<VocabLevel, string> = {
  0: 'L0 未稳',
  1: 'L1 依赖',
  2: 'L2 形成',
  3: 'L3 识别',
  4: 'L4 稳定',
};
