---
'@objectstack/objectql': patch
---

fix(objectql): `engine.aggregate` refuses a combinator operand that is not a filter node in an aggregation's own `filter` and in `having`, as `where` does

Clause-②: no
Metadata-protocol: none

In `engine.aggregate`, an `aggregations[i].filter` or a `having` whose `$and` / `$or` element or `$not` operand is not a filter condition object (a condition array, `null`, a string, a `Date`), or whose `$and` / `$or` operand is not a list, was evaluated anyway. A condition array counted no row, a `null` or string element counted every row, and a non-list `$and` was read as a one-element list. The same operand in a `where` is refused by driver-sql, driver-memory and driver-mongodb. Both positions now run the drivers' shape gate first, before any row is read, and answer `INVALID_FILTER` / 400 in `where`'s words with the position named, for example `Filter node at aggregations[1].filter.$and[0] is a array (…), not a filter condition object.` or `Filter combinator "$or" at having.$or requires an array of filter conditions, …`. An empty and a populated table answer alike.

To fix a refused call, write each `$and` / `$or` element and the `$not` operand as a plain filter object, and `$and` / `$or` as a list of them: `{ "$and": [{ "stage": "won" }] }`, not `{ "$and": [[{ "stage": "won" }]] }`. Object-form filters answer exactly as before.
