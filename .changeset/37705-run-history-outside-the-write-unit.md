---
'@objectstack/objectql': patch
'@objectstack/service-automation': patch
'@objectstack/core': patch
---

fix(automation): a record-change flow's run history and its notification deliveries land again when the triggering write runs in a unit of work

Clause-②: yes (widening) — `ObjectQL` is exported from the `@objectstack/objectql` entry, and it gains the public method `runOutsideOpenUnits(body)`; the `@objectstack/service-automation` interface `SuspendedRunStoreEngine` gains the matching optional member `runOutsideOpenUnits`, so an engine that does not supply it still satisfies the interface. No existing signature or accepted input narrows. `DispatchLoop`'s change is to the async context its ticks run in, not to its API. The level stays `patch` because nothing a metadata author can write changes (`Metadata-protocol: none`).
Metadata-protocol: none

On 19.0.0-next.0 a record-change flow fired by a write whose object carries a metadata `before*` hook, or a blocking `after*` hook that can abort, finished inside the unit of work the write door opens for that write. Two pieces of work the run starts and does not await then ran on that unit's transaction after it had committed, and the database answered "Transaction query already complete":

- the run's terminal history row (`sys_automation_run`) never landed, so the run was missing from the Runs surfaces and from every read of its history, with an `error` line naming the persist;
- a `notify` node's outbox wake started the notification dispatcher's tick in the same unit, so the tick's delivery updates failed, and with them the audit rows (`sys_activity`) those updates write.

Both now run outside the unit:

- `ObjectQL.runOutsideOpenUnits(body)` is new: it runs work its caller starts and does not await outside every unit of work open at the call, the same exit an `async: true` hook's run takes. Its calls run on their own connection, and a rollback of the unit open at the call does not undo them.
- The durable run-history store writes a finished run's row through it.
- `DispatchLoop` (the notification, HTTP-delivery and database-queue loops) runs every tick in the async context it was constructed in, never in the context of the caller of `start()`, `wake()` or `wakeAt()`.

What a reader sees change: a run's history row is written beside the run, not inside the triggering write's unit, so it is not rolled back with that write, and it can land a moment after the write has returned. Read it the way you read any history row written by a run that is not awaited: wait for it to land rather than reading it once straight after the write.
