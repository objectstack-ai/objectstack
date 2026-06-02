# @objectstack/plugin-trigger-schedule

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 03fd7f0: Schedule flow trigger — auto-launch flows on a cron/interval/once schedule.

  The sibling of `@objectstack/plugin-trigger-record-change`: it completes the
  _time-based_ arm of the automation engine's `FlowTrigger` extension point. The
  engine already parses a flow's start node into a `schedule` binding
  (`flow.type === 'schedule'` or a start-node `config.schedule` descriptor); this
  plugin registers the concrete `schedule` trigger and delegates timing to the
  platform `IJobService` (the `'job'` service), so it stays adapter-agnostic — the
  job service selects a cron-capable adapter (durable `DbJobAdapter` /
  `CronJobAdapter`) for cron schedules and the interval adapter otherwise.

  - `normalizeSchedule` accepts the canonical `JobSchedule` plus shorthands (a
    bare cron string, `{ cron }` / `{ expression }`, `{ every }` / `{ intervalMs }`,
    `{ at }`).
  - When a job fires, the flow runs with `event: 'schedule'` and
    `params: { jobId, flowName, schedule }`; the engine's start-condition gate
    still applies.
  - Error-isolated (a flow failure never crashes the job runner); per-flow job
    name so `stop()` cancels exactly one flow; the job service is resolved lazily
    per bind so adapter upgrades are picked up; graceful degrade when the
    automation or job service is absent.

  No engine change required — the `schedule` binding shipped with the
  record-change trigger PR.

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
