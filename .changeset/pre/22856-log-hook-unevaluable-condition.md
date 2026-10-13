---
'@objectstack/objectql': minor
---

fix(objectql)!: a write refused because an `after*` hook's `condition` could not be evaluated no longer leaves its row behind when that hook is `onError: 'log'` or `async: true` (#22856)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. A hook that loaded before keeps its authored shape. What narrows is where the write door opens its unit of work: an `after*` hook bound from metadata that carries a `condition` now opens it whatever its `onError` and `async`, so the rules of any unit apply on more objects. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** stored-outcome narrowing, shipped as `minor` under the launch-window convention for breaking changes.

A hook `condition` that cannot be evaluated aborts the operation whatever the hook's `onError` says. Examples are a condition reading `previous` on an insert, a key the object does not declare, or `null > null`. The condition is checked before an `async: true` hook detaches, so that hook aborts too.

- **FROM:** `insert` / `update` / `delete` (REST `createData` / `updateData` / `deleteData`, `ctx.api`, the engine door) on an object whose `after*` hooks bound from metadata are all `onError: 'log'` or `async: true`, with at least one carrying a `condition`. The write door opened no unit of work, because it opened one only for a blocking `onError: 'abort'` hook. So a condition that could not be evaluated refused the caller while the row stayed stored, changed or deleted. Measured on REST `POST /data/:object`: `500`, and the row was stored.
- **TO:** an `after*` hook bound from metadata that carries a `condition` opens the write door's unit, whatever its `onError` and `async`. A condition that cannot be evaluated rolls back the row and the hook chain's engine writes together. The caller is refused exactly as before.
- **Inside the new unit, the rules of any unit apply,** so writes that were accepted are now refused on objects carrying such a hook:
  - A blocking `onError: 'log'` hook whose body writes a business row to an object on another datasource has that write refused with `CrossDatasourceTransactionWriteError`. The hook's `onError: 'log'` logs the refusal and the row is not written, where it used to land. The caller's own write is still stored.
  - The same applies to the part of an `async: true` hook's body that runs before the unit's callback settles. A write the body makes after that lands as before.
  - A MongoDB default store without a replica set now refuses writes to objects carrying such a hook, because this unit needs a replica set, as `transaction()` already does.
  - **Fix, if one of these applies to you:** drop the hook's `condition` (and test it in the hook's body instead), or keep the objects on one datasource, or run MongoDB as a replica set.
- **Unchanged:** a condition's verdict is read as before. `false` skips the hook, and with `true` an `onError: 'log'` hook's thrown error is logged and the caller's row is stored. A write already inside a unit joins it. No unit is opened with `skipAutomations`, off the default datasource, or on a default driver with no transactions. An `onError: 'log'` or `async: true` hook with no `condition` still opens no unit.
- **Cost:** one transaction per write on objects that carry such a hook. This is the same per-write cost as the unit for `onError: 'abort'` hooks. In the showcase example this covers updates to `showcase_task` and `showcase_project`, whose `async: true` `afterUpdate` hooks carry conditions.
