# @objectstack/plugin-trigger-schedule

Auto-launch ObjectStack flows on a schedule (cron / interval / once).

The automation engine ships the `FlowTrigger` extension point and the wiring
that turns a flow's `start` node into a normalized trigger binding — but the
*concrete* schedule trigger lives here, as a plugin. It delegates timing to the
platform `IJobService` (the `'job'` service), so it stays adapter-agnostic: the
job service selects a cron-capable adapter (e.g. the durable `DbJobAdapter` or
`CronJobAdapter`) for cron schedules and the interval adapter for the rest.

This is the sibling of `@objectstack/plugin-trigger-record-change` — same
engine baseline, a different event source.

## What it does

A flow whose `start` node declares a schedule:

```ts
{
  type: 'start',
  config: {
    schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
    condition: "...", // optional start-condition gate
  },
}
// or simply: a flow with `type: 'schedule'` and a start-node schedule descriptor
```

auto-launches on that schedule — no manual `engine.execute()`. When it fires,
the flow runs with `event: 'schedule'` and `params: { jobId, flowName, schedule }`
in its context.

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
import { ScheduleTriggerPlugin } from '@objectstack/plugin-trigger-schedule';

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
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
    condition: '...',                // optional per-record start-condition gate
  },
}
```

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
import { ScheduleTriggerPlugin, TimeRelativeTriggerPlugin } from '@objectstack/plugin-trigger-schedule';

kernel
  .use(new ScheduleTriggerPlugin())      // plain schedule flows
  .use(new TimeRelativeTriggerPlugin());  // ← time-relative sweeps (needs the ObjectQL engine)
```

The discovery query runs as a system operation (RLS-bypassing — a background
sweep sees all rows), is capped at `maxRecords` per tick (logged when it
clamps), and isolates per-record failures so one bad row never aborts the sweep.
