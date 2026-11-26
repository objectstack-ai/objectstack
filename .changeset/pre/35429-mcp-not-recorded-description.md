---
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

The MCP `query_records`, `aggregate_records` and `get_record` tool descriptions now say what a refusal's `notRecorded` member means: what it names is not recorded in this app, so the model follows the refusal's `ifNotRecorded` sentence and never reports 0 or empty for it. The refusal members and their sentences are unchanged. A `where` (or an aggregation `filter`) that carries the search companion key `__search` beside a field the caller's schema does not show no longer names `__search` in `notRecorded.fields`: the key is the engine's own search column, never a field the caller's app records.
