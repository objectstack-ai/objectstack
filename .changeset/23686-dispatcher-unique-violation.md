---
'@objectstack/runtime': patch
---

fix(runtime): the HTTP dispatcher answers the engine's `DuplicateRecordError` with the wire code `UNIQUE_VIOLATION`, not the engine's in-process `DUPLICATE_RECORD`, with `developerMessage`, `object` and `field` in `error.details` (#23686)

**Wire change at the dispatcher's doors: `409 DUPLICATE_RECORD` becomes `409 UNIQUE_VIOLATION`.** It applies wherever a dispatcher domain hands a caught engine throw to its shared error writer (`HttpDispatcher`'s thrown-error envelope). Measured: `POST /actions/:object/:action`, for a handler or a declarative `operation: 'update'` action whose write repeats a unique value, and the activation doors `POST /actions/_activation/:object/:action` and `POST /security/_activation/:type/:name`, for a flip that loses a race on the activation ledger's unique key. A client of these doors (`@objectstack/hono`'s `createHonoApp`, or any host serving the dispatcher) that matched `code === 'DUPLICATE_RECORD'` on that refusal must match `code === 'UNIQUE_VIOLATION'` instead. That is what the REST server and both Hono doors already answer for the same refusal.

Why: the maintainer ruled one wire spelling for a unique-constraint refusal on every route, `UNIQUE_VIOLATION` (recorded in commit 65846bc46). The REST server, the batch and import rows and the Hono doors already reported it. The dispatcher's own writer reported the engine's spelling.

- FROM `{"success":false,"error":{"code":"DUPLICATE_RECORD","message":"Duplicate record refused on 'udoc': …","httpStatus":409}}`
- TO `{"success":false,"error":{"code":"UNIQUE_VIOLATION","message":"Duplicate record refused on 'udoc': …","httpStatus":409,"details":{"developerMessage":"Duplicate record refused on 'udoc': …","object":"udoc"}}}`

`details` carries what the REST server's answer carries beside its code, each field only when the producer stated it: `developerMessage`, `object`, and `field` when the driver named the conflicting column. The status stays `409` and the `message` is unchanged. Only the engine's `DuplicateRecordError` is translated, recognised by its registered code and its class name together. A handler or hook that throws the registered `DUPLICATE_RECORD` without being that class keeps its own code. So does a sandboxed script body that lets the engine's refusal propagate: it reaches this door as the sandbox's own error, not the engine's class, exactly as it reaches the REST and Hono doors. Inside the engine, `DuplicateRecordError.code` is still `DUPLICATE_RECORD`, so an in-process caller (a hook, a flow node) is unaffected. Other `409` answers at these doors (`DELETE_RESTRICTED`, `CONCURRENT_UPDATE`) are unchanged.

Clause-②: no
