---
'@objectstack/spec': patch
'@objectstack/mcp': patch
---

fix(spec)!: an aggregation entry refuses an undeclared key by name on every door, and MCP's `aggregate_records` reads the same refusal (#28609)

Clause-②: no (narrowing) — `AggregationNodeSchema` refuses an entry key it does not declare, which the REST query door stripped and ignored before; no key, value or export is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A query's aggregation entry is a request surface, the client SDK builder's output and the `POST /data/:object/query` body, never stored in stack metadata, so there is no source for a conversion to rewrite (the disposition the spec already records for the retired `distinct` on this same node). No declared key is added, removed or renamed and no export or type changes: an undeclared key used to be dropped without effect and is now refused by name, with `where` / `filters` / `conditions` hinted to `filter` and `as` to `alias`. -->

**BREAKING** accept-set narrowing of a query's aggregation entry (`AggregationNodeSchema`, `@objectstack/spec`), at every door that takes one.

- **Before.** The entry was a plain object, so zod deleted a key it does not declare and the call answered: `POST /api/v1/data/:object/query` with `{"function":"sum","field":"amount","alias":"s","bogusKey":true}` returned 200 and the sum, and an entry `where` meant as the entry's own `filter` computed over every row of the group. The runtime dispatcher's `/data/:object/query` did the same. The MCP tool `aggregate_records` alone refused the key, from its own closed copy of the entry (#28550), so one entry shape got two verdicts depending on the door.
- **Now.** The node is a `strictObject`. Every door that parses it (REST and the runtime dispatcher through `FindDataRequestSchema`, `EngineAggregateOptionsSchema.aggregations`, and `aggregate_records`, which now takes the node whole instead of its own copy) answers one refusal, word for word: `Unrecognized key(s) on this aggregation entry: KEY.` plus the near-miss hint, at `400 VALIDATION_FAILED` with `fields[]` on REST and as the tool's input error on MCP. Nothing reaches the engine. The retired `distinct` keeps its tombstone sentence on both doors (MCP used to answer it with the generic unknown-key refusal), and `tools/list` now lists `distinct` as a schema no value satisfies (`not: {}`) with its removal text.
- **Unchanged.** Entries that carry only `function`, `field`, `alias` and `filter` answer as before on every door. This supersedes the #28550 entry's "the REST query door is untouched": it is closed here.
- **Who sees it.** A REST, dispatcher or in-process caller that sent an extra key inside an aggregation entry: the query was answered with that key ignored, and it is now refused naming the key.

**The remedy.** Drop the key; for a per-aggregation condition send it as the entry's `filter`, and for the result column name use `alias`.
