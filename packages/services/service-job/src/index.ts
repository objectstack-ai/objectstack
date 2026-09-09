// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { JobServicePlugin } from './job-service-plugin.js';
export type { JobServicePluginOptions } from './job-service-plugin.js';
export { IntervalJobAdapter } from './interval-job-adapter.js';
export type { IntervalJobAdapterOptions } from './interval-job-adapter.js';
export { CronJobAdapter } from './cron-job-adapter.js';
export type { CronJobAdapterOptions } from './cron-job-adapter.js';
export { DbJobAdapter } from './db-job-adapter.js';
// `ReplayGuard` / `ReplayGuardDecision` are exported for NAMEABILITY, not
// because a caller is expected to import them by hand: `DbJobAdapter` is
// exported from this barrel and its public `setReplayGuard(name, guard)` takes
// a `ReplayGuard`, so leaving the type unnameable from this package would make
// a public parameter type impossible to write down — the same precedent
// `@objectstack/service-automation` records for its own store ports.
export type {
    DbJobAdapterOptions,
    JobEngineLike,
    JobLoggerLike,
    ReplayGuard,
    ReplayGuardDecision,
} from './db-job-adapter.js';
// JobRunRetention was retired (ADR-0057): sys_job_run declares a `lifecycle`
// window and the platform LifecycleService is the one sweeper.
export { runWithPolicy, JobTimeoutError } from './run-with-policy.js';
