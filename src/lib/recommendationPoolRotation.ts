/**
 * Daily recommendation-pool rotation helpers.
 *
 * Same calendar day → same shuffle order (stable for ranking/prefetch).
 * Next calendar day → different subset from the eligible universe.
 */

/** Local calendar date YYYY-MM-DD (matches "每天轮换" for the running machine). */
export function getRecommendationPoolRotationDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildDailyRecommendationPoolSeed(rotationDate: string): string {
  return `recommendation-pool:${rotationDate}`;
}

/** FNV-1a 32-bit — stable across JS runtimes for a given string. */
export function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const arr = items.slice();
  const random = mulberry32(hashStringToSeed(seed));
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export interface RotatableStub {
  id: string;
  wordCount?: number;
  issueId?: string;
  sourceId?: string;
}

/**
 * From a stable eligible universe, pick up to `limit` stub ids for the given day.
 * Order within the day is deterministic; changing `rotationDate` reorders the universe.
 */
export function selectDailyRecommendationStubIds(
  stubs: readonly RotatableStub[],
  limit: number,
  rotationDate: string
): string[] {
  const capped = Math.max(0, Math.floor(limit));
  if (capped === 0 || stubs.length === 0) return [];

  // Stable pre-order so seed alone drives daily variance (not map iteration).
  const universe = stubs
    .filter((stub) => typeof stub.id === 'string' && stub.id.length > 0)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const shuffled = seededShuffle(
    universe,
    buildDailyRecommendationPoolSeed(rotationDate)
  );

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const stub of shuffled) {
    if (seen.has(stub.id)) continue;
    seen.add(stub.id);
    picked.push(stub.id);
    if (picked.length >= capped) break;
  }
  return picked;
}
