/** P1-P4 screen map. */
export type ScreenType = 'home' | 'library' | 'reading' | 'learning' | 'history';

export type ArticleSource =
  | 'user_input'
  | 'library'
  | 'ai_generated'
  | 'oral_session'
  | 'magazine';
export type ArticleStatus = 'Completed' | 'In Progress';
export type ProficiencyLevel = 0 | 1 | 2 | 3 | 4;

export type MagazineSourceId = 'economist' | 'new_yorker' | 'atlantic' | 'wired' | string;
export type MagazineIssueStatus = 'ready' | 'parsing' | 'failed' | 'partial';
export type MagazineFormat = 'epub' | 'pdf';

export interface MagazineSourceMeta {
  id: MagazineSourceId;
  repoDir: string;
  displayName: string;
  levelHint?: string;
  topic?: string;
}

export interface MagazineIssue {
  id: string;
  sourceId: MagazineSourceId;
  issueLabel: string;
  title: string;
  publishedAt?: string;
  importedAt: string;
  format: MagazineFormat;
  remotePath: string;
  remoteSha?: string;
  articleCount: number;
  status: MagazineIssueStatus;
  errorMessage?: string;
}

export interface MagazineArticleStub {
  id: string;
  title: string;
  description: string;
  wordCount?: number;
}

export interface MagazineSourceSummary {
  id: MagazineSourceId;
  displayName: string;
  levelHint?: string;
  topic?: string;
  issueCount: number;
}

export interface MagazineCatalogIndex {
  lastSyncAt: string | null;
  sources: MagazineSourceSummary[];
  issues: MagazineIssue[];
}

export interface MagazineSyncStatus {
  running: boolean;
  lastRunAt: string | null;
  lastResult: MagazineSyncResult | null;
  progress: string | null;
}

export interface MagazineSyncResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  importedIssues: number;
  skippedIssues: number;
  failedIssues: number;
  errors: string[];
  perSource: Record<string, { imported: number; skipped: number; failed: number }>;
}

export type LearningEventType =
  | 'click'
  | 'exposure'
  | 'grammar_query'
  | 'discussion'
  | 'review_start'
  | 'add_review'
  | 'incorrect_use'
  | 'avoidance';

/** AI CEFR rating produced on article import. */
export interface ArticleLevelRating {
  /** CEFR band: A1 | A2 | B1 | B2 | C1 | C2 */
  level: string;
  /** 0–100 objective difficulty. */
  difficultyScore: number;
  /** Short Chinese rationale for learners. */
  summary: string;
  vocabularyNotes?: string;
  structureNotes?: string;
  estimatedWordCount?: number;
}

export interface Article {
  id: string;
  title: string;
  description: string;
  date: string;
  status: ArticleStatus;
  content: string[];
  keyWords?: string[];
  source?: ArticleSource;
  level?: string;
  topic?: string;
  lastOpenedAt?: string;
  /** Words intentionally woven in for due review (AI-generated / targeted review). */
  embeddedReviewWords?: string[];
  magazineIssueId?: string;
  magazineSourceId?: MagazineSourceId;
  /**
   * Chinese translation per paragraph, aligned with `content` indices.
   * Filled by the import module in the background after store.
   */
  paragraphTranslations?: string[];
  /** Full-article CEFR rating from the import module. */
  levelRating?: ArticleLevelRating;
  /**
   * Import module lifecycle (translate + rate).
   * pending/processing: stored but enrichment not ready yet.
   */
  importEnrichmentStatus?: 'pending' | 'processing' | 'ready' | 'failed';
  importEnrichmentError?: string;
}

export interface ReviewWord {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech?: string;
  definition: string;
  definitionChinese?: string;
  chineseTranslation?: string;
  exampleSentence: string;
  mastered: boolean;
  nextReviewDate: string;
}

/** Stability is measured in days; nextReviewDue is an ISO timestamp. */
export interface FsrsCardState {
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview?: string;
}

export interface FsrsReviewLog {
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  review: string;
}

export interface FsrsMemory {
  version: 2;
  algorithm: 'FSRS-6';
  implementation: 'ts-fsrs@5.4.1';
  /** Fingerprint of all scheduler parameters, including the FSRS weights. */
  parametersId: string;
  /** Reviews known only as a migration baseline, before complete logs began. */
  historyStartReps: number;
  card: FsrsCardState;
  /** Complete immutable history after historyStartReps. */
  reviews: FsrsReviewLog[];
  /** Whether the word has entered the review system (not merely been seen). */
  isIntroduced: boolean;
  lastRating?: number;
}

export interface WordProficiency {
  lemma: string;
  level: ProficiencyLevel;
  recognitionScore: number;
  productionScore: number;
  stabilityDays: number;
  lastReviewedAt: string;
  nextReviewDue: string;
  phonetic?: string;
  partOfSpeech?: string;
  definition?: string;
  definitionChinese?: string;
  chineseTranslation?: string;
  exampleSentence?: string;
  exposureCount: number;
  /** Canonical FSRS-6 memory state; older records are migrated lazily. */
  fsrs?: FsrsMemory;
}

export interface LearningEvent {
  id: string;
  type: LearningEventType;
  articleId?: string;
  lemma?: string;
  createdAt: string;
  detail?: string;
}

export interface GrammarExplanation {
  wordOrPhrase: string;
  type: string;
  phonetic?: string;
  definition: string;
  definitionChinese?: string;
  chineseTranslation?: string;
  grammarRules: string[];
  exampleSentences: string[];
  vietnameseMeaning?: string;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  targetLanguage: string;
  culturalNote?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
}

export interface AssessmentError {
  type: string;
  span: string;
  fix: string;
}

export interface StructuredAssessResult {
  reply: string;
  errors: AssessmentError[];
  wordsUsedCorrectly: string[];
  wordsUsedIncorrectly: string[];
  weakPoints: string[];
  scoreOutOf10?: number;
}

export interface ArticleSession {
  articleId: string;
  chatMessages: ChatMessage[];
  clickCount: number;
  discussionCount: number;
  lastOpenedAt: string;
}

export interface ArticleProgressRow {
  article: Article;
  clickCount: number;
  discussionCount: number;
  hasSession: boolean;
}

export interface LearningSignals {
  incorrectWords: string[];
  grammarIssues: string[];
  usedTargetWords: string[];
}

export type TutorIntent =
  | 'explain'
  | 'translate'
  | 'recommend_article'
  | 'rate_article'
  | 'discuss'
  | 'oral_feedback';

export interface TutorRequest {
  intent: TutorIntent;
  articleId?: string;
  articleContext?: string;
  message?: string;
  selectedText?: string;
  contextSentence?: string;
  targetLanguage?: string;
  topic?: string;
  reviewWords?: string[];
  level?: string;
  history?: ChatMessage[];
  /** 1-based paragraph index when translating one paragraph during import. */
  paragraphIndex?: number;
  /** Total paragraphs when translating one paragraph during import. */
  paragraphTotal?: number;
}

export interface TutorSuccessResponse<T> {
  ok: true;
  intent: TutorIntent;
  result: T;
  learningSignals?: LearningSignals;
  validation?: {
    wordCount: number;
    newWordDensity: number;
  };
}

export interface TutorErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type TutorResponse<T> = TutorSuccessResponse<T> | TutorErrorResponse;

export interface UserProfile {
  userId: string;
  level: string;
  weakPoints: string[];
  streakDays: number;
}
