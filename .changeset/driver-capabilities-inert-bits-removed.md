---
"@objectstack/spec": major
"@objectstack/driver-memory": major
"@objectstack/driver-mongodb": major
"@objectstack/driver-sql": major
---

refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
described a contract method that no longer exists — and a full liveness audit of
the record (#4634, across objectstack + cloud, objectui confirmed clean) found
`streaming` was not the exception but the rule. Of 34 declared bits, **three**
have a decision-making reader and **thirty-one** were written by every driver
and consulted by no engine, planner, REST layer or renderer:

- Their `.describe()` strings promised engine adaptation that was never built
  ("If false, ObjectQL will fetch all records and filter in memory" — no such
  fallback ever keyed off the bit).
- Zero readers let values go WRONG unnoticed: `SqlDriver` declared
  `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
  `streaming: true` over a full-table read — the exact inverse of the guarantee.
- The real mechanism everywhere else is **method presence**: transactions gate
  on `driver.beginTransaction`, aggregate pushdown on
  `typeof driver.aggregate === 'function'`, schema sync on
  `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
  are called unconditionally.

Survivors (each with a named reader — the bits method presence cannot carry):

| bit | reader |
|---|---|
| `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
| `autonumber` | engine defers autonumber generation to the driver (`engine.ts`) |
| `batchSchemaSync` | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`) |

Migration (FROM → TO):

- Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
  `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
  `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
  `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
  `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
  `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
  `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
  literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
  tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
  error against `IDataDriver.supports` and a parse error carrying the per-key
  prescription, which names the mechanism that actually decides the behaviour.
- `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
  already meant `false` at both readers, so `supports: {}` is now a valid,
  minimal advertisement. If you read `capabilities.batchSchemaSync` from a
  *parsed* config and relied on the materialised `false`, treat absence as
  `false` (both engine readers always did).
- Driver packages: `InMemoryDriver.supports` is now `{}`,
  `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
  is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
  Reading a removed bit off these literals no longer type-checks — and no code
  in any repository did.
- A future capability (streaming reads, vector search, …) returns **with its
  caller and its reader in the same change** — the enforce route of ADR-0049 —
  never as a dangling boolean.

The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
(parse + `tsc` both audible; the schema IS parsed via
`DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
never stack metadata — `supports` lives in driver classes and `DriverConfig`
is plugin TS configuration, so there is no stored row or stack source for a D2
conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
asserting every retired bit is unwritable (`undefined`) and every live bit is
not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
resurrection).

No runtime behaviour changes — that impossibility is the point: every removed
bit had zero readers, and the three live bits keep theirs.
