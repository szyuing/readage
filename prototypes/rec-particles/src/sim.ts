import type { PipelineStage, RecCandidateItem, RecPhase } from './types';
import { PIPELINE_LABELS } from './types';

export type ParticleRole = 'pool' | 'shortlist' | 'excluded' | 'winner' | 'culled';

export interface Particle {
  id: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetOrbit: number;
  score: number;
  dueWordsCount: number;
  learningZoneCount: number;
  cefrRelation?: string;
  reason?: string;
  alpha: number;
  hue: number;
  role: ParticleRole;
  birth: number;
  rank?: number;
}

export interface SimState {
  particles: Particle[];
  /** Recommender backend phase (catalog/local/…). */
  phase: RecPhase | 'idle';
  /** Visual pipeline stage matching the real flow. */
  pipeline: PipelineStage;
  pipelineLabel: string;
  source: string;
  winnerTitle: string;
  winnerReason: string;
  reviewWords: string[];
  /** Hits on the final picked article (real). */
  winnerReviewHits: string[];
  winnerScore: number | null;
  winnerRank: number | null;
  catalogSize: number;
  poolSize: number;
  excludedCount: number;
  totalScored: number;
  shortlistSize: number;
  totalMs: number | null;
  live: boolean;
  width: number;
  height: number;
  pulse: number;
  stageUntil: number;
  pendingShortlist: RecCandidateItem[] | null;
  pendingWinner: { id: string; title?: string } | null;
}

const SHORTLIST_DEFAULT = 48;

export function createSimState(): SimState {
  return {
    particles: [],
    phase: 'idle',
    pipeline: 'idle',
    pipelineLabel: PIPELINE_LABELS.idle,
    source: '—',
    winnerTitle: '等待主站真实推荐…',
    winnerReason: '请在主站点击 Recommend / 开始推荐。此处只显示真实 due 词与选中结果，无模拟数据。',
    reviewWords: [],
    winnerReviewHits: [],
    winnerScore: null,
    winnerRank: null,
    catalogSize: 0,
    poolSize: 0,
    excludedCount: 0,
    totalScored: 0,
    shortlistSize: 0,
    totalMs: null,
    live: false,
    width: 1,
    height: 1,
    pulse: 0,
    stageUntil: 0,
    pendingShortlist: null,
    pendingWinner: null,
  };
}

function setPipeline(state: SimState, pipeline: PipelineStage): void {
  state.pipeline = pipeline;
  state.pipelineLabel = PIPELINE_LABELS[pipeline];
}

/** Hue is only a light tilt; final paint uses design-system fills in render.ts */
function cefrHue(relation?: string): number {
  switch (relation) {
    case 'exact':
      return 150; // success-adjacent
    case 'adjacent-higher':
      return 200; // info-adjacent
    case 'adjacent-lower':
      return 40; // warm
    case 'far-higher':
      return 220;
    case 'far-lower':
      return 15;
    default:
      return 25; // terracotta family
  }
}

function scoreToOrbit(score: number, minScore: number, maxScore: number, maxR: number): number {
  if (maxScore <= minScore) return maxR * 0.4;
  const t = (score - minScore) / (maxScore - minScore);
  return maxR * (0.1 + (1 - Math.max(0, Math.min(1, t))) * 0.82);
}

function maxOrbit(state: SimState): number {
  return Math.min(state.width, state.height) * (state.width <= 720 ? 0.34 : 0.44);
}

function spawnCloud(
  state: SimState,
  count: number,
  idPrefix: string,
  role: ParticleRole,
  baseRadius: number
): Particle[] {
  const cx = state.width / 2;
  const cy = state.height / 2;
  const maxR = maxOrbit(state);
  const now = performance.now();
  const particles: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.2;
    const spawnR = maxR * (0.55 + Math.random() * 0.45);
    particles.push({
      id: `${idPrefix}-${i}`,
      title: `article ${i + 1}`,
      x: cx + Math.cos(angle) * spawnR,
      y: cy + Math.sin(angle) * spawnR,
      vx: (Math.random() - 0.5) * 1.2,
      vy: (Math.random() - 0.5) * 1.2,
      radius: baseRadius * (0.75 + Math.random() * 0.5),
      targetOrbit: spawnR,
      score: 0,
      dueWordsCount: 0,
      learningZoneCount: 0,
      alpha: 0,
      hue: 20 + Math.random() * 18, // warm paper ink
      role,
      birth: now + Math.random() * 200,
    });
  }
  return particles;
}

/** ① 杂志库全量入场 */
export function stageCatalogIn(state: SimState, catalogSize: number): void {
  const n = Math.max(20, Math.min(900, Math.floor(catalogSize)));
  state.catalogSize = catalogSize;
  state.poolSize = 0;
  state.excludedCount = 0;
  state.totalScored = 0;
  state.shortlistSize = 0;
  state.pendingShortlist = null;
  state.pendingWinner = null;
  setPipeline(state, 'catalog');
  state.winnerTitle = `杂志库 ${catalogSize} 篇入场`;
  state.winnerReason = 'lemma 索引 · 不重新读全文';
  state.particles = spawnCloud(state, n, 'cat', 'pool', 2.2);
  state.stageUntil = performance.now() + 900;
}

/** ② 去掉已读 / 本轮见过 */
export function stageFilter(state: SimState, poolSize: number, excludedCount?: number): void {
  const excluded = excludedCount
    ?? Math.max(0, state.catalogSize - poolSize);
  state.poolSize = poolSize;
  state.excludedCount = excluded;
  setPipeline(state, 'filter');
  state.winnerTitle = `过滤后候选 ${poolSize} 篇`;
  state.winnerReason = excluded > 0
    ? `去掉已读 / 本轮见过约 ${excluded} 篇`
    : '几乎无排除';

  // Mark a fraction as excluded and fling outward.
  const killTarget = Math.min(
    state.particles.length - 8,
    Math.max(0, Math.round(state.particles.length * (excluded / Math.max(1, state.catalogSize))))
  );
  let killed = 0;
  for (const p of state.particles) {
    if (killed >= killTarget) break;
    if (Math.random() < 0.45 || killed < killTarget * 0.5) {
      p.role = 'excluded';
      p.targetOrbit = maxOrbit(state) * (1.15 + Math.random() * 0.4);
      p.alpha = 0.35;
      p.hue = 0;
      killed += 1;
    }
  }
  state.stageUntil = performance.now() + 1000;
}

/** ③ 全量打分：剩余 pool 粒子按分进轨道（短名单数据可后到） */
export function stageScore(
  state: SimState,
  shortlist: RecCandidateItem[] = [],
  totalScored?: number
): void {
  setPipeline(state, 'score');
  const scored = totalScored
    ?? (state.poolSize || state.particles.filter((p) => p.role !== 'excluded').length);
  state.totalScored = scored;
  state.winnerTitle = `对 ${scored} 篇全量打分`;
  state.winnerReason = '到期词 · 学习区 · CEFR …';

  const alive = state.particles.filter((p) => p.role !== 'excluded');
  const maxR = maxOrbit(state);

  // Assign synthetic ranks: head gets real shortlist scores if provided.
  const head = [...shortlist].sort((a, b) => b.score - a.score);
  const minScore = head.length ? Math.min(...head.map((h) => h.score)) : 0;
  const maxScore = head.length ? Math.max(...head.map((h) => h.score)) : 100;

  // Sort alive by current distance (stable visual) then map ranks.
  alive.sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 0; i < alive.length; i += 1) {
    const p = alive[i];
    const headItem = head[i];
    if (headItem) {
      p.id = headItem.id;
      p.title = headItem.title;
      p.score = headItem.score;
      p.dueWordsCount = headItem.dueWordsCount;
      p.learningZoneCount = headItem.learningZoneCount;
      p.cefrRelation = headItem.cefrRelation;
      p.reason = headItem.reason;
      p.hue = cefrHue(headItem.cefrRelation);
      p.rank = i;
      p.role = i < SHORTLIST_DEFAULT ? 'shortlist' : 'pool';
      p.targetOrbit = scoreToOrbit(p.score, minScore, maxScore, maxR);
      p.radius = 2.4 + Math.min(8, p.learningZoneCount) * 0.2 + Math.min(3, p.dueWordsCount) * 0.25;
    } else {
      // Tail of full catalog: low synthetic scores, outer orbits.
      const t = i / Math.max(1, alive.length - 1);
      p.score = minScore - 5 - t * 40 - Math.random() * 10;
      p.rank = i;
      p.role = 'pool';
      p.hue = 18 + Math.random() * 16;
      p.targetOrbit = maxR * (0.55 + t * 0.4);
      p.radius = 1.6 + Math.random() * 1.2;
      p.title = p.title || `pool ${i}`;
    }
  }

  if (head.length) {
    state.pendingShortlist = head;
    state.shortlistSize = Math.min(SHORTLIST_DEFAULT, head.length);
  }
  state.stageUntil = performance.now() + 1400;
}

/** ④ 截取头部 ~48：非 shortlist 淡出 */
export function stageShortlist(state: SimState, shortlist?: RecCandidateItem[]): void {
  setPipeline(state, 'shortlist');
  const head = shortlist ?? state.pendingShortlist ?? [];
  state.shortlistSize = head.length || SHORTLIST_DEFAULT;
  state.winnerTitle = `截取头部 ${state.shortlistSize} 篇`;
  state.winnerReason = `全库 ${state.totalScored || state.poolSize || '—'} 篇已排序 · 只留 top`;

  const keepIds = new Set(head.map((h) => h.id));
  const useIds = keepIds.size > 0;

  // If we have explicit shortlist ids, keep those; else keep top ranks.
  let kept = 0;
  const maxKeep = state.shortlistSize || SHORTLIST_DEFAULT;
  const ordered = [...state.particles].sort((a, b) => (b.score - a.score));

  for (const p of ordered) {
    if (p.role === 'excluded') {
      p.alpha = Math.min(p.alpha, 0.08);
      continue;
    }
    const isHead = useIds ? keepIds.has(p.id) : kept < maxKeep;
    if (isHead && kept < maxKeep) {
      p.role = 'shortlist';
      p.alpha = 1;
      kept += 1;
      // Pull shortlist slightly inward band
      p.targetOrbit = Math.min(p.targetOrbit, maxOrbit(state) * 0.55);
    } else {
      p.role = 'culled';
      p.targetOrbit = maxOrbit(state) * (1.2 + Math.random() * 0.5);
      p.vx += (Math.random() - 0.5) * 8;
      p.vy += (Math.random() - 0.5) * 8;
    }
  }
  state.stageUntil = performance.now() + 1100;
}

/** ⑤ 日种子挑赢家（高亮竞争） */
export function stagePick(state: SimState): void {
  setPipeline(state, 'pick');
  state.winnerTitle = '日种子在头部中挑选…';
  state.winnerReason = '同分探索 / 稳定日随机';
  for (const p of state.particles) {
    if (p.role === 'shortlist') {
      p.targetOrbit = maxOrbit(state) * (0.18 + Math.random() * 0.22);
      p.radius = Math.max(p.radius, 4);
    } else if (p.role === 'culled' || p.role === 'excluded') {
      p.alpha = Math.min(p.alpha, 0.06);
    }
  }
  state.stageUntil = performance.now() + 900;
}

/** ⑥ 锁定赢家并「hydrate」只留一篇 */
export function stageHydrate(
  state: SimState,
  articleId: string,
  title?: string,
  meta?: {
    reviewHits?: string[];
    score?: number;
    rank?: number;
    reason?: string;
  }
): void {
  setPipeline(state, 'hydrate');
  state.pendingWinner = { id: articleId, title };
  state.winnerReviewHits = meta?.reviewHits ?? [];
  state.winnerScore = meta?.score ?? null;
  state.winnerRank = meta?.rank ?? null;
  let found = false;
  for (const p of state.particles) {
    if (p.id === articleId || (!found && p.role === 'shortlist' && title && p.title === title)) {
      p.role = 'winner';
      p.targetOrbit = Math.min(state.width, state.height) * 0.05;
      p.radius = 12;
      p.alpha = 1;
      p.hue = 18; // accent terracotta
      state.winnerTitle = title || p.title;
      const hitLine = state.winnerReviewHits.length
        ? `命中复习词：${state.winnerReviewHits.join(', ')}`
        : '本篇未命中本轮目标复习词（仍可能因 CEFR/学习区得分入选）';
      const rankLine = state.winnerRank != null
        ? `本轮评分排名第 ${state.winnerRank} 名`
        : '';
      state.winnerReason = [meta?.reason || p.reason, rankLine, hitLine].filter(Boolean).join(' · ')
        || '下载并打开这一篇正文';
      found = true;
    } else {
      p.role = p.role === 'winner' ? 'winner' : 'culled';
      if (p.role !== 'winner') {
        p.targetOrbit = maxOrbit(state) * 1.4;
        p.alpha = Math.min(p.alpha, 0.05);
      }
    }
  }
  if (!found) {
    state.winnerTitle = title || articleId;
    state.winnerReason = '下载并打开这一篇正文';
    // Spawn a single winner if missing from cloud
    const cx = state.width / 2;
    const cy = state.height / 2;
    state.particles.push({
      id: articleId,
      title: title || articleId,
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      radius: 12,
      targetOrbit: 8,
      score: 999,
      dueWordsCount: 0,
      learningZoneCount: 0,
      alpha: 1,
      hue: 18,
      role: 'winner',
      birth: performance.now(),
    });
  }
  state.stageUntil = performance.now() + 2500;
}

/**
 * Live/demo event → advance pipeline.
 * Live may skip intermediate timing; we still play stages in order when data allows.
 */
export function onPipelineEvent(
  state: SimState,
  kind:
    | { type: 'session' }
    | { type: 'catalog'; size: number }
    | { type: 'pool'; poolSize: number; excludedCount?: number }
    | { type: 'shortlist'; items: RecCandidateItem[]; totalScored?: number }
    | {
        type: 'picked';
        articleId: string;
        title?: string;
        reviewHits?: string[];
        score?: number;
        rank?: number;
        reason?: string;
      }
): void {
  switch (kind.type) {
    case 'session':
      state.particles = [];
      setPipeline(state, 'idle');
      state.winnerTitle = '真实推荐进行中…';
      state.winnerReason = '';
      state.winnerReviewHits = [];
      state.winnerScore = null;
      state.winnerRank = null;
      state.pendingShortlist = null;
      state.pendingWinner = null;
      break;
    case 'catalog':
      stageCatalogIn(state, kind.size);
      break;
    case 'pool':
      if (state.pipeline === 'idle' || state.particles.length === 0) {
        stageCatalogIn(state, kind.poolSize + (kind.excludedCount || 0));
      }
      stageFilter(state, kind.poolSize, kind.excludedCount);
      break;
    case 'shortlist':
      state.pendingShortlist = kind.items;
      if (state.pipeline === 'idle' || state.particles.length < 10) {
        const pool = kind.totalScored ?? Math.max(kind.items.length * 8, 200);
        stageCatalogIn(state, pool);
        stageFilter(state, pool, Math.floor(pool * 0.08));
      }
      stageScore(state, kind.items, kind.totalScored);
      // Shortlist stage will auto-advance via stepSim when stageUntil elapses,
      // or call immediately after score window for live catch-up:
      break;
    case 'picked':
      state.pendingWinner = { id: kind.articleId, title: kind.title };
      if (state.pipeline === 'score' || state.pipeline === 'filter' || state.pipeline === 'catalog') {
        stageShortlist(state, state.pendingShortlist ?? undefined);
      }
      if (state.pipeline !== 'pick' && state.pipeline !== 'hydrate') {
        stagePick(state);
      }
      stageHydrate(state, kind.articleId, kind.title, {
        reviewHits: kind.reviewHits,
        score: kind.score,
        rank: kind.rank,
        reason: kind.reason,
      });
      break;
  }
}

/** Advance scripted stages when timers elapse (smooth full pipeline). */
export function tickPipeline(state: SimState, now: number): void {
  if (now < state.stageUntil) return;

  if (state.pipeline === 'score' && state.pendingShortlist) {
    stageShortlist(state, state.pendingShortlist);
    return;
  }
  if (state.pipeline === 'shortlist') {
    stagePick(state);
    return;
  }
  if (state.pipeline === 'pick' && state.pendingWinner) {
    stageHydrate(state, state.pendingWinner.id, state.pendingWinner.title, {
      reviewHits: state.winnerReviewHits,
      score: state.winnerScore ?? undefined,
      rank: state.winnerRank ?? undefined,
    });
  }
}

export function stepSim(state: SimState, dt: number): void {
  const now = performance.now();
  tickPipeline(state, now);

  const cx = state.width / 2;
  const cy = state.height / 2;
  state.pulse += dt;
  const particles = state.particles;
  const doSeparation = particles.length <= 90;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const nx = dx / dist;
    const ny = dy / dist;
    const target = Math.max(6, p.targetOrbit);
    const err = dist - target;

    let pull = 1.2;
    if (p.role === 'winner') pull = 3.2;
    else if (p.role === 'shortlist') pull = 1.8;
    else if (p.role === 'culled' || p.role === 'excluded') pull = 0.9;

    p.vx += -nx * err * pull * dt;
    p.vy += -ny * err * pull * dt;

    const swirl =
      p.role === 'winner' ? 0.08
        : p.role === 'shortlist' ? 0.7
          : p.role === 'pool' ? 0.35
            : 0.15;
    p.vx += -ny * swirl * dt * 40;
    p.vy += nx * swirl * dt * 40;

    if (doSeparation && (p.role === 'shortlist' || p.role === 'winner')) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const q = particles[j];
        if (q.role !== 'shortlist' && q.role !== 'winner') continue;
        const sx = p.x - q.x;
        const sy = p.y - q.y;
        const d = Math.hypot(sx, sy) || 0.0001;
        const minD = p.radius + q.radius + 5;
        if (d < minD) {
          const push = ((minD - d) / minD) * 30 * dt;
          const ux = sx / d;
          const uy = sy / d;
          p.vx += ux * push;
          p.vy += uy * push;
          q.vx -= ux * push;
          q.vy -= uy * push;
        }
      }
    }

    p.vx *= 0.95;
    p.vy *= 0.95;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;

    // Alpha targets by role
    let targetAlpha = 1;
    if (p.role === 'excluded') targetAlpha = state.pipeline === 'filter' ? 0.25 : 0.05;
    if (p.role === 'culled') targetAlpha = 0.04;
    if (p.role === 'pool' && state.pipeline === 'shortlist') targetAlpha = 0.12;
    if (p.role === 'winner') targetAlpha = 1;
    const age = (now - p.birth) / 1000;
    const fadeIn = Math.min(1, Math.max(0, age * 3));
    const goal = Math.min(targetAlpha, fadeIn === 0 && p.role === 'pool' ? targetAlpha : Math.max(targetAlpha * fadeIn, targetAlpha));
    p.alpha += (goal - p.alpha) * Math.min(1, dt * 3.5);
  }

  // Drop fully faded culled/excluded after hydrate to keep list light
  if (state.pipeline === 'hydrate' && particles.length > 80) {
    state.particles = particles.filter(
      (p) => p.role === 'winner' || p.role === 'shortlist' || p.alpha > 0.08
    );
  }
}
