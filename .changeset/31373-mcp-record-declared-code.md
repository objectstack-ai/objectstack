---
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

The MCP record data tools (`query_records`, `aggregate_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `delete_records`' selection read) and the `objectstack://objects/{name}/records/{id}` resource now serve the `/api/v1/data` door's `declaredCode` and `userMessage` whenever they answer a throw with that door's answer. An app's own unregistered code with a declared 5xx, such as `{ code: 'VENDOR_DOWN', status: 503 }`, answers `SERVICE_UNAVAILABLE` / 503 with `declaredCode: 'VENDOR_DOWN'`, as `/data` does; since the previous release it answered the closed code alone. A producer's `userMessage` rides the answer after `status`, as `run_action` and `resume_run` render it. Each member is omitted when the door serves none. A coded throw with a declared status below 500, and the metadata tools and `list_actions`, answer as before.
