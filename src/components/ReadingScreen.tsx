import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  MoreHorizontal,
  BookOpen,
  Globe,
  MessageCircle,
  Send,
  Sparkles,
  CheckCircle2,
  X,
  Volume2,
  PenLine,
} from 'lucide-react';
import {
  Article,
  GrammarExplanation,
  TranslationResult,
  StructuredAssessResult,
  ChatMessage,
  ReadingAdvancePayload,
  ReadingMode,
} from '../types';

import {
  extractLearningUnits,
  findLearningUnitAtTokenIndex,
  hasSufficientExposureVisibility,
} from '../lib/readingExposure';
import { getPhraseHighlightMatches } from '../lib/textHighlight';
import { postTutor } from '../lib/tutorClient';
import type { ImportJob } from '../lib/articleImport';
import { needsImportEnrichment } from '../lib/articleImport';
import { classifyArticleParagraph } from '../lib/articlePresentation';
import {
  buildReadingAdvancePayload,
  countArticleWords,
  isLeftSwipeGesture,
  minDwellMsBeforeAutoAdvance,
} from '../lib/continuousReading';
import { useMemoryV2Integration } from '../lib/memoryV2Integration';
import { createWordCardRequest, fetchWordCard } from '../lib/wordCard';
import { formatSelectionQuote } from '../lib/readingSelection';
import { WordCardPanel } from './WordCardPanel';

let recommendationNavigationHintShown = false;

const REWRITE_CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

interface ReadingScreenProps {
  article: Article;
  /** Live job from the independent import module (translate + rate). */
  importJob?: ImportJob | null;
  onRetryImport?: () => void;
  /** CEFR level rewrite in progress (parent). */
  isRewriting?: boolean;
  /** Generate a new article version at the chosen CEFR level. */
  onRewriteAtLevel?: (level: string) => void;
  /** User reading level from English test — highlight preferred rewrite target. */
  preferredCefrLevel?: string;
  /** Open the parent article this rewrite was based on. */
  onOpenParentArticle?: () => void;
  onBack: () => void;
  onWordClick?: (word: string) => void;
  onGrammarQuery?: (wordOrPhrase: string) => void;
  onExposures?: (words: string[]) => void;
  onReadingComplete?: () => void;
  mode?: ReadingMode;
  onAdvance?: (payload: ReadingAdvancePayload) => void;
  /** Structured discussion assessment -> production updates. */
  onDiscussionAssessed?: (text: string, result: StructuredAssessResult) => void;
  initialChatMessages?: ChatMessage[];
  trackedLemmas?: string[];
  onChatMessagesChange?: (messages: ChatMessage[]) => void;
}

export const ReadingScreen: React.FC<ReadingScreenProps> = ({
  article,
  importJob = null,
  onRetryImport,
  isRewriting = false,
  onRewriteAtLevel,
  preferredCefrLevel,
  onOpenParentArticle,
  onBack,
  onWordClick,
  onGrammarQuery,
  onExposures,
  onReadingComplete,
  mode = 'single',
  onAdvance,
  onDiscussionAssessed,
  initialChatMessages = [],
  trackedLemmas = [],
  onChatMessagesChange,
}) => {
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectedContext, setSelectedContext] = useState<string>('');
  const [showRewriteLevels, setShowRewriteLevels] = useState(false);

  const [isExplaining, setIsExplaining] = useState(false);
  const [grammarResult, setGrammarResult] = useState<GrammarExplanation | null>(null);
  const [wordCardOpen, setWordCardOpen] = useState(false);

  const [isTranslating, setIsTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);

  const [addedWordSuccess, setAddedWordSuccess] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const [userInput, setUserInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [showChatPanel, setShowChatPanel] = useState(initialChatMessages.length > 0);
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const [articleVisible, setArticleVisible] = useState(false);
  const [showNavigationHint, setShowNavigationHint] = useState(false);

  // Memory V2.2 集成
  const { recordParagraphExposure, recordWordClick } = useMemoryV2Integration(article.id);

  // Restore chat when switching articles / session
  useEffect(() => {
    setChatMessages(initialChatMessages);
    setShowChatPanel(initialChatMessages.length > 0);
    setIsComposerExpanded(false);
    setWordCardOpen(false);
    setGrammarResult(null);
    setIsExplaining(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id]);

  useEffect(() => {
    if (isComposerExpanded) composerInputRef.current?.focus();
  }, [isComposerExpanded]);

  const [showMenu, setShowMenu] = useState(false);
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('normal');
  /** Show Chinese paragraph translations produced on import. */
  const [showParagraphTranslations, setShowParagraphTranslations] = useState(true);
  const [showLevelDetail, setShowLevelDetail] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const wordCardAbortRef = useRef<AbortController | null>(null);
  const exposedLemmasRef = useRef<Set<string>>(new Set());
  const onExposuresRef = useRef(onExposures);
  const onReadingCompleteRef = useRef(onReadingComplete);
  const onAdvanceRef = useRef(onAdvance);
  const hasAdvancedRef = useRef(false);
  const suppressNextWordClickRef = useRef(false);
  const rightSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  /** Wall-clock when the current article became active — gates auto-advance. */
  const articleOpenedAtRef = useRef(Date.now());

  useEffect(() => {
    return () => {
      wordCardAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    onExposuresRef.current = onExposures;
  }, [onExposures]);

  useEffect(() => {
    onReadingCompleteRef.current = onReadingComplete;
  }, [onReadingComplete]);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    hasAdvancedRef.current = false;
    exposedLemmasRef.current = new Set();
    articleOpenedAtRef.current = Date.now();
    setArticleVisible(false);
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      setArticleVisible(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [article.id]);

  useEffect(() => {
    if (mode !== 'recommendation-feed' || recommendationNavigationHintShown) return;
    recommendationNavigationHintShown = true;
    setShowNavigationHint(true);
  }, [mode]);

  useEffect(() => {
    if (!showNavigationHint) return;
    const timer = window.setTimeout(() => setShowNavigationHint(false), 2600);
    return () => window.clearTimeout(timer);
  }, [showNavigationHint]);

  // A paragraph counts as read only after it stays at least 60% visible for 800ms.
  useEffect(() => {
    const container = contentRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return;

    let isActive = true;
    let autoAdvanceTimer: number | null = null;
    const visibleParagraphs = new Set<Element>();
    const completedParagraphs = new Set<Element>();
    const exposureTimers = new Map<Element, number>();
    exposedLemmasRef.current = new Set();

    const clearExposureTimer = (paragraph: Element) => {
      const timerId = exposureTimers.get(paragraph);
      if (timerId === undefined) return;
      window.clearTimeout(timerId);
      exposureTimers.delete(paragraph);
    };

    const clearAutoAdvanceTimer = () => {
      if (autoAdvanceTimer === null) return;
      window.clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    };

    const finishReading = () => {
      if (!isActive || hasAdvancedRef.current) return;
      hasAdvancedRef.current = true;
      clearAutoAdvanceTimer();
      if (mode === 'recommendation-feed') {
        onAdvanceRef.current?.(
          buildReadingAdvancePayload(article.id, 'completed', exposedLemmasRef.current)
        );
      } else {
        onReadingCompleteRef.current?.();
      }
    };

    const scheduleFinishReading = () => {
      if (!isActive || hasAdvancedRef.current || autoAdvanceTimer !== null) return;
      if (mode !== 'recommendation-feed') {
        finishReading();
        return;
      }
      // Prevent short on-screen articles from auto-skipping after ~800ms.
      const wordCount = countArticleWords(article.content);
      const minDwell = minDwellMsBeforeAutoAdvance(wordCount);
      const elapsed = Date.now() - articleOpenedAtRef.current;
      const remaining = Math.max(0, minDwell - elapsed);
      if (remaining > 0) {
        autoAdvanceTimer = window.setTimeout(finishReading, remaining);
      } else {
        finishReading();
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!isActive) return;

          const paragraph = entry.target as HTMLElement;
          const isSufficientlyVisible =
            document.visibilityState === 'visible'
            && entry.isIntersecting
            && hasSufficientExposureVisibility(
              entry.intersectionRect.height,
              entry.boundingClientRect.height,
              window.innerHeight,
            );

          if (!isSufficientlyVisible) {
            visibleParagraphs.delete(paragraph);
            clearExposureTimer(paragraph);
            return;
          }

          visibleParagraphs.add(paragraph);
          if (exposureTimers.has(paragraph)) return;

          const timerId = window.setTimeout(() => {
            exposureTimers.delete(paragraph);
            if (
              !isActive
              || document.visibilityState !== 'visible'
              || !visibleParagraphs.has(paragraph)
            ) return;

            const paragraphIndex = Number(paragraph.dataset.readingParagraph);
            const paragraphText = article.content[paragraphIndex] ?? paragraph.textContent ?? '';
            const learningUnits = extractLearningUnits(paragraphText, highlightTerms);
            const newWordIds = [...new Set(
              learningUnits.map((unit) => unit.wordId),
            )].filter((wordId) => !exposedLemmasRef.current.has(wordId));

            newWordIds.forEach((wordId) => exposedLemmasRef.current.add(wordId));
            completedParagraphs.add(paragraph);
            observer.unobserve(paragraph);
            visibleParagraphs.delete(paragraph);

            // Memory V2.2: 记录段落曝光
            if (learningUnits.length > 0) {
              recordParagraphExposure(paragraphIndex, learningUnits).catch(err =>
                console.error('Memory V2.2 exposure recording failed:', err)
              );
            }

            if (newWordIds.length > 0 && mode === 'single') {
              onExposuresRef.current?.(newWordIds);
            }
            if (
              paragraphs.length > 0
              && completedParagraphs.size === paragraphs.length
              && !hasAdvancedRef.current
            ) {
              scheduleFinishReading();
            }
          }, 800);

          exposureTimers.set(paragraph, timerId);
        });
      },
      { threshold: Array.from({ length: 101 }, (_, index) => index / 100) },
    );

    const paragraphs = Array.from(
      container.querySelectorAll<HTMLElement>('[data-reading-paragraph]')
    ) as HTMLElement[];
    paragraphs.forEach((paragraph) => observer.observe(paragraph));

    const pauseExposureTracking = () => {
      exposureTimers.forEach((timerId) => window.clearTimeout(timerId));
      exposureTimers.clear();
      visibleParagraphs.clear();
    };

    const handleVisibilityChange = () => {
      pauseExposureTracking();
      if (document.visibilityState !== 'visible') return;
      paragraphs.forEach((paragraph) => {
        if (completedParagraphs.has(paragraph)) return;
        observer.unobserve(paragraph);
        observer.observe(paragraph);
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isActive = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer.disconnect();
      pauseExposureTracking();
      clearAutoAdvanceTimer();
      completedParagraphs.clear();
    };
    // The exposure set intentionally resets only when the article lifecycle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id, mode]);

  const highlightTerms = [
    ...(article.keyWords || []),
    ...(article.embeddedReviewWords || []),
  ];

  const closeWordCard = useCallback(() => {
    wordCardAbortRef.current?.abort();
    wordCardAbortRef.current = null;
    setWordCardOpen(false);
    setIsExplaining(false);
    setGrammarResult(null);
  }, []);

  const openWordCard = useCallback(
    async (wordOrPhrase: string, contextSentence = '') => {
      const request = createWordCardRequest(wordOrPhrase, contextSentence);
      if (!request) return;

      wordCardAbortRef.current?.abort();
      const controller = new AbortController();
      wordCardAbortRef.current = controller;

      setSelectedText(request.selectedText);
      setSelectedContext(request.contextSentence);
      setWordCardOpen(true);
      setIsExplaining(true);
      setGrammarResult(null);
      onGrammarQuery?.(request.selectedText);

      try {
        const result = await fetchWordCard(request, {
          articleId: article.id,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setGrammarResult(result);
      } catch (error) {
        if (error instanceof Error && /cancelled|abort/i.test(error.message)) return;
        // fetchWordCard already falls back offline; keep panel open on unexpected errors.
      } finally {
        if (!controller.signal.aborted) {
          setIsExplaining(false);
        }
      }
    },
    [article.id, onGrammarQuery],
  );

  const handleWordClick = (
    word: string,
    paragraph: string,
    tokenIndex: number,
    e: React.MouseEvent,
  ) => {
    if (suppressNextWordClickRef.current) {
      suppressNextWordClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    const request = createWordCardRequest(word, paragraph);
    if (!request) return;
    const cleanWord = request.selectedText;

    onWordClick?.(cleanWord);

    // Memory V2.2: 记录单词点击
    const paragraphElement = (e.target as HTMLElement).closest('[data-reading-paragraph]');
    const learningUnit = findLearningUnitAtTokenIndex(
      paragraph,
      highlightTerms,
      tokenIndex,
    );
    if (paragraphElement && learningUnit) {
      const paragraphIndex = Number(paragraphElement.getAttribute('data-reading-paragraph'));

      recordWordClick(learningUnit, paragraphIndex).catch(err =>
        console.error('Memory V2.2 click recording failed:', err)
      );
    }

    void openWordCard(cleanWord, paragraph);
  };

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to execCommand
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const flashCopyHint = (label: string) => {
    setCopyHint(label);
    window.setTimeout(() => setCopyHint(null), 1600);
  };

  const getCaretRangeFromPoint = (x: number, y: number): Range | null => {
    const documentWithCaret = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
    };
    if (documentWithCaret.caretRangeFromPoint) {
      return documentWithCaret.caretRangeFromPoint(x, y);
    }
    const position = documentWithCaret.caretPositionFromPoint?.(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  };

  const isArticleSelection = (selection: Selection | null): selection is Selection => {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    if (!contentRef.current) return false;
    return contentRef.current.contains(selection.getRangeAt(0).commonAncestorContainer);
  };

  const quoteSelectedText = (text: string) => {
    setUserInput((currentInput) => formatSelectionQuote(text, currentInput));
    setShowChatPanel(true);
    setIsComposerExpanded(true);
    void copyTextToClipboard(text).then((ok) => {
      flashCopyHint(ok ? '已复制并引用到讨论框' : '复制失败，但已引用到讨论框');
    });
  };

  const handleArticleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    e.preventDefault();
    rightSelectionStartRef.current = { x: e.clientX, y: e.clientY };
  };

  /** Select article text with the left button or quote it with the right button. */
  const handleTextSelection = (e: React.MouseEvent) => {
    const button = e.button ?? e.nativeEvent.button;
    // Only left-button and right-button selections are meaningful here.
    if (button !== 0 && button !== 2) return;

    if (button === 2) {
      const start = rightSelectionStartRef.current;
      rightSelectionStartRef.current = null;
      if (!start) return;

      const end = { x: e.clientX, y: e.clientY };
      if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return;
      const startRange = getCaretRangeFromPoint(start.x, start.y);
      const endRange = getCaretRangeFromPoint(end.x, end.y);
      if (!startRange || !endRange || !contentRef.current) return;
      if (
        !contentRef.current.contains(startRange.commonAncestorContainer)
        || !contentRef.current.contains(endRange.commonAncestorContainer)
      ) return;

      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.setBaseAndExtent(
        startRange.startContainer,
        startRange.startOffset,
        endRange.startContainer,
        endRange.startOffset,
      );
      const text = selection.toString().trim();
      if (text.length < 2 || text.length > 4000) return;
      quoteSelectedText(text);
      return;
    }

    const selection = window.getSelection();
    if (!isArticleSelection(selection)) return;

    const text = selection.toString().trim();
    // Ignore pure click noise; require a real selection (phrase/sentence)
    if (text.length < 2 || text.length > 4000) return;

    void openWordCard(text, text);

    void copyTextToClipboard(text).then((ok) => {
      if (ok) flashCopyHint('已复制到剪贴板');
    });
  };

  const handleArticleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Right-drag is the article's quote gesture, so do not open the browser menu.
    e.preventDefault();
  };

  /** Look up a related word from the word-card panel (word-family chips). */
  const handleExplainWord = (word: string) => {
    void openWordCard(word, selectedContext || '');
  };

  const handleTranslate = async () => {
    const text = selectedText || grammarResult?.wordOrPhrase;
    if (!text) return;
    setIsTranslating(true);
    setTranslationResult(null);

    try {
      const response = await postTutor<TranslationResult>({
        intent: 'translate',
        articleId: article.id,
        selectedText: text,
        targetLanguage: 'Chinese',
      });
      setTranslationResult(response.result);
    } catch {
      setTranslationResult({
        originalText: text,
        translatedText: '当前为离线模式，请配置 API Key 后重试。',
        targetLanguage: 'Chinese',
      });
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSendQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userInput.trim() || isSending) return;

    const query = userInput.trim();
    const userMessage: ChatMessage = {
      id: `chat-${Date.now()}-user`,
      sender: 'user',
      text: query,
      timestamp: new Date().toISOString(),
    };
    setUserInput('');
    setShowChatPanel(true);
    const withUser = [...chatMessages, userMessage];
    setChatMessages(withUser);
    onChatMessagesChange?.(withUser);
    setIsSending(true);

    try {
      const response = await postTutor<StructuredAssessResult>({
        intent: 'discuss',
        articleId: article.id,
        message: query,
        articleContext: article.content.join('\n\n'),
        history: chatMessages.slice(-12),
      });
      const assessed = response.result;
      onDiscussionAssessed?.(query, assessed);

      // Socratic discussion: show tutor reply only — no error/score chrome
      const aiMessage: ChatMessage = {
        id: `chat-${Date.now()}-ai`,
        sender: 'ai',
        text: assessed.reply || '…',
        timestamp: new Date().toISOString(),
      };
      const withAi = [...withUser, aiMessage];
      setChatMessages(withAi);
      onChatMessagesChange?.(withAi);
    } catch {
      const assessed: StructuredAssessResult = {
        reply:
          '离线模式：先不看答案——用一句话概括作者最想说的一点。你觉得文中哪一句最能支撑你的概括？',
        errors: [],
        wordsUsedCorrectly: [],
        wordsUsedIncorrectly: [],
        weakPoints: [],
      };
      onDiscussionAssessed?.(query, assessed);
      const aiMessage: ChatMessage = {
        id: `chat-${Date.now()}-ai`,
        sender: 'ai',
        text: assessed.reply,
        timestamp: new Date().toISOString(),
      };
      const withAi = [...withUser, aiMessage];
      setChatMessages(withAi);
      onChatMessagesChange?.(withAi);
    } finally {
      setIsSending(false);
    }
  };

  const handleSpeakText = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  };

  const getFontSizeClass = () => {
    if (fontSize === 'large') return 'text-xl leading-relaxed';
    if (fontSize === 'xlarge') return 'text-2xl leading-loose';
    return 'text-lg leading-relaxed';
  };

  const shouldIgnoreSwipeTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]'));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      mode !== 'recommendation-feed'
      || !event.isPrimary
      || !['touch', 'pen'].includes(event.pointerType)
      || shouldIgnoreSwipeTarget(event.target)
    ) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    swipeStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (
      mode !== 'recommendation-feed'
      || !start
      || start.pointerId !== event.pointerId
      || hasAdvancedRef.current
    ) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    if (!isLeftSwipeGesture({
      startX: start.x,
      startY: start.y,
      endX: event.clientX,
      endY: event.clientY,
    })) return;

    hasAdvancedRef.current = true;
    suppressNextWordClickRef.current = true;
    window.setTimeout(() => {
      suppressNextWordClickRef.current = false;
    }, 0);
    onAdvanceRef.current?.(
      buildReadingAdvancePayload(article.id, 'skipped', exposedLemmasRef.current)
    );
  };

  const handlePointerCancel = () => {
    swipeStartRef.current = null;
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{ touchAction: mode === 'recommendation-feed' ? 'pan-y' : undefined }}
      className={`min-h-screen bg-[#F8F6F0] text-[#2B2723] flex flex-col justify-between relative selection:bg-[#FDE68A] transition-all duration-150 ease-out ${
        articleVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
      }`}
    >
      {showNavigationHint && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 rounded-full bg-[#2C2723]/90 px-4 py-2 text-xs font-medium text-white shadow-lg pointer-events-none">
          下滑阅读 · 左滑下一篇
        </div>
      )}

      <header className="sticky top-0 z-20 bg-[#F8F6F0]/90 backdrop-blur-md border-b border-[#E7E2D5] px-4 py-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="p-2 hover:bg-[#EFEAE0] rounded-xl text-[#524B43] transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="text-center min-w-0 flex-1 px-2">
          <h1 className="font-serif text-base sm:text-lg font-bold leading-tight text-[#2C2723] truncate max-w-[70vw] sm:max-w-md mx-auto">
            {article.title}
          </h1>
          {(article.levelRating || article.level || article.source) && (
            <p className="text-[10px] text-[#8C8478] mt-0.5">
              {/* One CEFR badge per article (levelRating is the official grade when present). */}
              {(article.levelRating?.level || article.level) && (
                <button
                  type="button"
                  onClick={() => setShowLevelDetail((v) => !v)}
                  className="hover:text-[#C35E37] underline-offset-2 hover:underline"
                  title="查看本篇唯一 CEFR 评级"
                >
                  CEFR {article.levelRating?.level || article.level}
                  {typeof article.levelRating?.difficultyScore === 'number' && (
                    <span> · 难度 {article.levelRating.difficultyScore}</span>
                  )}
                </button>
              )}
              {(article.levelRating?.level || article.level) && article.source && (
                <span> · </span>
              )}
              {article.source && <span>{article.source}</span>}
            </p>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-[#EFEAE0] rounded-xl text-[#524B43] transition-colors"
            title="Options"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-2 w-52 bg-[#FAF8F3] border border-[#E0D9CB] rounded-xl shadow-lg p-2 z-30 text-xs text-[#3D372E]">
              <div className="flex gap-1 p-1 mb-2 bg-[#EFECE3] rounded-lg">
                {(['normal', 'large', 'xlarge'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setFontSize(size)}
                    className={`flex-1 py-1 rounded text-center font-medium ${
                      fontSize === size
                        ? 'bg-white shadow-2xs text-[#2B2723]'
                        : 'text-[#6C655C]'
                    }`}
                  >
                    {size === 'normal' ? 'Aa' : size === 'large' ? 'Aa+' : 'Aa++'}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  setShowMenu(false);
                  handleSpeakText(article.content.join(' '));
                }}
                className="w-full text-left px-3 py-2 hover:bg-[#F0EBE0] rounded-lg flex items-center gap-2"
              >
                <Volume2 className="w-4 h-4 text-[#C35E37]" />
                <span>Listen to Full Article</span>
              </button>

              {article.paragraphTranslations && article.paragraphTranslations.length > 0 && (
                <button
                  onClick={() => {
                    setShowParagraphTranslations((v) => !v);
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-[#F0EBE0] rounded-lg flex items-center gap-2"
                >
                  <Globe className="w-4 h-4 text-[#2563EB]" />
                  <span>{showParagraphTranslations ? '隐藏段落实译' : '显示段落实译'}</span>
                </button>
              )}

              {onRewriteAtLevel && (
                <div className="mt-1 border-t border-[#E7E2D5] pt-1">
                  <button
                    type="button"
                    disabled={isRewriting}
                    onClick={() => setShowRewriteLevels((v) => !v)}
                    className="w-full px-3 py-2 hover:bg-[#F0EBE0] rounded-lg flex items-center justify-center disabled:opacity-50"
                    title={isRewriting ? '正在改写' : '按等级改写'}
                    aria-label={isRewriting ? '正在改写' : '按等级改写'}
                  >
                    <PenLine className="w-4 h-4 text-[#C35E37]" />
                  </button>
                  {showRewriteLevels && !isRewriting && (
                    <div className="px-2 pb-2 grid grid-cols-3 gap-1">
                      {REWRITE_CEFR_LEVELS.map((lv) => {
                        const current = (article.levelRating?.level || article.level || '').toUpperCase();
                        const isCurrent = current === lv;
                        const isPreferred =
                          Boolean(preferredCefrLevel)
                          && preferredCefrLevel.toUpperCase() === lv;
                        return (
                          <button
                            key={lv}
                            type="button"
                            onClick={() => {
                              setShowRewriteLevels(false);
                              setShowMenu(false);
                              onRewriteAtLevel(lv);
                            }}
                            className={`py-1.5 rounded-lg text-center text-[11px] font-semibold border transition-colors ${
                              isPreferred
                                ? 'border-[#C35E37] bg-[#C35E37] text-white'
                                : isCurrent
                                  ? 'border-[#C35E37] bg-[#C35E37]/10 text-[#C35E37]'
                                  : 'border-[#E0DBCF] bg-white hover:border-[#C35E37] text-[#3D372E]'
                            }`}
                            title={
                              isPreferred
                                ? `你的测试等级 ${lv}（推荐）`
                                : isCurrent
                                  ? `当前约 ${lv}，仍可生成新版本`
                                  : `生成 CEFR ${lv} 新版本`
                            }
                          >
                            {lv}
                            {isPreferred ? ' ·你' : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8 sm:py-12 pb-36">
        {(article.parentArticleId || article.source === 'level_rewrite') && (
          <div className="mb-4 p-3 bg-[#FDF2F8] border border-[#FBCFE8] rounded-xl text-xs text-[#9D174D] flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">
                改写版
                {(article.levelRating?.level || article.level || article.rewriteTargetLevel)
                  ? ` · CEFR ${article.levelRating?.level || article.level || article.rewriteTargetLevel}`
                  : ''}
              </p>
              <p className="mt-0.5 text-[#BE185D]">
                改写自「{article.parentArticleTitle || '原文'}」· 每篇仅一个评级
              </p>
            </div>
            {onOpenParentArticle && (
              <button
                type="button"
                onClick={onOpenParentArticle}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-white border border-[#F9A8D4] text-[#9D174D] font-medium hover:bg-[#FDF2F8]"
              >
                打开原文
              </button>
            )}
          </div>
        )}

        {article.embeddedReviewWords && article.embeddedReviewWords.length > 0 && (
          <div className="mb-4 p-3 bg-[#FEF3C7] border border-[#FDE68A] rounded-xl text-xs text-[#92400E]">
            <span className="font-semibold">语境复习词：</span>
            {article.embeddedReviewWords.join(' · ')}
          </div>
        )}

        {(importJob?.status === 'queued'
          || importJob?.status === 'processing'
          || article.importEnrichmentStatus === 'pending'
          || article.importEnrichmentStatus === 'processing'
          || (needsImportEnrichment(article) && article.importEnrichmentStatus !== 'failed')) && (
          <div className="mb-4 p-3 bg-[#E0F2FE] border border-[#BAE6FD] rounded-xl text-xs text-[#075985] space-y-1">
            <p className="font-semibold">导入模块处理中 · 可先阅读原文</p>
            <p>
              {importJob?.progress?.message
                || (importJob?.status === 'queued'
                  ? '已排队，等待后台逐段翻译与评级…'
                  : '后台逐段翻译与 CEFR 评级稍后完成，译文会自动出现。')}
            </p>
          </div>
        )}

        {(importJob?.status === 'failed' || article.importEnrichmentStatus === 'failed') && (
          <div className="mb-4 p-3 bg-[#FEE2E2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">导入模块失败</p>
              <p className="mt-0.5">
                {article.importEnrichmentError || importJob?.error || '翻译或评级未完成'}
              </p>
            </div>
            {onRetryImport && (
              <button
                type="button"
                onClick={onRetryImport}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-white border border-[#FECACA] text-[#991B1B] font-medium hover:bg-[#FEF2F2]"
              >
                重试
              </button>
            )}
          </div>
        )}

        {showLevelDetail && article.levelRating && (
          <div className="mb-4 p-3 bg-white border border-[#E0DBCF] rounded-xl text-xs text-[#3D372E] space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#2A2621]">
                AI 评级 · CEFR {article.levelRating.level}
                {typeof article.levelRating.difficultyScore === 'number' && (
                  <span className="font-normal text-[#8C8478]">
                    {' '}
                    · 难度 {article.levelRating.difficultyScore}/100
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setShowLevelDetail(false)}
                className="text-[#8C8478] hover:text-[#C35E37]"
              >
                收起
              </button>
            </div>
            <p className="leading-relaxed text-[#524B43]">{article.levelRating.summary}</p>
            {article.levelRating.vocabularyNotes && (
              <p className="text-[#6B645B]">
                <span className="font-medium text-[#3D372E]">词汇：</span>
                {article.levelRating.vocabularyNotes}
              </p>
            )}
            {article.levelRating.structureNotes && (
              <p className="text-[#6B645B]">
                <span className="font-medium text-[#3D372E]">结构：</span>
                {article.levelRating.structureNotes}
              </p>
            )}
          </div>
        )}

        {addedWordSuccess && (
          <div className="mb-6 p-3 bg-[#D2E7D6] text-[#27532F] rounded-xl text-sm font-medium flex items-center gap-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4" />
            <span>Added &quot;{addedWordSuccess}&quot; to review (L1 生词)</span>
          </div>
        )}
        <div
          ref={contentRef}
          onMouseDown={handleArticleMouseDown}
          onMouseUp={handleTextSelection}
          onContextMenu={handleArticleContextMenu}
          className={`font-serif text-[#2B2723] space-y-8 select-text ${getFontSizeClass()}`}
        >
          {article.content.map((paragraph, pIdx) => {
            const paragraphKind = classifyArticleParagraph(paragraph, article.title);
            if (paragraphKind === 'furniture') return null;

            const words = paragraph.trim().split(/\s+/);
            const highlightMatches = getPhraseHighlightMatches(words, highlightTerms);
            const zh = article.paragraphTranslations?.[pIdx];
            const wordSpans = words.map((word, wIdx) => {
              const matchedTerm = highlightMatches[wIdx];
              return (
                <React.Fragment key={wIdx}>
                  <span
                    onClick={(e) => handleWordClick(matchedTerm || word, paragraph, wIdx, e)}
                    className={
                      matchedTerm
                        ? 'bg-[#FEF08A] hover:bg-[#FDE047] text-[#1E1B18] px-1 py-0.5 rounded transition-all cursor-pointer inline-block font-medium border-b border-[#EAB308]'
                        : 'hover:bg-[#EFECE3] rounded px-0.5 transition-colors cursor-pointer'
                    }
                    title={matchedTerm ? `Review phrase: ${matchedTerm}` : 'Click to look up'}
                  >
                    {word}
                  </span>
                  {wIdx < words.length - 1 ? ' ' : null}
                </React.Fragment>
              );
            });

            const translationClassName =
              paragraphKind === 'title'
                ? 'font-sans text-sm sm:text-base leading-relaxed text-[#7B7267] pl-3 border-l border-[#D6CFC1]'
                : paragraphKind === 'author'
                  ? 'font-sans text-xs sm:text-sm leading-relaxed text-[#9A9185] pl-3'
                  : 'font-sans text-[0.85em] leading-relaxed text-[#6B645B] bg-[#F3F0E8] border border-[#E7E2D5] rounded-xl px-3 py-2.5';

            return (
              <div
                key={pIdx}
                className={
                  paragraphKind === 'title'
                    ? 'space-y-3 pt-2 pb-1'
                    : paragraphKind === 'author'
                      ? 'space-y-2 pt-1 pb-2'
                      : 'space-y-2'
                }
              >
                {paragraphKind === 'title' ? (
                  <h2
                    data-reading-paragraph={pIdx}
                    className="font-serif text-2xl sm:text-3xl font-bold leading-tight tracking-normal text-[#2A2621]"
                  >
                    {wordSpans}
                  </h2>
                ) : (
                  <p
                    data-reading-paragraph={pIdx}
                    className={
                      paragraphKind === 'author'
                        ? 'font-sans text-sm sm:text-base font-bold leading-relaxed tracking-normal text-[#6C655C] pl-3 border-l-2 border-[#C35E37]'
                        : 'tracking-normal'
                    }
                  >
                    {wordSpans}
                  </p>
                )}
                {showParagraphTranslations && zh && (
                  <p className={translationClassName}>
                    {zh}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {copyHint && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] px-3 py-1.5 rounded-full bg-[#2C2723]/90 text-white text-xs font-medium shadow-lg pointer-events-none">
          {copyHint}
        </div>
      )}

      <WordCardPanel
        open={wordCardOpen}
        loading={isExplaining}
        result={grammarResult}
        selectedText={selectedText}
        onClose={closeWordCard}
        onSpeak={handleSpeakText}
        onLookupRelated={handleExplainWord}
        onTranslate={() => {
          void handleTranslate();
        }}
        onCopy={() => {
          const text = selectedText || grammarResult?.wordOrPhrase || '';
          if (!text) return;
          void copyTextToClipboard(text).then((ok) => {
            flashCopyHint(ok ? '已复制到剪贴板' : '复制失败');
          });
        }}
      />

      {(isTranslating || translationResult) && createPortal(
        <div className="fixed inset-0 bg-black/30 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#FAF8F3] border border-[#E2DCD0] w-full max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl p-6 relative">
            <button
              onClick={() => {
                setTranslationResult(null);
                setIsTranslating(false);
              }}
              className="absolute top-4 right-4 p-2 text-[#777] hover:bg-[#EFEAE0] rounded-full"
            >
              <X className="w-5 h-5" />
            </button>

            {isTranslating ? (
              <div className="py-12 text-center space-y-4">
                <Globe className="w-8 h-8 text-[#2563EB] animate-spin mx-auto" />
                <p className="font-serif text-lg text-[#332E28]">Translating...</p>
              </div>
            ) : translationResult ? (
              <div className="space-y-4 text-left">
                <h3 className="font-serif text-xl font-semibold text-[#2A2621] border-b border-[#E8E2D5] pb-2">
                  Translation ({translationResult.targetLanguage})
                </h3>
                <div className="p-3 bg-[#EFECE3] rounded-xl text-sm text-[#443E36]">
                  <span className="block text-xs font-semibold text-[#8C8478] mb-1">Original:</span>
                  &quot;{translationResult.originalText}&quot;
                </div>
                <div className="p-3 bg-[#E6F4EA] border border-[#C6E7CE] rounded-xl text-sm text-[#1B4D24] font-medium">
                  <span className="block text-xs font-semibold text-[#2D6A3A] mb-1">Translation:</span>
                  {translationResult.translatedText}
                </div>
                {translationResult.culturalNote && (
                  <div className="p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl text-xs text-[#92400E]">
                    <span className="font-semibold">Note:</span> {translationResult.culturalNote}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      )}

      {showChatPanel && !isComposerExpanded && (
        <div className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-8 sm:w-96 bg-[#FAF8F3] border border-[#E0DBCF] rounded-2xl shadow-2xl p-4 z-40 max-h-96 flex flex-col">
          <div className="flex items-center justify-between border-b border-[#E8E2D5] pb-2 mb-3">
            <div className="min-w-0">
              <span className="font-serif font-semibold text-sm text-[#332E28] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#C35E37]" />
                讨论区 · 就文答疑
              </span>
              <p className="text-[10px] text-[#9A9286] mt-0.5 pl-5">
                苏格拉底式追问 · 解释难点 · 不评分
              </p>
            </div>
            <button
              onClick={() => setShowChatPanel(false)}
              className="p-1 hover:bg-[#EFEAE0] rounded-md text-[#666]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 p-1 text-xs">
            {chatMessages.map((msg, idx) => (
              <div
                key={msg.id ?? idx}
                className={`p-3 rounded-xl max-w-[85%] ${
                  msg.sender === 'user'
                    ? 'bg-[#C35E37] text-white ml-auto'
                    : 'bg-[#EFECE3] text-[#2C2722] mr-auto border border-[#E2DDD0]'
                }`}
              >
                {msg.text}
              </div>
            ))}
            {isSending && (
              <div className="p-3 bg-[#EFECE3] text-[#6C655C] rounded-xl mr-auto animate-pulse">
                Thinking...
              </div>
            )}
          </div>
        </div>
      )}

      {isComposerExpanded ? (
        <footer className="fixed right-4 top-1/2 z-40 w-[min(28rem,calc(100vw-2rem))] -translate-y-1/2 sm:right-8">
          <div className="flex max-h-[min(34rem,calc(100vh-2rem))] flex-col gap-1.5 overflow-hidden rounded-2xl border border-[#DDD6C8] bg-[#F8F6F0]/98 p-3 shadow-2xl backdrop-blur-md">
          <div className="min-h-0 max-h-56 w-full space-y-3 overflow-y-auto p-1 text-xs">
            {chatMessages.length === 0 && !isSending && (
              <p className="rounded-xl border border-dashed border-[#DDD6C8] bg-white/60 p-3 text-[#756D63]">
                Start with a question about a sentence, idea, or vocabulary in this article.
              </p>
            )}
            {chatMessages.map((msg, idx) => (
              <div
                key={msg.id ?? idx}
                className={`max-w-[85%] rounded-xl p-3 ${
                  msg.sender === 'user'
                    ? 'ml-auto bg-[#C35E37] text-white'
                    : 'mr-auto border border-[#E2DDD0] bg-[#EFECE3] text-[#2C2722]'
                }`}
              >
                {msg.text}
              </div>
            ))}
            {isSending && (
              <div className="mr-auto animate-pulse rounded-xl bg-[#EFECE3] p-3 text-[#6C655C]">
                Thinking...
              </div>
            )}
          </div>
          <form
            onSubmit={handleSendQuestion}
            className="flex w-full shrink-0 items-center rounded-full border border-[#DDD6C8] bg-white px-3 py-2 shadow-2xs transition-all focus-within:border-[#C35E37]"
            aria-label="Article discussion"
          >
            <input
              type="text"
              ref={composerInputRef}
              id="reading-composer-input"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsComposerExpanded(false);
                  setShowChatPanel(false);
                }
              }}
              placeholder="问大意、难句，或谈谈你的观点…"
              aria-label="Ask about this article"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#2B2723] placeholder-[#9A9185] outline-none"
            />
            <button
              type="submit"
              disabled={!userInput.trim() || isSending}
              className="ml-2 shrink-0 rounded-full bg-[#C35E37] p-1.5 text-white transition-colors hover:bg-[#A94E2B] disabled:opacity-40"
              aria-label="Send question"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setIsComposerExpanded(false);
              setShowChatPanel(false);
            }}
            className="shrink-0 self-end rounded-full p-2.5 text-[#5B544B] transition-colors hover:bg-[#EFEAE0]"
            aria-label="Collapse article discussion input"
            title="Collapse input"
          >
            <X className="h-5 w-5" />
          </button>

        </div>
      </footer>
      ) : (
        createPortal(
          <button
            type="button"
            onClick={() => setIsComposerExpanded(true)}
            className="fixed right-4 top-1/2 z-40 -translate-y-1/2 rounded-full border border-[#D8D1C3] bg-[#FAF8F3] p-4 text-[#C35E37] shadow-xl transition-all hover:scale-105 hover:bg-white hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-[#C35E37] focus:ring-offset-2 sm:right-8"
            aria-label="Open article discussion input"
            aria-expanded={false}
            aria-controls="reading-composer-input"
            title="Ask about this article"
          >
            <MessageCircle className="h-6 w-6" />
          </button>,
          document.body,
        )
      )}
    </div>
  );
};


