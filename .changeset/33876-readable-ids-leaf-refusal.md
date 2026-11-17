---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-memory': patch
'@objectstack/service-analytics': patch
---

feat(objectql): a nested-relation condition, and an analytics dimension through a lookup, are refused up front with a stable 400 on a driver that compiles no semi-join (MongoDB, OData), decided by the new `DriverCapabilities.readableIdsLeaf` bit

Clause-②: yes (narrowing) — narrowed: on a driver that does not declare `DriverCapabilities.readableIdsLeaf` (MongoDB, OData, a third-party driver), a nested-relation condition beneath a single-valued relation on `find`, `findOne`, `count` or `aggregate` is refused `INVALID_FILTER` / 400 before anything is read, where it read the related ids first and answered up to 1,000 related matches (past 1,000 it was already refused `INVALID_FILTER` / 400, never truncated); an analytics dimension through a lookup on such a driver is refused `INVALID_QUERY` / 400 before anything is read, where it was served by reading the related records for the grouped ids. Widened: a driver that declares the bit is served by the planned semi-join whatever its name.
Metadata-protocol: added
Skills-docs: follow-up #33875 — skills/objectstack-query/SKILL.md (its nested-relation row still promises the capped id read on every driver; MongoDB and OData now refuse it)

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, accepted value or metadata type is removed, renamed or re-shaped: the one protocol change is the new optional `DriverCapabilities.readableIdsLeaf`, which a driver declares. What moves is a runtime answer on drivers that do not declare it, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment whose data lives on MongoDB, OData or a third-party driver that does not declare `readableIdsLeaf`. The fix:

- FROM `find('opportunity', { where: { account: { region: 'NA' } } })` TO two reads: `find('account', { where: { region: 'NA' }, fields: ['id'] })`, then `find('opportunity', { where: { account: { $in: ids } } })`. The same for `findOne`, `count` and `aggregate`.
- FROM an analytics dimension `opportunity.stage` on a line cube TO a dimension on the lookup field itself (`opportunity`), then a read of `opportunity` for `stage` by those ids.
- FROM an analytics `where` naming a field through a lookup (`opportunity.stage`), or a dataset whose own `filter` does, TO a filter on the lookup field itself (`opportunity` `$in` the ids read from `opportunity` with that condition): the analytics service hands such a leaf to the engine as the same nested-relation condition, so on these drivers it is refused `INVALID_FILTER` / 400 the same way.
- FROM a row-level read scope that holds such a condition (a field through a single-valued relation) TO one on the relation field itself (`account` `$in` the ids it may read): on these drivers an analytics query under the former is refused before anything is read with the withheld `READ_SCOPE_COMPILE_FAILED` / 500, the answer a read scope the engine cannot run already gets.
- A third-party driver whose filter compiler composes the leaf declares `supports.readableIdsLeaf: true` and keeps serving both.

**`DriverCapabilities.readableIdsLeaf`** (`@objectstack/spec`) is a new optional capability bit: the driver's filter compiler compiles (or, in process, evaluates) a composed `ReadableIds` semi-join leaf. `driver-sql` declares it on every dialect (`SqliteWasmDriver` and `TursoDriver` inherit it), and so does `driver-memory`. MongoDB and OData do not. Absence means `false`.

**Where the engine reads it.** A nested-relation condition beneath a single-valued relation on a read verb (`{ account: { region: 'NA' } }` on `find`, `findOne`, `count` or `aggregate`) is planned as one in-database subquery on a driver that declares the bit, as before. On a driver that does not, the engine now refuses the condition before it plans or reads anything: `INVALID_FILTER` / 400, naming the driver and the two-step route (read the related object with that condition, then match the relation field against its ids with `$in`). Until now such a read fell back to reading the related ids first: up to 1,000 related matches were served, and past 1,000 the filter was refused `INVALID_FILTER` / 400. A multi-valued relation and the `where` of `update` / `delete` keep that capped id read on every driver. The engine's filter judge (`IObjectQLEngine.judgeFilter`) answers the same refusal from the driver's declared capabilities, without calling it, so a caller that asks the judge first (the analytics read-scope merge does) gets execution's verdict; an engine that routes the object to no driver does not judge it.

**The analytics dimension through a lookup** (`opportunity.stage` on a line cube, `@objectstack/service-analytics` on the ObjectQL face) is decided by the same bit. On a driver without it the query is refused before anything is read: `INVALID_QUERY` / 400, naming the driver and the route (group by the lookup field itself, then read the related object for its attribute by those ids). Until now it was served by reading the related ids. On a driver that declares the bit, the SQL drivers keep the one joined statement and `driver-memory` and Turso keep the id-expand, unchanged.

