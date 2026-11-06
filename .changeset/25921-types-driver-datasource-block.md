---
'@object-ui/types': patch
---

refactor(types)!: delete the fifteen driver and datasource interfaces nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#SqlDriverInterface, @object-ui/types#ConnectionConfig, @object-ui/types#DriverQueryResult, @object-ui/types#BatchOperation, @object-ui/types#BatchResult, @object-ui/types#TransactionContext, @object-ui/types#CacheManager, @object-ui/types#ConnectionPool, @object-ui/types#DatasourceRegistration, @object-ui/types#DatasourceType, @object-ui/types#DatasourceMetric, @object-ui/types#DatasourceAlert, @object-ui/types#DatasourceManager, @object-ui/types#HealthCheckResult, @object-ui/types#DatasourceMetrics) the retired operands are TypeScript-only interfaces and unions for a server-side SQL driver and a datasource manager that no renderer, adapter or host implements; nothing in the workspace or in hotcrm imports any of them from the package entry, they have no zod twin, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these fifteen types from `@object-ui/types`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

They are **gone from the package, not only from the entry**: the "Phase 3.6" driver interfaces and the "Phase 3.7" datasource interfaces at the end of `data-protocol.ts` were read only by each other. Nothing implemented the driver interface and nothing constructed the datasource manager; the client talks to data through the `DataSource` interface instead. Every other name of `data-protocol.ts` stays exported unchanged, among them `DriverQueryConfig`, `SqlQueryAST`, the query-AST node types, `AdvancedFilterSchema`, `FilterBuilderConfig` and `ObjectValidationRule` with its variants.

What leaves, and what to write instead:

- FROM `SqlDriverInterface`, `ConnectionConfig`, `DriverQueryResult`, `BatchOperation`, `BatchResult`, `TransactionContext`, `CacheManager`, `ConnectionPool` TO no replacement in this package. A client reads and writes data through `DataSource` (`BatchTransactionOperation` with `DataSource.batchTransaction` for a transactional batch); the platform's runtime driver contract is `DriverInterface` from `@objectstack/spec/data`.
- FROM `DatasourceRegistration`, `DatasourceType`, `DatasourceMetric`, `DatasourceAlert`, `DatasourceManager`, `HealthCheckResult`, `DatasourceMetrics` TO no replacement in this package. An authored datasource is `DatasourceSchema` from `@objectstack/spec/data`; a host that kept its own registry declares these shapes locally.
