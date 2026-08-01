import React from 'react';
import { HardDrive, Server, ShieldCheck } from 'lucide-react';

type ReadingDataRow = {
  label: string;
  collected: string;
  purpose: string;
  destination: string;
};

const READING_DATA_ROWS: readonly ReadingDataRow[] = [
  {
    label: '文章与进度',
    collected: '打开/完成过的文章、最近阅读时间、完成状态、查词/讨论次数、来源与难度。',
    purpose: '恢复阅读历史、统计学习天数，并避免重复推荐。',
    destination: '本机浏览器',
  },
  {
    label: '词汇学习证据',
    collected: '实际看到过的词、点击查询的词、所在文章/位置、曝光与点击次数、发生时间、本地日期/时区和复习状态。',
    purpose: '按设备本地自然日估计词汇记忆强度，安排到期复习，并匹配包含待复习词的文章。',
    destination: '本机浏览器',
  },
  {
    label: '测评与推荐依据',
    collected: '测评正确数、推断/推荐 CEFR、完成时间，以及本次推荐使用的主题和复习词。',
    purpose: '匹配合适的文章难度、长度和推荐顺序。',
    destination: '学习档案在本机；推荐请求按需处理',
  },
  {
    label: '文章与主动输入',
    collected: '你粘贴/导入的文章，以及主动发送的选词、段落、翻译、改写或讨论内容。',
    purpose: '生成解释、翻译、难度评级、改写或讨论回复。',
    destination: '需要 AI 时发送至服务端；历史仍保存在本机',
  },
];

export function ReadingDataNotice() {
  return (
    <section
      className="rounded-2xl border border-[#D6E4F0] bg-[#F3F7FB] p-4 sm:p-5"
      aria-labelledby="reading-data-notice-heading"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#1E3A8A]">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id="reading-data-notice-heading" className="text-base font-semibold text-[#1E3A8A]">
            阅读数据说明
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[#4A5568]">
            为了恢复学习、安排复习和匹配合适的文章，我们只记录与阅读学习直接相关的信息。不同数据的保存位置和用途如下。
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-[#D6E4F0] bg-white/80">
        <div className="hidden bg-[#E8F0F8] px-3 py-2 text-[11px] font-semibold text-[#4C6075] sm:grid sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:gap-3">
          <span>类别</span>
          <span>记录什么</span>
          <span>作用 / 为什么需要</span>
          <span className="text-right">保存或发送到哪里</span>
        </div>
        {READING_DATA_ROWS.map((row, index) => (
          <div
            key={row.label}
            className={`grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start sm:gap-3 ${
              index > 0 ? 'border-t border-[#E3EDF5]' : ''
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[#2F4B6C]">
              {index < 3 ? (
                <HardDrive className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <Server className="h-4 w-4 shrink-0" aria-hidden />
              )}
              {row.label}
            </div>
            <div className="text-xs leading-relaxed text-[#4A5568]">
              <span className="font-semibold text-[#6B7C8F] sm:hidden">记录：</span>
              {row.collected}
            </div>
            <div className="text-xs leading-relaxed text-[#4A5568]">
              <span className="font-semibold text-[#6B7C8F] sm:hidden">用途：</span>
              {row.purpose}
            </div>
            <div className="text-xs font-medium leading-relaxed text-[#1E3A8A] sm:max-w-44 sm:text-right">
              <span className="font-semibold text-[#6B7C8F] sm:hidden">去向：</span>
              {row.destination}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 text-xs leading-relaxed text-[#4A5568]">
        <p>
          <strong className="text-[#2F4B6C]">主动调用 AI：</strong>
          需要服务端处理的查词、翻译、分级、改写或讨论，会发送本次主动提交的文本和必要上下文；不使用这些功能时，不会为了统计阅读而上传整篇文章。
        </p>
        <p>
          <strong className="text-[#2F4B6C]">推荐诊断：</strong>
          在开发环境或启用推荐诊断的站点，可能会发送 CEFR 档位、复习词、文章标识、候选匹配分数和时间，用于检查推荐质量；不包含整篇文章或讨论全文。
        </p>
        <p>
          学习档案默认保存在当前浏览器，不会自动上传为云端档案。清除站点数据会删除本机记录；你可以在下方导出备份。
        </p>
      </div>
    </section>
  );
}
