---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a successful `revertCommit` refreshes the SchemaRegistry (#6621)

`revertCommit` persisted its change and left the running process serving the
body it had just reverted away. The single-item revert `rollbackMetaItem` has
ended its restore with a registry write-through since #4521 — "a rollback is a
live write like any other: the restored body must be the one the runtime
dispatches on immediately, not after someone lists the type" — and the batch
path over the same repository call had no equivalent on either limb.

Measured before the fix, real `SysMetadataRepository`, an `object` saved twice
(v2 adds a `due_date` field) and then reverted:

```
revertCommit                          ->  { success: true, revertedCount: 1, failed: [] }
stored sys_metadata row fields        ->  ["name","amount"]              # reverted
SchemaRegistry.getObject(...) fields  ->  [...,"name","amount","due_date"]  # NOT reverted
```

So the undo reported success while data CRUD kept dispatching the pre-revert
schema, healing only at the next restart. It is type-agnostic and older than
the `object` support that made it loud: an overlay `view` showed the same split
(stored `Cases`, registry still `Renamed`). `rollbackToPackageCommit` reverts
through the same loop, so a whole-package rollback could report success and
change nothing the running process could see.

Both limbs now refresh the registry, each reusing the seam its single-item
sibling already uses:

- **Restore limb** — writes the restored body through under the row's OWN
  ownership key, read from the row before the restore (#4636; stated as the
  `sys_metadata` sentinel instead, `registerObject` throws `already owned by
  package "app.<slug>"` into a best-effort warning and the stale body survives).
  The row's own organization is passed per item, so an org-scoped row inherits
  ADR-0005's rule that only env-wide rows enter the process-wide registry.
- **Soft-remove limb** — runs the same three-tier heal `deleteMetaItem` runs
  after its own repository delete: an overlay that shadows a packaged artifact
  falls back to the artifact rather than vanishing, and only a name no layer
  serves at all is retired. A flat unregister would have deleted names a code
  package still ships. This heal is gated to env-wide reverts: an org-scoped row
  never entered the shared registry, so healing on its behalf would retire the
  entry every other organization reads.

No contract change — ADR-0067 already defines what a revert leaves behind; this
makes the runtime agree with it without waiting for a restart.
