import { logger } from '../../lib/logger';
import { runSpaceMemoryTick } from '../../projects/surface';
import { runWorkerTick } from '../../shared/audit-scope';
import { leaderTimer } from '../../shared/leader-timer';

/**
 * Every 3 minutes: automatic Space memory (`projects/lib/space-memory-update`).
 * A tick updates at most 5 Spaces (one model call each), so the job makes at
 * most 100 calls an hour across the deployment.
 */
const TICK_MS = 3 * 60_000;

// Serial ticks, one chain per leadership term (shared/leader-timer.ts).
const job = leaderTimer(async () => {
  try {
    await runWorkerTick('space-memory', async () => {
      const result = await runSpaceMemoryTick();
      if (result.candidates > 0) logger.info('[space-memory] tick', { ...result });
      return result.updated;
    });
  } catch (err) {
    logger.error('[space-memory] tick failed', { error: String(err) });
  }
  return TICK_MS;
});

export const startSpaceMemoryJob = job.start;
export const stopSpaceMemoryJob = job.stop;
