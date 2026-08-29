---
"@objectstack/driver-mongodb": patch
---

fix(driver-mongodb): refuse the retired `array_agg` / `string_agg` instead of lowering them (#13075)

`buildAccumulator` still carried `case 'array_agg'` and `case 'string_agg'`
arms — both lowering to `$push` — plus a matching `string_agg` join in
`postProcessAggregation`. Both names left `AggregationFunction` at **#6188**
under ADR-0049 enforce-or-remove, and both SQL faces have refused them as
class-1 undeclared names ever since (`driver-sql`'s `refuseAggregateFunction`,
`driver-turso`'s `RemoteTransport`, each `INVALID_QUERY` / **400**).
`driver-mongodb` was the only face still answering them, so **one query got a
400 on two backends and a `$push` array on the third** — the local/remote fork
#5907 exists to prevent, one vocabulary later.

Why this face kept them when `objectql`'s in-memory fallback deleted its arms
for the same two names at #6188: that fallback switches on the **enum type**, so
`case 'array_agg'` there stopped type-checking the moment the value left the
enum. `AggregationInput.function` here is a bare `string` — the driver's own
`aggregate` reads aggregations through an `any` cast — so these arms compiled
fine and survived the retirement unnoticed.

Both names now answer `INVALID_QUERY` / **400**, answer-for-answer parity with
both SQL faces. They are named explicitly rather than left to fall through.
When this change was written, falling through was not safe at all:
`buildAccumulator`'s `default` arm answered `{ $sum: … }`, so deleting the arms
alone would have turned a visibly-wrong ARRAY into an arithmetically PLAUSIBLE
NUMBER — strictly the worse failure, and exactly the defect #13076 has since
fixed in that arm (#12818). Naming them was correct whichever order the two
landed in, and now that #13076 is on `main` the named arm still draws the
distinction `AggregationFunction`'s own error map draws: a caller who bypassed
the parse door is told the name was **removed** at #6188, which is a different
fact from `default`'s "is not a declared aggregate function". Both producers are
kept for that reason.

The retirement prescription itself is not restated here — it lives once, on the
enum's error map in `@objectstack/spec`, and a copy in the driver would be a
second wording of one vocabulary with nothing keeping the two in step.

**Graded `patch`, deliberately.** No correct query's answer moves: all six
declared functions are byte-identically unchanged, pinned by a positive control
in the same suite that walks `AggregationFunction.options`. `AggregationNodeSchema`
already rejects both spellings at the parse door, so the only callers whose
behaviour changes are ones reaching the exported builder or the driver's
`aggregate` directly — and they were reading a value the protocol has no name
for. Nothing to migrate: read the rows with an ordinary `fields` query and shape
them in the caller, or model the roll-up as a stored field.
