import fs from 'fs/promises';
import path from 'path';
import type {
  Article,
  MagazineArticleStub,
  MagazineCatalogIndex,
  MagazineIssue,
  MagazineSourceSummary,
  MagazineSyncResult,
} from '../../src/types';
import { issueFileKey, MAGAZINE_SOURCES } from './config';

const DATA_ROOT = path.join(process.cwd(), 'data', 'magazines');

function indexPath() {
  return path.join(DATA_ROOT, 'index.json');
}
function syncStatePath() {
  return path.join(DATA_ROOT, 'sync-state.json');
}
function issuePath(sourceId: string, issueLabel: string) {
  return path.join(DATA_ROOT, 'issues', `${issueFileKey(sourceId, issueLabel)}.json`);
}
function articleDir(sourceId: string, issueLabel: string) {
  return path.join(DATA_ROOT, 'articles', issueFileKey(sourceId, issueLabel));
}
function safeFileName(id: string): string {
  // Windows forbids ':' and other reserved chars in file names
  return id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
}

function articlePath(articleId: string) {
  return path.join(DATA_ROOT, 'articles_by_id', `${safeFileName(articleId)}.json`);
}
function blobPath(sha: string, ext: string) {
  return path.join(DATA_ROOT, 'blobs', `${sha}.${ext}`);
}

export interface StoredIssuePayload {
  issue: MagazineIssue;
  articles: MagazineArticleStub[];
}

export interface SyncState {
  importedShas: Record<string, string>; // issueId -> remoteSha
  lastResult: MagazineSyncResult | null;
  lastRunAt: string | null;
}

async function ensureDirs() {
  await fs.mkdir(path.join(DATA_ROOT, 'issues'), { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'articles'), { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'articles_by_id'), { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'blobs'), { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDirs();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

export async function loadSyncState(): Promise<SyncState> {
  return readJson<SyncState>(syncStatePath(), {
    importedShas: {},
    lastResult: null,
    lastRunAt: null,
  });
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await writeJson(syncStatePath(), state);
}

export async function loadIndex(): Promise<MagazineCatalogIndex> {
  const empty: MagazineCatalogIndex = {
    lastSyncAt: null,
    sources: MAGAZINE_SOURCES.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      levelHint: s.levelHint,
      topic: s.topic,
      issueCount: 0,
    })),
    issues: [],
  };
  return readJson(indexPath(), empty);
}

export async function saveIndex(index: MagazineCatalogIndex): Promise<void> {
  await writeJson(indexPath(), index);
}

export async function rebuildIndexFromIssues(issues: MagazineIssue[], lastSyncAt: string | null): Promise<MagazineCatalogIndex> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.sourceId, (counts.get(issue.sourceId) || 0) + 1);
  }
  const sources: MagazineSourceSummary[] = MAGAZINE_SOURCES.map((s) => ({
    id: s.id,
    displayName: s.displayName,
    levelHint: s.levelHint,
    topic: s.topic,
    issueCount: counts.get(s.id) || 0,
  }));
  const index: MagazineCatalogIndex = {
    lastSyncAt,
    sources,
    issues: [...issues].sort((a, b) => (b.issueLabel > a.issueLabel ? 1 : -1)),
  };
  await saveIndex(index);
  return index;
}

export async function saveIssuePayload(payload: StoredIssuePayload, articles: Article[]): Promise<void> {
  await writeJson(issuePath(payload.issue.sourceId, payload.issue.issueLabel), payload);
  const dir = articleDir(payload.issue.sourceId, payload.issue.issueLabel);
  await fs.mkdir(dir, { recursive: true });
  for (const article of articles) {
    await writeJson(path.join(dir, `${safeFileName(article.id)}.json`), article);
    await writeJson(articlePath(article.id), article);
  }
}

export async function loadIssuePayload(sourceId: string, issueLabel: string): Promise<StoredIssuePayload | null> {
  const data = await readJson<StoredIssuePayload | null>(issuePath(sourceId, issueLabel), null);
  return data;
}

export async function loadIssueById(issueId: string): Promise<StoredIssuePayload | null> {
  const [sourceId, ...rest] = issueId.split(':');
  const issueLabel = rest.join(':');
  if (!sourceId || !issueLabel) return null;
  return loadIssuePayload(sourceId, issueLabel);
}

export async function loadArticle(articleId: string): Promise<Article | null> {
  return readJson<Article | null>(articlePath(articleId), null);
}

const DEFAULT_RECOMMENDATION_CANDIDATE_LIMIT = 48;
const MIN_RECOMMENDATION_WORD_COUNT = 80;

/**
 * Load a capped set of full magazine articles from the newest ready issues.
 * Used by the interactive recommendation feed so Memory V2 ranks real content
 * instead of only the five demo library stubs.
 */
export async function loadRecommendationCandidates(
  limit = DEFAULT_RECOMMENDATION_CANDIDATE_LIMIT
): Promise<Article[]> {
  const cappedLimit = Math.max(1, Math.min(120, Math.floor(limit) || DEFAULT_RECOMMENDATION_CANDIDATE_LIMIT));
  const index = await loadIndex();
  const readyIssues = [...index.issues]
    .filter((issue) => issue.status === 'ready' && issue.articleCount > 0)
    .sort((a, b) => {
      const byLabel = (b.issueLabel || '').localeCompare(a.issueLabel || '');
      if (byLabel !== 0) return byLabel;
      return (b.importedAt || '').localeCompare(a.importedAt || '');
    });

  const articles: Article[] = [];
  const seenIds = new Set<string>();

  for (const issue of readyIssues) {
    if (articles.length >= cappedLimit) break;
    const payload = await loadIssueById(issue.id);
    if (!payload?.articles?.length) continue;

    // Prefer longer pieces; keep issue order otherwise.
    const stubs = [...payload.articles].sort(
      (a, b) => (b.wordCount ?? 0) - (a.wordCount ?? 0)
    );

    for (const stub of stubs) {
      if (articles.length >= cappedLimit) break;
      if (seenIds.has(stub.id)) continue;
      if ((stub.wordCount ?? 0) > 0 && (stub.wordCount ?? 0) < MIN_RECOMMENDATION_WORD_COUNT) {
        continue;
      }

      const article = await loadArticle(stub.id);
      if (!article?.id || !Array.isArray(article.content) || article.content.length === 0) {
        continue;
      }
      const textLen = article.content.join(' ').trim().length;
      if (textLen < MIN_RECOMMENDATION_WORD_COUNT) continue;

      seenIds.add(article.id);
      articles.push(article);
    }
  }

  return articles;
}

export async function blobExists(sha: string, ext: string): Promise<boolean> {
  try {
    await fs.access(blobPath(sha, ext));
    return true;
  } catch {
    return false;
  }
}

export async function writeBlob(sha: string, ext: string, buffer: Buffer): Promise<string> {
  const file = blobPath(sha, ext);
  await ensureDirs();
  await fs.writeFile(file, buffer);
  return file;
}

export async function readBlob(sha: string, ext: string): Promise<Buffer> {
  return fs.readFile(blobPath(sha, ext));
}

export function getDataRoot(): string {
  return DATA_ROOT;
}
