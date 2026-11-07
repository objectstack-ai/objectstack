---
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
---

fix(metadata): a `sys_metadata_history` snapshot no longer stores what a connector save drains from the live row

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no authoring door accepts or refuses anything it did not before. Only the body a history row stores for a new write changes; existing history rows are left as they are, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a reader of raw `sys_metadata_history` rows that expected a connector snapshot to hold an undeclared `auth` key. No door serves one: the history read exit already withheld it.

A connector row stored before the instance-auth shapes went strict can hold a value under an `auth` key its kind does not declare. A save of the served form drains that key from the live row, but a history snapshot is a second copy of the body at rest, and nothing stopped a new snapshot from keeping it: a revert to an older version wrote it into a fresh `revert` snapshot, and a write that no door re-judged did too. Now:

- **Both history writers store the snapshot through one helper**, `historySnapshotBody`, published as `@objectstack/metadata/history-snapshot`: `SysMetadataRepository.put` in `@objectstack/metadata-protocol` (behind the `/meta` save door, publish and revert) and `DatabaseLoader` in `@objectstack/metadata`.
- **What it leaves out is the type's redactor's own answer**: every position named in `notCarriedForwardKeys`, the same answer the save's carry-forward drains by. For a connector those are its undeclared `auth` keys and the undeclared keys inside an object `retryConfig`. Nothing in the helper names a key or a type.
- **Every other body is stored as written, byte for byte.** That covers every type whose redactor marks no such position, and every type with no redactor. The history row's `checksum` keeps naming the live row's stamp, and the history read exit (`redactStoredMetadataRow(s)`) is unchanged.

History rows written before this change are not rewritten here. A one-time scrub follows separately, after a read-only count.
