# Memory V2.2 系统使用指南

## 概述

Memory V2.2 系统已经完全集成到应用中，提供了完整的单词熟练度追踪和智能推荐功能。

## 已完成的集成

### 1. 核心系统实现

✅ **7 个核心模块**
- `types.ts` - 类型定义
- `memoryScore.ts` - Memory Score 计算引擎
- `evidenceAggregation.ts` - 词据聚合逻辑
- `fsrsIntegration.ts` - FSRS 集成
- `memorySystem.ts` - 统一协调系统
- `recommendation.ts` - 智能推荐引擎
- `storage.ts` - 存储接口定义

✅ **存储层实现**
- `localStorageImpl.ts` - 基于 localStorage 的持久化存储

✅ **React 集成**
- `hooks.ts` - React Hooks
- `memoryV2Integration.ts` - ReadingScreen 集成
- `MemoryV2Stats.tsx` - 统计展示组件

### 2. 事件追踪集成

✅ **ReadingScreen 集成**
- 段落曝光自动记录
- 单词点击自动记录
- 自动生成唯一的 occurrenceId

✅ **自动结算**
- 应用启动时自动结算历史日期
- 每天只更新一次 FSRS

### 3. 数据展示组件

✅ **MemoryV2Stats** 组件
- 实时显示 L0-L4 等级分布
- 显示平均 Memory Score
- 显示到期单词数量

✅ **MemoryV2DueWords** 组件
- 展示到期单词列表
- 显示每个单词的详细信息（MS、Level、Stability）

## 快速开始

### 在组件中使用

#### 1. 记录事件（已自动集成到 ReadingScreen）

```typescript
import { useMemorySystem } from '../lib/memoryV2/hooks';

function MyComponent() {
  const { recordExposure, recordClick } = useMemorySystem();

  // 记录曝光
  await recordExposure('wordId', 'articleId', 'occurrenceId');

  // 记录点击
  await recordClick('wordId', 'articleId', 'occurrenceId');
}
```

#### 2. 查询单词熟练度

```typescript
import { useWordProficiency } from '../lib/memoryV2/hooks';

function WordCard({ wordId }: { wordId: string }) {
  const { proficiency, loading } = useWordProficiency(wordId);

  if (loading) return <div>Loading...</div>;
  if (!proficiency) return <div>No data</div>;

  return (
    <div>
      <p>Memory Score: {proficiency.memoryScore.toFixed(0)}</p>
      <p>Level: L{proficiency.level}</p>
      <p>Stability: {proficiency.stability.toFixed(1)} days</p>
      <p>Next Review: {new Date(proficiency.nextReview).toLocaleDateString()}</p>
    </div>
  );
}
```

#### 3. 显示统计数据

```typescript
import { useProficiencyStats } from '../lib/memoryV2/hooks';

function StatsPanel() {
  const { stats, loading } = useProficiencyStats();

  if (loading || !stats) return null;

  return (
    <div>
      <p>Total Words: {stats.total}</p>
      <p>Average Score: {stats.averageScore.toFixed(1)}</p>
      <p>Due Count: {stats.dueCount}</p>
      <p>L4: {stats.byLevel[4]}</p>
      <p>L3: {stats.byLevel[3]}</p>
      <p>L2: {stats.byLevel[2]}</p>
      <p>L1: {stats.byLevel[1]}</p>
      <p>L0: {stats.byLevel[0]}</p>
    </div>
  );
}
```

#### 4. 显示到期单词

```typescript
import { useDueWords } from '../lib/memoryV2/hooks';

function DueWordsList() {
  const { dueWords, loading, refresh } = useDueWords(10);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Due Words ({dueWords.length})</h2>
      {dueWords.map(word => (
        <div key={word.wordId}>
          <strong>{word.wordId}</strong> - MS: {word.memoryScore.toFixed(0)}
        </div>
      ))}
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}
```

#### 5. 使用统计组件（推荐）

```typescript
import { MemoryV2Stats, MemoryV2DueWords } from '../components/MemoryV2Stats';

function LearningDashboard() {
  return (
    <div>
      <MemoryV2Stats />
      <MemoryV2DueWords limit={10} onWordClick={(wordId) => console.log(wordId)} />
    </div>
  );
}
```

### 在 MyLearningScreen 中集成

在 `MyLearningScreen.tsx` 中添加 Memory V2.2 统计：

```typescript
import { MemoryV2Stats } from './MemoryV2Stats';

// 在 render 中添加：
<MemoryV2Stats className="mb-6" />
```

## 数据流说明

### 事件记录流程

```
用户阅读文章
    ↓
段落进入可见区域 800ms
    ↓
记录曝光事件 (RawWordEvent)
    ↓
聚合到 ArticleWordEvidence
    ↓
聚合到 DailyWordEvidence (pendingGrade)
    ↓
[当天结束或应用启动]
    ↓
结算：提交到 FSRS
    ↓
更新 WordMemoryState (S, D)
    ↓
实时计算 Memory Score
    ↓
映射到 L0-L4
```

### 点击事件处理

```
用户点击单词
    ↓
记录点击事件 (RawWordEvent)
    ↓
更新 ArticleWordEvidence
    ↓
更新 DailyWordEvidence (pendingGrade → Again)
    ↓
[当天结束]
    ↓
结算：提交 Again 到 FSRS
    ↓
降低 Stability
    ↓
Memory Score 下降
```

## 存储结构

所有数据存储在 `localStorage` 中，使用以下键名：

```
english-ai:v2:memory:raw:{userId}:{wordId}:{localDate}
english-ai:v2:memory:article:{userId}:{wordId}:{articleId}:{localDate}
english-ai:v2:memory:daily:{userId}:{wordId}:{localDate}
english-ai:v2:memory:state:{userId}:{wordId}
english-ai:v2:memory:*-index:{userId}
```

## 性能优化

### 批量操作

对于批量导入或历史数据迁移，使用批量 API：

```typescript
const { memorySystem } = useMemorySystem();

// 批量记录事件
await memorySystem.recordBatchEvents(events);

// 批量获取熟练度
const proficiencies = await memorySystem.getBatchWordProficiency(userId, wordIds);
```

### 缓存优化

Memory Score 是实时计算的，但等级显示使用滞后带（buffer=3）避免频繁跳动。

## 调试

### 启用调试日志

在浏览器控制台中：

```javascript
// 查看所有单词的熟练度
const { getSystem } = require('./lib/memoryV2/hooks').memoryV2;
const system = getSystem();
const all = await system.getAllWordProficiency('default-user');
console.table(all);

// 查看未结算的每日词据
const storage = new (require('./lib/memoryV2/localStorageImpl').LocalStorageMemoryStorage)();
const unfinalized = await storage.getUnfinalizedDailyEvidence('default-user');
console.log('Unfinalized:', unfinalized);

// 手动触发结算
await system.finalizeHistoricalDates('default-user', 'Asia/Shanghai');
```

### 查看存储数据

在浏览器控制台中：

```javascript
// 查看所有 Memory V2.2 相关的键
Object.keys(localStorage).filter(k => k.includes('memory'));

// 查看特定单词的状态
JSON.parse(localStorage.getItem('english-ai:v2:memory:state:default-user:constraint'));
```

## 常见问题

### Q: Memory Score 为什么是 0？
A: 新单词还没有进行过 FSRS 复习，需要等到第一次结算后才会有 MS。

### Q: 等级为什么不变？
A: 等级使用了滞后带（buffer=3），需要 MS 跨越边界 ±3 才会改变，避免频繁跳动。

### Q: 结算什么时候执行？
A: 
1. 应用启动时自动结算历史日期
2. 当天结束（跨天）时自动结算
3. 可以手动调用 `finalizeHistoricalDates()`

### Q: 如何清除所有数据？
A: 在浏览器控制台中：

```javascript
Object.keys(localStorage)
  .filter(k => k.includes('english-ai:v2:memory'))
  .forEach(k => localStorage.removeItem(k));
```

### Q: 如何迁移旧数据？
A: 暂不支持自动迁移，需要手动编写迁移脚本。旧的 `WordProficiency` 系统和新的 Memory V2.2 可以并行运行。

## 下一步

### 推荐实现优先级

1. **高优先级**
   - ✅ 在 MyLearningScreen 中展示 Memory V2.2 统计
   - ⬜ 实现基于 Memory V2.2 的文章推荐
   - ⬜ 添加词据可视化面板

2. **中优先级**
   - ⬜ 参数校准（γ、S_cap）
   - ⬜ 点击原因分类
   - ⬜ 词形归并（lemmatization）

3. **低优先级**
   - ⬜ 数据导出功能
   - ⬜ 历史数据迁移工具
   - ⬜ A/B 测试框架

## 技术支持

如遇问题，请检查：

1. 浏览器控制台是否有错误
2. localStorage 是否可用
3. 事件是否正确记录（查看 raw events）
4. 结算是否正常执行（查看 daily evidence 的 finalizedAt）

---

**Memory V2.2 系统现已完全集成并可用！**
