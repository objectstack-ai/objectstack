---
'@objectstack/mcp': patch
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

feat(mcp): "each X with its latest Y" in one `query_records` call — `latestPer`

Clause-②: yes (widening): a new read form on the published MCP tool surface. Judged from the card content; the build confirms it
Metadata-protocol: none

`query_records` takes `latestPer: { by, orderBy }`: one row per group, the group's first row in the given order. `by` names 1 to 3 fields, `orderBy` 1 to 3 keys (`asc` / `desc`); a tie goes to the record id in the direction of the last key, and an empty order value ranks last. "Each account with its latest deal" is `{ objectName: 'crm_opportunity', latestPer: { by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' }] } }`.

- The row is chosen among the rows the caller may read and the `where` admits: a group whose newest row is hidden from the caller answers its newest readable row, never the hidden one and never nothing. The organization wall holds inside the choice. Field masking still applies to the returned rows.
- A partition or order field the caller may not read is refused as it is in `orderBy`; a computed, JSON or multi-value field, or a dotted path, is refused as a partition or order field.
- `limit` counts groups, capped at the tool's `maxLimit` like any list. The answer is `{ object, records, hasMore }` and never a `total`; when more groups exist than came back it carries `truncated: true` (the new shared `McpCappedListAnswer` result type).
- Served by the SQL driver (Postgres, MySQL, SQLite) and by `driver-sqlite-wasm` and the Turso driver on a local or embedded-replica database: the driver compiles a `ROW_NUMBER()` window over the read's own scoped selection. Every other driver (in-memory, Turso's remote connection, MongoDB), an object with an `afterFind` hook and an object with object-scoped read middleware refuse with `INVALID_QUERY` / 400 before anything is read. The Turso driver's remote face refuses the directive itself too.
- New exports: `LATEST_PER`, `LATEST_PER_MAX_KEYS` and the `LatestPerRequest` / `LatestPerOrder` / `LatestPerOutcome` types from `@objectstack/objectql`; `LATEST_PER_DIRECTIVE`, `latestPerDirectiveOf` and the `LatestPerDirective` / `LatestPerDirectiveOrder` types from `@objectstack/driver-sql`; `McpCappedListAnswer` and `McpLatestPer` from `@objectstack/mcp`. The request rides an in-process read option, never a wire or query key; `@objectstack/spec` is unchanged.

Without `latestPer`, `query_records` and every read are unchanged.
