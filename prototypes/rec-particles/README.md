# Learning Particles

独立粒子可视化页：

1. **词汇熟练度**（默认）— 真实 Memory V2 曝光 / 点击 / 读完
2. **推荐流水线** — 真实全库打分选文

## 词汇模式（真实 Memory V2）

主站阅读时：

| 真实行为 | 粒子事件 | 画面 |
|----------|----------|------|
| 段落停留 ≥800ms 曝光 | `vocab_exposure` | 词粒子出现/增大，绿系 |
| 点词查词 | `vocab_click` | 红闪（Again 证据） |
| 读完一篇（末段离屏或全段读完） | `vocab_article_complete` | 金环标记本篇 lemma |

颜色 = L0–L4，越靠近中心 Memory Score 越高。

```bash
# 粒子页
cd prototypes/rec-particles && npm run dev
# http://localhost:5177/          默认词汇模式
# http://localhost:5177/?mode=recommend  推荐模式
```

主站 `npm run dev` 后打开文章阅读/点词即可。

自测：`node scripts/smoke-vocab-particles.mjs`

---

## 推荐流水线

## 流水线（与主站一致）

```
① catalog   杂志库 ~600+ 全量入场（lemma 索引）
② filter    去掉已读 / 本轮见过
③ score     对剩余全量候选打分、按分聚拢
④ shortlist 截取头部 ~48
⑤ pick      日种子在头部里挑 1 篇
⑥ hydrate   只保留赢家（代表下载/打开正文）
```

| 事件 | 阶段 |
|------|------|
| `catalog_loaded` | ① 全库入场 |
| `pool_ready` | ② 过滤后候选规模 |
| `candidates` + `totalScored` | ③④ 打分 + 头部列表 |
| `picked` | ⑤⑥ 选中并 hydrate |

## 联调（真实流程，默认无模拟）

**终端 A — 主站**

```bash
# 仓库根目录
npm run dev
# → http://127.0.0.1:3000
```

**终端 B — 粒子页**

```bash
cd prototypes/rec-particles
npm install
npm run dev
# → http://127.0.0.1:5177
```

1. 打开粒子页：默认 **等待真实推荐**（不播 Demo）。
2. 主站控制台确认：`localStorage.recParticles` 不是 `"0"`（DEV 默认开）。
3. 主站点 **Recommend for Me / 开始推荐**。
4. 粒子页应显示：
   - **目标复习词** = 本轮真实 due lemmas（`dueLemmas.slice(0,5)` 等）
   - **统计** = 真实库规模 / 候选数 / 打分数 / 头部数
   - **赢家标题 + 命中词 + 分数/排名** = 真实选中文章

可选假数据：`http://127.0.0.1:5177/?demo=1`

### 主站遥测开关

- **开发模式默认开启**
- 强制开：`localStorage.setItem('recParticles', '1')`
- 强制关：`localStorage.setItem('recParticles', '0')`

### 自定义主站地址

粒子页默认轮询 `http://127.0.0.1:3000`：

```
http://127.0.0.1:5177/?api=http://127.0.0.1:3000
```

## 数据通道

1. **HTTP 环形缓冲**（跨端口主路径）  
   - `POST /api/debug/recommendation-events`（主站 emit）  
   - `GET /api/debug/recommendation-events?since=`  
   - `GET /api/debug/recommendation-stream`（SSE）  
   - 仅 loopback 可写/读

2. **BroadcastChannel `rec-particles`**（同浏览器、同 channel 名；跨端口不一定互通，作补充）

## 主站埋点位置

- `src/lib/recommendationTelemetry.ts` — 总线
- `src/App.tsx` — `session_start`
- `src/lib/resolveRecommendation.ts` — phase / catalog / candidates / picked
- `server.ts` — debug ring buffer + SSE

## 说明

- 不修改推荐算法，只观测。
- 生产环境默认不发遥测（除非手动 `recParticles=1`）。
- 不发送文章正文，只发 id / 短标题 / 分数摘要。
