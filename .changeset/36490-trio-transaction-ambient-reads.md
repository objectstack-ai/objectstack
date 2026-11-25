---
'@objectstack/objectql': patch
---

fix(objectql): a script action's first call no longer stalls when a write inside its transaction triggers a flow

Clause-②: no
Metadata-protocol: none

A script action body that wrote inside `ctx.api.transaction(...)` could stall on a server running SQLite (the `os dev` default) until the sandbox's 30-second wall clock, answer `500 INTERNAL_ERROR`, and roll its writes back, while an identical retry succeeded. It happened when a write in the transaction fired a record-triggered flow (for example through a roll-up `summary` update of the parent): the flow's run setup read the organization's localization settings through the engine without the transaction's handle, and that read waited for SQLite's single connection, which the open transaction held. The retry found the read cached.

Every operation made through a transaction opened by the sandbox's `ctx.api.transaction` now publishes that transaction to the reads and writes it issues internally, as `engine.transaction(...)` already did (ADR-0034): such a read runs on the transaction's connection, and a nested `transaction()` joins it. Work an operation starts and does not await, and work detached from the unit (an `async` hook), still runs outside it.
