// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineJob } from '@objectstack/spec';

/** Nightly job — recompute project health. Handler is registered in defineStack({ functions }). */
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
