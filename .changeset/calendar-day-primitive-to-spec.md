---
"@objectstack/spec": minor
"@objectstack/formula": patch
"@objectstack/core": patch
---

fix(formula,spec,core): the RLS write-side `check` evaluator honours calendar-day upper bounds (ADR-0053 D-D)

`@objectstack/formula`'s `matchesFilterCondition` — the evaluator behind RLS
write-side `check` policies (ADR-0058 D4) — compared a bare `YYYY-MM-DD` `$lte`
bound literally. On a `datetime` post-image that meant a policy of the shape
`{ signed_on: { $lte: '{today}' } }` **denied every write made after 00:00**:
the write-side twin of the read-side data loss #3777 fixed, and the last of the
platform's filter backends that disagreed about what a bare day means as a
bound.

`$lte` and a `$between` max now evaluate half-open against the next calendar
day, matching the SQL compiler, the memory and mongo drivers, and the analytics
preview evaluator. Unchanged, per the same semantics table: full-ISO bounds keep
exact-instant semantics, `$gte`/`$gt`/`$lt` keep their midnight anchoring, and a
plain `YYYY-MM-DD` value compares identically (string ordering makes the two
forms equivalent). The evaluator stays fail-closed on a null bound.

**Where the rule now lives.** `nextUtcCalendarDay` moved from
`@objectstack/core` to `@objectstack/spec/data` — beside `date-macros.zod.ts`,
whose vocabulary it interprets. `formula` cannot depend on `core`, and a second
copy of the rule is exactly the divergence #3777 catalogued; `spec` is the one
package all six consumers already depend on, so this adds no dependency edge.

No import changes are required: `@objectstack/core` re-exports the symbol, so
existing `import { nextUtcCalendarDay } from '@objectstack/core'` keeps working.
New code should prefer `@objectstack/spec/data`.
