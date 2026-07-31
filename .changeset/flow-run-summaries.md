---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

feat(spec,service-automation): every flow run reports what it actually did — selected / acted / skipped (#4354)

`success: true` never meant "it did its job". A scheduled sweep that selects
thirty records and writes none is, from outside, **identical** to one with
nothing to do: same green status, same empty output, same silence, same schedule
tomorrow. There was no signal anywhere that separated "nothing to do" from
"broken".

That is not theoretical. #4347 left three hotcrm production flows completely
inert — the stalled-deal sweep found every stalled deal and nudged nobody, the
renewal sweep booked nothing, the campaign action enrolled no leads. They ran
daily, on time, green, for as long as they had existed, and were caught only by
adding tests that assert on records written. Automation is exactly the category
where nobody is watching: a UI bug files a ticket within the hour, a dead sweep
files nothing, and the longer it runs the more normal the silence looks.

**Every terminal run now carries a `FlowRunSummary`** — on the
`AutomationResult`, on the run in `listRuns` / `getRun`, in the log, and in the
database:

```
[automation] run flow=stalled_deal_sweep run=run_a1b2 status=completed durationMs=142 selected=30 acted=0 skipped=30 gate=check_stalled->send_nudge:30
```

- `selected` — records read by the run's data nodes
- `acted` — records created / updated / deleted, plus effects dispatched
  (notifications delivered)
- `skipped` — node executions a closed gate prevented, one per loop iteration
  whose conditional edge evaluated false
- `nodes[]` — per-node terminal status with `runs` / `failures` / `skipped`
- `gates[]` — which gates closed and how often, most-skipped first

**The counts are declared, not sniffed.** Executors report
`NodeExecutionResult.metrics`, because only the node knows what its result
*means*: `update_record`'s is a row count on a bulk write and a record on a by-id
one, `delete_record`'s can be a boolean, `notify`'s is a delivery count. An
engine inferring from output shapes would be guessing, and a machine-readable
count that guesses is worse than none. A node that touches no records
(`decision`, `assignment`) reports nothing — absent is not `0`.

**The gate is named.** A conditional out-edge that evaluates false now records a
`skipped` step tagged with the gate that closed. That event previously left no
trace at all, which is why #4347 was invisible: the flow selected every row and
the loop-body edge never opened. A skipped step is explicitly *not* a run — the
ADR-0044 re-entry guard, per-node `runs`, and node status all exclude it, so a
new observability signal cannot change execution semantics.

**Queryable, so it can be alerted on rather than noticed.**
`sys_automation_run` gains `selected_count` / `acted_count` / `skipped_count`
columns plus a `summary_json` breakdown:

```typescript
const suspect = await engine.find('sys_automation_run', {
  where: { status: 'completed', selected_count: { $gt: 0 }, acted_count: 0 },
  orderBy: [{ field: 'started_at', order: 'desc' }],
});
```

`selected > 0 && acted == 0` over consecutive runs is a near-perfect
broken-sweep detector. Columns, not JSON: an operator can only alert on what is
filterable. Rows written before this carry `null`, never `0` — "not measured"
must not read as "measured zero", or every legacy row is a false alarm the first
time someone writes that query.

Two details that decide whether the numbers can be trusted. The summary is
folded from the **full** step log before history compaction, so a
5000-iteration sweep does not silently report the ~200 steps that fit in
`steps_json`; and rehydration reads the persisted `summary_json` rather than
re-folding those compacted steps. A `subflow` rolls its child's totals into its
parent, so a sweep that delegates its writes is not read as inert — the child
keeps its own run row, and the parent's summary answers "what did this run
cause".

Additive throughout: `summary` is optional everywhere it appears, existing runs
and stores keep working, and no execution behaviour changes. The one-line log
defaults to `info` — a line nobody sees at their production level is the same
non-signal this closes — with `AutomationServicePlugin`'s
`runSummaryLog: 'debug' | 'off'` to turn the volume down on a very
high-frequency flow without turning the measurement off.

New spec exports: `FlowRunSummarySchema`, `FlowRunNodeSummarySchema`,
`FlowRunGateSummarySchema`, `ExecutionStepMetricsSchema`,
`ExecutionStepSkipReasonSchema` (+ inferred types); `ExecutionLog.summary` and
`ExecutionStepLog.metrics` / `.skippedBy`. `service-automation` exports
`summarizeRun` / `formatRunSummaryLine` so a host building its own surface
reuses the platform's definition instead of re-deriving one.

Does not fix #4347 itself — this is the instrument that would have caught it.

Verified: `@objectstack/service-automation` **522 tests / 46 files** (23 new),
`@objectstack/spec` **7165 / 279** (5 new), `@objectstack/runtime` **974 / 68**,
`@objectstack/plugin-approvals` **330 / 13**; all eight `@objectstack/spec`
`check:generated` gates plus `check:liveness` and `check:exported-any`; and
`tsc --noEmit` on service-automation at its ledgered 2 pre-existing errors.
