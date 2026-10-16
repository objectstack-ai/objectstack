---
'@objectstack/mcp': patch
---

fix(mcp): an MCP tool call that repeats a unique value answers the wire code `UNIQUE_VIOLATION`, not the engine's in-process `DUPLICATE_RECORD` (#23701)

**Wire change in the MCP tool result: `DUPLICATE_RECORD` becomes `UNIQUE_VIOLATION`.** It applies to every tool error rendered from a thrown refusal, on both transports (Streamable HTTP and stdio), and to the record resource. Measured: `create_record` and `update_record` writing a value a unique field already holds, and `run_action` for an action whose handler write or declarative `operation: 'update'` repeats one. `resume_run` renders through the same writer. An MCP client, AI agents included, that matched `error.code === 'DUPLICATE_RECORD'` on that tool error must match `error.code === 'UNIQUE_VIOLATION'` instead. That is what the REST server, the batch and import rows, both Hono doors and the runtime dispatcher already answer for the same refusal.

Why: the maintainer ruled one wire spelling for a unique-constraint refusal on every route, `UNIQUE_VIOLATION` (recorded in commit 65846bc46). The MCP tool writer still relayed the engine's spelling.

- FROM `{"error":{"code":"DUPLICATE_RECORD","message":"Duplicate record refused on 'udoc': …","status":409}}`, with `isError: true`
- TO `{"error":{"code":"UNIQUE_VIOLATION","message":"Duplicate record refused on 'udoc': …","status":409}}`, with `isError: true`

Only the code moves. The result is still an `isError` tool result, `status` stays `409`, and `message` is unchanged. The envelope's keys stay `code`, `message` and `status`: this envelope has no context slot, so the `developerMessage`, `object` and `field` that the HTTP doors carry in `error.details` are not added here. Only the engine's `DuplicateRecordError` is translated, recognised by its registered code and its class name together. A hook or action handler that throws the registered `DUPLICATE_RECORD` without being that class keeps its own code. Inside the engine, `DuplicateRecordError.code` is still `DUPLICATE_RECORD`, so an in-process caller (a hook, a flow node) is unaffected. Other coded refusals (`DELETE_RESTRICTED`, `CONCURRENT_UPDATE`) are unchanged.

Clause-②: no
