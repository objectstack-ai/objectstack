---
'@objectstack/objectql': patch
---

Clause-②: no (same values for every summary kind on both dialects; fewer statements; no accepted shape or public export widens; if collapsing a parent's per-field updates fires a parent hook fewer times, the PR body says so, as the card asks; the dev confirms)
Metadata-protocol: none

Roll-up `summary` recompute after a child write is cheaper. Each parent the write touched is now written once, carrying all of its summary fields, instead of once per summary field. A multi-row write (`insert` with an array, a predicate `update` or `delete`) computes each summary field for all of its parents with one grouped aggregate (`where fk in (…) group by fk`, at most 500 ids per statement) instead of one aggregate per parent. The stored values are unchanged for every summary kind (count, sum, min, max, avg, filtered).

What a parent's write path observes changes in count only: a parent with two summary fields over the same child now runs its update hooks, validation, audit entry and realtime event once per recompute instead of twice, with both fields in one payload. A single-row write still asks the same one-parent aggregate. A roll-up over its own object, or a cycle of roll-ups that leads back to the child object, keeps the per-parent order. A failed parent write still reports one failure per summary field it carried.

Measured on SQLite and PostgreSQL 16 through the engine: a 50-row insert over 10 parents with two summary fields went from 81 to 33 statements (one summary field: 41 to 32); a loop of 50 single-row updates with two summary fields went from 550 to 400 statements.
