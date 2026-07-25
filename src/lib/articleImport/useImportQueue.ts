import { useEffect, useState } from 'react';
import {
  ARTICLE_IMPORT_CONCURRENCY,
  getArticleImportQueue,
  type ImportQueueSnapshot,
} from './queue';

const EMPTY_SNAPSHOT: ImportQueueSnapshot = {
  jobs: [],
  pendingCount: 0,
  activeJobs: [],
  active: null,
  isProcessing: false,
  bannerMessage: null,
  concurrency: ARTICLE_IMPORT_CONCURRENCY,
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
