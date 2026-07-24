import assert from 'node:assert/strict';
import test from 'node:test';

import type { Article, ArticleSession, LearningEvent } from '../src/types';
import {
  buildWeakPointMetrics,
  calculateLearningStreak,
  countCompletedArticles,
  countRecentLearningEvents,
  getLearningActivityDateKeys,
  toLocalDateKey,
} from '../src/lib/learningAnalytics';

function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

function event(type: LearningEvent['type'], at: Date, detail?: string): LearningEvent {
  return {
    id: `${type}-${at.getTime()}-${detail || ''}`,
    type,
    createdAt: at.toISOString(),
    detail,
  };
}

test('calculates a current streak from unique local learning days', () => {
  const now = localDate(2026, 7, 24);
  assert.equal(calculateLearningStreak([
    toLocalDateKey(localDate(2026, 7, 24)),
    toLocalDateKey(localDate(2026, 7, 23)),
    toLocalDateKey(localDate(2026, 7, 23, 18)),
    toLocalDateKey(localDate(2026, 7, 22)),
    toLocalDateKey(localDate(2026, 7, 20)),
  ], now), 3);
});

test('keeps yesterday as the active streak until the current day ends', () => {
  const now = localDate(2026, 7, 24);
  assert.equal(calculateLearningStreak([
    toLocalDateKey(localDate(2026, 7, 23)),
    toLocalDateKey(localDate(2026, 7, 22)),
  ], now), 2);
  assert.equal(calculateLearningStreak([
    toLocalDateKey(localDate(2026, 7, 22)),
  ], now), 0);
});

test('counts only learning events from the latest seven local calendar days', () => {
  const now = localDate(2026, 7, 24, 15);
  const events = [
    event('click', localDate(2026, 7, 24)),
    event('discussion', localDate(2026, 7, 18)),
    event('weak_point', localDate(2026, 7, 24), 'articles'),
    event('click', localDate(2026, 7, 17, 23)),
    event('click', localDate(2026, 7, 25)),
    { ...event('click', now), createdAt: 'invalid' },
  ];
  assert.equal(countRecentLearningEvents(events, now, 7), 2);
});

test('builds radar metrics from persisted weak-point occurrences', () => {
  const now = localDate(2026, 7, 24);
  const metrics = buildWeakPointMetrics([
    event('weak_point', localDate(2026, 7, 22), 'Articles'),
    event('weak_point', localDate(2026, 7, 23), 'articles'),
    event('weak_point', localDate(2026, 7, 24), 'past_perfect'),
  ], ['Collocations']);

  assert.deepEqual(metrics.map(({ skill, issueCount, severity }) => ({ skill, issueCount, severity })), [
    { skill: 'articles', issueCount: 2, severity: 65 },
    { skill: 'past perfect', issueCount: 1, severity: 45 },
    { skill: 'collocations', issueCount: 1, severity: 45 },
  ]);
  assert.equal(metrics[0].lastSeenAt, localDate(2026, 7, 23).toISOString());
  assert.ok(metrics[0].lastSeenAt < now.toISOString());
});

test('counts only articles that have reached Completed status', () => {
  const articles = [
    { status: 'Completed' },
    { status: 'In Progress' },
    { status: 'Completed' },
  ] as Article[];
  assert.equal(countCompletedArticles(articles), 2);
});

test('collects activity days from durable day history and legacy app data', () => {
  const events = [event('click', localDate(2026, 7, 20))];
  const sessions = {
    a1: { lastOpenedAt: localDate(2026, 7, 21).toISOString() } as ArticleSession,
  };
  const articles = [{
    lastOpenedAt: localDate(2026, 7, 22).toISOString(),
    completedAt: localDate(2026, 7, 23).toISOString(),
  }] as Article[];

  assert.deepEqual(getLearningActivityDateKeys(
    [toLocalDateKey(localDate(2026, 7, 19))],
    events,
    sessions,
    articles,
  ), [
    toLocalDateKey(localDate(2026, 7, 19)),
    toLocalDateKey(localDate(2026, 7, 20)),
    toLocalDateKey(localDate(2026, 7, 21)),
    toLocalDateKey(localDate(2026, 7, 22)),
    toLocalDateKey(localDate(2026, 7, 23)),
  ]);
});
