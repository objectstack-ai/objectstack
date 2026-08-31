---
'@objectstack/driver-memory': patch
---

Stop `driver-memory`'s reference matcher from answering a null comparand or a null value differently from the query path beside it.

`{$eq: null}` did not match a row whose key was ABSENT, although it matched one whose value was a stored `null`. The pre-switch guard in `checkCondition` short-circuited a missing key to "no match" before the `$eq` arm ran, so one operator answered the two readings of "no value" two ways — while the live mingo path, `formula`, the SQL family and the analytics normalizer all read `$eq: null` as the null predicate. `$eq` now reaches its arm, whose loose comparison had the right answer for both readings all along, exactly as its complement `$ne` already did.

`{$between: [null, null]}` matched every VALUED row, and a well-formed bounded `$between` matched a null-VALUED row. Both come from one line: the range arm was written as an exclusion test, and a relational comparison against a null is false in both directions, so neither disjunct fired and a bounded range stopped bounding — the widening direction, which on a row-level-security read scope is a permission bypass rather than a degraded filter. The arm decides comparability before it compares now: a no-value row is not inside a range with a real bound, a valued row is not inside a range whose bound is absent, and the degenerate range whose both ends are absent selects the no-value rows. A range with one absent end selects nothing rather than everything.

Every answer above is the one this package's live query path already gave, cell for cell; the two faces no longer answer one filter two ways. Ranges over valued rows, and `$eq` with a real comparand, are unchanged.
