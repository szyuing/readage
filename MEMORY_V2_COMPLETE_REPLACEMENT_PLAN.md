# Memory V2.2 完全替换方案

## 🎯 目标

**将 Memory V2.2 作为唯一的单词熟练度系统和文章推荐系统**，完全替换当前的 `proficiency.ts` 系统。

---

## 📋 替换计划

### 阶段 1：扩展 Memory V2.2 功能（必要补充）

当前 Memory V2.2 缺少的功能需要补充：

#### 1.1 添加产出能力追踪
```typescript
// 扩展 WordMemoryState
interface WordMemoryStateV2Extended extends WordMemoryState {
  productionScore: number;  // 0-1，产出能力
}
```

#### 1.2 添加更多学习事件类型
```typescript
// 当前只有 exposure 和 click
// 需要添加：
- 'production_use'      // 主动产出使用
- 'incorrect_use'       // 错误使用
- 'avoidance'          // 回避使用
- 'grammar_query'      // 语法查询
- 'mastered'           // 手动掌握
```

#### 1.3 支持即时反馈（可选）
```typescript
// 当前是延迟结算，需要添加实时预览
interface DailyWordEvidence {
  // ... 现有字段
  currentPrediction: 'Good' | 'Again' | null;  // 当天实时预测
}
```

---

## 🔄 完整替换方案

### 方案 A：渐进式替换（推荐，低风险）

#### 步骤 1：保留旧系统作为备份（1天）

```typescript
// src/lib/proficiencyLegacy.ts
// 重命名 proficiency.ts 为 proficiencyLegacy.ts
// 保持所有导入路径正常工作
export * from './proficiencyLegacy';
```

#### 步骤 2：创建 Memory V2.2 适配层（1-2天）

创建 `src/lib/memoryV2Adapter.ts`：

```typescript
/**
 * Memory V2.2 适配层
 * 提供与旧 proficiency.ts 兼容的 API
 */

import { memoryV2 } from './memoryV2/hooks';
import type { WordProficiency, ProficiencyLevel } from '../types';
import type { WordMemoryState, WordProficiencyView } from './memoryV2';

/**
 * 将 Memory V2.2 的 WordProficiencyView 转换为旧的 WordProficiency 格式
 */
export function convertToLegacyProficiency(
  memoryV2Data: WordProficiencyView,
  productionScore: number = 0
): WordProficiency {
  return {
    lemma: memoryV2Data.wordId,
    level: memoryV2Data.level,
    recognitionScore: memoryV2Data.memoryScore / 100, // MS 0-100 → 0-1
    productionScore,
    stabilityDays: memoryV2Data.stability,
    lastReviewedAt: memoryV2Data.lastReview || new Date().toISOString(),
    nextReviewDue: memoryV2Data.nextReview,
    exposureCount: 0, // 可以从历史事件中计算
    fsrs: convertToLegacyFsrs(memoryV2Data),
  };
}

/**
 * 新的 proficiency API - 使用 Memory V2.2
 */
export const proficiency = {
  // 获取单词熟练度
  async get(lemma: string): Promise<WordProficiency | null> {
    const system = memoryV2.getSystem();
    const userId = memoryV2.getUserId();
    const data = await system.getWordProficiency(userId, lemma);
    
    if (!data) return null;
    
    // TODO: 从 productionScore 存储中获取
    const productionScore = 0;
    
    return convertToLegacyProficiency(data, productionScore);
  },
  
  // 获取所有单词
  async getAll(): Promise<Record<string, WordProficiency>> {
    const system = memoryV2.getSystem();
    const userId = memoryV2.getUserId();
    const allData = await system.getAllWordProficiency(userId);
    
    const result: Record<string, WordProficiency> = {};
    for (const data of allData) {
      result[data.wordId] = convertToLegacyProficiency(data);
    }
    return result;
  },
  
  // 应用点击查词
  async applyClickLookup(lemma: string): Promise<void> {
    const { recordClick } = memoryV2.getSystem();
    // TODO: 实现
  },
  
  // 应用曝光
  async applyExposures(lemmas: string[]): Promise<void> {
    const { recordExposure } = memoryV2.getSystem();
    // TODO: 实现
  },
  
  // 获取到期单词
  async getDueWords(): Promise<WordProficiency[]> {
    const system = memoryV2.getSystem();
    const userId = memoryV2.getUserId();
    const dueWords = await system.getDueWords(userId);
    
    return dueWords.map(w => convertToLegacyProficiency(w));
  },
  
  // 统计
  async countByBand(): Promise<{ learning: number; mastered: number }> {
    const system = memoryV2.getSystem();
    const userId = memoryV2.getUserId();
    const stats = await system.getProficiencyStats(userId);
    
    return {
      learning: stats.byLevel[1] + stats.byLevel[2] + stats.byLevel[3],
      mastered: stats.byLevel[4],
    };
  },
};
```

#### 步骤 3：逐个替换调用点（2-3天）

在 `App.tsx` 中逐步替换：

```typescript
// 旧代码
import { applyClickLookup, applyExposures } from './lib/proficiency';

// 新代码
import { proficiency } from './lib/memoryV2Adapter';

// 替换所有调用
proficiencyMap = applyClickLookup(proficiencyMap, word);
// 改为
await proficiency.applyClickLookup(word);
```

#### 步骤 4：验证和测试（1-2天）

- 对比新旧系统的输出
- 验证所有功能正常
- 修复发现的问题

#### 步骤 5：删除旧系统（1天）

- 删除 `proficiencyLegacy.ts`
- 清理未使用的代码
- 更新文档

**总时间：约 1 周**

---

### 方案 B：直接替换（快速，高风险）

#### 步骤 1：备份当前系统（必须）

```bash
git checkout -b backup-proficiency-system
git add .
git commit -m "Backup: current proficiency system before Memory V2.2 replacement"
git checkout main
```

#### 步骤 2：直接重写 proficiency.ts（1天）

完全重写 `src/lib/proficiency.ts`，使用 Memory V2.2 实现：

```typescript
/**
 * 单词熟练度系统 - Memory V2.2 实现
 * 完全替换旧的实现
 */

import { memoryV2 } from './memoryV2/hooks';
import type { WordProficiency, ProficiencyLevel } from '../types';

// 所有函数重新实现，使用 Memory V2.2
export async function applyClickLookup(
  map: Record<string, WordProficiency>,
  surface: string,
  at = new Date()
): Promise<Record<string, WordProficiency>> {
  // 使用 Memory V2.2 记录点击
  const { recordClick } = memoryV2.getSystem();
  // ... 实现
  
  // 立即返回更新后的 map
  return { ...map, [lemma]: updatedProficiency };
}

// ... 其他所有函数
```

#### 步骤 3：修复编译错误（1天）

- 解决类型不匹配
- 解决 API 差异
- 确保所有导入正常

#### 步骤 4：测试（1天）

- 运行所有测试
- 手动测试关键功能
- 修复 bug

**总时间：约 3 天，但风险高**

---

## 🎯 推荐方案：方案 C（混合，平衡）

结合两者优点，分模块逐步替换：

### 第 1 步：Memory V2.2 接管阅读事件（已完成 ✅）

**当前状态：**
- ✅ ReadingScreen 已集成曝光和点击记录
- ✅ Memory V2.2 自动追踪阅读数据

**无需改动，继续使用！**

### 第 2 步：Memory V2.2 接管推荐（立即可做）

**替换 App.tsx 中的 recommendationProvider：**

```typescript
// 完全使用 Memory V2.2 推荐
import { memoryV2RecommendationProvider } from './lib/memoryV2RecommendationAdapter';

const recommendationProvider: RecommendationProvider = async (request) => {
  return await memoryV2RecommendationProvider(
    request,
    articles,
    { 
      strategy: 'balanced',
      userLevel: 'B1',
    }
  ) || generateAIArticleFallback(request);
};
```

### 第 3 步：Memory V2.2 接管统计展示（立即可做）

**在 MyLearningScreen 中完全使用 Memory V2.2：**

```typescript
import { useProficiencyStats, useDueWords } from '../lib/memoryV2/hooks';

export const MyLearningScreen: React.FC<Props> = ({
  onBack,
  onStartTargetedReview,
  // ... 移除旧的统计 props
}) => {
  // 完全使用 Memory V2.2
  const { stats } = useProficiencyStats();
  const { dueWords } = useDueWords();
  
  return (
    <div>
      {/* 使用 Memory V2.2 数据 */}
      <MetricCard value={stats?.byLevel[4] || 0} label="掌握词 (L4)" />
      <MetricCard value={(stats?.byLevel[1] || 0) + (stats?.byLevel[2] || 0) + (stats?.byLevel[3] || 0)} label="学习中 (L1–L3)" />
      <MetricCard value={dueWords.length} label="到期复习" />
      
      <MemoryV2Stats />
      <MemoryV2DueWords limit={10} />
    </div>
  );
};
```

### 第 4 步：扩展 Memory V2.2 支持产出能力（1-2周）

**创建 `src/lib/memoryV2/productionTracking.ts`：**

```typescript
/**
 * Memory V2.2 产出能力追踪扩展
 */

export interface ProductionScore {
  userId: string;
  wordId: string;
  score: number;  // 0-1
  lastUpdatedAt: string;
  correctUseCount: number;
  incorrectUseCount: number;
  avoidanceCount: number;
}

export class ProductionTracker {
  // 追踪产出能力
  async trackProduction(userId: string, wordId: string, correct: boolean) {
    // 实现产出追踪
  }
  
  async getProductionScore(userId: string, wordId: string): Promise<number> {
    // 获取产出分数
  }
}
```

### 第 5 步：集成产出能力到等级计算（1周）

**修改 Memory V2.2 的等级计算：**

```typescript
// src/lib/memoryV2/memoryScore.ts

export function scoreToLevelWithProduction(
  memoryScore: number,
  productionScore: number
): 0 | 1 | 2 | 3 | 4 {
  const baseLevel = scoreToLevel(memoryScore);
  
  // 结合产出能力调整等级
  if (baseLevel >= 3 && productionScore < 0.3) {
    return 2; // 识别好但产出差，降级
  }
  
  if (baseLevel === 3 && productionScore >= 0.7) {
    return 4; // 识别和产出都好，升级
  }
  
  return baseLevel;
}
```

### 第 6 步：删除旧系统（最后）

当 Memory V2.2 完全功能对等后：

```typescript
// 删除或重命名 proficiency.ts
// 更新所有导入
// 清理未使用的代码
```

**总时间：2-4 周，风险可控**

---

## 📝 具体实施代码

让我创建完整的替换代码...

