# @objectstack/driver-sql

## 9.9.0

### Minor Changes

- bfa3102: fix: array-valued field types persist, and `Field.time` accepts time-of-day — two field-type runtime gaps found driving the showcase field-zoo (which had no seed data, so neither was ever exercised).

  **Array/object fields broke every write (driver-sql).** `multiselect` / `checkboxes` / `tags` / `repeater` / `vector` were absent from the SQL driver's JSON-field classification, so their array values reached the better-sqlite3 binder un-serialized and threw _"SQLite3 can only bind numbers, strings, bigints, buffers, and null"_ — a 500 on insert/update for common field types (even `task.labels` on a normal object). The DDL column-type switch and `isJsonField` had drifted into two separate lists; they now share one `JSON_COLUMN_TYPES` source that includes the array/object types, so these columns are created as JSON and round-trip as arrays/objects. A `formatInput` safety net additionally serializes any stray array/object value so an unclassified field degrades to a stored string instead of crashing.

  **`Field.time` rejected every valid value (objectql).** The validator reused the date/datetime branch (`Date.parse`), which is `NaN` for any bare time string — so a `time` field could never accept `14:30` or `09:05:30`. `time` now validates a time-of-day (`HH:MM` / `HH:MM:SS`, optional fractional seconds and `Z`/offset) and still accepts a full ISO datetime; `date`/`datetime` are unchanged.

  Verified live on app-showcase: the full field-zoo specimen (all input-able field types) now persists and round-trips. Regression tests added for both.

### Patch Changes

- 796f0d6: fix(driver-sql): `Field.date` is now stored and returned as a tz-naive `YYYY-MM-DD` calendar day (ADR-0053 Phase 1)

  A `Field.date` ("close date", "due date", "birthday") is semantically a **timezone-naive calendar day**, but the SQL driver was treating it as an _instant_: `formatInput` wrote the value verbatim (keeping any time component, so `dev.db` held `close_date = "2026-07-15T17:24:56.533Z"`), while the filter layer (`coerceFilterValue`) already normalized the comparand to date-only `YYYY-MM-DD`. That write/filter asymmetry meant a date-equality filter — `close_date == '2026-07-15'`, `expires_on: { $in: [...] }`, or a `daysFromNow(n)`-style comparand — compared `"2026-07-15T17:24Z"` against `"2026-07-15"` and **silently matched nothing**.

  This patch aligns the write/read boundary with the date-only contract the filter already enforced:

  - **Write** (`formatInput`): every `Field.date` value (a JS `Date`, a full-ISO string, or an already date-only string) collapses to `YYYY-MM-DD` before insert/update. A `Date` collapses to its UTC calendar day, matching `coerceFilterValue`.
  - **Read** (`formatOutput`): `Field.date` values are returned as `YYYY-MM-DD`, slicing any stored time component. This transparently repairs legacy rows that were written as a full timestamp, so date-equality works **without a data migration**. Read normalization now runs on the `find` path for every dialect (previously only `findOne`), matching the new behaviour.
  - The truncation logic is shared by the filter, write and read paths via a single `toDateOnly` helper, so all three agree on what a date _is_.

  `Field.datetime` is **unchanged** — it keeps full-instant (UTC millisecond) semantics.

  Out of scope (ADR-0053 Phase 2): timezone-aware `today()`/`daysFromNow()`/`daysAgo()`, an org/user reference timezone, and `datetime` render-time TZ. See ADR-0053 and issue #1928.

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- b678d8c: fix(driver-sql): an unknown `$select` column must not zero the result set

  `find()` swallowed any "no such column" error into an empty array. A projected
  `$select` naming a column the table lacks (e.g. a generic list view
  auto-requesting `status`/`due_date`/`image` on an object without them) then made
  the WHOLE query return zero rows — reading to the UI as "no records exist" while
  the data was actually there: a silent data-loss footgun.

  When the failure comes from the projection, retry once with `SELECT *` so the
  real rows still come back (the phantom field is simply absent from each row).
  Non-projection errors (unknown table, etc.) still surface as before. This driver
  backstop holds even when the engine's unknown-field filter cannot fire because
  the object's schema is not populated in the registry (notably the cloud
  multi-tenant runtime).

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Minor Changes

- b990b89: fix(autonumber): one owner for autonumber generation — the persistent driver sequence (#1603)

  Autonumber values were generated in TWO places: the SQL driver's persistent,
  atomic `_objectstack_sequences` table AND a non-persistent in-memory counter in
  the ObjectQL engine. Because the engine pre-filled the field BEFORE calling the
  driver, the driver always saw a value already set and skipped — so the
  persistent sequence was effectively dead code, and a multi-instance / post-restart
  deployment could mint duplicate numbers from the in-memory counter.

  This makes generation single-owner:

  - **`@objectstack/spec`** — `DriverCapabilities` gains an optional `autonumber`
    flag: "driver natively generates persistent autonumber/sequence values".

  - **`@objectstack/driver-sql`** — advertises `supports.autonumber = true`.
    `bulkCreate()` now fills autonumber fields too (previously only `create()` /
    `upsert()` did), so bulk inserts also draw from the persistent sequence.
    Field parsing now honors either the spec-canonical `autonumberFormat` key OR
    the `format` shorthand (both appear in metadata).

  - **`@objectstack/objectql`** — when the driver advertises native autonumber
    support, the engine NO LONGER pre-fills (it defers entirely to the persistent
    driver sequence as the single source of truth). For drivers without native
    support (memory, mongodb) the in-memory fallback is unchanged. The fallback
    also now reads either `autonumberFormat` or `format`. Record-validation
    exempts `autonumber` fields from the `required` check — the value is
    runtime-owned and assigned after validation, so a required record number is
    never rejected as "missing".

  No metadata changes required. Existing data is respected: the driver bootstraps
  each sequence from the current max numeric tail on first use.

### Patch Changes

- 1e8b680: fix(security): close four P0 launch-readiness findings

  - **plugin-auth (P0-1):** `generateSecret()` now throws (fails boot) when no
    `OS_AUTH_SECRET` is set and `NODE_ENV==='production'`, instead of silently
    falling back to a predictable `dev-secret-<timestamp>` (session forgery). The
    dev/test fallback is unchanged.
  - **plugin-security (P0-2):** the permission-resolution `catch` now **fails
    closed** — it logs at ERROR and throws `PermissionDeniedError` rather than
    `return next()`. A degraded metadata service can no longer let every
    authenticated request bypass RBAC/RLS. System operations still bypass as before.
  - **driver-sql (P0-3):** the `contains` / `$contains` operator now escapes LIKE
    metacharacters (`%` / `_` / `\`) in the user value and binds an explicit
    `ESCAPE '\'`, so a value of `%` matches literally instead of every row
    (filter bypass). Correct across SQLite/MySQL/Postgres.
  - **driver-mongodb (P0-4):** the field-operator translator now rejects unknown
    `$`-operators instead of passing them through, blocking `$where` / `$function`
    / `$expr` (server-side JS execution / query-intent bypass). All legitimate
    ObjectQL operators remain allowlisted.

  +12 regression tests across the four packages.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 24c9013: fix(driver-sql): materialize declared object-level indexes (#1459)

  The SQL driver synced columns and field-level `unique`, but silently dropped
  object-level declared `indexes` (`ObjectSchema.indexes: [{ fields, unique }]`).
  As a result several documented multi-column UNIQUE / dedup guarantees were
  never enforced at the DB level — a fresh `dev --fresh` sqlite DB showed only
  primary-key autoindexes.

  `initObjects` now materializes declared indexes (`syncDeclaredIndexes`) after
  the table is created/altered:

  - single- and multi-column indexes, including `UNIQUE`
  - NULL-distinct semantics (the cross-dialect default), so multiple NULL rows
    stay insertable while non-NULL duplicates are rejected — matching the
    convergence-on-conflict pattern the messaging pipeline relies on
  - idempotent: deterministic, length-bounded index names + per-dialect
    existing-index introspection (sqlite/pg/mysql); "already exists" races are
    absorbed
  - indexes referencing a non-materialized (virtual `formula`) column are skipped
    with a warning instead of failing sync

  The `indexes` driver capability flag is now `true`.

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 1.

  Adds the spec foundation and the DDL gate for federating mature external
  databases without ObjectStack ever mutating their schema:

  - `Datasource.schemaMode` (`managed` | `external` | `validate-only`) and
    `Datasource.external` settings, with a cross-field invariant.
  - `Object.external` binding (remote table/schema, writability, column map).
  - Shared error contract: `ExternalSchemaMismatchError`,
    `ExternalWriteForbiddenError`, `ExternalSchemaModeViolationError`
    (stable `code`s) + structured `SchemaDiffEntry` rendering.
  - `driver-sql` DDL gate: schema-mutating DDL (`initObjects`/`syncSchema`/
    `dropTable`) is rejected when `schemaMode !== 'managed'`.

  All changes are additive and backward-compatible (`schemaMode` defaults to
  `'managed'`).

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- 4944f3a: Promote native database client packages so npm consumers can boot without manual installs.

  - `better-sqlite3` is now an `optionalDependency` (prebuilt binaries cover the common case), so `npx @objectstack/cli start` boots a default SQLite database out-of-the-box.
  - `pg`, `mysql2`, `sqlite3`, and `tedious` are declared as optional `peerDependencies` (`peerDependenciesMeta.optional = true`), removing install warnings while keeping the loader-on-demand pattern.

  Fixes: `Knex: Cannot find module 'better-sqlite3'` on fresh `npm install @objectstack/cli` followed by `objectstack start`.

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Minor Changes

- 0cc0374: feat(driver-sql): tenant-isolated auto_number sequences backed by a persistent counter table

  **Breaking nothing; new behaviour is opt-in via object schema.**

  The SQL driver now generates auto_number / autonumber field values via a
  dedicated `_objectstack_sequences` table keyed by
  `(object, tenant_id, field)` instead of scanning the data table for the
  current MAX on every insert.

  Highlights:

  - **Tenant isolation.** Objects with an `organization_id` field get a
    separate counter per organization. Two tenants creating contracts at
    the same time both legitimately observe `CTR-0001`, `CTR-0002`, … in
    their own namespaces — they no longer interleave or skip numbers.
  - **Tenant resolution.** Source order: `row[organization_id]` →
    `DriverOptions.tenantId` → `__global__` sentinel for org-less objects
    (e.g. setup-side singletons share one counter).
  - **Bootstrap from existing data.** On the first reservation in a new
    `(object, tenant, field)` tuple, the driver seeds `last_value` from the
    current per-tenant MAX so legacy/seeded records keep their position
    and downstream inserts pick up monotonically (gaps are tolerated).
  - **Atomic increment.** Each reservation runs in a transaction with
    `SELECT … FOR UPDATE` (where the dialect supports it) and a single
    `UPDATE` of `last_value`. Tested with 25 concurrent inserts in one
    tenant producing 25 distinct sequence values.
  - **Caller overrides honoured.** A row that already has an explicit
    value for the auto_number field is left untouched, and the sequence
    bootstrap respects that value so future reservations advance past it.
  - **Dual spelling.** Both `type: 'auto_number'` (snake) and
    `type: 'autonumber'` (the spec factory output) are recognised.

  Migration notes:

  - The first time the driver handles an auto_number insert, it creates
    the `_objectstack_sequences` table automatically — no manual DDL.
  - Pre-existing data is not renumbered. Gaps introduced by older
    cross-tenant logic (where a tenant's number could "jump" because it
    inherited another tenant's MAX) remain in place; subsequent inserts
    continue from `MAX + 1` in the affected tenant.

- 5b878d9: Generate `auto_number` / `autonumber` field values on insert. The driver
  parses the field's `format` template (e.g. `CTR-{0000}`) to extract the
  prefix and pad-width, then scans existing rows with the same prefix and
  emits `prefix + padded(maxN + 1)` for any row that omits the field.

  Note: per-call MAX+1 — not atomic across concurrent writers. Fine for
  seed-data and low-write demo loads; production deployments should layer
  a dedicated sequence table.

- f0b3972: **Driver-level tenant isolation for objects with `organization_id`.**

  `SqlDriver` now auto-applies a `WHERE organization_id = :tenantId` predicate on every read/update/delete and auto-injects the column on insert when the caller passes `options.tenantId` and the object schema declares an `organization_id` field. `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `count` and `aggregate` are all scoped.

  ObjectQL's engine now threads `ExecutionContext.tenantId` into the driver options for every CRUD entry point (including `expandRelatedRecords`), so a tenant-scoped session can no longer cross tenants — even through lookup expansion or count fallbacks.

  Backward compatible: callers that omit `tenantId` (system tasks, seed scripts) keep getting unscoped behaviour. Explicit `organization_id` on an insert row always wins over the contextual `tenantId` so admin tooling can still target a specific tenant.

  13 new tests in `sql-driver-tenant-scope.test.ts` verify cross-tenant find/findOne/update/delete/count/bulkCreate/updateMany/deleteMany isolation, the unscoped admin path, and that global objects (no `organization_id`) are not scoped.

- 0e63f2f: **Declarative tenant scoping + audit warn for missing tenantId.**

  `SqlDriver` now reads `obj.tenancy.tenantField` first when picking the tenant column for an object, falling back to the implicit `organization_id` detection so legacy objects keep working without a spec migration. Set `tenancy: { enabled: true, strategy: 'shared', tenantField: 'workspace_id' }` on any object to use a custom column.

  Writes (`create`, `update`, `delete`, `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `upsert`) that target a tenant-scoped object **without** `options.tenantId` now emit one `[tenant-audit]` warning per `{object}:{op}` so missing-context bugs surface in CI/logs instead of silently writing globally. The engine auto-silences when `ExecutionContext.isSystem === true` (boot-time seeds, kernel mirrors). Callers can opt out per-call with `options.bypassTenantAudit = true` or globally with `OS_TENANT_AUDIT=0`.

  Driver README now documents the full scope/bypass matrix and the audit warning.

  Three new tests cover the declared-tenant-field path, the audit throttle, and the bypass flag.

### Patch Changes

- 5683206: Document the tenant-isolation bypass on raw `execute()` (both `SqlDriver.execute()` and `engine.execute()`). The behaviour is unchanged — `execute()` has always passed commands through verbatim — but the JSDoc now spells out the security contract so callers know they must inline `WHERE organization_id = ?` themselves or restrict raw execution to genuinely global statements (migrations, control-plane tables).
- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 3.3.2

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
