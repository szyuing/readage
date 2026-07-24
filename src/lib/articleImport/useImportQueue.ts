import { useEffect, useState } from 'react';
import {
  getArticleImportQueue,
  type ImportQueueSnapshot,
} from './queue';

const EMPTY_SNAPSHOT: ImportQueueSnapshot = {
  jobs: [],
  pendingCount: 0,
  active: null,
  isProcessing: false,
  bannerMessage: null,
};

/** Subscribe to the shared import-module queue for UI banners / progress. */
export function useArticleImportQueue(): ImportQueueSnapshot {
  const [snapshot, setSnapshot] = useState<ImportQueueSnapshot>(() => {
    try {
      return getArticleImportQueue().getSnapshot();
    } catch {
      return EMPTY_SNAPSHOT;
    }
  });

  useEffect(() => {
    const queue = getArticleImportQueue();
    return queue.subscribe(setSnapshot);
  }, []);

  return snapshot;
}
