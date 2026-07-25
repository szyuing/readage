import type { TestPack } from "./test-packs";

export type RandomSource = () => number;

function randomIndex(length: number, random: RandomSource) {
  if (length <= 0) return 0;
  const value = Math.max(0, Math.min(0.999999999999, random()));
  return Math.floor(value * length);
}

export function pickRandomTestPack(
  packs: readonly TestPack[],
  random: RandomSource = Math.random,
  excludeId?: string,
) {
  if (packs.length === 0) {
    throw new Error("Cannot start a test session without any test packs.");
  }

  const alternatives = excludeId
    ? packs.filter((pack) => pack.id !== excludeId)
    : packs;
  const candidates = alternatives.length > 0 ? alternatives : packs;
  return candidates[randomIndex(candidates.length, random)];
}

export function shuffleQuestionOptions(
  pack: TestPack,
  random: RandomSource = Math.random,
): TestPack {
  return {
    ...pack,
    paragraphs: [...pack.paragraphs],
    definitions: { ...pack.definitions },
    questions: pack.questions.map((question) => {
      const shuffled = question.options.map((option, originalIndex) => ({
        option,
        originalIndex,
      }));

      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = randomIndex(index + 1, random);
        [shuffled[index], shuffled[swapIndex]] = [
          shuffled[swapIndex],
          shuffled[index],
        ];
      }

      const stayedInOriginalOrder = shuffled.every(
        (entry, index) => entry.originalIndex === index,
      );
      if (stayedInOriginalOrder && shuffled.length > 1) {
        [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
      }

      return {
        ...question,
        options: shuffled.map((entry) => entry.option),
        correct: shuffled.findIndex(
          (entry) => entry.originalIndex === question.correct,
        ),
      };
    }),
  };
}

export function createRandomTestSession(
  packs: readonly TestPack[],
  random: RandomSource = Math.random,
  excludeId?: string,
) {
  return shuffleQuestionOptions(
    pickRandomTestPack(packs, random, excludeId),
    random,
  );
}
