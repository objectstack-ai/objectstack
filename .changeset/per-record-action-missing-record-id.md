---
'@objectstack/runtime': patch
---

fix(runtime): a per-record action called with no recordId is refused 400 naming it, and an unknown id 404s at the door, before its flow runs

Clause-②: no — every call refused now already failed on `main`: the flow behind the action ran and answered `400 FLOW_FAILED` naming its internal node, with no id or with an id the caller cannot resolve.
Metadata-protocol: none

An action declared `execution: 'perRecord'` (an api action or a flow action) called through the REST `/actions` door or MCP `run_action` with no `recordId`, or an empty one, is refused `400 VALIDATION_ERROR` naming `recordId`, and nothing is forwarded or started. The same api action called with an id the caller's scope does not resolve answers the door's own `404 RECORD_NOT_FOUND` instead of being forwarded, as a flow or script action already did. Actions declared `aggregate`, or declaring no `execution`, run record-less as before (#29173). Fixes #29881.
