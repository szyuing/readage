/**
 * Memory V2.2 推荐系统适配器
 * 将 Memory V2.2 推荐引擎集成到现有的推荐接口中
 */

import type { Article } from '../types';
import type { RecommendationRequest } from './recommendationFeed';
import {
  RecommendationEngine,
  ArticleCandidate,
  RecommendationScore,
  scheduleReviewArticles,
  diversifyRecommendations,
} from './memoryV2/recommendation';
import { memoryV2 } from './memoryV2/hooks';
import { getNewLemmas } from './readingExposure';
import type { WordProficiencyView } from './memoryV2/memorySystem';

/**
 * 从文章中提取所有 lemmas
 */
function extractLemmasFromArticle(article: Article): string[] {
  const allLemmas = new Set<string>();
  const exposedSet = new Set<string>();

  for (const paragraph of article.content) {
    const newLemmas = getNewLemmas(paragraph, exposedSet);
    newLemmas.forEach(lemma => {
      allLemmas.add(lemma);
      exposedSet.add(lemma);
    });
  }

  return Array.from(allLemmas);
}

/**
 * 将文章库转换为候选文章列表
 */
function convertToArticleCandidates(articles: Article[]): ArticleCandidate[] {
  return articles.map(article => ({
    article,
    lemmas: extractLemmasFromArticle(article),
  }));
}

/**
 * 基于 Memory V2.2 的推荐策略
 */
export type RecommendationStrategy =
  | 'balanced'      // 平衡学习区和复习区
  | 'review-first'  // 优先复习到期单词
  | 'learn-first'   // 优先学习新内容
  | 'consolidate';  // 优先巩固已学内容

export interface MemoryV2RecommendationOptions {
  /** 推荐策略 */
  strategy?: RecommendationStrategy;
  /** 返回的推荐数量 */
  limit?: number;
  /** 用户当前 CEFR 等级 */
  userLevel?: string;
  /** 用户偏好的主题 */
  preferredTopics?: string[];
  /** 最小学习区单词数 */
  minLearningZoneWords?: number;
  /** 最大未知单词占比 */
  maxUnknownWordsRatio?: number;
  /** 最近阅读的文章 ID（用于多样性推荐） */
  recentArticleIds?: string[];
  /** 多样性窗口大小 */
  diversityWindow?: number;
}

/**
 * Memory V2.2 推荐适配器
 */
export class MemoryV2RecommendationAdapter {
  private engine: RecommendationEngine;

  constructor(options: MemoryV2RecommendationOptions = {}) {
    const {
      strategy = 'balanced',
      userLevel = 'B1',
      preferredTopics = [],
      minLearningZoneWords = 5,
      maxUnknownWordsRatio = 0.3,
    } = options;

    // 根据策略调整权重
    const weights = this.getStrategyWeights(strategy);

    this.engine = new RecommendationEngine({
      userLevel,
      preferredTopics,
      prioritizeDueWords: weights.prioritizeDueWords,
      learningZoneWeight: weights.learningZoneWeight,
      consolidationZoneWeight: weights.consolidationZoneWeight,
      dueWordsWeight: weights.dueWordsWeight,
      minLearningZoneWords,
      maxUnknownWordsRatio,
    });
  }

  /**
   * 根据策略获取权重配置
   */
  private getStrategyWeights(strategy: RecommendationStrategy) {
    switch (strategy) {
      case 'review-first':
        return {
          prioritizeDueWords: true,
          learningZoneWeight: 2.0,
          consolidationZoneWeight: 3.0,
          dueWordsWeight: 8.0,
        };
      case 'learn-first':
        return {
          prioritizeDueWords: false,
          learningZoneWeight: 5.0,
          consolidationZoneWeight: 1.0,
          dueWordsWeight: 2.0,
        };
      case 'consolidate':
        return {
          prioritizeDueWords: false,
          learningZoneWeight: 1.0,
          consolidationZoneWeight: 5.0,
          dueWordsWeight: 3.0,
        };
      case 'balanced':
      default:
        return {
          prioritizeDueWords: true,
          learningZoneWeight: 3.0,
          consolidationZoneWeight: 2.0,
          dueWordsWeight: 5.0,
        };
    }
  }

  /**
   * 推荐文章
   */
  async recommend(
    candidates: Article[],
    options: MemoryV2RecommendationOptions = {}
  ): Promise<RecommendationScore[]> {
    const {
      limit = 5,
      recentArticleIds = [],
      diversityWindow = 5,
    } = options;

    // 获取用户ID和记忆系统
    const userId = memoryV2.getUserId();
    const system = memoryV2.getSystem();

    // 获取所有单词的熟练度
    const allProficiency = await system.getAllWordProficiency(userId);
    const proficiencyMap = new Map(
      allProficiency.map(p => [p.wordId, p])
    );

    // 转换为候选文章
    const articleCandidates = convertToArticleCandidates(candidates);

    // 过滤掉不适合的文章
    const filtered = this.engine.filterCandidates(articleCandidates, proficiencyMap);

    // 推荐文章
    let recommendations = this.engine.recommend(filtered, proficiencyMap, limit * 2);

    // 应用多样性推荐
    if (recentArticleIds.length > 0) {
      const articlesMap = new Map(candidates.map(a => [a.id, a]));
      recommendations = diversifyRecommendations(
        recommendations,
        articlesMap,
        recentArticleIds,
        diversityWindow
      );
    }

    // 返回前 N 个
    return recommendations.slice(0, limit);
  }

  /**
   * 推荐复习文章
   * 专门为到期单词推荐包含这些单词的文章
   */
  async recommendForReview(
    candidates: Article[],
    targetWords?: readonly string[],
    limit?: number
  ): Promise<RecommendationScore[]>;
  async recommendForReview(
    candidates: Article[],
    targetReviewCount?: number,
    limit?: number
  ): Promise<RecommendationScore[]>;
  async recommendForReview(
    candidates: Article[],
    targetWordsOrCount: readonly string[] | number = 10,
    limit: number = 5
  ): Promise<RecommendationScore[]> {
    const userId = memoryV2.getUserId();
    const system = memoryV2.getSystem();
    const explicitTargetWords = Array.isArray(targetWordsOrCount)
      ? Array.from(
          new Set(
            targetWordsOrCount
              .map(word => word.trim().toLowerCase())
              .filter(Boolean)
          )
        )
      : [];
    const targetReviewCount = typeof targetWordsOrCount === 'number'
      ? targetWordsOrCount
      : explicitTargetWords.length > 0
        ? explicitTargetWords.length
        : 10;

    const allProficiency = await system.getAllWordProficiency(userId);
    const proficiencyMap = new Map(
      allProficiency.map(p => [p.wordId, p])
    );

    let priorityWords: WordProficiencyView[];
    if (explicitTargetWords.length > 0) {
      // Explicit targets take precedence and must not trigger a due-word query.
      priorityWords = explicitTargetWords.map(wordId => {
        const existing = proficiencyMap.get(wordId);
        if (existing) return existing;

        // A requested word may not have memory state yet, but it is still a valid target.
        const target: WordProficiencyView = {
          wordId,
          memoryScore: 0,
          level: 0,
          stability: 0,
          difficulty: 0,
          nextReview: new Date(0).toISOString(),
          lastReview: null,
        };
        proficiencyMap.set(wordId, target);
        return target;
      });
    } else {
      // Preserve the legacy behavior when no concrete target set is supplied.
      priorityWords = await system.getDueWords(userId, new Date(), targetReviewCount);
    }

    if (priorityWords.length === 0) {
      return this.recommend(candidates, { limit });
    }

    const articleCandidates = convertToArticleCandidates(candidates);
    const reviewArticles = scheduleReviewArticles(
      priorityWords,
      articleCandidates,
      targetReviewCount
    );

    if (reviewArticles.length === 0) {
      return this.recommend(candidates, { limit });
    }

    return this.engine.recommend(
      reviewArticles,
      proficiencyMap,
      limit
    );
  }

  /**
   * 更新推荐参数
   */
  updateOptions(options: Partial<MemoryV2RecommendationOptions>): void {
    if (options.userLevel) {
      this.engine.updateParams({ userLevel: options.userLevel });
    }
    if (options.preferredTopics) {
      this.engine.updateParams({ preferredTopics: options.preferredTopics });
    }
    if (options.minLearningZoneWords !== undefined) {
      this.engine.updateParams({ minLearningZoneWords: options.minLearningZoneWords });
    }
    if (options.maxUnknownWordsRatio !== undefined) {
      this.engine.updateParams({ maxUnknownWordsRatio: options.maxUnknownWordsRatio });
    }
  }
}

/**
 * 创建默认的推荐适配器实例
 */
export function createMemoryV2Adapter(
  options: MemoryV2RecommendationOptions = {}
): MemoryV2RecommendationAdapter {
  return new MemoryV2RecommendationAdapter(options);
}

/**
 * 将 Memory V2.2 推荐集成到现有的 RecommendationProvider 接口
 */
export async function memoryV2RecommendationProvider(
  request: RecommendationRequest,
  articleLibrary: Article[],
  options: MemoryV2RecommendationOptions = {}
): Promise<Article | null> {
  const { topic, reviewWords, excludeArticleIds } = request;

  // 过滤掉已排除的文章
  const candidates = articleLibrary.filter(
    article => !excludeArticleIds.includes(article.id)
  );

  if (candidates.length === 0) {
    return null;
  }

  // 创建推荐适配器
  const adapter = createMemoryV2Adapter({
    ...options,
    preferredTopics: topic ? [topic] : options.preferredTopics,
    recentArticleIds: excludeArticleIds,
  });

  // 如果有指定复习单词，使用复习推荐
  let recommendations: RecommendationScore[];
  if (reviewWords && reviewWords.length > 0) {
    recommendations = await adapter.recommendForReview(
      candidates,
      reviewWords,
      5
    );
  } else {
    recommendations = await adapter.recommend(candidates, {
      limit: 5,
      recentArticleIds: excludeArticleIds,
    });
  }

  if (recommendations.length === 0) {
    return null;
  }

  // 返回得分最高的文章
  const topRecommendation = recommendations[0];
  const article = candidates.find(a => a.id === topRecommendation.articleId);

  return article || null;
}
