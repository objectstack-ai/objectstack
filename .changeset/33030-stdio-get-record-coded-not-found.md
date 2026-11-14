---
'@objectstack/mcp': patch
---

fix(mcp): stdio `get_record` answers a missing or hidden id with the coded `RECORD_NOT_FOUND`

Clause-②: no
Metadata-protocol: none

Over the stdio transport, `get_record` on an id that names no row, or a row the caller may not read, answered the bare sentence `Record "<id>" not found in "<object>"` with no code. It now answers the coded envelope the HTTP `/mcp` door answers for the same call, `{ "error": { "code": "RECORD_NOT_FOUND", "message": "Record <id> not found in <object>", "status": 404 } }`, so a stdio client can branch on the code. A missing id and a hidden id answer the same envelope. `update_record` and `delete_record` already answered it and are unchanged.
