---
"@objectstack/core": minor
---

feat(core): one by-name read of the security catalog (`createSecurityCatalogReader`)

Clause-②: yes (widening)

- **What is new.** `createSecurityCatalogReader({ registry, metadata })` returns a reader with two members: `resolve(type, name)`, the definition a position, permission set or capability name resolves to (or `undefined`), and `list(type)`, one entry per name. `type` is `'position' | 'permission' | 'capability'`. Each entry is `{ type, name, definition, source, packageId? }`. The types `SecurityCatalogType`, `SecurityCatalogSourceName`, `SecurityCatalogRegistry`, `SecurityCatalogMetadataService`, `SecurityCatalogSources`, `SecurityCatalogEntry` and `SecurityCatalogReader` are exported with it.
- **Where it reads.** ObjectQL's `SchemaRegistry` (`engine.registry`) first, then the kernel `metadata` service for the names the registry does not hold. Neither holds the whole catalog: the engine registry carries the platform's own permission sets and every package manifest's catalog items but no stack-declared position, and the metadata service carries the stack-declared positions but not the platform's permission sets. Both are required; construction refuses a missing one.
- **A name two packages ship** resolves the way the registry's by-name read does today: a stored override first, else the first-registered package's body.
- **What it does not answer.** Whether an item is in effect: the row `active` flag stays the authority, and no definition carries it. The position → permission-set binding. Organization scope: the catalog is environment-level.
- **Failures are loud.** A reader that throws, or a metadata read that lost a loader and found nothing, raises `AuthzStoreUnavailableError` (`SERVICE_UNAVAILABLE`, 503) instead of answering "no such item". A definition owned by a disabled package answers neither member.
- Nothing calls the reader yet; no grant changes.
