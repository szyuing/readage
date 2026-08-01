import type {
  ArticleOpportunityInput,
  ArticleOpportunityScore,
  OpportunityInput,
  RmeMemoryProfile,
} from './types';

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function normalizeLemma(value: string): string {
  return value.trim().toLowerCase();
}

export function calculateOpportunityScore(
  profile: RmeMemoryProfile,
  input: OpportunityInput,
): number {
  const raw = [
    input.forgettingRisk,
    input.importance ?? 1,
    input.exposureGap ?? 1,
    input.stageWeight ?? 1,
    input.goalWeight ?? 1,
  ].reduce((product, factor) => product * clamp(factor), 1) * 100;

  return profile.forcedExposure ? Math.max(80, raw) : raw;
}

export function scoreArticleOpportunity(
  input: ArticleOpportunityInput,
): ArticleOpportunityScore {
  const coveredWords: string[] = [];
  const seen = new Set<string>();
  let opportunityCoverage = 0;

  for (const rawLemma of input.lemmas) {
    const lemma = normalizeLemma(rawLemma);
    if (!lemma || seen.has(lemma)) continue;
    seen.add(lemma);
    const opportunity = input.opportunityByWord.get(lemma) ?? 0;
    if (opportunity <= 0) continue;
    coveredWords.push(lemma);
    opportunityCoverage += Math.max(0, opportunity);
  }

  const articleScore = opportunityCoverage
    + (input.cefrScore ?? 0)
    + (input.topicScore ?? 0)
    + (input.lengthScore ?? 0)
    - (input.difficultyPenalty ?? 0)
    - (input.repetitionPenalty ?? 0);

  return { opportunityCoverage, articleScore, coveredWords };
}
