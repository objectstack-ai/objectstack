---
'@objectstack/mcp': patch
---

fix(mcp): a sandboxed hook body that crashes while declaring a code is a fault on MCP, not a refusal at its declared status

Clause-②: no
Metadata-protocol: none

A QuickJS hook body that crashed while declaring a code, for example `throw Object.assign(new TypeError('boom'), { code: 'RECORD_LOCKED', status: 409 })`, reached every MCP tool and the `objectstack://objects/{name}/records/{id}` resource as `{ code: 'RECORD_LOCKED', message: "hook '<name>' threw: TypeError: boom", status: 409 }`: the hook's internal name and the native error text, at a status that reads as a business refusal. `/api/v1/data`, `/meta` and `/actions` classify such a crash first and answer `500 INTERNAL_ERROR`.

MCP now asks the doors' own crash predicate (`isSandboxCrash`, `@objectstack/types`) before it reads a thrown code, so a crash with a declared code is answered as the same crash with no code. The record data tools (`query_records`, `aggregate_records`, `get_record`, `create_record`, `update_record`, `delete_record`) answer `{ "error": { "code": "INTERNAL_ERROR", "message": "Internal server error", "status": 500 } }` and log the crash once on the server, as `/api/v1/data` does. The other tools, `delete_records` and the record resource answer what they answer today for a crash with no code. A sandboxed body's coded refusal (no crash) is unchanged.
