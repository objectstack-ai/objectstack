---
'@objectstack/objectql': minor
'@objectstack/spec': patch
---

fix(objectql): an `async: true` after-hook fired inside a unit of work runs once that unit commits, and not at all when it rolls back

Clause-②: no
Metadata-protocol: semantic

An `async: true` after-hook fired inside a unit of work started at once, while the unit was still open. Two things followed. On a database with more than one connection (Postgres, MySQL, Mongo), its `ctx.api` reads and writes ran on their own connection before the triggering write was committed, so an async `afterUpdate` that re-read its record could read the old values, and an async `afterInsert` that updated the new row or inserted a child referencing it could find no row. And when the unit rolled back, the hook had already run: its writes landed, referencing a row that was never stored. Measured on Postgres 16 and on SQLite through knex, for a caller's `engine.transaction()`, a `ctx.api.transaction(fn)`, a nested unit, and the unit the write door opens for a blocking `after*` hook beside the async one.

This is the one statement of when an async after-hook runs inside a unit of work. The previous fix (#33703) moved its writes outside the unit; its entry in these notes leaves the timing to this one. Now:

- An async after-hook fired inside a unit of work starts after the outermost unit commits. Its `ctx.api` reads see the committed write, on every database. A nested `transaction()` joins the outer unit, so its return is no commit: the outer unit's outcome decides.
- When that unit rolls back, the async hook does not run at all. It writes nothing and calls nothing, so an external effect it makes (a webhook, an email) is never announced for a write that was undone.
- The units this covers are every one the engine opens: a caller's `engine.transaction()`, `ctx.api.transaction(fn)` (in a sandboxed hook body too), an atomic batch or cascade, and the unit the write door opens for a blocking `after*` hook that can abort. A blocking hook beside the async one on the same event still runs inside that unit, before the commit.
- Outside any unit an async hook starts at once, after the write, as before. Its writes still run outside every unit, on their own connection, and nothing waits for it.
- This is for the write events (`afterInsert`, `afterUpdate`, `afterDelete`). A rollback does not undo a read, so an async `afterFind` hook starts when the read is dispatched, outside the unit, as before, whatever the unit does next.
- All the async hooks a unit held start together, in the order they were dispatched, once it commits. A bulk write with a per-row async hook holds one per row until then.

An async hook whose job was to react to a write that failed (to record a refused attempt, say) no longer runs for it. Use a blocking hook, or react to the caller's error, for that.

Known deviations, both narrow: a write that is stored while its unit is later undone still loses its async hook with that unit, in two cases. (a) A write from work the transaction callback started and did not await, made after the callback returned and before a commit that then fails. (b) A write to an append-only system-ledger object routed to another datasource, which `transaction()` runs outside the unit and which survives its rollback: its async hook is held by the unit and dropped with it.

The `async` key's documentation in `@objectstack/spec` (`HookSchema.async`, and the `HookEvent` note on `ctx.api` writes rolling back with the unit, which now names blocking hooks only) says the same.
