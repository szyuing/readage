import React, { useState } from 'react';
import { ArrowLeft, Search, X, MessageSquare } from 'lucide-react';
import { Article, ArticleSession } from '../types';

interface HistoryScreenProps {
  articles: Article[];
  sessions: Record<string, ArticleSession>;
  onSelectArticle: (article: Article) => void | Promise<void>;
  onBack: () => void;
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  articles,
  sessions,
  onSelectArticle,
  onBack,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);

  const sorted = [...articles].sort((a, b) => {
    const ta = a.lastOpenedAt || sessions[a.id]?.lastOpenedAt || '';
    const tb = b.lastOpenedAt || sessions[b.id]?.lastOpenedAt || '';
    return tb.localeCompare(ta);
  });

  const filteredArticles = sorted.filter(
    (a) =>
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F8F6F0] text-[#2B2723] flex flex-col justify-between selection:bg-[#FDE68A]">
      <header className="px-6 py-5 flex items-center justify-between border-b border-[#E8E2D5] bg-[#F8F6F0] sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-[#EFEAE0] rounded-xl text-[#524B43] transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-serif text-2xl font-normal text-[#2C2723]">文章历史</h1>
            <p className="text-[11px] text-[#8C8478]">P4 · 读过 / 在读 · 点击恢复会话</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showSearchInput ? (
            <div className="flex items-center bg-white border border-[#DDD6C8] rounded-xl px-3 py-1.5">
              <Search className="w-4 h-4 text-[#888] mr-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索历史..."
                className="bg-transparent text-sm outline-none w-36 sm:w-48 text-[#2B2723]"
                autoFocus
              />
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowSearchInput(false);
                }}
                className="p-1 hover:bg-gray-100 rounded-md text-[#888]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSearchInput(true)}
              className="p-2 hover:bg-[#EFEAE0] rounded-xl text-[#524B43] transition-colors"
              title="Search"
            >
              <Search className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8 space-y-4">
        {filteredArticles.length === 0 ? (
          <div className="text-center py-12 text-[#888] space-y-2">
            <p className="text-sm">还没有学习历史</p>
            <p className="text-xs">从 P1 粘贴文章、选库或 AI 推荐后会出现在这里</p>
          </div>
        ) : (
          filteredArticles.map((article) => {
            const session = sessions[article.id];
            const chatN = session?.chatMessages.length ?? 0;
            return (
              <div
                key={article.id}
                onClick={() => onSelectArticle(article)}
                className="bg-[#FAF8F3] hover:bg-[#F3EFE4] border border-[#E3DDD1] rounded-2xl p-5 shadow-2xs transition-all cursor-pointer group"
              >
                <h3 className="font-serif text-lg font-medium text-[#2A2621] mb-1 group-hover:text-[#C35E37] transition-colors">
                  {article.title}
                </h3>
                <p className="text-xs sm:text-sm text-[#666056] mb-3 leading-relaxed">
                  {article.description}
                </p>

                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-[#8A8377]">{article.date}</span>
                  {article.level && (
                    <span className="px-2 py-0.5 bg-[#EFECE3] text-[#5B544C] rounded-full text-xs font-medium">
                      {article.level}
                    </span>
                  )}
                  {article.source && (
                    <span className="text-[10px] text-[#A39A8C]">{article.source}</span>
                  )}

                  {article.status === 'Completed' ? (
                    <span className="px-3 py-0.5 bg-[#D2E7D6] text-[#27532F] rounded-full text-xs font-medium">
                      Completed
                    </span>
                  ) : (
                    <span className="px-3 py-0.5 bg-[#FDE8CD] text-[#8C5414] rounded-full text-xs font-medium">
                      In Progress
                    </span>
                  )}

                  {chatN > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#C35E37]">
                      <MessageSquare className="w-3 h-3" />
                      {chatN} 条讨论可恢复
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
};
