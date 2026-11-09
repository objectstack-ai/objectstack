---
'@objectstack/service-package': patch
'@objectstack/metadata-protocol': patch
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an unmanaged copy is recorded from the row the import wrote, not from a store re-read at install

Clause-②: no
Metadata-protocol: none

Before this, the install-local door tied an unmanaged copy's record to the environment base's `sys_packages` row by reading the package store right after the import. That read swallows an ordinary fault and answers null, so a passing store fault at that moment left the copy with no record, and the purge, reseed and count doors answered 404 for a copy that was installed.

- **`publish` states the stamp it writes.** The package service now makes one UTC stamp per write, in the shape the column already stores (`YYYY-MM-DD HH:MM:SS`, what `CURRENT_TIMESTAMP` and `UTC_TIMESTAMP()` produced), and binds it as the row's `created_at` and `updated_at` in both dialects' upserts. `publish` answers `{ success: true, version, createdAt }`, where `createdAt` is the value the row holds after the write. On a re-publish of an existing (id, version) row the stored `created_at` stays the earlier one, as before (the update arm sets only `updated_at`), so `publish` reads that row's `created_at` before its upsert and answers it. When that read faults, the answer names no `createdAt`. The table DDL and the latest index are unchanged.
- **The import carries the base row, door-only.** The in-process `importUnmanagedPackage` answer gains `baseInstance: { version, createdAt }` when the package store stated them. It is outside the published `ImportUnmanagedPackageResponse`: the schema's parse strips it, and no REST answer carries it.
- **install-local ties the record from that answer.** The install no longer reads the package store. A package store that states no stamp fails closed as before: `copyRecord.written: false`, and the copy doors answer 404. The purge-time re-read and its comparison are unchanged.
