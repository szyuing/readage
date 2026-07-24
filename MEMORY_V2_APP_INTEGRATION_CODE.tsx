/**
 * Memory V2.2 推荐系统 - App.tsx 集成代码
 *
 * 使用方法：
 * 1. 将此文件中的代码复制到 src/App.tsx
 * 2. 替换现有的 recommendationProvider
 * 3. 添加必要的导入语句
 */

// ============================================
// 步骤 1: 添加导入
// ============================================

import {
  memoryV2RecommendationProvider,
  createMemoryV2Adapter,
  type RecommendationStrategy
} from './lib/memoryV2RecommendationAdapter';

// ============================================
// 步骤 2: 添加状态管理（在 App 组件内部）
// ============================================

// 推荐策略状态
const [recommendationStrategy, setRecommendationStrategy] =
  useState<RecommendationStrategy>('balanced');

// 推荐统计（可选，用于调试）
const [recommendationStats, setRecommendationStats] = useState({
  memoryV2Count: 0,
  aiGeneratedCount: 0,
  lastRecommendationType: '' as 'memory-v2' | 'ai-generated' | '',
});

// ============================================
// 步骤 3: 替换 recommendationProvider
// ============================================

/**
 * 方案 A: 混合推荐（推荐使用）
 * 优先使用 Memory V2.2，没有合适的再 AI 生成
 */
const recommendationProvider: RecommendationProvider = async (request) => {
  const { topic, reviewWords, excludeArticleIds } = request;

  // 1. 尝试 Memory V2.2 本地推荐
  try {
    const localArticle = await memoryV2RecommendationProvider(
      request,
      articles, // 使用现有的 articles 状态
      {
        // 如果有复习单词，使用复习优先策略
        strategy: reviewWords.length > 0 ? 'review-first' : recommendationStrategy,
        userLevel: 'B1',
        preferredTopics: topic ? [topic] : [],
        recentArticleIds: excludeArticleIds,
        minLearningZoneWords: 5,
        maxUnknownWordsRatio: 0.3,
      }
    );

    if (localArticle) {
      console.log('📚 Memory V2.2 推荐:', localArticle.title);
      setRecommendationStats(prev => ({
        ...prev,
        memoryV2Count: prev.memoryV2Count + 1,
        lastRecommendationType: 'memory-v2',
      }));
      return localArticle;
    }
  } catch (error) {
    console.error('Memory V2.2 推荐失败，回退到 AI 生成:', error);
  }

  // 2. 回退到 AI 生成新文章
  console.log('🤖 AI 生成新文章');
  const response = await postTutor<RecommendedArticleCandidate>({
    intent: 'recommend_article',
    topic,
    reviewWords,
    level: 'B1',
  });

  const data = response.result;
  setRecommendationStats(prev => ({
    ...prev,
    aiGeneratedCount: prev.aiGeneratedCount + 1,
    lastRecommendationType: 'ai-generated',
  }));

  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
};

// ============================================
// 步骤 4（可选）: 添加策略切换功能
// ============================================

// 在 UI 中添加策略选择器
const RecommendationStrategySelector = () => {
  const strategies: { value: RecommendationStrategy; label: string; desc: string }[] = [
    {
      value: 'balanced',
      label: '平衡模式',
      desc: '平衡复习和学习新内容'
    },
    {
      value: 'review-first',
      label: '复习优先',
      desc: '优先推荐包含到期单词的文章'
    },
    {
      value: 'learn-first',
      label: '学习优先',
      desc: '快速扩展词汇量'
    },
    {
      value: 'consolidate',
      label: '巩固模式',
      desc: '巩固已学单词，提升熟练度'
    },
  ];

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        推荐策略
      </label>
      <select
        value={recommendationStrategy}
        onChange={(e) => setRecommendationStrategy(e.target.value as RecommendationStrategy)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
      >
        {strategies.map(s => (
          <option key={s.value} value={s.value}>
            {s.label} - {s.desc}
          </option>
        ))}
      </select>
    </div>
  );
};

// ============================================
// 步骤 5（可选）: 添加推荐统计显示
// ============================================

const RecommendationStats = () => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold mb-2">推荐统计</h3>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Memory V2.2 推荐:</span>
          <span className="font-medium">{recommendationStats.memoryV2Count}</span>
        </div>
        <div className="flex justify-between">
          <span>AI 生成:</span>
          <span className="font-medium">{recommendationStats.aiGeneratedCount}</span>
        </div>
        {recommendationStats.lastRecommendationType && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <span className="text-xs text-gray-500">
              最近推荐: {recommendationStats.lastRecommendationType === 'memory-v2' ? '📚 本地文章' : '🤖 AI 生成'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================
// 步骤 6（可选）: 添加智能推荐按钮
// ============================================

// 独立的智能推荐功能
const handleSmartRecommendation = async () => {
  try {
    const adapter = createMemoryV2Adapter({
      strategy: recommendationStrategy,
      userLevel: 'B1',
    });

    // 过滤掉已完成的文章
    const candidates = articles.filter(a => a.status !== 'Completed');
    const recentIds = articles
      .filter(a => a.status === 'Completed')
      .slice(-10)
      .map(a => a.id);

    const recommendations = await adapter.recommend(candidates, {
      limit: 5,
      recentArticleIds: recentIds,
    });

    if (recommendations.length === 0) {
      alert('暂无合适的推荐文章');
      return;
    }

    // 显示推荐结果
    console.log('🎯 智能推荐结果:', recommendations);

    // 打开第一篇推荐文章
    const topArticle = articles.find(a => a.id === recommendations[0].articleId);
    if (topArticle) {
      openArticle(topArticle.id);
    }
  } catch (error) {
    console.error('智能推荐失败:', error);
    alert('推荐失败，请重试');
  }
};

// 在 UI 中添加按钮（例如在首页）
<button
  onClick={handleSmartRecommendation}
  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
>
  🎯 智能推荐（Memory V2.2）
</button>

// ============================================
// 完整示例：在首页添加推荐功能
// ============================================

// 在 HomeScreen 组件中添加以下内容
const HomeScreenWithMemoryV2 = () => {
  return (
    <div className="space-y-6">
      {/* 推荐策略选择器 */}
      <RecommendationStrategySelector />

      {/* 推荐统计 */}
      <RecommendationStats />

      {/* 智能推荐按钮 */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={handleSmartRecommendation}
          className="px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl hover:from-blue-600 hover:to-purple-600 shadow-lg"
        >
          🎯 智能推荐
        </button>

        <button
          onClick={() => {/* 现有的推荐流程 */}}
          className="px-4 py-3 bg-gradient-to-r from-green-500 to-teal-500 text-white rounded-xl hover:from-green-600 hover:to-teal-600 shadow-lg"
        >
          🤖 AI 生成
        </button>
      </div>

      {/* Memory V2.2 统计卡片 */}
      <MemoryV2Stats />

      {/* 到期单词 */}
      <MemoryV2DueWords
        limit={10}
        onWordClick={(wordId) => console.log('点击单词:', wordId)}
      />
    </div>
  );
};

// ============================================
// 调试工具（可选）
// ============================================

// 添加到开发者工具或控制台
const debugMemoryV2Recommendation = async () => {
  console.log('🔍 Memory V2.2 推荐调试');

  const adapter = createMemoryV2Adapter({ strategy: 'balanced' });
  const candidates = articles.filter(a => a.status !== 'Completed');

  const recommendations = await adapter.recommend(candidates, { limit: 10 });

  console.log(`\n📊 找到 ${recommendations.length} 个推荐:`);
  recommendations.forEach((rec, index) => {
    const article = articles.find(a => a.id === rec.articleId);
    console.log(`\n${index + 1}. ${article?.title}`);
    console.log(`   评分: ${rec.score.toFixed(2)}`);
    console.log(`   到期单词: ${rec.dueWordsCount}`);
    console.log(`   学习区: ${rec.learningZoneCount}`);
    console.log(`   巩固区: ${rec.consolidationZoneCount}`);
    console.log(`   未知: ${rec.unknownWordsCount}`);
    console.log(`   原因: ${rec.reason}`);
  });
};

// 在浏览器控制台运行
window.debugMemoryV2 = debugMemoryV2Recommendation;

// ============================================
// 使用说明
// ============================================

/**
 * 最简单的集成方式（3 步）：
 *
 * 1. 添加导入语句（步骤 1）
 * 2. 替换 recommendationProvider（步骤 3，方案 A）
 * 3. 测试推荐功能
 *
 * 就这么简单！Memory V2.2 会自动：
 * - 分析用户的学习数据
 * - 计算每篇文章的适配度
 * - 推荐最合适的文章
 * - 没有合适的自动回退到 AI 生成
 */

/**
 * 进阶功能（可选）：
 *
 * - 步骤 4: 添加策略选择器，让用户选择推荐策略
 * - 步骤 5: 显示推荐统计
 * - 步骤 6: 添加独立的智能推荐按钮
 *
 * 这些都是可选的，基础功能只需要前 3 步！
 */
