---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

docs(spec, objectql, metadata-protocol): the transaction docblocks no longer say the in-memory driver cannot roll back

Clause-②: no
Metadata-protocol: none

TSDoc only; no behaviour, type or export changes. The edited docblocks land in the shipped `dist/*.d.ts` (and `@objectstack/spec` ships `src/**/*.zod.ts` itself), so they publish:

- `driverSupportsTransactions` (`@objectstack/spec`): the in-memory driver is no longer listed among drivers with no `beginTransaction`; it implements `beginTransaction` / `rollback` by snapshotting its whole store.
- `ObjectQL.transaction` (`@objectstack/objectql`) and `SysMetadataEngine.transaction` (`@objectstack/metadata-protocol`): the drivers that cannot roll back are a test double with no `beginTransaction` and those declaring `supports.transactionsUnsupported` (remote Turso, OData). The in-memory driver does roll back, restoring the whole store to its state at begin: no isolation, and a rollback also discards what other callers wrote since that begin, so do not rely on it with concurrent writers.
