import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MyLearningScreen } from '../src/components/MyLearningScreen';

const baseProps = {
  onBack: () => undefined,
  onStartTargetedReview: () => undefined,
  onOpenArticle: () => undefined,
  articlesReadCount: 2,
  masteredWordsCount: 8,
  learningWordsCount: 5,
  streakDaysCount: 4,
  recentEventCount: 12,
  dueWordCount: 3,
  weakPointMetrics: [],
  isTargetedReviewLoading: false,
  articleProgress: [],
};

test('My Learning renders real metric labels and honest empty states', () => {
  const html = renderToStaticMarkup(React.createElement(MyLearningScreen, baseProps));
  assert.match(html, /已完成文章/);
  assert.match(html, /连续学习天数/);
  assert.match(html, /近 7 天学习事件/);
  assert.match(html, /尚未发现明确薄弱点/);
  assert.doesNotMatch(html, /演示固定值|中位示意/);
});

test('My Learning exposes completion status and targeted-review loading state', () => {
  const html = renderToStaticMarkup(React.createElement(MyLearningScreen, {
    ...baseProps,
    isTargetedReviewLoading: true,
    weakPointMetrics: [{ skill: 'articles', issueCount: 2, severity: 65 }],
    articleProgress: [{
      article: {
        id: 'a1',
        title: 'A completed article',
        description: 'desc',
        date: 'Jul 24, 2026',
        status: 'Completed',
        content: ['Paragraph'],
      },
      clickCount: 4,
      discussionCount: 1,
      hasSession: true,
    }],
  }));

  assert.match(html, /已完成/);
  assert.match(html, /articles · 2 次记录/);
  assert.match(html, /正在生成复习文章/);
  assert.match(html, /disabled=""/);
});
