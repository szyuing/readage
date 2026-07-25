import { connectRecBus, makeDemoLoop, type LearningEvent } from './bus';
import { createSimState, onPipelineEvent, stepSim } from './sim';
import { renderSim, syncHud } from './render';
import { isRecParticleEvent, type RecParticleEvent } from './types';
import { isVocabParticleEvent } from './vocabTypes';
import { applyVocabEvent, createVocabSimState, stepVocabSim } from './vocabSim';
import { renderVocabSim, syncVocabHud } from './vocabRender';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const statusEl = document.getElementById('status');
const rawCtx = canvas.getContext('2d');
if (!rawCtx) throw new Error('Canvas 2D unavailable');
const ctx: CanvasRenderingContext2D = rawCtx;

const params = new URLSearchParams(window.location.search);
const allowDemo = params.get('demo') === '1';
const initialMode = params.get('mode') === 'recommend' ? 'recommend' : 'vocab';

type ViewMode = 'recommend' | 'vocab';
let viewMode: ViewMode = initialMode;

const recState = createSimState();
const vocabState = createVocabSimState();
let stopDemo: (() => void) | null = null;
let lastFrame = performance.now();

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  recState.width = w;
  recState.height = h;
  vocabState.width = w;
  vocabState.height = h;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function setStatus(mode: 'live' | 'demo' | 'wait', text: string): void {
  if (!statusEl) return;
  statusEl.className = mode === 'wait' ? 'demo' : mode;
  statusEl.textContent = text;
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  document.querySelectorAll('[data-view-mode]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-view-mode') === mode);
  });
  const steps = document.getElementById('pipeline-steps');
  if (steps) steps.style.display = mode === 'recommend' ? '' : 'none';
  const legend = document.querySelector('.legend');
  if (legend) {
    legend.innerHTML = mode === 'vocab'
      ? '<strong>真实词汇：</strong>段落停留≈曝光 · 点词≈薄弱信号 · 读完=本篇 lemma 标记。颜色=L0–L4，靠近中心=MS 更高。'
      : '<strong>真实推荐：</strong>全库打分→过滤→头部→日种子→打开正文。默认不模拟。';
  }
  if (mode === 'vocab') syncVocabHud(vocabState);
  else syncHud(recState);
}

function handleRecEvent(event: RecParticleEvent, transport: string): void {
  if (transport === 'demo' && recState.live) return;
  if (transport !== 'demo') {
    recState.live = true;
    if (stopDemo) {
      stopDemo();
      stopDemo = null;
    }
    if (viewMode === 'recommend') {
      setStatus('live', `Live · 真实推荐 · ${transport}`);
    }
  }

  switch (event.type) {
    case 'session_start':
      onPipelineEvent(recState, { type: 'session' });
      recState.phase = 'idle';
      recState.source = '—';
      recState.totalMs = null;
      recState.reviewWords = event.reviewWords || [];
      recState.winnerTitle = event.topic
        ? `真实推荐：「${event.topic}」`
        : '真实推荐进行中…';
      recState.winnerReason = recState.reviewWords.length
        ? `本轮目标复习词（真实 due）：${recState.reviewWords.join(', ')}`
        : '本轮无 due 复习词 · 将按 CEFR / 学习区全库排序';
      if (event.userLevel) recState.winnerReason += ` · 等级 ${event.userLevel}`;
      break;
    case 'phase':
      recState.phase = event.phase;
      break;
    case 'catalog_loaded':
      recState.phase = 'catalog';
      onPipelineEvent(recState, { type: 'catalog', size: event.catalogSize });
      break;
    case 'pool_ready':
      onPipelineEvent(recState, {
        type: 'pool',
        poolSize: event.poolSize,
        excludedCount: event.excludedCount,
      });
      break;
    case 'candidates':
      if (event.reviewWords?.length) recState.reviewWords = event.reviewWords;
      onPipelineEvent(recState, {
        type: 'shortlist',
        items: event.items,
        totalScored: event.totalScored ?? event.items.length,
      });
      break;
    case 'picked':
      recState.source = event.source;
      recState.totalMs = event.totalMs ?? null;
      onPipelineEvent(recState, {
        type: 'picked',
        articleId: event.articleId,
        title: event.title,
        reviewHits: event.reviewHits,
        score: event.score,
        rank: event.rank,
        reason: event.reason,
      });
      break;
    default:
      break;
  }
  if (viewMode === 'recommend') syncHud(recState);
}

function handleEvent(event: LearningEvent, transport: string): void {
  if (isVocabParticleEvent(event)) {
    applyVocabEvent(vocabState, event);
    if (viewMode === 'vocab') {
      setStatus('live', `Live · 真实词汇 · ${transport} · ${event.type}`);
      syncVocabHud(vocabState);
    }
    // Auto-switch to vocab when first vocab event arrives in wait mode
    if (viewMode === 'recommend' && !recState.live && event.type.startsWith('vocab_')) {
      // keep recommend mode unless user chose vocab
    }
    return;
  }
  if (isRecParticleEvent(event)) {
    handleRecEvent(event, transport);
  }
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (viewMode === 'vocab') {
    stepVocabSim(vocabState, dt);
    renderVocabSim(ctx, vocabState);
    if (Math.floor(now / 200) !== Math.floor((now - dt * 1000) / 200)) {
      syncVocabHud(vocabState);
    }
  } else {
    stepSim(recState, dt);
    renderSim(ctx, recState);
    if (Math.floor(now / 200) !== Math.floor((now - dt * 1000) / 200)) {
      syncHud(recState);
    }
  }
  requestAnimationFrame(frame);
}

resize();
window.addEventListener('resize', resize);

document.querySelectorAll('[data-view-mode]').forEach((el) => {
  el.addEventListener('click', () => {
    const mode = el.getAttribute('data-view-mode') as ViewMode;
    if (mode === 'recommend' || mode === 'vocab') setViewMode(mode);
  });
});

setViewMode(viewMode);

const disconnectBus = connectRecBus(handleEvent, (status) => {
  if (recState.live || vocabState.live) return;
  if (status.ok) {
    setStatus(
      'wait',
      viewMode === 'vocab'
        ? `已连接 · 请在主站阅读/点词 · ${status.apiBase}`
        : `已连接 · 请在主站点推荐 · ${status.apiBase}`
    );
  } else {
    setStatus('wait', status.detail);
  }
});

if (allowDemo && viewMode === 'recommend') {
  stopDemo = makeDemoLoop((event, transport) => {
    if (isRecParticleEvent(event)) handleRecEvent(event, transport);
  });
  setStatus('demo', 'Demo 模式（?demo=1）· 非真实数据');
} else {
  setStatus(
    'wait',
    viewMode === 'vocab'
      ? '词汇模式 · 打开文章阅读/点词即可看到真实粒子变化'
      : '推荐模式 · 主站点推荐后显示真实流水线'
  );
}

requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => {
  disconnectBus();
  stopDemo?.();
});
