import {
  createDictionary,
  type Dictionary,
  type DictionaryEntry,
  type DictionaryHealth,
} from 'nextword-local-dictionary';
import type { GrammarExplanation } from '../../src/types';

/**
 * Local ECDICT offline dictionary service (server-only).
 *
 * The underlying pack file is ~113MB but lookups only read the header +
 * the shard/record for the queried word, so a lazy singleton is cheap.
 *
 * Env knobs:
 * - DICTIONARY_DATA_DIR: override the bundled data directory.
 * - DICTIONARY_EXPLAIN_FIRST: 'false'/'0' disables the dictionary fast path
 *   for the /api/tutor explain intent (LLM is always used instead).
 */

let dictionary: Dictionary | undefined;
let dictionaryInitError: Error | undefined;

function getDictionary(): Dictionary {
  if (dictionaryInitError) throw dictionaryInitError;
  if (!dictionary) {
    try {
      dictionary = createDictionary({
        dataDir: process.env.DICTIONARY_DATA_DIR?.trim() || undefined,
      });
    } catch (error) {
      dictionaryInitError = error instanceof Error ? error : new Error(String(error));
      throw dictionaryInitError;
    }
  }
  return dictionary;
}

/** Read-only health info for diagnostics; never throws. */
export function getDictionaryHealth(): DictionaryHealth & { available: boolean } {
  try {
    return { ...getDictionary().getHealth(), available: true };
  } catch (error) {
    return {
      ok: false,
      available: false,
      dataDir: process.env.DICTIONARY_DATA_DIR?.trim() || '(bundled)',
      indexedEntries: 0,
      sourceRows: 0,
      csvBytes: 0,
      missingRequired: [error instanceof Error ? error.message : String(error)],
      missingOptional: [],
    };
  }
}

/** Whether the explain intent should try the local dictionary before the LLM. */
export function isDictionaryExplainFirstEnabled(): boolean {
  const raw = process.env.DICTIONARY_EXPLAIN_FIRST?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/** Single English token (allows apostrophes/hyphens: don't, well-known). */
export function isSingleWordQuery(text: string | undefined): text is string {
  if (!text) return false;
  const trimmed = text.trim();
  return /^[A-Za-z][A-Za-z'’-]*$/.test(trimmed);
}

/** Lookup with lemmatization; returns null on miss or when unavailable. */
export async function lookupDictionaryWord(word: string): Promise<DictionaryEntry | null> {
  try {
    return await getDictionary().lookup(word);
  } catch (error) {
    console.warn('[dictionary] lookup failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Batch lookup (same order as input); misses resolve to null entries. */
export async function lookupDictionaryWords(words: string[]): Promise<Array<DictionaryEntry | null>> {
  try {
    return await getDictionary().lookupMany(words);
  } catch (error) {
    console.warn('[dictionary] lookupMany failed:', error instanceof Error ? error.message : error);
    return words.map(() => null);
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/** ECDICT quirks: some phonetics carry a leading comma (/,ser…), and the
 * exchange field can hold single-letter noise mislabeled as a word form. */
function cleanPhonetic(phonetic: string): string {
  const inner = phonetic.trim().replace(/^\/|\/$/g, '').replace(/^[,;\s]+/, '').trim();
  return inner ? `/${inner}/` : '';
}

function cleanExchanges(
  exchanges: Array<{ label: string; value: string }>
): Array<{ label: string; value: string }> {
  const seen = new Set<string>();
  const cleaned: Array<{ label: string; value: string }> = [];
  for (const exchange of exchanges) {
    const value = exchange.value.trim();
    if (value.length < 2) continue;
    const key = `${exchange.label}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ label: exchange.label, value });
  }
  return cleaned;
}

/**
 * Map a dictionary entry onto the existing GrammarExplanation shape so the
 * reading UI can render it without changes, plus dictionary-only extras
 * (CEFR level, exam tags, senses, word forms, collocations, word family).
 */
export function buildDictionaryExplanation(
  query: string,
  entry: DictionaryEntry,
  contextSentence?: string
): GrammarExplanation {
  const senses = entry.definitionsEn
    .filter((definition) => definition.definition.trim())
    .slice(0, 4)
    .map((definition) => ({
      partOfSpeech: definition.partOfSpeech,
      definition: definition.definition,
      definitionZh: definition.definitionZh?.trim() || undefined,
    }));

  const definition = firstNonEmpty(
    entry.definitionEn,
    senses[0]?.definition,
    entry.definitionsZh[0]?.definitionEn,
    entry.basicMeaningsZh[0]
  );

  const definitionChinese = firstNonEmpty(
    entry.definitionsZh.find((item) => item.definitionZh.trim())?.definitionZh,
    senses.find((sense) => sense.definitionZh)?.definitionZh,
    entry.basicMeaningsZh[0]
  );

  // 单词汉译 badge: keep it short — first two POS groups of glosses.
  const chineseTranslation = entry.basicMeaningsZh.slice(0, 2).join('；');

  const grammarRules: string[] = [];
  if (entry.usageNotes.trim()) grammarRules.push(entry.usageNotes.trim());
  for (const collocation of entry.collocations.slice(0, 3)) {
    const text = `搭配：${collocation.en}${collocation.zh ? ` — ${collocation.zh}` : ''}`;
    grammarRules.push(text);
  }
  if (entry.register.trim()) grammarRules.push(`语域：${entry.register.trim()}`);

  // No corpus examples in the pack; the article sentence the learner tapped
  // is the most relevant "live" example.
  const exampleSentences = contextSentence?.trim() ? [contextSentence.trim()] : [];

  const exchanges = cleanExchanges(entry.exchanges);
  const phonetic = cleanPhonetic(entry.phonetic);

  return {
    wordOrPhrase: entry.lemma || query,
    type: entry.partOfSpeech || 'unknown',
    phonetic: phonetic || undefined,
    definition,
    definitionChinese: definitionChinese || undefined,
    chineseTranslation: chineseTranslation || undefined,
    grammarRules,
    exampleSentences,
    source: 'dictionary',
    cefrLevel: entry.cefrLevel ?? undefined,
    tags: entry.tags.length ? entry.tags : undefined,
    senses: senses.length ? senses : undefined,
    exchanges: exchanges.length ? exchanges : undefined,
    collocations: entry.collocations.length ? entry.collocations.slice(0, 6) : undefined,
    relatedWords: entry.relatedWords.length ? entry.relatedWords.slice(0, 10) : undefined,
  };
}
