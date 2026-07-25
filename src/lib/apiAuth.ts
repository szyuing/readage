/**
 * Shared client credentials for sensitive server APIs (/api/tutor, magazine sync).
 *
 * Public / production deploys require APP_API_TOKEN on the server. The matching
 * build-time value is VITE_APP_API_TOKEN so the browser can send it.
 * Learning progress is NOT sent to the server — only AI/sync requests use this token.
 */

declare global {
  interface Window {
    /** Optional runtime override (e.g. reverse-proxy injected snippet). */
    __ENGLISH_AI_API_TOKEN__?: string;
  }
}

/** Prefix for all app-owned browser storage keys. */
export const APP_STORAGE_PREFIX = 'english-ai:v2';

function readViteClientToken(): string | undefined {
  try {
    // Vite injects import.meta.env in the browser bundle; Node unit tests may lack it.
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return env?.VITE_APP_API_TOKEN?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function getClientApiToken(): string | undefined {
  if (typeof window !== 'undefined') {
    const runtime = window.__ENGLISH_AI_API_TOKEN__?.trim();
    if (runtime) return runtime;
  }
  return readViteClientToken();
}

/** Headers for sensitive Express routes that require APP_API_TOKEN in public mode. */
export function getApiAuthHeaders(): Record<string, string> {
  const token = getClientApiToken();
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
    'x-api-token': token,
  };
}

/** Merge Content-Type + auth for JSON POSTs. */
export function getJsonApiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...getApiAuthHeaders(),
    ...extra,
  };
}
