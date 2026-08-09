---
'@objectstack/spec': major
'@objectstack/objectql': major
---

refactor(spec,objectql)!: retire `AggregationNode.distinct` — one face honoured it, five ignored it, and the same query answered two plausible numbers (#6815, ADR-0049)

<!-- adr-0087: registered aggregation-node-distinct-retired -->

**FROM → TO:** `{ function: 'count', field: 'x', distinct: true, alias: 'a' }` →
`{ function: 'count_distinct', field: 'x', alias: 'a' }` — the deduplicating spelling
every backend computes, lowered to `COUNT(DISTINCT x)` on both SQL faces since #6409.
`{ function: 'sum' | 'avg' | 'min' | 'max', …, distinct: true }` → delete the key; there is
no replacement, because no SQL backend ever computed `SUM(DISTINCT …)` here and the
in-memory fallback was the only thing that did. `distinct: false` → delete the key; it
selected the behaviour that is now the only behaviour.

`AggregationNode.distinct` was read by exactly ONE of the six faces that consume an
`aggregations[]` entry. `objectql`'s in-memory fallback (`in-memory-aggregation.ts`)
deduplicated the values before applying the function; `SqlDriver.aggregate`, the Turso
`RemoteTransport.aggregate`, `driver-mongodb`'s `buildAggregationStage`, `driver-memory`'s
`computeAggregate` and `service-analytics`' `AGGREGATE_SQL` all ignored it. So
`{ function: 'sum', field: 'amount', distinct: true }` returned a deduplicated sum when the
engine fell back in memory and an ordinary sum on every SQL datasource — one query, two
numbers, chosen by which backend answered. The engine picks that path per query (a driver
without native aggregation, a non-UTC date bucket, a partial SQL driver), so the number
could move under a dashboard with nothing changing in the query.

That is the divergence class #6203 and #5907 each closed on the aggregate axis, still open
on this key, and it is worse to leave: both answers are plausible NUMBERS rather than a
refusal, so nothing surfaced it. It survived the #4286 sweep of this same schema because
that sweep asked which members no executor reads — the wrong question for a key whose
defect is *which* executor reads it.

REMOVE rather than ENFORCE, per the maintainer ruling of 2026-08-09: `count_distinct`
already covers the only deduplicating spelling with measured demand and took ADR-0049's
enforce leg in #6409, while `SUM(DISTINCT …)` / `AVG(DISTINCT …)` are near-universally a
modelling mistake and would have to be lowered across five faces — two of them frozen under
#5499 — to buy it.

The retirement kit:

- **Tombstone, not deletion** (`retiredKey()`): `AggregationNodeSchema` is not `.strict()`,
  so a plain delete would let existing queries parse clean and lose the key in silence
  (#3733, ADR-0104) — trading a divergent flag for an ignored one. Authoring it is now a
  `tsc` error at the call site and a parse error carrying the prescription. One tombstone
  covers every aggregation door: `QuerySchema.aggregations` and
  `EngineAggregateOptionsSchema.aggregations` both reuse that one schema by reference.
- **ADR-0087 D3 `SemanticMigration`** (`aggregation-node-distinct-retired`) plus the exact
  `RETIRED_KEYS_BY_MAJOR[17]` entry `data/AggregationNode:distinct`. No D2 conversion,
  deliberately: `QueryAST` is a request surface — the client SDK builder's output and the
  `POST /data/:object/query` body — never stored in stack metadata, so there is no source
  for `os migrate meta` to rewrite. That is the disposition every other `data.query.*`
  retirement in this major already takes (#4286).
- `objectql`'s in-memory fallback loses its `collectValues` dedupe limb — the whole runtime
  cost of the removal. **The observable numbers change on that one path, and that is the
  point:** a `sum`/`avg` that used to be deduplicated there now answers what every SQL face
  has always answered for the same query. Verify against the SQL answer, not against the
  pre-upgrade fallback answer — the two disagreed.
- Measured blast radius inside the fallback, narrower than the key suggests: only `sum` and
  `avg` ever changed answer. `count` returned from its own branch before reaching the
  dedupe, `count_distinct` fed the values into a `Set` (dedupe-then-`Set` is `Set`), and
  dedupe does not move `min`/`max`.
- `POST /api/v1/data/:object/query` answers `400 VALIDATION_FAILED` with a `fields[]` entry
  at `aggregations.<i>.distinct` instead of serving a number — the #3899 entry validation
  descending into the array, pinned in the REST request-schema conformance gate.
- Liveness ledger (`query.json` `aggregations.children.distinct` → `dead`, README counts),
  generated baselines (`authorable-surface/data.json` gains `[RETIRED]`),
  `spec-changes.json`, the upgrade guide and the reference docs regenerated.

`count_distinct` is untouched and remains the live deduplicating spelling.
