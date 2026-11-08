---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a revert or a publish writes a connector's live row without the keys a save drains

Clause-②: no
Metadata-protocol: none

A revert to a history version (`rollbackMetaItem`, commit revert) and the publish of a stored draft (`publishMetaItem`) now write the live `sys_metadata` row without the positions a save of the served form drains: a connector's undeclared `auth` keys and the undeclared keys of an object `retryConfig`.

- `SysMetadataRepository.restoreVersion` and `promoteDraft` remove those positions from the stored body with the same helper history snapshots use (`historySnapshotBody`), before `deriveRestoredBody` / `deriveActiveBody` see it, so the body a caller judges is the body written.
- Every other type, and a connector with nothing undeclared, is restored and published exactly as before.
