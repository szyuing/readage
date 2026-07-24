import React, { useEffect, useMemo, useState } from 'react';
import {
  ScreenType,
  Article,
  ReviewWord,
  LearningEvent,
  WordProficiency,
  ArticleSession,
  StructuredAssessResult,
  ArticleProgressRow,
} from './types';
import {
  LIBRARY_ARTICLES,
  INITIAL_REVIEW_WORDS,
  buildFallbackReviewArticle,
} from './data/mockArticles';
import {
  applyAddToReview,
  applyAvoidance,
  applyClickLookup,
  applyExposures,
  applyGrammarQuery,
  countByBand,
  findAvoidedTargetWords,
  getDueLemmas,
  makeEvent,
  migrateProficiencyMap,
  seedFromReviewWords,
  toLemma,
} from './lib/proficiency';
import { applyStructuredProduction } from './lib/structuredProduction';
import { normalizeArticleSessions, STORAGE_KEYS, usePersistentState } from './lib/storage';
import { postTutor } from './lib/tutorClient';
import type { RecommendedArticleCandidate } from './lib/articleValidation';
import {
  getArticleImportQueue,
  needsImportEnrichment,
  useArticleImportQueue,
  type ImportJobSource,
} from './lib/articleImport';
import { HomeScreen } from './components/HomeScreen';
import { ReadingScreen } from './components/ReadingScreen';
import { MyLearningScreen } from './components/MyLearningScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { LibraryScreen } from './components/LibraryScreen';
import { EnterArticleModal } from './components/EnterArticleModal';
import { OralPracticeModal } from './components/OralPracticeModal';
import { LayoutGrid, BookOpen, BarChart3, History, Sparkles, Library } from 'lucide-react';

function emptySession(articleId: string): ArticleSession {
  return {
    articleId,
    chatMessages: [],
    clickCount: 0,
    discussionCount: 0,
    lastOpenedAt: new Date().toISOString(),
  };
}

function uniqueKnownWords(words: string[], knownLemmas: Set<string>): string[] {
  return [...new Set(words.map(toLemma).filter((word) => word && knownLemmas.has(word)))];
}

export default function App() {
  const library = LIBRARY_ARTICLES;
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
  const [proficiency, setProficiency] = usePersistentState<Record<string, WordProficiency>>(
    STORAGE_KEYS.proficiency,
    () => seedFromReviewWords(INITIAL_REVIEW_WORDS),
    (stored, fallback) => migrateProficiencyMap(stored, new Date(), fallback)
  );
  const [events, setEvents] = usePersistentState<LearningEvent[]>(STORAGE_KEYS.events, []);
  const [weakPoints, setWeakPoints] = usePersistentState<string[]>(STORAGE_KEYS.weakPoints, []);
  const [streakDays] = useState(15);
  const [isRecommending, setIsRecommending] = useState(false);
  const [showEnterArticle, setShowEnterArticle] = useState(false);
  const [showOralPractice, setShowOralPractice] = useState(false);
  const importQueueSnapshot = useArticleImportQueue();

  const [reviewClock, setReviewClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setReviewClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
          previous.map((item) =>
            item.id === articleId
              ? {
                  ...item,
                  content: enriched.content,
                  paragraphTranslations: enriched.paragraphTranslations,
                  levelRating: enriched.levelRating,
                  level: enriched.level || enriched.levelRating?.level || item.level,
                  importEnrichmentStatus: 'ready',
                  importEnrichmentError: undefined,
                }
              : item
          )
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


  const activeArticle = useMemo(
    () => history.find((article) => article.id === activeArticleId)
      || library.find((article) => article.id === activeArticleId)
      || null,
    [activeArticleId, history, library]
  );
  const dueLemmas = useMemo(
    () => getDueLemmas(proficiency, new Date(reviewClock)),
    [proficiency, reviewClock]
  );
  const bands = useMemo(
    () => countByBand(proficiency, new Date(reviewClock)),
    [proficiency, reviewClock]
  );
  const trackedLemmas = useMemo(() => Object.keys(proficiency), [proficiency]);
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

  /** Articles the user pasted themselves (library tab「我的文章」). */
  const userArticles = useMemo(
    () => history.filter((article) => article.source === 'user_input'),
    [history]
  );

  const pushEvent = (
    type: LearningEvent['type'],
    opts?: { articleId?: string; lemma?: string; detail?: string }
  ) => {
    setEvents((previous) => [makeEvent(type, opts), ...previous].slice(0, 200));
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
      touchSession(withMeta.id, (session) => ({ ...session, lastOpenedAt: openedAt }));
      setActiveArticleId(withMeta.id);
      setCurrentScreen('reading');
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
    setProficiency((previous) => applyAddToReview(previous, { ...wordData, word: wordData.word! }));
    pushEvent('add_review', { articleId: activeArticle?.id, lemma: toLemma(wordData.word) });
  };

  const handleWordClick = (word: string) => {
    setProficiency((previous) => applyClickLookup(previous, word));
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
    setProficiency((previous) => applyGrammarQuery(previous, wordOrPhrase));
    pushEvent('grammar_query', {
      articleId: activeArticle?.id,
      lemma: toLemma(wordOrPhrase),
    });
  };

  const handleArticleExposures = (words: string[]) => {
    setProficiency((previous) => applyExposures(previous, words));
    pushEvent('exposure', { articleId: activeArticle?.id, detail: `${words.length} tokens` });
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
    const avoidedWords = findAvoidedTargetWords(text, targetWords)
      .filter((word) => knownLemmaSet.has(word) && !explicitlyHandled.has(word));

    setProficiency((previous) => {
      let next = applyStructuredProduction(previous, correctWords, incorrectWords, productionBoost);
      next = applyAvoidance(next, avoidedWords);
      return next;
    });

    incorrectWords.forEach((lemma) => pushEvent('incorrect_use', { articleId, lemma }));
    avoidedWords.forEach((lemma) => pushEvent('avoidance', { articleId, lemma }));
    mergeWeakPoints([...(result.weakPoints || []), ...(result.errors || []).map((error) => error.type)]);
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


  const handleOralAssessed = (text: string, result: StructuredAssessResult) => {
    const targets = dueLemmas.slice(0, 5);
    applyAssessment(text, result, targets, 0.12);
    pushEvent('discussion', { detail: `oral: ${text.slice(0, 72)}` });
  };

  const fetchRecommendedArticle = async (topic: string, reviewWords: string[]): Promise<Article> => {
    try {
      const response = await postTutor<RecommendedArticleCandidate>({
        intent: 'recommend_article',
        topic,
        reviewWords,
        level: 'B1',
      });
      const data = response.result;
      return {
        id: `rec-${Date.now()}`,
        title: data.title,
        description: data.description,
        date: new Date().toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        }),
        status: 'In Progress',
        source: 'ai_generated',
        level: 'B1',
        topic,
        content: data.paragraphs,
        keyWords: data.keyWords,
        embeddedReviewWords: reviewWords,
      };
    } catch {
      return buildFallbackReviewArticle(reviewWords);
    }
  };

  const handleRecommendForMe = async () => {
    if (isRecommending) return;
    setIsRecommending(true);
    try {
      const reviewWords = dueLemmas.slice(0, 5);
      const article = await fetchRecommendedArticle('English Idioms & Daily Practice', reviewWords);
      ingestArticle(article, { open: true, source: 'recommend' });
      pushEvent('review_start', { articleId: article.id, detail: reviewWords.join(',') });
    } finally {
      setIsRecommending(false);
    }
  };

  const handleStartTargetedReview = async () => {
    if (isRecommending) return;
    setIsRecommending(true);
    try {
      const words = dueLemmas.slice(0, 5);
      const article = await fetchRecommendedArticle(
        `Contextual review of: ${words.join(', ') || 'core vocabulary'}`,
        words
      );
      ingestArticle(article, { open: true, source: 'recommend' });
      pushEvent('review_start', { articleId: article.id, detail: words.join(',') });
    } finally {
      setIsRecommending(false);
    }
  };

  const handleAddNewCustomArticle = (newArticle: Article) => {
    setShowEnterArticle(false);
    // Manual import: store + open immediately; import module enriches in background.
    ingestArticle(
      { ...newArticle, source: newArticle.source || 'user_input' },
      { open: true, source: 'manual' }
    );
  };

  const activeSession = activeArticle ? sessions[activeArticle.id] : undefined;

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
                if (id === 'reading' && !activeArticle) {
                  setCurrentScreen('home');
                  return;
                }
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
        <div className="bg-[#FEF3C7] border-b border-[#FDE68A] text-center text-xs text-[#92400E] py-2 font-medium">
          正在生成含到期复习词的语境文章…
        </div>
      )}

      {importQueueSnapshot.bannerMessage && (
        <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] text-center text-xs text-[#075985] py-2 font-medium px-3">
          {importQueueSnapshot.bannerMessage}
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
            onBack={() => setCurrentScreen('home')}
            onAddReviewWord={handleAddReviewWord}
            onWordClick={handleWordClick}
            onGrammarQuery={handleGrammarQuery}
            onExposures={handleArticleExposures}
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

        {currentScreen === 'reading' && !activeArticle && (
          <div className="p-12 text-center text-[#666]">
            <p className="mb-4">还没有打开文章，请先从首页或文库选择一篇文章。</p>
            <button
              onClick={() => setCurrentScreen('home')}
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
            articlesReadCount={history.length}
            masteredWordsCount={bands.mastered}
            learningWordsCount={bands.learning}
            streakDaysCount={streakDays}
            recentEventCount={events.length}
            dueWordCount={dueLemmas.length}
            weakPoints={weakPoints}
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

