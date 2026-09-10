# @objectstack/trigger-schedule

Auto-launch ObjectStack flows on a schedule (cron / interval / once).

The automation engine ships the `FlowTrigger` extension point and the wiring
that turns a flow's `start` node into a normalized trigger binding — but the
*concrete* schedule trigger lives here, as a plugin. It delegates timing to the
platform `IJobService` (the `'job'` service), so it stays adapter-agnostic: the
job service selects a cron-capable adapter (e.g. the durable `DbJobAdapter` or
`CronJobAdapter`) for cron schedules and the interval adapter for the rest.

This is the sibling of `@objectstack/trigger-record-change` — same
engine baseline, a different event source.

## What it does

A flow whose `start` node declares a schedule **and the organization it runs
as**:

```ts
{
  type: 'start',
  config: {
    schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
    organization: '<sys_organization.id>', // REQUIRED — see below
    condition: "...", // optional start-condition gate
  },
}
// or simply: a flow with `type: 'schedule'` and a start-node schedule descriptor
```

auto-launches on that schedule — no manual `engine.execute()`. When it fires,
the flow runs with `event: 'schedule'`, `tenantId` set to the declared
organization, and `params: { jobId, flowName, schedule }` in its context.

### The acting organization is required

A scheduled run has no session to inherit a tenant from, so it carries no
organization unless the flow declares one. Without it every tenant-scoped write
beneath the run — the inbox rows a `notify` node emits, the
`sys_automation_run` history row — is refused on any install holding more than
one `sys_organization`, while the tick still reports itself healthy.

So `config.organization` is **required on every `schedule` and `timeRelative`
flow**, and a flow that omits it is **refused at bind**: the trigger logs the
reason at `error` naming the flow, and throws, so the engine records the flow as
NOT bound — it appears in `getTriggerBindingAudit()` and in the CLI's startup
summary, and `getFlowRuntimeStates()` reports `bound: false`. There is
deliberately no fallback: no platform organization, no "the install's only one".
A sweep wanted in several organizations is declared once per organization; a
single flow is never fanned out across them.

⚠️ The start node's `config` is an open record, so a near-miss spelling
(`organizationId`, `org_id`, `tenantId`, …) parses and is then ignored. The
refusal names the spelling you wrote.

### Schedule shapes

`normalizeSchedule` accepts the canonical `JobSchedule` plus shorthands:

| Input                                          | Normalized                               |
| ---------------------------------------------- | ---------------------------------------- |
| `{ type: 'cron', expression, timezone? }`      | cron                                     |
| `'0 1 * * *'` (bare string)                    | `{ type: 'cron', expression: '0 1 * * *' }` |
| `{ cron }` / `{ expression }`                  | cron                                     |
| `{ type: 'interval', intervalMs }` / `{ every }` | interval                               |
| `{ type: 'once', at }` / `{ at }`              | once                                     |

## Usage

```ts
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { JobServicePlugin } from '@objectstack/service-job';
import { ScheduleTriggerPlugin } from '@objectstack/trigger-schedule';

kernel
  .use(new AutomationServicePlugin())  // engine + flows
  .use(new JobServicePlugin())         // the 'job' service (cron/interval/db)
  .use(new ScheduleTriggerPlugin());   // ← makes schedule flows live
```

Depends on the job service plugin (`com.objectstack.service.job`) so its
`kernel:ready` adapter upgrade runs first; the job service is nonetheless
resolved lazily per bind, so adapter upgrades are always picked up. If the
automation or job service is unavailable, the plugin logs a warning and no-ops
rather than failing startup.

## Error isolation

A flow that throws during a scheduled run is logged and swallowed — it never
crashes the job runner.

## Time-relative trigger (`TimeRelativeTriggerPlugin`)

The **declarative** answer to "act on records whose date field is coming up (or
overdue)" (#1874) — without the fragile date-equality-on-record-change pattern
(which only fires if a record happens to be edited on the threshold day) or a
hand-rolled cron + range query per flow.

A flow whose `start` node declares a `timeRelative` descriptor is swept on a
schedule and launched **once per matching record**:

```ts
{
  type: 'start',
  config: {
    timeRelative: {
      object: 'contracts',
      dateField: 'end_date',
      offsetDays: [60, 30, 7],       // T-minus reminders — fires on each threshold day
      // — or — withinDays: 30       // "expiring soon" range (negative = overdue lookback)
      filter: { status: 'active' },  // optional, ANDed with the date window
      maxRecords: 1000,              // optional per-sweep cap (default 1000)
    },
    organization: '<sys_organization.id>', // REQUIRED — same refusal as above
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
    condition: '...',                // optional per-record start-condition gate
  },
}
```

The sweep owes the acting organization for a **stronger** reason than a plain
schedule flow does, and it is the value that BOUNDS THE QUERY. The sweep runs
elevated on purpose (`context: { isSystem: true }` — a background sweep must see
every row, not the RLS-scoped subset an absent user would see), so nothing else
keeps its selection inside one organization: the declared id is passed as
`context.tenantId` on the same query, the engine turns that into
`DriverOptions.tenantId`, and the driver scopes the read. Selection and
identity are then the same organization. A `timeRelative` flow that declares
none takes the same bind-time refusal.

⚠️ Elevation and tenancy are **independent axes** — `isSystem` decides what the
sweep is allowed to see, `tenantId` decides whose rows they are. A sweep that
passed only the first was a cross-organization scheduled task even with a
declaration on the flow: it matched rows in every tenant and launched runs
stamped with one, so `update_record` matched nothing, `notify` posted into the
declared organization's inbox about another organization's record, and the
history row landed under the record's organization rather than the run's.

Two consequences worth knowing before you declare one:

- **A store that cannot scope refuses the sweep rather than answering it.**
  `@objectstack/driver-memory` implements no row-level tenant isolation and
  refuses any call handed a tenant scope (`MEMORY_MULTI_TENANT_UNSUPPORTED`), so
  a scoped sweep there fails loudly every tick instead of quietly selecting
  every organization's rows. Multi-organization deployments use
  `@objectstack/driver-sql`.
- **On a platform-global or federated object the declaration cannot narrow
  anything.** The engine drops the tenant scope for an object declaring
  `tenancy: { enabled: false }` (ADR-0066) or carrying `external` (ADR-0015), so
  such a sweep still selects across every organization while its runs act as the
  declared one. The trigger says so at bind time, at `warn`, naming the object —
  ⛔ it does not pretend the flow is contained.

The matched record rides on the automation context (`event: 'time_relative'`,
`record`, `params`), so the start-node `condition` gate and `{record.<field>}`
interpolation work exactly as for a record-change flow. Because the window is
evaluated **every day**, a threshold is never missed regardless of when the
record last changed.

| Mode                | Semantics (day-granular, UTC, always includes today)                  |
| ------------------- | --------------------------------------------------------------------- |
| `withinDays: N`     | `dateField ∈ [today, today + N]` (upcoming). `N < 0` = overdue lookback. |
| `offsetDays: [a,b]` | one single-day match per offset (`today + a`, `today + b`, …).         |

It needs both the job service (sweep cadence) **and** the ObjectQL engine (the
date-window query); register it alongside the schedule trigger:

```ts
import { ScheduleTriggerPlugin, TimeRelativeTriggerPlugin } from '@objectstack/trigger-schedule';

kernel
  .use(new ScheduleTriggerPlugin())      // plain schedule flows
  .use(new TimeRelativeTriggerPlugin());  // ← time-relative sweeps (needs the ObjectQL engine)
```

The discovery query runs as a system operation (RLS-bypassing — a background
sweep sees all rows), is capped at `maxRecords` per tick (logged when it
clamps), and isolates per-record failures so one bad row never aborts the sweep.
