export type CefrBand = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type ExamRecord = {
  id: string;
  examType: string;
  overallScore: string;
  readingScore: string;
  year: string;
  maxScore: string;
  scaleVersion: string;
  region: string;
};

export type RoutingSignal = {
  band: CefrBand;
  weight: number;
  reason: string;
  source: "official" | "internal" | "self_report" | "education";
};

export type Inference = {
  band: CefrBand;
  confidence: number;
  reason: string;
  signals: RoutingSignal[];
  needsAdjacentCheck: boolean;
};

export const BAND_ORDER: CefrBand[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const EXAM_OPTIONS = [
  { value: "IELTS", label: "IELTS" },
  { value: "TOEFL", label: "TOEFL iBT" },
  { value: "A2_KEY", label: "Cambridge A2 Key (KET)" },
  { value: "B1_PRELIMINARY", label: "Cambridge B1 Preliminary (PET)" },
  { value: "B2_FIRST", label: "Cambridge B2 First (FCE)" },
  { value: "C1_ADVANCED", label: "Cambridge C1 Advanced (CAE)" },
  { value: "C2_PROFICIENCY", label: "Cambridge C2 Proficiency (CPE)" },
  { value: "CET4", label: "CET-4" },
  { value: "CET6", label: "CET-6" },
  { value: "TEM4", label: "TEM-4" },
  { value: "TEM8", label: "TEM-8" },
  { value: "PETS1", label: "PETS 1" },
  { value: "PETS2", label: "PETS 2" },
  { value: "PETS3", label: "PETS 3" },
  { value: "PETS4", label: "PETS 4" },
  { value: "PETS5", label: "PETS 5" },
  { value: "GAOKAO", label: "高考英语" },
  { value: "ZHONGKAO", label: "中考英语" },
  { value: "OTHER", label: "其他英语考试（MVP 暂不转换）" },
];

const CAMBRIDGE_TARGETS: Record<string, CefrBand> = {
  A2_KEY: "A2",
  B1_PRELIMINARY: "B1",
  B2_FIRST: "B2",
  C1_ADVANCED: "C1",
  C2_PROFICIENCY: "C2",
};

const SELF_BANDS: Record<string, CefrBand> = {
  difficult: "A2",
  general: "B1",
  experienced: "B2",
};

const EDUCATION_BANDS: Record<string, CefrBand> = {
  middle_school: "A1",
  high_school: "A2",
  university: "B1",
  graduated: "B1",
  other: "A2",
};

export function clampBand(index: number): CefrBand {
  return BAND_ORDER[Math.max(0, Math.min(BAND_ORDER.length - 1, index))];
}

export const createExam = (): ExamRecord => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  examType: "CET6",
  overallScore: "",
  readingScore: "",
  year: String(new Date().getFullYear()),
  maxScore: "",
  scaleVersion: "0_120",
  region: "",
});

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bandFromCambridgeScale(score: number): CefrBand {
  if (score >= 200) return "C2";
  if (score >= 180) return "C1";
  if (score >= 160) return "B2";
  if (score >= 140) return "B1";
  if (score >= 120) return "A2";
  return "A1";
}

function bandFromIelts(score: number): CefrBand {
  if (score >= 8.5) return "C2";
  if (score >= 7) return "C1";
  if (score >= 5.5) return "B2";
  if (score >= 4) return "B1";
  if (score >= 2.5) return "A2";
  return "A1";
}

function bandFromToeflNew(score: number): CefrBand {
  if (score >= 6) return "C2";
  if (score >= 5) return "C1";
  if (score >= 4) return "B2";
  if (score >= 3) return "B1";
  if (score >= 2) return "A2";
  return "A1";
}

function bandFromToeflLegacyReading(score: number): CefrBand {
  if (score >= 29) return "C2";
  if (score >= 24) return "C1";
  if (score >= 19) return "B2";
  if (score >= 11) return "B1";
  if (score >= 5) return "A2";
  return "A1";
}

function bandFromToeflLegacyOverall(score: number): CefrBand {
  if (score >= 114) return "C2";
  if (score >= 95) return "C1";
  if (score >= 72) return "B2";
  if (score >= 42) return "B1";
  if (score >= 20) return "A2";
  return "A1";
}

function domesticReadingAdjustment(band: CefrBand, readingScore: number | null): CefrBand {
  if (readingScore === null) return band;
  const current = BAND_ORDER.indexOf(band);
  if (readingScore >= 200) return clampBand(current + 1);
  if (readingScore < 140) return clampBand(current - 1);
  return band;
}

function recencyMultiplier(year: number | null): number {
  if (year === null) return 0.75;
  const age = Math.max(0, new Date().getFullYear() - year);
  if (age <= 2) return 1;
  if (age <= 5) return 0.8;
  return 0.6;
}

export function scoreExam(record: ExamRecord): RoutingSignal | null {
  const overall = numberOrNull(record.overallScore);
  const reading = numberOrNull(record.readingScore);
  const max = numberOrNull(record.maxScore);
  const year = numberOrNull(record.year);
  const recency = recencyMultiplier(year);
  const cambridgeTarget = CAMBRIDGE_TARGETS[record.examType];

  if (cambridgeTarget) {
    const score = reading ?? overall;
    return {
      band: score === null ? cambridgeTarget : bandFromCambridgeScale(score),
      weight: (reading === null ? 0.8 : 1) * recency,
      reason:
        score === null
          ? `${EXAM_OPTIONS.find((item) => item.value === record.examType)?.label} 目标等级`
          : `Cambridge English Scale${reading === null ? "总分" : "阅读分"}`,
      source: "official",
    };
  }

  if (record.examType === "IELTS" && (reading !== null || overall !== null)) {
    const score = reading ?? overall ?? 0;
    return {
      band: bandFromIelts(score),
      weight: (reading === null ? 0.8 : 0.9) * recency,
      reason: `IELTS ${reading === null ? "总分近似对照" : "阅读单项内部路由"}`,
      source: "official",
    };
  }

  if (record.examType === "TOEFL" && (reading !== null || overall !== null)) {
    const usingReading = reading !== null;
    const score = reading ?? overall ?? 0;
    const band =
      record.scaleVersion === "1_6"
        ? bandFromToeflNew(score)
        : usingReading
          ? bandFromToeflLegacyReading(score)
          : bandFromToeflLegacyOverall(score);
    return {
      band,
      weight: (usingReading ? 1 : 0.8) * recency,
      reason: `TOEFL ${record.scaleVersion === "1_6" ? "1–6" : "旧制"}${
        usingReading ? "阅读分" : "总分"
      }`,
      source: "official",
    };
  }

  if (record.examType === "CET4" && overall !== null) {
    const base: CefrBand = overall >= 550 ? "B2" : overall >= 425 ? "B1" : "A2";
    return {
      band: domesticReadingAdjustment(base, reading),
      weight: 0.4 * recency,
      reason: `CET-4 内部起始规则${reading === null ? "" : "（含阅读分修正）"}`,
      source: "internal",
    };
  }

  if (record.examType === "CET6" && overall !== null) {
    const base: CefrBand = overall >= 580 ? "C1" : overall >= 425 ? "B2" : "B1";
    return {
      band: domesticReadingAdjustment(base, reading),
      weight: 0.4 * recency,
      reason: `CET-6 内部起始规则${reading === null ? "" : "（含阅读分修正）"}`,
      source: "internal",
    };
  }

  if (record.examType === "TEM4") {
    const band: CefrBand =
      overall === null ? "B2" : overall >= 80 ? "C1" : overall >= 60 ? "B2" : "B1";
    return {
      band,
      weight: 0.4 * recency,
      reason: "TEM-4 内部起始规则",
      source: "internal",
    };
  }

  if (record.examType === "TEM8") {
    const band: CefrBand =
      overall === null ? "C1" : overall >= 80 ? "C2" : overall >= 60 ? "C1" : "B2";
    return {
      band,
      weight: 0.4 * recency,
      reason: "TEM-8 内部起始规则",
      source: "internal",
    };
  }

  if (record.examType.startsWith("PETS")) {
    const level = Number(record.examType.replace("PETS", ""));
    const bands: CefrBand[] = ["A1", "A1", "A2", "B1", "B2", "C1"];
    return {
      band: bands[level] ?? "B1",
      weight: 0.4 * recency,
      reason: `PETS ${level} 内部起始规则`,
      source: "internal",
    };
  }

  if (
    (record.examType === "GAOKAO" || record.examType === "ZHONGKAO") &&
    overall !== null &&
    max !== null &&
    max > 0
  ) {
    const ratio = overall / max;
    let band: CefrBand;
    if (record.examType === "GAOKAO") {
      band = ratio >= 0.86 ? "B2" : ratio >= 0.66 ? "B1" : "A2";
    } else {
      band = ratio >= 0.85 ? "B1" : ratio >= 0.6 ? "A2" : "A1";
    }
    return {
      band,
      weight: 0.35 * recency,
      reason: `${record.examType === "GAOKAO" ? "高考" : "中考"}得分率内部起始规则`,
      source: "internal",
    };
  }

  return null;
}

function weightedMedian(signals: RoutingSignal[]): CefrBand {
  const sorted = [...signals].sort(
    (a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band),
  );
  const total = sorted.reduce((sum, signal) => sum + signal.weight, 0);
  let accumulated = 0;
  for (const signal of sorted) {
    accumulated += signal.weight;
    if (accumulated >= total / 2) return signal.band;
  }
  return sorted.at(-1)?.band ?? "A2";
}

export function inferBand(
  exams: ExamRecord[],
  selfLevel: string,
  educationStage: string,
): Inference {
  const examSignals = exams
    .map(scoreExam)
    .filter((signal): signal is RoutingSignal => signal !== null);
  const selfSignal: RoutingSignal = {
    band: SELF_BANDS[selfLevel] ?? "A2",
    weight: 0.25,
    reason: "阅读自评",
    source: "self_report",
  };
  const educationSignal: RoutingSignal = {
    band: EDUCATION_BANDS[educationStage] ?? "A2",
    weight: 0.1,
    reason: "当前学习阶段",
    source: "education",
  };
  const signals = [...examSignals, selfSignal, educationSignal];
  const band = weightedMedian(signals);
  const positions = signals.map((signal) => BAND_ORDER.indexOf(signal.band));
  const spread = Math.max(...positions) - Math.min(...positions);
  const needsAdjacentCheck = spread >= 2;
  const hasOfficialReading = examSignals.some(
    (signal) => signal.source === "official" && signal.weight >= 0.9,
  );
  const hasOfficial = examSignals.some((signal) => signal.source === "official");
  const hasDomestic = examSignals.some((signal) => signal.source === "internal");
  let confidence = hasOfficialReading ? 0.9 : hasOfficial ? 0.8 : hasDomestic ? 0.62 : 0.5;
  if (needsAdjacentCheck) confidence -= 0.15;
  confidence = Math.max(0.35, Math.min(examSignals.length === 0 ? 0.55 : 0.95, confidence));

  const primary = [...signals].sort((a, b) => b.weight - a.weight).slice(0, 2);
  const reason = `${primary.map((signal) => signal.reason).join("、")}是主要依据；${
    needsAdjacentCheck ? "证据存在跨级差异，将通过阅读实测复核。" : "各项信号基本一致。"
  }`;

  return {
    band,
    confidence,
    reason,
    signals,
    needsAdjacentCheck,
  };
}
