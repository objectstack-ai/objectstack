---
"@objectstack/spec": minor
"@objectstack/service-analytics": patch
---

feat(spec): a shared temporal conformance matrix, and the `$between` gap it found (ADR-0053 D-A3, #4081)

`@objectstack/spec/data` gains `TEMPORAL_ROWS` and `TEMPORAL_CASES` — the
single set of temporal filter cases every backend is checked against, the twin
of the existing `FILTER_LOGIC_CASES`. Five backends consume it and assert **row
results**: `driver-sql` (and, through the live-dialect CI job, real Postgres and
MySQL), `driver-memory`, `driver-mongodb` (real MongoDB), the analytics preview
evaluator, and `formula`'s RLS write-side `check`.

This is the regression backstop ADR-0053 D-A3 has asked for since 2026-06 and
the last of its decisions to be actioned. Four separate incidents — #3650,
#3773, #3777, #4047 — were each found by a human by accident, and each left a
suite proving only its own issue against its own fixture. Nothing held the
backends to one standard, so the fifth divergence had nowhere to fail.

**`service-analytics` — a real fix the matrix found on its first run.** The
draft-preview evaluator had no `$between` case, so it fell through to its
permissive `default` and matched **every** row: a drafted dashboard carrying a
range filter charted the entire dataset, then changed its numbers at publish —
the exact continuity the preview exists to provide. It now evaluates
`$between`, sharing the upper-bound helper with `$lte` so the whole-day
calendar-day rule (#3777) applies to a range's max as well.

Also recorded (ADR-0053 D-A3.1): `$gt` with a bare-day comparand on a
`datetime` column cannot agree between typed and type-blind backends, and the
gap is irreducible without field types. It is asserted in the shared matrix on
`date` only, with the `datetime` cell left to the typed drivers' own suites,
rather than papered over.
