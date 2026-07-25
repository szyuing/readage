import {
  isRecParticleEvent,
  type RecParticleEvent,
} from './types';
import { isVocabParticleEvent, type VocabParticleEvent } from './vocabTypes';

export type LearningEvent = RecParticleEvent | VocabParticleEvent;

export type EventHandler = (
  event: LearningEvent,
  transport: 'broadcast' | 'poll' | 'sse' | 'demo'
) => void;

function isLearningEvent(value: unknown): value is LearningEvent {
  return isRecParticleEvent(value) || isVocabParticleEvent(value);
}

const DEFAULT_API = 'http://127.0.0.1:3000';

function apiBase(): string {
  const params = new URLSearchParams(window.location.search);
  return (params.get('api') || DEFAULT_API).replace(/\/$/, '');
}

export type BusStatusHandler = (status: {
  apiBase: string;
  ok: boolean;
  detail: string;
}) => void;

export function connectRecBus(
  onEvent: EventHandler,
  onStatus?: BusStatusHandler
): () => void {
  const cleanups: Array<() => void> = [];
  let lastSince = 0;
  let stopped = false;
  const base = apiBase();

  onStatus?.({
    apiBase: base,
    ok: false,
    detail: `Connecting to ${base}…`,
  });

  // Cross-origin: BroadcastChannel does NOT bridge :3000 ↔ :5177.
  // Real path is HTTP poll + SSE against the main app.

  let es: EventSource | null = null;
  try {
    es = new EventSource(`${base}/api/debug/recommendation-stream`);
    es.onopen = () => {
      onStatus?.({ apiBase: base, ok: true, detail: `SSE connected · ${base}` });
    };
    es.onerror = () => {
      onStatus?.({
        apiBase: base,
        ok: false,
        detail: `SSE failed · polling ${base} (restart main app if 404)`,
      });
    };
    es.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data) as unknown;
        if (isLearningEvent(data) && data.type !== 'idle') {
          onEvent(data, 'sse');
        }
      } catch {
        // ignore
      }
    };
    cleanups.push(() => es?.close());
  } catch {
    es = null;
  }

  const poll = window.setInterval(async () => {
    if (stopped) return;
    try {
      const response = await fetch(
        `${base}/api/debug/recommendation-events?since=${lastSince}`,
        { cache: 'no-store' }
      );
      if (!response.ok) {
        onStatus?.({
          apiBase: base,
          ok: false,
          detail: `API ${response.status} · 主站需重启以加载 /api/debug/recommendation-events`,
        });
        return;
      }
      const payload = await response.json() as {
        events?: unknown[];
        serverTime?: number;
      };
      onStatus?.({
        apiBase: base,
        ok: true,
        detail: `Polling OK · ${base}`,
      });
      const events = Array.isArray(payload.events) ? payload.events : [];
      for (const raw of events) {
        if (!isLearningEvent(raw)) continue;
        onEvent(raw, 'poll');
        const stamp = typeof raw.at === 'number' ? raw.at : 0;
        const extra = raw as LearningEvent & { receivedAt?: number };
        const received = typeof extra.receivedAt === 'number' ? extra.receivedAt : stamp;
        lastSince = Math.max(lastSince, stamp, received);
      }
      if (typeof payload.serverTime === 'number') {
        lastSince = Math.max(lastSince, payload.serverTime - 1);
      }
    } catch {
      onStatus?.({
        apiBase: base,
        ok: false,
        detail: `无法连接 ${base} · 请先 npm run dev 主站`,
      });
    }
  }, 500);
  cleanups.push(() => window.clearInterval(poll));

  return () => {
    stopped = true;
    for (const fn of cleanups) fn();
  };
}

const DEMO_TITLE_SEEDS = [
  'How habits compound',
  'A quiet cafe morning',
  'Markets and memory',
  'The long walk home',
  'Cities under rain',
  'Learning in public',
  'Signals in the noise',
  'Letters from summer',
  'The cost of attention',
  'Maps without borders',
  'Small rooms, big ideas',
  'Under the glass roof',
];

/**
 * Demo that fully replays the real pipeline timing:
 * catalog → filter → score → shortlist(48) → pick → hydrate
 */
export function makeDemoLoop(onEvent: EventHandler): () => void {
  let session = 0;
  const pending: number[] = [];
  let interval = 0;

  const clearPending = () => {
    for (const id of pending) window.clearTimeout(id);
    pending.length = 0;
  };

  const later = (ms: number, fn: () => void) => {
    pending.push(window.setTimeout(fn, ms));
  };

  const runOnce = () => {
    clearPending();
    session += 1;
    const sessionId = `demo-${session}`;
    const catalogSize = 658;
    const excludedCount = 52;
    const poolSize = catalogSize - excludedCount;
    const shortlistSize = 48;

    onEvent({
      type: 'session_start',
      sessionId,
      at: Date.now(),
      topic: 'English Idioms & Daily Practice',
      reviewWords: ['habit', 'compound', 'quiet', 'signal'],
      userLevel: 'B1',
    }, 'demo');

    later(200, () => {
      onEvent({ type: 'phase', sessionId, at: Date.now(), phase: 'catalog' }, 'demo');
      onEvent({
        type: 'catalog_loaded',
        sessionId,
        at: Date.now(),
        catalogSize,
        loadMs: 38,
      }, 'demo');
    });

    later(1100, () => {
      onEvent({
        type: 'pool_ready',
        sessionId,
        at: Date.now(),
        poolSize,
        excludedCount,
      }, 'demo');
    });

    later(2200, () => {
      const items = Array.from({ length: shortlistSize }, (_, index) => {
        const seed = DEMO_TITLE_SEEDS[index % DEMO_TITLE_SEEDS.length];
        const title = index < DEMO_TITLE_SEEDS.length ? seed : `${seed} · #${index + 1}`;
        const rankBias = (shortlistSize - index) / shortlistSize;
        const score = 20 + rankBias * 95 + Math.random() * 12;
        const dueWordsCount = index < 10 ? 2 + Math.floor(Math.random() * 5) : Math.floor(Math.random() * 2);
        return {
          id: `demo-${session}-a${index}`,
          title,
          score,
          dueWordsCount,
          learningZoneCount: 2 + Math.floor(Math.random() * 18),
          cefrRelation: (['exact', 'adjacent-higher', 'adjacent-lower', 'far-higher', 'far-lower'] as const)[
            index % 5
          ],
          reason: dueWordsCount >= 3 ? `命中 ${dueWordsCount} 个到期词` : '接近当前水平',
        };
      }).sort((a, b) => b.score - a.score);

      onEvent({
        type: 'candidates',
        sessionId,
        at: Date.now(),
        items,
        totalScored: poolSize,
        shortlistSize: items.length,
      }, 'demo');

      later(3200, () => {
        onEvent({
          type: 'picked',
          sessionId,
          at: Date.now(),
          articleId: items[0].id,
          title: items[0].title,
          source: 'full_catalog',
          totalMs: 210 + Math.floor(Math.random() * 90),
        }, 'demo');
      });
    });
  };

  runOnce();
  interval = window.setInterval(runOnce, 12_000);
  return () => {
    window.clearInterval(interval);
    clearPending();
  };
}
