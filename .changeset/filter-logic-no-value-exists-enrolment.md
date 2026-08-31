---
'@objectstack/spec': patch
---

test(spec): `FILTER_LOGIC_CASES` enrols the no-value negated-operator rows (`$nin` / `$notContains`) and `$exists` in both directions; the stale reversal-table cells are refreshed (#13540, #13531)

The published conformance table gains four rows, all implementing rulings that
had already shipped on every scored backend:

- `$nin` / `$notContains` **return the rows with no value** (`['2','3','4']`) —
  the include direction, #5146 extended by #5298 option A, re-affirmed after
  the #5299 reversal was costed and withdrawn. Enrolment was unblocked by
  PR #13356, which realigned the last divergent surface (`driver-memory`'s
  reference matcher).
- `$exists: true` / `$exists: false` **partition the table on has-value**
  (`['1','2']` / `['3','4']`) — never key-presence (#5299 cell 2 / #5962).
  Enrolment was unblocked by PR #13529, which moved the last three
  key-presence exits. Both directions land together because a
  single-direction row is the measured blind spot: `$exists: false` — the
  harm the maintainer's ruling called the hardest live one — was invisible
  while only `$exists: true` was recorded.

The docblock's dated reversal-measurement table is refreshed in the same form
it was taken in: the `driver-memory` reference-matcher cells now read MATCH
(realigned by PR #13356), the three `$exists` cells read has-value (moved by
PR #13529), and the "a `$exists` row cannot be enrolled here yet" paragraph is
rewritten as a closed-gap record.

**Grading: `patch`.** No runtime path changes in any package — both backend
realignments shipped and were graded in their own PRs (PR #13356, PR #13529).
What changes here is the published standard's coverage: a third-party driver
suite that runs the table now runs four more rows, and a red they produce is
the ratchet catching a real divergence from semantics that were already ruled,
not a new contract. (`driver-mongodb`'s server-free translation harness also
learns to model `$regex`, the vocabulary the `$notContains` row emits — a
test-only change, no bump.)
