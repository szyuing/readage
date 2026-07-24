/**
 * Shared Memory V2 store: single finalization job, versioned invalidation,
 * and day-boundary refresh coordination.
 */

import { MemorySystemV2 } from './memorySystem';
import { LocalStorageMemoryStorage } from './localStorageImpl';
import { createPreferredMemoryStorage } from './indexedDbImpl';
import type { MemoryStorage } from './storage';
import type { RawWordEvent } from './types';
import {
  getLocalDateInTimeZone,
  getSystemTimeZone,
  getUtcInstantForLocalDayEnd,
} from './dateUtils';

export type MemoryStoreListener = () => void;

export interface MemoryStoreSnapshot {
  ready: boolean;
  version: number;
  storageError: string | null;
  userId: string;
  timezone: string;
  currentLocalDate: string;
}

export interface MemoryStoreOptions {
  storage?: MemoryStorage;
  userId?: string;
  timezone?: string;
  /** Inject now for tests. */
  now?: () => Date;
}

const DEFAULT_USER_ID = 'default-user';

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    /quota/i.test(error.message) ||
    /exceeded the quota/i.test(error.message)
  );
}

export class MemoryV2Store {
  system: MemorySystemV2;
  readonly userId: string;
  readonly timezone: string;

  private ready = false;
  private version = 0;
  private storageError: string | null = null;
  private listeners = new Set<MemoryStoreListener>();
  private finalizeJob: Promise<void> | null = null;
  private lastSeenLocalDate: string;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private midnightTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => Date;
  private started = false;
  private readonly injectedStorage: boolean;

  constructor(options: MemoryStoreOptions = {}) {
    const storage = options.storage ?? new LocalStorageMemoryStorage();
    this.injectedStorage = Boolean(options.storage);
    this.system = new MemorySystemV2(storage);
    this.userId = options.userId ?? DEFAULT_USER_ID;
    this.timezone = options.timezone ?? getSystemTimeZone();
    this.now = options.now ?? (() => new Date());
    this.lastSeenLocalDate = getLocalDateInTimeZone(this.now(), this.timezone);
  }

  getSnapshot(): MemoryStoreSnapshot {
    return {
      ready: this.ready,
      version: this.version,
      storageError: this.storageError,
      userId: this.userId,
      timezone: this.timezone,
      currentLocalDate: this.lastSeenLocalDate,
    };
  }

  subscribe = (listener: MemoryStoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Start historical finalization and day-boundary watchers (idempotent). */
  async start(): Promise<void> {
    if (this.started) {
      await this.ensureReady();
      return;
    }
    this.started = true;
    // Prefer IndexedDB when available (no-op if a custom storage was injected).
    if (!this.injectedStorage) {
      try {
        const preferred = await createPreferredMemoryStorage();
        this.system = new MemorySystemV2(preferred);
      } catch (error) {
        console.warn('Preferred memory storage init failed; keeping constructor storage.', error);
      }
    }
    await this.finalizeIfNeeded();
    this.scheduleMidnightCheck();
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    await this.finalizeIfNeeded();
  }

  /**
   * Run historical finalization at most once at a time. Safe to call on focus,
   * visibility restore, and midnight.
   */
  async finalizeIfNeeded(): Promise<void> {
    if (this.finalizeJob) {
      await this.finalizeJob;
      return;
    }

    this.finalizeJob = (async () => {
      try {
        await this.system.finalizeHistoricalDates(this.userId, this.timezone);
        this.lastSeenLocalDate = getLocalDateInTimeZone(this.now(), this.timezone);
        this.storageError = null;
        this.ready = true;
        this.bumpVersion();
      } catch (error) {
        console.error('Failed to finalize historical dates:', error);
        // Still mark ready so queries can proceed with best-effort data.
        this.ready = true;
        this.bumpVersion();
        throw error;
      } finally {
        this.finalizeJob = null;
      }
    })();

    await this.finalizeJob;
  }

  /**
   * If the local calendar day changed since the last check, re-run finalization.
   * @returns true when a day boundary was crossed
   */
  async checkDayBoundary(): Promise<boolean> {
    const today = getLocalDateInTimeZone(this.now(), this.timezone);
    if (today === this.lastSeenLocalDate) {
      return false;
    }
    await this.finalizeIfNeeded();
    return true;
  }

  getLocalDate(now: Date = this.now()): string {
    return getLocalDateInTimeZone(now, this.timezone);
  }

  async recordExposure(
    wordId: string,
    articleId: string,
    occurrenceId: string
  ): Promise<void> {
    await this.recordEvent({
      userId: this.userId,
      wordId,
      articleId,
      occurrenceId,
      eventType: 'exposure',
      occurredAt: this.now().toISOString(),
      localDate: this.getLocalDate(),
    });
  }

  async recordClick(
    wordId: string,
    articleId: string,
    occurrenceId: string
  ): Promise<void> {
    await this.recordEvent({
      userId: this.userId,
      wordId,
      articleId,
      occurrenceId,
      eventType: 'click',
      occurredAt: this.now().toISOString(),
      localDate: this.getLocalDate(),
    });
  }

  /** Batch-record paragraph exposures to cut per-word storage round-trips. */
  async recordExposures(
    items: ReadonlyArray<{ wordId: string; articleId: string; occurrenceId: string }>
  ): Promise<void> {
    if (items.length === 0) return;
    const localDate = this.getLocalDate();
    const occurredAt = this.now().toISOString();
    const events: RawWordEvent[] = items.map((item) => ({
      userId: this.userId,
      wordId: item.wordId,
      articleId: item.articleId,
      occurrenceId: item.occurrenceId,
      eventType: 'exposure' as const,
      occurredAt,
      localDate,
    }));

    try {
      await this.system.recordBatchEvents(events);
      this.storageError = null;
      this.scheduleNotify();
    } catch (error) {
      if (isQuotaError(error)) {
        this.storageError = '学习记录存储空间不足，部分进度可能无法保存。';
        this.scheduleNotify();
      }
      throw error;
    }
  }

  private async recordEvent(event: RawWordEvent): Promise<void> {
    try {
      await this.system.recordEvent(event);
      this.storageError = null;
      this.scheduleNotify();
    } catch (error) {
      if (isQuotaError(error)) {
        this.storageError = '学习记录存储空间不足，部分进度可能无法保存。';
        this.scheduleNotify();
      }
      throw error;
    }
  }

  /** Debounced version bump so multi-word paragraph exposure does not thrash React. */
  private scheduleNotify(delayMs = 50): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.bumpVersion();
    }, delayMs);
  }

  private bumpVersion(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('Memory store listener failed:', error);
      }
    }
  }

  /** Schedule a timer for the next local day end (+ a small buffer). */
  scheduleMidnightCheck(): void {
    if (typeof window === 'undefined') return;
    if (this.midnightTimer) clearTimeout(this.midnightTimer);

    try {
      const today = getLocalDateInTimeZone(this.now(), this.timezone);
      const dayEnd = getUtcInstantForLocalDayEnd(today, this.timezone);
      const ms = Math.max(1_000, dayEnd.getTime() - this.now().getTime() + 1_000);
      // Cap at 24h to avoid setTimeout overflow on extreme clocks.
      const delay = Math.min(ms, 24 * 60 * 60 * 1000);
      this.midnightTimer = setTimeout(() => {
        void this.checkDayBoundary().finally(() => this.scheduleMidnightCheck());
      }, delay);
    } catch (error) {
      console.error('Failed to schedule midnight memory check:', error);
    }
  }

  dispose(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
    this.listeners.clear();
    this.started = false;
  }
}

let defaultStore: MemoryV2Store | null = null;

/** Process-wide default store used by hooks and non-React callers. */
export function getDefaultMemoryStore(): MemoryV2Store {
  if (!defaultStore) {
    defaultStore = new MemoryV2Store();
  }
  return defaultStore;
}

/** Test helper: replace or clear the default store. */
export function setDefaultMemoryStore(store: MemoryV2Store | null): void {
  defaultStore?.dispose();
  defaultStore = store;
}
