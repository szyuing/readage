/**
 * IndexedDB-backed MemoryStorage.
 * Uses compound string keys to mirror the logical localStorage layout while
 * avoiding hundreds of separate localStorage entries.
 */

import type {
  ArticleWordEvidence,
  DailyWordEvidence,
  FinalizationTask,
  RawWordEvent,
  WordMemoryState,
} from './types';
import type { MemoryStorage } from './storage';
import { LocalStorageMemoryStorage } from './localStorageImpl';

const DB_NAME = 'english-ai-memory-v2';
const DB_VERSION = 1;

const STORE = {
  rawEvents: 'rawEvents',
  articleEvidence: 'articleEvidence',
  dailyEvidence: 'dailyEvidence',
  memoryState: 'memoryState',
  finalizationTasks: 'finalizationTasks',
  meta: 'meta',
} as const;

function rawKey(userId: string, wordId: string, localDate: string): string {
  return `${userId}|${wordId}|${localDate}`;
}

function articleKey(
  userId: string,
  wordId: string,
  articleId: string,
  localDate: string
): string {
  return `${userId}|${wordId}|${articleId}|${localDate}`;
}

function dailyKey(userId: string, wordId: string, localDate: string): string {
  return `${userId}|${wordId}|${localDate}`;
}

function stateKey(userId: string, wordId: string): string {
  return `${userId}|${wordId}`;
}

function taskKey(userId: string, localDate: string): string {
  return `${userId}|${localDate}`;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbMemoryStorage implements MemoryStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE.rawEvents)) {
          db.createObjectStore(STORE.rawEvents, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE.articleEvidence)) {
          db.createObjectStore(STORE.articleEvidence, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE.dailyEvidence)) {
          db.createObjectStore(STORE.dailyEvidence, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE.memoryState)) {
          db.createObjectStore(STORE.memoryState, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE.finalizationTasks)) {
          db.createObjectStore(STORE.finalizationTasks, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE.meta)) {
          db.createObjectStore(STORE.meta, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to open Memory IndexedDB'));
    });

    return this.dbPromise;
  }

  private async withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T> | T
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = await run(store);
    await transactionDone(tx);
    return result;
  }

  async saveRawEvent(event: RawWordEvent): Promise<void> {
    await this.saveRawEvents([event]);
  }

  async saveRawEvents(events: RawWordEvent[]): Promise<void> {
    if (events.length === 0) return;
    const groups = new Map<string, RawWordEvent[]>();
    for (const event of events) {
      const key = rawKey(event.userId, event.wordId, event.localDate);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }

    await this.withStore(STORE.rawEvents, 'readwrite', async (store) => {
      for (const [key, batch] of groups) {
        const existing = (await requestToPromise(
          store.get(key)
        )) as { key: string; events: RawWordEvent[] } | undefined;
        const merged = [...(existing?.events ?? []), ...batch];
        store.put({ key, events: merged });
      }
    });
  }

  async getRawEventsByDate(
    userId: string,
    wordId: string,
    localDate: string
  ): Promise<RawWordEvent[]> {
    const key = rawKey(userId, wordId, localDate);
    const row = await this.withStore(STORE.rawEvents, 'readonly', (store) =>
      requestToPromise(store.get(key))
    ) as { events?: RawWordEvent[] } | undefined;
    return row?.events ?? [];
  }

  async getRawEventsByDateRange(
    userId: string,
    wordId: string,
    startDate: string,
    endDate: string
  ): Promise<RawWordEvent[]> {
    const all: RawWordEvent[] = [];
    await this.withStore(STORE.rawEvents, 'readonly', async (store) => {
      const prefix = `${userId}|${wordId}|`;
      const request = store.openCursor();
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const key = String(cursor.key);
          if (key.startsWith(prefix)) {
            const localDate = key.slice(prefix.length);
            if (localDate >= startDate && localDate <= endDate) {
              const value = cursor.value as { events?: RawWordEvent[] };
              all.push(...(value.events ?? []));
            }
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    });
    return all;
  }

  async deleteRawEventsByDate(
    userId: string,
    wordId: string,
    localDate: string
  ): Promise<void> {
    const key = rawKey(userId, wordId, localDate);
    await this.withStore(STORE.rawEvents, 'readwrite', (store) => {
      store.delete(key);
    });
  }

  async saveArticleEvidence(evidence: ArticleWordEvidence): Promise<void> {
    const key = articleKey(
      evidence.userId,
      evidence.wordId,
      evidence.articleId,
      evidence.localDate
    );
    await this.withStore(STORE.articleEvidence, 'readwrite', (store) => {
      store.put({ key, evidence });
    });
  }

  async getArticleEvidence(
    userId: string,
    wordId: string,
    articleId: string,
    localDate: string
  ): Promise<ArticleWordEvidence | null> {
    const key = articleKey(userId, wordId, articleId, localDate);
    const row = await this.withStore(STORE.articleEvidence, 'readonly', (store) =>
      requestToPromise(store.get(key))
    ) as { evidence?: ArticleWordEvidence } | undefined;
    return row?.evidence ?? null;
  }

  async getArticleEvidencesByDate(
    userId: string,
    wordId: string,
    localDate: string
  ): Promise<ArticleWordEvidence[]> {
    const prefix = `${userId}|${wordId}|`;
    const suffix = `|${localDate}`;
    const results: ArticleWordEvidence[] = [];
    await this.withStore(STORE.articleEvidence, 'readonly', async (store) => {
      const request = store.openCursor();
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const key = String(cursor.key);
          if (key.startsWith(prefix) && key.endsWith(suffix)) {
            const value = cursor.value as { evidence?: ArticleWordEvidence };
            if (value.evidence) results.push(value.evidence);
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    });
    return results;
  }

  async saveDailyEvidence(evidence: DailyWordEvidence): Promise<void> {
    const key = dailyKey(evidence.userId, evidence.wordId, evidence.localDate);
    await this.withStore(STORE.dailyEvidence, 'readwrite', (store) => {
      store.put({ key, evidence });
    });
  }

  async getDailyEvidence(
    userId: string,
    wordId: string,
    localDate: string
  ): Promise<DailyWordEvidence | null> {
    const key = dailyKey(userId, wordId, localDate);
    const row = await this.withStore(STORE.dailyEvidence, 'readonly', (store) =>
      requestToPromise(store.get(key))
    ) as { evidence?: DailyWordEvidence } | undefined;
    return row?.evidence ?? null;
  }

  async getUnfinalizedDailyEvidence(userId: string): Promise<DailyWordEvidence[]> {
    const results: DailyWordEvidence[] = [];
    await this.withStore(STORE.dailyEvidence, 'readonly', async (store) => {
      const request = store.openCursor();
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as { evidence?: DailyWordEvidence };
          const evidence = value.evidence;
          if (
            evidence &&
            evidence.userId === userId &&
            !evidence.finalizedAt
          ) {
            results.push(evidence);
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    });
    return results;
  }

  async getUnfinalizedDailyEvidenceByDate(
    userId: string,
    localDate: string
  ): Promise<DailyWordEvidence[]> {
    const all = await this.getUnfinalizedDailyEvidence(userId);
    return all.filter((evidence) => evidence.localDate === localDate);
  }

  async markDailyEvidenceFinalized(
    userId: string,
    wordId: string,
    localDate: string,
    finalizedAt: string
  ): Promise<void> {
    const evidence = await this.getDailyEvidence(userId, wordId, localDate);
    if (!evidence) return;
    await this.saveDailyEvidence({ ...evidence, finalizedAt });
  }

  async saveMemoryState(state: WordMemoryState): Promise<void> {
    const key = stateKey(state.userId, state.wordId);
    await this.withStore(STORE.memoryState, 'readwrite', (store) => {
      store.put({ key, state });
    });
  }

  async getMemoryState(
    userId: string,
    wordId: string
  ): Promise<WordMemoryState | null> {
    const key = stateKey(userId, wordId);
    const row = await this.withStore(STORE.memoryState, 'readonly', (store) =>
      requestToPromise(store.get(key))
    ) as { state?: WordMemoryState } | undefined;
    return row?.state ?? null;
  }

  async getBatchMemoryStates(
    userId: string,
    wordIds: string[]
  ): Promise<Map<string, WordMemoryState>> {
    const map = new Map<string, WordMemoryState>();
    for (const wordId of wordIds) {
      const state = await this.getMemoryState(userId, wordId);
      if (state) map.set(wordId, state);
    }
    return map;
  }

  async getAllMemoryStates(userId: string): Promise<WordMemoryState[]> {
    const results: WordMemoryState[] = [];
    await this.withStore(STORE.memoryState, 'readonly', async (store) => {
      const request = store.openCursor();
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as { state?: WordMemoryState };
          if (value.state?.userId === userId) results.push(value.state);
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    });
    return results;
  }

  async createFinalizationTask(task: FinalizationTask): Promise<void> {
    const key = taskKey(task.userId, task.localDate);
    await this.withStore(STORE.finalizationTasks, 'readwrite', (store) => {
      store.put({ key, task });
    });
  }

  async getPendingFinalizationTasks(userId: string): Promise<FinalizationTask[]> {
    const results: FinalizationTask[] = [];
    await this.withStore(STORE.finalizationTasks, 'readonly', async (store) => {
      const request = store.openCursor();
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as { task?: FinalizationTask };
          if (value.task?.userId === userId) results.push(value.task);
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    });
    return results;
  }

  async deleteFinalizationTask(userId: string, localDate: string): Promise<void> {
    const key = taskKey(userId, localDate);
    await this.withStore(STORE.finalizationTasks, 'readwrite', (store) => {
      store.delete(key);
    });
  }

  /** Mark migration complete so localStorage import runs once. */
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.withStore(STORE.meta, 'readwrite', (store) => {
      store.put({ key, value });
    });
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const row = await this.withStore(STORE.meta, 'readonly', (store) =>
      requestToPromise(store.get(key))
    ) as { value?: T } | undefined;
    return row?.value ?? null;
  }
}

const LS_PREFIX = 'english-ai:v2:memory';
const MIGRATION_META_KEY = 'localStorageMigratedV1';

/**
 * One-time import of legacy localStorage Memory keys into IndexedDB.
 * Leaves original keys in place until a future cleanup pass.
 */
export async function migrateLocalStorageToIndexedDb(
  target: IndexedDbMemoryStorage
): Promise<{ migrated: boolean; importedKeys: number }> {
  if (typeof localStorage === 'undefined') {
    return { migrated: false, importedKeys: 0 };
  }

  const already = await target.getMeta<boolean>(MIGRATION_META_KEY);
  if (already) return { migrated: false, importedKeys: 0 };

  let importedKeys = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LS_PREFIX)) continue;

    let value: unknown;
    try {
      value = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      continue;
    }
    if (value == null) continue;

    try {
      if (key.includes(':raw:') && !key.includes(':raw-index:')) {
        // english-ai:v2:memory:raw:user:word:date
        const parts = key.split(':');
        // [english-ai, v2, memory, raw, userId, wordId, localDate...]
        const userId = parts[4];
        const wordId = parts[5];
        const localDate = parts.slice(6).join(':');
        const events = value as RawWordEvent[];
        if (Array.isArray(events) && userId && wordId && localDate) {
          await target.saveRawEvents(events);
          importedKeys += 1;
        }
      } else if (key.includes(':article:') && !key.includes(':article-index:')) {
        await target.saveArticleEvidence(value as ArticleWordEvidence);
        importedKeys += 1;
      } else if (key.includes(':daily:') && !key.includes(':daily-index:')) {
        await target.saveDailyEvidence(value as DailyWordEvidence);
        importedKeys += 1;
      } else if (key.includes(':state:') && !key.includes(':state-index:')) {
        await target.saveMemoryState(value as WordMemoryState);
        importedKeys += 1;
      } else if (key.includes(':task:') && !key.includes(':task-index:')) {
        await target.createFinalizationTask(value as FinalizationTask);
        importedKeys += 1;
      }
    } catch (error) {
      console.error('Memory localStorage → IndexedDB migration item failed:', key, error);
    }
  }

  await target.setMeta(MIGRATION_META_KEY, true);
  return { migrated: true, importedKeys };
}

/** Prefer IndexedDB; fall back to localStorage when unavailable. */
export async function createPreferredMemoryStorage(): Promise<MemoryStorage> {
  if (typeof indexedDB === 'undefined') {
    return new LocalStorageMemoryStorage();
  }

  try {
    const idb = new IndexedDbMemoryStorage();
    // Force open + migrate before first real write.
    await idb.getMeta('warmup');
    await migrateLocalStorageToIndexedDb(idb);
    return idb;
  } catch (error) {
    console.warn('IndexedDB Memory storage unavailable; using localStorage.', error);
    return new LocalStorageMemoryStorage();
  }
}
