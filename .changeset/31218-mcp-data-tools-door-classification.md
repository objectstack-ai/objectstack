---
'@objectstack/mcp': patch
---

fix(mcp): the record data tools answer a code-less throw as the `/api/v1/data` door does — an undeclared sandboxed hook abort is `HOOK_ABORTED` with the hook's own sentence

Clause-②: yes
Metadata-protocol: none

`query_records`, `aggregate_records`, `get_record`, `create_record`, `update_record` and `delete_record` used to answer a thrown error that carried no `code` with its bare message. For a sandboxed hook body's `throw new Error('…')` that message is the sandbox's debug wrapper, `hook '<name>' threw: Error: …`, so an agent saw the hook's internal name and no code, while `/api/v1/data` answers the same abort `400 HOOK_ABORTED` with the body's sentence alone.

These six tools now classify a code-less throw with the `/data` door's own classifier (`mapDataError`, `@objectstack/types`) and answer `{ "error": { "code", "message", "status" } }`:

- an undeclared sandboxed hook abort: `HOOK_ABORTED`, status 400 (or the 4xx the body declared), the body's sentence;
- a code hook's bare `throw new Error(…)`, a crash, a driver error: `INTERNAL_ERROR`, status 500, message `Internal server error`. The thrown message no longer reaches the agent; it is logged once on the server as a `[5xx]` line, as the HTTP doors log a fault;
- a throw that declared a status and no code (for example the runtime's `503` when no data service is registered): that status, no code, and for a 5xx the message withheld.

An agent that read the bare text of these errors reads `error.message` of the JSON envelope instead, and branches on `error.code`. A thrown error that carries a `code` is answered exactly as before. The other tools (`list_objects`, `describe_object`, `validate_expression`, `list_actions`, `delete_records`, `run_action`, `resume_run` and the file and datasource tools) are unchanged.
