---
'@objectstack/runtime': patch
---

fix(runtime): a declarative job's `JobRunOutcome` reaches the adapter that records it (#14256)

`AppPlugin`'s declarative-job registration block handed `IJobService.schedule` a
block-bodied arrow that *awaited* the bundle handler and returned nothing, so
the wrapper was a `Promise<void>` whatever the handler resolved. Measured
through an `IJobService` typed only at the contract:

```
HANDLER RESOLVED: {"outcome":"degraded","reason":"STORE_UNAVAILABLE"}
WRAPPER RESOLVED: undefined
```

#6617's third outcome was therefore unreachable from `defineJob`. All three
shipped adapters (`cron-job-adapter`, `interval-job-adapter`, `db-job-adapter`)
map a resolved `{ outcome: 'degraded', reason }` onto a run status distinct from
`success` — they simply never got the value on this path, so a declarative job
that ran to completion while its work did not happen (store unavailable, zero
rows matched) was recorded as `success` with `reason` dropped. The three-outcome
table in `content/docs/automation/jobs.mdx` — the page whose whole subject is
the declarative door — was false on exactly that door. The imperative route (a
handler registered straight on `IJobService.schedule`) was unaffected
throughout; the wrapper is the whole defect.

The repair is to return the handler's resolved value. Patch rather than minor:
no export, type, schema or authoring surface changes, and `JobHandler` has
declared `Promise<void | JobRunOutcome>` since #6617 — this makes the declared
contract true on a route where it was not. Additive in the ruling's sense: a
handler resolving `undefined` (every handler written before #6617) still
resolves `undefined` through the wrapper and still takes the `success` branch.
The one visible change for an existing app is the correction itself — a
declarative handler that *was already* resolving `{ outcome: 'degraded' }` now
lands `sys_job_run.status: 'degraded'` (reason in `error`, `failure_count` flat,
still never retried) where it previously landed `success`.

Pinned by `packages/runtime/src/app-plugin.job-degraded-outcome.test.ts`, which
drives the real `DbJobAdapter` over a real ObjectQL engine carrying the real
`sys_job` / `sys_job_run` declarations and asserts the persisted cell, not the
wrapper's return value.
