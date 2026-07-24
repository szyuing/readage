# Memory V2.2 完全替换执行方案

## 🎯 目标

**Memory V2.2 作为唯一的单词熟练度系统和文章推荐系统**

对于 Memory V2.2 不支持的功能，直接从项目中删除。

---

## ✂️ 删除的功能

### 1. 产出能力评分（productionScore）
**删除原因：** Memory V2.2 只追踪识别能力，不追踪产出能力

**影响：**
- 删除 `WordProficiency.productionScore` 字段
- 删除 `applyProductionUse()` 函数
- 删除 `applyIncorrectUse()` 函数
- 删除 `applyAvoidance()` 函数
- 删除 `findAvoidedTargetWords()` 函数

**替代方案：** 无，专注于被动识别能力

### 2. 主动产出相关的事件类型
**删除原因：** Memory V2.2 只处理曝光和点击

**删除的事件类型：**
- `production_use` - 主动产出使用
- `incorrect_use` - 错误使用
- `avoidance` - 回避使用
- `discussion` - 讨论评估相关

**保留的事件类型：**
- `exposure` - 段落曝光 ✅
- `click` - 单词点击 ✅
- `article_open` - 文章打开 ✅
- `article_complete` - 文章完成 ✅

### 3. 手动掌握功能
**删除原因：** Memory V2.2 依赖自然学习数据，不支持手动标记

**影响：**
- 删除 `applyMastered()` 函数
- 删除 ReviewWord 的 `mastered` 字段

### 4. 语法查询追踪
**删除原因：** Memory V2.2 不单独追踪语法查询

**影响：**
- 删除 `applyGrammarQuery()` 函数
- `grammar_query` 事件类型视为等同于 `click`

### 5. 复杂的等级计算逻辑
**删除原因：** Memory V2.2 使用统一的 Memory Score 计算

**替换为：**
- 统一使用 Memory Score (0-100)
- 统一的 L0-L4 映射规则

---

## ✅ 保留的功能

### 1. FSRS-6 核心
- ✅ 完整保留 FSRS-6 算法
- ✅ Stability 和 Difficulty
- ✅ 间隔重复调度

### 2. 基础事件追踪
- ✅ 段落曝光追踪
- ✅ 单词点击追踪
- ✅ 曝光计数

### 3. 等级系统
- ✅ L0-L4 等级
- ✅ 基于 Memory Score 的统一映射

### 4. 到期复习
- ✅ 到期单词检测
- ✅ 复习调度

---

## 🔄 执行步骤

### 步骤 1：重写 proficiency.ts（立即执行）

完全重写 `src/lib/proficiency.ts`，只保留 Memory V2.2 支持的功能。

### 步骤 2：更新 App.tsx

删除产出相关的事件处理，只保留阅读相关的。

### 步骤 3：更新 MyLearningScreen

使用 Memory V2.2 的统计数据。

### 步骤 4：清理未使用的代码

删除所有与产出能力相关的代码。

---

## 📝 新的 API 设计

### 简化的 proficiency API

```typescript
// 只保留核心功能

// 1. 获取单词熟练度（异步）
async function getWordProficiency(lemma: string): Promise<WordProficiency | null>

// 2. 获取所有单词（异步）  
async function getAllProficiency(): Promise<Record<string, WordProficiency>>

// 3. 获取到期单词（异步）
async function getDueWords(): Promise<string[]>

// 4. 获取统计（异步）
async function getProficiencyStats(): Promise<{ total, byLevel, dueCount }>

// 删除的函数：
// ❌ applyClickLookup - 由 Memory V2.2 自动处理
// ❌ applyExposures - 由 Memory V2.2 自动处理  
// ❌ applyProductionUse - 不支持
// ❌ applyIncorrectUse - 不支持
// ❌ applyAvoidance - 不支持
// ❌ applyGrammarQuery - 不支持
// ❌ applyMastered - 不支持
```

### 事件记录完全自动化

```typescript
// 在 ReadingScreen 中已自动集成
// 用户阅读时，Memory V2.2 自动记录：
// - 段落曝光 → 自动记录
// - 单词点击 → 自动记录

// App.tsx 中不再需要手动调用任何 proficiency 函数
```

---

## 🚀 开始执行

让我立即重写 proficiency.ts...
