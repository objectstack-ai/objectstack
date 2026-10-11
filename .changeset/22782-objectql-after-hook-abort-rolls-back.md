---
'@objectstack/objectql': minor
---

An `after*` hook whose `onError` is `abort` (the default) now rolls its write back on the default write door, as `HookSchema.onError` says ("abort: Rollback transaction (if blocking)")

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A change to what the write door stores when a hook aborts: no key of the hook schema or of any other metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. A hook that loaded before keeps its authored shape; what changes is that the refused write no longer leaves its row behind. No ADR-0087 id covers this rule and this diff adds none. -->

**BREAKING** stored-outcome narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0087, the ratified pre-launch launch-window exemption, as amended 2026-09-13, #18003).

- **FROM:** `insert` / `update` / `delete` (REST `createData` / `updateData` / `deleteData`, `ctx.api`, the engine door) on an object with a blocking (not `async`) `after*` hook bound from metadata whose `onError` is `abort` or omitted. When that hook threw, the caller was refused, but the row stayed stored, changed or deleted, and so did every write the hook chain had already made through `ctx.api`. A client that retried the refused create made a duplicate.
- **TO:** that write runs inside a unit of work, so the abort rolls back the row and the hook chain's engine writes together. The caller is refused exactly as before. Hook count and order are unchanged.
- **Unchanged:** a write already inside a unit (a caller's `transaction()`, an atomic batch or cascade) joins it, and that unit's owner still decides. No unit is opened for an `onError: 'log'` or `async: true` hook that carries no `condition` (#22856), a hook registered in code with `registerHook` (no declared `onError`), a write with `skipAutomations`, an object whose datasource is not the default one, or a default driver with no transactions (ADR-0119 D1, such as a libSQL remote transport). On those the row stays stored after an abort, as before.
- **Inside the new unit, the rules of any unit apply.** An `after*` hook on such an object that writes a business row to an object on another datasource is now refused with `CrossDatasourceTransactionWriteError`, which the abort turns into a refused write. A MongoDB default store needs a replica set for this unit, as it does for `transaction()` already. If either applies to you, mark the hook `onError: 'log'` or `async: true`, or keep the objects on one datasource.
- **A sandboxed hook body's own `ctx.api.transaction`** on such an object, when no transaction is open around the write, used to open and own its transaction, so a throw from it rolled back only the body's own writes and the triggering row stayed stored. It now joins the door's unit, as it joins any open unit, and the abort rolls back the triggering row too.
- **Work a unit starts and does not await** (an `async: true` hook) no longer inherits the unit's finished transaction handle. It used to fail with "Transaction query already complete" and lose its write. It now runs on its own connection, as it would outside any unit.
- **Cost:** one transaction per write on the objects above only. Measured on the in-process SQLite driver: about 1.36x the per-insert time of the same object with an `onError: 'log'` hook. Objects without such a hook pay one map lookup.
