import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ArticleWordEvidence,
  DailyWordEvidence,
  FinalizationTask,
  RawWordEvent,
  WordMemoryState,
} from '../src/lib/memoryV2/types';
import type { MemoryStorage } from '../src/lib/memoryV2/storage';
import {
  getDefaultMemoryStore,
  MemoryV2Store,
  setDefaultMemoryStore,
} from '../src/lib/memoryV2/memoryStore';

class MemoryStorageFake implements MemoryStorage {
  raw = new Map<string, RawWordEvent[]>();
  article = new Map<string, ArticleWordEvidence>();
  daily = new Map<string, DailyWordEvidence>();
  states = new Map<string, WordMemoryState>();
  tasks = new Map<string, FinalizationTask>();
  failNextWrite = false;

  private rawKey(userId: string, wordId: string, localDate: string) {
    return `${userId}:${wordId}:${localDate}`;
  }

  async saveRawEvent(event: RawWordEvent): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      const error = new Error('exceeded the quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    const key = this.rawKey(event.userId, event.wordId, event.localDate);
    const list = this.raw.get(key) ?? [];
    list.push(event);
    this.raw.set(key, list);
  }

  async saveRawEvents(events: RawWordEvent[]): Promise<void> {
    for (const event of events) await this.saveRawEvent(event);
  }

  async getRawEventsByDate(userId: string, wordId: string, localDate: string) {
    return this.raw.get(this.rawKey(userId, wordId, localDate)) ?? [];
  }

  async getRawEventsByDateRange() {
    return [];
  }

  async deleteRawEventsByDate(userId: string, wordId: string, localDate: string) {
    this.raw.delete(this.rawKey(userId, wordId, localDate));
  }

  async saveArticleEvidence(evidence: ArticleWordEvidence): Promise<void> {
    this.article.set(
      `${evidence.userId}:${evidence.wordId}:${evidence.articleId}:${evidence.localDate}`,
      evidence
    );
  }

  async getArticleEvidence(
    userId: string,
    wordId: string,
    articleId: string,
    localDate: string
  ) {
    return (
      this.article.get(`${userId}:${wordId}:${articleId}:${localDate}`) ?? null
    );
  }

  async getArticleEvidencesByDate(userId: string, wordId: string, localDate: string) {
    return [...this.article.values()].filter(
      (item) =>
        item.userId === userId &&
        item.wordId === wordId &&
        item.localDate === localDate
    );
  }

  async saveDailyEvidence(evidence: DailyWordEvidence): Promise<void> {
    this.daily.set(`${evidence.userId}:${evidence.wordId}:${evidence.localDate}`, evidence);
  }

  async getDailyEvidence(userId: string, wordId: string, localDate: string) {
    return this.daily.get(`${userId}:${wordId}:${localDate}`) ?? null;
  }

  async getUnfinalizedDailyEvidence(userId: string) {
    return [...this.daily.values()].filter(
      (item) => item.userId === userId && !item.finalizedAt
    );
  }

  async getUnfinalizedDailyEvidenceByDate(userId: string, localDate: string) {
    return [...this.daily.values()].filter(
      (item) =>
        item.userId === userId &&
        item.localDate === localDate &&
        !item.finalizedAt
    );
  }

  async markDailyEvidenceFinalized(
    userId: string,
    wordId: string,
    localDate: string,
    finalizedAt: string
  ) {
    const key = `${userId}:${wordId}:${localDate}`;
    const current = this.daily.get(key);
    if (!current) return;
    this.daily.set(key, { ...current, finalizedAt });
  }

  async saveMemoryState(state: WordMemoryState): Promise<void> {
    this.states.set(`${state.userId}:${state.wordId}`, state);
  }

  async getMemoryState(userId: string, wordId: string) {
    return this.states.get(`${userId}:${wordId}`) ?? null;
  }

  async getBatchMemoryStates(userId: string, wordIds: string[]) {
    const map = new Map<string, WordMemoryState>();
    for (const wordId of wordIds) {
      const state = await this.getMemoryState(userId, wordId);
      if (state) map.set(wordId, state);
    }
    return map;
  }

  async getAllMemoryStates(userId: string) {
    return [...this.states.values()].filter((state) => state.userId === userId);
  }

  async createFinalizationTask(task: FinalizationTask): Promise<void> {
    this.tasks.set(`${task.userId}:${task.localDate}`, task);
  }

  async getPendingFinalizationTasks(userId: string) {
    return [...this.tasks.values()].filter((task) => task.userId === userId);
  }

  async deleteFinalizationTask(userId: string, localDate: string): Promise<void> {
    this.tasks.delete(`${userId}:${localDate}`);
  }
}

afterEach(() => {
  setDefaultMemoryStore(null);
});

describe('MemoryV2Store', () => {
  it('marks ready after start and only finalizes once under concurrent calls', async () => {
    const storage = new MemoryStorageFake();
    let finalizeCalls = 0;
    const store = new MemoryV2Store({
      storage,
      userId: 'u1',
      timezone: 'Asia/Shanghai',
      now: () => new Date('2026-07-24T16:30:00.000Z'),
    });

    const original = store.system.finalizeHistoricalDates.bind(store.system);
    store.system.finalizeHistoricalDates = async (...args) => {
      finalizeCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return original(...args);
    };

    await Promise.all([store.start(), store.finalizeIfNeeded(), store.ensureReady()]);

    assert.equal(store.getSnapshot().ready, true);
    assert.equal(finalizeCalls, 1);
    assert.ok(store.getSnapshot().version >= 1);
  });

  it('stays degraded after finalization failure and retries on the next start', async () => {
    const storage = new MemoryStorageFake();
    const store = new MemoryV2Store({
      storage,
      userId: 'u1',
      timezone: 'UTC',
      now: () => new Date('2026-07-24T12:00:00.000Z'),
    });

    let attempts = 0;
    store.system.finalizeHistoricalDates = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary IndexedDB failure');
    };

    await assert.rejects(() => store.start(), /temporary IndexedDB failure/);
    assert.equal(store.getSnapshot().ready, false);
    assert.equal(store.getSnapshot().status, 'degraded');
    assert.equal(store.getSnapshot().retryable, true);
    assert.match(
      store.getSnapshot().lifecycleError ?? '',
      /temporary IndexedDB failure/
    );

    let finishRetry: (() => void) | null = null;
    store.system.finalizeHistoricalDates = async () => {
      attempts += 1;
      await new Promise<void>((resolve) => {
        finishRetry = resolve;
      });
    };

    const retry = store.start();
    assert.equal(store.getSnapshot().ready, false);
    assert.equal(store.getSnapshot().status, 'initializing');
    assert.equal(store.getSnapshot().retryable, false);
    assert.equal(store.getSnapshot().lifecycleError, null);
    finishRetry?.();
    await retry;

    assert.equal(attempts, 2);
    assert.equal(store.getSnapshot().ready, true);
    assert.equal(store.getSnapshot().status, 'ready');
    assert.equal(store.getSnapshot().retryable, false);
    assert.equal(store.getSnapshot().lifecycleError, null);
  });

  it('uses options when creating the process-wide default store', () => {
    const storage = new MemoryStorageFake();
    const now = () => new Date('2026-07-24T12:00:00.000Z');

    const store = getDefaultMemoryStore({
      storage,
      userId: 'configured-user',
      timezone: 'UTC',
      now,
    });

    assert.equal(store.userId, 'configured-user');
    assert.equal(store.timezone, 'UTC');
    assert.equal(store.getLocalDate(), '2026-07-24');
    assert.equal(getDefaultMemoryStore(), store);
  });

  it('bumps version after a successful exposure write', async () => {
    const storage = new MemoryStorageFake();
    const store = new MemoryV2Store({
      storage,
      userId: 'u1',
      timezone: 'UTC',
      now: () => new Date('2026-07-24T12:00:00.000Z'),
    });
    await store.start();
    const versionBefore = store.getSnapshot().version;

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    await store.recordExposure('hello', 'article-1', 'occ-1');
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.ok(store.getSnapshot().version > versionBefore);
    assert.ok(notified >= 1);
    unsubscribe();
  });

  it('detects local day boundary changes', async () => {
    const storage = new MemoryStorageFake();
    let nowMs = Date.parse('2026-07-23T16:30:00.000Z'); // Shanghai 00:30 on 24th? Wait: 16:30Z is 00:30+8 next day
    // 2026-07-23T15:30:00Z = 2026-07-23 23:30 Shanghai
    nowMs = Date.parse('2026-07-23T15:30:00.000Z');

    const store = new MemoryV2Store({
      storage,
      userId: 'u1',
      timezone: 'Asia/Shanghai',
      now: () => new Date(nowMs),
    });
    await store.start();
    assert.equal(store.getSnapshot().currentLocalDate, '2026-07-23');

    nowMs = Date.parse('2026-07-23T16:30:00.000Z'); // 2026-07-24 00:30 Shanghai
    const crossed = await store.checkDayBoundary();
    assert.equal(crossed, true);
    assert.equal(store.getSnapshot().currentLocalDate, '2026-07-24');
  });

  it('surfaces quota errors on the snapshot', async () => {
    const storage = new MemoryStorageFake();
    storage.failNextWrite = true;
    const store = new MemoryV2Store({
      storage,
      userId: 'u1',
      timezone: 'UTC',
      now: () => new Date('2026-07-24T12:00:00.000Z'),
    });
    await store.start();

    await assert.rejects(() =>
      store.recordExposure('hello', 'article-1', 'occ-1')
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.match(store.getSnapshot().storageError ?? '', /存储空间不足/);
  });
});
