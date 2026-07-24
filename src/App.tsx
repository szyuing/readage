import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScreenType,
  Article,
  ReviewWord,
  LearningEvent,
  ArticleSession,
  StructuredAssessResult,
  ArticleProgressRow,
  ReadingAdvancePayload,
} from './types';
import {
  LIBRARY_ARTICLES,
  INITIAL_REVIEW_WORDS,
} from './data/mockArticles';
import {
  toLemma,
} from './lib/proficiency';
import { normalizeArticleSessions, STORAGE_KEYS, usePersistentState } from './lib/storage';
import {
  buildWeakPointMetrics,
  calculateLearningStreak,
  countCompletedArticles,
  countRecentLearningEvents,
  getLearningActivityDateKeys,
  normalizeLearningDateKeys,
  toLocalDateKey,
} from './lib/learningAnalytics';
import { postTutor, RECOMMENDATION_INTERACTION_BUDGET_MS } from './lib/tutorClient';
import {
  beginRecommendationPrefetch,
  consumeQueuedRecommendation,
  createInactiveRecommendationFeed,
  endRecommendationFeed,
  failRecommendationPrefetch,
  finishRecommendationPrefetch,
  markRecommendationArticleSeen,
  selectLibraryFallback,
  startRecommendationFeed,
  type RecommendationFeedState,
} from './lib/recommendationFeed';
import {
  resolveRecommendationArticle,
  type RecommendationSource,
} from './lib/resolveRecommendation';
import type { RecommendedArticleCandidate } from './lib/articleValidation';
import {
  buildRecommendationArticlePool,
  fetchMagazineRecommendationPool,
  getCachedMagazineRecommendationPool,
} from './lib/magazineRecommendationPool';
import {
  getArticleImportQueue,
  needsImportEnrichment,
  useArticleImportQueue,
  type ImportJobSource,
} from './lib/articleImport';
import { buildIntentionalLevelRating } from './lib/articleLevel';
import { HomeScreen } from './components/HomeScreen';
import { ReadingScreen } from './components/ReadingScreen';
import { MyLearningScreen } from './components/MyLearningScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { LibraryScreen } from './components/LibraryScreen';
import { EnterArticleModal } from './components/EnterArticleModal';
import { OralPracticeModal } from './components/OralPracticeModal';
import { LayoutGrid, BookOpen, BarChart3, History, Sparkles, Library } from 'lucide-react';
import {
  useDueWords,
  useProficiencyStats,
  useAllWordProficiency,
  useMemoryStorageError,
} from './lib/memoryV2/hooks';

function emptySession(articleId: string): ArticleSession {
  return {
    articleId,
    chatMessages: [],
    clickCount: 0,
    discussionCount: 0,
    lastOpenedAt: new Date().toISOString(),
  };
}

// 简单的事件创建函数（替代从 proficiency 导入的版本）
function makeEvent(
  type: string,
  opts?: { articleId?: string; lemma?: string; detail?: string },
  at = new Date()
): LearningEvent {
  return {
    id: `evt-${at.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    createdAt: at.toISOString(),
    ...opts,
  } as LearningEvent;
}

function uniqueKnownWords(words: string[], knownLemmas: Set<string>): string[] {
  return [...new Set(words.map(toLemma).filter((word) => word && knownLemmas.has(word)))];
}

type RecommendationContext = {
  topic: string;
  reviewWords: string[];
};

function logRecommendationSource(source: RecommendationSource, title: string): void {
  switch (source) {
    case 'local_memory':
      console.log('📚 Memory V2.2 推荐本地文章:', title);
      break;
    case 'library_fallback':
      console.log('📖 本地库 fallback 文章:', title);
      break;
    case 'ai':
      console.log('🤖 AI 生成新文章:', title);
      break;
    case 'timeout_fallback':
      console.log('⏱️ 推荐超时后的本地 fallback:', title);
      break;
  }
}

export default function App() {
  const builtInLibrary = LIBRARY_ARTICLES;
  const [magazinePool, setMagazinePool] = useState<Article[]>(() =>
    getCachedMagazineRecommendationPool()
  );
  const [currentScreen, setCurrentScreen] = usePersistentState<ScreenType>(
    STORAGE_KEYS.currentScreen,
    'home'
  );
  const [history, setHistory] = usePersistentState<Article[]>(STORAGE_KEYS.history, []);
  const [sessions, setSessions] = usePersistentState<Record<string, ArticleSession>>(
    STORAGE_KEYS.sessions,
    {},
    normalizeArticleSessions
  );
  const [activeArticleId, setActiveArticleId] = usePersistentState<string>(
    STORAGE_KEYS.activeArticleId,
    ''
  );
  // Memory V2.2: 使用 Hooks 替代 proficiency 状态
  const { dueWords, loading: dueWordsLoading } = useDueWords();
  const { stats, loading: statsLoading } = useProficiencyStats();
  const { proficiencies, loading: proficienciesLoading } = useAllWordProficiency();
  const memoryStorageError = useMemoryStorageError();

  const [events, setEvents] = usePersistentState<LearningEvent[]>(STORAGE_KEYS.events, []);
  const [weakPoints, setWeakPoints] = usePersistentState<string[]>(STORAGE_KEYS.weakPoints, []);
  const [learningDays, setLearningDays] = usePersistentState<string[]>(
    STORAGE_KEYS.learningDays,
    [],
    normalizeLearningDateKeys
  );
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendPhase, setRecommendPhase] = useState<'local' | 'ai' | null>(null);
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteProgress, setRewriteProgress] = useState<string | null>(null);
  const [recommendationFeed, setRecommendationFeed] = useState<RecommendationFeedState>(
    createInactiveRecommendationFeed
  );
  const recommendationFeedRef = useRef(recommendationFeed);
  const recommendationContextRef = useRef<RecommendationContext | null>(null);
  const recommendationRequestIdRef = useRef(0);
  const recommendationAbortControllerRef = useRef<AbortController | null>(null);
  const recommendationAdvancedArticleIdsRef = useRef(new Set<string>());
  const completedArticleIdsRef = useRef(
    new Set(history.filter((article) => article.status === 'Completed').map((article) => article.id))
  );
  const [showEnterArticle, setShowEnterArticle] = useState(false);
  const [showOralPractice, setShowOralPractice] = useState(false);
  const importQueueSnapshot = useArticleImportQueue();

  const [reviewClock, setReviewClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setReviewClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  /** Prefetch magazine-backed candidates so Recommend for Me ranks real外刊. */
  useEffect(() => {
    let cancelled = false;
    void fetchMagazineRecommendationPool(48)
      .then((result) => {
        if (cancelled) return;
        if (result.articles.length > 0) {
          setMagazinePool(result.articles);
        } else if (result.source === 'error') {
          console.warn('Magazine recommendation pool unavailable:', result.errorMessage);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        console.warn('Magazine recommendation pool failed to load:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Ranked pool: magazines + demo library + history (status overlay). */
  const recommendationLibrary = useMemo(
    () => buildRecommendationArticlePool(magazinePool, builtInLibrary, history),
    [magazinePool, builtInLibrary, history]
  );
  const recommendationLibraryRef = useRef(recommendationLibrary);
  recommendationLibraryRef.current = recommendationLibrary;

  /** Wire independent import module: background translate + rate after store. */
  useEffect(() => {
    const queue = getArticleImportQueue();
    queue.configure({
      onStarted: (articleId) => {
        setHistory((previous) =>
          previous.map((item) =>
            item.id === articleId
              ? { ...item, importEnrichmentStatus: 'processing', importEnrichmentError: undefined }
              : item
          )
        );
      },
      onComplete: ({ articleId, article: enriched }) => {
        setHistory((previous) =>
          previous.map((item) => {
            if (item.id !== articleId) return item;
            // One rating per article: never overwrite an intentional rewrite rating
            // or an already-complete official levelRating with a second AI grade.
            const hasOfficial =
              Boolean(item.levelRating?.level && item.levelRating?.summary)
              && (item.source === 'level_rewrite' || Boolean(item.rewriteTargetLevel));
            const levelRating = hasOfficial ? item.levelRating : enriched.levelRating;
            const level = hasOfficial
              ? (item.level || item.levelRating?.level)
              : (enriched.level || enriched.levelRating?.level || item.level);
            return {
              ...item,
              content: enriched.content,
              paragraphTranslations: enriched.paragraphTranslations,
              levelRating,
              level,
              importEnrichmentStatus: 'ready',
              importEnrichmentError: undefined,
            };
          })
        );
      },
      onFailed: (articleId, error) => {
        setHistory((previous) =>
          previous.map((item) =>
            item.id === articleId
              ? { ...item, importEnrichmentStatus: 'failed', importEnrichmentError: error }
              : item
          )
        );
      },
    });
    // Sweep hung jobs every 30s so the banner cannot stick forever.
    const staleTimer = window.setInterval(() => {
      queue.failStaleJobs();
    }, 30_000);
    return () => window.clearInterval(staleTimer);
  }, [setHistory]);

  /** Resume incomplete enrichment after reload (store-first model). */
  useEffect(() => {
    const pending = history.filter(
      (a) =>
        needsImportEnrichment(a)
        && a.importEnrichmentStatus !== 'failed'
    );
    if (pending.length === 0) return;
    getArticleImportQueue().resumePending(pending);
    // Only on mount / when history identity first loads — avoid re-queue loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    history.forEach((article) => {
      if (article.status === 'Completed') completedArticleIdsRef.current.add(article.id);
    });
  }, [history]);

  const updateRecommendationFeed = (
    update: RecommendationFeedState | ((current: RecommendationFeedState) => RecommendationFeedState)
  ): RecommendationFeedState => {
    const next = typeof update === 'function'
      ? update(recommendationFeedRef.current)
      : update;
    recommendationFeedRef.current = next;
    setRecommendationFeed(next);
    return next;
  };

  const resetRecommendationFeed = () => {
    recommendationAbortControllerRef.current?.abort();
    recommendationAbortControllerRef.current = null;
    recommendationRequestIdRef.current += 1;
    recommendationContextRef.current = null;
    recommendationAdvancedArticleIdsRef.current.clear();
    setIsRecommending(false);
    setRecommendPhase(null);
    updateRecommendationFeed(createInactiveRecommendationFeed());
  };

  const activeArticle = useMemo(
    () => history.find((article) => article.id === activeArticleId)
      || recommendationLibrary.find((article) => article.id === activeArticleId)
      || builtInLibrary.find((article) => article.id === activeArticleId)
      || null,
    [activeArticleId, history, recommendationLibrary, builtInLibrary]
  );

  // Memory V2.2: 使用 Hooks 数据
  const dueLemmas = useMemo(
    () => dueWords.map(w => w.wordId),
    [dueWords]
  );

  const bands = useMemo(
    () => ({
      learning: (stats?.byLevel[1] || 0) + (stats?.byLevel[2] || 0) + (stats?.byLevel[3] || 0),
      mastered: stats?.byLevel[4] || 0,
    }),
    [stats]
  );

  const trackedLemmas = useMemo(
    () => proficiencies.map(p => p.wordId),
    [proficiencies]
  );

  const knownLemmaSet = useMemo(() => new Set(trackedLemmas), [trackedLemmas]);

  const articleProgress: ArticleProgressRow[] = useMemo(() => history.map((article) => {
    const session = sessions[article.id];
    return {
      article,
      clickCount: session?.clickCount ?? 0,
      discussionCount: session?.discussionCount ?? 0,
      hasSession: Boolean(session),
    };
  }), [history, sessions]);

  const activityDateKeys = useMemo(
    () => getLearningActivityDateKeys(learningDays, events, sessions, history),
    [learningDays, events, sessions, history]
  );
  const streakDays = useMemo(
    () => calculateLearningStreak(activityDateKeys, new Date(reviewClock)),
    [activityDateKeys, reviewClock]
  );
  const completedArticleCount = useMemo(() => countCompletedArticles(history), [history]);
  const recentEventCount = useMemo(
    () => countRecentLearningEvents(events, new Date(reviewClock), 7),
    [events, reviewClock]
  );
  const weakPointMetrics = useMemo(
    () => buildWeakPointMetrics(events, weakPoints),
    [events, weakPoints]
  );

  /** Articles the user pasted themselves (library tab「我的文章」). */
  const userArticles = useMemo(
    () => history.filter((article) => article.source === 'user_input'),
    [history]
  );

  const pushEvent = (
    type: LearningEvent['type'],
    opts?: { articleId?: string; lemma?: string; detail?: string }
  ) => {
    const learningEvent = makeEvent(type, opts);
    setEvents((previous) => [learningEvent, ...previous].slice(0, 200));
    setLearningDays((previous) => {
      const day = toLocalDateKey(learningEvent.createdAt);
      if (!day || previous.includes(day)) return previous;
      return [...previous, day].sort();
    });
  };

  const touchSession = (
    articleId: string,
    patch: Partial<ArticleSession> | ((previous: ArticleSession) => ArticleSession)
  ) => {
    setSessions((previous) => {
      const base = previous[articleId] ?? emptySession(articleId);
      const next = typeof patch === 'function'
        ? patch(base)
        : { ...base, ...patch, lastOpenedAt: new Date().toISOString() };
      return { ...previous, [articleId]: next };
    });
  };

  /**
   * Strategy D: store (and optionally open) immediately; enqueue background
   * import-module work (逐段翻译 + CEFR 评级) without blocking reading.
   */
  const ingestArticle = (
    article: Article,
    options?: {
      open?: boolean;
      source?: ImportJobSource;
      /** Force re-queue even if previously failed. */
      retryEnrichment?: boolean;
      /** Keep the transient recommendation queue while opening the next feed article. */
      preserveRecommendationFeed?: boolean;
    }
  ) => {
    const open = options?.open !== false;
    const source = options?.source ?? 'manual';
    const needs = needsImportEnrichment(article);
    const openedAt = new Date().toISOString();

    const withMeta: Article = {
      ...article,
      lastOpenedAt: open ? openedAt : article.lastOpenedAt,
      status: article.status || 'In Progress',
      importEnrichmentStatus: needs
        ? (article.importEnrichmentStatus === 'ready' ? 'pending' : article.importEnrichmentStatus || 'pending')
        : 'ready',
      importEnrichmentError: needs ? article.importEnrichmentError : undefined,
    };

    if (needs && withMeta.importEnrichmentStatus === 'ready') {
      withMeta.importEnrichmentStatus = 'pending';
    }
    if (needs && options?.retryEnrichment) {
      withMeta.importEnrichmentStatus = 'pending';
      withMeta.importEnrichmentError = undefined;
    }

    setHistory((previous) => {
      const exists = previous.some((item) => item.id === withMeta.id);
      return exists
        ? previous.map((item) => (item.id === withMeta.id ? { ...item, ...withMeta } : item))
        : [withMeta, ...previous];
    });

    if (open) {
      if (!options?.preserveRecommendationFeed) resetRecommendationFeed();
      touchSession(withMeta.id, (session) => ({ ...session, lastOpenedAt: openedAt }));
      setActiveArticleId(withMeta.id);
      setCurrentScreen('reading');
      pushEvent('article_open', { articleId: withMeta.id });
    }

    if (needs) {
      const queue = getArticleImportQueue();
      if (options?.retryEnrichment) {
        queue.retry(withMeta);
      } else {
        queue.enqueue(withMeta, source);
      }
    }
  };

  const openArticle = (article: Article) => {
    ingestArticle(article, { open: true, source: 'history' });
  };

  const retryImportEnrichment = (articleId: string) => {
    const article = history.find((a) => a.id === articleId);
    if (!article) return;
    ingestArticle(article, { open: false, source: 'retry', retryEnrichment: true });
  };

  const handleAddReviewWord = (wordData: Partial<ReviewWord>) => {
    if (!wordData.word) return;
    // Memory V2.2: 已删除 applyAddToReview，通过自然阅读积累数据
    pushEvent('add_review', { articleId: activeArticle?.id, lemma: toLemma(wordData.word) });
  };

  const handleWordClick = (word: string) => {
    // Memory V2.2: 点击事件在 ReadingScreen 中自动记录
    pushEvent('click', { articleId: activeArticle?.id, lemma: toLemma(word) });
    if (activeArticle) {
      touchSession(activeArticle.id, (session) => ({
        ...session,
        clickCount: session.clickCount + 1,
        lastOpenedAt: new Date().toISOString(),
      }));
    }
  };

  const handleGrammarQuery = (wordOrPhrase: string) => {
    // Memory V2.2: 语法查询视为普通点击，在 ReadingScreen 中自动记录
    pushEvent('grammar_query', {
      articleId: activeArticle?.id,
      lemma: toLemma(wordOrPhrase),
    });
  };

  const commitArticleExposures = (articleId: string, words: string[]) => {
    const lemmas = [...new Set(words.map(toLemma).filter(Boolean))];
    if (lemmas.length === 0) return;
    // Memory V2.2: 曝光事件在 ReadingScreen 中自动记录
    pushEvent('exposure', { articleId, detail: `${lemmas.length} lemmas` });
  };

  const handleArticleExposures = (words: string[]) => {
    if (!activeArticle) return;
    commitArticleExposures(activeArticle.id, words);
  };

  const mergeWeakPoints = (tags: string[]) => {
    if (!tags.length) return;
    setWeakPoints((previous) => [...new Set([...previous, ...tags])].slice(0, 12));
  };

  const applyAssessment = (
    text: string,
    result: StructuredAssessResult,
    targetWords: string[],
    productionBoost: number,
    articleId?: string
  ) => {
    const correctWords = uniqueKnownWords(result.wordsUsedCorrectly || [], knownLemmaSet);
    const incorrectWords = uniqueKnownWords(result.wordsUsedIncorrectly || [], knownLemmaSet);
    const explicitlyHandled = new Set([...correctWords, ...incorrectWords]);
    // Memory V2.2: 已删除产出能力追踪（applyStructuredProduction, applyAvoidance）
    // 只保留弱点分析和事件记录

    incorrectWords.forEach((lemma) => pushEvent('incorrect_use', { articleId, lemma }));
    // avoidedWords 功能已删除，Memory V2.2 不追踪回避行为

    const observedWeakPoints = [...new Set(
      [...(result.weakPoints || []), ...(result.errors || []).map((error) => error.type)]
        .map((tag) => tag.trim())
        .filter(Boolean)
    )];
    mergeWeakPoints(observedWeakPoints);
    observedWeakPoints.forEach((tag) => {
      pushEvent('weak_point', { articleId, detail: tag });
    });
  };

  /** Discussion = Socratic Q&A about the article; does NOT update word proficiency. */
  const handleDiscussionAssessed = (text: string, _result: StructuredAssessResult) => {
    const articleId = activeArticle?.id;
    pushEvent('discussion', { articleId, detail: text.slice(0, 80) });
    if (articleId) {
      touchSession(articleId, (session) => ({
        ...session,
        discussionCount: session.discussionCount + 1,
        lastOpenedAt: new Date().toISOString(),
      }));
    }
  };


  const handleArticleCompleted = (articleId: string) => {
    const article = history.find((item) => item.id === articleId);
    if (!article || article.status === 'Completed' || completedArticleIdsRef.current.has(articleId)) {
      return;
    }
    completedArticleIdsRef.current.add(articleId);
    const completedAt = new Date().toISOString();
    setHistory((previous) => previous.map((item) =>
      item.id === articleId
        ? { ...item, status: 'Completed', completedAt }
        : item
    ));
    pushEvent('article_complete', { articleId });
  };

  const handleOralAssessed = (text: string, result: StructuredAssessResult) => {
    const targets = dueLemmas.slice(0, 5);
    applyAssessment(text, result, targets, 0.12);
    pushEvent('discussion', { detail: `oral: ${text.slice(0, 72)}` });
  };

  const openRecommendationArticle = (article: Article) => {
    ingestArticle(article, {
      open: true,
      source: article.source === 'ai_generated' ? 'recommend' : 'history',
      preserveRecommendationFeed: true,
    });
  };

  const ensureMagazineRecommendationPool = async (signal?: AbortSignal) => {
    if (magazinePool.length > 0) return magazinePool;
    const result = await fetchMagazineRecommendationPool(48, { signal });
    if (result.articles.length > 0) {
      setMagazinePool(result.articles);
    }
    return result.articles;
  };

  const resolveNextRecommendation = async (
    request: { topic: string; reviewWords: string[]; excludeArticleIds: string[] },
    signal?: AbortSignal
  ) => {
    // Refresh pool if empty so first recommend does not rank only mock stubs.
    const magazines = await ensureMagazineRecommendationPool(signal);
    const library = buildRecommendationArticlePool(
      magazines.length ? magazines : magazinePool,
      builtInLibrary,
      history
    );
    recommendationLibraryRef.current = library;

    const resolved = await resolveRecommendationArticle(
      request,
      {
        library,
        history,
        userLevel: 'B1',
        onPhase: (phase) => {
          setRecommendPhase(phase === 'ai' ? 'ai' : 'local');
        },
      },
      { signal }
    );
    if (resolved) {
      logRecommendationSource(resolved.source, resolved.article.title);
    }
    return resolved;
  };

  const prefetchNextRecommendationArticle = async () => {
    const context = recommendationContextRef.current;
    const current = recommendationFeedRef.current;
    if (!context || current.status !== 'active') return;

    const loading = beginRecommendationPrefetch(current);
    if (loading === current) return;
    updateRecommendationFeed(loading);

    recommendationAbortControllerRef.current?.abort();
    const controller = new AbortController();
    recommendationAbortControllerRef.current = controller;
    const requestId = ++recommendationRequestIdRef.current;
    try {
      const resolved = await resolveNextRecommendation(
        {
          ...context,
          excludeArticleIds: loading.seenArticleIds,
        },
        controller.signal
      );
      if (requestId !== recommendationRequestIdRef.current) return;
      if (!resolved) {
        updateRecommendationFeed((latest) => failRecommendationPrefetch(latest));
        return;
      }
      updateRecommendationFeed((latest) =>
        finishRecommendationPrefetch(latest, resolved.article)
      );
    } catch (error) {
      if (requestId !== recommendationRequestIdRef.current || controller.signal.aborted) return;
      console.warn('Recommendation prefetch failed; using the local library.', error);
      const fallback = selectLibraryFallback(
        recommendationLibraryRef.current,
        history,
        new Set(loading.seenArticleIds)
      );
      updateRecommendationFeed((latest) => fallback
        ? finishRecommendationPrefetch(latest, fallback)
        : failRecommendationPrefetch(latest));
    } finally {
      if (recommendationAbortControllerRef.current === controller) {
        recommendationAbortControllerRef.current = null;
      }
    }
  };

  const showRecommendationFeedEnd = (state = recommendationFeedRef.current) => {
    recommendationAbortControllerRef.current?.abort();
    recommendationAbortControllerRef.current = null;
    recommendationRequestIdRef.current += 1;
    setIsRecommending(false);
    setRecommendPhase(null);
    recommendationContextRef.current = null;
    updateRecommendationFeed(endRecommendationFeed(state));
    setActiveArticleId('');
    setCurrentScreen('reading');
  };

  const startRecommendationReading = async (topic: string, reviewWords: string[]) => {
    if (isRecommending) return;
    resetRecommendationFeed();
    setIsRecommending(true);
    setRecommendPhase('local');
    recommendationContextRef.current = { topic, reviewWords };
    const controller = new AbortController();
    recommendationAbortControllerRef.current = controller;
    const requestId = ++recommendationRequestIdRef.current;
    let shouldPrefetch = false;

    try {
      let article: Article | null = null;
      try {
        const resolved = await resolveNextRecommendation(
          { topic, reviewWords, excludeArticleIds: [] },
          controller.signal
        );
        article = resolved?.article ?? null;
      } catch (error) {
        if (requestId !== recommendationRequestIdRef.current || controller.signal.aborted) return;
        console.warn('Recommendation failed; using the local library.', error);
        article = selectLibraryFallback(
          recommendationLibraryRef.current,
          history,
          new Set()
        );
        if (article) logRecommendationSource('timeout_fallback', article.title);
      }

      if (requestId !== recommendationRequestIdRef.current) return;
      if (!article) {
        showRecommendationFeedEnd(startRecommendationFeed(''));
        return;
      }

      updateRecommendationFeed(startRecommendationFeed(article.id));
      openRecommendationArticle(article);
      pushEvent('review_start', { articleId: article.id, detail: reviewWords.join(',') });
      shouldPrefetch = true;
    } finally {
      if (recommendationAbortControllerRef.current === controller) {
        recommendationAbortControllerRef.current = null;
      }
      if (requestId === recommendationRequestIdRef.current) {
        setIsRecommending(false);
        setRecommendPhase(null);
      }
    }

    if (shouldPrefetch && recommendationFeedRef.current.status === 'active') {
      void prefetchNextRecommendationArticle();
    }
  };

  const handleRecommendForMe = () => {
    const reviewWords = dueLemmas.slice(0, 5);
    void startRecommendationReading('English Idioms & Daily Practice', reviewWords);
  };

  const handleStartTargetedReview = () => {
    const words = dueLemmas.slice(0, 5);
    void startRecommendationReading(
      `Contextual review of: ${words.join(', ') || 'core vocabulary'}`,
      words
    );
  };

  const handleRecommendationAdvance = (payload: ReadingAdvancePayload) => {
    const current = recommendationFeedRef.current;
    if (
      current.status !== 'active'
      || activeArticleId !== payload.articleId
      || !current.seenArticleIds.includes(payload.articleId)
      || recommendationAdvancedArticleIdsRef.current.has(payload.articleId)
    ) return;

    recommendationAdvancedArticleIdsRef.current.add(payload.articleId);
    if (payload.reason === 'completed') {
      commitArticleExposures(payload.articleId, payload.exposedLemmas);
      handleArticleCompleted(payload.articleId);
    }

    const consumed = consumeQueuedRecommendation(current);
    let nextState = consumed.state;
    let nextArticle = consumed.article;

    if (!nextArticle) {
      nextArticle = selectLibraryFallback(
        recommendationLibraryRef.current,
        history,
        new Set(nextState.seenArticleIds)
      );
      if (nextArticle) {
        nextState = markRecommendationArticleSeen(nextState, nextArticle.id);
      }
    }

    if (!nextArticle) {
      showRecommendationFeedEnd(nextState);
      return;
    }

    updateRecommendationFeed(nextState);
    openRecommendationArticle(nextArticle);
    void prefetchNextRecommendationArticle();
  };

  const handleAddNewCustomArticle = (newArticle: Article) => {
    setShowEnterArticle(false);
    // Manual import: store + open immediately; import module enriches in background.
    ingestArticle(
      { ...newArticle, source: newArticle.source || 'user_input' },
      { open: true, source: 'manual' }
    );
  };

  /** Rewrite current (or given) article at a target CEFR level as a new version. */
  const handleRewriteAtLevel = async (sourceArticle: Article, level: string) => {
    if (isRewriting || isRecommending) return;
    const targetLevel = level.trim().toUpperCase();
    if (!/^[ABC][12]$/.test(targetLevel)) {
      window.alert('请选择有效的 CEFR 等级（A2–C1 等）。');
      return;
    }

    setIsRewriting(true);
    setRewriteProgress(`正在生成 CEFR ${targetLevel} 版本…`);
    try {
      const reviewWords = (
        sourceArticle.embeddedReviewWords?.length
          ? sourceArticle.embeddedReviewWords
          : dueLemmas
      ).slice(0, 5);

      // Cap source size for the rewrite prompt (server also truncates).
      const paragraphs = sourceArticle.content
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 24);

      const response = await postTutor<RecommendedArticleCandidate & { level?: string }>({
        intent: 'rewrite_article',
        level: targetLevel,
        paragraphs,
        topic: sourceArticle.title,
        reviewWords,
      });
      const data = response.result;
      const resolvedLevel = (data.level || targetLevel).toUpperCase();
      // One rating per article: lock CEFR to the user-chosen rewrite level (do not re-rate).
      const levelRating = buildIntentionalLevelRating(
        resolvedLevel,
        `本篇唯一 CEFR 评级为 ${resolvedLevel}（由原文「${sourceArticle.title}」改写生成）。`
      );
      const newArticle: Article = {
        id: `rewrite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: data.title?.includes(resolvedLevel)
          ? data.title
          : `${data.title || sourceArticle.title} · ${resolvedLevel}`,
        description: data.description || `CEFR ${resolvedLevel} rewrite of “${sourceArticle.title}”`,
        date: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        status: 'In Progress',
        source: 'level_rewrite',
        level: levelRating.level,
        levelRating,
        rewriteTargetLevel: levelRating.level,
        parentArticleId: sourceArticle.id,
        parentArticleTitle: sourceArticle.title,
        content: data.paragraphs,
        keyWords: data.keyWords,
        embeddedReviewWords: reviewWords.length ? reviewWords : undefined,
        topic: sourceArticle.topic,
        importEnrichmentStatus: 'pending',
      };

      setRewriteProgress(`已生成 ${resolvedLevel} 版本，正在入库…`);
      ingestArticle(newArticle, { open: true, source: 'manual' });
      pushEvent('review_start', {
        articleId: newArticle.id,
        detail: `rewrite:${targetLevel}:from:${sourceArticle.id}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '改写失败';
      window.alert(`按等级改写失败：${message}`);
    } finally {
      setIsRewriting(false);
      setRewriteProgress(null);
    }
  };

  const handleOpenParentArticle = (parentId: string) => {
    const parent = history.find((a) => a.id === parentId);
    if (parent) {
      ingestArticle(parent, { open: true, source: 'history' });
    } else {
      window.alert('原文不在历史记录中（可能已被清除）。');
    }
  };

  const activeSession = activeArticle ? sessions[activeArticle.id] : undefined;
  const isRecommendationReading = Boolean(
    recommendationFeed.status === 'active'
    && activeArticle
    && recommendationFeed.seenArticleIds.includes(activeArticle.id)
  );
  const returnHome = () => {
    resetRecommendationFeed();
    setCurrentScreen('home');
  };

  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#2B2723] font-sans flex flex-col">
      <div className="bg-[#EFECE3] border-b border-[#E0DBCF] px-4 py-2 flex items-center justify-between text-xs font-medium text-[#5B544C]">
        <div className="flex items-center gap-1 font-serif text-sm font-semibold text-[#2C2723]">
          <Sparkles className="w-4 h-4 text-[#C35E37]" />
          <span>English AI · P0</span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
          {(
            [
              { id: 'home' as const, label: 'P1', icon: LayoutGrid },
              { id: 'library' as const, label: 'Library', icon: Library },
              { id: 'reading' as const, label: 'P2', icon: BookOpen },
              { id: 'learning' as const, label: 'P3', icon: BarChart3 },
              { id: 'history' as const, label: 'P4', icon: History },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                if (
                  id === 'reading'
                  && !activeArticle
                  && recommendationFeed.status !== 'ended'
                ) {
                  returnHome();
                  return;
                }
                if (id !== 'reading') resetRecommendationFeed();
                setCurrentScreen(id);
              }}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 shrink-0 ${
                currentScreen === id
                  ? 'bg-white text-[#C35E37] shadow-2xs font-semibold'
                  : 'hover:bg-[#E4DFD5]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {isRecommending && (
        <div className="bg-[#FEF3C7] border-b border-[#FDE68A] text-center text-xs text-[#92400E] py-2 font-medium flex items-center justify-center gap-3">
          <span>
            {recommendPhase === 'ai'
              ? `正在生成含复习词的文章（最多等待 ${Math.round(RECOMMENDATION_INTERACTION_BUDGET_MS / 1000)} 秒）…`
              : '正在从本地库匹配推荐文章…'}
          </span>
          <button
            type="button"
            onClick={resetRecommendationFeed}
            className="rounded border border-[#D97706] px-2 py-0.5 hover:bg-[#FDE68A]"
          >
            取消
          </button>
        </div>
      )}

      {memoryStorageError && (
        <div className="bg-[#FEE2E2] border-b border-[#FECACA] text-center text-xs text-[#991B1B] py-2 font-medium px-3">
          {memoryStorageError}
        </div>
      )}

      {isRewriting && (
        <div className="bg-[#FCE7F3] border-b border-[#FBCFE8] text-center text-xs text-[#9D174D] py-2 font-medium px-3">
          {rewriteProgress || '正在按等级改写文章…'}
        </div>
      )}

      {importQueueSnapshot.bannerMessage && (
        <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] text-center text-xs text-[#075985] py-2 font-medium px-3 flex items-center justify-center gap-3 flex-wrap">
          <span>{importQueueSnapshot.bannerMessage}</span>
          <button
            type="button"
            onClick={() => {
              getArticleImportQueue().cancelAll();
              setHistory((previous) =>
                previous.map((item) =>
                  item.importEnrichmentStatus === 'pending'
                  || item.importEnrichmentStatus === 'processing'
                    ? {
                        ...item,
                        importEnrichmentStatus: 'failed',
                        importEnrichmentError: '用户取消导入队列',
                      }
                    : item
                )
              );
            }}
            className="shrink-0 px-2 py-0.5 rounded-md border border-[#7DD3FC] bg-white/80 text-[#0369A1] hover:bg-white"
            title="取消当前导入队列（已完成的保留）"
          >
            取消队列
          </button>
        </div>
      )}

      <div className="flex-1">
        {currentScreen === 'home' && (
          <HomeScreen
            onEnterArticle={() => setShowEnterArticle(true)}
            onPickFromLibrary={() => setCurrentScreen('library')}
            onRecommendForMe={handleRecommendForMe}
            onOralPractice={() => setShowOralPractice(true)}
            onGoToLearning={() => setCurrentScreen('learning')}
            onStartTargetedReview={handleStartTargetedReview}
            pendingReviewCount={dueLemmas.length}
          />
        )}

        {currentScreen === 'library' && (
          <LibraryScreen
            userArticles={userArticles}
            onSelectArticle={(article) =>
              ingestArticle(article, {
                open: true,
                source: article.source === 'magazine' ? 'magazine' : 'history',
              })
            }
            onInsertArticle={() => setShowEnterArticle(true)}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'reading' && activeArticle && (
          <ReadingScreen
            key={activeArticle.id}
            article={activeArticle}
            importJob={importQueueSnapshot.jobs.find((j) => j.articleId === activeArticle.id) ?? null}
            onRetryImport={() => retryImportEnrichment(activeArticle.id)}
            isRewriting={isRewriting}
            onRewriteAtLevel={(level) => handleRewriteAtLevel(activeArticle, level)}
            onOpenParentArticle={
              activeArticle.parentArticleId
                ? () => handleOpenParentArticle(activeArticle.parentArticleId!)
                : undefined
            }
            onBack={returnHome}
            onAddReviewWord={handleAddReviewWord}
            onWordClick={handleWordClick}
            onGrammarQuery={handleGrammarQuery}
            mode={isRecommendationReading ? 'recommendation-feed' : 'single'}
            onAdvance={isRecommendationReading ? handleRecommendationAdvance : undefined}
            onExposures={isRecommendationReading ? undefined : handleArticleExposures}
            onReadingComplete={
              isRecommendationReading ? undefined : () => handleArticleCompleted(activeArticle.id)
            }
            onDiscussionAssessed={handleDiscussionAssessed}
            initialChatMessages={activeSession?.chatMessages || []}
            trackedLemmas={trackedLemmas}
            onChatMessagesChange={(messages) => {
              touchSession(activeArticle.id, (s) => ({
                ...s,
                chatMessages: messages,
                lastOpenedAt: new Date().toISOString(),
              }));
            }}
          />
        )}

        {currentScreen === 'reading' && recommendationFeed.status === 'ended' && (
          <div className="min-h-[60vh] px-6 py-16 flex items-center justify-center text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#EFEAE0] text-[#C35E37]">
                <BookOpen className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="font-serif text-2xl text-[#2C2723]">没有更多文章</h2>
              <p className="mt-2 text-sm leading-6 text-[#777066]">
                本次推荐流中的文章已经全部读完或浏览过了。
              </p>
              <button
                type="button"
                onClick={returnHome}
                className="mt-6 rounded-xl bg-[#C35E37] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#A94E2D]"
              >
                返回首页
              </button>
            </div>
          </div>
        )}

        {currentScreen === 'reading' && !activeArticle && recommendationFeed.status !== 'ended' && (
          <div className="p-12 text-center text-[#666]">
            <p className="mb-4">还没有打开文章，请先从首页或文库选择一篇文章。</p>
            <button
              onClick={returnHome}
              className="px-4 py-2 bg-[#C35E37] text-white rounded-xl text-sm"
            >
              返回首页
            </button>
          </div>
        )}

        {currentScreen === 'learning' && (
          <MyLearningScreen
            onBack={() => setCurrentScreen('home')}
            onStartTargetedReview={handleStartTargetedReview}
            onOpenArticle={(id) => {
              const art = history.find((a) => a.id === id);
              if (art) ingestArticle(art, { open: true, source: 'history' });
            }}
            articlesReadCount={completedArticleCount}
            masteredWordsCount={bands.mastered}
            learningWordsCount={bands.learning}
            streakDaysCount={streakDays}
            recentEventCount={recentEventCount}
            dueWordCount={dueLemmas.length}
            weakPointMetrics={weakPointMetrics}
            isTargetedReviewLoading={isRecommending}
            articleProgress={articleProgress}
          />
        )}

        {currentScreen === 'history' && (
          <HistoryScreen
            articles={history}
            sessions={sessions}
            onSelectArticle={(article) =>
              ingestArticle(article, { open: true, source: 'history' })
            }
            onBack={() => setCurrentScreen('home')}
          />
        )}
      </div>

      {showEnterArticle && (
        <EnterArticleModal
          onClose={() => setShowEnterArticle(false)}
          onSubmitCustomArticle={handleAddNewCustomArticle}
        />
      )}

      {showOralPractice && (
        <OralPracticeModal
          onClose={() => setShowOralPractice(false)}
          reviewWords={dueLemmas.slice(0, 5)}
          onAssessed={handleOralAssessed}
        />
      )}
    </div>
  );
}

