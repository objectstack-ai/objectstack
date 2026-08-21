# @objectstack/service-job

The shipped provider for the kernel's **`job`** service slot — an `IJobService`
implementation with a durable ObjectQL-backed adapter, an in-memory timer adapter, and
a croner-backed cron adapter with cluster leader election.

Slot criticality: `core` (`ServiceRequirementDef` in `@objectstack/spec/system`).

## Installation

```bash
pnpm add @objectstack/service-job
```

## Usage

```typescript
import { ObjectKernel } from '@objectstack/core';
import type { IJobService } from '@objectstack/spec/contracts';
import { JobServicePlugin } from '@objectstack/service-job';

const kernel = new ObjectKernel();
await kernel.use(new JobServicePlugin());
await kernel.bootstrap();

const jobs = kernel.getService<IJobService>('job');

await jobs.schedule(
  'daily_report',
  { type: 'cron', expression: '0 9 * * *', timezone: 'America/New_York' },
  async ({ jobId }) => { await generateReport(jobId); },
  { retryPolicy: { maxRetries: 2, backoffMs: 1000 }, timeout: 60_000 },
);
```

⚠️ `schedule` takes **four positional arguments** — `(name, schedule, handler, options?)`
— not a single options object. The schedule is a `JobSchedule` discriminated on `type`.

## Adapter selection

`JobServicePluginOptions` has exactly four fields, all optional.

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `adapter` | `'auto' \| 'db' \| 'interval' \| 'cron'` | `'auto'` | See the table below. |
| `interval` | `IntervalJobAdapterOptions` | `{}` | Forwarded to `IntervalJobAdapter`. |
| `db` | `DbJobAdapterOptions` | `{}` | Forwarded to `DbJobAdapter`. |
| `enableCron` | `boolean` | `true` | Route cron schedules to `CronJobAdapter` when available. |

| `adapter` | Behaviour |
|:---|:---|
| `'auto'` | Registers `IntervalJobAdapter` synchronously, then upgrades to `DbJobAdapter` at `kernel:ready` if an ObjectQL engine is present. Stays on the interval adapter otherwise. |
| `'db'` | Same upgrade path, but logs a warning when no engine turns up. |
| `'interval'` | In-memory timer adapter only. **Cron registrations are stored but never fire** — the adapter warns about each one. |
| `'cron'` | In-memory `CronJobAdapter` only (croner-backed, with cluster leader election). |

The plugin registers the `sys_job` and `sys_job_run` platform objects through the
`manifest` service so Studio can see scheduled jobs and their runs; it warns and
continues when no manifest service is registered.

## Schedules

`JobSchedule` (from `@objectstack/spec/contracts`) is the runtime-value shape the
schedulers consume:

| `type` | Fields read |
|:---|:---|
| `'cron'` | `expression` (a bare cron string), `timezone` |
| `'interval'` | `intervalMs` |
| `'once'` | `at` (ISO 8601 datetime) |

```typescript
{ type: 'cron', expression: '*/5 * * * *', timezone: 'UTC' }
{ type: 'interval', intervalMs: 30_000 }
{ type: 'once', at: '2026-12-25T09:00:00Z' }
```

## Service API

`IJobService` declares three required members and four optional ones:

```typescript
import type { IJobService } from '@objectstack/spec/contracts';

// required
//   schedule(name, schedule, handler, options?) -> Promise<void>
//   cancel(name)                                -> Promise<void>
//   trigger(name, data?)                        -> Promise<void>
// optional
//   getExecutions?(name, limit?)                -> Promise<JobExecution[]>
//   listJobs?()                                 -> Promise<string[]>
//   replay?(name, data?)                        -> Promise<void>
//   listExecutionsByStatus?(status, limit?)     -> Promise<JobExecution[]>
```

`schedule` resolves `void` — it does not return a job handle. There is no `getJob`,
`stopJob`, `resumeJob`, `deleteJob`, `runNow`, `scheduleInterval`, `scheduleOnce`,
`getJobHistory` or `clearHistory`: cancelling is `cancel(name)`, running it now is
`trigger(name)`, and history is `getExecutions(name, limit?)`.

## Handlers

```typescript
import type { JobHandler } from '@objectstack/spec/contracts';

const handler: JobHandler = async ({ jobId, data }) => {
  // …
};
```

The handler receives `{ jobId, data? }` — there is no kernel reference, no execution
count and no scheduled-time field on it. Three outcomes:

| The handler… | Means | Recorded as |
|:---|:---|:---|
| throws / rejects | the run **failed** | `failed` — the retry policy applies |
| resolves `undefined` (or `{ outcome: 'completed' }`) | the run **succeeded** | `success` |
| resolves `{ outcome: 'degraded', reason? }` | ran to completion, work did not happen | a status distinct from `success` |

⚠️ `degraded` is **not** a failure and does **not** trigger a retry. Retry is driven
exclusively by a rejected promise; a handler that wants a re-run must throw.

## Retry and timeout

`JobScheduleOptions` threads a per-job policy down to the executing adapter. Defaults
mirror `RetryPolicySchema` in `@objectstack/spec` — the declared default *is* the
enforced one:

| Field | Default | Notes |
|:---|:---|:---|
| `retryPolicy.maxRetries` | `0` | Attempts **after** the initial run; `0` means no retry. |
| `retryPolicy.backoffMs` | `1000` | Base delay before the first retry. |
| `retryPolicy.backoffMultiplier` | `1` | A flat delay by default. |
| `retryPolicy.maxRetryDelayMs` | `30000` | Ceiling for one backoff delay. |
| `retryPolicy.jitter` | `false` | Randomise each delay within [50%, 100%]. |
| `timeout` | none | Per-**attempt** limit in ms; an exceeded run is recorded `timeout` and rejects with `JobTimeoutError`. |

JavaScript cannot forcibly cancel an in-flight handler: on timeout the attempt is
abandoned, not killed.

`runWithPolicy(jobId, run, options?, recorder?)` is exported so a host building its own
adapter applies exactly these semantics instead of re-deriving them.

## Adapter options

| Adapter | Option | Default | Purpose |
|:---|:---|:---|:---|
| `IntervalJobAdapter` | `maxExecutions` | `100` | Execution records retained per job. |
| | `logger` | none | Surfaces cron registrations this adapter cannot fire. |
| `CronJobAdapter` | `timezone` | `'UTC'` | Timezone for cron expressions. |
| | `maxExecutions` | `100` | Execution history per job. |
| | `cluster` | none | Cluster service for scheduler leader election — with a remote driver only ONE node fires each job. |
| | `leaseMs` | `60000` | Lease held while a scheduled fire runs. |
| | `namespace` | none | Cosmetic label in croner's process-global name registry. |
| | `logger` | none | Registry-level anomalies. |
| `DbJobAdapter` | `maxExecutions` | `100` | Executions kept in memory per job (forwarded to the inner `IntervalJobAdapter`). |
| | `recordRuns` | `true` | Whether each run writes a `sys_job_run` row. `false` keeps the in-memory history only. |

## No HTTP surface

This service is kernel-internal: it is consumed in-process via the service registry
(`kernel.getService('job')`) and mounts **no** REST routes. Discovery advertises no
route for the `job` slot and reports `handlerReady: false` — for this slot that is the
fact itself, not a proxy for reduced capability (ADR-0076 D12).

## Exports

```typescript
import {
  JobServicePlugin, IntervalJobAdapter, CronJobAdapter, DbJobAdapter,
  runWithPolicy, JobTimeoutError,
} from '@objectstack/service-job';
```

Types: `JobServicePluginOptions`, `IntervalJobAdapterOptions`, `CronJobAdapterOptions`,
`DbJobAdapterOptions`, `JobEngineLike`, `JobLoggerLike`.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec/contracts](../../spec/src/contracts/)
- [Cron Expression Generator](https://crontab.guru/)
- [Queue Service](https://objectstack.ai/docs/kernel/runtime-services/queue-service)
