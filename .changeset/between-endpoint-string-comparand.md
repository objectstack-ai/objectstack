---
"@objectstack/spec": minor
---

fix(spec): `$between` accepts the ISO/clock strings the platform itself produces (#6571)

The sibling half of #5685. Both of `$between`'s endpoints declared
`number | Date | FieldReference` — and the platform's own producers put a
**string** in them. As with the four ordering slots, the declaration did not
merely under-describe reality, it contradicted it, and in the one slot where a
date window is the natural spelling:

- **The date-macro resolver descends into arrays.** `resolveFilterTokens`
  (`@objectstack/core`, `filter-tokens.ts`) has an explicit array arm in its
  `walk`, so a tuple comparand is resolved member by member, and every branch of
  the resolver returns a string. `{ close_date: { $between:
  ['{current_year_start}', '{current_year_end}'] } }` becomes
  `{ close_date: { $between: ['2026-01-01', '2026-12-31'] } }` — two endpoints of
  exactly the type this schema declared it refused.
- **This package's own conformance corpus already spells it.**
  `temporal-conformance.ts`, the shared cross-driver expectation table, states
  three `$between` cases with string endpoints: a `datetime` range with its
  `{90_days_ago}`/`{today}` token twin, the degenerate single-day range, and
  `{ at: { $between: ['08:00:00', '18:00:00'] } }` on a `Field.time` column.
- **The driver already normalises both ends per column type.**
  `SqlDriver.coerceFilterValue` recurses through arrays member-wise, and
  `calendarDayBetweenRewrite` coerces the min and rewrites a bare-calendar-day
  max into the half-open `< next-day(max)` bound (#3777).

**This is additive and declaration-side only.** No producer, caller or driver
changed, and no compile surface needed to: the endpoints were already being
normalised driver-side by column type, so every filter that validated before
still validates.

Widened in all three places this contract is spelled — `RangeOperatorSchema`
(documentation), `FieldOperatorsSchema` (the copy `NormalizedFilterSchema`
validates against and `FieldOperators` is inferred from), and the `Filter<T>`
TypeScript helper. #5685 moved the documentation copy first and had to come back
for the reachable one; both spellings move together here.

In `Filter<T>` the guard stays type-precise because `T` is known, mirroring the
ordering guard slot for slot: a `Date` field also takes the resolver's ISO
strings, a `string` field (a `Field.time` `'08:00:00'`, an autonumber code) is
rangeable instead of collapsing to `never`, and a `number` field stays
numbers-only. Each endpoint is widened independently, so a partially-resolved
range (`[Date, '2026-12-31']`) type-checks.

**The endpoint form the contract guarantees** is the ISO/clock one — an ISO
calendar day (`YYYY-MM-DD`), a UTC ISO-8601 instant, or a wall-clock time of day
(`HH:MM[:SS[.fff]]`). Those are ASCII and fixed-width, so lexicographic order IS
chronological order and every backend agrees. The union is a bare `string`
rather than an ISO refinement for the reasons #5685 measured and this change
re-measured for the tuple: the schema is field-agnostic, an ISO refinement would
reject `Field.time`'s declared `HH:MM` form, and date-only vs full-timestamp is
already reconciled by the driver. Ranging over **non-temporal** text is
therefore permitted but not promised — the order is the backend collation's —
and nothing here promises the endpoints are ordered relative to each other: an
inverted `[max, min]` range is well-formed and matches nothing, at every backend.
