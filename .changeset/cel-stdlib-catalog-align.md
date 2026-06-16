---
"@objectstack/formula": minor
---

feat(formula): register the CEL functions the authoring catalog advertises (daysBetween, abs, round, min, max, upper, lower, contains, startsWith, endsWith, matches, len, isEmpty, date, datetime)

`introspectScope` / `CEL_STDLIB_FUNCTIONS` advertised 25 functions to authors
(incl. AI), but only 8 were registered — 14 faulted at runtime (`daysBetween`,
`abs`, `round`, `min`, `max`, `upper`, `lower`, `len`, `isEmpty`, `contains`,
`startsWith`, `endsWith`, `matches`, plus `date`/`datetime`). Authors were told
to call functions that don't exist (e.g. `daysBetween` for "days remaining").

Register the genuinely-useful set in `registerStdLib` with dyn-lenient signatures
(so a `Field.date` arriving as a string still works) and internal coercion, and
reconcile the catalog so every advertised entry resolves — guarded by a test that
evaluates every `CEL_STDLIB_FUNCTIONS` entry. Pure additions; no behavior change
to existing expressions.
