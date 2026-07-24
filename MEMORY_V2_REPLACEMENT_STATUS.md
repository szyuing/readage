# Memory V2.2 完全替换 - 当前状态和完成方案

## ✅ 已完成

1. **备份旧系统**
   - ✅ `proficiency.ts` → `proficiency.legacy.ts`

2. **重写 proficiency.ts**
   - ✅ 完全基于 Memory V2.2 实现
   - ✅ 删除产出能力追踪
   - ✅ 删除手动掌握功能
   - ✅ 保留兼容性接口（返回空值而非抛出错误）

3. **核心改变**
   - ✅ 所有函数改为异步（async/await）
   - ✅ 不再使用 proficiencyMap 状态
   - ✅ 数据直接从 Memory V2.2 获取

## ⚠️ 剩余问题

### 问题 1：App.tsx 中的同步调用

**当前代码（错误）：**
```typescript
const dueLemmas = useMemo(
  () => getDueLemmas(proficiency, new Date()),
  [proficiency]
);
```

**问题：** `getDueLemmas` 现在是异步函数，不能在 useMemo 中同步调用

**解决方案：** 使用 Memory V2.2 的 React Hooks

```typescript
// 删除
const dueLemmas = useMemo(() => getDueLemmas(...), [...]);
const bands = useMemo(() => countByBand(...), [...]);

// 替换为
import { useDueWords, useProficiencyStats } from './lib/memoryV2/hooks';

const { dueWords } = useDueWords();
const { stats } = useProficiencyStats();

// 使用
const dueLemmas = dueWords.map(w => w.wordId);
const bands = { learning: stats?.learning || 0, mastered: stats?.mastered || 0 };
```

### 问题 2：proficiencyMap 状态管理

**当前代码：**
```typescript
const [proficiency, setProficiency] = usePersistentState<Record<string, WordProficiency>>(
  STORAGE_KEYS.proficiency,
  {},
  migrateProficiencyMap
);
```

**问题：** Memory V2.2 不使用 proficiencyMap，数据存储在独立的存储层

**解决方案：** 完全删除 proficiencyMap 状态

```typescript
// 删除整个 proficiency 状态
// const [proficiency, setProficiency] = ...

// 改用 Memory V2.2 Hooks
const { stats } = useProficiencyStats();
const { dueWords } = useDueWords();
```

---

## 🚀 完整替换方案

由于涉及大量 App.tsx 的改动，我提供两个方案：

### 方案 A：渐进式替换（推荐）

**保留 proficiency.ts 的兼容层，但停止存储 proficiencyMap**

1. ✅ 已完成：proficiency.ts 提供兼容的 API
2. ⬜ 待完成：App.tsx 中删除 proficiencyMap 状态
3. ⬜ 待完成：所有使用 proficiencyMap 的地方改用 Memory V2.2 Hooks
4. ⬜ 待完成：删除产出能力相关的 UI 和逻辑

**优点：** 
- 可以逐步迁移
- 每一步都可以测试
- 降低风险

**缺点：**
- 需要多次修改
- 迁移期间有些功能会失效

### 方案 B：最小化改动（快速）

**让 proficiency.ts 返回模拟数据，保持 App.tsx 不变**

修改 proficiency.ts，提供同步的包装函数：

```typescript
// 创建缓存
let proficiencyCache: Record<string, WordProficiency> = {};
let cacheTime = 0;
const CACHE_TTL = 5000; // 5 秒缓存

// 同步包装函数
export function getDueLemmasSync(
  map: Record<string, WordProficiency>,
  at = new Date()
): string[] {
  // 返回缓存的数据
  refreshCacheIfNeeded();
  return Object.keys(proficiencyCache).filter(lemma => {
    const prof = proficiencyCache[lemma];
    return prof && new Date(prof.nextReviewDue) <= at;
  });
}

export function countByBandSync(
  map: Record<string, WordProficiency>,
  at = new Date()
): { learning: number; mastered: number } {
  refreshCacheIfNeeded();
  // 从缓存计算
  let learning = 0, mastered = 0;
  Object.values(proficiencyCache).forEach(p => {
    if (p.level >= 4) mastered++;
    else if (p.level >= 1) learning++;
  });
  return { learning, mastered };
}

// 异步更新缓存
async function refreshCacheIfNeeded() {
  const now = Date.now();
  if (now - cacheTime < CACHE_TTL) return;
  
  try {
    proficiencyCache = await getAllProficiency();
    cacheTime = now;
  } catch (error) {
    console.error('Failed to refresh proficiency cache:', error);
  }
}

// 保持原有的同步函数名
export const getDueLemmas = getDueLemmasSync;
export const countByBand = countByBandSync;
```

**优点：**
- App.tsx 基本不需要改动
- 快速完成替换
- 向后兼容

**缺点：**
- 有缓存延迟
- 不是"真正"的 Memory V2.2 方式

---

## 📋 我的建议

**使用方案 B（最小化改动）+ 逐步迁移**

### 立即执行（今天）

1. ✅ 已完成：重写 proficiency.ts
2. ⬜ 添加同步包装函数和缓存（上面的代码）
3. ⬜ 测试编译和运行
4. ⬜ 启用 Memory V2.2 推荐

### 逐步迁移（接下来几周）

1. MyLearningScreen 改用 Memory V2.2 Hooks
2. 新功能只使用 Memory V2.2
3. 逐步替换 App.tsx 中的同步调用
4. 最终删除兼容层

---

## 🎯 下一步行动

**您希望我：**

**选项 A：** 继续完成方案 B（添加同步包装），让系统立即可用

**选项 B：** 暂停，让您审查当前的更改

**选项 C：** 创建一个新的分支，完整地重写 App.tsx

请告诉我您的选择，我会立即执行！
