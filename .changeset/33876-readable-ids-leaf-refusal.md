---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-memory': patch
'@objectstack/service-analytics': patch
---

feat(objectql): a nested-relation condition, and an analytics dimension through a lookup, are refused up front with a stable 400 on a driver that compiles no semi-join (MongoDB, OData), decided by the new `DriverCapabilities.readableIdsLeaf` bit

Clause-②: yes
Metadata-protocol: none

**`DriverCapabilities.readableIdsLeaf`** (`@objectstack/spec`) is a new optional capability bit: the driver's filter compiler compiles (or, in process, evaluates) a composed `ReadableIds` semi-join leaf. `driver-sql` declares it on every dialect (`SqliteWasmDriver` and `TursoDriver` inherit it), and so does `driver-memory`. MongoDB and OData do not. Absence means `false`.

**Where the engine reads it.** A nested-relation condition beneath a single-valued relation on a read verb (`{ account: { region: 'NA' } }` on `find`, `findOne`, `count` or `aggregate`) is planned as one in-database subquery on a driver that declares the bit, as before. On a driver that does not, the engine now refuses the condition before it plans or reads anything: `INVALID_FILTER` / 400, naming the driver and the two-step route (read the related object with that condition, then match the relation field against its ids with `$in`). Until now such a read fell back to reading the related ids first, capped at 1,000 matches. A multi-valued relation and the `where` of `update` / `delete` keep that capped id read on every driver.

**The analytics dimension through a lookup** (`opportunity.stage` on a line cube, `@objectstack/service-analytics` on the ObjectQL face) is decided by the same bit. On a driver without it the query is refused before anything is read: `INVALID_QUERY` / 400, naming the driver and the route (group by the lookup field itself, then read the related object for its attribute by those ids). Until now it was served by reading the related ids. On a driver that declares the bit, the SQL drivers keep the one joined statement and `driver-memory` and Turso keep the id-expand, unchanged.

**Who sees a change.** Only a deployment whose data lives on MongoDB or OData, or on a third-party driver that does not declare the bit. A third-party driver whose filter compiler composes the leaf declares `supports.readableIdsLeaf: true` to keep serving these conditions.
