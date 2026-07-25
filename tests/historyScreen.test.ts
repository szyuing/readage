import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HistoryScreen } from '../src/components/HistoryScreen';

const article = {
  id: 'article-1',
  title: 'The Demon Next Door',
  description: 'A test article.',
  date: '2026-07-25',
  status: 'In Progress' as const,
  content: ['A paragraph.'],
};

test('history keeps article history without rendering word lookup history', () => {
  const html = renderToStaticMarkup(React.createElement(HistoryScreen, {
    articles: [article],
    sessions: {},
    onSelectArticle: () => undefined,
    onBack: () => undefined,
  }));

  assert.match(html, /The Demon Next Door/);
  assert.doesNotMatch(html, /\u67e5\u8bcd\u5386\u53f2/);
  assert.doesNotMatch(html, /lookup-history-heading/);
});
