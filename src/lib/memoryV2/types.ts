/**
 * Memory Confidence Model V2.2
 * 每日词据聚合 + FSRS 双层记忆状态
 */

/** 原始事件类型 */
export type RawEventType = 'exposure' | 'click';

/** 原始行为事件（完整保留） */
export interface RawWordEvent {
  userId: string;
  wordId: string;
  articleId: string;
  /** 文章中的具体出现位置 */
  occurrenceId: string;
  eventType: RawEventType;
  occurredAt: string;
  /** 用户时区计算的自然日（YYYY-MM-DD） */
  localDate: string;
}

/** 文章级词据 */
export interface ArticleWordEvidence {
  userId: string;
  wordId: string;
  articleId: string;
  localDate: string;
  /** 有效曝光次数 */
  validExposureCount: number;
  /** 点击的occurrence数 */
  clickedOccurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** 每日词据聚合 */
export interface DailyWordEvidence {
  userId: string;
  wordId: string;
  localDate: string;
  /** 文章证据列表 */
  articleEvidence: ArticleWordEvidence[];
  /** 当天涉及的文章数 */
  articleCount: number;
  /** 总有效曝光数 */
  validExposureCount: number;
  /** 总点击occurrence数 */
  clickedOccurrenceCount: number;
  /** 待定评级（当天实时更新） */
  pendingGrade: 'Good' | 'Again' | null;
  /** 最终结算时间（UTC ISO） */
  finalizedAt: string | null;
}

/** FSRS 评级 */
export type FsrsGrade = 'Again' | 'Good';

/** 单词记忆状态（FSRS 主记录） */
export interface WordMemoryState {
  userId: string;
  wordId: string;
  /** FSRS Stability (days) */
  stability: number;
  /** FSRS Difficulty */
  difficulty: number;
  /** 上次正式结算时间（UTC ISO） */
  lastReview: string | null;
  /** 下次建议复现时间（UTC ISO） */
  nextReview: string;
  /** 完整 FSRS 卡片状态 */
  fsrsCard: {
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: number;
    lastReview?: string;
  };
  /** FSRS 历史评审记录 */
  fsrsReviews: Array<{
    rating: number;
    state: number;
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    lastElapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    review: string;
  }>;
}

/** Memory Score 计算参数 */
export interface MemoryScoreParams {
  /** 满级稳定天数 */
  S_cap: number;
  /** 系统对遗忘的惩罚程度 */
  gamma: number;
}

/** 默认参数 */
export const DEFAULT_MS_PARAMS: MemoryScoreParams = {
  S_cap: 180,
  gamma: 1.0,
};

/** 等级边界配置 */
export interface LevelBoundary {
  level: 0 | 1 | 2 | 3 | 4;
  minScore: number;
  maxScore: number;
  label: string;
}

export const LEVEL_BOUNDARIES: LevelBoundary[] = [
  { level: 0, minScore: 0, maxScore: 20, label: '没有稳定识别证据' },
  { level: 1, minScore: 20, maxScore: 40, label: '高度依赖帮助' },
  { level: 2, minScore: 40, maxScore: 60, label: '正在形成识别' },
  { level: 3, minScore: 60, maxScore: 85, label: '多数情况能够识别' },
  { level: 4, minScore: 85, maxScore: 100, label: '长期、稳定、低负荷识别' },
];

/** 等级显示缓存（用于滞后带平滑） */
export interface LevelDisplayCache {
  wordId: string;
  lastDisplayedLevel: 0 | 1 | 2 | 3 | 4;
  lastScore: number;
  updatedAt: string;
}

/** 结算任务 */
export interface FinalizationTask {
  userId: string;
  localDate: string;
  wordIds: string[];
  createdAt: string;
}
