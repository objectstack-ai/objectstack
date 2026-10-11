---
'@objectstack/objectql': patch
---

Work a `ctx.api.transaction(fn)` unit starts and does not await no longer keeps the unit's finished transaction handle

Clause-②: no

`ctx.api.transaction(fn)` is `ScopedContext.transaction()`, the transaction a hook or action handler opens. When the unit it opened finished, work the callback had started and not awaited still held its handle. The typical case is an `async: true` hook on a record the callback wrote. That work then failed with "Transaction query already complete" and its write was lost. Only the hook's log showed it. Measured on the in-process SQLite stack: the record was stored and the hook's later note was not.

The handle reached that work two ways, and both now close when the callback settles, before the commit:

- **Ambient.** `ScopedContext.transaction()` published its unit into the engine's ambient store and never closed the entry. It now runs its callback through the same helper `transaction()` uses, which closes the entry.
- **Threaded.** The unit's handle is also threaded into the callback's context (`tx.object(…)`), and from there into the triggered hook's `ctx.api`. A handle whose unit has closed is now treated as absent, so that work runs on its own connection, as it would outside any unit. This applies on both surfaces: it also covers a caller who opens `transaction()` and passes its context to a write (`{ context: trx }`).

**Unchanged:** work the callback awaits still runs inside the unit and commits or rolls back with it. A nested `transaction()` still joins the open unit, and its handle stays live until the outermost callback settles. Writes with no transaction are unaffected. A handle opened through the discrete `beginTransaction` / `commitTransaction` / `rollbackTransaction` trio (the sandboxed hook body's path) is not covered and behaves as before.
