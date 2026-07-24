import { runMagazineSync, getSyncStatus } from '../server/magazines/sync.ts';

const r = await runMagazineSync({ sources: ['economist'], maxIssuesPerSource: 1 });
console.log(JSON.stringify(r, null, 2));
console.log('status', getSyncStatus());
