---
'@objectstack/plugin-security': patch
'@objectstack/service-analytics': patch
'@objectstack/driver-turso': patch
'@objectstack/spec': patch
---

fix(plugin-security): a `controlled_by_parent` detail's read scope is the engine's `ReadableIds` leaf over its master — one statement per read, no master id list, 200 past the dialect's bind limit

Clause-②: no
Metadata-protocol: none

- **`@objectstack/plugin-security`.** The read derivation for a `controlled_by_parent` object answers `{ masterFK: { $in: ReadableIds.of(master) } }` (ADR-0139 D6, the leaf's seventh consumer) in place of a master id list it pre-scanned under a system context and bound into `$in`. The engine composes the leaf at its executor boundary from this service's own `canReadObject` / `getReadFilter` of the master — recursively down a master chain — and the driver compiles one statement with the master inside a subquery. Measured before: 2 statements per find and 4 per find + count on a detail, and `DATABASE_ERROR` / 500 past ~32,800 masters (`too many SQL variables`). Now: 1 and 2, no scan of the master, and 200 with the right rows at 33,000 masters. Every row set is unchanged: plain, restricted, unrestricted (`viewAllRecords`), delegated (the ADR-0090 D10 intersection), two-level chains, null and dangling master pointers (still excluded), and a caller the master object does not admit (still nothing). A metadata cycle and a chain past the depth bound still answer zero rows, now from a registry-only walk that pre-empts the engine's own refusal. A write verb's predicate carries no leaf (ADR-0139 D1): a predicate write of a detail is narrowed by the read door's answer and judged per master, as before.
- **`@objectstack/service-analytics`.** The engine-bound merges (`ObjectQLStrategy.withReadScope`, its FK attribute map, and the plugin's record-label pass) admit the leaf and hand the scope to the engine, which composes it as a find does. `NativeSQLStrategy.canHandle` declines a query whose base or joined object's read scope carries the leaf, so a `controlled_by_parent` object's analytics query routes to the ObjectQL strategy and serves the find path's rows. `compileScopedFilterToSql` refuses a scope carrying the leaf by name, in its existing `READ_SCOPE_COMPILE_FAILED` / 500 envelope: the `/api/v1/analytics/sql` dry-run echo of a `controlled_by_parent` object now refuses where it rendered the bound id list — it runs no composition and shows no statement it would not run. A filter an author writes keeps its judgement on every face.
- **`@objectstack/driver-turso`.** The remote face resolves a composed leaf nested inside a composed leaf's scope through `toRemoteWhere` with the outer read's options, so a two-level `controlled_by_parent` chain on a remote Turso datasource answers rows instead of `INTERNAL_ERROR` / 500.
- **`@objectstack/spec`.** One nested-leaf row in `READABLE_IDS_CASES`, so every driver's conformance suite measures the shape, and the comparand-shape door's docblock names both callers that pass `admitReadableIds`. No schema, accept set or export of a metadata key moves.
