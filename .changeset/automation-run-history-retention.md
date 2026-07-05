---
'@objectstack/service-automation': minor
---

Automation run observability follow-ups (#2585): retention for `sys_automation_run` run history, and durable single-run detail.

**Retention (closes the unbounded-growth risk #2581 introduced).** Terminal run-history rows are now bounded by default, ADR-0057 posture:

- A write-time per-flow cap keeps the newest 100 terminal runs per flow (`runHistoryMaxPerFlow`, `0` disables).
- A default-on periodic sweep deletes terminal rows older than 30 days (`runHistoryRetentionDays`, `0` disables; `runHistorySweepMs` tunes the interval, default 1 h).
- Suspended (`paused`) rows are live resumable state and are never pruned.

**Durable single-run detail.** `AutomationEngine.getRun(runId)` now falls back to the durable history row when the run is no longer in the in-memory buffer (e.g. after a restart), and terminal rows persist a bounded per-node step log (`steps_json`: newest 200 steps, stacks stripped, 64 KB cap) — so "open a past failed run and see which node blew up" survives a restart. New `SuspendedRunStore.loadTerminal(runId)` backs this; `RunRecord` gains `finishedAt` and `steps`.
