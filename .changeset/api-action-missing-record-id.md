---
'@objectstack/runtime': patch
---

fix(runtime): an `api` action whose `target` names its record is refused `400` naming `recordId` when called with no record id, instead of being forwarded to a path that reaches no route

Clause-②: no
Metadata-protocol: none

A same-origin `type: 'api'` action whose `target` carries a record token (`{id}`, `${ctx.recordId}`, or a `{field}` read from the record, for example `approval_approve` → `/api/v1/approvals/requests/{id}/approve`) used to be forwarded even when the caller gave no `recordId`, or an empty one: the token was blanked or left as written, the forwarded path matched no route, and the action door answered `404 ENDPOINT_NOT_FOUND`, telling the caller the endpoint did not exist.

Both action doors (REST `POST /api/v1/actions/:object/:action` and the MCP `run_action` tool) now refuse that call `400 VALIDATION_ERROR` before any forward, naming the missing input: `recordId` when no record was named, otherwise the field the record has no value for. A call with a real id, and a call with an id the target does not know, are forwarded and answered by the target as before.
