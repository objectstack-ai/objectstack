---
"@objectstack/driver-sql": minor
"@objectstack/driver-turso": minor
"@objectstack/driver-sqlite-wasm": minor
"@objectstack/spec": minor
"@objectstack/objectql": patch
---

feat(drivers,spec)!: `GroupByNode.alias` is honoured by the SQL faces — one aggregate, one column key (#6401)

`GroupByNodeSchema` has declared `alias` ("Alias for the projected group
value", defaulting to `field`) for as long as the structured `groupBy` entry has
existed. Exactly one execution path read it. The result: the SAME query came
back with a different result-column key depending on which path the engine
happened to take.

```ts
groupBy: [{ field: 'closed_at', dateGranularity: 'month', alias: 'qtr' }]
```

- pushed down to a driver ⇒ rows keyed **`closed_at`**
- run through the in-memory fallback ⇒ rows keyed **`qtr`**

And the choice between them is `engine.ts`'s
`allStructuredSupported && !tzRequiresInMemory` — a driver capability bit and a
`timezone`, neither of which the caller can see. That is the multi-face
consistency invariant broken in its quietest form: both answers are valid rows,
so nothing throws and nothing looks wrong.

**Resolved to ENFORCE**, and the leg was chosen by measurement rather than
taste. ADR-0049 splits on whether the feature already exists: a *dangling*
promise is removed, a *live* one with a missing gate is enforced. `alias` is
live — three consumers read it and change behaviour
(`in-memory-aggregation.ts`, `MemoryDriver.performAggregation`, and
`chartAggregateCategoryKey`), and the publish gate *compels* it:
`validate-react-page-props.ts` errors `REACT_CHART_AXIS_UNKNOWN` unless a
chart's category axis is bound to `alias ?? field`, telling the author in so
many words to "bind it to" the alias. A key the build gate makes you write is
not a dangling promise. The count of real non-test producers is **zero**, which
is what makes enforcing safe rather than what argues against it: no shipped
payload changes its result keys.

**What changed, on every SQL face at once** — a fix landing on one and not its
twin is the #6203 shape, and `TursoDriver` picks its face from `url`:

- **`driver-sql`** — both limbs of the structured `groupBy` branch project
  `alias ?? field`: the date-bucket limb aliases the bucket expression to it,
  and the plain limb emits `?? as ??` (only when the name actually moves — an
  alias equal to the field emits no self-rename). `presentedOutput` is now keyed
  by the OUTPUT column, matching how the aggregation branch beside it has always
  worked; an aliased group value went unpresented before.
- **`driver-turso` REMOTE** — the same projection, `"field" AS "alias"`. The
  alias reaches the statement as a quoted identifier and is therefore held to
  `assertSafeIdentifier`, exactly like `field`.
- **`driver-sqlite-wasm`** — inherits `SqlDriver`'s compiler; covered by its own
  conformance suite rather than by assumption.

**GROUP BY still keys on the FIELD** on every face. Only the projection is
renamed, so the buckets are unchanged. This is deliberate and pinned: SQLite
resolves output names in `GROUP BY`, so a face that grouped by the alias would
look correct here and diverge on a dialect that does not.

`having` needed no change and now means one thing: it is applied over the
aggregated row's own columns, so a filter on a group projection references the
alias on every path — previously the alias on one path and the field on the
other.

**Conformance.** `AGGREGATION_CASES` (#6409) gains a `groupByAlias` axis and two
cases. Their VALUES are an existing case verbatim — only the key moves — so they
can fail only on the key, which is the point: every wrong answer in this area is
a valid query returning plausible rows. `objectql`'s in-memory fallback is now
**enrolled** as a fourth face, answering #6409's open question ②: it is the face
the SQL three were converged onto, so the new behaviour would otherwise be
pinned against nothing, and reaching it needs no engine at all —
`applyInMemoryAggregation` is a pure function of rows and an AST.

**Reverse verification**, predicted before running. Reverting the in-memory face
to `g.field`: only the two alias cases move and only ONE fails — the degenerate
`alias === field` case stays green, which is why both are in the table.
Reverting the harness to read `c.groupBy` instead of `c.groupByAlias ?? c.groupBy`
— the copied-neighbour mistake: everything passes on an unmodified face, a false
GREEN, which is the failure mode that would have made the axis vacuous.

**Frozen drivers (#5499), measured from source, not flipped.** `driver-memory`
already returned `{ field, alias: node.alias ?? node.field }` and projects under
the alias — it had independently reached the enforce answer, so it needed no
alignment. `driver-mongodb` is a recorded DEBT row and the defect is wider than
`alias`: `buildAggregationPipeline` types `groupBy` as `string[]` and builds
`groupId[field] = '$' + field`, so a structured node — aliased or not — becomes
the literal key `"[object Object]"`. It cannot take a structured `GroupByNode`
at all; `mongodb-driver.ts` passes `(query as any).groupBy`, which is why `tsc`
never saw it. Tracked on #6814.

**Compatibility.** A caller who writes `alias` and reads the result under
`field` on a pushdown path will now find the value under `alias` — which is what
the key has always meant on the fallback path, and what the chart gate already
required. Callers who never write `alias` are unaffected: the emitted SQL is
byte-identical.

<!-- adr-0087: not-required (no-migration-prescription) Nothing is retired: `GroupByNodeSchema.alias` keeps its declaration, its spelling and its type — it starts being HONOURED by three faces that parsed and ignored it. There is no tombstone to write and no authored metadata to rewrite, so there is no mechanical transform a migration could prescribe: every stack that validated before validates after, unchanged. The behaviour change is in the RESULT of a runtime query (a result-column key moves from `field` to `alias` on the pushdown path, converging on what the in-memory path and the chart publish gate already required), which the ledger has no channel for and no upgrader could apply a codemod to. The bang is on the changeset because callers who read that column by the field name must move, and the measured non-test producer count for the key is zero. -->

