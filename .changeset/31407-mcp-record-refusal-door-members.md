---
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

The MCP record data tools (`query_records`, `aggregate_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `delete_records`' selection read) and the `objectstack://objects/{name}/records/{id}` resource now answer a coded refusal with what `/api/v1/data` serves beside it. An app's own unregistered code with a declared 4xx, such as `{ code: 'LEAVE_EXHAUSTED', status: 409 }`, answers the status's closed code (`RESOURCE_CONFLICT`) with `declaredCode: 'LEAVE_EXHAUSTED'`, its sentence and its status, where it used to answer `code: 'LEAVE_EXHAUSTED'`. A producer's `userMessage` on a coded refusal (for example a status-less `PERMISSION_DENIED`) is now served after the other members instead of dropped. A registered code without a `userMessage`, a coded sandboxed refusal and the unique-violation answer are unchanged.
