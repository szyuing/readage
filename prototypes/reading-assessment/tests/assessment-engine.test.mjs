import assert from "node:assert/strict";
import test from "node:test";

import { inferBand, scoreExam } from "../app/assessment-engine.ts";
import {
  createRandomTestSession,
  pickRandomTestPack,
} from "../app/test-session.ts";
import { ALL_TEST_PACKS, TEST_PACKS } from "../app/test-packs.ts";

function exam(overrides) {
  return {
    id: "exam-1",
    examType: "CET6",
    overallScore: "",
    readingScore: "",
    year: "2026",
    maxScore: "",
    scaleVersion: "0_120",
    region: "",
    ...overrides,
  };
}

test("the fixed bank contains five packs and thirty questions per CEFR band", () => {
  assert.equal(ALL_TEST_PACKS.length, 30);
  assert.equal(ALL_TEST_PACKS.reduce((sum, pack) => sum + pack.questions.length, 0), 180);
  assert.equal(new Set(ALL_TEST_PACKS.map((pack) => pack.id)).size, 30);

  for (const band of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
    assert.equal(TEST_PACKS[band].length, 5);
    assert.deepEqual(
      TEST_PACKS[band].map((pack) => pack.version),
      ["A", "B", "C", "D", "E"],
    );
    for (const pack of TEST_PACKS[band]) {
      assert.equal(pack.band, band);
      assert.equal(pack.questions.length, 6);
      assert.equal(pack.questions.filter((question) => question.type === "vocabulary").length, 2);
      assert.equal(pack.questions.filter((question) => question.type === "sentence").length, 2);
      assert.equal(pack.questions.filter((question) => question.type === "discourse").length, 2);
      assert.ok(pack.paragraphs.join(" ").split(/\s+/).length >= 60);
      assert.equal(new Set(pack.questions.map((question) => question.id)).size, 6);
      for (const question of pack.questions) {
        assert.equal(question.options.length, 4);
        assert.equal(new Set(question.options).size, 4);
        assert.ok(question.correct >= 0 && question.correct < question.options.length);
      }
    }
  }
});

test("pack selection can reach every one of the five articles in a band", () => {
  const packs = TEST_PACKS.B2;
  const picks = [0, 0.2, 0.4, 0.6, 0.999999].map((value) =>
    pickRandomTestPack(packs, () => value),
  );
  assert.deepEqual(
    picks.map((pack) => pack.version),
    ["A", "B", "C", "D", "E"],
  );

  const alternative = pickRandomTestPack(packs, () => 0, picks[0].id);
  assert.notEqual(alternative.id, picks[0].id);
});

test("all test sessions preserve question order and correct content while shuffling options", () => {
  for (const source of ALL_TEST_PACKS) {
    const session = createRandomTestSession([source], () => 0.999999);

    assert.equal(session.id, source.id);
    assert.deepEqual(
      session.questions.map((question) => question.id),
      source.questions.map((question) => question.id),
    );

    source.questions.forEach((question, index) => {
      const shuffled = session.questions[index];
      const correctContent = question.options[question.correct];
      assert.notDeepEqual(shuffled.options, question.options);
      assert.equal(shuffled.options[shuffled.correct], correctContent);
      assert.deepEqual(
        [...shuffled.options].sort(),
        [...question.options].sort(),
      );
    });
  }
});

test("official score routes use the defined score scales", () => {
  assert.equal(
    scoreExam(
      exam({
        examType: "TOEFL",
        scaleVersion: "1_6",
        readingScore: "6",
      }),
    )?.band,
    "C2",
  );
  assert.equal(
    scoreExam(
      exam({
        examType: "TOEFL",
        scaleVersion: "1_6",
        readingScore: "5.5",
      }),
    )?.band,
    "C1",
  );
  assert.equal(
    scoreExam(exam({ examType: "IELTS", overallScore: "6.5" }))?.band,
    "B2",
  );
  assert.equal(
    scoreExam(exam({ examType: "C2_PROFICIENCY", overallScore: "210" }))?.band,
    "C2",
  );
});

test("domestic exams produce conservative starting bands rather than certification claims", () => {
  assert.equal(
    inferBand([exam({ examType: "CET4", overallScore: "480", readingScore: "170" })], "general", "university")
      .band,
    "B1",
  );
  assert.equal(
    inferBand([exam({ examType: "CET6", overallScore: "510", readingScore: "188" })], "general", "university")
      .band,
    "B2",
  );
  assert.equal(
    inferBand([exam({ examType: "TEM8", overallScore: "72" })], "experienced", "graduated")
      .band,
    "C1",
  );
});

test("self report is a low-confidence fallback when no exam is available", () => {
  const result = inferBand([], "general", "university");
  assert.equal(result.band, "B1");
  assert.ok(result.confidence <= 0.55);
  assert.equal(result.signals.some((signal) => signal.source === "official"), false);
});
