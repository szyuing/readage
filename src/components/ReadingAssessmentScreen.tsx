import React, { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
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
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <button className="brand" onClick={restart} aria-label="回到测试首页">
          <span className="brand-mark">i+1</span>
          <span>
            <strong>英语测试</strong>
            <small>CEFR 阅读定级</small>
          </span>
        </button>
        <div className="header-note" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="live-dot" />
          <span>Rule-based MVP</span>
          <button type="button" className="text-button" onClick={onBack}>
            返回应用
          </button>
        </div>
      </header>

      <nav className="progress" aria-label="测试进度">
        {[
          ["01", "背景粗定位"],
          ["02", "阅读实测"],
          ["03", "推荐结果"],
        ].map(([number, label], index) => (
          <div
            key={number}
            className={`progress-item ${progressStep >= index + 1 ? "active" : ""}`}
          >
            <span>{number}</span>
            <p>{label}</p>
          </div>
        ))}
      </nav>

      {stage === "questionnaire" && (
        <section className="questionnaire-layout">
          <aside className="intro-panel">
            <div>
              <p className="kicker">Find your reading edge</p>
              <h1>
                先找到起点，
                <br />
                再读得<span>刚刚好</span>。
              </h1>
              <p className="intro-copy">
                用已有成绩和阅读自评选择起始套题，再用真实阅读表现校准。六个
                CEFR 档位均可完成实测。
              </p>
            </div>
            <div className="mini-legend">
              <div>
                <strong>6</strong>
                <span>CEFR 档位</span>
              </div>
              <div>
                <strong>30</strong>
                <span>固定套题</span>
              </div>
              <div>
                <strong>5–8</strong>
                <span>分钟完成</span>
              </div>
            </div>
            {previousResult && (
              <div className="click-hint" style={{ marginTop: 16 }}>
                <span>✓</span>
                <p>
                  应用当前等级 <strong>{previousResult.recommendedBand}</strong>
                  <br />
                  测试结果会同步到推荐、文库筛选与改写目标。
                </p>
              </div>
            )}
          </aside>

          <form className="form-card" onSubmit={submitQuestionnaire}>
            <div className="form-heading">
              <div>
                <p className="section-index">STEP 01</p>
                <h2>告诉我们你现在在哪里</h2>
              </div>
              <span className="required-note">约 1 分钟</span>
            </div>

            <div className="preset-strip">
              <span>现场演示：快速填入对应用户</span>
              <div>
                {BAND_ORDER.map((band) => (
                  <button type="button" key={band} onClick={() => applyPreset(band)}>
                    {band}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-grid two">
              <label className="field">
                <span>当前阶段</span>
                <select
                  value={educationStage}
                  onChange={(event) => setEducationStage(event.target.value)}
                >
                  <option value="middle_school">初中</option>
                  <option value="high_school">高中</option>
                  <option value="university">大学</option>
                  <option value="graduated">已毕业</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label className="field">
                <span>主要阅读目标</span>
                <select value={goal} onChange={(event) => setGoal(event.target.value)}>
                  <option value="exam">通过考试</option>
                  <option value="originals">阅读英文原著</option>
                  <option value="knowledge">获取专业知识</option>
                  <option value="daily">日常英语提升</option>
                </select>
              </label>
            </div>

            <fieldset className="self-level">
              <legend>你的英文阅读状态更接近哪一种？</legend>
              <div className="choice-cards">
                {[
                  ["difficult", "仍然吃力", "简单英文也常常需要翻译"],
                  ["general", "可以阅读", "能读一般文章，但偶尔卡住"],
                  ["experienced", "稳定阅读", "有持续阅读英文原著的经验"],
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
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="exam-section">
              <div className="exam-title">
                <div>
                  <h3>已有考试成绩</h3>
                  <p>有什么填什么；可以添加多条，也可以留空。</p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setExams((current) => [...current, createExam()])}
                >
                  ＋ 添加成绩
                </button>
              </div>

              {exams.length === 0 && (
                <button
                  className="empty-exams"
                  type="button"
                  onClick={() => setExams([createExam()])}
                >
                  <span>＋</span>
                  没有成绩也没关系，点击可添加
                </button>
              )}

              <div className="exam-list">
                {exams.map((exam, index) => {
                  const needsMax =
                    exam.examType === "GAOKAO" ||
                    exam.examType === "ZHONGKAO" ||
                    exam.examType === "OTHER";
                  return (
                    <div className="exam-row" key={exam.id}>
                      <span className="exam-number">{String(index + 1).padStart(2, "0")}</span>
                      <label className="compact-field exam-type">
                        <span>考试</span>
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
                        <span>总分</span>
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
                        <span>阅读分（可选）</span>
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
                          <span>满分</span>
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
                            <option value="0_120">0–120</option>
                            <option value="1_6">1–6</option>
                          </select>
                        </label>
                      )}
                      {(exam.examType === "GAOKAO" ||
                        exam.examType === "ZHONGKAO") && (
                        <label className="compact-field">
                          <span>考区 / 省份</span>
                          <input
                            type="text"
                            placeholder="如 上海"
                            value={exam.region}
                            onChange={(event) =>
                              updateExam(exam.id, "region", event.target.value)
                            }
                          />
                        </label>
                      )}
                      <label className="compact-field year">
                        <span>年份</span>
                        <input
                          type="number"
                          placeholder="2026"
                          value={exam.year}
                          onChange={(event) =>
                            updateExam(exam.id, "year", event.target.value)
                          }
                        />
                      </label>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`删除第 ${index + 1} 条成绩`}
                        onClick={() =>
                          setExams((current) =>
                            current.filter((item) => item.id !== exam.id),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="form-footer">
              <p>
                <span>ⓘ</span>
                MVP 使用固定本地规则选择起始测试，不接入 AI，也不构成正式 CEFR 认证。
              </p>
              <button className="primary-button" type="submit">
                开始定位
                <span>→</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {stage === "routing" && (
        <section className="state-card assessment-loading-card" aria-busy="true" aria-live="polite">
          <div className="assessment-loading-icon" aria-hidden="true">
            <Sparkles className="h-8 w-8" />
          </div>
          <p className="kicker">Reading level check</p>
          <h1>正在定位你的阅读水平</h1>
          <p>正在综合你的背景信息，为你匹配合适的起始测试难度。</p>
          <div className="assessment-loading-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      )}

      {stage === "reading" && activeTest && inference && (
        <section className="reading-layout">
          <aside className="reading-sidebar">
            <div>
              <p className="section-index">STEP 02 · READING</p>
              <div className="band-pill">
                {activeTest.band} · {activeTest.version} 卷
              </div>
              <h1>{activeTest.title}</h1>
              <p>{activeTest.dek}</p>
            </div>
            <dl className="reading-meta">
              <div>
                <dt>篇幅</dt>
                <dd>{totalWords} words</dd>
              </div>
              <div>
                <dt>预计</dt>
                <dd>{activeTest.readTime}</dd>
              </div>
              <div>
                <dt>阅读计时</dt>
                <dd className="timer">{formatTime(readingElapsed)}</dd>
              </div>
            </dl>
            <div className="click-hint">
              <span>?</span>
              <p>
                遇到不确定的词就点击。
                <br />
                查词不会扣分。
              </p>
            </div>
          </aside>

          <article className="article-card">
            <div className="article-topline">
              <span>READING PASSAGE</span>
              <span>
                {activeTest.band} · PACK {activeTest.version} · NON-FICTION
              </span>
            </div>
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
                              {selectedWord.dictionaryEntry ? "本地词典" : "语境释义"}
                            </span>
                            {selectedWord.status === "loading" ? (
                              <span className="word-popover-status" role="status">
                                正在查询词典…
                              </span>
                            ) : selectedWord.dictionaryEntry ? (
                              <>
                                <strong>{selectedWord.dictionaryEntry.lemma || selectedWord.word}</strong>
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
                                <strong>{selectedWord.word}</strong>
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

            <div className="article-footer">
              <p>
                已查 <strong>{Object.keys(clickedTokens).length}</strong> 个词位
              </p>
              <button
                className="primary-button"
                onClick={() => moveBetweenReadingAndQuestions("questions")}
              >
                {answeredCount > 0
                  ? `继续答题（已完成 ${answeredCount}/6）`
                  : "我读完了，开始答题"}
                <span>→</span>
              </button>
            </div>
          </article>
        </section>
      )}

      {stage === "questions" && activeTest && (
        <section className="questions-layout">
          <aside className="questions-intro">
            <p className="section-index">STEP 02 · CHECK</p>
            <div className="band-pill">
              {activeTest.band} · {activeTest.version} 卷
            </div>
            <h1>不是考语法，<br />而是确认你读懂了什么。</h1>
            <p>共 6 道单选题，覆盖语境词汇、句子理解和语篇理解三个层次。</p>
            <div className="answer-progress">
              <span style={{ width: `${(answeredCount / 6) * 100}%` }} />
            </div>
            <small>{answeredCount} / 6 已完成</small>
            <div className="question-timer">
              <span>答题计时</span>
              <strong>{formatTime(questionElapsed)}</strong>
              <small>暂不参与等级判断</small>
            </div>
            <div className="question-reading-link">
              <button
                type="button"
                className="secondary-button"
                onClick={() => moveBetweenReadingAndQuestions("reading")}
              >
                <span aria-hidden="true">←</span>
                返回原文
              </button>
              <p>查看文章不会清空已经选择的答案。</p>
            </div>
          </aside>

          <div className="question-list">
            {activeTest.questions.map((question, questionIndex) => (
              <fieldset className="question-card" key={question.id}>
                <legend>
                  <span>{String(questionIndex + 1).padStart(2, "0")}</span>
                  <small>{question.eyebrow}</small>
                  <strong>{question.prompt}</strong>
                </legend>
                <div className="option-grid">
                  {question.options.map((option, optionIndex) => (
                    <label
                      className={`option ${
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
                      <span>{String.fromCharCode(65 + optionIndex)}</span>
                      <p>{option}</p>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

            <div className="submit-panel">
              <div>
                <strong>{answeredAll ? "可以提交了" : "请完成全部题目"}</strong>
                <p>提交后将生成阅读画像与推荐档位。</p>
              </div>
              <button
                className="primary-button"
                disabled={!answeredAll}
                onClick={() => setStage("result")}
              >
                查看结果
                <span>→</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {stage === "result" && activeTest && inference && result && (
        <section className="result-layout">
          <div className="result-hero">
            <div>
              <p className="kicker">Your reading edge</p>
              <h1>
                你的下一篇，
                <br />
                从 <span>{result.recommended}</span> 开始。
              </h1>
              <p className="large-copy">
                问卷将你粗定位为 {inference.band}；阅读实测后建议
                {result.adjustment === "up"
                  ? "提高一级"
                  : result.adjustment === "down"
                    ? "降低一级"
                    : "保持当前档位"}
                。
              </p>
            </div>
            <div className="level-shift" aria-label="档位变化">
              <div>
                <small>粗定位</small>
                <strong>{inference.band}</strong>
              </div>
              <span>→</span>
              <div className="recommended">
                <small>推荐阅读</small>
                <strong>{result.recommended}</strong>
              </div>
            </div>
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
              const percent = (Number(correct) / Number(total)) * 100;
              return (
                <article className="metric-card" key={String(label)}>
                  <div className="metric-label">
                    <span>{english}</span>
                    <strong>{label}</strong>
                  </div>
                  <div className="metric-score">
                    <strong>{percent}%</strong>
                    <span>
                      {correct} / {total}
                    </span>
                  </div>
                  <div className="metric-bar">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </article>
              );
            })}
          </div>

          <div className="result-bottom">
            <article className="behavior-card">
              <div className="card-heading">
                <div>
                  <span>BEHAVIOR SIGNALS</span>
                  <h2>阅读行为</h2>
                </div>
                <span className="subtle-badge">仅作辅助</span>
              </div>
              <div className="behavior-stats">
                <div>
                  <small>查词词位</small>
                  <strong>{result.uniqueClicks}</strong>
                  <span>个</span>
                </div>
                <div>
                  <small>每 100 词查词</small>
                  <strong>{result.lookupFrequency.toFixed(1)}</strong>
                  <span>次</span>
                </div>
                <div>
                  <small>阅读速度</small>
                  <strong>{result.wpmValid ? result.wpm : "—"}</strong>
                  <span>{result.wpmValid ? "WPM" : "理解率不足"}</span>
                </div>
              </div>
              <div className="time-summary">
                <div>
                  <small>阅读用时</small>
                  <strong>{formatTime(readingElapsed)}</strong>
                </div>
                <div>
                  <small>答题用时</small>
                  <strong>{formatTime(questionElapsed)}</strong>
                  <span>仅记录，暂不参与等级判断</span>
                </div>
              </div>
            </article>

            <article className="recommendation-card">
              <div className="card-heading">
                <div>
                  <span>NEXT READING</span>
                  <h2>推荐参数</h2>
                </div>
              </div>
              <ul>
                <li>
                  <span>难度</span>
                  <strong>{result.recommended} 通俗非虚构</strong>
                </li>
                <li>
                  <span>建议篇幅</span>
                  <strong>
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
                  <span>阅读辅助</span>
                  <strong>保留点词语境释义</strong>
                </li>
              </ul>
            </article>
          </div>

          <div className="result-actions">
            <p>
              这是文章推荐用的阅读起始档位，不是正式 CEFR 认证结果。
              结果已写入应用：推荐、文库筛选与改写会优先使用{' '}
              <strong>{result.recommended}</strong>。
            </p>
            <div className="result-action-buttons">
              {onStartRecommendedReading && (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onStartRecommendedReading(result.recommended)}
                >
                  按 {result.recommended} 开始推荐阅读
                  <span>→</span>
                </button>
              )}
              {attempt === 1 && result.adjustment === "same" && (
                <button className="secondary-button" onClick={startValidationPack}>
                  抽取同级新卷复核
                  <span>→</span>
                </button>
              )}
              <button className="secondary-button" onClick={restart}>
                重新测试
                <span>↻</span>
              </button>
              <button className="secondary-button" type="button" onClick={onBack}>
                返回首页
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
    </div>
  );
};
