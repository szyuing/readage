import type { SimState } from './sim';
import type { PipelineStage } from './types';

/** Paper-reading palette from UI_DESIGN_SYSTEM.md */
const PAPER = {
  bg: '#F8F6F0',
  panel: '#FAF8F3',
  tertiary: '#EFECE3',
  border: '#E3DDD1',
  borderMid: '#DCD5C7',
  text: '#2B2723',
  muted: '#8C8478',
  secondary: '#5B544C',
  accent: '#C35E37',
  accentSoft: '#F3E4DA',
  success: '#059669',
  successSoft: 'rgba(5, 150, 105, 0.12)',
  warning: '#D97706',
  warningSoft: 'rgba(253, 230, 138, 0.45)',
  error: '#DC2626',
  errorSoft: 'rgba(220, 38, 38, 0.10)',
  info: '#0369A1',
  infoSoft: 'rgba(3, 105, 161, 0.08)',
  highlight: '#FDE68A',
  pool: '#A89F92',
  poolDeep: '#777066',
};

function phaseWash(pipeline: PipelineStage): string {
  switch (pipeline) {
    case 'catalog':
      return PAPER.infoSoft;
    case 'filter':
      return PAPER.errorSoft;
    case 'score':
      return PAPER.successSoft;
    case 'shortlist':
      return 'rgba(195, 94, 55, 0.07)';
    case 'pick':
      return PAPER.warningSoft;
    case 'hydrate':
      return 'rgba(195, 94, 55, 0.10)';
    default:
      return 'rgba(239, 236, 227, 0.35)';
  }
}

/** Map particle role + hue into design-system-aligned fills. */
function particleFill(
  role: string,
  hue: number,
  alpha: number
): { fill: string; glow: string; trail: string } {
  if (role === 'winner') {
    return {
      fill: `rgba(195, 94, 55, ${alpha})`,
      glow: `rgba(253, 230, 138, ${0.55 * alpha})`,
      trail: `rgba(195, 94, 55, ${0.22 * alpha})`,
    };
  }
  if (role === 'excluded') {
    return {
      fill: `rgba(220, 38, 38, ${0.35 * alpha})`,
      glow: `rgba(220, 38, 38, ${0.08 * alpha})`,
      trail: `rgba(220, 38, 38, ${0.08 * alpha})`,
    };
  }
  if (role === 'culled') {
    return {
      fill: `rgba(140, 132, 120, ${0.25 * alpha})`,
      glow: `rgba(140, 132, 120, ${0.05 * alpha})`,
      trail: `rgba(140, 132, 120, ${0.05 * alpha})`,
    };
  }
  if (role === 'shortlist') {
    // Terracotta family with slight CEFR hue tilt
    const tilt = ((hue % 60) - 30) / 120;
    const r = Math.round(195 + tilt * 20);
    const g = Math.round(94 + tilt * 30);
    const b = Math.round(55 + tilt * 10);
    return {
      fill: `rgba(${r}, ${g}, ${b}, ${alpha})`,
      glow: `rgba(195, 94, 55, ${0.22 * alpha})`,
      trail: `rgba(195, 94, 55, ${0.18 * alpha})`,
    };
  }
  // pool — warm gray ink on paper
  return {
    fill: `rgba(119, 112, 102, ${0.55 * alpha})`,
    glow: `rgba(168, 159, 146, ${0.12 * alpha})`,
    trail: `rgba(119, 112, 102, ${0.08 * alpha})`,
  };
}

export function renderSim(ctx: CanvasRenderingContext2D, state: SimState): void {
  const { width, height, particles } = state;

  // Paper ground
  ctx.fillStyle = PAPER.bg;
  ctx.fillRect(0, 0, width, height);

  // Soft vignette (reading lamp, not sci-fi)
  const vignette = ctx.createRadialGradient(
    width / 2,
    height * 0.42,
    Math.min(width, height) * 0.15,
    width / 2,
    height * 0.42,
    Math.min(width, height) * 0.72
  );
  vignette.addColorStop(0, 'rgba(250, 248, 243, 0.9)');
  vignette.addColorStop(1, 'rgba(232, 226, 214, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  // Stage wash (semantic, low chroma)
  ctx.fillStyle = phaseWash(state.pipeline);
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = width <= 720 ? height * 0.25 : height / 2 + 12;
  const ringScale = width <= 720 ? 0.10 : 0.14;

  // Quiet orbit rings — like notebook guides
  ctx.strokeStyle = 'rgba(227, 221, 209, 0.9)';
  ctx.lineWidth = 1;
  for (const r of [ringScale, ringScale * 2, ringScale * 3]) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(width, height) * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center reading focus
  const core = ctx.createRadialGradient(
    cx,
    cy,
    4,
    cx,
    cy,
    Math.min(width, height) * (width <= 720 ? 0.16 : 0.22)
  );
  if (state.pipeline === 'hydrate') {
    core.addColorStop(0, 'rgba(253, 230, 138, 0.55)');
    core.addColorStop(0.45, 'rgba(243, 228, 218, 0.35)');
    core.addColorStop(1, 'rgba(243, 228, 218, 0)');
  } else {
    core.addColorStop(0, 'rgba(250, 248, 243, 0.8)');
    core.addColorStop(1, 'rgba(250, 248, 243, 0)');
  }
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(width, height) * (width <= 720 ? 0.16 : 0.22), 0, Math.PI * 2);
  ctx.fill();

  const ordered = [...particles].sort((a, b) => a.alpha - b.alpha);

  for (const p of ordered) {
    if (p.alpha < 0.02) continue;
    const { fill, glow, trail } = particleFill(p.role, p.hue, p.alpha);
    const glowR =
      p.role === 'winner' ? 18
        : p.role === 'shortlist' ? 9
          : 3;

    if (p.role === 'shortlist' || p.role === 'winner') {
      ctx.strokeStyle = trail;
      ctx.lineWidth = Math.max(1, p.radius * 0.28);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
      ctx.stroke();
    }

    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius + glowR);
    g.addColorStop(0, glow);
    g.addColorStop(1, 'rgba(248, 246, 240, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + glowR, 0, Math.PI * 2);
    ctx.fill();

    // Soft ink body
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Winner: highlight ring (selection yellow + accent)
    if (p.role === 'winner') {
      ctx.strokeStyle = `rgba(253, 230, 138, ${0.95 * p.alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        p.radius + 6 + Math.sin(state.pulse * 3.2) * 1.5,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.strokeStyle = `rgba(195, 94, 55, ${0.75 * p.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

const PIPELINE_ORDER: PipelineStage[] = [
  'catalog',
  'filter',
  'score',
  'shortlist',
  'pick',
  'hydrate',
];

function syncPipelineChips(pipeline: PipelineStage): void {
  const idx = PIPELINE_ORDER.indexOf(pipeline);
  document.querySelectorAll<HTMLElement>('[data-step], [data-guide-step]').forEach((el) => {
    const step = (el.dataset.step || el.dataset.guideStep) as PipelineStage;
    const stepIdx = PIPELINE_ORDER.indexOf(step);
    el.classList.remove('active', 'done');
    if (stepIdx >= 0 && idx >= 0 && stepIdx < idx) el.classList.add('done');
    if (step === pipeline) el.classList.add('active');
  });
}

function recommendationSummary(state: SimState): string {
  const parts: string[] = [];
  if (state.catalogSize && state.poolSize) {
    parts.push(`${state.catalogSize} 篇文章中，${state.poolSize} 篇通过初筛`);
  } else if (state.catalogSize) {
    parts.push(`已载入 ${state.catalogSize} 篇文章`);
  } else if (state.poolSize) {
    parts.push(`${state.poolSize} 篇候选等待评分`);
  }

  if (state.totalScored && !state.shortlistSize) {
    parts.push(`正在比较 ${state.totalScored} 篇候选`);
  }
  if (state.shortlistSize) {
    parts.push(`留下前 ${state.shortlistSize} 篇`);
  }
  if (state.winnerRank != null) {
    parts.push(`最终选中第 ${state.winnerRank} 名`);
  }

  return parts.join('，') || '等待主站开始推荐';
}

export function syncHud(state: SimState): void {
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set('hud-title', state.winnerTitle || '等待主站真实推荐…');
  set('hud-pipeline', state.pipelineLabel);
  set('hud-source', state.source === '—' ? '—' : state.source);
  set('hud-count', String(state.particles.filter((p) => p.alpha > 0.1).length));
  set('hud-stats', recommendationSummary(state));
  set('hud-ms', state.totalMs != null ? `${Math.round(state.totalMs)} ms` : '—');
  set(
    'hud-words',
    state.reviewWords.length ? state.reviewWords.join(', ') : '（本轮无 due 词）'
  );
  set(
    'hud-hits',
    state.winnerReviewHits.length
      ? state.winnerReviewHits.join(', ')
      : state.pipeline === 'hydrate'
        ? '（赢家未命中本轮目标词）'
        : '—'
  );
  const reason = document.getElementById('hud-reason');
  if (reason) {
    reason.textContent = state.winnerReason || '';
  }
  syncPipelineChips(state.pipeline);
}
