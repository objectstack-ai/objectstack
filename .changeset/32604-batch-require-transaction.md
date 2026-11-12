---
'@objectstack/rest': patch
---

fix(rest): cross-object `POST /batch` requires a real transaction and answers `501 NOT_IMPLEMENTED` on a runtime that cannot roll back, instead of applying the batch op by op

Clause-②: no
Metadata-protocol: none

The route checked only that the engine had `transaction()` and called it without `{ require: true }`. On a runtime whose default driver cannot roll back (remote Turso, which declares `supports.transactionsUnsupported`; any driver without `beginTransaction`), the engine took its declared non-transactional path (ADR-0119 D1), so a batch whose later op failed kept the rows its earlier ops wrote, while the route promises all-or-nothing. The route now passes `{ require: true }`; the engine refuses before any op runs, and the route answers the same `501 NOT_IMPLEMENTED` body it already answers for an engine without `transaction()`. Discovery's `capabilities.transactionalBatch` already answered `false` on such a runtime (same predicate), so the console's atomic batch is not offered there. Runtimes whose driver can roll back are unchanged.
