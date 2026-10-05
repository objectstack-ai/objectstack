---
'@objectstack/metadata': patch
---

`DatabaseLoader` now persists a `register` whose only change is the order of an object's `fields` (#21828). Before, the loader's checksum sorted every map, so a field reorder hashed equal to the stored row and was never written. The running process still saw the new order, but the persisted `sys_metadata` row kept the old one.

Clause-②: no

- **One hash vocabulary in `sys_metadata.checksum`.** The loader now stamps the hash `SysMetadataRepository` stamps on the same column: `hashSpec(body, type)` from `@objectstack/metadata-core`, written as `sha256:` + 64 hex. It is hashed as the item's metadata type, so a reorder of an object's `fields` is a change and every other map is still key-order independent. Its history rows carry the same value as the row they record. Before, the loader wrote bare hex from `calculateChecksum`. That function is unchanged and still exported, but nothing writes the column with it.
- **Rows stamped before this release.** Whether a `register` is a no-op is now decided by re-hashing the stored body, not by comparing the stored checksum. A row with an unchanged body is not rewritten: no version bump, no history row, and it keeps its old checksum until its content next changes. The first real change rewrites it with the new stamp. A reorder into sorted key order is written too, even against a stored checksum that sorted every map.
- **ETags.** `load()` and `stat()` report the row's checksum as `etag`, so a row the loader writes from this release on reports a `sha256:` value.
