/**
 * Client loader for the magazine-backed recommendation candidate pool.
 * Prefer real外刊 content over the five demo LIBRARY_ARTICLES stubs.
 */

import type { Article } from '../types';

const DEFAULT_POOL_LIMIT = 48;
const CACHE_TTL_MS = 5 * 60_000;

export interface MagazineRecommendationPoolResult {
  articles: Article[];
  source: 'magazine' | 'empty' | 'error';
  errorMessage?: string;
}

let cachedPool: Article[] | null = null;
let cachedAt = 0;
let inflight: Promise<MagazineRecommendationPoolResult> | null = null;

export function clearMagazineRecommendationPoolCache(): void {
  cachedPool = null;
  cachedAt = 0;
  inflight = null;
}

export function getCachedMagazineRecommendationPool(): Article[] {
  if (!cachedPool) return [];
  if (Date.now() - cachedAt > CACHE_TTL_MS) return cachedPool;
  return cachedPool;
}

/**
 * Fetch (or reuse) a capped set of full magazine articles for ranking.
 */
export async function fetchMagazineRecommendationPool(
  limit = DEFAULT_POOL_LIMIT,
  options?: { force?: boolean; fetchImpl?: typeof fetch; signal?: AbortSignal }
): Promise<MagazineRecommendationPoolResult> {
  const force = options?.force === true;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = Date.now();

  if (!force && cachedPool && now - cachedAt <= CACHE_TTL_MS) {
    return { articles: cachedPool, source: cachedPool.length ? 'magazine' : 'empty' };
  }

  if (!force && inflight) {
    return inflight;
  }

  const request = (async (): Promise<MagazineRecommendationPoolResult> => {
    try {
      const capped = Math.max(1, Math.min(120, Math.floor(limit) || DEFAULT_POOL_LIMIT));
      const res = await fetchImpl(
        `/api/magazines/recommendation-candidates?limit=${capped}`,
        { signal: options?.signal }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          articles: cachedPool ?? [],
          source: 'error',
          errorMessage: text || `HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as {
        ok?: boolean;
        articles?: Article[];
        error?: { message?: string };
      };
      if (!data.ok || !Array.isArray(data.articles)) {
        return {
          articles: cachedPool ?? [],
          source: 'error',
          errorMessage: data.error?.message || 'Invalid recommendation pool response',
        };
      }
      const articles = data.articles.filter(
        (article) =>
          article
          && typeof article.id === 'string'
          && Array.isArray(article.content)
          && article.content.length > 0
      );
      cachedPool = articles;
      cachedAt = Date.now();
      return {
        articles,
        source: articles.length ? 'magazine' : 'empty',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      return {
        articles: cachedPool ?? [],
        source: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      inflight = null;
    }
  })();

  inflight = request;
  return request;
}

/**
 * Merge magazine pool + built-in library + reading history into one ranked pool.
 * History wins on id collisions so Completed status is respected.
 */
export function buildRecommendationArticlePool(
  magazineArticles: readonly Article[],
  libraryArticles: readonly Article[],
  historyArticles: readonly Article[]
): Article[] {
  const byId = new Map<string, Article>();

  for (const article of magazineArticles) {
    if (article?.id) byId.set(article.id, article);
  }
  for (const article of libraryArticles) {
    if (article?.id && !byId.has(article.id)) byId.set(article.id, article);
  }
  // History overlays status / enrichment without dropping magazine content when
  // history rows are thinner stubs — prefer the richer content payload.
  for (const article of historyArticles) {
    if (!article?.id) continue;
    const existing = byId.get(article.id);
    if (!existing) {
      byId.set(article.id, article);
      continue;
    }
    const existingLen = existing.content?.join(' ').length ?? 0;
    const nextLen = article.content?.join(' ').length ?? 0;
    byId.set(article.id, {
      ...existing,
      ...article,
      content: nextLen >= existingLen ? article.content : existing.content,
      keyWords: article.keyWords?.length ? article.keyWords : existing.keyWords,
      paragraphTranslations:
        article.paragraphTranslations?.length
          ? article.paragraphTranslations
          : existing.paragraphTranslations,
      levelRating: article.levelRating ?? existing.levelRating,
      level: article.level || existing.level,
    });
  }

  return Array.from(byId.values());
}
