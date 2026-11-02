---
'@objectstack/driver-sql': patch
---

refactor(driver-sql): the comparand bind test reads the list operators from the spec

Clause-②: no
Metadata-protocol: none

The SQL driver bind-tests each member of a `$in`, `$nin` or `$between` list as a comparand in its own right. It now asks `isListComparandOperator` from `@objectstack/spec/data` which operators take a list, instead of keeping its own copy of `$in` / `$nin` / `$between`. The set is the same, so no filter compiles or is refused differently. A later change to the spec's list operators now reaches this driver without a second edit.
