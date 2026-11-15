---
'@objectstack/objectql': patch
---

fix(objectql): an `async: true` after-hook writes outside the write's unit of work, also when a blocking after-hook beside it makes the write door open one

Clause-②: no
Metadata-protocol: none

An object with an `async: true` `afterUpdate` hook worked until a second, blocking `afterUpdate` hook was added to it. Then the async hook's `ctx.api` writes failed with "Transaction query already complete", and the hook's work was lost. Making the second hook `async` too, or removing it, brought the writes back.

The blocking hook (default `onError: 'abort'`) makes the write door open a unit of work, so that hook's abort can roll the write back. The async hook is dispatched inside that unit and starts at once, while the unit is still open, so its first writes joined it. Nothing waits for an async hook, so the unit committed under those writes. The same happened inside a unit a caller opened (`engine.transaction()`, `ctx.api.transaction(fn)`) whenever the async hook wrote before that unit settled.

An async after-hook now runs outside every unit of work open when it is dispatched. From the first write on, its writes are enrolled in no unit and run on their own connection, as they would with no unit open. What they see is not the same as with no unit open: there, the triggering write is already committed; here, it may not be yet (see the first bullet below). A unit the hook opens itself (`ctx.api.transaction(fn)`) is its own. This makes the existing changelog sentence about work a unit starts and does not await ("It now runs on its own connection, as it would outside any unit") true from the moment that work starts, not only after the unit has settled.

What changes for a hook author:

- An async after-hook runs in the background but is not deferred until the triggering write commits. It can start before that write's unit commits, so it may see the state from before that write, and it is not cancelled if that unit rolls back. On a database with more than one connection (Postgres, MySQL, Mongo), its `ctx.api` reads and writes run on their own connection and do not see the triggering write until its unit commits: an async `afterUpdate` that re-reads its record can read the old values, and an async `afterInsert` that updates the new row or inserts a child that references it can find no row. Before this change, those early statements joined the unit, saw the write, and failed or rolled back with it. An async hook that must see the triggering write should be a blocking hook instead.
- An async hook's writes are stored whatever blocking hooks share its event.
- An async hook's writes no longer roll back with the write that triggered it. Before, they rolled back only when they happened to run before that unit settled. An async hook that must undo its effect when the triggering write fails should be a blocking hook instead.
- On a database with a single connection (SQLite), an async hook's write waits until the triggering write's unit releases the connection. Nothing waits for the async hook, so the triggering write is not delayed.

Blocking hooks are unchanged: their `ctx.api` writes join the unit and roll back with it. An async hook with no unit open is unchanged too.
