# @objectstack/service-external-datasource

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

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 2 (service core).

  Adds the federation service contract, the type-compatibility matrix, and a
  new service package that introspects, drafts, and validates federated
  objects:

  - `@objectstack/spec`:
    - `data/type-compat.ts` — dialect-aware SQL↔field-type matrix
      (`canonicalizeSqlType`, `suggestFieldType`, `isCompatible`) for
      postgres/mysql/sqlite/snowflake/bigquery/mongo.
    - `contracts/external-datasource-service.ts` — `IExternalDatasourceService`
      plus `RemoteTable`, `GenerateDraftOpts`, `ObjectDraft`,
      `SchemaValidationResult`/`Report`.
  - `@objectstack/service-external-datasource` (new): implements the service —
    `listRemoteTables`, `generateObjectDraft` (renders a reviewable
    `*.object.ts` with `// REVIEW:` markers), `validateObject`/`validateAll`
    (structured `SchemaDiffEntry` diffs), and `refreshCatalog`. Decoupled from
    the kernel via injected I/O; kernel plugin registers it as the
    `external-datasource` service.

  REST routes and the `os datasource` CLI commands follow in a subsequent
  slice.

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
