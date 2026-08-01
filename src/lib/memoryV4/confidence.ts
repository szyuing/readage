import type {
  FsrsRetentionInput,
  RmeMemoryProfile,
  RmeMemoryStage,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function calculateFsrsRetention(
  fsrs: FsrsRetentionInput,
  now: Date,
): number {
  if (!fsrs.lastReview || !Number.isFinite(fsrs.stabilityDays) || fsrs.stabilityDays <= 0) return 0;
  const reviewedAt = new Date(fsrs.lastReview).getTime();
  if (!Number.isFinite(reviewedAt)) return 0;
  const elapsedDays = Math.max(0, now.getTime() - reviewedAt) / DAY_MS;
  return Math.pow(0.9, elapsedDays / fsrs.stabilityDays);
}

export function calculateConfidence(
  profile: RmeMemoryProfile,
  fsrs: FsrsRetentionInput,
  now: Date,
): number {
  const totalOutcomes = profile.successfulExposureCount + profile.failedExposureCount;
  if (totalOutcomes === 0) return 0;

  const historySuccess = profile.successfulExposureCount / totalOutcomes;
  const fsrsRetention = calculateFsrsRetention(fsrs, now);
  const validRecent = profile.exposureHistory.filter((item) => item.isValid).slice(-5);
  const recentQuality = validRecent.length === 0
    ? 0
    : validRecent.reduce((sum, item) => sum + item.quality, 0) / validRecent.length;
  const windowStart = now.getTime() - 7 * DAY_MS;
  const recentFrequency = clamp(
    profile.exposureHistory.filter((item) => item.isValid && new Date(item.occurredAt).getTime() >= windowStart).length / 3,
  );

  return clamp(historySuccess * fsrsRetention * recentQuality * recentFrequency) * 100;
}

export function stageFromConfidence(confidence: number): RmeMemoryStage {
  if (!Number.isFinite(confidence) || confidence <= 0) return 0;
  if (confidence < 25) return 1;
  if (confidence < 50) return 2;
  if (confidence < 80) return 3;
  return 4;
}

export function applyReviewOutcome(
  profile: RmeMemoryProfile,
  grade: 'Good' | 'Again',
  _reviewedAt: Date,
  reviewQuality = 1,
): RmeMemoryProfile {
  if (grade === 'Again') {
    const consecutiveAgain = profile.consecutiveAgain + 1;
    return {
      ...profile,
      consecutiveAgain,
      recoveryStreak: 0,
      forcedExposure: profile.forcedExposure || consecutiveAgain >= 3,
      lastReviewGrade: grade,
    };
  }

  if (!profile.forcedExposure) {
    return { ...profile, consecutiveAgain: 0, lastReviewGrade: grade };
  }

  if (reviewQuality < 0.8) {
    return {
      ...profile,
      recoveryStreak: 0,
      forcedExposure: true,
      lastReviewGrade: grade,
    };
  }

  const recoveryStreak = profile.recoveryStreak + 1;
  const recovered = recoveryStreak >= 2;
  return {
    ...profile,
    consecutiveAgain: 0,
    recoveryStreak: recovered ? 0 : recoveryStreak,
    forcedExposure: !recovered,
    lastReviewGrade: grade,
  };
}
