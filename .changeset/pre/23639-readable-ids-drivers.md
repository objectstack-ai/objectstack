---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/driver-sql': minor
'@objectstack/driver-sqlite-wasm': minor
'@objectstack/driver-turso': minor
'@objectstack/driver-memory': minor
'@objectstack/driver-mongodb': minor
---

feat(drivers): the five drivers compile the composed `ReadableIds` leaf or refuse it with one envelope, and the leaf's conformance case-set lands with the suites that run it (ADR-0139 D3)

Clause-②: yes

The engine already composes every `ReadableIds` leaf at its executor boundary (ADR-0139 D2). Until now no driver evaluated the composed leaf; each driver now either compiles it or refuses it.

- **`@objectstack/driver-sql`** compiles `{ field: { $in: <composed leaf> } }` to `field IN (SELECT id FROM <parent table> WHERE <scope> AND <tenant wall>)`. The subquery's tenant wall is `applyTenantScope` on the parent table with the outer read's own options. `find`, `count`, `aggregate` and the other read doors issue one statement, so they agree. The statement binds only the scope's own values and the two walls, never one parameter per readable parent: a reader with more than 2,000 readable parents gets every row they may see. `applyFilters` and `applyFilterCondition` (both `protected`) take the read's `DriverOptions` as a new optional last parameter, which the subquery needs.
- **`@objectstack/driver-sqlite-wasm`** and the local face of **`@objectstack/driver-turso`** inherit that compile. **Turso's remote face** has a compiler of its own. `TursoDriver` resolves the leaf into the parent's remote table, its scope and its tenant wall, using the same chokepoint, and `RemoteTransport` compiles the same semi-join.
- **`@objectstack/driver-memory`** evaluates the leaf in process. It reads the parent under the composed scope, then tests membership. It owes no tenant wall, because it refuses every tenant-scoped call.
- **`@objectstack/driver-mongodb`** refuses the leaf, composed or not, until a pipeline form is measured (ADR-0139 open item O3).
- **The refusal is the same on every driver**: `INTERNAL_ERROR` / 500, never `INVALID_FILTER`. A driver gives it for an uncomposed leaf at any position (the direct driver call that bypassed the engine), a composed leaf outside a `$in` comparand, and every leaf on `driver-mongodb`. The message names the driver, the leaf and the remedy. It is logged at `error` once per driver. No `DriverCapabilities` bit is added.
- **`@objectstack/core`** exports the shared pieces: `findMisplacedReadableIds`, `replaceComposedReadableIds`, `readableIdsDriverRefusal`, `refuseReadableIdsOnce` and the `MisplacedReadableIds`, `ReadableIdsDriverRefusalError` and `ReadableIdsRefusalLog` types.
- **`@objectstack/spec`** exports the leaf's driver conformance case-set from `@objectstack/spec/data`: `READABLE_IDS_CASES`, the fixture (`READABLE_IDS_PARENT_OBJECT`, `READABLE_IDS_CHILD_OBJECT`, `READABLE_IDS_PARENT_ROWS`, `READABLE_IDS_CHILD_ROWS`), the refusal envelope `READABLE_IDS_REFUSAL`, and their types. Every driver package runs the case-set, and the driver conformance gate records that with no ledger rows.
