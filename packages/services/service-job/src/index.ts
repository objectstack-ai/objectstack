// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { JobServicePlugin } from './job-service-plugin.js';
export type { JobServicePluginOptions } from './job-service-plugin.js';
export { IntervalJobAdapter } from './interval-job-adapter.js';
export type { IntervalJobAdapterOptions } from './interval-job-adapter.js';
export { CronJobAdapter } from './cron-job-adapter.js';
export type { CronJobAdapterOptions } from './cron-job-adapter.js';
export { DbJobAdapter } from './db-job-adapter.js';
export type { DbJobAdapterOptions, JobEngineLike, JobLoggerLike } from './db-job-adapter.js';
// JobRunRetention was retired (ADR-0057): sys_job_run declares a `lifecycle`
// window and the platform LifecycleService is the one sweeper.
export { runWithPolicy, JobTimeoutError } from './run-with-policy.js';
