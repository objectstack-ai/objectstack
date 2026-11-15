---
'@objectstack/driver-sql': patch
'@objectstack/cloud-connection': patch
'@objectstack/driver-turso': patch
---

fix: a package upgrade that makes a field `storage: { notNull: false }` relaxes the NOT NULL column the earlier version built

Clause-②: no
Metadata-protocol: none

A package field that was `storage: { notNull: true }` and is now `storage: { notNull: false }` kept its NOT NULL column on every database an earlier version built, so every write that left the field empty was refused by the database. The install's schema sync is additive, the boot never relaxes a column, and the publish that applies the relax for an environment-authored object is refused for a sealed package object (`NOT_OVERRIDABLE`), so only `os migrate apply` on the environment's own database could fix it.

- The install door (`POST /api/v1/marketplace/install-local`, `os package install`) now relaxes, after a managed install or upgrade's schema sync, each NOT NULL column whose field the installing package's own body declares `storage: { notNull: false }`: its objects, and the fields its `objectExtensions` contribute. A column another package or a customization declares is never that install's to relax, an undeclared NOT NULL stays as it is, and no other drift kind is applied. A boot or rehydrate still applies nothing.
- `SqlDriver.relaxDeclaredNotNull(obj, columns, opts?)` is the new driver door it asks, and `relaxInstallDeclaredNotNull` / `declaredNullableColumns` are exported from `@objectstack/cloud-connection` so a host's own install door can call the same step after its schema sync.
- The `[schema-drift]` warning and `os migrate plan` now name the remedy per object kind: publishing applies it for an object authored in the environment, a managed install or upgrade of its package applies it for a package object, and `os migrate apply` relaxes it deliberately for either.
- On the Turso REMOTE face the new driver door is inherited: a relax needs the SQLite table rebuild that transport does not run, so it comes back skipped with the face's reason, which the install logs.
