---
'@objectstack/objectql': patch
'@objectstack/driver-memory': patch
---

fix(objectql, driver-memory): a plugin driver's `where` refuses a combinator operand that is not a filter node, as every native driver does; driver-memory gates a class-instance `where` root like a literal one

Clause-②: no (narrowing)
Metadata-protocol: none

On an object served by a plugin driver (a virtual object, `driver-odata` or any other plugin-published driver on an external datasource), the engine's floor applies the `where` itself over the rows the driver returned. A `where` whose `$and` / `$or` element or `$not` operand is not a filter condition object (a condition array, `null`, a string), or whose `$and` / `$or` operand is not a list, was evaluated anyway: `{ "$and": [[{ "stage": "won" }]] }` answered no row, `{ "$or": [null] }` every row, `{ "$not": "won" }` no row, and `{ "$and": { "stage": "won" } }` was read as a one-element list. driver-sql, driver-memory and driver-mongodb refuse each of these. The floor now refuses them too, `INVALID_FILTER` / 400, before the driver is asked for a row, in the drivers' words with the position named, for example `Filter node at where.$and[0] is a array (…), not a filter condition object.` or `Filter combinator "$and" at where.$and requires an array of filter conditions, …`, on `find`, `findOne` and `count`.

driver-memory's shape gate skipped a `where` root that is not a plain object, though the engine admits a class instance there and the driver reads it by its own keys. A class instance carrying `{ $and: [[…]] }` answered no row and one carrying `{ $or: [null] }` threw an uncoded `TypeError`. Such a root is now walked like a literal one and refused in the same words; a class instance carrying a valid filter answers what its literal twin answers. Only in-process callers can pass one: JSON over HTTP always parses to plain objects.

To fix a refused call, write each `$and` / `$or` element and the `$not` operand as a plain filter object, and `$and` / `$or` as a list of them: `{ "$and": [{ "stage": "won" }] }`, not `{ "$and": [[{ "stage": "won" }]] }`. Object-form filters answer exactly as before.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape: the refused operands were never valid under FilterConditionSchema (every $and / $or element and the $not operand is declared a FilterCondition object, and $and / $or a list), so no row validated against the spec carries one. What moves is the floor's answer to a where that bypassed the schema, from a wrong row set to a refusal. -->
