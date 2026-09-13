---
'@objectstack/spec': patch
---

`date-macros.zod.ts`'s module header states the ADR-0053 D-D upper-bound rule the platform implements, instead of the rule it replaced

The header's "Out of scope" block told an author that on a `datetime` column
`<= {current_year_end}` **stops at midnight on the 31st**, and prescribed the
half-open `< {next_year_start}` as the fix. That is the pre-ADR-0053 reading.
The platform rule has been the opposite since #3777: a bare `YYYY-MM-DD` used
as an upper bound denotes the WHOLE day, compiled half-open to the next
calendar day. It is stated once, in
`packages/spec/src/data/calendar-day.ts` (ADR-0053 D-D), whose own operator
table reads:

| Operator | A bare `YYYY-MM-DD` on a `datetime` column means |
|---|---|
| `$gte` / `$gt` / `$lt` | that day's `00:00:00.000` — already correct as written |
| `$lte`, a `$between` max, a `dateRange` end | the WHOLE day → compile `< nextUtcCalendarDay(day)` |

and which `packages/spec/src/data/temporal-conformance.ts` pins cross-driver:
the case *"datetime: bare-day `$lte` keeps the whole final day"* expects
`d_mid` (09:15 on the boundary day) and `e_late` (21:40 on it) as members.

**Why this header and not a note.** It is the doc comment on the vocabulary an
AI author reaches for, and it is the one place in the tree that says what a
`*_end` token does on the right-hand side of an operator. Both the old
prescription and the correct spelling parse, run and return rows, so nothing
downstream reports the mismatch — the author simply carries the wrong model
into every later filter.

**What the correction does.** The load-bearing first clause is kept verbatim: a
`*_end` token IS the period's last calendar DAY. What follows now **cites**
`calendar-day.ts` rather than restating the rule, so the two statements cannot
drift apart again, and the half-open detour is refused by name for the reason
it is now wrong — the widening is already applied.

⛔ No behaviour changes. The diff is comment lines only; no schema, accept set,
authorable key or published payload moves.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/spec`'s published `files[]` lists
`src/**/*.zod.ts`, so this file ships verbatim as source, and the header is the
first thing in it.

The generated reference page `content/docs/references/data/date-macros.mdx`
carried the same sentence — it is rendered from this header and is marked
AUTO-GENERATED — and is regenerated here with
`pnpm --filter @objectstack/spec gen:schema && … gen:docs`.
