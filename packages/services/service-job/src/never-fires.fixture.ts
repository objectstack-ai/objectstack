// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inert cron fixture every exact-count job test in this package schedules
 * on, and the two assertions that keep it inert.
 *
 * Test-only support module. Nothing in `src/index.ts` re-exports it and the
 * package's tsup entry is `src/index.ts` alone, so it is type-checked with the
 * rest of `src` and shipped in nothing.
 */

import { expect } from 'vitest';
import { Cron, scheduledJobs } from 'croner';
import type { CronJobAdapter } from './cron-job-adapter.js';

/**
 * A cron expression croner PARSES but can never fire: February 30th does not
 * exist, so `nextRun()` is `null` and a registration on it carries no schedule
 * of its own. An explicit `trigger()` is then the ONLY thing that can run the
 * handler, which is what entitles a case to assert an EXACT execution count.
 *
 * These fixtures were spelled `'* * * * *'` (and, in the rarer cases, a real
 * daily expression). Under those spellings every exact-count assertion in the
 * package was a claim about the wall clock rather than about the adapter:
 * `CronJobAdapter.schedule()` builds a REAL croner job, so when a run straddled
 * the expression's own instant croner fired the registration alongside the
 * explicit `trigger()`, a second execution landed, and CI reddened on a package
 * the offending PR had usually not touched.
 *
 * Measured (#8748) by faking ONLY `Date` — real timers, croner's real
 * scheduling path — with the registration placed 2/5/10/15 ms before the
 * expression's own instant. Under the firing spellings each case gained
 * exactly one extra handler run: `records executions` went 1 → 2 execution
 * rows, `retries a failing handler` went 3 → 4 calls (the self-fire re-enters
 * a handler whose retry counter is already spent, so it succeeds first try),
 * and the daily kernel-rebuild case gained an unasked-for `fired` entry at
 * 08:00 UTC. At a 2 ms lead two of the three no longer reproduced — croner had
 * already passed the instant by the time it computed `nextRun()` — which is
 * exactly why this is a positional flake rather than a deterministic failure.
 * Under this fixture all three stay put at every lead.
 *
 * ⛔ `'0 0 29 2 *'` is NOT a substitute — croner resolves Feb 29 forward to the
 * next leap year (measured: `2028-02-29T00:00:00.000Z`) and it would fire
 * there. Only a date that never occurs at all is inert.
 *
 * ⛔ And the remedy is never to loosen the counts. An exact count is the only
 * thing in this package that can catch a genuine double-scheduling regression,
 * which is precisely what these suites exist to catch.
 */
export const NEVER_FIRES = '0 0 30 2 *';

/** The inert fixture as a `JobSchedule`, ready to hand to `schedule()`. */
export const NEVER_FIRES_SCHEDULE = { type: 'cron', expression: NEVER_FIRES } as const;

/**
 * Pin that the FIXTURE itself is inert.
 *
 * Stated as an assertion and not a comment because the failure it prevents is
 * invisible locally: restoring a firing spelling passes on a developer machine
 * and reds CI only when a run happens to straddle the expression's instant.
 */
export function expectFixtureCannotFire(expression: string = NEVER_FIRES, timezone = 'UTC'): void {
  expect(
    new Cron(expression, { timezone }).nextRun(),
    `cron fixture "${expression}" must have no next run — otherwise every exact-count assertion in this file is a claim about the wall clock`,
  ).toBeNull();
}

/**
 * Pin that the registration a case ACTUALLY made is inert — both halves.
 *
 * The fixture pin above is not sufficient on its own: a case can only assert an
 * exact count if the job it really registered owns no schedule, and a case that
 * registered nothing at all would pass a one-sided check for the wrong reason
 * (it would no longer be exercising the real adapter). So: registered, and
 * unable to fire.
 */
export function expectInertRegistration(adapter: CronJobAdapter, jobName: string): void {
  const registered = scheduledJobs.find((job) => job.name === adapter.cronRegistryName(jobName));
  expect(registered, `"${jobName}": the case must register a REAL croner job`).toBeDefined();
  expect(
    registered!.nextRun(),
    `"${jobName}": the registration must own no schedule of its own, or it can fire alongside trigger()`,
  ).toBeNull();
}
