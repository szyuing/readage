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
  memoryScore: number;
  level: VocabLevel;
  alpha: number;
  status: VocabStatus;
  exposureCount: number;
  clickCount: number;
  /** 0..1 brief highlight after event */
  glow: number;
  lastTouch: number;
  birth: number;
  /** Hidden when layout overflows board */
  visible: boolean;
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
  stats: { pending: number; seen: number; looked_up: number; in_finished: number; hidden: number };
  title: string;
  detail: string;
  layoutTop: number;
  focusWordId: string | null;
  focusUntil: number;
  /** Layout box for renderer */
  board: { left: number; top: number; width: number; height: number };
  /** Grid scroll in px (wheel). */
  scrollY: number;
  maxScrollY: number;
  /** Legacy scroll metrics retained for the layout contract and tests. */
  contentHeight: number;
  contentViewportHeight: number;
  scrollOffset: number;
}

export const STATUS_LABEL: Record<VocabStatus, string> = {
  pending: '待复习',
  seen: '看见了',
  looked_up: '查过',
  in_finished: '读过',
};

const CHIP_H = 36;
const CHIP_GAP_X = 12;
const CHIP_GAP_Y = 12;
const PAD = 20;

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
    stats: { pending: 0, seen: 0, looked_up: 0, in_finished: 0, hidden: 0 },
    title: '这是一本会动的生词本',
    detail: '不是装饰动画：词出现 = 你在文中遇见了它。',
    layoutTop: 88,
    focusWordId: null,
    focusUntil: 0,
    board: { left: 0, top: 0, width: 0, height: 0 },
    scrollY: 0,
    maxScrollY: 0,
    contentHeight: 0,
    contentViewportHeight: 0,
    scrollOffset: 0,
  };
}

function statusRank(s: VocabStatus): number {
  return { pending: 0, seen: 1, in_finished: 2, looked_up: 3 }[s];
}

function mergeStatus(cur: VocabStatus, next: VocabStatus): VocabStatus {
  if (cur === 'looked_up') return 'looked_up';
  return statusRank(next) >= statusRank(cur) ? next : cur;
}

function measureChip(wordId: string, focus = false): { w: number; h: number } {
  const len = Math.min(18, Math.max(3, wordId.length));
  if (focus) {
    return {
      w: Math.min(420, Math.max(200, 56 + len * 12)),
      h: 64,
    };
  }
  return {
    w: Math.max(88, 40 + len * 7.6),
    h: CHIP_H,
  };
}

function ensure(
  state: VocabSimState,
  snap: VocabWordSnapshot,
  status: VocabStatus
): VocabParticle {
  let p = state.particles.find((row) => row.wordId === snap.wordId);
  const size = measureChip(snap.wordId, false);
  if (!p) {
    const bx = state.board.left || state.width * 0.5;
    const by = state.board.top || state.height * 0.5;
    p = {
      wordId: snap.wordId,
      x: bx + 80,
      y: by + 100,
      vx: 0,
      vy: 0,
      targetX: bx + 80,
      targetY: by + 100,
      w: size.w,
      h: size.h,
      memoryScore: snap.memoryScore,
      level: snap.level,
      alpha: 0,
      status,
      exposureCount: 0,
      clickCount: 0,
      glow: 1,
      lastTouch: performance.now(),
      birth: performance.now(),
      visible: true,
    };
    state.particles.push(p);
  } else {
    p.status = mergeStatus(p.status, status);
    p.memoryScore = snap.memoryScore;
    p.level = snap.level;
    p.glow = 1;
    p.lastTouch = performance.now();
    p.visible = true;
  }
  return p;
}

function recomputeStats(state: VocabSimState): void {
  const s = { pending: 0, seen: 0, looked_up: 0, in_finished: 0, hidden: 0 };
  for (const p of state.particles) {
    if (!p.visible) s.hidden += 1;
    else s[p.status] += 1;
  }
  state.stats = s;
}

function updateBoardBox(state: VocabSimState): void {
  const hudW = Math.min(380, state.width * 0.32);
  const left = hudW + 40;
  const top = state.layoutTop + 24;
  const width = Math.max(280, state.width - left - 28);
  const height = Math.max(240, state.height - top - 40);
  state.board = { left, top, width, height };
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
  const hudW = Math.min(380, state.width * 0.32);
  const left = hudW + 40;
  const top = state.layoutTop + 24;
  const width = Math.max(280, state.width - left - 28);
  const height = Math.max(240, state.height - top - 40);
  return {
    left,
    top,
    width,
    height,
    contentTop: top + 96,
    contentBottom: top + height - PAD,
  };
}

/**
 * Non-overlapping flow layout:
 * 1) Focus card in exclusive top band (never shares space with grid)
 * 2) Grid chips wrap with fixed gaps; scrollY shifts the grid
 * 3) Only chips inside the grid viewport are visible — no stacking
 */
export function layoutVocabParticles(state: VocabSimState): void {
  updateBoardBox(state);
  const { left, top, width, height } = state.board;

  const headerH = 96;
  const contentLeft = left + PAD;
  const contentRight = left + width - PAD;
  const contentTop = top + headerH;
  const contentBottom = top + height - PAD;
  const contentW = contentRight - contentLeft;

  if (contentW < 80 || contentBottom - contentTop < 40) {
    for (const p of state.particles) p.visible = false;
    state.contentHeight = 0;
    state.contentViewportHeight = 0;
    state.scrollOffset = 0;
    recomputeStats(state);
    return;
  }

  const now = performance.now();
  const focusId =
    state.focusWordId && now < state.focusUntil ? state.focusWordId : null;
  const focus = focusId
    ? state.particles.find((p) => p.wordId === focusId) ?? null
    : null;

  const focusBandH = focus ? 80 : 0;
  const gridTop = contentTop + focusBandH;
  const gridBottom = contentBottom;
  const gridH = gridBottom - gridTop;

  for (const p of state.particles) p.visible = false;

  if (focus) {
    const size = measureChip(focus.wordId, true);
    focus.w = Math.min(contentW, size.w);
    focus.h = size.h;
    focus.targetX = contentLeft + contentW / 2;
    focus.targetY = contentTop + focus.h / 2;
    focus.visible = true;
  }

  if (gridH < CHIP_H) {
    recomputeStats(state);
    return;
  }

  // Most recent first; exclude focus from grid
  const queue = [...state.particles]
    .filter((p) => !focus || p.wordId !== focus.wordId)
    .sort((a, b) => b.lastTouch - a.lastTouch);

  // Pass 1: compute virtual positions in a tall content box
  type Slot = { p: VocabParticle; x: number; y: number; w: number; h: number };
  const slots: Slot[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowH = CHIP_H;
  const gridW = contentW;

  for (const p of queue) {
    const size = measureChip(p.wordId, false);
    p.w = size.w;
    p.h = size.h;
    if (cursorX > 0 && cursorX + size.w > gridW) {
      cursorX = 0;
      cursorY += rowH + CHIP_GAP_Y;
      rowH = CHIP_H;
    }
    slots.push({
      p,
      x: cursorX + size.w / 2,
      y: cursorY + size.h / 2,
      w: size.w,
      h: size.h,
    });
    rowH = Math.max(rowH, size.h);
    cursorX += size.w + CHIP_GAP_X;
  }

  const contentHeight = slots.length === 0
    ? 0
    : Math.max(...slots.map((s) => s.y + s.h / 2)) + 4;
  state.maxScrollY = Math.max(0, contentHeight - gridH);
  state.scrollY = Math.max(0, Math.min(state.scrollY, state.maxScrollY));
  state.contentHeight = contentHeight;
  state.contentViewportHeight = gridH;
  state.scrollOffset = state.scrollY;

  // Pass 2: apply scroll and mark visible only if inside grid viewport
  for (const slot of slots) {
    const viewY = slot.y - state.scrollY;
    const topEdge = viewY - slot.h / 2;
    const botEdge = viewY + slot.h / 2;
    // Fully outside viewport → hide
    if (botEdge < 0 || topEdge > gridH) {
      slot.p.visible = false;
      slot.p.targetX = contentLeft + slot.x;
      slot.p.targetY = gridTop + viewY;
      continue;
    }
    slot.p.visible = true;
    slot.p.targetX = contentLeft + slot.x;
    slot.p.targetY = gridTop + viewY;
  }

  recomputeStats(state);
}

export function scrollVocabParticles(state: VocabSimState, deltaY: number): void {
  layoutVocabParticles(state);
  state.scrollY = Math.max(0, Math.min(state.maxScrollY, state.scrollY + deltaY * 0.85));
  layoutVocabParticles(state);
  // Snap positions immediately after scroll so chips don't lag-slide into each other
  for (const p of state.particles) {
    if (!p.visible) continue;
    p.x = p.targetX;
    p.y = p.targetY;
    p.vx = 0;
    p.vy = 0;
  }
}

export function applyVocabEvent(state: VocabSimState, event: VocabParticleEvent): void {
  state.live = true;
  state.sessionId = event.sessionId;
  const now = performance.now();
  updateBoardBox(state);

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
        const p = ensure(state, word, 'seen');
        p.exposureCount += 1;
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
      const p = ensure(state, event.word, 'looked_up');
      p.clickCount += 1;
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
      const snaps = event.words?.length
        ? event.words
        : lemmas.map((wordId) => ({ wordId, memoryScore: 0, level: 0 as VocabLevel }));
      for (const word of snaps) ensure(state, word, 'in_finished');
      for (const lemma of lemmas) {
        if (!state.particles.some((p) => p.wordId === lemma)) {
          ensure(state, { wordId: lemma, memoryScore: 0, level: 0 }, 'in_finished');
        }
      }
      state.lastWord = snaps[0]?.wordId || lemmas[0] || state.lastWord;
      state.focusWordId = state.lastWord === '—' ? null : state.lastWord;
      state.focusUntil = now + 2800;
      state.title = '这篇读完了';
      state.lastStory = `本篇共记下 ${lemmas.length} 个词。查过的仍标成「查过」；其余标成「读过」。装不下的会收起，不叠在一起。`;
      state.detail = state.lastStory;
      break;
    }
  }

  layoutVocabParticles(state);
}

export function stepVocabSim(state: VocabSimState, dt: number): void {
  state.pulse += dt;
  layoutVocabParticles(state);

  for (const p of state.particles) {
    if (!p.visible) {
      p.alpha = Math.max(0, p.alpha - dt * 5);
      // Keep off the board while hidden
      p.x = p.targetX;
      p.y = p.targetY;
      p.vx = 0;
      p.vy = 0;
      continue;
    }

    // Short ease only — then hard snap to kill residual overlap
    const k = Math.min(1, dt * 16);
    p.x += (p.targetX - p.x) * k;
    p.y += (p.targetY - p.y) * k;
    if (Math.hypot(p.targetX - p.x, p.targetY - p.y) < 0.8) {
      p.x = p.targetX;
      p.y = p.targetY;
    }
    p.vx = 0;
    p.vy = 0;

    p.glow = Math.max(0, p.glow - dt * 0.85);
    const age = (performance.now() - p.birth) / 1000;
    p.alpha += (Math.min(1, age * 2.5) - p.alpha) * Math.min(1, dt * 5);
  }

  if (state.focusWordId && performance.now() > state.focusUntil) {
    state.focusWordId = null;
  }
}
