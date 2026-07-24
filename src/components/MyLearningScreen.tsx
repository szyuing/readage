import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from 'recharts';
import { ArticleProgressRow } from '../types';

interface MyLearningScreenProps {
  onBack: () => void;
  onStartTargetedReview: () => void;
  onOpenArticle: (articleId: string) => void;
  articlesReadCount: number;
  masteredWordsCount: number;
  learningWordsCount: number;
  streakDaysCount: number;
  recentEventCount: number;
  dueWordCount: number;
  weakPoints: string[];
  articleProgress: ArticleProgressRow[];
}

export const MyLearningScreen: React.FC<MyLearningScreenProps> = ({
  onBack,
  onStartTargetedReview,
  onOpenArticle,
  articlesReadCount,
  masteredWordsCount,
  learningWordsCount,
  streakDaysCount,
  recentEventCount,
  dueWordCount,
  weakPoints,
  articleProgress,
}) => {
  const radarData =
    weakPoints.length > 0
      ? weakPoints.slice(0, 6).map((skill, i) => ({
          skill: skill.replace(/_/g, ' ').slice(0, 14),
          value: Math.max(30, 90 - i * 10),
        }))
      : [
          { skill: 'Tenses', value: 50 },
          { skill: 'Collocations', value: 50 },
          { skill: 'Articles', value: 50 },
          { skill: 'Vocabulary', value: 50 },
          { skill: 'Grammar', value: 50 },
          { skill: 'Idioms', value: 50 },
        ];

  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#2B2723] flex flex-col justify-between selection:bg-[#FDE68A]">
      <header className="px-6 py-5 flex items-center gap-4 border-b border-[#E8E2D5]">
        <button
          onClick={onBack}
          className="p-2 hover:bg-[#EFEAE0] rounded-xl text-[#524B43] transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-serif text-2xl font-semibold text-[#2C2723]">My Learning</h1>
          <p className="text-xs text-[#8C8478]">P3 学习报告 · 真实本地数据</p>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#FAF8F3] border border-[#E3DDD1] rounded-2xl p-6 text-center shadow-2xs">
            <div className="text-4xl sm:text-5xl font-bold text-[#1E3A8A] tracking-tight mb-2">
              {articlesReadCount}
            </div>
            <div className="text-sm font-medium text-[#6B645B]">读过的文章</div>
          </div>

          <div className="bg-[#FAF8F3] border border-[#E3DDD1] rounded-2xl p-6 text-center shadow-2xs">
            <div className="text-4xl sm:text-5xl font-bold text-[#1E3A8A] tracking-tight mb-2">
              {masteredWordsCount}
            </div>
            <div className="text-sm font-medium text-[#6B645B]">掌握词 (L4)</div>
          </div>

          <div className="bg-[#FAF8F3] border border-[#E3DDD1] rounded-2xl p-6 text-center shadow-2xs">
            <div className="text-4xl sm:text-5xl font-bold text-[#1E3A8A] tracking-tight mb-2">
              {learningWordsCount}
            </div>
            <div className="text-sm font-medium text-[#6B645B]">学习中 (L1–L3)</div>
          </div>

          <div className="bg-[#FAF8F3] border border-[#E3DDD1] rounded-2xl p-6 text-center shadow-2xs">
            <div className="text-4xl sm:text-5xl font-bold text-[#1E3A8A] tracking-tight mb-2">
              {streakDaysCount}
            </div>
            <div className="text-sm font-medium text-[#6B645B]">连续天数*</div>
          </div>
        </div>

        <div className="bg-[#FAF8F3] border border-[#E3DDD1] rounded-2xl p-4 text-sm text-[#524B43] flex flex-wrap gap-4">
          <span>
            到期复习：<strong className="text-[#C35E37]">{dueWordCount}</strong> 词
          </span>
          <span>
            学习事件：<strong>{recentEventCount}</strong>
          </span>
          <span className="text-[11px] text-[#8C8478] w-full">*连续天数暂为演示固定值</span>
        </div>

        {/* Per-article progress — product §4.3 */}
        <div className="space-y-2">
          <h2 className="font-serif text-lg font-medium text-[#2A2621]">按文章的进度</h2>
          {articleProgress.length === 0 ? (
            <p className="text-sm text-[#8C8478] bg-[#FAF8F3] border border-[#E3DDD1] rounded-xl p-4">
              打开文章学习后，这里会按文章汇总点击查词与讨论次数。
            </p>
          ) : (
            <ul className="space-y-2">
              {articleProgress.map(({ article, clickCount, discussionCount }) => (
                <li key={article.id}>
                  <button
                    type="button"
                    onClick={() => onOpenArticle(article.id)}
                    className="w-full text-left bg-[#FAF8F3] hover:bg-[#F3EFE4] border border-[#E3DDD1] rounded-xl p-4 transition-colors"
                  >
                    <div className="font-medium text-sm text-[#2A2621] mb-1">{article.title}</div>
                    <div className="flex flex-wrap gap-3 text-[11px] text-[#6B645B]">
                      <span>查词 {clickCount}</span>
                      <span>讨论 {discussionCount}</span>
                      <span className="text-[#C35E37]">继续 →</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-[#FAF8F3] border border-[#E3DDD1] rounded-2xl p-6 shadow-2xs">
          <p className="text-xs font-semibold text-[#8C8478] mb-2 uppercase tracking-wider">
            语法薄弱点
            {weakPoints.length === 0 ? '（尚无批改数据，显示中位示意）' : '（来自批改反馈）'}
          </p>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="#E2DDD0" />
                <PolarAngleAxis
                  dataKey="skill"
                  tick={{ fill: '#4A443C', fontSize: 12, fontWeight: 500 }}
                />
                <Radar
                  name="Proficiency"
                  dataKey="value"
                  stroke="#3B82F6"
                  fill="#93C5FD"
                  fillOpacity={0.45}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          {weakPoints.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {weakPoints.map((w) => (
                <span
                  key={w}
                  className="px-2 py-0.5 bg-[#FDF2EE] text-[#C35E37] border border-[#FADCD1] rounded-md text-[11px]"
                >
                  {w}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <button
            onClick={onStartTargetedReview}
            className="w-full py-4 bg-[#C35E37] hover:bg-[#A94E2B] text-white rounded-xl font-medium text-lg transition-all shadow-md text-center block"
          >
            针对性复习（语境文章 → P2）
          </button>
          <p className="text-[11px] text-center text-[#8C8478]">
            按产品原则：到期词织入新文章，不提供孤立词卡。
          </p>
        </div>
      </main>
    </div>
  );
};
