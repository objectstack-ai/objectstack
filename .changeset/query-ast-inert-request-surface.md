---
"@objectstack/spec": major
"@objectstack/plugin-security": patch
---

refactor(data)!: the QueryAST request surface stops declaring what no executor runs — `joins` and `windowFunctions` removed, six search flags and `aggregations[].filter` marked experimental, and the liveness ledger now governs the query surface (#4286)

#4196 removed one declared-but-inert member from `FieldNode`. Applying the same
method to the rest of the request surface (#4286) found 12 more members of
`QueryAST` that no executor runs — `packages/objectql`'s `engine.ts` contains
zero reads of any of them on the query path. This change dispositions the
mechanical tiers and closes the gate that let the class stay invisible.

**Removed (tombstoned): `query.joins` and `query.windowFunctions`.**

- `joins` — no engine or driver ever read it; a query carrying it silently ran
  as a single-table query. Related-record retrieval already has a live
  spelling: `expand`. The orphaned `JoinNode` / `JoinNodeInput` /
  `JoinNodeSchema` / `JoinType` / `JoinStrategy` exports are deleted with the
  key (`data/JoinNode`, `data/JoinType`, `data/JoinStrategy` leave the
  published JSON schemas).
- `windowFunctions` — `find()` never applied it, so every OVER clause it
  declared was silently dropped. The one live door is the SQL driver's own
  `findWithWindowFunctions(object, query)` (driver-level, not on the
  `IDataDriver` contract), and its input is a flat driver shape the spec
  vocabulary never matched — `WindowFunctionNodeSchema` declared `field` /
  `over` / `frame` members that door never read. The `WindowFunction` /
  `WindowSpec` / `WindowFunctionNode` exports are deleted with the key.

**FROM → TO**

| Was | Now |
| :--- | :--- |
| `joins: [{ type: 'inner', object: 'customer', on: … }]` | `expand: { customer_id: { object: 'customer', fields: ['name'] } }` |
| `joins` for one related column | `fields: ['customer_id.name']` (dotted path) |
| `windowFunctions: [{ function: 'rank', … }]` in a query | `aggregations` + `groupBy`, or rankings in report/dashboard metadata |
| OVER-clause SQL from an embedder | `sqlDriver.findWithWindowFunctions(object, { windowFunctions: [{ function, alias, partitionBy?, orderBy? }] })` |

The one-line fix: **delete the key**. Both are `retiredKey()` tombstones on the
non-strict `BaseQuerySchema`, so authoring either fails `tsc` (input type
`never`) and a query still carrying one — even as an empty array — fails to
parse with the prescription itself. `QueryAST` is a request shape, never stored
in stack metadata, so there is no `os migrate meta` step: the removals are
registered as protocol-18 **semantic** migrations (`query-joins-retired`,
`query-window-functions-retired`), the #4196 precedent.

Compat note for the REST boundary: both names remain **reserved** list-query
parameters while the tombstones live (`retiredKey()` keeps a key in
`keyof QueryAST`, which feeds `RESERVED_LIST_QUERY_PARAMS`), so nothing changes
for objects with fields named `joins`/`windowFunctions` — the un-reservation
happens when the tombstones age out, and is called out in
`metadata-protocol`'s `QUERY_AST_KEYS` comment for whoever does it.

**Marked `[EXPERIMENTAL — not enforced]` (no wire or compat impact):**
`search.fuzzy` / `operator` / `boost` / `minScore` / `language` / `highlight`
(the ADR-0061 expansion reads only `query` + `fields`) and
`AggregationNode.filter` (a SQL `FILTER (WHERE …)` affordance neither the SQL
builders nor the in-memory fallback applies). Authoring one is now a
declaration, not a silent no-op.

**Deliberately NOT dispositioned here** (they want a maintainer call, #4286
steps 3–4): `having` (the strongest enforce candidate — `engine.aggregate()`
currently rebuilds the driver AST without it), and `cursor` / `distinct`
(shipped SDK producers `QueryBuilder.cursor()` / `.distinct()`; `distinct` is
mis-wired — its only observable effect is suppressing the REST list count).
All three are recorded `dead` with evidence in the new ledger.

**The gate:** `QuerySchema` joins the liveness ledger through the gate's
`SPEC_ONLY_SCHEMAS` override (the `webhook` precedent) as governed type
`query` — the first governance of what *callers* write into a query rather
than what authors write into metadata files. `packages/spec/liveness/query.json`
classifies all 27 walked members (15 live with evidence, 7 experimental via
describe markers, 5 dead), so the next declared-but-inert request member fails
CI instead of needing a person to notice it.

`@objectstack/plugin-security` (patch): the FLS predicate guard's
`windowFunctions` walk is pruned — the clause no longer exists to leak through.
The `having` and `aggregations[].filter` walks stay, deliberately: those
members remain declared, and the guard being ready is what makes enforcing
them later safe.
