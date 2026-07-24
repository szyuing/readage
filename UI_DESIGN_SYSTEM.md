# English AI · UI 设计系统文档

**版本** v1.0 · **更新日期** 2026-07-24

---

## 文档目的

本文档是 English AI 项目的 UI 设计系统规范，为所有前端开发提供统一的设计语言、组件库和开发指南。确保整个应用的视觉一致性、用户体验连贯性和代码可维护性。

---

## 1. 设计理念

### 1.1 核心价值观

- **温暖而专业**：营造舒适的学习氛围，同时保持教育产品的专业性
- **以内容为中心**：设计服务于阅读和学习体验，避免过度装饰
- **渐进式引导**：新手友好，专家高效，通过清晰的信息层级引导用户
- **尊重认知负荷**：减少不必要的选择，在关键决策点提供明确指引

### 1.2 视觉基调

**纸质阅读感**
模拟温暖的纸质书籍体验，使用米色/暖灰色背景，衬线字体用于标题，营造舒适的长时间阅读环境。

**克制的色彩**
主要使用中性色调，强调色（陶土橙）仅用于关键操作和状态提示，避免视觉疲劳。

**呼吸感的留白**
充足的内边距和行间距，让内容有呼吸空间，降低视觉压力。

---

## 2. 设计系统基础

### 2.1 色彩系统

#### 主色调（Neutrals）


```css
/* 背景色 */
--bg-primary: #F8F6F0      /* 主背景 - 暖纸色 */
--bg-secondary: #FAF8F3    /* 卡片/面板背景 */
--bg-tertiary: #EFECE3     /* 顶栏背景 */
--bg-hover: #F2ECE0        /* 悬停状态 */
--bg-elevated: #EFEAE0     /* 浮起元素背景 */

/* 边框色 */
--border-light: #E3DDD1    /* 轻边框 */
--border-medium: #DCD5C7   /* 中等边框 */
--border-dark: #E0DBCF     /* 深色边框 */
--border-divider: #E5DFD1  /* 分割线 */

/* 文本色 */
--text-primary: #2B2723    /* 主文本 - 深棕 */
--text-secondary: #5B544C  /* 次要文本 */
--text-tertiary: #8C8478   /* 辅助文本 */
--text-muted: #777066      /* 静音文本 */
--text-placeholder: #666   /* 占位文本 */
```

#### 强调色（Accent）

```css
/* 主强调色 - 陶土橙 */
--accent-primary: #C35E37
--accent-hover: #A94E2B
--accent-active: #A44B29

/* 语义色 */
--success: #059669         /* 成功/完成 */
--warning: #D97706         /* 警告 */
--error: #DC2626           /* 错误 */
--info: #0369A1            /* 信息 */
```

#### 功能色（Functional）

```css
/* 状态背景 */
--status-warning-bg: #FEF3C7
--status-warning-border: #FDE68A
--status-warning-text: #92400E

--status-error-bg: #FEE2E2
--status-error-border: #FECACA
--status-error-text: #991B1B

--status-info-bg: #E0F2FE
--status-info-border: #BAE6FD
--status-info-text: #075985

--status-success-bg: #D1FAE5
--status-success-border: #A7F3D0
--status-success-text: #065F46

/* 选择/高亮 */
--selection-bg: #FDE68A    /* 文本选中背景 */
--highlight-yellow: #FEF3C7 /* 关键词高亮 */
```

### 2.2 排版系统

#### 字体家族

```css
/* 无衬线字体 - 正文 */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
             'Noto Sans', Helvetica, Arial, sans-serif;

/* 衬线字体 - 标题 */
font-family: Georgia, 'Times New Roman', serif;
```

#### 字体尺寸比例

```css
--text-xs: 11px      /* 辅助信息 */
--text-sm: 12px      /* 小字 */
--text-base: 14px    /* 正文基础 */
--text-md: 16px      /* 正文标准 */
--text-lg: 18px      /* 大正文 */
--text-xl: 20px      /* 小标题 */
--text-2xl: 24px     /* 中标题 */
--text-3xl: 30px     /* 大标题 */
--text-4xl: 36px     /* 特大标题 */
--text-5xl: 48px     /* 超大标题 */
```

#### 字重

```css
--font-normal: 400
--font-medium: 500
--font-semibold: 600
--font-bold: 700
```

#### 行高

```css
--leading-tight: 1.25
--leading-snug: 1.375
--leading-normal: 1.5
--leading-relaxed: 1.625
--leading-loose: 2
```

### 2.3 间距系统

使用 4px 基础单位的 8 点网格系统：

```css
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
```

### 2.4 圆角系统

```css
--radius-sm: 6px       /* 小元素 */
--radius-md: 8px       /* 按钮 */
--radius-lg: 12px      /* 卡片 */
--radius-xl: 16px      /* 大卡片 */
--radius-2xl: 24px     /* 模态框 */
--radius-full: 9999px  /* 圆形 */
```

### 2.5 阴影系统

```css
--shadow-2xs: 0 1px 2px rgba(0, 0, 0, 0.04)
--shadow-xs: 0 1px 3px rgba(0, 0, 0, 0.08)
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.08)
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.12)
--shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.12)
```


---

## 3. 组件库

### 3.1 按钮（Button）

#### 主要按钮（Primary）
用于页面的主要操作（如"AI 推荐"）

```tsx
<button className="px-5 py-4 bg-[#C35E37] hover:bg-[#A94E2B]
                   text-white border border-[#C35E37]
                   rounded-xl text-base font-medium
                   transition-all shadow-xs">
  Primary Action
</button>
```

#### 次要按钮（Secondary）
用于常规操作

```tsx
<button className="px-5 py-4 bg-[#FAF8F3] hover:bg-[#F2ECE0]
                   text-[#332E28] border border-[#DCD5C7]
                   rounded-xl text-base font-medium
                   transition-all shadow-2xs">
  Secondary Action
</button>
```

#### 文本按钮（Text）
用于低优先级操作

```tsx
<button className="px-3 py-1.5 text-sm font-medium
                   text-[#C35E37] hover:text-[#A44B29]
                   underline transition-colors">
  Text Action
</button>
```

#### 图标按钮（Icon）

```tsx
<button className="p-3.5 bg-[#FAF8F3] hover:bg-[#F0EAE0]
                   text-[#554E46] border border-[#D8D1C3]
                   rounded-xl shadow-xs transition-all">
  <Icon className="w-6 h-6" />
</button>
```

#### 状态
- **默认**: 正常显示
- **悬停**: 背景色加深
- **禁用**: `opacity-50 cursor-not-allowed`
- **加载**: 显示 spinner

### 3.2 卡片（Card）

#### 基础卡片

```tsx
<div className="bg-[#FAF8F3] border border-[#E3DDD1]
                rounded-2xl p-8 shadow-sm">
  {/* Content */}
</div>
```

#### 交互式卡片

```tsx
<div className="bg-[#FAF8F3] border border-[#E3DDD1]
                rounded-2xl p-6 shadow-sm
                hover:shadow-md transition-all cursor-pointer">
  {/* Content */}
</div>
```

#### 文章卡片

```tsx
<article className="bg-white border border-[#E8E3D7]
                    rounded-xl p-5 hover:border-[#C35E37]
                    hover:shadow-sm transition-all cursor-pointer">
  <h3 className="font-serif text-lg font-semibold text-[#2A2622] mb-2">
    {title}
  </h3>
  <p className="text-sm text-[#6B6459] leading-relaxed mb-3">
    {description}
  </p>
  <div className="flex items-center gap-3 text-xs text-[#8C8478]">
    <span>{date}</span>
    <span>•</span>
    <span>{level}</span>
  </div>
</article>
```

### 3.3 输入框（Input）

#### 文本输入

```tsx
<input
  type="text"
  className="w-full px-4 py-3 bg-white border border-[#DCD5C7]
             rounded-xl text-[#2B2723] placeholder:text-[#8C8478]
             focus:outline-none focus:ring-2 focus:ring-[#C35E37]
             focus:border-transparent transition-all"
  placeholder="Enter text..."
/>
```

#### 文本域

```tsx
<textarea
  className="w-full px-4 py-3 bg-white border border-[#DCD5C7]
             rounded-xl text-[#2B2723] placeholder:text-[#8C8478]
             focus:outline-none focus:ring-2 focus:ring-[#C35E37]
             focus:border-transparent transition-all resize-none"
  rows={4}
  placeholder="Enter your message..."
/>
```

### 3.4 模态框（Modal）

#### 全屏模态框结构

```tsx
<div className="fixed inset-0 bg-black/40 backdrop-blur-sm
                flex items-center justify-center z-50 p-4">
  <div className="w-full max-w-2xl bg-[#FAF8F3] rounded-2xl
                  shadow-xl max-h-[90vh] overflow-hidden
                  flex flex-col">
    {/* Header */}
    <div className="flex items-center justify-between px-6 py-4
                    border-b border-[#E3DDD1]">
      <h2 className="font-serif text-2xl font-semibold text-[#2A2622]">
        Title
      </h2>
      <button className="p-2 hover:bg-[#EFECE3] rounded-lg">
        <X className="w-5 h-5" />
      </button>
    </div>

    {/* Content */}
    <div className="flex-1 overflow-y-auto px-6 py-6">
      {/* Modal content */}
    </div>

    {/* Footer */}
    <div className="px-6 py-4 border-t border-[#E3DDD1]
                    flex justify-end gap-3">
      <button>Cancel</button>
      <button>Confirm</button>
    </div>
  </div>
</div>
```

### 3.5 导航栏（Navigation）

#### 顶部导航

```tsx
<div className="bg-[#EFECE3] border-b border-[#E0DBCF]
                px-4 py-2 flex items-center justify-between">
  <div className="flex items-center gap-1 font-serif text-sm
                  font-semibold text-[#2C2723]">
    <Sparkles className="w-4 h-4 text-[#C35E37]" />
    <span>English AI · P0</span>
  </div>

  <div className="flex items-center gap-2">
    {/* Navigation buttons */}
  </div>
</div>
```

### 3.6 状态横幅（Banner）

#### 信息横幅

```tsx
<div className="bg-[#E0F2FE] border-b border-[#BAE6FD]
                text-center text-xs text-[#075985] py-2
                font-medium px-3">
  信息提示内容
</div>
```

#### 警告横幅

```tsx
<div className="bg-[#FEF3C7] border-b border-[#FDE68A]
                text-center text-xs text-[#92400E] py-2
                font-medium">
  警告内容
</div>
```

#### 错误横幅

```tsx
<div className="bg-[#FEE2E2] border-b border-[#FECACA]
                text-center text-xs text-[#991B1B] py-2
                font-medium px-3">
  错误信息
</div>
```

### 3.7 徽章（Badge）

```tsx
{/* Status Badge */}
<span className="inline-flex items-center px-2.5 py-0.5
                 rounded-full text-xs font-medium
                 bg-[#D1FAE5] text-[#065F46]">
  Completed
</span>

{/* Count Badge */}
<span className="inline-flex items-center justify-center
                 w-5 h-5 rounded-full text-xs font-semibold
                 bg-[#C35E37] text-white">
  5
</span>
```

### 3.8 加载状态（Loading）

#### Spinner

```tsx
<div className="inline-block w-4 h-4 border-2 border-[#E3DDD1]
                border-t-[#C35E37] rounded-full animate-spin" />
```

#### 骨架屏

```tsx
<div className="animate-pulse">
  <div className="h-4 bg-[#E3DDD1] rounded w-3/4 mb-2" />
  <div className="h-4 bg-[#E3DDD1] rounded w-1/2" />
</div>
```


---

## 4. 页面布局规范

### 4.1 通用布局结构

```tsx
<div className="min-h-screen bg-[#F8F6F0] text-[#2B2723]
                font-sans flex flex-col">
  {/* 顶部导航栏 */}
  <header className="bg-[#EFECE3] border-b border-[#E0DBCF]">
    {/* Navigation */}
  </header>

  {/* 状态横幅（可选） */}
  {banner && (
    <div className="status-banner">
      {/* Banner content */}
    </div>
  )}

  {/* 主内容区 */}
  <main className="flex-1">
    {/* Page content */}
  </main>

  {/* 底部固定元素（可选） */}
  {footer && (
    <footer className="fixed bottom-0 left-0 right-0">
      {/* Footer content */}
    </footer>
  )}
</div>
```

### 4.2 响应式断点

```css
/* Mobile First */
@media (min-width: 640px)  { /* sm */ }
@media (min-width: 768px)  { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

### 4.3 容器规范

```tsx
/* 窄容器 - 表单、对话框 */
<div className="max-w-md mx-auto px-4">

/* 中等容器 - 文章内容 */
<div className="max-w-2xl mx-auto px-4">

/* 宽容器 - 列表、卡片网格 */
<div className="max-w-4xl mx-auto px-4">

/* 全宽容器 - 阅读页面 */
<div className="max-w-6xl mx-auto px-4">
```

---

## 5. 页面设计规范

### 5.1 P1 - 文章获取页（HomeScreen）

#### 布局要点
- 顶部横幅：待复习词数 + 快捷复习按钮
- 居中大卡片：品牌标题 + 4个入口按钮（2×2网格）
- 右下角浮动按钮：进入学习报告

#### 入口按钮层级
1. **主要入口**：Recommend for Me（橙色强调）
2. **常规入口**：Enter Article、Pick from Library、Oral Practice（次要按钮样式）

#### 代码示例

```tsx
<div className="min-h-screen bg-[#F8F6F0] flex flex-col">
  {/* 顶部横幅 */}
  <div className="w-full text-center py-3 px-4 bg-[#F1ECE1]
                  border-b border-[#E5DFD1] text-sm">
    <span>{pendingReviewCount} words ready for review</span>
    <button className="ml-2 text-xs font-semibold text-[#C35E37]
                       underline">
      Review Now
    </button>
  </div>

  {/* 主内容区 */}
  <div className="flex-1 flex items-center justify-center p-6">
    <div className="w-full max-w-xl bg-[#FAF8F3] border border-[#E3DDD1]
                    rounded-2xl p-12 shadow-sm text-center">
      <h1 className="font-serif text-5xl font-normal text-[#2A2622]
                     mb-2 tracking-tight">
        English AI
      </h1>
      <p className="text-sm text-[#8C8478] mb-8">
        P1 文章获取 · 以文章为核心开始学习
      </p>

      {/* 4 个入口按钮 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Enter Article */}
        <button className="flex flex-col items-center justify-center
                           gap-1 px-5 py-4 bg-[#FAF8F3] hover:bg-[#F2ECE0]
                           border border-[#DCD5C7] rounded-xl">
          <span className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#5C544B]" />
            <span>Enter Article</span>
          </span>
          <span className="text-xs text-[#8C8478]">输入 / 粘贴文章</span>
        </button>

        {/* Pick from Library */}
        <button className="flex flex-col items-center justify-center
                           gap-1 px-5 py-4 bg-[#FAF8F3] hover:bg-[#F2ECE0]
                           border border-[#DCD5C7] rounded-xl">
          <span className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#5C544B]" />
            <span>Pick from Library</span>
          </span>
          <span className="text-xs text-[#8C8478]">从文章库选</span>
        </button>

        {/* Recommend for Me - 主要操作 */}
        <button className="flex flex-col items-center justify-center
                           gap-1 px-5 py-4 bg-[#C35E37] hover:bg-[#A94E2B]
                           text-white rounded-xl shadow-xs">
          <span className="flex items-center gap-2">
            <Star className="w-5 h-5" />
            <span>Recommend for Me</span>
          </span>
          <span className="text-xs text-white/80">AI 为我推荐</span>
        </button>

        {/* Oral Practice */}
        <button className="flex flex-col items-center justify-center
                           gap-1 px-5 py-4 bg-[#FAF8F3] hover:bg-[#F2ECE0]
                           border border-[#DCD5C7] rounded-xl">
          <span className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-[#5C544B]" />
            <span>Oral Practice</span>
          </span>
          <span className="text-xs text-[#8C8478]">纯口语陪练</span>
        </button>
      </div>
    </div>
  </div>

  {/* 浮动统计按钮 */}
  <div className="absolute bottom-8 right-8">
    <button className="p-3.5 bg-[#FAF8F3] hover:bg-[#F0EAE0]
                       border border-[#D8D1C3] rounded-xl shadow-xs">
      <BarChart3 className="w-6 h-6" />
    </button>
  </div>
</div>
```

### 5.2 P2 - 文章学习页（ReadingScreen）

#### 核心功能
- 文章正文显示（段落分隔）
- 点词查询（选中弹出操作栏）
- 翻译功能（段落翻译 / 选区翻译）
- 底部讨论区（AI对话）
- 顶部操作栏（返回、菜单、完成）

#### 布局结构

```tsx
<div className="min-h-screen bg-[#F8F6F0] flex flex-col">
  {/* 顶部操作栏 */}
  <header className="sticky top-0 bg-[#FAF8F3] border-b border-[#E3DDD1]
                     px-4 py-3 flex items-center justify-between z-10">
    <button className="p-2 hover:bg-[#EFECE3] rounded-lg">
      <ArrowLeft className="w-5 h-5" />
    </button>
    <h2 className="font-serif text-lg font-semibold text-[#2A2622]
                   flex-1 text-center mx-4 truncate">
      {article.title}
    </h2>
    <button className="p-2 hover:bg-[#EFECE3] rounded-lg">
      <MoreHorizontal className="w-5 h-5" />
    </button>
  </header>

  {/* 文章内容区 */}
  <main className="flex-1 overflow-y-auto">
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* 文章元信息 */}
      <div className="mb-6 text-sm text-[#8C8478]">
        <span>{article.date}</span>
        <span className="mx-2">•</span>
        <span>{article.level}</span>
      </div>

      {/* 文章段落 */}
      {article.content.map((paragraph, index) => (
        <div key={index} className="mb-6">
          <p className="text-[#2B2723] leading-relaxed text-base
                        selection:bg-[#FDE68A]">
            {paragraph}
          </p>

          {/* 段落翻译（可选显示） */}
          {showTranslations && article.paragraphTranslations?.[index] && (
            <p className="mt-2 text-sm text-[#8C8478] italic border-l-2
                          border-[#E3DDD1] pl-3">
              {article.paragraphTranslations[index]}
            </p>
          )}
        </div>
      ))}
    </div>
  </main>

  {/* 底部讨论区（固定） */}
  <footer className="sticky bottom-0 bg-[#FAF8F3] border-t border-[#E3DDD1]
                     p-4">
    <div className="max-w-3xl mx-auto flex gap-3">
      <input
        type="text"
        placeholder="Ask anything about this article..."
        className="flex-1 px-4 py-3 bg-white border border-[#DCD5C7]
                   rounded-xl focus:ring-2 focus:ring-[#C35E37]"
      />
      <button className="px-5 py-3 bg-[#C35E37] hover:bg-[#A94E2B]
                         text-white rounded-xl">
        <Send className="w-5 h-5" />
      </button>
    </div>
  </footer>
</div>
```

#### 选词操作栏（浮动）

```tsx
{/* 选词后弹出的操作栏 - 紧贴选中文本上方 */}
<div className="fixed z-50 flex items-center gap-2 bg-white
                border border-[#DCD5C7] rounded-xl shadow-lg px-3 py-2"
     style={{ left: popoverPos.x, top: popoverPos.y }}>
  <button className="p-2 hover:bg-[#F2ECE0] rounded-lg" title="Explain">
    <BookOpen className="w-4 h-4 text-[#5C544B]" />
  </button>
  <button className="p-2 hover:bg-[#F2ECE0] rounded-lg" title="Translate">
    <Globe className="w-4 h-4 text-[#5C544B]" />
  </button>
  <button className="p-2 hover:bg-[#F2ECE0] rounded-lg" title="Speak">
    <Volume2 className="w-4 h-4 text-[#5C544B]" />
  </button>
  <button className="p-2 hover:bg-[#F2ECE0] rounded-lg" title="Add to Review">
    <BookmarkPlus className="w-4 h-4 text-[#5C544B]" />
  </button>
</div>
```


### 5.3 P3 - 学习报告页（MyLearningScreen）

#### 核心内容
- 学习统计卡片（完成文章数、掌握词数、连续天数）
- 薄弱点雷达图
- 文章进度列表
- 针对性复习入口

### 5.4 P4 - 历史记录页（HistoryScreen）

#### 核心功能
- 显示用户已读文章列表
- 按时间倒序排列
- 点击可重新打开文章

### 5.5 Library - 文章库页面（LibraryScreen）

#### 核心功能
- 按 CEFR 等级筛选
- 显示系统文章库 + 用户导入文章
- 支持按话题/来源分类

---

## 6. 交互模式

### 6.1 点词查询交互

1. 用户选中文本
2. 弹出浮动操作栏（紧贴选中文本上方）
3. 提供操作：Explain / Translate / Speak / Add to Review
4. 点击操作后，显示抽屉式详情面板
5. 抽屉可关闭，返回文章阅读

### 6.2 推荐流模式

1. 用户触发「Recommend for Me」或「Targeted Review」
2. 显示加载横幅（最多等待15秒）
3. 加载完成后自动进入文章阅读
4. 阅读完成后，自动加载下一篇推荐（连续阅读）
5. 无更多文章时，显示结束页面

### 6.3 讨论区交互

1. 底部固定输入框始终可见
2. 用户输入问题后发送
3. 显示加载状态
4. AI 回复以对话气泡形式追加
5. 支持多轮对话，保持上下文

### 6.4 导入文章流程

1. 打开「Enter Article」模态框
2. 用户粘贴文本或输入话题
3. 点击确认后，文章立即存储并打开
4. 后台异步处理：逐段翻译 + CEFR 评级
5. 处理完成后，横幅消失，翻译可用

---

## 7. 状态反馈

### 7.1 加载状态

- Spinner 动画用于按钮和页面加载
- 骨架屏用于内容加载占位

### 7.2 空状态

- 图标 + 标题 + 描述 + 操作按钮
- 居中显示，给予用户明确指引

### 7.3 错误状态

- 红色背景横幅或卡片
- 包含错误信息和可能的解决方案

### 7.4 成功反馈

- Toast 通知（右下角）
- 自动消失或可手动关闭

---

## 8. 动画与过渡

### 8.1 标准过渡

```css
transition-all duration-200 ease-in-out
```

### 8.2 悬停效果

```css
/* 卡片悬停 */
hover:shadow-md hover:border-[#C35E37]

/* 按钮悬停 */
hover:bg-[#A94E2B]
```

---

## 9. 可访问性（A11y）

### 9.1 颜色对比度

所有文本与背景的对比度符合 WCAG AA 标准：
- 主文本：4.5:1 以上
- 大文本：3:1 以上

### 9.2 键盘导航

- 所有交互元素可通过 Tab 键访问
- 模态框打开时，焦点自动移至内部
- Esc 键关闭模态框和抽屉

### 9.3 语义化 HTML

使用正确的语义化标签：article、nav、main、button、header

### 9.4 ARIA 属性

为图标按钮添加 aria-label，为动态内容添加 aria-live

---

## 10. 开发指南

### 10.1 组件开发原则

1. **单一职责**：每个组件只做一件事
2. **可组合**：通过组合小组件构建复杂UI
3. **Props 优先**：通过 props 传递数据和回调
4. **受控组件**：表单输入使用受控模式

### 10.2 样式规范

#### 使用 Tailwind CSS

```tsx
// ✅ 推荐：使用 Tailwind 类名
<button className="px-5 py-4 bg-[#C35E37] hover:bg-[#A94E2B]
                   text-white rounded-xl">
  Click Me
</button>

// ❌ 避免：内联样式
<button style={{ padding: '16px 20px', backgroundColor: '#C35E37' }}>
  Click Me
</button>
```

#### 保持类名一致

```tsx
// ✅ 推荐：复用相同的类名组合
const buttonPrimary = "px-5 py-4 bg-[#C35E37] hover:bg-[#A94E2B] text-white rounded-xl"

// ❌ 避免：每次手写类名
<button className="px-5 py-4 bg-[#C35E37] ...">
```

#### 响应式优先

```tsx
// Mobile First - 默认移动端样式
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
```

### 10.3 状态管理

#### 本地状态（useState）

```tsx
// 组件内部状态
const [isOpen, setIsOpen] = useState(false)
```

#### 持久化状态（usePersistentState）

```tsx
// 需要保存到 localStorage 的状态
const [history, setHistory] = usePersistentState<Article[]>(
  STORAGE_KEYS.history,
  []
)
```

#### Memory V2 状态（Hooks）

```tsx
// 词汇学习相关状态
const { dueWords, loading } = useDueWords()
const { stats } = useProficiencyStats()
const { proficiencies } = useAllWordProficiency()
```

### 10.4 事件处理

#### 命名规范

```tsx
// ✅ 推荐：on + 动词
onWordClick
onArticleComplete
onAddReviewWord

// ❌ 避免：不清晰的命名
handleClick
doSomething
```

#### 事件回调

```tsx
// Props 接口
interface ReadingScreenProps {
  onWordClick?: (word: string) => void
  onArticleComplete?: (articleId: string) => void
}

// 使用
const handleWordClick = (word: string) => {
  onWordClick?.(word)  // 可选调用
}
```

### 10.5 TypeScript 规范

#### 类型定义

```tsx
// ✅ 推荐：使用 interface 定义 Props
interface ButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary'
  onClick?: () => void
  disabled?: boolean
}

// 使用
export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  onClick,
  disabled = false
}) => {
  // ...
}
```

#### 避免 any

```tsx
// ❌ 避免
const handleData = (data: any) => { }

// ✅ 推荐
const handleData = (data: Article) => { }
```

### 10.6 性能优化

#### useMemo / useCallback

```tsx
// 计算密集型操作
const dueLemmas = useMemo(
  () => dueWords.map(w => w.wordId),
  [dueWords]
)

// 稳定的回调引用
const handleClick = useCallback(() => {
  // ...
}, [dependencies])
```

#### 条件渲染

```tsx
// ✅ 推荐：提前返回
if (loading) return <LoadingSpinner />
if (error) return <ErrorMessage />

return <MainContent />

// ❌ 避免：嵌套三元表达式
return loading ? <Loading /> : error ? <Error /> : <Content />
```

### 10.7 图标使用

#### lucide-react 图标库

```tsx
import {
  ArrowLeft,
  BookOpen,
  Star,
  Mic
} from 'lucide-react'

// 使用
<BookOpen className="w-5 h-5 text-[#5C544B]" />
```

#### 图标尺寸标准

```tsx
w-4 h-4   // 16px - 小图标（导航栏）
w-5 h-5   // 20px - 中图标（按钮）
w-6 h-6   // 24px - 大图标（卡片标题）
```

---

## 11. 测试指南

### 11.1 组件测试

- 测试核心交互流程
- 测试边界情况（空状态、错误状态）
- 测试可访问性

### 11.2 视觉回归测试

- 对比设计稿
- 检查不同屏幕尺寸
- 测试暗色模式（未来）

---

## 12. 设计资源

### 12.1 设计工具

- **Figma**：UI 设计和原型
- **Tailwind CSS**：CSS 框架
- **lucide-react**：图标库

### 12.2 参考资料

- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [React 文档](https://react.dev/)
- [WCAG 可访问性指南](https://www.w3.org/WAI/WCAG21/quickref/)

---

## 13. 版本历史

### v1.0 (2026-07-24)
- 初始版本
- 建立完整设计系统
- 覆盖 P1-P4 页面规范
- 定义组件库和交互模式

---

## 14. 维护与更新

### 14.1 设计系统演进

本文档应随产品发展持续更新：
- 新增组件时，更新组件库章节
- 设计调整时，更新色彩/排版系统
- 新增交互模式时，更新交互章节

### 14.2 反馈渠道

设计系统问题和建议请通过以下方式反馈：
- 项目 Issue
- 设计评审会议
- 开发团队内部讨论

---

**文档结束**
