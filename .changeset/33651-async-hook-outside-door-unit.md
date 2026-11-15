---
'@objectstack/objectql': patch
---

fix(objectql): an `async: true` after-hook writes outside the write's unit of work, also when a blocking after-hook beside it makes the write door open one

Clause-②: no
Metadata-protocol: none

An object with an `async: true` `afterUpdate` hook worked until a second, blocking `afterUpdate` hook was added to it. Then the async hook's `ctx.api` writes failed with "Transaction query already complete", and the hook's work was lost. Making the second hook `async` too, or removing it, brought the writes back.

The blocking hook (default `onError: 'abort'`) makes the write door open a unit of work, so that hook's abort can roll the write back. The async hook is dispatched inside that unit and starts at once, while the unit is still open, so its first writes joined it. Nothing waits for an async hook, so the unit committed under those writes. The same happened inside a unit a caller opened (`engine.transaction()`, `ctx.api.transaction(fn)`) whenever the async hook wrote before that unit settled.

An async after-hook now runs outside every unit of work open when it is dispatched. From the first write on, its writes are enrolled in no unit and run on their own connection, as they would with no unit open. A unit the hook opens itself (`ctx.api.transaction(fn)`) is its own. When the hook starts, and whether it runs at all when that unit rolls back, is stated in one place, the entry for the follow-up fix: an async after-hook fired inside a unit of work runs once that unit commits, and not at all when it rolls back. This makes the existing changelog sentence about work a unit starts and does not await ("It now runs on its own connection, as it would outside any unit") true from the moment that work starts, not only after the unit has settled.

What changes for a hook author:

- An async hook's writes are stored whatever blocking hooks share its event.
- An async hook's writes no longer roll back with the write that triggered it. Before, they rolled back only when they happened to run before that unit settled.
- On a database with a single connection (SQLite), an async hook's write waits until the triggering write's unit releases the connection. Nothing waits for the async hook, so the triggering write is not delayed.

Blocking hooks are unchanged: their `ctx.api` writes join the unit and roll back with it. An async hook with no unit open is unchanged too.
