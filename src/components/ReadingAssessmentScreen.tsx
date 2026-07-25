import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BAND_ORDER,
  EXAM_OPTIONS,
  clampBand,
  createExam,
  inferBand as inferBandWeighted,
  type CefrBand,
  type ExamRecord,
  type Inference,
} from "../lib/readingAssessment/assessment-engine";
import { createRandomTestSession } from "../lib/readingAssessment/test-session";
import {
  TEST_PACKS as PACK_LIBRARY,
  type QuestionType,
  type TestPack,
} from "../lib/readingAssessment/test-packs";
import {
  getDictionaryChineseMeaning,
  getDictionaryEnglishDefinition,
  lookupDictionaryWord,
  type DictionaryEntry,
} from "../lib/dictionaryClient";
import "./readingAssessment.css";

type Stage =
  | "questionnaire"
  | "routing"
  | "reading"
  | "questions"
  | "result";

type SelectedWord = {
  tokenId: string;
  word: string;
  definition: string;
  alignment: "left" | "center" | "right";
  status: "loading" | "ready" | "missing" | "error";
  dictionaryEntry?: DictionaryEntry;
};

export type ReadingAssessmentResult = {
  recommendedBand: CefrBand;
  inferredBand: CefrBand;
  totalCorrect: number;
  adjustment: "down" | "same" | "up";
  completedAt: string;
};

export type ReadingAssessmentScreenProps = {
  onBack: () => void;
  /** Called when the user finishes the reading check and reaches the result stage. */
  onComplete?: (result: ReadingAssessmentResult) => void;
  /** Persist-linked previous test result from the main app. */
  previousResult?: ReadingAssessmentResult | null;
  /** Jump into app recommendation feed using the recommended CEFR band. */
  onStartRecommendedReading?: (band: CefrBand) => void;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function splitWords(text: string) {
  return text.split(/([\p{L}]+(?:[’'-][\p{L}]+)*)/gu).filter(Boolean);
}

export const ReadingAssessmentScreen: React.FC<ReadingAssessmentScreenProps> = ({
  onBack,
  onComplete,
  previousResult = null,
  onStartRecommendedReading,
}) => {
  const [stage, setStage] = useState<Stage>("questionnaire");
  const [educationStage, setEducationStage] = useState("university");
  const [selfLevel, setSelfLevel] = useState("general");
  const [goal, setGoal] = useState("originals");
  const [exams, setExams] = useState<ExamRecord[]>([createExam()]);
  const [inference, setInference] = useState<Inference | null>(null);
  const [activeTest, setActiveTest] = useState<TestPack | null>(null);
  const [attempt, setAttempt] = useState(1);
  const [clickedTokens, setClickedTokens] = useState<Record<string, number>>({});
  const [selectedWord, setSelectedWord] = useState<SelectedWord | null>(null);
  const [readingElapsed, setReadingElapsed] = useState(0);
  const [questionElapsed, setQuestionElapsed] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const completedReportedRef = useRef(false);
  const dictionaryLookupRef = useRef<AbortController | null>(null);
  const dictionaryRequestIdRef = useRef(0);

  const totalWords = useMemo(() => {
    if (!activeTest) return 0;
    return activeTest.paragraphs
      .join(" ")
      .split(/\s+/)
      .filter((word) => /[A-Za-z]/.test(word)).length;
  }, [activeTest]);

  useEffect(() => {
    if (stage !== "reading" && stage !== "questions") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        if (stage === "reading") {
          setReadingElapsed((current) => current + 1);
        } else {
          setQuestionElapsed((current) => current + 1);
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    return () => {
      dictionaryRequestIdRef.current += 1;
      dictionaryLookupRef.current?.abort();
    };
  }, []);

  function cancelDictionaryLookup() {
    dictionaryRequestIdRef.current += 1;
    dictionaryLookupRef.current?.abort();
    dictionaryLookupRef.current = null;
  }

  function updateExam(id: string, field: keyof ExamRecord, value: string) {
    setExams((current) =>
      current.map((exam) => (exam.id === id ? { ...exam, [field]: value } : exam)),
    );
  }

  function applyPreset(preset: CefrBand) {
    const base = createExam();
    const presets: Record<
      CefrBand,
      { stage: string; self: string; exam: Partial<ExamRecord> }
    > = {
      A1: {
        stage: "middle_school",
        self: "difficult",
        exam: { examType: "ZHONGKAO", overallScore: "55", maxScore: "120" },
      },
      A2: {
        stage: "high_school",
        self: "difficult",
        exam: { examType: "GAOKAO", overallScore: "85", maxScore: "150" },
      },
      B1: {
        stage: "university",
        self: "general",
        exam: { examType: "CET4", overallScore: "480", readingScore: "170" },
      },
      B2: {
        stage: "university",
        self: "general",
        exam: { examType: "CET6", overallScore: "510", readingScore: "188" },
      },
      C1: {
        stage: "graduated",
        self: "experienced",
        exam: { examType: "TEM8", overallScore: "72" },
      },
      C2: {
        stage: "graduated",
        self: "experienced",
        exam: { examType: "C2_PROFICIENCY", overallScore: "210" },
      },
    };
    const selected = presets[preset];
    setEducationStage(selected.stage);
    setSelfLevel(selected.self);
    setExams([{ ...base, ...selected.exam }]);
  }

  function submitQuestionnaire(event: React.FormEvent) {
    event.preventDefault();
    const result = inferBandWeighted(exams, selfLevel, educationStage);
    setInference(result);
    setActiveTest(createRandomTestSession(PACK_LIBRARY[result.band]));
    setAttempt(1);
    setReadingElapsed(0);
    setQuestionElapsed(0);
    setStage("routing");
    window.setTimeout(() => {
      setStage("reading");
    }, 1050);
  }

  function clickWord(
    word: string,
    tokenId: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    if (!activeTest) return;
    event.stopPropagation();
    const normalized = word.toLowerCase().replace(/[’']/g, "'");
    const bounds = event.currentTarget.getBoundingClientRect();
    const alignment =
      bounds.left < 170
        ? "left"
        : window.innerWidth - bounds.right < 170
          ? "right"
          : "center";
    const fallbackDefinition = activeTest.definitions[normalized] ?? "词典未找到该词条。";
    const isSameWord = selectedWord?.tokenId === tokenId;
    setClickedTokens((current) => ({
      ...current,
      [tokenId]: (current[tokenId] ?? 0) + 1,
    }));

    cancelDictionaryLookup();
    const requestId = dictionaryRequestIdRef.current;
    if (isSameWord) {
      setSelectedWord(null);
      return;
    }

    const controller = new AbortController();
    dictionaryLookupRef.current = controller;
    setSelectedWord({
      tokenId,
      word,
      definition: fallbackDefinition,
      alignment,
      status: "loading",
    });

    void lookupDictionaryWord(word, { signal: controller.signal }).then(
      (entry) => {
        if (dictionaryRequestIdRef.current !== requestId) return;
        setSelectedWord((current) => {
          if (current?.tokenId !== tokenId) return current;
          return {
            ...current,
            status: entry ? "ready" : "missing",
            definition: entry
              ? getDictionaryChineseMeaning(entry) || getDictionaryEnglishDefinition(entry)
              : fallbackDefinition,
            dictionaryEntry: entry ?? undefined,
          };
        });
      },
      (error: unknown) => {
        if (
          error instanceof Error &&
          (error.name === "AbortError" || /abort|cancel/i.test(error.message))
        ) {
          return;
        }
        if (dictionaryRequestIdRef.current !== requestId) return;
        setSelectedWord((current) => {
          if (current?.tokenId !== tokenId) return current;
          return { ...current, status: "error", definition: fallbackDefinition };
        });
      },
    );
  }

  function restart() {
    completedReportedRef.current = false;
    cancelDictionaryLookup();
    setStage("questionnaire");
    setInference(null);
    setClickedTokens({});
    setSelectedWord(null);
    setReadingElapsed(0);
    setQuestionElapsed(0);
    setAnswers({});
    setActiveTest(null);
    setAttempt(1);
  }

  function startValidationPack() {
    if (!inference) return;
    cancelDictionaryLookup();
    setActiveTest(
      createRandomTestSession(
        PACK_LIBRARY[inference.band],
        Math.random,
        activeTest?.id,
      ),
    );
    setAttempt(2);
    setClickedTokens({});
    setSelectedWord(null);
    setReadingElapsed(0);
    setQuestionElapsed(0);
    setAnswers({});
    setStage("reading");
  }

  function moveBetweenReadingAndQuestions(nextStage: "reading" | "questions") {
    cancelDictionaryLookup();
    setSelectedWord(null);
    setStage(nextStage);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const answeredAll = activeTest
    ? activeTest.questions.every((question) => answers[question.id] !== undefined)
    : false;
  const answeredCount = activeTest
    ? activeTest.questions.filter((question) => answers[question.id] !== undefined)
        .length
    : 0;

  const result = useMemo(() => {
    if (!activeTest || stage !== "result") return null;
    const grouped: Record<QuestionType, { correct: number; total: number }> = {
      vocabulary: { correct: 0, total: 0 },
      sentence: { correct: 0, total: 0 },
      discourse: { correct: 0, total: 0 },
    };
    let totalCorrect = 0;
    activeTest.questions.forEach((question) => {
      grouped[question.type].total += 1;
      if (answers[question.id] === question.correct) {
        grouped[question.type].correct += 1;
        totalCorrect += 1;
      }
    });
    const uniqueClicks = Object.keys(clickedTokens).length;
    const lookupFrequency = totalWords ? (uniqueClicks / totalWords) * 100 : 0;
    const comprehensionCorrect = grouped.sentence.correct + grouped.discourse.correct;
    let adjustment: "down" | "same" | "up" = "same";
    if (
      totalCorrect >= 5 &&
      grouped.vocabulary.correct >= 1 &&
      grouped.sentence.correct >= 1 &&
      grouped.discourse.correct >= 1 &&
      lookupFrequency <= 3
    ) {
      adjustment = "up";
    } else if (
      totalCorrect <= 2 ||
      comprehensionCorrect <= 1 ||
      lookupFrequency >= 8
    ) {
      adjustment = "down";
    }
    const currentIndex = BAND_ORDER.indexOf(activeTest.band);
    const recommended = clampBand(
      currentIndex + (adjustment === "up" ? 1 : adjustment === "down" ? -1 : 0),
    );
    const wpm =
      readingElapsed > 0
        ? Math.round((totalWords / readingElapsed) * 60)
        : 0;
    const wpmValid = comprehensionCorrect >= 3;

    return {
      grouped,
      totalCorrect,
      uniqueClicks,
      lookupFrequency,
      adjustment,
      recommended,
      wpm,
      wpmValid,
    };
  }, [activeTest, answers, clickedTokens, readingElapsed, stage, totalWords]);

  const progressStep =
    stage === "questionnaire" || stage === "routing"
      ? 1
      : stage === "reading" || stage === "questions"
        ? 2
        : 3;

  useEffect(() => {
    if (stage !== "result" || !result || !inference || completedReportedRef.current) return;
    completedReportedRef.current = true;
    onComplete?.({
      recommendedBand: result.recommended,
      inferredBand: inference.band,
      totalCorrect: result.totalCorrect,
      adjustment: result.adjustment,
      completedAt: new Date().toISOString(),
    });
  }, [stage, result, inference, onComplete]);



  return (
    <div className="reading-assessment">
      <main className="app-shell">
        <header className="site-header">
          <button className="brand" onClick={restart} aria-label="回到测试首页">
            <span className="brand-mark">i+1</span>
            <span className="brand-title">
              <strong>CEFR 阅读能力评测</strong>
              <small>English Reading Assessment</small>
            </span>
          </button>
          <div className="header-actions">
            <span className="ai-badge">AI 智能评估</span>
            <button type="button" className="nav-back-button" onClick={onBack}>
              ✕ 返回应用
            </button>
          </div>
        </header>

        <nav className="progress-nav" aria-label="测试进度">
          {[
            ["01", "基础自评"],
            ["02", "阅读实测"],
            ["03", "能力报告"],
          ].map(([number, label], index) => (
            <div
              key={number}
              className={`progress-step ${progressStep >= index + 1 ? "active" : ""} ${
                progressStep === index + 1 ? "current" : ""
              }`}
            >
              <span className="step-num">{number}</span>
              <span className="step-label">{label}</span>
            </div>
          ))}
        </nav>

        {stage === "questionnaire" && (
          <section className="questionnaire-container">
            <div className="hero-banner">
              <div className="hero-badge">READING LEVEL PLACEMENT</div>
              <h1>
                精准找到你的阅读起点，<br />
                让每一篇英文都<span>读得刚刚好</span>。
              </h1>
              <p className="hero-desc">
                结合学习阶段与历史考试成绩进行初始匹配，通过真实语篇阅读与多维理解测试精准校准，帮助系统为你推荐难度适宜的最佳读物。
              </p>
              <div className="feature-chips">
                <div className="chip-item">
                  <strong>6 大级别</strong>
                  <span>CEFR A1 ~ C2 覆盖</span>
                </div>
                <div className="chip-item">
                  <strong>语篇实测</strong>
                  <span>词汇/句子/语篇三维校验</span>
                </div>
                <div className="chip-item">
                  <strong>~5 分钟</strong>
                  <span>无负担快速评估</span>
                </div>
              </div>

              {previousResult && (
                <div className="previous-result-hint">
                  <span className="check-icon">✓</span>
                  <div>
                    <span>当前应用阅读等级：<strong>{previousResult.recommendedBand}</strong></span>
                    <small>重新测试可随时更新推荐难度与改写目标</small>
                  </div>
                </div>
              )}
            </div>

            <form className="form-card" onSubmit={submitQuestionnaire}>
              <div className="form-header">
                <div>
                  <span className="step-tag">STEP 01</span>
                  <h2>填写阅读背景</h2>
                </div>
                <span className="time-estimate">⏱ 约 1 分钟</span>
              </div>

              <div className="preset-bar">
                <span className="preset-label">⚡ 快速预设：</span>
                <div className="preset-buttons">
                  {BAND_ORDER.map((band) => (
                    <button
                      type="button"
                      key={band}
                      className="preset-btn"
                      onClick={() => applyPreset(band)}
                    >
                      {band}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-grid two">
                <label className="field-group">
                  <span className="field-label">当前学习/工作阶段</span>
                  <select
                    className="select-input"
                    value={educationStage}
                    onChange={(event) => setEducationStage(event.target.value)}
                  >
                    <option value="middle_school">初中阶段</option>
                    <option value="high_school">高中阶段</option>
                    <option value="university">大学阶段</option>
                    <option value="graduated">职场 / 已毕业</option>
                    <option value="other">其他阶段</option>
                  </select>
                </label>

                <label className="field-group">
                  <span className="field-label">主要阅读目标</span>
                  <select
                    className="select-input"
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                  >
                    <option value="originals">阅读英文原著 / 刊物</option>
                    <option value="exam">备考各类英语考试</option>
                    <option value="knowledge">获取专业/前沿知识</option>
                    <option value="daily">日常兴趣与综合提升</option>
                  </select>
                </label>
              </div>

              <fieldset className="self-level-section">
                <legend className="field-label">你目前的英文阅读体验更接近哪种状态？</legend>
                <div className="choice-cards">
                  {[
                    ["difficult", "基础起步", "读简单英文也比较吃力，依赖查词翻译"],
                    ["general", "进阶提升", "能顺畅阅读一般文章，遇到长难句会卡住"],
                    ["experienced", "熟练阅读", "有持续阅读原著经验，能流畅处理复杂文本"],
                  ].map(([value, title, description]) => (
                    <label
                      key={value}
                      className={`choice-card ${selfLevel === value ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="selfLevel"
                        value={value}
                        checked={selfLevel === value}
                        onChange={(event) => setSelfLevel(event.target.value)}
                      />
                      <span className="radio-dot" />
                      <div className="choice-info">
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="exam-section">
                <div className="exam-header">
                  <div>
                    <h3>已有英语考试成绩（可选）</h3>
                    <p>填入已有成绩可提高初始匹配精度；没有可直接跳过。</p>
                  </div>
                  <button
                    className="add-exam-btn"
                    type="button"
                    onClick={() => setExams((current) => [...current, createExam()])}
                  >
                    ＋ 添加成绩
                  </button>
                </div>

                {exams.length === 0 && (
                  <button
                    className="empty-exams-placeholder"
                    type="button"
                    onClick={() => setExams([createExam()])}
                  >
                    <span>＋</span>
                    点击添加一条考试成绩（如高考、四六级、雅思、托福）
                  </button>
                )}

                <div className="exam-list">
                  {exams.map((exam, index) => {
                    const needsMax =
                      exam.examType === "GAOKAO" ||
                      exam.examType === "ZHONGKAO" ||
                      exam.examType === "OTHER";
                    return (
                      <div className="exam-row-card" key={exam.id}>
                        <div className="exam-row-top">
                          <span className="exam-index">成绩 #{index + 1}</span>
                          <button
                            className="remove-exam-btn"
                            type="button"
                            aria-label={`删除第 ${index + 1} 条成绩`}
                            onClick={() =>
                              setExams((current) =>
                                current.filter((item) => item.id !== exam.id),
                              )
                            }
                          >
                            ✕ 删除
                          </button>
                        </div>

                        <div className="exam-fields-grid">
                          <label className="compact-field">
                            <span>考试类别</span>
                            <select
                              value={exam.examType}
                              onChange={(event) =>
                                updateExam(exam.id, "examType", event.target.value)
                              }
                            >
                              {EXAM_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="compact-field">
                            <span>获得总分</span>
                            <input
                              type="number"
                              step="0.5"
                              placeholder="如 510"
                              value={exam.overallScore}
                              onChange={(event) =>
                                updateExam(exam.id, "overallScore", event.target.value)
                              }
                            />
                          </label>

                          <label className="compact-field">
                            <span>阅读单项分（选填）</span>
                            <input
                              type="number"
                              step="0.5"
                              placeholder="如 188"
                              value={exam.readingScore}
                              onChange={(event) =>
                                updateExam(exam.id, "readingScore", event.target.value)
                              }
                            />
                          </label>

                          {needsMax && (
                            <label className="compact-field">
                              <span>该考试满分</span>
                              <input
                                type="number"
                                placeholder="如 150"
                                value={exam.maxScore}
                                onChange={(event) =>
                                  updateExam(exam.id, "maxScore", event.target.value)
                                }
                              />
                            </label>
                          )}

                          {exam.examType === "TOEFL" && (
                            <label className="compact-field">
                              <span>计分版本</span>
                              <select
                                value={exam.scaleVersion}
                                onChange={(event) =>
                                  updateExam(exam.id, "scaleVersion", event.target.value)
                                }
                              >
                                <option value="0_120">0–120 分</option>
                                <option value="1_6">1–6 分</option>
                              </select>
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="form-footer">
                <p className="footer-notice">
                  <span>ⓘ</span>
                  系统将依据 CEFR 标准与自评结果为您生成实测语篇。
                </p>
                <button className="primary-action-button" type="submit">
                  进入阅读实测
                  <span className="arrow">→</span>
                </button>
              </div>
            </form>
          </section>
        )}

        {stage === "routing" && (
          <section className="state-card routing-card" aria-live="polite">
            <div className="loading-spinner">
              <div className="spinner-ring" />
              <strong className="spinner-symbol">CEFR</strong>
            </div>
            <span className="routing-tag">AI LEVEL ROUTING</span>
            <h2>正在为你生成测评套题...</h2>
            <p>结合自评等级与考试记录，精准匹配符合您阅读能力的实测语篇。</p>
          </section>
        )}

        {stage === "reading" && activeTest && inference && (
          <section className="reading-layout">
            <div className="reading-toolbar">
              <div className="toolbar-info">
                <span className="band-badge">CEFR {activeTest.band}</span>
                <span className="pack-version">{activeTest.version} 卷</span>
                <span className="meta-divider">·</span>
                <span className="meta-text">{totalWords} 词</span>
                <span className="meta-divider">·</span>
                <span className="meta-text">预计 {activeTest.readTime}</span>
              </div>

              <div className="toolbar-timer">
                <span>⏱ 阅读计时：</span>
                <strong>{formatTime(readingElapsed)}</strong>
              </div>

              <button
                className="start-questions-button"
                onClick={() => moveBetweenReadingAndQuestions("questions")}
              >
                {answeredCount > 0
                  ? `继续答题 (${answeredCount}/6)`
                  : "读完了，开始答题 →"}
              </button>
            </div>

            <article className="reading-article-card">
              <header className="article-header">
                <span className="passage-type">PASSAGE ASSESSMENT · NON-FICTION</span>
                <h1 className="article-title">{activeTest.title}</h1>
                <p className="article-dek">{activeTest.dek}</p>
                <div className="lookup-hint-bar">
                  <span className="hint-icon">💡</span>
                  <span>提示：遭遇生词可随时点击查阅释义，查词不扣分。已查阅 <strong>{Object.keys(clickedTokens).length}</strong> 个词位。</span>
                </div>
              </header>

              <div className="article-body" onClick={() => setSelectedWord(null)}>
                {activeTest.paragraphs.map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>
                    {splitWords(paragraph).map((token, tokenIndex) => {
                      const isWord = /^\p{L}/u.test(token);
                      const tokenId = `${paragraphIndex}-${tokenIndex}`;
                      return isWord ? (
                        <button
                          type="button"
                          className={`word-token ${clickedTokens[tokenId] ? "looked-up" : ""} ${
                            selectedWord?.tokenId === tokenId ? "active" : ""
                          }`}
                          key={tokenId}
                          aria-expanded={selectedWord?.tokenId === tokenId}
                          onClick={(event) => clickWord(token, tokenId, event)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setSelectedWord(null);
                          }}
                        >
                          {token}
                          {selectedWord?.tokenId === tokenId && (
                            <span
                              className={`word-popover align-${selectedWord.alignment}`}
                              role="tooltip"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <span className="word-popover-label">
                                {selectedWord.dictionaryEntry ? "本地词典释义" : "语境释义"}
                              </span>
                              {selectedWord.status === "loading" ? (
                                <span className="word-popover-status" role="status">
                                  正在查询词典…
                                </span>
                              ) : selectedWord.dictionaryEntry ? (
                                <>
                                  <strong className="popover-word">
                                    {selectedWord.dictionaryEntry.lemma || selectedWord.word}
                                  </strong>
                                  <span className="word-popover-meta">
                                    {[
                                      selectedWord.dictionaryEntry.phonetic,
                                      selectedWord.dictionaryEntry.partOfSpeech,
                                      selectedWord.dictionaryEntry.cefrLevel,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                  {getDictionaryChineseMeaning(selectedWord.dictionaryEntry) && (
                                    <span className="word-popover-meaning">
                                      {getDictionaryChineseMeaning(selectedWord.dictionaryEntry)}
                                    </span>
                                  )}
                                  {getDictionaryEnglishDefinition(selectedWord.dictionaryEntry) && (
                                    <span className="word-popover-english">
                                      {getDictionaryEnglishDefinition(selectedWord.dictionaryEntry)}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <strong className="popover-word">{selectedWord.word}</strong>
                                  <span className="word-popover-meaning">
                                    {selectedWord.definition}
                                  </span>
                                  {selectedWord.status === "error" && (
                                    <span className="word-popover-status">
                                      词典暂时不可用，已显示测评词表释义。
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span key={tokenId}>{token}</span>
                      );
                    })}
                  </p>
                ))}
              </div>

              <footer className="article-footer">
                <div className="footer-left">
                  <span>已累计阅读用时 <strong>{formatTime(readingElapsed)}</strong></span>
                </div>
                <button
                  className="primary-action-button"
                  onClick={() => moveBetweenReadingAndQuestions("questions")}
                >
                  {answeredCount > 0
                    ? `继续答题 (${answeredCount}/6)`
                    : "我已读完，进入答题 →"}
                </button>
              </footer>
            </article>
          </section>
        )}

        {stage === "questions" && activeTest && (
          <section className="questions-layout">
            <div className="questions-header-card">
              <div className="questions-header-top">
                <div>
                  <span className="band-badge">CEFR {activeTest.band}</span>
                  <h2>理解度测试（共 6 题）</h2>
                </div>
                <button
                  type="button"
                  className="back-to-reading-btn"
                  onClick={() => moveBetweenReadingAndQuestions("reading")}
                >
                  ← 查看原文
                </button>
              </div>

              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${(answeredCount / 6) * 100}%` }}
                />
              </div>

              <div className="questions-meta-row">
                <span>答题进度：<strong>{answeredCount} / 6</strong></span>
                <span>⏱ 答题用时：<strong>{formatTime(questionElapsed)}</strong></span>
              </div>
            </div>

            <div className="question-list">
              {activeTest.questions.map((question, questionIndex) => (
                <fieldset className="question-card" key={question.id}>
                  <legend className="question-card-header">
                    <span className="q-num">Q{questionIndex + 1}</span>
                    <span className="q-eyebrow">{question.eyebrow}</span>
                    <h3 className="q-prompt">{question.prompt}</h3>
                  </legend>
                  <div className="option-grid">
                    {question.options.map((option, optionIndex) => (
                      <label
                        className={`option-tile ${
                          answers[question.id] === optionIndex ? "selected" : ""
                        }`}
                        key={option}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          checked={answers[question.id] === optionIndex}
                          onChange={() =>
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: optionIndex,
                            }))
                          }
                        />
                        <span className="option-letter">
                          {String.fromCharCode(65 + optionIndex)}
                        </span>
                        <span className="option-text">{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}

              <div className="questions-submit-bar">
                <div className="submit-status-text">
                  {answeredAll ? (
                    <span className="status-ready">✓ 全部题目已完成，可提交查看报告</span>
                  ) : (
                    <span className="status-pending">还有 {6 - answeredCount} 道题未回答</span>
                  )}
                </div>
                <button
                  className="primary-action-button"
                  disabled={!answeredAll}
                  onClick={() => setStage("result")}
                >
                  提交测评，生成诊断报告 →
                </button>
              </div>
            </div>
          </section>
        )}

        {stage === "result" && activeTest && inference && result && (
          <section className="result-layout">
            <div className="result-hero-card">
              <div className="hero-left">
                <span className="hero-tag">CEFR ASSESSMENT REPORT</span>
                <h1>
                  你的推荐阅读起点：<span className="highlight-band">{result.recommended}</span>
                </h1>
                <p className="hero-summary">
                  初始背景匹配定位为 <strong>{inference.band}</strong>；综合阅读速度、生词依赖度与理解正确率，建议您从{' '}
                  <strong>{result.recommended}</strong> 级别的通俗原著与刊物切入阅读。
                </p>
              </div>

              <div className="level-badge-card">
                <span className="badge-label">推荐 CEFR 级别</span>
                <div className="badge-value">{result.recommended}</div>
                <div className="level-shift-tag">
                  {result.adjustment === "up"
                    ? "▲ 比初始预设提高一级"
                    : result.adjustment === "down"
                      ? "▼ 比初始预设调整降低一级"
                      : "▶ 与初始评估精准吻合"}
                </div>
              </div>
            </div>

            <div className="section-title">
              <h3>理解能力维度表现</h3>
            </div>

            <div className="metrics-grid">
              {[
                [
                  "语境词汇",
                  result.grouped.vocabulary.correct,
                  result.grouped.vocabulary.total,
                  "Vocabulary",
                ],
                [
                  "句子理解",
                  result.grouped.sentence.correct,
                  result.grouped.sentence.total,
                  "Sentence",
                ],
                [
                  "语篇理解",
                  result.grouped.discourse.correct,
                  result.grouped.discourse.total,
                  "Discourse",
                ],
              ].map(([label, correct, total, english]) => {
                const percent = Math.round((Number(correct) / Number(total)) * 100);
                return (
                  <article className="metric-card" key={String(label)}>
                    <div className="metric-card-header">
                      <span className="metric-en">{english}</span>
                      <strong className="metric-zh">{label}</strong>
                    </div>
                    <div className="metric-score-row">
                      <span className="score-percent">{percent}%</span>
                      <span className="score-fraction">
                        {correct} / {total} 正确
                      </span>
                    </div>
                    <div className="metric-bar-bg">
                      <div className="metric-bar-fill" style={{ width: `${percent}%` }} />
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="result-details-grid">
              <article className="detail-card">
                <div className="card-header">
                  <span className="card-tag">BEHAVIOR SIGNALS</span>
                  <h2>阅读行为数据</h2>
                </div>
                <div className="stats-list">
                  <div className="stat-item">
                    <span className="stat-label">查词词位数</span>
                    <strong className="stat-value">{result.uniqueClicks} <small>个</small></strong>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">每 100 词查词频率</span>
                    <strong className="stat-value">{result.lookupFrequency.toFixed(1)} <small>次</small></strong>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">估算阅读速度</span>
                    <strong className="stat-value">
                      {result.wpmValid ? `${result.wpm} WPM` : "理解率偏低暂未计速"}
                    </strong>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">阅读 / 答题用时</span>
                    <strong className="stat-value">
                      {formatTime(readingElapsed)} / {formatTime(questionElapsed)}
                    </strong>
                  </div>
                </div>
              </article>

              <article className="detail-card">
                <div className="card-header">
                  <span className="card-tag">RECOMMENDATION PARAMETERS</span>
                  <h2>推荐阅读参数</h2>
                </div>
                <ul className="params-list">
                  <li>
                    <span className="param-label">最佳阅读难度</span>
                    <strong className="param-value">{result.recommended} 通俗非虚构 / 刊物</strong>
                  </li>
                  <li>
                    <span className="param-label">推荐单篇长度</span>
                    <strong className="param-value">
                      {result.recommended === "C2"
                        ? "450–700"
                        : result.recommended === "C1"
                          ? "350–550"
                          : result.recommended === "B2"
                            ? "250–400"
                            : result.recommended === "B1"
                              ? "180–300"
                              : result.recommended === "A2"
                                ? "100–180"
                                : "60–120"}{" "}
                      词
                    </strong>
                  </li>
                  <li>
                    <span className="param-label">阅读辅助策略</span>
                    <strong className="param-value">开启点词即查 & CEFR 分级改写</strong>
                  </li>
                </ul>
              </article>
            </div>

            <div className="result-actions-bar">
              <p className="actions-hint">
                测评结果已同步保存至应用。系统将优先选用 <strong>{result.recommended}</strong> 为您算法推荐文库文章与智能改写。
              </p>
              <div className="buttons-group">
                {onStartRecommendedReading && (
                  <button
                    className="primary-action-button"
                    type="button"
                    onClick={() => onStartRecommendedReading(result.recommended)}
                  >
                    按 {result.recommended} 开始推荐阅读 →
                  </button>
                )}
                {attempt === 1 && result.adjustment === "same" && (
                  <button className="secondary-action-button" onClick={startValidationPack}>
                    抽取同级新卷复核 →
                  </button>
                )}
                <button className="secondary-action-button" onClick={restart}>
                  重新测试 ↻
                </button>
                <button className="secondary-action-button" type="button" onClick={onBack}>
                  返回主页
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
