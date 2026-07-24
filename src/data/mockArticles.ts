import { Article, ReviewWord } from '../types';

/** P1 article library catalog — fixed, not the same as history. */
export const LIBRARY_ARTICLES: Article[] = [
  {
    id: 'lib-active-reading',
    title: 'Active Reading Learning Interface',
    description:
      'Master active reading techniques, idiom recognition, and context-based vocabulary building.',
    date: 'Oct 28, 2023',
    status: 'In Progress',
    source: 'library',
    level: 'B1',
    topic: 'Learning Skills',
    content: [
      "Learning a new language is a journey of discovery. It involves not just memorizing vocabulary, but understanding cultural nuances and structural patterns. For example, the phrase 'break a leg' in theatrical contexts means 'good luck,' an idiom that can be confusing for beginners. Mastering these subtleties requires practice and immersion.",
      "When you encounter unfamiliar words, like 'ephemeral' or 'ubiquitous', try to infer their meaning from the surrounding context before looking them up. This active engagement reinforces memory and deepens comprehension.",
      'Consistency is key. Even short, daily practice sessions are more effective than infrequent, long study periods.',
    ],
    keyWords: [
      'break a leg',
      'ephemeral',
      'ubiquitous',
      'immersion',
      'subtleties',
      'comprehension',
    ],
    embeddedReviewWords: ['ephemeral', 'ubiquitous', 'break a leg'],
  },
  {
    id: 'lib-ai-future',
    title: 'AI and the Future of Language Learning',
    description:
      'An exploration of how artificial intelligence is transforming English education.',
    date: 'Oct 25, 2023',
    status: 'In Progress',
    source: 'library',
    level: 'B2',
    topic: 'Technology',
    content: [
      'Artificial intelligence is rapidly redesigning how humans acquire second languages. Personalized adaptive feedback, contextual translation, and immediate pronunciation analysis empower learners worldwide.',
      'Traditional classrooms relied heavily on rote memorization. Today, intelligent language models simulate authentic conversational environments where students can experiment freely without fear of failure.',
    ],
    keyWords: ['adaptive', 'rote memorization', 'contextual'],
  },
  {
    id: 'lib-tenses',
    title: 'Grammar Essentials: Tenses Review',
    description:
      'A focused review on present, past, and future tenses for better communication.',
    date: 'Oct 22, 2023',
    status: 'In Progress',
    source: 'library',
    level: 'A2',
    topic: 'Grammar',
    content: [
      'English tenses establish precise time anchors for events. Mastering the present perfect versus past simple is often a crucial turning point for fluency.',
      "For instance, 'I have lived here for five years' implies you still live here, whereas 'I lived here for five years' indicates that period is completed.",
    ],
    keyWords: ['tenses', 'fluency', 'implies'],
  },
  {
    id: 'lib-business',
    title: 'Business English Vocabulary',
    description: 'Key terms and phrases for professional environments and meetings.',
    date: 'Oct 18, 2023',
    status: 'In Progress',
    source: 'library',
    level: 'B1',
    topic: 'Business',
    content: [
      'Navigating professional communication requires familiarity with business jargon and polite indirect language.',
      "Phrases like 'touch base', 'circle back', and 'action items' are ubiquitous in modern corporate settings.",
    ],
    keyWords: ['touch base', 'corporate', 'jargon'],
  },
  {
    id: 'lib-advanced',
    title: 'Advanced Reading Comprehension',
    description: 'Strategies for understanding complex texts and articles.',
    date: 'Oct 15, 2023',
    status: 'In Progress',
    source: 'library',
    level: 'C1',
    topic: 'Academic',
    content: [
      "Reading dense analytical prose requires active annotation and identifying the author's primary thesis statement.",
      "Scanning for discourse markers such as 'nevertheless', 'furthermore', and 'conversely' helps track argument transitions.",
    ],
    keyWords: ['discourse markers', 'thesis statement', 'annotation'],
  },
];

/** @deprecated Use LIBRARY_ARTICLES; kept for leftover imports. */
export const INITIAL_ARTICLES = LIBRARY_ARTICLES;

/** Seed due-review vocabulary for demo */
export const INITIAL_REVIEW_WORDS: ReviewWord[] = [
  {
    id: 'word-1',
    word: 'ephemeral',
    phonetic: '/ɪˈfem.ər.əl/',
    partOfSpeech: 'adj. 形容词',
    definition: 'Lasting for a very short time; fleeting.',
    definitionChinese: '持续时间极短的；转瞬即逝的',
    chineseTranslation: '短暂的；转瞬即逝的',
    exampleSentence: 'Fame in the digital age can be remarkably ephemeral.',
    mastered: false,
    nextReviewDate: 'Today',
  },
  {
    id: 'word-2',
    word: 'ubiquitous',
    phonetic: '/juːˈbɪk.wɪ.təs/',
    partOfSpeech: 'adj. 形容词',
    definition: 'Present, appearing, or found everywhere.',
    definitionChinese: '无处不在的；普遍存在的',
    chineseTranslation: '普遍的；随处可见的',
    exampleSentence: 'Smartphones have become ubiquitous in daily life.',
    mastered: false,
    nextReviewDate: 'Today',
  },
  {
    id: 'word-3',
    word: 'break a leg',
    phonetic: '/breɪk ə leɡ/',
    partOfSpeech: 'idiom 习语',
    definition: 'An idiom used to wish someone good luck before a performance.',
    definitionChinese: '演出前祝人好运的习惯用语',
    chineseTranslation: '祝你好运；演出成功',
    exampleSentence: 'Before going on stage, her director whispered "break a leg!".',
    mastered: false,
    nextReviewDate: 'Today',
  },
];

export function buildFallbackReviewArticle(reviewWords: string[]): Article {
  const words = reviewWords.length
    ? reviewWords
    : ['ephemeral', 'ubiquitous', 'immersion'];
  const w0 = words[0] || 'practice';
  const w1 = words[1] || 'context';
  const w2 = words[2] || 'fluency';

  return {
    id: `review-${Date.now()}`,
    title: 'Contextual Review Session',
    description: `Practice due words in context: ${words.slice(0, 4).join(', ')}.`,
    date: new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    status: 'In Progress',
    source: 'ai_generated',
    level: 'B1',
    topic: 'Review',
    embeddedReviewWords: words,
    keyWords: words,
    content: [
      `Today we revisit words that need attention. Notice how "${w0}" appears in real sentences — try to infer meaning before looking it up.`,
      `Good learners also track "${w1}" in different situations. Reading and then discussing the idea strengthens both recognition and production.`,
      `Finally, use "${w2}" when you summarize the article in your own words. Active output is the fastest path to lasting fluency. After reading, explain the central idea, connect it to a personal experience, and write two complete sentences. This extra context helps each useful expression become easier to recognize and recall later.`,
    ],
  };
}

export const CEFR_LEVELS = ['All', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

