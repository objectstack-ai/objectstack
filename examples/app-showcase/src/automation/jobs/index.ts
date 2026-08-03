// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineJob } from '@objectstack/spec';

export { sweepProjectHealth, bindShowcaseJobRuntime, healthFor } from './sweep-project-health.js';

/**
 * Nightly job — recompute project health.
 *
 * `handler` names a key of `defineStack({ functions })` (the only form
 * `JobSchema.handler` accepts); `sweepProjectHealth` is registered there with
 * `effect: 'writes'`. It was declared here for a long time with no function of
 * that name anywhere in the example, so the AppPlugin skipped it at every boot
 * and the sweep never ran (#4774 / #4888) — see `./sweep-project-health.ts`.
 */
export const HealthSweepJob = defineJob({
  name: 'showcase_health_sweep',
  label: 'Nightly Project Health Sweep',
  description: 'Recomputes project health from budget burn and task progress.',
  schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
  handler: 'sweepProjectHealth',
  retryPolicy: { maxRetries: 2, backoffMs: 5000, backoffMultiplier: 2 },
  timeout: 300000,
  enabled: true,
});

export const allJobs = [HealthSweepJob];
