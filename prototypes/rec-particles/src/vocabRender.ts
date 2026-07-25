import { getVocabBoardLayout, type VocabParticle, type VocabSimState } from './vocabSim';
import type { VocabLevel } from './vocabTypes';

const LEVEL_STYLE: Record<VocabLevel, { bg: string; border: string; dot: string; text: string }> = {
  0: { bg: '#F3F0EA', border: '#D8D0C5', dot: '#8B8277', text: '#554E46' },
  1: { bg: '#FFF5D8', border: '#EFCB6A', dot: '#B7791F', text: '#7B5314' },
  2: { bg: '#E8F4FF', border: '#8FC7EE', dot: '#2374A8', text: '#174E74' },
  3: { bg: '#E5F6F0', border: '#7DCDB5', dot: '#187B64', text: '#115949' },
  4: { bg: '#FDECE5', border: '#E9AA8D', dot: '#B55331', text: '#81351F' },
};

const STATUS_MARKER = {
  pending: '待',
  seen: '见',
  looked_up: '查',
  in_finished: '读',
};

export function renderVocabSim(ctx: CanvasRenderingContext2D, state: VocabSimState): void {
  const { width, height, particles } = state;
  const board = getVocabBoardLayout(state);
  ctx.fillStyle = '#F8F6F0';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#FFFEFB';
  roundRect(ctx, board.left - 8, board.top, board.width + 16, board.height, 18);
  ctx.fill();
  ctx.strokeStyle = '#E7E2D5';
  ctx.lineWidth = 1;
  roundRect(ctx, board.left - 8, board.top, board.width + 16, board.height, 18);
  ctx.stroke();

  ctx.fillStyle = '#2A2622';
  ctx.font = '600 20px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'left';
  ctx.fillText('本篇生词本', board.left + 20, board.top + 36);
  ctx.fillStyle = '#8C8478';
  ctx.font = '400 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(
    state.live ? `已记录 ${particles.length} 个词 · 最近：${state.lastWord}` : '读主站文章时，词会一张张出现在这里',
    board.left + 20,
    board.top + 58,
  );

  const legendY = board.top + 78;
  let legendX = board.left + 20;
  for (const level of [0, 1, 2, 3, 4] as const) {
    const style = LEVEL_STYLE[level];
    roundRect(ctx, legendX, legendY - 11, 10, 10, 3);
    ctx.fillStyle = style.bg;
    ctx.fill();
    ctx.strokeStyle = style.border;
    ctx.stroke();
    ctx.fillStyle = '#6B645B';
    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const label = `L${level}`;
    ctx.fillText(label, legendX + 14, legendY);
    legendX += ctx.measureText(label).width + 22;
  }

  if (particles.length === 0) {
    ctx.fillStyle = '#A89F92';
    ctx.font = '400 15px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('还是空白的。', board.left + board.width / 2, board.top + board.height * 0.48);
    ctx.font = '400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('去主站打开一篇文章，停在一段上，或点一个词。', board.left + board.width / 2, board.top + board.height * 0.48 + 28);
    return;
  }

  const focusId = state.focusWordId && performance.now() < state.focusUntil ? state.focusWordId : null;
  const ordered = [...particles].sort((a, b) => {
    if (a.wordId === focusId) return 1;
    if (b.wordId === focusId) return -1;
    return a.lastTouch - b.lastTouch;
  });

  ctx.save();
  ctx.beginPath();
  ctx.rect(board.left, board.contentTop, board.width, state.contentViewportHeight);
  ctx.clip();
  ctx.translate(0, -state.scrollOffset);
  for (const particle of ordered) {
    if (particle.alpha >= 0.05) drawChip(ctx, particle, particle.wordId === focusId);
  }
  ctx.restore();

  if (state.contentHeight > state.contentViewportHeight) {
    const trackHeight = state.contentViewportHeight;
    const thumbHeight = Math.max(28, trackHeight * (trackHeight / state.contentHeight));
    const maxOffset = state.contentHeight - trackHeight;
    const thumbTop = board.contentTop + (trackHeight - thumbHeight) * (state.scrollOffset / maxOffset);
    ctx.fillStyle = '#D7D0C4';
    roundRect(ctx, board.left + board.width - 7, thumbTop, 3, thumbHeight, 2);
    ctx.fill();
  }
}

function drawChip(ctx: CanvasRenderingContext2D, particle: VocabParticle, isFocus: boolean): void {
  const alpha = particle.alpha;
  const style = LEVEL_STYLE[particle.level];
  const scale = isFocus ? 1 + particle.glow * 0.04 : 1;
  const width = particle.w * scale;
  const height = particle.h * scale;
  const left = particle.x - width / 2;
  const top = particle.y - height / 2;

  ctx.fillStyle = `rgba(43, 39, 35, ${0.07 * alpha})`;
  roundRect(ctx, left + 1, top + 2, width, height, 9);
  ctx.fill();
  ctx.fillStyle = style.bg;
  roundRect(ctx, left, top, width, height, 9);
  ctx.fill();
  ctx.strokeStyle = isFocus || particle.glow > 0.2 ? '#B65332' : style.border;
  ctx.lineWidth = isFocus || particle.glow > 0.2 ? 1.6 : 1;
  roundRect(ctx, left, top, width, height, 9);
  ctx.stroke();

  ctx.fillStyle = style.dot;
  ctx.beginPath();
  ctx.arc(left + 14, particle.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = style.text;
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const lineStart = particle.labelLines.length > 1 ? particle.y - 7 : particle.y;
  particle.labelLines.forEach((line, index) => {
    ctx.fillText(line, left + 26, lineStart + index * 14);
  });

  ctx.fillStyle = 'rgba(43, 39, 35, 0.14)';
  roundRect(ctx, left + width - 23, particle.y - 9, 15, 18, 5);
  ctx.fill();
  ctx.fillStyle = '#4F4942';
  ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(STATUS_MARKER[particle.status], left + width - 15.5, particle.y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  };
  set('hud-title', state.title);
  set('hud-pipeline', state.lastEvent);
  set('hud-source', state.articleId === '—' ? '—' : state.articleId.slice(0, 40));
  set('hud-count', String(state.particles.length));
  set('hud-stats', `看见 ${state.stats.seen} · 查过 ${state.stats.looked_up} · 读过 ${state.stats.in_finished} · 待复习 ${state.stats.pending}`);
  set('hud-ms', state.live ? '跟读中' : '等待中');
  set('hud-words', state.lastWord);
  set('hud-hits', state.lastStory);
  const reason = document.getElementById('hud-reason');
  if (reason) reason.textContent = state.lastStory;
  document.querySelectorAll('#pipeline-steps [data-step]').forEach((element) => {
    element.classList.remove('active', 'done');
  });
}
