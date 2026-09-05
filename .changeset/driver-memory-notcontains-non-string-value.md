---
"@objectstack/driver-memory": patch
---

fix(driver-memory): the reference matcher's `$notContains` arm answers the predicate, not a type test, for a stored non-string value

`match()` used to answer `{ n: { $notContains: '5' } }` with NO for `{ n: 5 }` — the arm read `typeof value !== 'string' || value.includes(target)`, so a number failed `$contains` (correct) AND its negation (wrong: for the very reason a number cannot contain the substring, it does not contain it). This package's own live mingo path admitted the row, so one filter answered two ways depending on which face was asked; on this face the failure mode was silently dropped rows.

The arm now answers what `FILTER_TEXT_CASES`' new `score` rows declare on every face (maintainer ruling 2026-09-05 on the contract card): a stored value that is not a string never satisfies a positive text operator and always satisfies `$notContains`. The no-value cells keep their #13166 answer; nothing else in the matcher moved.
