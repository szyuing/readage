export type AppRoute =
  | { kind: 'recommendation' }
  | { kind: 'reading'; articleId: string }
  | { kind: 'library' }
  | { kind: 'assessment' }
  | { kind: 'learning' }
  | { kind: 'history' };

const SIMPLE_ROUTE_PATHS = {
  recommendation: '/',
  library: '/library',
  assessment: '/assessment',
  learning: '/learning',
  history: '/history',
} as const;

function normalizePathname(pathname: string): string {
  const path = pathname.trim() || '/';
  if (path === '/') return path;
  return path.replace(/\/+$/, '') || '/';
}

export function parseAppPath(pathname: string): AppRoute {
  const path = normalizePathname(pathname);

  for (const [kind, routePath] of Object.entries(SIMPLE_ROUTE_PATHS)) {
    if (path === routePath) return { kind } as AppRoute;
  }

  if (path.startsWith('/read/')) {
    const encodedArticleId = path.slice('/read/'.length);
    if (!encodedArticleId || encodedArticleId.includes('/')) {
      return { kind: 'recommendation' };
    }

    try {
      const articleId = decodeURIComponent(encodedArticleId);
      return articleId ? { kind: 'reading', articleId } : { kind: 'recommendation' };
    } catch {
      return { kind: 'recommendation' };
    }
  }

  return { kind: 'recommendation' };
}

export function buildAppPath(route: AppRoute): string {
  if (route.kind === 'reading') {
    return `/read/${encodeURIComponent(route.articleId)}`;
  }
  return SIMPLE_ROUTE_PATHS[route.kind];
}

/**
 * First-time users (no CEFR assessment yet) land on the rating flow
 * instead of auto-starting the recommendation feed.
 * Deep links (library / reading / assessment / …) are left alone.
 */
export function resolveInitialAppRoute(
  pathname: string,
  hasCompletedAssessment: boolean
): AppRoute {
  const route = parseAppPath(pathname);
  if (!hasCompletedAssessment && route.kind === 'recommendation') {
    return { kind: 'assessment' };
  }
  return route;
}
