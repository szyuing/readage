import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  MoreHorizontal,
  BookOpen,
  Globe,
  Mic,
  Send,
  Sparkles,
  CheckCircle2,
  BookmarkPlus,
  X,
  Volume2,
  Copy,
} from 'lucide-react';
import {
  Article,
  GrammarExplanation,
  TranslationResult,
  ReviewWord,
  StructuredAssessResult,
  ChatMessage,
} from '../types';

import { getNewLemmas, hasSufficientExposureVisibility } from '../lib/readingExposure';
import { getPhraseHighlightMatches } from '../lib/textHighlight';
import { postTutor } from '../lib/tutorClient';
import type { ImportJob } from '../lib/articleImport';
import { needsImportEnrichment } from '../lib/articleImport';

interface ReadingScreenProps {
  article: Article;
  /** Live job from the independent import module (translate + rate). */
  importJob?: ImportJob | null;
  onRetryImport?: () => void;
  onBack: () => void;
  onAddReviewWord: (word: Partial<ReviewWord>) => void;
  onWordClick?: (word: string) => void;
  onGrammarQuery?: (wordOrPhrase: string) => void;
  onExposures?: (words: string[]) => void;
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
  onBack,
  onAddReviewWord,
  onWordClick,
  onGrammarQuery,
  onExposures,
  onDiscussionAssessed,
  initialChatMessages = [],
  trackedLemmas = [],
  onChatMessagesChange,
}) => {
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectedContext, setSelectedContext] = useState<string>('');
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);

  const [isExplaining, setIsExplaining] = useState(false);
  const [grammarResult, setGrammarResult] = useState<GrammarExplanation | null>(null);

  const [isTranslating, setIsTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);

  const [addedWordSuccess, setAddedWordSuccess] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const [userInput, setUserInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [showChatPanel, setShowChatPanel] = useState(initialChatMessages.length > 0);

  // Restore chat when switching articles / session
  useEffect(() => {
    setChatMessages(initialChatMessages);
    setShowChatPanel(initialChatMessages.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id]);

  const [showMenu, setShowMenu] = useState(false);
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('normal');
  /** Show Chinese paragraph translations produced on import. */
  const [showParagraphTranslations, setShowParagraphTranslations] = useState(true);
  const [showLevelDetail, setShowLevelDetail] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const exposedLemmasRef = useRef<Set<string>>(new Set());
  const onExposuresRef = useRef(onExposures);

  useEffect(() => {
    onExposuresRef.current = onExposures;
  }, [onExposures]);

  // A paragraph counts as read only after it stays at least 60% visible for 800ms.
  useEffect(() => {
    const container = contentRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return;

    let isActive = true;
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
            const newLemmas = getNewLemmas(
              paragraphText,
              exposedLemmasRef.current,
            );

            newLemmas.forEach((lemma) => exposedLemmasRef.current.add(lemma));
            completedParagraphs.add(paragraph);
            observer.unobserve(paragraph);
            visibleParagraphs.delete(paragraph);

            if (newLemmas.length > 0) {
              onExposuresRef.current?.(newLemmas);
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
      completedParagraphs.clear();
    };
    // The exposure set intentionally resets only when the article lifecycle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id]);

  const highlightTerms = [
    ...(article.keyWords || []),
    ...(article.embeddedReviewWords || []),
  ];

  const handleWordClick = (word: string, paragraph: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanWord = word.replace(/[^a-zA-Z\s']/g, '').trim();
    if (!cleanWord) return;

    onWordClick?.(cleanWord);

    const rect = e.currentTarget.getBoundingClientRect();
    setSelectedText(cleanWord);
    setSelectedContext(paragraph);
    setPopoverPos({
      x: Math.min(rect.left + rect.width / 2, window.innerWidth - 160),
      y: rect.top - 55,
    });
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

  /** Left-button drag select → show actions + auto-copy selection to clipboard. */
  const handleTextSelection = (e: React.MouseEvent) => {
    // Only left button (0); ignore right/middle
    if (e.button !== 0 && e.nativeEvent.button !== 0) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    // Prefer selection that intersects the article body
    if (contentRef.current && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!contentRef.current.contains(range.commonAncestorContainer)) return;
    }

    const text = selection.toString().trim();
    // Ignore pure click noise; require a real selection (phrase/sentence)
    if (text.length < 2 || text.length > 4000) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setSelectedText(text);
    setSelectedContext(text);
    setPopoverPos({
      x: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 160),
      y: Math.max(rect.top - 55, 8),
    });

    void copyTextToClipboard(text).then((ok) => {
      if (ok) flashCopyHint('已复制到剪贴板');
    });
  };

  const handleExplainGrammar = async () => {
    if (!selectedText) return;
    setPopoverPos(null);
    setIsExplaining(true);
    setGrammarResult(null);
    onGrammarQuery?.(selectedText);

    try {
      const response = await postTutor<GrammarExplanation>({
        intent: 'explain',
        articleId: article.id,
        selectedText,
        contextSentence: selectedContext,
      });
      setGrammarResult(response.result);
    } catch {
      setGrammarResult({
        wordOrPhrase: selectedText,
        type: 'Vocabulary',
        phonetic: '',
        definition: `Context meaning of "${selectedText}" in the current article (offline fallback).`,
        definitionChinese: '当前为离线释义，请结合上下文理解。',
        chineseTranslation: selectedText,
        grammarRules: [
          'Look at the surrounding words to infer part of speech.',
          'Try reusing this word in the discussion box below.',
        ],
        exampleSentences: [selectedContext || `I learned the word "${selectedText}" today.`],
      });
    } finally {
      setIsExplaining(false);
    }
  };

  const handleTranslate = async () => {
    if (!selectedText) return;
    setPopoverPos(null);
    setIsTranslating(true);
    setTranslationResult(null);

    try {
      const response = await postTutor<TranslationResult>({
        intent: 'translate',
        articleId: article.id,
        selectedText,
        targetLanguage: 'Chinese',
      });
      setTranslationResult(response.result);
    } catch {
      setTranslationResult({
        originalText: selectedText,
        translatedText: '当前为离线模式，请配置 API Key 后重试。',
        targetLanguage: 'Chinese',
      });
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSaveToReview = (
    word: string,
    def: string,
    ex: string,
    phonetic?: string,
    partOfSpeech?: string,
    definitionChinese?: string,
    chineseTranslation?: string
  ) => {
    onAddReviewWord({
      word,
      definition: def,
      exampleSentence: ex,
      phonetic: phonetic || '',
      partOfSpeech: partOfSpeech || '',
      definitionChinese: definitionChinese || '',
      chineseTranslation: chineseTranslation || '',
      mastered: false,
    });
    setAddedWordSuccess(word);
    setTimeout(() => setAddedWordSuccess(null), 3000);
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

  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#2B2723] flex flex-col justify-between relative selection:bg-[#FDE68A]">
      <header className="sticky top-0 z-20 bg-[#F8F6F0]/90 backdrop-blur-md border-b border-[#E7E2D5] px-4 py-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="p-2 hover:bg-[#EFEAE0] rounded-xl text-[#524B43] transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="text-center min-w-0 px-2">
          <h1 className="font-serif text-lg sm:text-xl font-normal text-[#2C2723] truncate max-w-xs sm:max-w-md">
            {article.title}
          </h1>
          {(article.level || article.levelRating || article.source) && (
            <p className="text-[10px] text-[#8C8478] mt-0.5">
              {(article.levelRating?.level || article.level) && (
                <button
                  type="button"
                  onClick={() => setShowLevelDetail((v) => !v)}
                  className="hover:text-[#C35E37] underline-offset-2 hover:underline"
                  title="查看评级说明"
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
              <div className="px-3 py-1.5 font-semibold text-[#8C8479] uppercase tracking-wider">
                Font Size
              </div>
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
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8 sm:py-12 pb-36">
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
          onMouseUp={handleTextSelection}
          className={`font-serif text-[#2B2723] space-y-6 select-text ${getFontSizeClass()}`}
        >
          {article.content.map((paragraph, pIdx) => {
            const words = paragraph.trim().split(/\s+/);
            const highlightMatches = getPhraseHighlightMatches(words, highlightTerms);
            const zh = article.paragraphTranslations?.[pIdx];
            return (
              <div key={pIdx} className="space-y-2">
                <p data-reading-paragraph={pIdx} className="tracking-wide">
                  {words.map((word, wIdx) => {
                    const matchedTerm = highlightMatches[wIdx];
                    return (
                      <React.Fragment key={wIdx}>
                        <span
                          onClick={(e) => handleWordClick(matchedTerm || word, paragraph, e)}
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
                  })}
                </p>
                {showParagraphTranslations && zh && (
                  <p className="font-sans text-[0.85em] leading-relaxed text-[#6B645B] bg-[#F3F0E8] border border-[#E7E2D5] rounded-xl px-3 py-2.5">
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

      {popoverPos && selectedText && (
        <div
          style={{
            position: 'fixed',
            left: `${popoverPos.x}px`,
            top: `${popoverPos.y}px`,
            transform: 'translateX(-50%)',
          }}
          className="z-50 bg-white/95 backdrop-blur-md border border-[#E0DBCF] shadow-lg rounded-xl p-1.5 flex items-center gap-1 text-xs font-sans"
        >
          <button
            onClick={handleExplainGrammar}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#F5F2EA] text-[#332E27] font-medium rounded-lg transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#C35E37]" />
            <span>Explain</span>
          </button>
          <div className="w-[1px] h-4 bg-[#E5DFD3]" />
          <button
            onClick={handleTranslate}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#F5F2EA] text-[#332E27] font-medium rounded-lg transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>Translate</span>
          </button>
          <div className="w-[1px] h-4 bg-[#E5DFD3]" />
          <button
            type="button"
            onClick={() => {
              void copyTextToClipboard(selectedText).then((ok) => {
                flashCopyHint(ok ? '已复制到剪贴板' : '复制失败');
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#F5F2EA] text-[#332E27] font-medium rounded-lg transition-colors"
            title="Copy selection"
          >
            <Copy className="w-3.5 h-3.5 text-[#5B544C]" />
            <span>Copy</span>
          </button>
          <button
            onClick={() => setPopoverPos(null)}
            className="p-1 hover:bg-[#F5F2EA] rounded-md text-[#888]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {(isExplaining || grammarResult) && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#FAF8F3] border border-[#E2DCD0] w-full max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl p-6 relative max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => {
                setGrammarResult(null);
                setIsExplaining(false);
              }}
              className="absolute top-4 right-4 p-2 text-[#777] hover:bg-[#EFEAE0] rounded-full"
            >
              <X className="w-5 h-5" />
            </button>

            {isExplaining ? (
              <div className="py-12 text-center space-y-4">
                <Sparkles className="w-8 h-8 text-[#C35E37] animate-spin mx-auto" />
                <p className="font-serif text-lg text-[#332E28]">Analyzing with English AI...</p>
              </div>
            ) : grammarResult ? (
              <div className="space-y-4 text-left">
                <div className="flex items-start justify-between border-b border-[#E8E2D5] pb-3">
                  <div>
                    <h3 className="font-serif text-3xl font-bold text-[#2A2621]">
                      {grammarResult.wordOrPhrase}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5">
                      {grammarResult.phonetic && (
                        <span className="text-xs font-mono text-[#78716C] bg-[#EFECE3] px-2 py-0.5 rounded border border-[#E0DBCF]">
                          {grammarResult.phonetic}
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 bg-[#FDF2EE] text-[#C35E37] border border-[#FADCD1] rounded-md text-xs font-medium">
                        {grammarResult.type}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSpeakText(grammarResult.wordOrPhrase)}
                    className="p-2.5 bg-[#EFEAE0] hover:bg-[#E3DCCF] rounded-full text-[#332E28] transition-colors"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>

                {grammarResult.chineseTranslation && (
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#9C9388] block">
                      单词汉译
                    </span>
                    <p className="text-sm font-semibold text-[#92400E] bg-[#FEF3C7] px-3 py-1.5 rounded-lg border border-[#FDE68A] mt-1 inline-block">
                      {grammarResult.chineseTranslation}
                    </p>
                  </div>
                )}

                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#9C9388] block mb-1">
                    English definition
                  </span>
                  <div className="p-3 bg-[#F5F2EA] rounded-xl border border-[#E7E1D4] space-y-1.5">
                    <p className="text-sm text-[#2E2A25] font-medium leading-relaxed">
                      {grammarResult.definition}
                    </p>
                    {grammarResult.definitionChinese && (
                      <p className="text-xs text-[#065F46] font-medium bg-[#ECFDF5] px-2 py-1 rounded border border-[#A7F3D0]">
                        {'释义汉译：'}
                        {grammarResult.definitionChinese}
                      </p>
                    )}
                  </div>
                </div>

                {grammarResult.grammarRules?.length > 0 && (
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#9C9388] block mb-1">
                      语法与搭配
                    </span>
                    <ul className="list-disc list-inside text-xs text-[#38332D] space-y-1 bg-white p-3 rounded-xl border border-[#E5DFD1]">
                      {grammarResult.grammarRules.map((rule, idx) => (
                        <li key={idx}>{rule}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {grammarResult.exampleSentences?.length > 0 && (
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#9C9388] block mb-1">
                      语境例句
                    </span>
                    <div className="space-y-1.5">
                      {grammarResult.exampleSentences.map((ex, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 bg-[#F2ECE0] rounded-lg text-xs text-[#2B2722] italic border border-[#E5DEC3]"
                        >
                          &quot;{ex}&quot;
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    handleSaveToReview(
                      grammarResult.wordOrPhrase,
                      grammarResult.definition,
                      grammarResult.exampleSentences?.[0] || '',
                      grammarResult.phonetic,
                      grammarResult.type,
                      grammarResult.definitionChinese,
                      grammarResult.chineseTranslation
                    );
                    setGrammarResult(null);
                  }}
                  className="w-full mt-2 py-3 bg-[#C35E37] hover:bg-[#A94E2B] text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 shadow-xs transition-colors"
                >
                  <BookmarkPlus className="w-4 h-4" />
                  <span>Add to Review Words</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {(isTranslating || translationResult) && (
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
        </div>
      )}

      {showChatPanel && (
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
                key={idx}
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

      <footer className="fixed bottom-0 left-0 right-0 bg-[#F8F6F0]/95 backdrop-blur-md border-t border-[#E8E3D8] px-4 py-3 z-30">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // Discussion stays text/Socratic; real voice lives in Oral Practice (StepAudio)
              setShowChatPanel(true);
              setUserInput((prev) =>
                prev.trim()
                  ? prev
                  : ''
              );
              // Soft hint in chat instead of alert
              setChatMessages((prev) => {
                if (prev.some((m) => m.id === 'hint-voice-oral')) return prev;
                return [
                  ...prev,
                  {
                    id: 'hint-voice-oral',
                    sender: 'ai',
                    text: '语音陪练请回首页打开「纯口语陪练」→「实时语音（StepAudio）」。讨论区用于就文答疑（文字）。',
                    timestamp: new Date().toISOString(),
                  },
                ];
              });
            }}
            className="p-2.5 hover:bg-[#EFEAE0] rounded-full text-[#5B544B] transition-colors"
            title="Voice: use Oral Practice · StepAudio"
          >
            <Mic className="w-5 h-5" />
          </button>

          <form
            onSubmit={handleSendQuestion}
            className="flex-1 flex items-center bg-white border border-[#DDD6C8] rounded-full px-4 py-2 shadow-2xs focus-within:border-[#C35E37] transition-all"
          >
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="问大意、难句，或谈谈你的观点…"
              className="flex-1 bg-transparent text-sm text-[#2B2723] placeholder-[#9A9185] outline-none"
            />
            <button
              type="submit"
              disabled={!userInput.trim() || isSending}
              className="p-1.5 bg-[#C35E37] hover:bg-[#A94E2B] disabled:opacity-40 text-white rounded-full transition-colors ml-2"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

        </div>
      </footer>
    </div>
  );
};


