---
"@objectstack/formula": minor
---

feat(formula): `matchesFilter` resolves the `addDays` offset of a `{ $field }` reference

A reference carrying `addDays` — an integer literal or a nested `{ $field }` reference to a
numeric column (dot-paths walked, as for `$field`) — resolves to the referenced value
shifted by that many whole days, in the shape it arrived in: a `YYYY-MM-DD` calendar day
stays a calendar day (so a `$lte` still covers the whole shifted day), an ISO instant keeps
its time of day, a `Date` stays a `Date`. A NULL offset contributes zero days; a NULL
referenced column — or a value that cannot be read as a date, or an offset that is not a
number — makes the comparison false for every operator, `$ne` included, so `$not` re-admits
the row. A fractional offset value is truncated toward zero, the same reading the SQL
dialects apply. Pinned against the same rows the SQL drivers' conformance corpus carries.
