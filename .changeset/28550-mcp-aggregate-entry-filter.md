---
'@objectstack/mcp': patch
---

fix(mcp)!: an `aggregate_records` aggregation entry carries its `filter` to the engine and refuses an undeclared key by name (#28550)

Clause-②: yes (narrowing) — the aggregation entry now accepts `filter` (a widening of the tool's input), and refuses any other undeclared entry key, which it stripped and ignored before (a narrowing).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key of the metadata protocol is added, removed or re-shaped, and no export or type changes: the MCP tool's input closes an entry it already documented, and the key it now accepts is the engine's own `AggregationNodeSchema.filter`. An undeclared key used to be dropped without effect, so there is nothing for a migration to rewrite; the refusal names the key and, for `where` / `filters` / `conditions` / `as`, the spelling to send. -->

**BREAKING** accept-set narrowing at the MCP `aggregate_records` tool (`@objectstack/mcp`), on both the HTTP and the stdio transport.

- **Before.** Each aggregation entry was a non-strict `{ function, field, alias }`. A per-aggregation `filter` was stripped before the engine was asked, so `{"function":"count","alias":"n","filter":{"status":"active"}}` beside an unfiltered count answered the total twice, while the REST query door answered the filtered count for the same body. Any other unknown entry key was dropped the same way, with no error.
- **Now.** The entry is built from the engine's `AggregationNodeSchema` members (`function`, `field`, `alias`, `filter`) and is closed. The `filter` is forwarded unchanged to `engine.aggregate`, the path REST uses, so both doors give one answer, including the security middleware's 403 `PERMISSION_DENIED` for a filter on a field the caller cannot read. An undeclared entry key (the retired `distinct` included) is refused by name before anything runs, as an undeclared top-level key already was.
- **Unchanged.** Entries without a filter answer as before; the REST query door is untouched.
- **Who sees it.** An MCP client that sent an extra key inside an aggregation entry: the call was answered with that key ignored, and it is now refused naming the key.

**The remedy.** Drop the key, or for a per-aggregation condition send it as the entry's `filter`.
