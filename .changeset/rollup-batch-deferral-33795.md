---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

feat(objectql): a bulk update recomputes its parents' roll-up summaries once, at the end of the batch

Clause-②: yes (widening)
Metadata-protocol: none

**Added:** an optional member on the engine slot contract, `IObjectQLEngine.deferSummaryRecompute(callback)` in `@objectstack/spec` (and the same optional member on `MetadataHostEngine` in `@objectstack/metadata-protocol`). It is a callback, entered and left by the engine as `transaction` is; a nested call joins the open scope. Inside it, the roll-up `summary` recompute every write would run after itself is recorded, and runs once when the callback settles: one grouped aggregate per summary field and one write per parent for the whole batch. `ObjectQL` implements it. A caller probes for it; an engine without it keeps the per-row recompute, with the same values. Every way out of the callback recomputes: resolved, the callback's result (or `ERR_SUMMARY_RECOMPUTE` with `written` set to that result when a parent cannot be recomputed); rejected, the recompute still runs for the writes that landed and the callback's error is rethrown. Inside a transaction the recompute runs before the commit.

**Changed:** the bulk update doors run their per-row loop inside that scope: `updateManyData` (`PATCH /api/v1/data/:object/updateMany`, both arms) and the `update` operation of `batchData`. A 50-row bulk update over 10 parents with two summary fields went from 400 to 182 statements (one summary field: 350 to 181; no summary field: 150, unchanged), measured on SQLite and PostgreSQL 16. The stored values are unchanged for every summary kind.

Two things a caller can see:

- During a bulk update, a parent's summary holds its value from before the batch until the batch ends, as it already did during a predicate update and in the stored row during a multi-row insert. A hook, or a validation rule, on a child row that reads its parent's summary while the batch runs reads that pre-batch value; before this change each row saw the recompute of the rows before it. (A multi-row insert's validation rules see the batch's earlier rows through an in-memory overlay; a bulk update has no such overlay.)
- The parent's own write path (hooks, validation, audit entry, realtime event) runs once per recompute: once per parent for the whole batch, instead of once per child row.

Each row's own hooks, validation, audit and realtime run where they ran. An atomic bulk update whose end-of-batch recompute fails rolls back and answers the same rolled-back envelope a failed row answers (the last row that landed carries `ERR_SUMMARY_RECOMPUTE`, the rows before it `ROLLED_BACK`). A non-atomic one keeps its rows written, logs the stale summary once at `error`, and answers the rows as written, as a per-row recompute failure did.
