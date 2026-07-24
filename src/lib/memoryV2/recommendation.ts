/**
 * 文章推荐算法 V2.2
 * 基于 Memory Score 和 FSRS 状态的智能推荐
 */

import { WordProficiencyView } from './memorySystem';

export interface Article {
  id: string;
  title: string;
  content: string[];
  level?: string;
  topic?: string;
  estimatedWordCount?: number;
}

export interface ArticleCandidate {
  article: Article;
  /** 文章中的所有词形还原后的单词列表 */
  lemmas: string[];
}

export interface RecommendationScore {
  articleId: string;
  score: number;
  /** 需要复习的单词数 */
  dueWordsCount: number;
  /** L0-L2 的单词数（学习区） */
  learningZoneCount: number;
  /** L3-L4 的单词数（巩固区） */
  consolidationZoneCount: number;
  /** 未知单词数（无记忆状态） */
  unknownWordsCount: number;
  /** 平均记忆分数 */
  averageMemoryScore: number;
  /** 推荐原因 */
  reason: string;
}

export interface RecommendationParams {
  /** 用户当前 CEFR 等级 */
  userLevel?: string;
  /** 用户感兴趣的主题 */
  preferredTopics?: string[];
  /** 优先推荐包含到期单词的文章 */
  prioritizeDueWords?: boolean;
  /** 学习区单词占比权重 */
  learningZoneWeight?: number;
  /** 巩固区单词占比权重 */
  consolidationZoneWeight?: number;
  /** 到期单词权重 */
  dueWordsWeight?: number;
  /** 最小学习区单词数 */
  minLearningZoneWords?: number;
  /** 最大未知单词占比 */
  maxUnknownWordsRatio?: number;
  /**
   * Minimum share of article lemmas present in the proficiency map before
   * personalized hard-filters apply. Below this coverage, candidates stay
   * available for cold-start ranking.
   */
  minProficiencyCoverage?: number;
  /** Base score used when ranking with little/no personalized evidence. */
  coldStartBaseScore?: number;
}

const DEFAULT_RECOMMENDATION_PARAMS: Required<RecommendationParams> = {
  userLevel: 'B1',
  preferredTopics: [],
  prioritizeDueWords: true,
  learningZoneWeight: 3.0,
  consolidationZoneWeight: 2.0,
  dueWordsWeight: 5.0,
  minLearningZoneWords: 5,
  maxUnknownWordsRatio: 0.3,
  minProficiencyCoverage: 0.2,
  coldStartBaseScore: 10,
};

/** True when the user has too little global evidence for hard personalization. */
export function isGlobalColdStart(
  proficiencyMap: Map<string, WordProficiencyView>,
  params: Pick<Required<RecommendationParams>, 'minLearningZoneWords'> = DEFAULT_RECOMMENDATION_PARAMS
): boolean {
  return proficiencyMap.size < Math.max(1, params.minLearningZoneWords);
}

/** Fraction of article lemmas that already have a proficiency record. */
export function articleProficiencyCoverage(
  lemmas: readonly string[],
  proficiencyMap: Map<string, WordProficiencyView>
): number {
  if (lemmas.length === 0) return 0;
  let known = 0;
  for (const lemma of lemmas) {
    if (proficiencyMap.has(lemma)) known += 1;
  }
  return known / lemmas.length;
}

/**
 * Personalized unknown/learning-zone filters are only reliable when both the
 * global map and the article itself have enough tracked lemmas.
 */
export function shouldUsePersonalizedFilters(
  candidate: ArticleCandidate,
  proficiencyMap: Map<string, WordProficiencyView>,
  params: Pick<
    Required<RecommendationParams>,
    'minLearningZoneWords' | 'minProficiencyCoverage'
  > = DEFAULT_RECOMMENDATION_PARAMS
): boolean {
  if (isGlobalColdStart(proficiencyMap, params)) return false;
  return (
    articleProficiencyCoverage(candidate.lemmas, proficiencyMap) >=
    params.minProficiencyCoverage
  );
}

/**
 * 文章推荐引擎
 */
export class RecommendationEngine {
  constructor(private params: RecommendationParams = {}) {
    this.params = { ...DEFAULT_RECOMMENDATION_PARAMS, ...params };
  }

  /**
   * 为候选文章打分
   *
   * 评分逻辑：
   * 1. 到期单词数 × dueWordsWeight
   * 2. 学习区单词数（L0-L2）× learningZoneWeight
   * 3. 巩固区单词数（L3-L4）× consolidationZoneWeight
   * 4. 主题匹配加成
   * 5. 等级匹配加成
   * 6. 惩罚未知单词过多的文章
   */
  scoreArticle(
    candidate: ArticleCandidate,
    proficiencyMap: Map<string, WordProficiencyView>,
    now: Date = new Date()
  ): RecommendationScore {
    const { article, lemmas } = candidate;
    const params = this.params as Required<RecommendationParams>;
    const personalized = shouldUsePersonalizedFilters(candidate, proficiencyMap, params);

    let dueWordsCount = 0;
    let learningZoneCount = 0;
    let consolidationZoneCount = 0;
    let unknownWordsCount = 0;
    let totalMemoryScore = 0;
    let knownWordsCount = 0;

    // 统计各类单词
    for (const lemma of lemmas) {
      const proficiency = proficiencyMap.get(lemma);

      if (!proficiency) {
        // Untracked lemmas only count as hard "unknown" once personalization is reliable.
        if (personalized) unknownWordsCount++;
        continue;
      }

      knownWordsCount++;
      totalMemoryScore += proficiency.memoryScore;

      // 检查是否到期
      if (new Date(proficiency.nextReview) <= now) {
        dueWordsCount++;
      }

      // 按等级分类
      if (proficiency.level <= 2) {
        learningZoneCount++;
      } else {
        consolidationZoneCount++;
      }
    }

    const totalWords = lemmas.length || 1;
    const unknownWordsRatio = unknownWordsCount / totalWords;
    const averageMemoryScore = knownWordsCount > 0 ? totalMemoryScore / knownWordsCount : 0;

    // 计算基础分数
    let score = personalized ? 0 : params.coldStartBaseScore;
    let reason = '';

    // 1. 到期单词得分
    if (dueWordsCount > 0) {
      score += dueWordsCount * params.dueWordsWeight;
      reason = `包含 ${dueWordsCount} 个到期单词`;
    }

    // 2. 学习区单词得分
    if (learningZoneCount >= params.minLearningZoneWords) {
      score += learningZoneCount * params.learningZoneWeight;
      if (reason) reason += `，`;
      reason += `${learningZoneCount} 个学习区单词`;
    } else if (!personalized && learningZoneCount > 0) {
      score += learningZoneCount * params.learningZoneWeight * 0.5;
    }

    // 3. 巩固区单词得分
    if (consolidationZoneCount > 0) {
      score += consolidationZoneCount * params.consolidationZoneWeight;
    }

    // 4. 主题匹配加成
    if (article.topic && params.preferredTopics.includes(article.topic)) {
      score *= 1.2;
      if (reason) reason += `，`;
      reason += `匹配偏好主题`;
    }

    // 5. 等级匹配加成
    if (article.level && article.level === params.userLevel) {
      score *= 1.1;
      if (!reason) reason = `匹配 ${article.level} 等级`;
    }

    // 6. 惩罚未知单词过多（仅个性化阶段）
    if (personalized && unknownWordsRatio > params.maxUnknownWordsRatio) {
      const penalty = 1 - (unknownWordsRatio - params.maxUnknownWordsRatio);
      score *= Math.max(0.3, penalty);
      if (reason) reason += `，`;
      reason += `未知单词较多`;
    }

    // 7. 优先级调整：优先推荐有复习价值的文章
    if (params.prioritizeDueWords && dueWordsCount > 0) {
      score *= 1.5;
    }

    if (!reason) {
      reason = personalized ? '适合当前水平' : '冷启动本地推荐';
    }

    return {
      articleId: article.id,
      score,
      dueWordsCount,
      learningZoneCount,
      consolidationZoneCount,
      unknownWordsCount: personalized
        ? unknownWordsCount
        : Math.max(0, lemmas.length - knownWordsCount),
      averageMemoryScore,
      reason,
    };
  }

  /**
   * 批量为候选文章打分并排序
   */
  rankArticles(
    candidates: ArticleCandidate[],
    proficiencyMap: Map<string, WordProficiencyView>,
    now: Date = new Date()
  ): RecommendationScore[] {
    const scores = candidates.map((candidate) =>
      this.scoreArticle(candidate, proficiencyMap, now)
    );

    // 按分数降序排序
    scores.sort((a, b) => b.score - a.score);

    return scores;
  }

  /**
   * 推荐最佳文章
   *
   * @param candidates - 候选文章列表
   * @param proficiencyMap - 单词熟练度映射
   * @param limit - 返回的推荐数量
   * @returns 推荐文章及其评分
   */
  recommend(
    candidates: ArticleCandidate[],
    proficiencyMap: Map<string, WordProficiencyView>,
    limit: number = 5,
    now: Date = new Date()
  ): RecommendationScore[] {
    const ranked = this.rankArticles(candidates, proficiencyMap, now);
    return ranked.slice(0, limit);
  }

  /**
   * 过滤掉不适合的文章
   *
   * 过滤条件：
   * - 未知单词占比超过阈值
   * - 学习区单词数不足
   * - 没有任何复习价值（全是 L4 或未知）
   */
  filterCandidates(
    candidates: ArticleCandidate[],
    proficiencyMap: Map<string, WordProficiencyView>
  ): ArticleCandidate[] {
    const params = this.params as Required<RecommendationParams>;

    return candidates.filter((candidate) => {
      if (candidate.lemmas.length === 0) return false;

      // Global cold start, or this article has too little tracked coverage:
      // keep the candidate so the library is never emptied for new/low-sample users.
      if (!shouldUsePersonalizedFilters(candidate, proficiencyMap, params)) {
        return true;
      }

      const score = this.scoreArticle(candidate, proficiencyMap);

      // 未知单词过多
      const totalWords = candidate.lemmas.length || 1;
      const unknownRatio = score.unknownWordsCount / totalWords;
      if (unknownRatio > params.maxUnknownWordsRatio) {
        return false;
      }

      // 学习区单词不足且没有到期单词
      if (
        score.learningZoneCount < params.minLearningZoneWords &&
        score.dueWordsCount === 0
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * 更新推荐参数
   */
  updateParams(params: Partial<RecommendationParams>): void {
    this.params = { ...this.params, ...params };
  }
}

/**
 * 多样性推荐：避免连续推荐相似主题的文章
 */
export function diversifyRecommendations(
  recommendations: RecommendationScore[],
  articles: Map<string, Article>,
  recentArticleIds: string[],
  diversityWindow: number = 5
): RecommendationScore[] {
  const recentTopics = new Set<string>();

  // 收集最近阅读的文章主题
  for (const articleId of recentArticleIds.slice(-diversityWindow)) {
    const article = articles.get(articleId);
    if (article?.topic) {
      recentTopics.add(article.topic);
    }
  }

  // 降低相同主题文章的分数
  const adjusted = recommendations.map((rec) => {
    const article = articles.get(rec.articleId);
    if (article?.topic && recentTopics.has(article.topic)) {
      return { ...rec, score: rec.score * 0.7 };
    }
    return rec;
  });

  // 重新排序
  adjusted.sort((a, b) => b.score - a.score);

  return adjusted;
}

/**
 * 间隔重复推荐：确保到期单词得到及时复习
 */
export function scheduleReviewArticles(
  dueWords: WordProficiencyView[],
  candidates: ArticleCandidate[],
  targetReviewCount: number = 10
): ArticleCandidate[] {
  // 按到期紧急程度排序
  const sortedDueWords = dueWords.sort((a, b) => {
    const aOverdue = new Date().getTime() - new Date(a.nextReview).getTime();
    const bOverdue = new Date().getTime() - new Date(b.nextReview).getTime();
    return bOverdue - aOverdue;
  });

  const priorityWords = new Set(
    sortedDueWords.slice(0, targetReviewCount).map((w) => w.wordId)
  );

  // 筛选包含优先单词的文章
  const reviewArticles = candidates.filter((candidate) => {
    const matchCount = candidate.lemmas.filter((lemma) => priorityWords.has(lemma)).length;
    return matchCount > 0;
  });

  // 按匹配的优先单词数量排序
  reviewArticles.sort((a, b) => {
    const aMatches = a.lemmas.filter((lemma) => priorityWords.has(lemma)).length;
    const bMatches = b.lemmas.filter((lemma) => priorityWords.has(lemma)).length;
    return bMatches - aMatches;
  });

  return reviewArticles;
}
