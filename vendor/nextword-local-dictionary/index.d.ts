export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface DictionaryDefinitionEn {
  partOfSpeech: string;
  definition: string;
  definitionZh?: string;
}

export interface DictionaryDefinitionZh {
  partOfSpeech: string;
  definitionEn: string;
  definitionZh: string;
}

export interface DictionaryEntry {
  query: string;
  lemma: string;
  phonetic: string;
  phonetics: Array<{ label: string; text: string }>;
  cefrLevel: CefrLevel | null;
  partOfSpeech: string;
  basicMeaningsZh: string[];
  dictionaryTranslations: Array<{ partOfSpeech: string; meanings: string[] }>;
  definitionEn: string;
  definitionsEn: DictionaryDefinitionEn[];
  definitionsZh: DictionaryDefinitionZh[];
  exchanges: Array<{ label: string; value: string }>;
  relatedWords: string[];
  tags: string[];
  collocations: Array<{ en: string; zh: string }>;
  usageNotes: string;
  register: string;
  source: "ECDICT";
}

export interface DictionaryHealth {
  ok: boolean;
  dataDir: string;
  indexedEntries: number;
  sourceRows: number;
  csvBytes: number;
  missingRequired: string[];
  missingOptional: string[];
}

export interface DictionaryOptions {
  /** Defaults to the data directory bundled beside index.js. */
  dataDir?: string;
}

export interface Dictionary {
  readonly dataDir: string;
  getHealth(): DictionaryHealth;
  lookup(word: string): Promise<DictionaryEntry | null>;
  lookupExact(word: string): Promise<DictionaryEntry | null>;
  lookupMany(words: Iterable<string>): Promise<Array<DictionaryEntry | null>>;
  clearCaches(): void;
}

export function normalizeWord(word: unknown): string;
export function fallbackLemma(word: unknown): string;
export function createDictionary(options?: DictionaryOptions): Dictionary;
export function getHealth(): DictionaryHealth;
export function lookup(word: string): Promise<DictionaryEntry | null>;
export function lookupExact(word: string): Promise<DictionaryEntry | null>;
export function lookupMany(words: Iterable<string>): Promise<Array<DictionaryEntry | null>>;
