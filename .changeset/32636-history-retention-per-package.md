---
'@objectstack/metadata': patch
---

fix(metadata): history retention keeps the latest N versions per package for a type stored per `(package, name)`, so one package's saves no longer evict another package's rollback targets

Clause-②: no
Metadata-protocol: none

`HistoryCleanupManager`'s `maxVersions` retention counted a name's history versions per `(type, name)`. For a type stored per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`), two packages and the environment each keep their own row of one name, and their snapshots share one version sequence, so a package saved often pushed every other holder's versions past the limit and `runCleanup()` deleted them: the other package had nothing left to roll back to. Retention for those types now keeps the latest `maxVersions` per `(type, name, package_id)`: each package's versions, the environment's versions (the `sys_metadata` marker) and versions recorded under no package (rows written before the `package_id` column existed) are each counted on their own. `getCleanupStats()` counts the same way. Every other type, a name only one package holds, the age-based retention and the `executionPinned` exemption (`flow`, `agent`) are unchanged. A row is only ever deleted now if the old rule would also have deleted it.
