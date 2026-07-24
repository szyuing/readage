import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ArticleSession, ChatMessage } from '../types';

const PREFIX = 'english-ai:v2';

export const STORAGE_KEYS = {
  history: `${PREFIX}:articles`,
  proficiency: `${PREFIX}:proficiency`,
  events: `${PREFIX}:events`,
  sessions: `${PREFIX}:sessions`,
  activeArticleId: `${PREFIX}:activeArticleId`,
  currentScreen: `${PREFIX}:currentScreen`,
  weakPoints: `${PREFIX}:weakPoints`,
} as const;

export type StorageNormalizer<T> = (value: unknown, fallback: T) => T;


function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function normalizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const message = candidate as Partial<ChatMessage>;
    if (!['user', 'ai'].includes(String(message.sender)) || typeof message.text !== 'string') return [];
    return [{
      id: typeof message.id === 'string' ? message.id : `stored-${index}`,
      sender: message.sender as ChatMessage['sender'],
      text: message.text,
      timestamp: typeof message.timestamp === 'string' ? message.timestamp : '',
    }];
  });
}

/** Removes retired session fields while preserving reading and discussion history. */
export function normalizeArticleSessions(
  value: unknown,
  fallback: Record<string, ArticleSession>
): Record<string, ArticleSession> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;

  const sessions: Record<string, ArticleSession> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const session = candidate as Record<string, unknown>;
    sessions[key] = {
      articleId: typeof session.articleId === 'string' && session.articleId ? session.articleId : key,
      chatMessages: normalizeChatMessages(session.chatMessages),
      clickCount: normalizeCount(session.clickCount),
      discussionCount: normalizeCount(session.discussionCount),
      lastOpenedAt: typeof session.lastOpenedAt === 'string' ? session.lastOpenedAt : '',
    };
  }
  return sessions;
}

export function readStorage<T>(
  storage: Storage | undefined,
  key: string,
  fallback: T,
  normalize?: StorageNormalizer<T>
): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return normalize ? normalize(parsed, fallback) : parsed as T;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(storage: Storage | undefined, key: string, value: T): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function getBrowserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function usePersistentState<T>(
  key: string,
  initialValue: T | (() => T),
  normalize?: StorageNormalizer<T>
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue;
    return readStorage(getBrowserStorage(), key, fallback, normalize);
  });

  useEffect(() => {
    const storage = getBrowserStorage();
    if (storage && !writeStorage(storage, key, value)) {
      console.error(`Failed to persist application state for ${key}`);
    }
  }, [key, value]);

  return [value, setValue];
}

