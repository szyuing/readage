import { Router } from 'express';
import { getSourceById, MAGAZINE_SOURCES } from './config';
import {
  loadArticle,
  loadCatalogArticlePage,
  loadIndex,
  loadIssueById,
  loadRecommendationCandidates,
} from './store';
import { loadMagazineLemmaIndex } from './lemmaIndex';
import { getSyncStatus, runMagazineSync, type SyncOptions } from './sync';


interface SyncRequestError extends Error {
  code: 'INVALID_SYNC_REQUEST';
}

interface CatalogArticleRequestError extends Error {
  code: 'INVALID_ARTICLE_CATALOG_REQUEST';
}

function invalidSyncRequest(message: string): SyncRequestError {
  const error = new Error(`Invalid sync request: ${message}`) as SyncRequestError;
  error.code = 'INVALID_SYNC_REQUEST';
  return error;
}

function invalidCatalogArticleRequest(message: string): CatalogArticleRequestError {
  const error = new Error(`Invalid article catalog request: ${message}`) as CatalogArticleRequestError;
  error.code = 'INVALID_ARTICLE_CATALOG_REQUEST';
  return error;
}

function queryValue(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw invalidCatalogArticleRequest(`${key} must be a single string`);
  }
  return value;
}

export function parseCatalogArticleQuery(query: Record<string, unknown>) {
  const rawLevel = queryValue(query, 'level')?.trim().toUpperCase();
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  if (!rawLevel || !levels.includes(rawLevel)) {
    throw invalidCatalogArticleRequest(`level must be one of ${levels.join(', ')}`);
  }

  const rawQuery = queryValue(query, 'q');
  const normalizedQuery = rawQuery?.trim();
  if (normalizedQuery && normalizedQuery.length > 120) {
    throw invalidCatalogArticleRequest('q must be at most 120 characters');
  }

  const rawLimit = queryValue(query, 'limit');
  const limit = rawLimit === undefined ? 24 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60) {
    throw invalidCatalogArticleRequest('limit must be an integer from 1 to 60');
  }

  const cursor = queryValue(query, 'cursor');
  if (cursor !== undefined && !/^(0|[1-9]\d*)$/.test(cursor)) {
    throw invalidCatalogArticleRequest('cursor must be a non-negative integer');
  }

  return {
    level: rawLevel,
    query: normalizedQuery,
    limit,
    cursor,
  };
}

export function parseSyncRequest(body: unknown): SyncOptions {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw invalidSyncRequest('body must be a JSON object');
  }

  const value = body as Record<string, unknown>;
  let sources: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'sources')) {
    if (!Array.isArray(value.sources) || value.sources.length === 0) {
      throw invalidSyncRequest('sources must be a non-empty array');
    }
    if (value.sources.length > MAGAZINE_SOURCES.length) {
      throw invalidSyncRequest(`sources may contain at most ${MAGAZINE_SOURCES.length} items`);
    }

    const deduplicated = new Set<string>();
    for (const source of value.sources) {
      if (typeof source !== 'string' || !getSourceById(source)) {
        throw invalidSyncRequest(`unknown source: ${String(source)}`);
      }
      deduplicated.add(source);
    }
    sources = [...deduplicated];
  }

  let maxIssuesPerSource: number | undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'maxIssuesPerSource')) {
    const requested = value.maxIssuesPerSource;
    if (!Number.isSafeInteger(requested) || (requested as number) < 1 || (requested as number) > 30) {
      throw invalidSyncRequest('maxIssuesPerSource must be an integer from 1 to 30');
    }
    maxIssuesPerSource = requested as number;
  }

  return { sources, maxIssuesPerSource };
}

export function createMagazineRouter(): Router {
  const router = Router();

  router.get('/sources', async (_req, res) => {
    try {
      const index = await loadIndex();
      res.json({
        ok: true,
        lastSyncAt: index.lastSyncAt,
        sources: index.sources.length ? index.sources : MAGAZINE_SOURCES.map((s) => ({
          id: s.id,
          displayName: s.displayName,
          levelHint: s.levelHint,
          topic: s.topic,
          issueCount: 0,
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: { code: 'CATALOG_FAILED', message } });
    }
  });

  router.get('/issues', async (req, res) => {
    try {
      const source = typeof req.query.source === 'string' ? req.query.source : undefined;
      const index = await loadIndex();
      let issues = index.issues;
      if (source) issues = issues.filter((i) => i.sourceId === source);
      res.json({ ok: true, lastSyncAt: index.lastSyncAt, issues });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: { code: 'ISSUES_FAILED', message } });
    }
  });

  router.get('/issues/:issueId', async (req, res) => {
    try {
      // Express already decodes route parameters once. Do not decode attacker-controlled IDs again.
      const issueId = req.params.issueId;
      const payload = await loadIssueById(issueId);
      if (!payload) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Issue not found: ${issueId}` },
        });
      }
      res.json({ ok: true, issue: payload.issue, articles: payload.articles });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: { code: 'ISSUE_FAILED', message } });
    }
  });

  router.get('/articles', async (req, res) => {
    try {
      const query = parseCatalogArticleQuery(req.query as Record<string, unknown>);
      const page = await loadCatalogArticlePage(query);
      res.json({ ok: true, ...page });
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error.code === 'INVALID_ARTICLE_CATALOG_REQUEST') {
        return res.status(400).json({
          ok: false,
          error: { code: error.code, message: error.message },
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: { code: 'ARTICLE_CATALOG_FAILED', message } });
    }
  });

  router.get('/articles/:articleId', async (req, res) => {
    try {
      const articleId = decodeURIComponent(req.params.articleId);
      const article = await loadArticle(articleId);
      if (!article) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Article not found: ${articleId}` },
        });
      }
      res.json({ ok: true, article });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: { code: 'ARTICLE_FAILED', message } });
    }
  });

  /**
   * Full articles for the interactive recommendation feed (Memory V2 ranking pool).
   * Query: ?limit=48 (1–120)
   * Pool members rotate once per local calendar day (stable within the day).
   */
  router.get('/recommendation-candidates', async (req, res) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 48;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 48;
      const result = await loadRecommendationCandidates(limit);
      res.json({
        ok: true,
        count: result.articles.length,
        rotationDate: result.rotationDate,
        universeSize: result.universeSize,
        limit: result.limit,
        articles: result.articles,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        ok: false,
        error: { code: 'RECOMMENDATION_POOL_FAILED', message },
      });
    }
  });

  /**
   * Compact full-catalog lemma index for client-side Memory V2 ranking.
   * Built once per catalog fingerprint (~2s cold), then served from disk/memory.
   * Query: ?rebuild=1 to force rebuild.
   */
  router.get('/lemma-index', async (req, res) => {
    try {
      const forceRebuild =
        req.query.rebuild === '1'
        || req.query.rebuild === 'true';
      const started = Date.now();
      const index = await loadMagazineLemmaIndex({ forceRebuild });
      res.json({
        ok: true,
        loadMs: Date.now() - started,
        index,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        ok: false,
        error: { code: 'LEMMA_INDEX_FAILED', message },
      });
    }
  });

  router.get('/sync/status', (_req, res) => {
    res.json({ ok: true, ...getSyncStatus() });
  });

  router.post('/sync', async (req, res) => {
    try {
      const { sources, maxIssuesPerSource } = parseSyncRequest(req.body);

      // Run async so client can poll status; also return result when short
      const status = getSyncStatus();
      if (status.running) {
        return res.status(409).json({
          ok: false,
          error: { code: 'SYNC_IN_PROGRESS', message: 'Sync already running' },
          ...status,
        });
      }

      // Fire and continue — client polls /sync/status
      void runMagazineSync({ sources, maxIssuesPerSource })
        .then((result) => {
          console.log('[magazines] sync finished', result);
        })
        .catch((err) => {
          console.error('[magazines] sync failed', err);
        });

      res.status(202).json({
        ok: true,
        message: 'Sync started',
        ...getSyncStatus(),
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      const code = e.code || 'SYNC_FAILED';
      const statusCode = code === 'SYNC_IN_PROGRESS' ? 409 : code === 'INVALID_SYNC_REQUEST' ? 400 : 500;
      res.status(statusCode).json({
        ok: false,
        error: { code, message: e.message || 'Sync failed' },
      });
    }
  });

  return router;
}
