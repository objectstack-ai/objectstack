---
"@objectstack/platform-objects": minor
"@objectstack/service-storage": patch
"@objectstack/cli": patch
---

feat(platform-objects,service-storage,cli): `sys_migration` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the storage service (#4243)

The deployment-level data-migration flag ledger (`sys_migration`, #3617) was
registered by `@objectstack/service-storage` as its first consumer. That was
deliberate while the file migration was the only consumer, but the ledger now
gates storage-independent behaviour too — `os migrate value-shapes` (#4235)
and the fresh-datastore attestation (#4215) — and a non-file migration had to
boot the whole storage plugin just so the kernel carried the table. Any kernel
assembled without storage silently had no ledger at all, which read exactly
like "migration not run" (both answer false) while actually meaning "ledger
not installed".

The registration now lives in `PlatformObjectsPlugin`
(`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
auto-injects into every served kernel — so the ledger exists with the
platform, independent of which optional services are composed. The
fresh-datastore attestation (#3438, ADR-0104) moves with it: it is ledger
bookkeeping, and its old home justified itself as "the service that registers
`sys_migration`". Definition ownership is unchanged (`sys_migration` stays in
`@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`); the
flag helpers and readers are untouched.

Consequences:

- `@objectstack/service-storage` no longer contributes `sys_migration` to the
  manifest and no longer performs the fresh-datastore attestation. An embedder
  composing `StorageServicePlugin` on a hand-built kernel that relied on it
  for the ledger must compose `PlatformObjectsPlugin` (the plugin every
  supported assembly path already includes).
- The CLI's `buildDataMigrationPlugins()` no longer boots storage for every
  gated migration — it registers `PlatformObjectsPlugin` always, and settings
  + storage only for `os migrate files-to-references` (`{ storage: true }`),
  the one migration that actually reconciles against the storage adapter.
