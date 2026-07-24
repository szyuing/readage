import type { MagazineIssue, MagazineSyncResult, MagazineSyncStatus } from '../../src/types';
import {
  getMaxIssuesPerSource,
  getSourceById,
  MAGAZINE_SOURCES,
  makeIssueId,
} from './config';
import { discoverIssues, downloadFile } from './github';
import { articlesToStubs, buildIssueMeta, chaptersToArticles } from './normalize';
import { parseEpubBuffer } from './parseEpub';
import { parsePdfBuffer } from './parsePdf';
import {
  blobExists,
  loadIndex,
  loadSyncState,
  readBlob,
  rebuildIndexFromIssues,
  saveIssuePayload,
  saveSyncState,
  writeBlob,
} from './store';

let running = false;
let progress: string | null = null;
let lastRunAt: string | null = null;
let lastResult: MagazineSyncResult | null = null;

export function getSyncStatus(): MagazineSyncStatus {
  return {
    running,
    lastRunAt,
    lastResult,
    progress,
  };
}

export interface SyncOptions {
  sources?: string[];
  maxIssuesPerSource?: number;
}

export async function runMagazineSync(options: SyncOptions = {}): Promise<MagazineSyncResult> {
  if (running) {
    const err = new Error('Magazine sync already in progress');
    (err as Error & { code?: string }).code = 'SYNC_IN_PROGRESS';
    throw err;
  }

  running = true;
  progress = 'starting';
  const startedAt = new Date().toISOString();
  lastRunAt = startedAt;

  const maxIssues = getMaxIssuesPerSource(options.maxIssuesPerSource);
  const sourceIds = options.sources?.length
    ? options.sources
    : MAGAZINE_SOURCES.map((s) => s.id);

  const result: MagazineSyncResult = {
    ok: true,
    startedAt,
    finishedAt: '',
    importedIssues: 0,
    skippedIssues: 0,
    failedIssues: 0,
    errors: [],
    perSource: {},
  };

  try {
    const syncState = await loadSyncState();
    const existingIndex = await loadIndex();
    const issueMap = new Map<string, MagazineIssue>();
    for (const issue of existingIndex.issues) {
      issueMap.set(issue.id, issue);
    }

    for (const sourceId of sourceIds) {
      const source = getSourceById(sourceId);
      if (!source) {
        result.errors.push(`Unknown source: ${sourceId}`);
        continue;
      }
      result.perSource[sourceId] = { imported: 0, skipped: 0, failed: 0 };
      progress = `discovering ${source.displayName}`;

      let candidates;
      try {
        candidates = await discoverIssues(source.repoDir, maxIssues);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${sourceId}: discover failed: ${message}`);
        result.failedIssues += 1;
        result.perSource[sourceId].failed += 1;
        result.ok = false;
        continue;
      }

      for (const candidate of candidates) {
        const issueId = makeIssueId(source.id, candidate.issueLabel);
        const sha = candidate.preferredFile.sha;
        progress = `processing ${issueId}`;

        if (syncState.importedShas[issueId] === sha && issueMap.get(issueId)?.status === 'ready') {
          result.skippedIssues += 1;
          result.perSource[sourceId].skipped += 1;
          continue;
        }

        try {
          const ext = candidate.format;
          let buffer: Buffer;
          if (await blobExists(sha, ext)) {
            buffer = await readBlob(sha, ext);
          } else {
            if (!candidate.preferredFile.download_url) {
              throw new Error('No download_url for file');
            }
            progress = `downloading ${issueId}`;
            buffer = await downloadFile(candidate.preferredFile.download_url);
            await writeBlob(sha, ext, buffer);
          }

          progress = `parsing ${issueId}`;
          let chapters =
            candidate.format === 'epub'
              ? await parseEpubBuffer(buffer)
              : await parsePdfBuffer(buffer);

          const status = candidate.format === 'pdf' || chapters.length === 0 ? 'partial' : 'ready';
          if (chapters.length === 0) {
            throw new Error('No articles extracted from file');
          }

          // Cap very large issues for MVP usability
          if (chapters.length > 80) {
            chapters = chapters.slice(0, 80);
          }

          const articles = chaptersToArticles(chapters, source, candidate.issueLabel);
          const issue = buildIssueMeta({
            source,
            issueLabel: candidate.issueLabel,
            format: candidate.format,
            remotePath: candidate.preferredFile.path,
            remoteSha: sha,
            articleCount: articles.length,
            status: status as MagazineIssue['status'],
          });

          await saveIssuePayload(
            { issue, articles: articlesToStubs(articles) },
            articles
          );

          issueMap.set(issue.id, issue);
          syncState.importedShas[issueId] = sha;
          result.importedIssues += 1;
          result.perSource[sourceId].imported += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push(`${issueId}: ${message}`);
          result.failedIssues += 1;
          result.perSource[sourceId].failed += 1;
          result.ok = false;

          const failedIssue = buildIssueMeta({
            source,
            issueLabel: candidate.issueLabel,
            format: candidate.format,
            remotePath: candidate.preferredFile.path,
            remoteSha: sha,
            articleCount: 0,
            status: 'failed',
            errorMessage: message,
          });
          issueMap.set(failedIssue.id, failedIssue);
        }
      }
    }

    const finishedAt = new Date().toISOString();
    result.finishedAt = finishedAt;
    lastResult = result;
    syncState.lastResult = result;
    syncState.lastRunAt = finishedAt;
    await saveSyncState(syncState);
    await rebuildIndexFromIssues([...issueMap.values()], finishedAt);
    // Catalog fingerprint changed — rebuild/load lemma index in the background
    // so full-catalog recommend stays warm after sync.
    void import('./lemmaIndex')
      .then(({ warmMagazineLemmaIndex }) => warmMagazineLemmaIndex('sync'))
      .catch((err) => {
        console.error('[magazines] post-sync lemma warm failed', err);
      });
    progress = null;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.ok = false;
    result.errors.push(message);
    result.finishedAt = new Date().toISOString();
    lastResult = result;
    progress = null;
    throw err;
  } finally {
    running = false;
    if (!result.finishedAt) result.finishedAt = new Date().toISOString();
    lastResult = result;
  }
}

/** Load last result from disk on boot so status survives restarts. */
export async function hydrateSyncStatusFromDisk(): Promise<void> {
  try {
    const state = await loadSyncState();
    lastRunAt = state.lastRunAt;
    lastResult = state.lastResult;
  } catch {
    // ignore
  }
}
