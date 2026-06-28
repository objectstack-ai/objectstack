# @objectstack/metadata-protocol

The ObjectStack metadata-management protocol, extracted from `@objectstack/objectql` per [ADR-0076](../../docs/adr/0076-objectql-core-tiering.md).

Implements `ObjectStackProtocol`: `sys_metadata` CRUD, draft/publish lifecycle, write locks, package ownership/installation, metadata diagnostics, seed application, and build probes.

It uses a data engine purely as storage + schema registry, injected at runtime via the `MetadataHostEngine` interface — so this package does **not** depend on `@objectstack/objectql`.
