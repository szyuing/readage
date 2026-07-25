import type { VocabLevel, VocabParticleEvent, VocabWordSnapshot } from './vocabTypes';
import { LEVEL_LABELS } from './vocabTypes';

export type VocabParticleRole = 'due' | 'exposed' | 'clicked' | 'completed';

export interface VocabParticle {
  wordId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetOrbit: number;
  memoryScore: number;
  level: VocabLevel;
  alpha: number;
  role: VocabParticleRole;
  exposureCount: number;
  clickCount: number;
  flash: number; // 0..1 click flash
  birth: number;
  lastArticleId?: string;
}

export interface VocabSimState {
  particles: VocabParticle[];
  live: boolean;
  width: number;
  height: number;
  pulse: number;
  lastEvent: string;
  lastWord: string;
  articleId: string;
  sessionId: string;
  stats: {
    due: number;
    exposed: number;
    clicked: number;
    completed: number;
  };
  title: string;
  detail: string;
}

export function createVocabSimState(): VocabSimState {
  return {
    particles: [],
    live: false,
    width: 1,
    height: 1,
    pulse: 0,
    lastEvent: '等待阅读…',
    lastWord: '—',
    articleId: '—',
    sessionId: '—',
    stats: { due: 0, exposed: 0, clicked: 0, completed: 0 },
    title: '词汇熟练度 · 真实 Memory V2',
    detail: '在主站阅读：段落停留曝光、点词查词、读完一篇后，这里会实时变化。',
  };
}

function maxOrbit(state: VocabSimState): number {
  return Math.min(state.width, state.height) * 0.42;
}

function scoreOrbit(score: number, maxR: number): number {
  // Higher MS → closer to center (more mastered)
  const t = Math.max(0, Math.min(1, score / 100));
  return maxR * (0.12 + (1 - t) * 0.78);
}

function levelRadius(level: VocabLevel, score: number): number {
  return 3.5 + level * 1.4 + (score / 100) * 4;
}

function ensureParticle(
  state: VocabSimState,
  snap: VocabWordSnapshot,
  role: VocabParticleRole
): VocabParticle {
  let p = state.particles.find((row) => row.wordId === snap.wordId);
  const maxR = maxOrbit(state);
  const cx = state.width / 2;
  const cy = state.height / 2;
  if (!p) {
    const angle = Math.random() * Math.PI * 2;
    const r = maxR * (0.5 + Math.random() * 0.4);
    p = {
      wordId: snap.wordId,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
      radius: levelRadius(snap.level, snap.memoryScore),
      targetOrbit: scoreOrbit(snap.memoryScore, maxR),
      memoryScore: snap.memoryScore,
      level: snap.level,
      alpha: 0,
      role,
      exposureCount: 0,
      clickCount: 0,
      flash: 0,
      birth: performance.now(),
    };
    state.particles.push(p);
  }
  p.memoryScore = snap.memoryScore;
  p.level = snap.level;
  p.radius = levelRadius(snap.level, snap.memoryScore);
  p.targetOrbit = scoreOrbit(snap.memoryScore, maxR);
  // Role priority: clicked > completed > exposed > due
  const rank = { due: 0, exposed: 1, completed: 2, clicked: 3 } as const;
  if (rank[role] >= rank[p.role]) p.role = role;
  return p;
}

function recomputeStats(state: VocabSimState): void {
  const s = { due: 0, exposed: 0, clicked: 0, completed: 0 };
  for (const p of state.particles) {
    if (p.clickCount > 0) s.clicked += 1;
    if (p.exposureCount > 0) s.exposed += 1;
    if (p.role === 'due' && p.exposureCount === 0 && p.clickCount === 0) s.due += 1;
    if (p.role === 'completed') s.completed += 1;
  }
  // completed counted as particles marked complete this session
  s.completed = state.particles.filter((p) => p.role === 'completed').length;
  state.stats = s;
}

export function applyVocabEvent(state: VocabSimState, event: VocabParticleEvent): void {
  state.live = true;
  state.sessionId = event.sessionId;

  switch (event.type) {
    case 'vocab_session': {
      state.articleId = event.articleId || state.articleId;
      state.lastEvent = '开始阅读会话';
      state.title = event.articleId
        ? `阅读中 · ${event.articleId.slice(0, 28)}`
        : '阅读会话开始';
      if (event.dueWords?.length) {
        for (const word of event.dueWords) {
          ensureParticle(state, word, 'due');
        }
        state.detail = `到期/追踪词 ${event.dueWords.length} 个已入场（真实 Memory V2）`;
        state.lastWord = event.dueWords[0]?.wordId || '—';
      } else {
        state.detail = '等待段落曝光或点词…';
      }
      break;
    }
    case 'vocab_exposure': {
      state.articleId = event.articleId;
      state.lastEvent = `段落曝光 p${event.paragraphIndex}`;
      for (const word of event.words) {
        const p = ensureParticle(state, word, 'exposed');
        p.exposureCount += 1;
        p.lastArticleId = event.articleId;
        p.alpha = Math.max(p.alpha, 0.85);
      }
      state.lastWord = event.words[0]?.wordId || state.lastWord;
      state.detail = `曝光 ${event.words.length} 词 · 例 ${state.lastWord} · ${LEVEL_LABELS[event.words[0]?.level ?? 0]} · MS ${Math.round(event.words[0]?.memoryScore ?? 0)}`;
      state.title = '真实曝光写入 Memory V2';
      break;
    }
    case 'vocab_click': {
      state.articleId = event.articleId;
      state.lastEvent = '点词（Again 证据）';
      const p = ensureParticle(state, event.word, 'clicked');
      p.clickCount += 1;
      p.flash = 1;
      p.lastArticleId = event.articleId;
      p.alpha = 1;
      state.lastWord = event.word.wordId;
      state.detail = `点击 ${event.word.wordId} · ${LEVEL_LABELS[event.word.level]} · MS ${Math.round(event.word.memoryScore)} · 当日点击计为薄弱信号`;
      state.title = `点词 · ${event.word.wordId}`;
      break;
    }
    case 'vocab_article_complete': {
      state.articleId = event.articleId;
      state.lastEvent = '文章阅读完成';
      const lemmas = event.exposedLemmas || [];
      const snaps = event.words?.length
        ? event.words
        : lemmas.map((wordId) => ({
            wordId,
            memoryScore: 0,
            level: 0 as VocabLevel,
          }));
      for (const word of snaps) {
        const p = ensureParticle(state, word, 'completed');
        p.alpha = 1;
        p.lastArticleId = event.articleId;
      }
      // mark any exposed lemma without snapshot
      for (const lemma of lemmas) {
        if (!state.particles.some((p) => p.wordId === lemma)) {
          ensureParticle(state, { wordId: lemma, memoryScore: 0, level: 0 }, 'completed');
        }
      }
      state.lastWord = snaps[0]?.wordId || lemmas[0] || state.lastWord;
      state.detail = `读完 ${event.articleId.slice(0, 24)} · 本篇曝光 lemma ${lemmas.length} 个`;
      state.title = '文章完成 · 曝光集提交';
      break;
    }
  }
  recomputeStats(state);
}

export function stepVocabSim(state: VocabSimState, dt: number): void {
  state.pulse += dt;
  const cx = state.width / 2;
  const cy = state.height / 2;
  const particles = state.particles;
  const doSep = particles.length <= 80;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const nx = dx / dist;
    const ny = dy / dist;
    const err = dist - Math.max(8, p.targetOrbit);
    const pull = p.role === 'clicked' ? 2.2 : p.role === 'completed' ? 1.8 : 1.3;
    p.vx += -nx * err * pull * dt;
    p.vy += -ny * err * pull * dt;
    p.vx += -ny * 0.45 * dt * 40;
    p.vy += nx * 0.45 * dt * 40;

    if (doSep) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const q = particles[j];
        const sx = p.x - q.x;
        const sy = p.y - q.y;
        const d = Math.hypot(sx, sy) || 0.0001;
        const minD = p.radius + q.radius + 5;
        if (d < minD) {
          const push = ((minD - d) / minD) * 26 * dt;
          p.vx += (sx / d) * push;
          p.vy += (sy / d) * push;
          q.vx -= (sx / d) * push;
          q.vy -= (sy / d) * push;
        }
      }
    }

    p.vx *= 0.95;
    p.vy *= 0.95;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.flash = Math.max(0, p.flash - dt * 1.8);
    const age = (performance.now() - p.birth) / 1000;
    const goal = Math.min(1, 0.35 + age * 2);
    p.alpha += (goal - p.alpha) * Math.min(1, dt * 4);
  }
}
