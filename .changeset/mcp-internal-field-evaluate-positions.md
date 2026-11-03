---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

fix(mcp,runtime)!: the MCP data tools refuse to filter, sort, group or aggregate on a field declared `internal: true`, with the data door's own 400 INVALID_FIELD, on the stdio transport and on the HTTP bridge's aggregate_records

Clause-②: no (narrowing) — the MCP stdio transport's `query_records` and `aggregate_records`, and the HTTP MCP bridge's `aggregate_records`, refuse a query that evaluates a field declared `internal: true`, which they served before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no metadata an author writes changes meaning: a query position the REST data door already refuses is now refused by the MCP data tools too, with the door's own refusal. The fix for a caller is to query another field, which the refusal says; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the MCP data tools (`@objectstack/mcp`, `@objectstack/runtime`), on the gate the data door already applies (`@objectstack/metadata-protocol`).

- **Before.** A field declared `internal: true` was omitted from every row on every door, and the REST data door (and the HTTP bridge's `query_records`, which reaches it) refused to evaluate one: `400 INVALID_FIELD`. Three MCP mouths hand a caller's query to the engine without reaching that door, and evaluated it: the stdio transport's `query_records` answered a `where` on such a field (`$eq`, `$startsWith`, any operator) and an `orderBy` by it; the stdio transport's `aggregate_records` and the HTTP bridge's `aggregate_records` answered a `where` or an aggregation's own `filter` on it. A group key or an aggregation operand on it was refused by the engine there, in the engine's words.
- **Now.** Each of the three asks the data door's gate (`assertNoInternalFieldEvaluated`, now public on the protocol service) before the engine, for every principal, administrators included, and answers what the door answers for the same query: `400 INVALID_FIELD`, naming the object, the field and the position, in the door's sentence. On MCP the tool result carries that `code`, `status` and message. No row is read.
- **Unchanged.** A query over ordinary fields is served as before; the flagged field is still omitted from every row; a field the caller may not read is still the security middleware's `403 PERMISSION_DENIED`. The engine's privileged lookups that match on such a field (key, token and share-link verification) do not pass through these doors and are untouched. A host that registers no protocol service has no data door for these tools to agree with and serves them as before.
- **Who sees it.** An MCP client that filters, sorts, groups or aggregates on a field its object declares `internal: true`. The built-in objects that declare one are platform `sys_*` objects, which the MCP data tools refuse by default (`allowSystemObjects`); where a host serves them, the same refusal now applies.

**The remedy.** Filter, sort, group and aggregate on another field. A field that must be queryable is not one to declare `internal: true`.
