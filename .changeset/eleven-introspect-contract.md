---
'@objectstack/spec': minor
---

The engine-registration road into datasource introspection now meets the compiler (#11493, extending the #11123 ruling from the `DatasourceDriverHandle` seam): `IDataDriver` gains an optional `introspectSchema?(): Promise<IntrospectedSchema>` member, and `IDataEngine` gains an optional `introspectDatasource?(datasource: string): Promise<IntrospectedSchema>` member. Both are typed with the spec's one introspection shape (`IntrospectedSchema`, `@objectstack/spec/contracts`). Drivers and engines without introspection stay conformant — the members are optional — while a driver that DOES implement `introspectSchema` with a mis-shaped result (a column flag spelled `isPrimary`, a bare `{ tables }` with no `dialect`/`introspectedAt`) now fails compile at the offending field instead of surfacing at runtime as a federated table whose records cannot be located.
