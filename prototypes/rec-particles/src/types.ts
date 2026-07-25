export const REC_PARTICLES_CHANNEL = 'rec-particles';

export type RecPhase = 'catalog' | 'local' | 'library' | 'ai';

export type PipelineStage =
  | 'idle'
  | 'catalog'
  | 'filter'
  | 'score'
  | 'shortlist'
  | 'pick'
  | 'hydrate';

export interface RecCandidateItem {
  id: string;
  title: string;
  score: number;
  dueWordsCount: number;
  learningZoneCount: number;
  cefrRelation?: string;
  reason?: string;
  /** Real review/due lemmas found in this article. */
  reviewHits?: string[];
}

export type RecParticleEvent =
  | {
      type: 'session_start';
      sessionId: string;
      at: number;
      topic?: string;
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

export function isRecParticleEvent(value: unknown): value is RecParticleEvent {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'session_start'
    || type === 'phase'
    || type === 'catalog_loaded'
    || type === 'pool_ready'
    || type === 'candidates'
    || type === 'picked'
    || type === 'idle'
  );
}

export const PIPELINE_LABELS: Record<PipelineStage, string> = {
  idle: '等待主站真实推荐',
  catalog: '① 杂志库全量入场',
  filter: '② 去掉已读 / 本轮见过',
  score: '③ 全量候选打分排序',
  shortlist: '④ 截取头部 ~48',
  pick: '⑤ 日种子在头部挑赢家',
  hydrate: '⑥ 下载 / 打开赢家正文',
};
