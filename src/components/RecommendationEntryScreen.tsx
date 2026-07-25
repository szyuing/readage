import React from 'react';
import { ClipboardCheck, Library, RefreshCw, Sparkles } from 'lucide-react';
import { AppPageHeader } from './AppPageHeader';

interface RecommendationEntryScreenProps {
  isLoading: boolean;
  phase: 'local' | 'ai' | null;
  feedEnded: boolean;
  onStartRecommendation: () => void;
  onOpenLibrary: () => void;
  onStartAssessment: () => void;
  onBack: () => void;
  navigation: React.ReactNode;
}

export const RecommendationEntryScreen: React.FC<RecommendationEntryScreenProps> = ({
  isLoading,
  phase,
  feedEnded,
  onStartRecommendation,
  onOpenLibrary,
  onStartAssessment,
  onBack,
  navigation,
}) => {
  const message = isLoading
    ? phase === 'ai'
      ? 'Generating a personalized article...'
      : 'Finding a good next article for you...'
    : feedEnded
      ? 'No unread recommendation is available right now.'
      : 'Your next reading session starts here.';

  return (
    <>
      <AppPageHeader onBack={onBack} navigation={navigation} />
      <main className="min-h-[70vh] bg-[#F8F6F0] px-4 py-12 text-[#2B2723] sm:px-6">
      <div className="mx-auto flex min-h-[58vh] w-full max-w-2xl items-center justify-center">
        <section
          className="w-full border border-[#E3DDD1] bg-[#FAF8F3] px-6 py-10 text-center shadow-sm sm:px-10"
          aria-busy={isLoading}
          aria-live="polite"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#F3E4DA] text-[#C35E37]">
            <Sparkles className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-5 font-serif text-3xl font-normal text-[#2A2622] sm:text-4xl">
            Recommended Reading
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#777066]">
            {message}
          </p>

          {!isLoading && (
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={onStartRecommendation}
                className="inline-flex items-center gap-2 rounded-xl bg-[#C35E37] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#A94E2B]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Start recommendation
              </button>
              <button
                type="button"
                onClick={onOpenLibrary}
                className="inline-flex items-center gap-2 rounded-xl border border-[#DCD5C7] bg-white px-4 py-2.5 text-sm font-medium text-[#332E28] transition-colors hover:bg-[#F2ECE0]"
              >
                <Library className="h-4 w-4" aria-hidden="true" />
                Browse library
              </button>
              <button
                type="button"
                onClick={onStartAssessment}
                className="inline-flex items-center gap-2 rounded-xl border border-[#DCD5C7] bg-white px-4 py-2.5 text-sm font-medium text-[#332E28] transition-colors hover:bg-[#F2ECE0]"
              >
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                Check reading level
              </button>
            </div>
          )}
        </section>
      </div>
      </main>
    </>
  );
};
