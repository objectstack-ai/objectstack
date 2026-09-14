// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17396] Test-only helper for the deployment switch `AppPlugin` reads before
 * scheduling a package-authored `defineJob`.
 *
 * ## Why the job suites need it, and why it is not a relaxation
 *
 * Ruling G (addendum, Q3) puts package-authored cron jobs under the same
 * deployment switch as time-triggered flows, OFF by default in every posture.
 * The suites below are not about the deployment: they measure whether the
 * declarative-job READER sees the `jobs` collection, whether a handler gets
 * data reach, whether a degraded outcome reaches `sys_job_run`. With the switch
 * unset the loop returns before reading anything, so every one of those
 * assertions goes red for a reason that has nothing to do with its subject.
 *
 * ⛔ Not a `setupFiles` entry. Arming it globally would make every suite in this
 * package run in a non-default deployment while reading as if it ran in the
 * default one, and the default is the interesting state. Each suite that needs
 * it says so in one line.
 *
 * Outside the tsup entry (`src/index.ts`), so it is compiled by the test
 * program and shipped by nothing. Restores the PREVIOUS value rather than
 * deleting the key: "was unset" and "deleted" are the same end state only when
 * the suite started from unset.
 */

import { afterEach, beforeEach } from 'vitest';
import { SCHEDULED_WORK_ENV } from '@objectstack/types';

/** Run this file's suites on a deployment that schedules package-authored jobs. */
export function withScheduledWorkOn(): void {
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env[SCHEDULED_WORK_ENV];
    process.env[SCHEDULED_WORK_ENV] = 'true';
  });
  afterEach(() => {
    if (prior === undefined) delete process.env[SCHEDULED_WORK_ENV];
    else process.env[SCHEDULED_WORK_ENV] = prior;
  });
}
