---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): rolling back a package-bound overlay row no longer 409s (#6215)

Every rollback of a metadata item authored inside a Studio package workspace
failed — and failed by blaming a concurrent edit that never happened:

```
[metadata_conflict] object/myapp_invoice advanced during rollback.
Expected parent sha256:00ca6e72c... but current is null.
```

Both user-facing paths were affected, because both are one call:
`rollbackMetaItem` (the per-item version-history revert) and `revertCommit`
(the package-commit revert) go through `SysMetadataRepository.restoreVersion`.
Only rows with **no** package binding — the legacy shape — rolled back at all,
while ADR-0070 pushes authoring toward always resolving a writable base
package, so the failing share was growing.

**Cause.** `restoreVersion` read the current active row package-agnostically
and then re-put the historical body without saying which row it meant. `put`
scopes its optimistic-lock lookup by package, and an unstated `packageId`
resolves to the *unbound* row (`package_id IS NULL`) rather than "any package"
— so for a row bound to `app.<slug>` the lock looked up a row that does not
exist, read its parent hash as `null`, compared that against the real hash the
first read had just returned, and threw `ConflictError`. The mismatch was
between two reads of the *same* restore, not between two writers.

**Fix.** `restoreVersion` now reads the raw active row once and takes BOTH
facts from it — the parent hash and the ADR-0048 `package_id` — then states
that binding on the write, the same way `promoteDraft` already did. The row the
lock is taken on is therefore, by construction, the row that gets written.

This also closes the defect's second face: had the parent check ever passed,
`put` would have found no row in its `IS NULL` scope and **inserted a duplicate
unbound row** beside the bound one instead of updating it. `sys_metadata`'s
partial unique index keys on `COALESCE(package_id,'')`, so a real database
would have accepted that duplicate.

Unchanged: package-less rows still roll back exactly as before, and a row that
*genuinely* advanced between the rollback's read and its write is still refused
with `METADATA_CONFLICT` / 409. The refusal is narrowed to the case it always
claimed to report, not retired.
