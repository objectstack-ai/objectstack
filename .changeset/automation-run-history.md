---
"@objectstack/service-automation": minor
---

feat(automation): durable run history — every terminal run leaves a queryable record with its failure reason

Automation runs were observable **only in memory**: the engine kept the last N
`ExecutionLogEntry` records in a ring buffer, so "did this flow run, and why did
it fail?" could not be answered after a process restart (or once the buffer
evicted the entry), and a failed run surfaced no reason at all. This was the
biggest silent-trust gap for anyone authoring automations — a flow could stop
firing or start failing with nothing durable to inspect.

`sys_automation_run` — previously the ADR-0019 store for *live suspended* runs
only — becomes a durable **run-history** table. On every terminal run the engine
mirrors a row through the `SuspendedRunStore` (`recordTerminal`): `status`
(`completed` / `failed`), `finished_at`, `duration_ms`, and, for a failure, the
`error` message a designer needs to fix it. `listRuns()` merges this durable
history with the in-memory buffer (in-memory wins on id, newest-first) so the
Studio "Runs" surface shows runs that predate the current process.

The design is **safe and additive**. Terminal history rows use a `run_`-prefixed
id, disjoint from live suspended runs (which key on the raw `runId` with
`status: 'paused'`), so the suspend save/load/delete/list path is untouched and
resume sweeps (`list()` filters `status: 'paused'`) never see history rows.
Persisting is **best-effort and fire-and-forget** — a history-write failure is
logged and swallowed, never breaking the run that produced it. New object fields
(`finished_at`, `duration_ms`, `error`) are all optional and the `status` enum
gains `running` / `completed` / `failed` alongside the existing `paused`.

Verified end-to-end on a clean showcase instance: a schedule-triggered flow and
seven task-completion flows each left durable `completed` rows; a genuinely
failing flow (`showcase_resilient_sync`) left a `failed` row carrying its
`try_catch` failure reason; a live `paused` suspended run coexisted without
collision; and after a full process restart the `failed` row — reason intact —
was still queryable via `/api/v1/data/sys_automation_run`. New `run-history.test.ts`
covers completed/failed persistence, read-across-restart, and best-effort isolation.
