export type RecommendationEntryAction = 'start' | 'assessment';

export function getRecommendationEntryAction(
  hasCompletedAssessment: boolean
): RecommendationEntryAction {
  return hasCompletedAssessment ? 'start' : 'assessment';
}
