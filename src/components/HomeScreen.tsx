import React from 'react';
import { FileText, BookOpen, Star, BarChart3, Clock, ClipboardCheck } from 'lucide-react';
import { Article } from '../types';

interface HomeScreenProps {
  onEnterArticle: () => void;
  onPickFromLibrary: () => void;
  onRecommendForMe: () => void;
  onGoToLearning: () => void;
  onStartTargetedReview: () => void;
  onStartEnglishTest: () => void;
  pendingReviewCount: number;
  assessedBand?: string | null;
  hasAssessment?: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onEnterArticle,
  onPickFromLibrary,
  onRecommendForMe,
  onGoToLearning,
  onStartTargetedReview,
  onStartEnglishTest,
  pendingReviewCount,
  assessedBand,
  hasAssessment = false,
}) => {
  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#2B2723] flex flex-col justify-between relative selection:bg-[#FDE68A]">
      {/* Top Banner Bar */}
      <div className="w-full text-center py-3 px-4 bg-[#F1ECE1] border-b border-[#E5DFD1] text-sm text-[#5C554D] font-medium flex flex-wrap justify-center items-center gap-x-3 gap-y-1">
        {hasAssessment && assessedBand ? (
          <span>
            阅读等级 <strong className="text-[#C35E37]">{assessedBand}</strong>
            <button
              type="button"
              onClick={onStartEnglishTest}
              className="ml-2 text-xs font-semibold text-[#C35E37] underline hover:text-[#A44B29] transition-colors"
            >
              重测
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onStartEnglishTest}
            className="text-xs font-semibold text-[#C35E37] underline hover:text-[#A44B29] transition-colors"
          >
            先测一次阅读等级，推荐会更准
          </button>
        )}
        <span className="hidden sm:inline text-[#D1C9B8]">·</span>
        <span>{pendingReviewCount} words ready for review</span>
        <button
          type="button"
          onClick={onStartTargetedReview}
          className="text-xs font-semibold text-[#C35E37] underline hover:text-[#A44B29] transition-colors"
        >
          Review Now
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <div className="w-full max-w-xl bg-[#FAF8F3] border border-[#E3DDD1] rounded-2xl p-8 sm:p-12 shadow-sm text-center">
          <h1 className="font-serif text-4xl sm:text-5xl font-normal text-[#2A2622] mb-2 tracking-tight">
            English AI
          </h1>
          <p className="text-sm text-[#8C8478] mb-8">P1 文章获取 · 以文章为核心开始学习</p>

          {/* 4 Action Buttons Grid — product doc §4.1 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={onEnterArticle}
              className="flex flex-col items-center justify-center gap-1 px-5 py-4 bg-[#FAF8F3] hover:bg-[#F2ECE0] text-[#332E28] border border-[#DCD5C7] rounded-xl text-base font-medium transition-all shadow-2xs"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#5C544B]" />
                <span>Enter Article</span>
              </span>
              <span className="text-[11px] font-normal text-[#8C8478]">输入 / 粘贴文章</span>
            </button>

            <button
              onClick={onPickFromLibrary}
              className="flex flex-col items-center justify-center gap-1 px-5 py-4 bg-[#FAF8F3] hover:bg-[#F2ECE0] text-[#332E28] border border-[#DCD5C7] rounded-xl text-base font-medium transition-all shadow-2xs"
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#5C544B]" />
                <span>Pick from Library</span>
              </span>
              <span className="text-[11px] font-normal text-[#8C8478]">从文章库选</span>
            </button>

            <button
              onClick={onRecommendForMe}
              className="flex flex-col items-center justify-center gap-1 px-5 py-4 bg-[#C35E37] hover:bg-[#A94E2B] text-white border border-[#C35E37] rounded-xl text-base font-medium transition-all shadow-xs"
            >
              <span className="flex items-center gap-2">
                <Star className="w-5 h-5 text-white" />
                <span>Recommend for Me</span>
              </span>
              <span className="text-[11px] font-normal text-white/80">
                {hasAssessment && assessedBand
                  ? `按你的 ${assessedBand} 推荐`
                  : 'AI 为我推荐'}
              </span>
            </button>

            <button
              onClick={onStartEnglishTest}
              className="flex flex-col items-center justify-center gap-1 px-5 py-4 bg-[#FAF8F3] hover:bg-[#F2ECE0] text-[#332E28] border border-[#DCD5C7] rounded-xl text-base font-medium transition-all shadow-2xs sm:col-span-2"
            >
              <span className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-[#C35E37]" />
                <span>英语测试</span>
              </span>
              <span className="text-[11px] font-normal text-[#8C8478]">
                {hasAssessment && assessedBand
                  ? `已定级 ${assessedBand} · 可重测校准`
                  : 'CEFR 阅读定级 · 结果同步到推荐'}
              </span>
            </button>

          </div>
        </div>
      </div>

      {/* Floating Bottom Right Button for Stats/Learning */}
      <div className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8">
        <button
          onClick={onGoToLearning}
          title="My Learning & Stats"
          className="p-3.5 bg-[#FAF8F3] hover:bg-[#F0EAE0] text-[#554E46] border border-[#D8D1C3] rounded-xl shadow-xs transition-all flex items-center gap-1 group"
        >
          <div className="relative">
            <BarChart3 className="w-6 h-6 stroke-[1.8]" />
            <Clock className="w-3.5 h-3.5 absolute -bottom-1 -right-1 bg-[#FAF8F3] rounded-full text-[#736B62]" />
          </div>
        </button>
      </div>
    </div>
  );
};
