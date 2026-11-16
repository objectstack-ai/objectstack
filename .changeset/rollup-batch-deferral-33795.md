---
'@objectstack/spec': patch
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': patch
---

feat(objectql): a bulk update recomputes its parents' roll-up summaries once, at the end of the batch

Clause-②: yes (widening)
Metadata-protocol: semantic
Skills-docs: follow-up owed — `skills/objectstack-data/rules/relationships.md` (Roll-up Summaries: "the engine recomputes it server-side whenever a child is inserted/updated/deleted") does not say that a bulk update recomputes once at the end of the batch, that a summary a rule reads still recomputes after each row, or that a hook reads the pre-batch value meanwhile (ruling 6928862195); it moves as a governed skills-only change. `content/docs/data-modeling/fields.mdx` is updated here.

**Added:** an optional member on the engine slot contract, `IObjectQLEngine.deferSummaryRecompute(callback)` in `@objectstack/spec` (and the same optional member on `MetadataHostEngine` in `@objectstack/metadata-protocol`). It is a callback, entered and left by the engine as `transaction` is; a nested call joins the open scope. Inside it, the roll-up `summary` recompute every write would run after itself is recorded, and runs once when the callback settles: per child object and caller, one grouped aggregate per summary field and one write per parent for the whole batch. `ObjectQL` implements it. A caller probes for it; an engine without it keeps the per-row recompute, with the same values. Every way out of the callback recomputes: resolved, the callback's result (or `ERR_SUMMARY_RECOMPUTE` with `written` set to that result when a parent cannot be recomputed); rejected, the recompute still runs for the writes that landed and the callback's error is rethrown. Opened inside a transaction, the scope's recompute runs before the commit. Only writes under the transaction the scope was opened in (or under none) are deferred: a write under another transaction opened within the scope, such as a hook's own `ctx.api.transaction` or an atomic batch reached from inside a non-atomic one, recomputes at once inside that transaction, as before, because that transaction may commit before the scope ends.

**Changed:** the bulk update doors run their per-row loop inside that scope: `updateManyData` (`PATCH /api/v1/data/:object/updateMany`, both arms) and the `update` operation of `batchData`. A 50-row bulk update over 10 parents with two summary fields went from 400 to 182 statements (one summary field: 350 to 181; no summary field: 150, unchanged), measured on SQLite and PostgreSQL 16. The stored values are unchanged for every summary kind.

Two things a caller can see, which is why this declares `Metadata-protocol: semantic` (when an authored hook runs and what it reads move, as in `33760-async-hook-on-commit`):

- A hook or a flow step that reads a parent's summary during a bulk update reads the value from before the batch until the batch ends, as it does during a bulk create; before this change each row's hook saw the recompute of the rows before it. Rules do not change against today: a summary field a rule reads is not deferred (ruling 6928862195). A validation rule of any object that reads it one hop through a reference, or a detail object's `requiredWhen` / `readonlyWhen` that reads it on `parent`, makes that roll-up recompute after each row inside the batch, so a bulk update answers such a rule as one-by-one updates do, for every summary function (two contacts set primary in one grid edit: the first is admitted, the second refused with the rule's text). A `parent.` predicate that reads a field that is not a summary (`parent.status == 'paid'`) does not turn the deferral off.
- The parent's own write path (hooks, validation, audit entry, realtime event) runs once per recompute: once per parent for the whole batch, instead of once per child row.

The scope is ambient, not tied to the object being updated: a write a hook issues while the batch runs under the batch's own transaction (or under none, for a non-atomic batch), on any object (a hook's own insert, update or delete, for instance a child-row hook that inserts a row into a second child object of the same parent), has its roll-up recompute deferred to the end of the batch as well, so a summary over that second object also reads its pre-batch value until the batch ends.

Each row's own hooks, validation, audit and realtime run where they ran. An atomic bulk update whose end-of-batch recompute fails rolls back and answers the same rolled-back envelope a failed row answers (the last row that landed carries `ERR_SUMMARY_RECOMPUTE`, the rows before it `ROLLED_BACK`). A non-atomic one keeps its rows written, logs the stale summary once at `error`, and answers the rows as written, as a per-row recompute failure did.
