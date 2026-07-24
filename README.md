# English AI · Active Reading MVP

以**文章**为核心实体的英语学习最小可行产品。依据《英语教学 AI 产品文档》v0.2，复用本仓库暖纸色前端，串联 **P1 获取 → P2 学习 → P3 报告 → P4 历史** 闭环。

详细设计见 **[DESIGN.md](./DESIGN.md)**。

## 功能范围（MVP）

| 页面 | 能力 |
|---|---|
| P1 Home | 粘贴文章 / 文章库 / AI 推荐 / 纯口语陪练 |
| P2 Reading | 点词查释义、讨论区、复习词高亮 |
| P3 My Learning | 进度统计、针对性语境复习入口 |
| P4 History | 历史/库列表，回跳 P2 |

本地词汇熟练度：点击查词 → L1；口语练习正确使用目标词 → 提升 production；曝光弱信号累积。

## 本地运行

**前置：** Node.js

```bash
npm install
```

在 `.env` 或 `.env.local` 中配置（可选；无 key 时走离线降级文案）：

```
GEMINI_API_KEY=your_key_here

# 外刊同步（hehonghui/awesome-english-ebooks）
# GITHUB_TOKEN=ghp_xxx          # 可选，提高 GitHub API 限额
# MAGAZINE_MAX_ISSUES_PER_SOURCE=4
# MAGAZINE_SYNC_CRON=0 12 * * 5 # 默认每周五 12:00
# MAGAZINE_SYNC_ON_BOOT=true    # 默认启动后全源同步；设 false 可关闭

# Step Plan（文字 tutor + 实时语音）
# STEP_API_KEY=your_step_key
# STEP_BASE_URL=https://api.stepfun.com/step_plan/v1
# STEP_CHAT_MODEL=step-3.7-flash
# STEP_REALTIME_MODEL=stepaudio-2.5-realtime
# STEP_REALTIME_URL=wss://api.stepfun.com/step_plan/v1/realtime
# LLM_PROVIDER=step
```

```bash
npm run dev
```

打开 http://localhost:3000

### 外刊杂志（Library → 外刊杂志）

从 [awesome-english-ebooks](https://github.com/hehonghui/awesome-english-ebooks) **定期/手动导入并解析**经济学人、纽约客、大西洋月刊、Wired：

1. 打开 **文章库 → 外刊杂志**
2. 点击 **同步外刊**（或等待定时任务）
3. 先选 **期号**，再选 **文章**，进入 P2 点词学习

| API | 说明 |
|---|---|
| `GET /api/magazines/sources` | 杂志源 |
| `GET /api/magazines/issues` | 期号列表 |
| `GET /api/magazines/issues/:id` | 期内文章列表 |
| `GET /api/magazines/articles/:id` | 单篇全文 |
| `POST /api/magazines/sync` | 手动同步 |
| `GET /api/magazines/sync/status` | 同步状态 |

解析结果缓存在本地 `data/magazines/`（已 gitignore），**不**再分发 epub/pdf 原文件。内容仅供个人学习，请支持正版订阅。

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | Express + Vite 开发服务器 |
| `npm run build` | 构建前端与 server |
| `npm run start` | 生产启动 |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | 单元测试（含 epub 解析 fixture） |

## 技术栈

- React 19 + TypeScript + Vite + Tailwind CSS 4
- Express API（Gemini：查词 / 翻译 / 推荐 / 聊天 / 口语；外刊同步解析）
- 数据：学习状态 localStorage；外刊正文服务端落盘
