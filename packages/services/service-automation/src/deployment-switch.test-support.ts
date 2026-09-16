// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17396] Test-only helper for the deployment switch the engine reads before
 * arming a time-triggered flow.
 *
 * ⛔ Not exported from `index.ts` and outside the tsup entry (`src/index.ts`),
 * so it is compiled by the test program and shipped by nothing. It deliberately
 * mirrors `@objectstack/trigger-schedule`'s helper of the same name rather than
 * being shared across the two packages: the dependency direction is
 * service-automation → nothing-that-is-a-trigger, and a shared test fixture is
 * not worth inverting it.
 *
 * Restores the PREVIOUS value rather than deleting the key — "was unset" and
 * "deleted" are the same state only when the suite started from unset.
 */

import { afterEach, beforeEach } from 'vitest';
import { SCHEDULED_WORK_ENV } from '@objectstack/types';

/**
 * Run this file's suites on a deployment that HAS package-authored scheduled
 * work switched on — the state in which the engine arms `schedule` /
 * `time_relative` flows at all.
 *
 * ⚠️ A suite about trigger WIRING needs this. Without it the engine's audit
 * reports every such flow as *disabled by deployment policy* and binds none,
 * which is correct behaviour and a total failure of a wiring assertion.
 */
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
