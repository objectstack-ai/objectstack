---
"@objectstack/driver-memory": patch
---

fix(driver-memory): a no-value row satisfies `$nin` / `$notContains` in the reference matcher (#13166)

`memory-matcher`'s `match()` — the reference face `driver-sql` was aligned TO for
#5146 — diverged from the platform's settled answer in 3 of 6 measured cells. The
ruling is the INCLUDE direction: a row whose field has no value SATISFIES a
negation-carrying operator (`$ne` / `$nin` / `$notContains`). That is #5146
extended by #5298 option A, re-affirmed on 2026-08-10 after the reversal was
priced and withdrawn.

"No value" has two readings and the divergence had two INDEPENDENT causes, one
reachable from each:

- a MISSING key short-circuited to "no match" in `checkCondition`'s pre-switch
  guard, whose allowlist named `$ne` but not `$nin` / `$notContains`;
- a `null` value failed the `$notContains` arm on its `typeof value !== 'string'`
  TYPE test rather than on the predicate — which the guard above cannot reach.

Both are fixed, and both now answer one named predicate rather than two spellings
of one ruling.

**Grading — what does NOT change.** `InMemoryDriver.find()` is unaffected:
`match()` is not part of this package's export surface, and the live mingo query
path users actually reach already answered the include direction (measured on the
card's fixture: `['2','3']` for all three operators, before and after). Nothing
moved on the SQL side either — `driver-sql` (2241 tests) and `formula` (643) are
untouched and green, because this change moves `driver-memory` TO the answer they
already gave. The observable effect is on the reference face itself: the
package's two filter faces now agree for these operators where they used to
disagree.

`$exists` is deliberately NOT included — it is the neighbouring cell (#13195),
with a different backend list, and remains a pinned divergence.
