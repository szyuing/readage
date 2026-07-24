import nodeCron, { type ScheduledTask } from 'node-cron';
import { getSyncCronExpression, shouldSyncOnBoot } from './config';
import { hydrateSyncStatusFromDisk, runMagazineSync } from './sync';

let task: ScheduledTask | null = null;

export async function startMagazineScheduler(): Promise<void> {
  await hydrateSyncStatusFromDisk();

  const expression = getSyncCronExpression();
  if (!nodeCron.validate(expression)) {
    console.warn(`[magazines] invalid cron "${expression}", scheduler disabled`);
    return;
  }

  task = nodeCron.schedule(expression, () => {
    console.log('[magazines] scheduled sync triggered');
    void runMagazineSync().catch((err) => {
      console.error('[magazines] scheduled sync error', err);
    });
  });

  console.log(`[magazines] scheduler armed: "${expression}"`);

  if (shouldSyncOnBoot()) {
    console.log('[magazines] boot sync: all sources (set MAGAZINE_SYNC_ON_BOOT=false to skip)');
    void runMagazineSync({}).catch((err) => {
      console.error('[magazines] boot sync error', err);
    });
  }
}

export function stopMagazineScheduler(): void {
  task?.stop();
  task = null;
}

