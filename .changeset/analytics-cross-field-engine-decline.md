---
"@objectstack/service-analytics": minor
---

feat(service-analytics): a field-to-field (`$field`) RLS rule is served on the analytics path — native SQL declines and routes to the engine (#7598)

A CEL permission / RLS rule that compares two columns of the same record —
`compileCelToFilter` lowers it to `{ amount: { $gt: { $field: 'budget' } } }` —
now **works** on `/analytics/query`, whether it arrives in the caller's `where`
or in the read scope the platform compiles from an admin-authored sharing rule.

Before #7694 the two analytics SQL compilers **bound the reference object as the
comparison's value**: the statement compiled perfectly and compared a column
against the text `{"$field":"budget"}`, which no row can hold — an empty chart,
or an RLS predicate quietly answering the wrong row set, with nothing to read.
#7694 stopped that by refusing the shape. This change replaces the refusal with
the answer.

**How.** `NativeSQLStrategy.canHandle` declines a query whose `where` or read
scope carries a reference in a scalar comparand position, so the query falls
through to the lower-priority ObjectQL/engine path — the same decline-and-route
mechanism this strategy already uses for federated objects (ADR-0062 D6) and for
date-bucketed queries. `driver-sql` then compiles the comparison and enforces the
four #5222 security rulings — same-table columns only, declared-only enumeration,
the tenant-isolation column forbidden on both sides, and a matching comparison
class — using the `initObjects` metadata it owns. Those rules stay in exactly one
place; the alternative considered was a `StrategyContext` enumeration hook plus a
second implementation of them inside this package, and a guard that exists twice
is a guard that will eventually disagree with itself.

⚠️ **Query routing now depends on filter CONTENT, not only on query shape.** That
is new behaviour for `canHandle`, and it is deliberate: a query carrying a
cross-field comparison takes the engine path rather than raw SQL, so it is served
by `engine.aggregate` and is slower than a pushed-down statement. Every other
query is unaffected — a literal comparand, a literal read scope and a filterless
query all keep the native-SQL path exactly as before.

**Two positions deliberately still refuse**, and both converge with what
`driver-sql` itself refuses rather than diverging from it:

- `/analytics/sql` — the display echo declines a cross-field comparison instead
  of half-rendering one. It describes an execution it does not perform, and the
  predicate the engine path actually runs is written total across NULLs; what
  this renderer can emit is a comparison against the reference as a bound value,
  which reproduces none of the rows the query returns. `/analytics/query` still
  serves those queries and returns rows — the response simply carries no `sql`
  string.
- a `$field` in a `$between` **endpoint**. No backend serves it (`@objectstack/spec`
  removed the position in #7596), and this compiler splits `$between` into its two
  bounds — so routing it would hand the driver a `$gte` / `$lte` the author never
  wrote, and the range would quietly succeed here while the identical filter is
  refused everywhere else. The refusal message now names that, and points at the
  scalar spelling which *is* served.

The LIKE family and `$in` / `$nin` members keep their existing refusals and
wordings, unchanged.

**Read-scope error envelope: unchanged.** An unsupported rule on the read-scope
lowering still answers `READ_SCOPE_COMPILE_FAILED` / 500 with the message
withheld, exactly as the #5367 ruling set it — no new error code, no move to a
4xx. A read scope is not the caller's document, so it is not the caller's 4xx.

One further fix this needed, in the same class as #7597: `ObjectQLStrategy`
lowered an equality comparand **bare** (`{ amount: 5 }` — correct for a literal),
which for a reference produced `{ amount: { $field: 'budget' } }`, a field spec no
backend reads as an equality. It now emits an explicit `$eq` when the comparand is
a reference, branching on the comparand rather than on the operator. And a
reference comparand no longer takes this door's NULL-safe `$ne` guard (#5298),
which is right for a literal and wrong for a reference — measured, it admitted the
both-NULL row that the shared corpus, both SQL drivers and the in-memory evaluator
all exclude.
