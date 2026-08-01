# Reading Memory Engine V4（RME-V4）规格

## 目标

RME-V4 管理用户对每个词的记忆状态，并用这些状态驱动下一篇文章推荐。用户只进行连续阅读；系统在后台完成曝光归因、记忆更新、遗忘预测、机会计算和文章排序。

核心闭环：

`阅读 -> 词汇曝光 -> Confidence / FSRS -> Opportunity -> 文章推荐 -> 阅读`

## 范围与假设

- V4 增量扩展现有 Memory V2.2 存储，不清空或覆盖旧学习记录。
- 每个词保留 FSRS 状态，并新增曝光摘要、上下文历史、动态置信度、连续失败/恢复状态。
- E1 首次曝光只建档，不提交 FSRS，不提升等级。
- E2 自然曝光只有与上次有效自然曝光相隔至少 24 小时才形成有效证据；无效曝光仍可保留为历史。
- E3 到期词在系统推荐文章中再次出现时记为计划曝光。
- E4 连续 3 个跨自然日 `Again` 后进入强制曝光；连续 2 个跨自然日高质量 `Good` 后退出。
- 当前真实可用的 Quality 信号为点击、段落停留和正常阅读；眼动与 AI 质量判断仅保留输入字段。
- 尚无 GRE / IELTS 目标配置页，目标权重默认 `1.0`，接口允许未来传入目标权重。
- V4 等级表示阅读识别阶段：L0 未遇见、L1 已感知、L2 可识别、L3 已稳定、L4 已自动化。

## 领域契约

### Exposure

- `new`：该词第一次被阅读系统观测，Quality 只存档，不产生复习评级。
- `natural`：非系统安排的自然阅读曝光；24 小时窗口内重复出现不形成新的有效记忆证据。
- `scheduled`：词已到 FSRS 复现时间，且出现在推荐阅读中。
- `forced`：词处于连续遗忘恢复期，文章推荐必须优先覆盖。

### Exposure Quality

- 点击查词：`0`
- 未点击但显著慢于正常段落停留：`0.5`
- 未点击且正常阅读：`1`
- 所有输入统一限制到 `[0, 1]`；未来眼动或 AI 信号只能作为显式输入，不能改变区间。

### Confidence

Confidence 是 `0..100` 的派生值：

`历史成功率 × FSRS 当前可回忆率 × 近期曝光质量 × 最近阅读频率`

无历史时为 `0`；不单独以固定加减分方式持久化。

### Opportunity

Opportunity 是 `0..100` 的派生值：

`遗忘风险 × 重要程度 × 曝光缺口 × 阶段权重 × 用户目标权重`

强制曝光词保留最低机会分，避免因其他因子偏低而消失。

### Article Score

文章排序以唯一词的 Opportunity Coverage 为核心，并加入 CEFR、兴趣、长度、未知词比例和历史多样性：

`Article Score = Opportunity Coverage + CEFR + Topic + Length - Difficulty Risk - Repetition`

重复出现同一高机会词只计一次，避免通过词频堆叠作弊。

## 工程结构

- `src/lib/memoryV4/`：V4 类型、曝光、Confidence、Opportunity 与文章覆盖评分。
- `src/lib/memoryV2/`：继续承担现有持久化与 FSRS；以可选字段兼容 V4，不破坏旧记录。
- `src/lib/memoryV2RecommendationAdapter.ts`：把 V4 Opportunity 注入现有全库和本地候选排序。
- `tests/memoryV4*.test.ts`：纯函数、生命周期和推荐集成测试。

## 代码风格

V4 算法优先使用无副作用纯函数，时间必须由调用方传入：

```ts
const opportunity = calculateOpportunityScore(profile, {
  now,
  importance: 1,
  goalWeight: 1,
});
```

所有新增持久化字段均为可选字段；读取旧记录时通过归一化函数补齐安全默认值。

## 测试策略

- 单元测试：曝光分类、24 小时边界、Quality、Confidence、Opportunity、等级和文章覆盖。
- 集成测试：首次曝光只建档、点击回写质量、三次失败进入强制曝光、两次成功恢复、旧状态兼容。
- 推荐测试：高 Opportunity 覆盖优先、唯一词去重、已读文章仍被排除、CEFR 约束保持有效。
- 回归测试：运行全量现有测试、TypeScript 检查和生产构建。

## 命令

- 测试：`npm test`
- 类型检查：`npm run lint`
- 构建：`npm run build`
- 开发：`npm run dev`

## 边界

- 始终：保留现有浏览器本地数据；所有分数限定在有限范围；所有时间逻辑可注入测试时间。
- 需要另行决策：新增云端用户画像、目标配置 UI、眼动采集、AI 自动 Quality、跨设备同步。
- 禁止：把首次曝光当作成功复习；同一自然日重复提交 FSRS；用讨论全文直接训练或排序；静默删除 V2.2 历史。

## 验收标准

- 每个新词第一次出现后存在 V4 档案，但 FSRS `reps` 不增加。
- 自然曝光不足 24 小时不重复形成有效证据。
- 到期推荐曝光和强制曝光可以从持久化状态中确定。
- 点击将对应 occurrence 的 Quality 归零。
- Confidence 与 Opportunity 可从真实存储状态稳定重算。
- 文章按唯一高机会词覆盖优先排序，并继续遵守历史排除与 CEFR 安全窗口。
- 旧 V2.2 数据无需迁移脚本即可读取和继续学习。
