---
"@objectstack/service-analytics": minor
---

fix(analytics)!: a measure emits what it declares, instead of `COUNT(*)` (#4157)

`NativeSQLStrategy.resolveMeasureSql` answered `COUNT(*)` to three different
questions it could not otherwise answer — each time aliased under the name the
caller asked for, so the result looked like an answer:

1. **A measure the cube does not declare.** `lookupMember`'s synthetic
   relation fallback is dimension-only, so any undeclared or mistyped measure
   name landed here. `measures: ['revenue']` against a cube without it returned
   `COUNT(*) AS "revenue"` — a row count presented as revenue.
2. **A `number`/`string`/`boolean` metric.** `AggregationMetricType` documents
   these as *"Custom SQL expression returning a number / string / boolean"*: the
   measure's `sql` **is** the computation — a ratio, a `CASE`, a window
   function. The expression was discarded and replaced by a row count.
3. **An unrecognised `type`.** Same silent substitution.

Now: an undeclared measure and an unrecognised type **throw**, naming the
declared measures and both accepted vocabularies respectively; a custom-
expression type emits its expression unwrapped. The six aggregates are
unchanged.

**A dot no longer implies a relationship hop.** `qualifyAndRegisterJoin` split
any dotted string into a join chain, so the expression `SUM(account.amount)`
became `"SUM(account"."amount)"` *plus* a `LEFT JOIN "SUM(account"` — invalid
SQL naming a table that does not exist. Harmless only while the result was
being thrown away for `COUNT(*)`; emitting the expression makes it matter. A
dotted string is now treated as a path only when every segment is a bare
identifier, so `account.amount` still lowers to a qualified column and a join,
and an expression is emitted as written. That also fixes the same mangling for
an *aggregate* measure whose `sql` is an expression — `type: 'sum'` with
`sql: 'SUM(account.amount)'` was producing the same garbage.

**Breaking, narrowly.** Two inputs that used to produce SQL now raise: a query
naming an undeclared measure, and a cube measure with a type outside
`AggregationMetricType`. Both were returning a wrong number rather than data,
so nothing correct can depend on them — but a caller that was silently getting
row counts will now see an error, which is the point. This is the trade #3948
settled for the drivers.

Datasets are unaffected: `aggregateToMetricType` only ever emits an
`AggregationFunction` member, so a compiled dataset never had a
custom-expression measure or an unknown type. The reachable path is a
hand-authored Cube.

`metric-type-coverage.test.ts` asserts the aggregate and expression sets
*partition* `AggregationMetricType`, so a tenth metric type fails a test rather
than reaching the throw. Both sets are named, not derived as each other's
complement — deriving would classify a new *aggregate* as an expression and emit
a bare column, a different silent wrong answer.

Verified: **460 tests across 35 files** green, including the four suites that
assert `COUNT(*)` — all of them use a *declared* `type: 'count'` metric, so none
relied on a fallback. The 14 new tests were confirmed to fail against the old
behaviour (6 of 10 in the behaviour suite) before the fix.
