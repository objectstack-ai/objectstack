---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(mcp): a record with its related records in one call — `expand` on `query_records`, `related` on `get_record`

Clause-②: yes (widening)
Metadata-protocol: none

`query_records` takes `expand`: up to 3 of the queried object's lookup, master-detail, user or tree fields, each answered as the record it names, one level deep. `get_record` takes `related`: up to 3 child objects that point at the record, each answered as a list of at most 20 rows (never above the tool's `maxQueryLimit`), as `{ record, related: [{ object, field, records, total, hasMore }] }`.

- Every object a new read shape reaches is judged by the MCP read guard exactly as the object the call names. A target the guard refuses refuses the whole call with `PERMISSION_DENIED` / 403 before any record is read. A related object whose definition is not served to the caller refuses it with `OBJECT_NOT_FOUND` / 404, also before any read.
- An `expand` name that is not a relationship field of the object as the caller is served it, and a `related` link `field` that does not point at the record, are refused with `INVALID_FIELD` / 400 before any read. A child that points at the record through several fields needs `field`.
- `expand` runs through the engine's one expansion path: one batched `id IN (...)` read per field, under the target's own permissions, row-level security and field masking. It combines with `latestPer`.
- A related list is one `query_records` read of the child, filtered only by the link to the record, with the child's own `fields` and `orderBy` and no caller filter. It is read only after the record itself. A list with more rows than its cap carries `truncated: true`.
- The stdio bridge serves `expand` too, built as the data door builds it (a target that does not serve `get` keeps its stored id). `McpDataBridge.query` gains an optional `expand` member.

Without `expand` or `related`, both tools answer exactly as before. `@objectstack/spec` is unchanged.
