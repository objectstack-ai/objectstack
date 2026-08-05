# Plan: External Datasource Federation (ADR-0015) — Implementation

> Implementation plan and progress tracker for
> [ADR-0015 — External Datasource Federation](../adr/0015-external-datasource-federation.md).
> The ADR is the design source of truth; this document scopes the work
> against the **current** codebase and records what has shipped.

## Context

ObjectStack today owns its `default` datasource and freely runs DDL.
ADR-0015 adds the ability to *federate* a mature external database
(Postgres, Snowflake, BigQuery, …) so the AI/REST/View stack can query it
live, **without ObjectStack ever mutating the remote schema**.

The decisive design choice — a federated object stays a normal `Object`,
its remote-ness expressed by the **datasource it points to**
(`schemaMode !== 'managed'`) plus an optional **`object.external`**
sub-record — means almost the entire downstream stack (ObjectQL, REST,
Views, AI tools, RBAC, audit) works unchanged. Behavioural differences are
enforced by three runtime gates.

## Current-state assessment (greenfield)

A repo-wide grep confirmed **zero** prior implementation of `schemaMode`,
`object.external`, `external_catalog`, `IExternalDatasourceService`,
`type-compat`, or the three error classes. The supporting infrastructure
already exists and is reused:

| Already present (reused) | Location |
|:--|:--|
| Driver `introspectSchema()` (dialect-aware) | `packages/drivers/driver-sql/src/sql-driver.ts` |
| Per-object datasource routing | `packages/objectql/src/engine.ts`, `Object.datasource` |
| `kernel:ready` hook pattern for plugins | `packages/runtime/src/*-plugin.ts` |
| Metadata type registry | `packages/spec/src/kernel/metadata-plugin.zod.ts` (`DEFAULT_METADATA_TYPE_REGISTRY`) |
| Error formatting helpers | `packages/spec/src/shared/error-map.zod.ts` |
| oclif CLI command groups (e.g. `data/`) | `packages/cli/src/commands/` |
| Service package template + DI | `packages/services/service-*` |

## The three runtime gates

| Gate | Layer | Where | Enforces |
|:--|:--|:--|:--|
| **1. DDL** | driver | `sql-driver` `initObjects`/`dropTable` (+ future `applyMigrations`) | No DDL when `schemaMode !== 'managed'`. |
| **2. Boot validation** | runtime | new `external-validation-plugin` on `kernel:ready` | Federated object must match remote table (fail/warn/ignore). |
| **3. Write** | data engine | `IDataEngine.insert/update/delete` | Writes need `datasource.external.allowWrites` **and** `object.external.writable`. |

## Phased rollout

| Phase | Scope | Status |
|:-----:|:--|:--|
| **P1** | Spec changes (`schemaMode`, `object.external`, error classes) + DDL gate in `driver-sql` + tests | ✅ **Done** (this branch) |
| **P2** | `IExternalDatasourceService` impl + type-compat matrix + CLI `introspect`/`validate` | ✅ **Done** (service + matrix; REST `/external/*` mounted in `rest-api-plugin`; CLI `datasource list-tables`/`introspect`/`validate`; `engine.introspectDatasource`) |
| **P3** | Boot-validation plugin in `@objectstack/runtime` + `external_catalog` metadata type + caching | ✅ **Done** |
| **P4** | `SchemaRetriever` annotation + agent prompt + AI safety nets (LIMIT injection, timeout) | ✅ **Done** (external badge in `SchemaRetriever.renderSnippet`; `query_data` injects LIMIT + per-query timeout for federated objects via `external.queryTimeoutMs`) |
| **P5** | Studio UI in `../objectui` (wizard, schema browser, mapping editor, validation panel) | ⬜ Todo |
| **P6** | Write gate + `allowWrites`/`writable` double opt-in + tests | ✅ **Done** (`engine.assertWriteAllowed`, called from insert/update/delete; `external-write-gate.test.ts`) |
| **P7** | Additional drivers (Snowflake / BigQuery / MySQL) | ⬜ Todo |

**MVP = P1–P4**: connect a read-only Postgres replica, register a few
tables, let AI Data Chat query them safely. ✅ **MVP complete** — P1–P4 + P6
all landed; remaining work is P5 (Studio UI) and P7 (more drivers).

## P1 — delivered in this change

Spec is additive and backward-compatible (defaults preserve current
behaviour).

1. **`packages/spec/src/data/datasource.zod.ts`**
   - `SchemaModeSchema` enum (`managed` | `external` | `validate-only`),
     exported `SchemaMode` type.
   - `ExternalDatasourceSettingsSchema` (label, allowedSchemas,
     `allowWrites`, validation policy, `credentialsRef`, `queryTimeoutMs`,
     `requirePermission`).
   - `Datasource.schemaMode` (default `'managed'`) + `Datasource.external`,
     with a `superRefine` enforcing the cross-field invariant (external
     settings ⇔ non-managed mode).

2. **`packages/spec/src/data/object.zod.ts`**
   - `ObjectExternalBindingSchema` (remoteName, remoteSchema, `writable`,
     columnMap, introspectedAt, ignoreColumns) + `Object.external`.
   - The object↔datasource cross-artefact invariant is intentionally
     enforced at metadata-load time (P3), not in Zod.

3. **`packages/spec/src/shared/external-errors.ts`** (new)
   - `ExternalSchemaMismatchError` / `ExternalWriteForbiddenError` /
     `ExternalSchemaModeViolationError`, each with a stable `code`.
   - `SchemaDiffEntry` type + pure `renderDiffMessage()` (P2/P3 consume it).

4. **DDL gate — `packages/drivers/driver-sql/src/sql-driver.ts`**
   - `SqlDriverConfig` gains an optional `schemaMode` (stripped before Knex).
   - `assertSchemaMutable()` choke-point throws
     `ExternalSchemaModeViolationError` when `schemaMode !== 'managed'`;
     called from `initObjects` (covers `syncSchema`) and `dropTable`.

5. **Tests** — Zod refinements (datasource modes, external settings,
   object binding), error classes + diff rendering, and the DDL gate
   (managed allows DDL; external/validate-only block create/alter/drop;
   `schemaMode` not leaked to Knex).

## P2 — delivered in this change (service core)

1. **`packages/spec/src/data/type-compat.ts`** — pure, dialect-aware matrix
   (`canonicalizeSqlType` → `suggestFieldType` / `isCompatible`) covering
   postgres/mysql/sqlite/snowflake/bigquery/mongo. Returns `true` / `'lossy'`
   / `false`. Independently unit-tested.

2. **`packages/spec/src/contracts/external-datasource-service.ts`** —
   `IExternalDatasourceService` + `RemoteTable`, `GenerateDraftOpts`,
   `ObjectDraft`, `SchemaValidationResult`/`Report`. Reuses the existing
   `IntrospectedSchema` from `schema-diff-service.ts` and `SchemaDiffEntry`
   from `external-errors.ts`.

3. **`packages/services/service-external-datasource`** (new package) —
   `ExternalDatasourceService` implements the contract:
   - `listRemoteTables` (schema-qualified, `allowedSchemas`-filtered),
   - `generateObjectDraft` (type-compat mapping → reviewable `*.object.ts`
     source with `// REVIEW:` markers on lossy/unknown columns),
   - `validateObject` / `validateAll` (structured diffs: `missing_table`,
     `missing_column`, `type_mismatch`; lossy = warning, hard mismatch =
     error; honours `columnMap` + `ignoreColumns`),
   - `refreshCatalog` (snapshot shape; persistence lands with P3's
     `external_catalog` type).
   The service takes injected I/O (`introspect` / `getDatasource` /
   `getObject` / `listObjects`) so it is decoupled and fully unit-tested; the
   `ExternalDatasourceServicePlugin` wires the live `IDataEngine` +
   `IMetadataService` and registers it as the `external-datasource` service.

### Remaining P2 slice (next)

- **REST routes** under `/api/v1/datasources/:name/external/*` (ADR §6.2).
- **CLI** `os datasource list-tables | introspect | validate` (ADR §6.3) —
  thin oclif commands over the REST routes.
- Driver introspection plumbing: expose
  `getDatasourceDriver(name)` / `introspectDatasource(name)` on the data
  engine so the plugin's default `introspect` works end-to-end.

## P3 — delivered

Gate 2 (boot validation) + remote-schema caching.

1. **`external_catalog` metadata type** — registered in
   `packages/spec/src/kernel/metadata-plugin.zod.ts`
   (`allowRuntimeCreate`, `loadOrder: 6`, system domain) with its Zod schema
   `packages/spec/src/data/external-catalog.zod.ts`
   (`ExternalCatalogSchema` → `ExternalCatalog`: name / datasource /
   `snapshotAt` / dialect / tables[columns]).

2. **Boot-validation plugin** — `ExternalValidationPlugin`
   (`packages/runtime/src/external-validation-plugin.ts`) subscribes to
   `kernel:ready`, calls `external-datasource`'s `validateAll()`, and applies
   each datasource's `external.validation.onMismatch` policy
   (`fail` aborts boot via `ExternalSchemaMismatchError`, `warn` logs,
   `ignore` no-ops). No-op when the service is absent. **Now registered into
   the serve boot sequence** alongside the datasource plugins
   (`packages/cli/src/commands/serve.ts`).

3. **`schemaMode` → driver injection** — `createDefaultDatasourceDriverFactory`
   (`packages/runtime/src/default-datasource-driver-factory.ts`) threads a
   datasource's `schemaMode` into `SqlDriverConfig`, so the P1 DDL gate fires
   for runtime-created external datasources too.

4. **Catalog persistence** — `refreshCatalog` now parses the snapshot through
   `ExternalCatalogSchema` and persists it as an `external_catalog` metadata
   record via an injected `persistCatalog` dep (wired in `plugin.ts` to
   `metadata.register`). Best-effort: a persist failure still returns the live
   snapshot. Tests cover persistence, the read-only/throwing store, and the
   canonicalised shape.

5. **Background drift detection** — `ExternalValidationPlugin` now arms a
   per-datasource `setInterval` for every federated datasource that declares
   `external.validation.checkIntervalMs` (ADR §5.2). Each tick re-runs
   `validateAll()` and emits one `external.schema.drift` event
   (`{ datasource, object, diffs }`, type `ExternalSchemaDriftEvent`) on the
   kernel bus per drifted object — observational, so it never throws or aborts
   the process (unlike boot validation). Timers `unref()` and are cleared on
   `stop()`; re-arming clears prior timers so intervals can't accumulate.
   Consumed by `audit` / `notification` services. Tests cover event emission,
   the validateAll-rejects no-op, selective scheduling, the firing interval,
   re-arm idempotence, and the no-metadata no-op.

## P-C — delivered (runtime "Import as Object", ADR-0015 Addendum)

The runtime persona's create-in-UI bridge: turn a browsed remote table into a
live, immediately-queryable federated object — no git commit (that stays the
GitOps `os datasource introspect` path).

1. **`IExternalDatasourceService.importObject(datasource, remoteName, opts?)`**
   (`packages/spec/src/contracts/external-datasource-service.ts`) → `ImportObjectResult`
   (`{ name, definition, review }`). `ImportObjectOpts` extends `GenerateDraftOpts`
   with `name` (override) + `writable` (object.external.writable opt-in; still
   gated by datasource `external.allowWrites`, ADR Gate 3).

2. **Service impl** (`external-datasource-service.ts`) reuses the `generateObjectDraft`
   pipeline (type mapping + review notes + external binding), applies the
   name/writable overrides, and persists via an injected `persistObject`. Throws
   a descriptive error when no writable metadata store is wired (GitOps-only
   deployment) and when the remote table is missing (before any write).

3. **Plugin wiring** (`plugin.ts`) supplies `persistObject` →
   `metadata.register('object', name, definition)` (runtime origin), alongside
   the existing `persistCatalog`.

4. **REST** — `POST /api/v1/datasources/:name/external/tables/:remote/import`
   (`packages/rest/src/external-datasource-routes.ts`): `201 { object }` on
   success, `503` when the service is absent, `400 external_import_error` when
   import is refused (read-only store / missing table). Body carries
   `ImportObjectOpts`.

5. **Tests** — service: persists read-only by default, name+writable overrides,
   draft-option forwarding (include/rename), throws without a store, throws on
   missing table without persisting (47 green).

### Follow-up notes / open items for later phases

- **DDL gate plumbing (P3)**: ✅ done — `createDefaultDatasourceDriverFactory`
  injects `Datasource.schemaMode` into `SqlDriverConfig`. P1 wired the driver
  side and defaulted to `'managed'`.
- **`applyMigrations` gate**: `ISchemaDiffService.applyMigrations` also
  needs the gate (per ADR §5.1) when the migration runner ships.
- **Lint rule** preventing plugins from bypassing the gate via raw `knex`
  (ADR §12 risk row) — defer to P2/P3 alongside the service.
- **error-map envelope**: map the three `code`s into the shared error
  envelope when P6 surfaces them over REST.
