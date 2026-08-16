---
'@objectstack/metadata-protocol': patch
---

Fold the metadata lock gate's type key at its producer, so an ADR-0010 `_lock` can no longer be addressed around by spelling.

`getEffectiveLock` handed `type` to its two limbs verbatim, and the limbs did not read it the same way: the artifact limb folded (`lookupArtifactItem` resolves the singular and retries the raw spelling), while the overlay limb queried `sys_metadata` with the raw `type`. Since `SysMetadataRepository` stores rows under the canonical spelling with no at-rest fallback, a non-canonical `type` missed the stored active row and the gate fell through to `lock: 'none'` — not a neutral value but the verdict "the author declared no protection", which `evaluateLockForWrite` / `evaluateLockForDelete` turn into "allow".

`getEffectiveLock` now folds once with `canonicalMetaType` and uses that one key for both limbs. Nothing changes for any caller reachable today — `saveMetaItem`, `deleteMetaItem`, `rollbackMetaItem`, `publishMetaItem` and `publishPackageDrafts` all fold their own request first, which was measured rather than assumed. What changes is the failure mode of a future caller that does *not* fold: the lock is now found, and the write is refused instead of silently admitted.

The fold uses the URL map rather than the manifest-collection map on purpose — the latter omits `field`, `seed`, `external_catalog` and `translation`, i.e. it would canonicalize the types that never needed it and leave the four that do.
