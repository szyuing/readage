import { Router } from 'express';
import { MAGAZINE_SOURCES } from './config';
import {
  loadArticle,
  loadIndex,
  loadIssueById,
  loadRecommendationCandidates,
} from './store';
import { getSyncStatus, runMagazineSync } from './sync';

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
      const issueId = decodeURIComponent(req.params.issueId);
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
   */
  router.get('/recommendation-candidates', async (req, res) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 48;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 48;
      const articles = await loadRecommendationCandidates(limit);
      res.json({
        ok: true,
        count: articles.length,
        articles,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        ok: false,
        error: { code: 'RECOMMENDATION_POOL_FAILED', message },
      });
    }
  });

  router.get('/sync/status', (_req, res) => {
    res.json({ ok: true, ...getSyncStatus() });
  });

  router.post('/sync', async (req, res) => {
    try {
      const sources = Array.isArray(req.body?.sources)
        ? req.body.sources.filter((s: unknown) => typeof s === 'string')
        : undefined;
      const maxIssuesPerSource =
        typeof req.body?.maxIssuesPerSource === 'number'
          ? req.body.maxIssuesPerSource
          : undefined;

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
      const statusCode = code === 'SYNC_IN_PROGRESS' ? 409 : 500;
      res.status(statusCode).json({
        ok: false,
        error: { code, message: e.message || 'Sync failed' },
      });
    }
  });

  return router;
}
