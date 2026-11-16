---
'@objectstack/objectql': minor
---

fix(objectql)!: a write refused after its `before*` hook wrote through `ctx.api` no longer keeps that hook's write

Clause-②: no (narrowing)
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. A hook that loaded before keeps its authored shape. What changes is the meaning of a declared `before*` hook: the write door now opens its unit of work for it, so the hook's `ctx.api` writes roll back with a refused write and the rules of any unit apply on more objects. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** stored-outcome narrowing, shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** `insert` / `update` / `delete` (REST `createData` / `updateData` / `deleteData`, `ctx.api`, the engine door, single and predicate writes) on an object whose `before*` hook for that verb is bound from metadata, and that has no `after*` hook able to abort. The write door opened no unit of work. A `before*` hook that wrote another record through `ctx.api` committed that write at once, so when the write was refused later in the same call (a declared validation, a later `before*` hook, a driver constraint), the caller was refused and the hook's record stayed stored. Example: a `beforeInsert` hook on a time entry creates the week's timesheet, the entry is refused by `hours > 24`, and an empty timesheet remains.
- **TO:** a `beforeInsert`, `beforeUpdate` or `beforeDelete` hook bound from metadata opens the write door's unit for writes of its verb, whatever its `onError`. A refusal anywhere in that write rolls back the row and every `ctx.api` write the hook chain made. The caller is refused exactly as before. Hook count and order are unchanged.
- **A `before*` write meant to survive a refusal now rolls back.** There is no per-hook opt-out: `onError: 'log'` decides only whether the hook's own throw refuses the write, not whether its writes survive a refusal elsewhere. The one exception is an append-only ledger on another datasource (an object whose `lifecycle.class` is `audit`, `telemetry` or `event`), which is written outside the unit and survives the rollback, as in any unit. **Fix, if you relied on it:** record the attempt from an `after*` hook with `async: true` (it runs only after a commit), or record it where the write is made.
- **Inside the new unit, the rules of any unit apply,** so writes that were accepted are now refused on objects carrying such a hook:
  - A `before*` hook whose body writes a business row to an object on another datasource has that write refused with `CrossDatasourceTransactionWriteError`, and the outer write is refused with it. **Fix:** keep the objects the hook writes on the default datasource.
  - A MongoDB default store needs a replica set for this unit, as it does for `transaction()` and for the `after*` unit already (read in the driver's code: it always opens a session transaction; not measured on a standalone server). **Fix:** run MongoDB as a replica set.
  - A `ctx.api.transaction(...)` a `before*` hook opens joins the door's unit instead of committing on its own, and an `async: true` `after*` hook on the same write starts after the unit commits.
- **Unchanged:** a write already inside a unit (a caller's `transaction()`, an atomic batch or cascade) joins it, and that unit's owner still decides. No unit is opened for a hook registered in code with `registerHook` (the platform's own audit stamps among them), a write with `skipAutomations`, an object whose datasource is not the default one, or a default driver with no transactions (ADR-0119 D1, such as a libSQL remote transport). On those a `before*` hook's writes stay stored after a refusal, as the refusal's message says.
- **Cost:** one transaction per write on objects that carry such a hook. On SQLite the write lock is held through the whole `before*` chain, including awaited work inside the hooks. Objects without such a hook pay one map lookup.
