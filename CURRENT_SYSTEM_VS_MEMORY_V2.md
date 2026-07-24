# 当前单词熟练度系统 vs Memory V2.2 系统对比

## 📊 你当前的单词熟练度系统

### 核心实现文件
**`src/lib/proficiency.ts`** - 528 行完整的熟练度管理系统

### 系统架构

```
WordProficiency {
  lemma: string
  level: 0-4                    // 熟练度等级
  recognitionScore: 0-1         // 识别分数
  productionScore: 0-1          // 产出分数
  stabilityDays: number         // FSRS 稳定性
  lastReviewedAt: string
  nextReviewDue: string
  exposureCount: number         // 曝光次数
  fsrs: FsrsMemory             // FSRS-6 完整状态
}
```

### 核心特点

✅ **已使用 FSRS-6 算法**
- 完整的 FSRS 记忆状态
- ts-fsrs@5.4.1 集成
- 科学的间隔重复

✅ **双维度评分系统**
- `recognitionScore` - 识别能力（被动）
- `productionScore` - 产出能力（主动）

✅ **多种学习事件支持**
- 点击查词 (`applyClickLookup`)
- 段落曝光 (`applyExposures`)
- 主动产出 (`applyProductionUse`)
- 错误使用 (`applyIncorrectUse`)
- 回避使用 (`applyAvoidance`)
- 语法查询 (`applyGrammarQuery`)
- 手动掌握 (`applyMastered`)

✅ **智能等级计算**
```typescript
L0: 未复习且曝光 < 3 次
L1: 已引入但未稳定 或 上次评级为 Again
L2: 3+ 曝光或有正面回忆，retrievability ≥ 0.14
L3: retrievability ≥ 0.6, productionScore ≥ 0.3
L4: retrievability ≥ 0.8, productionScore ≥ 0.7
```

### 评级映射

| 事件类型 | FSRS 评级 | 说明 |
|---------|----------|------|
| 点击查词 | Rating.Again | 需要帮助 = 失败 |
| 曝光 3次 | 引入卡片 | 不计入 FSRS 评级 |
| 主动产出正确 | Rating.Good | 成功回忆 |
| 主动产出错误 | Rating.Again | 失败回忆 |
| 回避使用 | Rating.Again | 失败回忆 |
| 手动掌握 | Rating.Easy | 完全掌握 |

---

## 🆚 与 Memory V2.2 的核心区别

### 1. 记忆模型差异

| 特性 | 当前系统 | Memory V2.2 |
|------|---------|------------|
| **模型结构** | 单层 FSRS | 双层（词据聚合 + FSRS） |
| **评级时机** | 事件发生时立即评级 | 每天结束后统一结算 |
| **同一天多次事件** | 可能多次评级 | 合并为一次评级 |
| **不同文章的证据** | 混在一起 | 分别记录 |

### 2. 事件处理差异

#### 当前系统（立即评级）
```
点击查词 → applyClickLookup → FSRS.repeat(Again) → 立即更新状态
```

#### Memory V2.2（延迟结算）
```
点击查词 → 记录事件 → 文章级聚合 → 每日聚合 → 
[当天结束] → 结算评级 → FSRS.repeat → 更新状态
```

### 3. 冲突处理差异

#### 场景：同一天在两篇文章中遇到同一个单词

**当前系统：**
```
上午文章A: 未点击 → 可能触发某种正面信号
下午文章B: 点击了 → Rating.Again
结果: 可能产生冲突或被覆盖
```

**Memory V2.2：**
```
上午文章A: 未点击 → 记录文章A证据 (Good候选)
下午文章B: 点击了 → 记录文章B证据 (Again候选)
当天结束: Again > Good → 最终评级 = Again
结果: 明确的优先级，无冲突
```

### 4. 曝光处理差异

**当前系统：**
- 第 3 次曝光时引入 FSRS 卡片
- 曝光不产生 FSRS 评级
- 通过 `exposureCount` 累计

**Memory V2.2：**
- 每次曝光都记录（如果满足可见性规则）
- 曝光未点击 = Good 候选
- 同一文章多次曝光只计一次

### 5. Memory Score 差异

**当前系统：**
- 使用 `recognitionScore`（0-1）
- 直接来自 FSRS retrievability
- 简单映射到 L0-L4

**Memory V2.2：**
- 使用 `memoryScore`（0-100）
- 公式：MS(t) = 100 × R(t, S)^γ × M(S)
- M(S) 长期掌握度调节因子
- 避免"刚能记住"被误判为长期掌握

---

## 💡 两个系统的优劣对比

### 当前系统的优势

✅ **实时反馈**
- 立即更新熟练度
- 用户能马上看到变化

✅ **双维度评分**
- 区分识别和产出能力
- 更细粒度的能力评估

✅ **多事件支持**
- 支持主动产出评估
- 支持错误分析
- 支持回避检测

✅ **已经稳定运行**
- 有实际用户数据
- 经过验证的逻辑

### 当前系统的问题

❌ **同一天多次交互可能冲突**
- 先 Good 后 Again 如何处理？
- 不同文章的证据如何合并？

❌ **缺少完整审计链**
- 无法追溯原始事件
- 难以分析学习行为

❌ **等级跳动**
- retrievability 自然衰减可能导致频繁跳级

❌ **没有文章推荐集成**
- 缺少基于熟练度的推荐算法

### Memory V2.2 的优势

✅ **解决冲突问题**
- 明确的评级优先级（Again > Good）
- 分文章记录证据

✅ **完整审计链**
- 原始事件 → 文章词据 → 每日词据 → FSRS
- 可追溯、可分析

✅ **更稳定的等级**
- 滞后带机制防止跳动
- M(S) 调节因子

✅ **智能推荐集成**
- 基于真实学习数据推荐文章
- 4 种推荐策略

✅ **符合 V2.2 设计规范**
- 完整实现设计文档要求
- 18/18 测试验证

### Memory V2.2 的局限

❌ **不支持产出评分**
- 只有识别维度
- 没有 productionScore

❌ **点击原因未分类**
- 所有点击都是 Again
- 无法区分"不认识"和"确认义项"

❌ **延迟反馈**
- 需等到当天结束才结算
- 当天显示的是预测值

---

## 🔄 两个系统的关系

### 并行运行（推荐）

两个系统可以**同时运行**：

```typescript
// 保留当前系统
const currentProficiency = proficiencyMap[lemma];

// 同时使用 Memory V2.2
const memoryV2Proficiency = await memorySystem.getWordProficiency(userId, lemma);

// 对比分析
console.log('当前系统:', currentProficiency.level);
console.log('Memory V2.2:', memoryV2Proficiency.level);
```

### 集成方式

**方案 A：独立运行（最安全）**
```
当前系统 → 继续处理所有学习事件
Memory V2.2 → 只处理曝光和点击，用于推荐
```

**方案 B：逐步替换**
```
阶段1: 并行运行，收集数据
阶段2: 在推荐中使用 Memory V2.2
阶段3: 在统计中使用 Memory V2.2
阶段4: 完全替换当前系统
```

**方案 C：混合使用**
```
识别维度 → Memory V2.2
产出维度 → 当前系统的 productionScore
最终等级 → 综合两者
```

---

## 📊 数据迁移考虑

### 当前数据结构
```typescript
WordProficiency {
  lemma, level, recognitionScore, productionScore,
  stabilityDays, lastReviewedAt, nextReviewDue,
  exposureCount, fsrs
}
```

### Memory V2.2 数据结构
```typescript
WordMemoryState {
  userId, wordId, stability, difficulty,
  lastReview, nextReview, fsrsCard, fsrsReviews
}
```

### 迁移策略

**不需要迁移（推荐）**
- 两个系统独立存储
- Memory V2.2 从零开始积累数据
- 当前系统继续使用

**部分迁移**
- 只迁移 FSRS 状态
- 重新开始事件追踪

**完全迁移**
- 需要手动编写迁移脚本
- 将 fsrs 状态转为 WordMemoryState

---

## 🎯 推荐的集成策略

### 阶段 1：并行运行（当前阶段）

**当前系统：** 继续处理所有学习事件
```typescript
// 保持不变
proficiencyMap = applyClickLookup(proficiencyMap, word);
proficiencyMap = applyExposures(proficiencyMap, newLemmas);
proficiencyMap = applyProductionUse(proficiencyMap, text);
```

**Memory V2.2：** 只处理阅读事件
```typescript
// 新增：在 ReadingScreen 中自动记录
// 曝光事件 → Memory V2.2
// 点击事件 → Memory V2.2
```

### 阶段 2：推荐集成（立即可做）

**文章推荐：** 使用 Memory V2.2
```typescript
const recommendationProvider = async (request) => {
  // 优先使用 Memory V2.2 推荐
  const localArticle = await memoryV2RecommendationProvider(
    request, articles, { strategy: 'balanced' }
  );
  
  // 回退到 AI 生成
  return localArticle || generateAIArticle(request);
};
```

### 阶段 3：统计展示（立即可做）

**MyLearningScreen：** 展示两套数据对比
```typescript
// 当前系统统计
const currentStats = countByBand(proficiencyMap);

// Memory V2.2 统计
<MemoryV2Stats />

// 对比分析
```

### 阶段 4：评估和决策（1-2月后）

收集数据后评估：
- Memory V2.2 的推荐效果如何？
- 两个系统的等级差异有多大？
- 用户更喜欢哪个系统？

根据评估结果决定：
- 继续并行
- 完全替换
- 混合使用

---

## 🚀 立即可做的事情

### 1. 启用 Memory V2.2 推荐（3步）

```typescript
// 在 App.tsx 中
import { memoryV2RecommendationProvider } from './lib/memoryV2RecommendationAdapter';

const recommendationProvider = async (request) => {
  const localArticle = await memoryV2RecommendationProvider(
    request, articles, { strategy: 'balanced' }
  );
  return localArticle || generateAIArticle(request);
};
```

### 2. 展示 Memory V2.2 统计

```typescript
// 在 MyLearningScreen 中
import { MemoryV2Stats } from './MemoryV2Stats';

<div>
  <h2>当前系统</h2>
  <MetricCard value={masteredWordsCount} label="掌握词 (L4)" />
  <MetricCard value={learningWordsCount} label="学习中 (L1–L3)" />
  
  <h2>Memory V2.2（实时计算）</h2>
  <MemoryV2Stats />
</div>
```

### 3. 对比分析（调试）

```typescript
// 在浏览器控制台
const compareWord = async (lemma) => {
  // 当前系统
  const current = proficiencyMap[lemma];
  console.log('当前系统:', {
    level: current?.level,
    recognition: current?.recognitionScore,
    production: current?.productionScore,
    stability: current?.stabilityDays,
  });
  
  // Memory V2.2
  const { getSystem } = require('./lib/memoryV2/hooks').memoryV2;
  const system = getSystem();
  const memoryV2 = await system.getWordProficiency('default-user', lemma);
  console.log('Memory V2.2:', {
    level: memoryV2?.level,
    memoryScore: memoryV2?.memoryScore,
    stability: memoryV2?.stability,
  });
};

await compareWord('constraint');
```

---

## 📝 总结

### 你当前的系统

✅ **非常好的基础系统**
- 完整的 FSRS-6 集成
- 双维度评分（识别+产出）
- 多种学习事件支持
- 已有实际用户数据

⚠️ **有一些局限**
- 同一天多次交互可能冲突
- 缺少完整审计链
- 没有推荐算法集成

### Memory V2.2 系统

✅ **解决了关键问题**
- 明确的评级优先级
- 完整的审计链
- 智能推荐集成
- 符合 V2.2 设计规范

⚠️ **有一些局限**
- 只支持识别维度
- 点击原因未分类
- 延迟反馈

### 推荐方案

**🎯 并行运行 + 逐步集成**

1. **保持当前系统**处理所有学习事件
2. **Memory V2.2** 处理阅读曝光和点击（已自动集成）
3. **立即启用** Memory V2.2 推荐功能
4. **展示两套统计**供对比分析
5. **收集数据** 1-2 月后评估效果
6. **根据效果**决定下一步

这样既能利用 Memory V2.2 的推荐能力，又不影响现有系统的稳定运行！

---

**现在 Memory V2.2 已经完全就绪，建议立即启用推荐功能！** 🚀
