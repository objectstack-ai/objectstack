---
"@objectstack/service-automation": patch
---

fix(service-automation): the documented broken-sweep predicate is a first FILTER, not the detector (#12685)

`patch`, and not empty: `sys_automation_run`'s field descriptions are shipped,
translated, operator-facing text — they are what an admin reads in Setup while
wiring an alert they will then trust for months. No counter, no schema and no
engine behaviour changes here; the run summary measured by #4354 is correct and
untouched.

## The wrong claim

`acted_count` advertised `selected_count > 0 AND acted_count = 0 AND
unmeasured_count = 0` as *the* broken-sweep signal, unqualified. Measured A/B on
one graph pair through the real engine — a healthy idempotent sweep (re-select
the same records, gate each one on "was this already handled") and a dead gate
(#4347's shape, the gate sitting in front of the lookup) — **both** report
`selected > 0, acted 0, unmeasured 0`. The predicate cannot make the one
distinction it was advertised to make.

"Over N consecutive runs" does not rescue it either: the healthy steady state
trips it on *every* run for as long as the outstanding work stands, so it is
persistent rather than transient. Consecutiveness filters flapping, which is a
different failure.

Why a wrong sentence here is worse than a wrong sentence elsewhere: a detector
that fires during normal operation gets muted, and a muted broken-sweep detector
is the same silence #4347 produced — with the added cost that it now *looks*
monitored.

## What the descriptions say now

- `acted_count` states the predicate as the **first filter** and names the
  discriminator: a healthy skip is accounted for by a read the run performed
  (the lookup the gate depends on shows `runs > 0` and `selected > 0` in
  `summary_json.nodes[]`), while a dead gate skips just as often with nothing
  behind it (`runs: 0`, or `selected: 0`).
- `skipped_count` points at the same fold — `gates[]` names which edge closed
  and how often, `nodes[]` says whether the lookup behind it found anything.
- `unmeasured_count` keeps its own point (why the third clause exists) and now
  calls the query a filter rather than an alert.

The discriminating data was already shipped by #4354; nothing new is measured
and no detector is implemented in the platform. `run-summary.test.ts` pins the
pair as executable evidence: both shapes match the filter, and the per-node fold
separates them. `content/docs/automation/flows.mdx` carries the same correction
with the measured table and the two authoring shapes that make a sweep's signal
quiet in its healthy steady state.
