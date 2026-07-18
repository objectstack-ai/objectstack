---
'@objectstack/service-automation': minor
---

fix(automation): region-aware run-history compaction keeps loop containers + early failures (#3234)

`compactStepsForHistory` bounded a terminal run's persisted step log to the last
`MAX_PERSISTED_HISTORY_STEPS` entries with a plain tail-slice. With the ADR-0031
structured-region step logs (#1505) a single `loop` can emit
`iterations × body-steps` entries, so the tail-slice dropped the
`loop`/`parallel`/`try_catch` **container** step (it precedes all its body steps)
and every early iteration — leaving `getRun`/`listRuns` (after a process restart
or ring-buffer eviction) with body steps the Runs surface could no longer nest,
and silently hiding an early failure.

Compaction is now region-aware (new exported `compactStepLogForHistory`): over
budget it keeps the run's structural backbone — every top-level step (including
the region container steps) and every failure, each pulled in with its ancestor
container chain — plus the most recent body steps, order-preserving and
hard-capped at `max` so `steps_json` stays bounded (#2585). Every retained body
step keeps its enclosing container(s), so the compacted log never contains an
orphan and the observability surface's per-iteration / per-region nesting still
reconstructs.
