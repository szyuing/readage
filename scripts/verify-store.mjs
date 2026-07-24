import { loadIndex, loadIssueById, loadArticle } from '../server/magazines/store.ts';

const i = await loadIndex();
console.log('issues', i.issues.length, i.issues[0]?.title, 'articles=', i.issues[0]?.articleCount);
const p = await loadIssueById(i.issues[0].id);
console.log('stubs', p?.articles.length);
console.log(
  'sample titles:',
  p?.articles.slice(0, 5).map((a) => a.title)
);
const a = await loadArticle(p.articles[0].id);
console.log('loaded', a?.id, 'paras', a?.content?.length);
console.log(a?.content?.[0]?.slice(0, 120));
