---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/formula': patch
'@objectstack/service-analytics': patch
---

Order temporal operands correctly when one side is a JS `Date` on the two
type-blind filter backends (ADR-0053 D-A3 / #4191).

`utcInstantMs` joins `nextUtcCalendarDay` in `@objectstack/spec/data`
(re-exported from `@objectstack/core`): it reads the UTC instant a temporal
operand denotes, accepting only unambiguous spellings — a `Date`, epoch ms, a
bare `YYYY-MM-DD`, and an ISO timestamp with or without an explicit zone (a
zone-naive one being UTC, per D-B2) — and returning `null` for everything
else, notably a bare wall clock, which denotes no instant.

Both type-blind evaluators now use it to compare a `Date` against wire text,
which JS relational operators cannot do: `<` and friends coerce with hint
`number`, so the `Date` becomes its epoch and the string becomes `NaN`.

- `formula`'s `matchesFilterCondition` (the RLS write-side `check`) dropped
  every `Date`-valued row in 10 of the 16 shared conformance cases. The
  post-image is the caller's raw write payload, so an SDK write of
  `new Date()` hit this directly, and fail-closed turned it into a **denied
  write**.
- `service-analytics`' preview evaluator diverged on the same 10 cases in
  BOTH directions, because `String(new Date())` sorts after every `'2026-…'`
  comparand — a drafted chart both lost rows and gained ones, then changed
  its numbers at publish. Rows from a mongo-backed dataset arrive as BSON
  `Date`s, so this was reachable in normal use.

Comparisons that did not involve a `Date` are unchanged.
