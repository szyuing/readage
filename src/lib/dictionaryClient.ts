export interface DictionaryDefinition {
  partOfSpeech: string;
  definition: string;
  definitionZh?: string;
}

/** Client-safe subset of the server dictionary entry. */
export interface DictionaryEntry {
  query: string;
  lemma: string;
  phonetic: string;
  cefrLevel: string | null;
  partOfSpeech: string;
  basicMeaningsZh: string[];
  definitionEn: string;
  definitionsEn: DictionaryDefinition[];
}

interface DictionaryLookupSuccess {
  ok: true;
  results: Array<DictionaryEntry | null>;
}

interface DictionaryLookupFailure {
  ok: false;
  error?: { message?: string };
}

export interface DictionaryLookupOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

function getErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as DictionaryLookupFailure).error;
    if (error?.message?.trim()) return error.message;
  }
  return `Dictionary lookup failed (${status}).`;
}

function isSuccess(body: unknown): body is DictionaryLookupSuccess {
  return (
    Boolean(body) &&
    typeof body === 'object' &&
    (body as DictionaryLookupSuccess).ok === true &&
    Array.isArray((body as DictionaryLookupSuccess).results)
  );
}

/** Look up one word through the local ECDICT-backed API. */
export async function lookupDictionaryWord(
  word: string,
  options: DictionaryLookupOptions = {},
): Promise<DictionaryEntry | null> {
  const query = word.trim();
  if (!query) return null;

  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher('/api/dictionary/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words: [query] }),
    signal: options.signal,
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Dictionary returned invalid JSON (${response.status}).`);
  }

  if (!response.ok || !isSuccess(body)) {
    throw new Error(getErrorMessage(body, response.status));
  }

  return body.results[0] ?? null;
}

export function getDictionaryEnglishDefinition(entry: DictionaryEntry): string {
  return (
    entry.definitionsEn.find((definition) => definition.definition.trim())?.definition.trim() ||
    entry.definitionEn.trim()
  );
}

export function getDictionaryChineseMeaning(entry: DictionaryEntry): string {
  return entry.basicMeaningsZh
    .map((meaning) => meaning.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('；');
}
