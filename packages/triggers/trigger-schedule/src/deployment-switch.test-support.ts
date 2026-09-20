// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17396] Test-only helpers for the deployment facts both triggers now read.
 *
 * ## Why a helper and not a `setupFiles` entry
 *
 * Arming the switch globally would make every suite in this package run in a
 * NON-default deployment while reading as if it ran in the default one — and
 * the default is precisely the state the ruling made interesting (nothing arms,
 * with a distinct reason). Each suite that needs the switch on says so, in one
 * line, at the top of the file. A reader who opens any of these files can see
 * which deployment the assertions below are about.
 *
 * ⛔ Not exported from `index.ts`. This file is outside the tsup entry
 * (`src/index.ts`), so it is compiled by the test program and shipped by
 * nothing.
 *
 * ⚠️ Mutates `process.env` and restores the PREVIOUS value rather than deleting
 * the key: a suite running under a CI environment that has already set one of
 * these variables must leave it exactly as it found it, and `delete` would be a
 * different end state from "was unset".
 */

import { afterEach, beforeEach } from 'vitest';
import { SCHEDULED_WORK_ENV } from '@objectstack/types';

const POSTURE_ENV = 'OS_TENANCY_POSTURE';

function setOrUnset(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * Run this file's suites on a deployment that HAS package-authored scheduled
 * work switched on, at the given tenancy posture.
 *
 * `posture` defaults to `'single'` — the platform default, and the state in
 * which a time-triggered flow binds while declaring no organization. A suite
 * about the declaration refusal passes `'isolated'`, because that refusal only
 * exists behind a wall.
 */
export function withScheduledWorkOn(posture: 'single' | 'group' | 'isolated' = 'single'): void {
  let priorSwitch: string | undefined;
  let priorPosture: string | undefined;
  beforeEach(() => {
    priorSwitch = process.env[SCHEDULED_WORK_ENV];
    priorPosture = process.env[POSTURE_ENV];
    process.env[SCHEDULED_WORK_ENV] = 'true';
    process.env[POSTURE_ENV] = posture;
  });
  afterEach(() => {
    setOrUnset(SCHEDULED_WORK_ENV, priorSwitch);
    setOrUnset(POSTURE_ENV, priorPosture);
  });
}

/**
 * Run this file's suites on a deployment that has NOT switched it on — the
 * global default, in every posture and every kernel.
 *
 * Both variables are cleared rather than merely left alone: a CI environment
 * that exported either one would otherwise make this suite assert about a
 * deployment it did not choose, which is the failure mode a default-OFF switch
 * makes easiest to miss (the suite would go green for the wrong reason on a box
 * where the switch happened to be off anyway, and red only elsewhere).
 */
export function withScheduledWorkOff(posture?: 'single' | 'group' | 'isolated'): void {
  let priorSwitch: string | undefined;
  let priorPosture: string | undefined;
  beforeEach(() => {
    priorSwitch = process.env[SCHEDULED_WORK_ENV];
    priorPosture = process.env[POSTURE_ENV];
    delete process.env[SCHEDULED_WORK_ENV];
    setOrUnset(POSTURE_ENV, posture);
  });
  afterEach(() => {
    setOrUnset(SCHEDULED_WORK_ENV, priorSwitch);
    setOrUnset(POSTURE_ENV, priorPosture);
  });
}
