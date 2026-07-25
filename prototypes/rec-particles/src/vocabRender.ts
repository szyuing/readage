import type { VocabSimState } from './vocabSim';
import { STATUS_LABEL } from './vocabSim';
import type { VocabLevel } from './vocabTypes';

const STATUS_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  pending: { bg: '#E0F2FE', border: '#BAE6FD', text: '#075985' },
  seen: { bg: '#D1FAE5', border: '#A7F3D0', text: '#065F46' },
  looked_up: { bg: '#FEE2E2', border: '#FECACA', text: '#991B1B' },
  in_finished: { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E' },
};

const LEVEL_DOT: Record<VocabLevel, string> = {
  0: '#A89F92',
  1: '#D97706',
  2: '#0369A1',
  3: '#059669',
  4: '#C35E37',
};

export function renderVocabSim(ctx: CanvasRenderingContext2D, state: VocabSimState): void {
  const { width, height, particles, board } = state;
  ctx.fillStyle = '#F8F6F0';
  ctx.fillRect(0, 0, width, height);

  const left = board.left || Math.min(380, width * 0.32) + 40;
  const top = board.top || state.layoutTop + 24;
  const boardW = board.width || Math.max(280, width - left - 28);
  const boardH = board.height || Math.max(240, height - top - 40);

  // Notebook board
  ctx.fillStyle = '#FFFEFB';
  roundRect(ctx, left, top, boardW, boardH, 18);
  ctx.fill();
  ctx.strokeStyle = '#E7E2D5';
  ctx.lineWidth = 1;
  roundRect(ctx, left, top, boardW, boardH, 18);
  ctx.stroke();

  // Clip chips inside board so nothing paints over edges weirdly
  ctx.save();
  roundRect(ctx, left + 1, top + 1, boardW - 2, boardH - 2, 17);
  ctx.clip();

  // Header
  ctx.fillStyle = '#2A2622';
  ctx.font = '600 20px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'left';
  ctx.fillText('本篇生词本', left + 20, top + 34);

  ctx.fillStyle = '#8C8478';
  ctx.font = '400 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const visibleCount = particles.filter((p) => p.visible).length;
  const hidden = state.stats.hidden || 0;
  ctx.fillText(
    state.live
      ? `显示 ${visibleCount} 个词${hidden > 0 ? ` · 上/下滚动可看另外 ${hidden} 个` : ''}${state.maxScrollY > 0 ? ' · 可滚动' : ''} · 最近：${state.lastWord}`
      : '读主站文章时，词会一张张排开（不重叠；多了可滚轮）',
    left + 20,
    top + 56
  );

  // Legend
  const legendY = top + 78;
  let lx = left + 20;
  for (const key of ['seen', 'looked_up', 'in_finished', 'pending'] as const) {
    const st = STATUS_STYLE[key];
    ctx.fillStyle = st.bg;
    roundRect(ctx, lx, legendY - 11, 10, 10, 3);
    ctx.fill();
    ctx.strokeStyle = st.border;
    ctx.stroke();
    ctx.fillStyle = '#6B645B';
    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(STATUS_LABEL[key], lx + 14, legendY);
    lx += ctx.measureText(STATUS_LABEL[key]).width + 28;
  }

  if (particles.length === 0) {
    ctx.fillStyle = '#A89F92';
    ctx.font = '400 15px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('还是空白的。', left + boardW / 2, top + boardH * 0.5);
    ctx.font = '400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('去主站打开一篇文章，停在一段上，或点一个词。', left + boardW / 2, top + boardH * 0.5 + 28);
    ctx.restore();
    return;
  }

  const focusId = state.focusWordId && performance.now() < state.focusUntil
    ? state.focusWordId
    : null;

  // Draw non-focus first, focus last (on top but in its own band — no cover of grid)
  const ordered = [...particles]
    .filter((p) => p.visible && p.alpha > 0.05)
    .sort((a, b) => {
      if (a.wordId === focusId) return 1;
      if (b.wordId === focusId) return -1;
      return a.lastTouch - b.lastTouch;
    });

  for (const p of ordered) {
    drawChip(ctx, p, p.wordId === focusId);
  }

  // Scroll hint
  if (state.maxScrollY > 2) {
    ctx.fillStyle = 'rgba(140, 132, 120, 0.9)';
    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `滚动 ${Math.round(state.scrollY)} / ${Math.round(state.maxScrollY)}`,
      left + boardW - 16,
      top + boardH - 14
    );
  }

  ctx.restore();
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  p: import('./vocabSim').VocabParticle,
  isFocus: boolean
): void {
  const a = p.alpha;
  const w = p.w;
  const h = p.h;
  const cx = p.x - w / 2;
  const cy = p.y - h / 2;
  const st = STATUS_STYLE[p.status];

  ctx.fillStyle = `rgba(43, 39, 35, ${0.06 * a})`;
  roundRect(ctx, cx + 1, cy + 2, w, h, isFocus ? 12 : 9);
  ctx.fill();

  ctx.fillStyle = isFocus
    ? `rgba(255, 253, 248, ${0.98 * a})`
    : `rgba(255, 255, 255, ${0.96 * a})`;
  roundRect(ctx, cx, cy, w, h, isFocus ? 12 : 9);
  ctx.fill();

  ctx.strokeStyle = p.glow > 0.2
    ? (p.status === 'looked_up'
      ? `rgba(220, 38, 38, ${0.45 + p.glow * 0.4})`
      : `rgba(195, 94, 55, ${0.35 + p.glow * 0.4})`)
    : st.border;
  ctx.lineWidth = isFocus || p.glow > 0.2 ? 1.6 : 1;
  roundRect(ctx, cx, cy, w, h, isFocus ? 12 : 9);
  ctx.stroke();

  // Level dot
  ctx.fillStyle = LEVEL_DOT[p.level];
  ctx.beginPath();
  ctx.arc(cx + 14, p.y, isFocus ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();

  // Word
  ctx.fillStyle = `rgba(42, 38, 34, ${0.95 * a})`;
  ctx.font = isFocus
    ? '600 18px Georgia, "Times New Roman", serif'
    : '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (isFocus) {
    const maxWordW = w - 40;
    let label = p.wordId;
    while (ctx.measureText(label).width > maxWordW && label.length > 3) {
      label = `${label.slice(0, -2)}…`;
    }
    ctx.fillText(label, cx + 26, p.y - 8);
    ctx.font = '400 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = `rgba(107, 100, 91, ${0.95 * a})`;
    ctx.fillText(
      `${STATUS_LABEL[p.status]} · L${p.level} · ${Math.round(p.memoryScore)}`,
      cx + 26,
      p.y + 14
    );
  } else {
    const pill = STATUS_LABEL[p.status];
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const pw = ctx.measureText(pill).width + 12;
    const maxWordW = w - 26 - pw - 16;
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    let label = p.wordId;
    while (ctx.measureText(label).width > maxWordW && label.length > 3) {
      label = `${label.slice(0, -2)}…`;
    }
    ctx.fillText(label, cx + 26, p.y);

    const px = cx + w - pw - 8;
    const py = p.y - 9;
    ctx.fillStyle = st.bg;
    roundRect(ctx, px, py, pw, 18, 6);
    ctx.fill();
    ctx.fillStyle = st.text;
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pill, px + pw / 2, p.y + 1);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function syncVocabHud(state: VocabSimState): void {
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('hud-title', state.title);
  set('hud-pipeline', state.lastEvent);
  set('hud-source', state.articleId === '—' ? '—' : state.articleId.slice(0, 40));
  set('hud-count', String(state.particles.filter((p) => p.visible).length));
  set(
    'hud-stats',
    `看见 ${state.stats.seen} · 查过 ${state.stats.looked_up} · 读过 ${state.stats.in_finished} · 待复习 ${state.stats.pending}${state.stats.hidden ? ` · 收起 ${state.stats.hidden}` : ''}`
  );
  set('hud-ms', state.live ? '跟读中' : '等待中');
  set('hud-words', state.lastWord);
  set('hud-hits', state.lastStory);

  const reason = document.getElementById('hud-reason');
  if (reason) {
    reason.textContent = state.lastStory;
  }

  document.querySelectorAll('#pipeline-steps [data-step]').forEach((el) => {
    el.classList.remove('active', 'done');
  });
}
