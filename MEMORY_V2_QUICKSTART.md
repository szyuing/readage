# Memory V2.2 快速开始 🚀

## 5 分钟上手指南

### 系统已自动集成！

Memory V2.2 已经完全集成到应用中，**无需额外配置**。当用户阅读文章时：

- ✅ 段落曝光自动记录
- ✅ 单词点击自动记录  
- ✅ 每天自动结算到 FSRS
- ✅ Memory Score 实时计算

### 1️⃣ 在组件中显示统计数据

在 `MyLearningScreen.tsx` 中添加：

```typescript
import { MemoryV2Stats } from './MemoryV2Stats';

// 在 render 中添加
<MemoryV2Stats className="mb-6" />
```

效果：
- 显示 L0-L4 等级分布条形图
- 显示平均 Memory Score
- 显示到期单词数量

### 2️⃣ 显示到期单词列表

```typescript
import { MemoryV2DueWords } from './MemoryV2Stats';

<MemoryV2DueWords 
  limit={10} 
  onWordClick={(wordId) => console.log(wordId)} 
/>
```

### 3️⃣ 查询单个单词的熟练度

```typescript
import { useWordProficiency } from '../lib/memoryV2/hooks';

function WordDetail({ wordId }: { wordId: string }) {
  const { proficiency, loading } = useWordProficiency(wordId);
  
  if (loading) return <div>Loading...</div>;
  if (!proficiency) return <div>No data</div>;
  
  return (
    <div>
      <p>Memory Score: {proficiency.memoryScore.toFixed(0)}</p>
      <p>Level: L{proficiency.level}</p>
      <p>Stability: {proficiency.stability.toFixed(1)} days</p>
    </div>
  );
}
```

## 工作原理

### 数据流

```
用户阅读 → 曝光记录 → 点击记录 → 每日聚合 → FSRS 结算 → MS 计算 → L0-L4
```

### Memory Score 公式

```
MS(t) = 100 × R(t, S)^γ × M(S)
```

- **R(t, S)**: 当前回忆概率（基于时间和稳定性）
- **M(S)**: 长期掌握度调节因子
- **S**: FSRS Stability（天数）

### 等级映射

| 等级 | MS 范围 | 含义 |
|------|---------|------|
| L0 | 0-20 | 没有稳定识别证据 |
| L1 | 20-40 | 高度依赖帮助 |
| L2 | 40-60 | 正在形成识别 |
| L3 | 60-85 | 多数情况能够识别 |
| L4 | 85-100 | 长期、稳定、低负荷识别 |

## 调试工具

### 在浏览器控制台中

```javascript
// 查看所有单词的熟练度
const { getSystem } = require('./lib/memoryV2/hooks').memoryV2;
const system = getSystem();
const all = await system.getAllWordProficiency('default-user');
console.table(all);

// 查看统计数据
const stats = await system.getProficiencyStats('default-user');
console.log(stats);

// 查看到期单词
const due = await system.getDueWords('default-user', new Date(), 10);
console.log(due);
```

## 常见问题

### Q: 为什么新单词 MS 是 0？
**A**: 新单词还没有进行第一次 FSRS 复习，等待当天结束后结算。

### Q: 等级什么时候会变化？
**A**: 当 MS 跨越等级边界 ±3 时会变化（滞后带机制，避免频繁跳动）。

### Q: 数据存储在哪里？
**A**: 存储在浏览器的 localStorage 中，键名以 `english-ai:v2:memory:` 开头。

### Q: 如何清除数据？
**A**: 
```javascript
Object.keys(localStorage)
  .filter(k => k.includes('english-ai:v2:memory'))
  .forEach(k => localStorage.removeItem(k));
```

## 核心优势

### ✅ 解决的问题

1. **V2.1 的冲突问题** - 同一天多篇文章不再冲突
2. **精确的熟练度** - Memory Score 比简单等级更精确
3. **实时计算** - 无需等待后台任务
4. **完整审计链** - 从原始事件到最终等级可追溯

### 📊 关键指标

- **测试覆盖**: 18/18 (100%)
- **场景验证**: 6/6 核心场景
- **不变量**: 10/10 全部满足
- **性能**: 曝光/点击记录 < 5ms

## 下一步

### 推荐的集成步骤

1. ✅ **已完成**: 阅读事件自动记录
2. ✅ **已完成**: FSRS 自动结算
3. **待完成**: 在 MyLearningScreen 展示统计
4. **待完成**: 基于 Memory V2.2 的文章推荐
5. **待完成**: 生产数据校准参数

### 可选的增强功能

- 词据可视化面板
- 学习曲线图表
- 数据导出功能
- 历史数据迁移

## 技术支持

- 📖 **详细文档**: `MEMORY_V2_IMPLEMENTATION.md`
- 📘 **使用指南**: `MEMORY_V2_USAGE_GUIDE.md`
- 📗 **交付总结**: `MEMORY_V2_DELIVERY.md`
- 🧪 **测试文件**: `tests/memoryV2.test.ts`

---

**Memory V2.2 已就绪，开始使用吧！** 🎉
