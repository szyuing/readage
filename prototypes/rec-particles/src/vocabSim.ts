import type { VocabLevel, VocabParticleEvent, VocabWordSnapshot } from './vocabTypes';
import { LEVEL_LABELS } from './vocabTypes';

/** What happened to this word in the current reading session. */
export type VocabStatus = 'pending' | 'seen' | 'looked_up' | 'in_finished';

export interface VocabParticle {
  wordId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  w: number;
  h: number;
  labelLines: string[];
  memoryScore: number;
  level: VocabLevel;
  alpha: number;
  status: VocabStatus;
  exposureCount: number;
  clickCount: number;
  glow: number;
  lastTouch: number;
  birth: number;
}

export interface VocabSimState {
  particles: VocabParticle[];
  live: boolean;
  width: number;
  height: number;
  pulse: number;
  lastEvent: string;
  lastWord: string;
  lastStory: string;
  articleId: string;
  sessionId: string;
  stats: { pending: number; seen: number; looked_up: number; in_finished: number };
  title: string;
  detail: string;
  layoutTop: number;
  focusWordId: string | null;
  focusUntil: number;
  scrollOffset: number;
  contentHeight: number;
  contentViewportHeight: number;
}

export const STATUS_LABEL: Record<VocabStatus, string> = {
  pending: '待复习',
  seen: '看见了',
  looked_up: '查过',
  in_finished: '读过',
};

export function createVocabSimState(): VocabSimState {
  return {
    particles: [],
    live: false,
    width: 1,
    height: 1,
    pulse: 0,
    lastEvent: '还没有阅读事件',
    lastWord: '—',
    lastStory: '打开主站文章，慢慢往下读或点一个词。这里会像生词本一样记下刚才发生的事。',
    articleId: '—',
    sessionId: '—',
    stats: { pending: 0, seen: 0, looked_up: 0, in_finished: 0 },
    title: '这是一本会动的生词本',
    detail: '不是装饰动画：词出现 = 你在文中遇见了它。',
    layoutTop: 88,
    focusWordId: null,
    focusUntil: 0,
    scrollOffset: 0,
    contentHeight: 0,
    contentViewportHeight: 0,
  };
}

function statusRank(status: VocabStatus): number {
  return { pending: 0, seen: 1, in_finished: 2, looked_up: 3 }[status];
}

function mergeStatus(current: VocabStatus, next: VocabStatus): VocabStatus {
  if (current === 'looked_up') return 'looked_up';
  return statusRank(next) >= statusRank(current) ? next : current;
}

function measureChip(wordId: string, maxWidth = 240): { w: number; h: number; labelLines: string[] } {
  const maxCharacters = Math.max(10, Math.floor((maxWidth - 42) / 6.4));
  const parts = wordId.split(/\s+/);
  const labelLines: string[] = [];
  let line = '';

  for (const part of parts) {
    if (!line || line.length + part.length + 1 <= maxCharacters) {
      line = line ? `${line} ${part}` : part;
    } else {
      labelLines.push(line);
      line = part;
    }
  }
  if (line) labelLines.push(line);
  if (!labelLines.length) labelLines.push(wordId);

  while (labelLines.some((item) => item.length > maxCharacters)) {
    const index = labelLines.findIndex((item) => item.length > maxCharacters);
    const item = labelLines[index];
    labelLines.splice(index, 1, item.slice(0, maxCharacters), item.slice(maxCharacters));
  }

  const longestLine = Math.max(...labelLines.map((item) => item.length));
  return {
    w: Math.min(maxWidth, Math.max(72, 34 + longestLine * 6.4)),
    h: labelLines.length > 1 ? 42 : 30,
    labelLines,
  };
}

function ensure(state: VocabSimState, snap: VocabWordSnapshot, status: VocabStatus): VocabParticle {
  let particle = state.particles.find((row) => row.wordId === snap.wordId);
  const size = measureChip(snap.wordId);
  if (!particle) {
    particle = {
      wordId: snap.wordId,
      x: state.width * 0.58,
      y: state.height * 0.55,
      vx: 0,
      vy: 0,
      targetX: state.width * 0.58,
      targetY: state.height * 0.55,
      w: size.w,
      h: size.h,
      labelLines: size.labelLines,
      memoryScore: snap.memoryScore,
      level: snap.level,
      alpha: 0,
      status,
      exposureCount: 0,
      clickCount: 0,
      glow: 1,
      lastTouch: performance.now(),
      birth: performance.now(),
    };
    state.particles.push(particle);
  } else {
    particle.status = mergeStatus(particle.status, status);
    particle.memoryScore = snap.memoryScore;
    particle.level = snap.level;
    particle.w = size.w;
    particle.h = size.h;
    particle.labelLines = size.labelLines;
    particle.glow = 1;
    particle.lastTouch = performance.now();
  }
  return particle;
}

function recomputeStats(state: VocabSimState): void {
  const stats = { pending: 0, seen: 0, looked_up: 0, in_finished: 0 };
  for (const particle of state.particles) stats[particle.status] += 1;
  state.stats = stats;
}

export interface VocabBoardLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  contentTop: number;
  contentBottom: number;
}

export function getVocabBoardLayout(
  state: Pick<VocabSimState, 'width' | 'height' | 'layoutTop'>,
): VocabBoardLayout {
  const compact = state.width <= 720;
  // Mirrors #hud: 24px left inset + a 438px maximum width + a 36px gutter.
  const left = compact ? 16 : Math.min(438, state.width - 48) + 60;
  const top = compact ? state.layoutTop + 314 : state.layoutTop + 28;
  const width = Math.max(0, state.width - left - (compact ? 16 : 36));
  const height = Math.max(0, state.height - top - (compact ? 16 : 48));
  return {
    left,
    top,
    width,
    height,
    contentTop: top + 94,
    contentBottom: top + height - 16,
  };
}

/** Packs full word labels into a board whose content is clipped and scrollable. */
export function layoutVocabParticles(state: VocabSimState): void {
  const board = getVocabBoardLayout(state);
  const maxWidth = Math.max(72, board.width - 24);
  const startX = board.left + 12;
  const maxX = board.left + board.width - 12;
  const gapX = 8;
  const gapY = 6;
  let x = startX;
  let y = board.contentTop;
  let rowHeight = 0;

  for (const particle of [...state.particles].sort((a, b) => b.lastTouch - a.lastTouch)) {
    const size = measureChip(particle.wordId, maxWidth);
    if (x > startX && x + size.w > maxX) {
      x = startX;
      y += rowHeight + gapY;
      rowHeight = 0;
    }
    particle.w = size.w;
    particle.h = size.h;
    particle.labelLines = size.labelLines;
    particle.targetX = x + size.w / 2;
    particle.targetY = y + size.h / 2;
    x += size.w + gapX;
    rowHeight = Math.max(rowHeight, size.h);
  }

  state.contentHeight = state.particles.length ? y + rowHeight - board.contentTop : 0;
  state.contentViewportHeight = Math.max(0, board.contentBottom - board.contentTop);
  state.scrollOffset = Math.min(
    Math.max(0, state.scrollOffset),
    Math.max(0, state.contentHeight - state.contentViewportHeight),
  );
}

export function scrollVocabParticles(state: VocabSimState, deltaY: number): void {
  const maxOffset = Math.max(0, state.contentHeight - state.contentViewportHeight);
  state.scrollOffset = Math.min(maxOffset, Math.max(0, state.scrollOffset + deltaY));
}

export function applyVocabEvent(state: VocabSimState, event: VocabParticleEvent): void {
  state.live = true;
  state.sessionId = event.sessionId;
  const now = performance.now();

  switch (event.type) {
    case 'vocab_session': {
      state.articleId = event.articleId || state.articleId;
      state.lastEvent = '开始读一篇文章';
      state.title = '开始读了';
      state.lastStory = '下面出现的词，都是你在这篇里真实遇见或查过的。';
      if (event.dueWords?.length) {
        for (const word of event.dueWords) ensure(state, word, 'pending');
        state.detail = `先放了 ${event.dueWords.length} 个待复习词`;
        state.lastWord = event.dueWords[0]?.wordId ?? '—';
      } else {
        state.detail = '还没有词。往下读一段，或点一个词试试。';
      }
      state.focusWordId = null;
      break;
    }
    case 'vocab_exposure': {
      state.articleId = event.articleId;
      state.lastEvent = '读到一段（曝光）';
      for (const word of event.words) {
        const particle = ensure(state, word, 'seen');
        particle.exposureCount += 1;
      }
      const sample = event.words[0];
      state.lastWord = sample?.wordId ?? state.lastWord;
      state.focusWordId = sample?.wordId ?? null;
      state.focusUntil = now + 2600;
      state.title = sample ? `看见了「${sample.wordId}」` : '看见了一批词';
      state.lastStory = sample
        ? `你在文中停住看了一段。系统记下「${sample.wordId}」等 ${event.words.length} 个词被看见（还没点开查）。${LEVEL_LABELS[sample.level]} · 分数 ${Math.round(sample.memoryScore)}。`
        : `这一段曝光了 ${event.words.length} 个词。`;
      state.detail = state.lastStory;
      break;
    }
    case 'vocab_click': {
      state.articleId = event.articleId;
      state.lastEvent = '查了一个词';
      const particle = ensure(state, event.word, 'looked_up');
      particle.clickCount += 1;
      state.lastWord = event.word.wordId;
      state.focusWordId = event.word.wordId;
      state.focusUntil = now + 3200;
      state.title = `查了「${event.word.wordId}」`;
      state.lastStory = `你点开了「${event.word.wordId}」。今天会记成偏弱信号（Again）。当前 ${LEVEL_LABELS[event.word.level]} · 分数 ${Math.round(event.word.memoryScore)}。`;
      state.detail = state.lastStory;
      break;
    }
    case 'vocab_article_complete': {
      state.articleId = event.articleId;
      state.lastEvent = '这篇文章读完了';
      const lemmas = event.exposedLemmas || [];
      const snapshots = event.words?.length
        ? event.words
        : lemmas.map((wordId) => ({ wordId, memoryScore: 0, level: 0 as VocabLevel }));
      for (const word of snapshots) ensure(state, word, 'in_finished');
      for (const lemma of lemmas) {
        if (!state.particles.some((particle) => particle.wordId === lemma)) {
          ensure(state, { wordId: lemma, memoryScore: 0, level: 0 }, 'in_finished');
        }
      }
      state.lastWord = snapshots[0]?.wordId || lemmas[0] || state.lastWord;
      state.focusWordId = state.lastWord === '—' ? null : state.lastWord;
      state.focusUntil = now + 2800;
      state.title = '这篇读完了';
      state.lastStory = `本篇共记下 ${lemmas.length} 个词。查过的仍标成「查过」；其余标成「读过」。`;
      state.detail = state.lastStory;
      break;
    }
  }

  recomputeStats(state);
  layoutVocabParticles(state);
}

export function stepVocabSim(state: VocabSimState, dt: number): void {
  state.pulse += dt;
  if (state.particles.length) layoutVocabParticles(state);

  for (const particle of state.particles) {
    particle.vx = (particle.targetX - particle.x) * 8;
    particle.vy = (particle.targetY - particle.y) * 8;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (Math.hypot(particle.targetX - particle.x, particle.targetY - particle.y) < 0.5) {
      particle.x = particle.targetX;
      particle.y = particle.targetY;
      particle.vx = 0;
      particle.vy = 0;
    }
    particle.glow = Math.max(0, particle.glow - dt * 0.85);
    const age = (performance.now() - particle.birth) / 1000;
    particle.alpha += (Math.min(1, age * 2.5) - particle.alpha) * Math.min(1, dt * 5);
  }

  if (state.focusWordId && performance.now() > state.focusUntil) {
    state.focusWordId = null;
  }
}
