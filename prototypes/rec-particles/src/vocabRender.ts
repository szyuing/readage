import type { VocabSimState } from './vocabSim';
import type { VocabLevel } from './vocabTypes';
import { LEVEL_LABELS } from './vocabTypes';

/** Design-system aligned level colors (warm paper). */
const LEVEL_COLOR: Record<VocabLevel, string> = {
  0: '119, 112, 102',   // muted
  1: '217, 119, 6',     // warning
  2: '3, 105, 161',     // info
  3: '5, 150, 105',     // success
  4: '195, 94, 55',     // accent terracotta (mastered highlight)
};

export function renderVocabSim(ctx: CanvasRenderingContext2D, state: VocabSimState): void {
  const { width, height, particles } = state;
  ctx.fillStyle = '#F8F6F0';
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width / 2,
    height * 0.42,
    Math.min(width, height) * 0.12,
    width / 2,
    height * 0.42,
    Math.min(width, height) * 0.7
  );
  vignette.addColorStop(0, 'rgba(250, 248, 243, 0.95)');
  vignette.addColorStop(1, 'rgba(232, 226, 214, 0.5)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2 + 10;

  ctx.strokeStyle = 'rgba(227, 221, 209, 0.95)';
  ctx.lineWidth = 1;
  for (const r of [0.14, 0.28, 0.42]) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(width, height) * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const ordered = [...particles].sort((a, b) => a.alpha - b.alpha);
  for (const p of ordered) {
    if (p.alpha < 0.03) continue;
    const rgb = LEVEL_COLOR[p.level];
    const flashBoost = p.flash * 0.45;
    const a = Math.min(1, p.alpha + flashBoost);

    // Click flash ring (error/orange = Again signal)
    if (p.flash > 0.05) {
      ctx.strokeStyle = `rgba(220, 38, 38, ${p.flash * 0.85})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 6 + p.flash * 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Completed soft gold ring
    if (p.role === 'completed') {
      ctx.strokeStyle = `rgba(253, 230, 138, ${0.7 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius + 10);
    glow.addColorStop(0, `rgba(${rgb}, ${0.45 * a})`);
    glow.addColorStop(1, 'rgba(248, 246, 240, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(${rgb}, ${0.75 * a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Lemma label for larger / interactive particles
    if (p.radius >= 6 || p.flash > 0.2 || p.role === 'clicked' || p.role === 'completed') {
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = `rgba(43, 39, 35, ${0.85 * a})`;
      ctx.textAlign = 'center';
      ctx.fillText(p.wordId.slice(0, 16), p.x, p.y - p.radius - 6);
    }
  }
}

export function syncVocabHud(state: VocabSimState): void {
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('hud-title', state.title);
  set('hud-pipeline', state.lastEvent);
  set('hud-source', state.articleId);
  set('hud-count', String(state.particles.length));
  set(
    'hud-stats',
    `到期示意 ${state.stats.due} · 已曝光 ${state.stats.exposed} · 已点击 ${state.stats.clicked} · 读完标记 ${state.stats.completed}`
  );
  set('hud-ms', '—');
  set('hud-words', state.lastWord);
  set('hud-hits', state.detail);
  const reason = document.getElementById('hud-reason');
  if (reason) {
    const top = [...state.particles]
      .sort((a, b) => b.clickCount - a.clickCount || b.exposureCount - a.exposureCount)
      .slice(0, 3)
      .map((p) => `${p.wordId}(${LEVEL_LABELS[p.level]},×${p.exposureCount}e/${p.clickCount}c)`)
      .join(' · ');
    reason.textContent = top
      ? `活跃词：${top}`
      : state.detail;
  }

  // Pipeline chips unused in vocab mode — mark none active
  document.querySelectorAll('#pipeline-steps [data-step]').forEach((el) => {
    el.classList.remove('active', 'done');
  });
}
