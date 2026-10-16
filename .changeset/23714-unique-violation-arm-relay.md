---
'@objectstack/plugin-hono-server': patch
'@objectstack/runtime': patch
---

refactor(plugin-hono-server,runtime): the Hono doors and the HTTP dispatcher read the duplicate-record wire code off the shared error classification instead of spelling it themselves (#23714)

**No behaviour change.** A repeated unique value still answers `409 UNIQUE_VIOLATION` at both Hono doors (a `HonoHttpServer` route or raw mount, and `createHonoApp`'s catch arms through `declaredEnvelopeForThrow`) and at the dispatcher's doors (`HttpDispatcher`'s thrown-error envelope), with the same `message`, the same `details` (`developerMessage`, `object`, and `field` when the driver named the column) and the same envelope keys. The answers were compared byte for byte at those doors before and after. A client or an app author has nothing to change.

**What changed.** Both translations used to spell the wire code as a string literal. They now read it off the classification the REST server answers with (`structuredCodeAnswer` in `@objectstack/types`), as `@objectstack/mcp` already does. So the code has one source, and neither package stamps a code that the error-code ledger does not list under it. The engine's in-process code is unchanged: `DuplicateRecordError.code` is still `DUPLICATE_RECORD`.

Clause-②: no
