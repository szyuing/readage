import React from 'react';
import { createPortal } from 'react-dom';
import { Copy, Globe, Sparkles, Volume2, X } from 'lucide-react';
import type { GrammarExplanation } from '../types';

export interface WordCardPanelProps {
  open: boolean;
  loading: boolean;
  result: GrammarExplanation | null;
  /** Selected lookup text (for translate/copy actions while loading or after). */
  selectedText?: string;
  onClose: () => void;
  onSpeak: (text: string) => void;
  onLookupRelated: (word: string) => void;
  onTranslate?: () => void;
  onCopy?: () => void;
}

/**
 * Independent word-card drawer: dictionary-first explain results (and AI fallback).
 * Portaled to document.body so the translated reading root cannot clip it.
 */
export const WordCardPanel: React.FC<WordCardPanelProps> = ({
  open,
  loading,
  result,
  selectedText,
  onClose,
  onSpeak,
  onLookupRelated,
  onTranslate,
  onCopy,
}) => {
  if (!open) return null;

  const title = result?.wordOrPhrase || selectedText || 'Word card';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Word card"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[#E2DCD0] bg-[#FAF8F3] p-6 shadow-xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-[#777] hover:bg-[#EFEAE0]"
          aria-label="Close word card"
        >
          <X className="h-5 w-5" />
        </button>

        {loading ? (
          <div className="space-y-4 py-12 text-center">
            <Sparkles className="mx-auto h-8 w-8 animate-spin text-[#C35E37]" />
            <p className="font-serif text-lg text-[#332E28]">Looking up…</p>
            <p className="text-xs text-[#8C8478]">
              Single words use the local dictionary first; phrases use AI.
            </p>
          </div>
        ) : result ? (
          <div className="space-y-4 text-left">
            <div className="flex items-start justify-between gap-3 border-b border-[#E8E2D5] pb-3 pr-12">
              <div>
                <h3 className="font-serif text-3xl font-bold text-[#2A2621]">
                  {result.wordOrPhrase}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {result.phonetic && (
                    <span className="rounded border border-[#E0DBCF] bg-[#EFECE3] px-2 py-0.5 font-mono text-xs text-[#78716C]">
                      {result.phonetic}
                    </span>
                  )}
                  <span className="rounded-md border border-[#FADCD1] bg-[#FDF2EE] px-2.5 py-0.5 text-xs font-medium text-[#C35E37]">
                    {result.type}
                  </span>
                  {result.cefrLevel && (
                    <span className="rounded-md border border-[#BFDBFE] bg-[#EEF4FF] px-2 py-0.5 text-xs font-semibold text-[#1D4ED8]">
                      {result.cefrLevel}
                    </span>
                  )}
                  {result.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-[#E0DACE] bg-[#F3F0EA] px-2 py-0.5 text-[11px] font-medium text-[#6B6355]"
                    >
                      {tag}
                    </span>
                  ))}
                  {result.source === 'dictionary' && (
                    <span className="rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-medium text-[#047857]">
                      本地词典
                    </span>
                  )}
                  {result.source === 'ai' && (
                    <span className="rounded-md border border-[#E9D5FF] bg-[#FAF5FF] px-2 py-0.5 text-[11px] font-medium text-[#7C3AED]">
                      AI 释义
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSpeak(result.wordOrPhrase)}
                className="shrink-0 rounded-full bg-[#EFEAE0] p-2.5 text-[#332E28] transition-colors hover:bg-[#E3DCCF]"
                aria-label="Speak word"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>

            {(onTranslate || onCopy) && (
              <div className="flex flex-wrap gap-2">
                {onTranslate && (
                  <button
                    type="button"
                    onClick={onTranslate}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs font-medium text-[#332E27] transition-colors hover:bg-[#F5F2EA]"
                  >
                    <Globe className="h-3.5 w-3.5 text-[#2563EB]" />
                    Translate
                  </button>
                )}
                {onCopy && (
                  <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs font-medium text-[#332E27] transition-colors hover:bg-[#F5F2EA]"
                  >
                    <Copy className="h-3.5 w-3.5 text-[#5B544C]" />
                    Copy
                  </button>
                )}
              </div>
            )}

            {result.chineseTranslation && (
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                  单词汉译
                </span>
                <p className="mt-1 inline-block rounded-lg border border-[#FDE68A] bg-[#FEF3C7] px-3 py-1.5 text-sm font-semibold text-[#92400E]">
                  {result.chineseTranslation}
                </p>
              </div>
            )}

            {result.definitionChinese && !result.chineseTranslation && (
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                  中文释义
                </span>
                <p className="text-sm leading-relaxed text-[#3F3A34]">{result.definitionChinese}</p>
              </div>
            )}

            <div>
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                English definition
              </span>
              <div className="space-y-1.5 rounded-xl border border-[#E7E1D4] bg-[#F5F2EA] p-3">
                {result.senses?.length ? (
                  <ol className="space-y-2">
                    {result.senses.map((sense, idx) => (
                      <li key={idx} className="text-sm leading-relaxed">
                        <span className="mr-1.5 font-semibold text-[#7A7166]">
                          {idx + 1}.{sense.partOfSpeech ? ` ${sense.partOfSpeech}` : ''}
                        </span>
                        <span className="font-medium text-[#2E2A25]">{sense.definition}</span>
                        {sense.definitionZh && (
                          <span className="mt-0.5 block text-xs text-[#065F46]">
                            {sense.definitionZh}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm font-medium leading-relaxed text-[#2E2A25]">
                    {result.definition}
                  </p>
                )}
              </div>
            </div>

            {result.grammarRules?.length > 0 && (
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                  语法与搭配
                </span>
                <ul className="list-inside list-disc space-y-1 rounded-xl border border-[#E5DFD1] bg-white p-3 text-xs text-[#38332D]">
                  {result.grammarRules.map((rule, idx) => (
                    <li key={idx}>{rule}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.exchanges && result.exchanges.length > 0 && (
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                  词形变化
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {result.exchanges.map((exchange, idx) => (
                    <span
                      key={idx}
                      className="rounded-lg border border-[#E5DFD1] bg-white px-2 py-1 text-xs text-[#4A443B]"
                    >
                      <span className="text-[#9C9388]">{exchange.label}</span> {exchange.value}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.collocations && result.collocations.length > 0 && (
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                  常见搭配
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {result.collocations.map((collocation, idx) => (
                    <span
                      key={idx}
                      className="rounded-lg border border-[#F3E3C3] bg-[#FDF6EC] px-2 py-1 text-xs text-[#7C4A03]"
                    >
                      {collocation.en}
                      {collocation.zh ? ` ${collocation.zh}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.relatedWords && result.relatedWords.length > 0 && (
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                  同族词
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {result.relatedWords.map((related) => (
                    <button
                      key={related}
                      type="button"
                      onClick={() => onLookupRelated(related)}
                      className="rounded-lg border border-[#C7D2FE] bg-[#EEF2FF] px-2 py-1 text-xs text-[#3730A3] transition-colors hover:bg-[#E0E7FF]"
                    >
                      {related}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {result.exampleSentences?.length > 0 && (
              <div>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9C9388]">
                  Examples
                </span>
                <ul className="space-y-1.5 rounded-xl border border-[#E5DFD1] bg-white p-3 text-xs leading-relaxed text-[#3F3A34]">
                  {result.exampleSentences.map((sentence, idx) => (
                    <li key={idx} className="italic">
                      “{sentence}”
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-[#8C8478]">
            No definition for {title}.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
