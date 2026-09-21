---
"@objectstack/lint": patch
"@objectstack/plugin-security": patch
---

`PermissionEvaluator.checkObjectPermission` and `buildAccessMatrix` now ASK `@objectstack/spec`'s `objectPermissionGrants` instead of restating the super-user fold — one rule, one definition (#18785).

"Does this effective object permission grant this verb?" had three independent implementations: the spec helper published in 17.4, the enforcement door in `@objectstack/plugin-security`, and the access-matrix snapshot in `@objectstack/lint`. A differential over the full input space — every declared object-permission bit (`allowCreate` / `allowRead` / `allowEdit` / `allowDelete` / `allowTransfer` / `allowExport` / `viewAllRecords` / `modifyAllRecords`) in all three authorable states, 6561 entries by 6 verbs — found **zero** disagreements, so this is a structural convergence and **no behaviour changes**.

- **No API change, no bit changes meaning.** The read bypass is still `viewAllRecords || modifyAllRecords`, the write bypass is still `modifyAllRecords` alone, `allowCreate` still has no super-user bypass, and `export` is still `grant ∧ read`.
- **The export door keeps its cross-set shape.** `checkObjectPermission('export', …)` still asks `(∃ set granting export) ∧ (∃ set granting read)` across the resolved set list — the same answer the `/me/permissions` most-permissive merge hands the client. Folding it per set would have narrowed the door.
- **Both consumers are pinned to the fold independently of the helper**, so a change to one cell of `objectPermissionGrants` reddens them rather than propagating silently.
