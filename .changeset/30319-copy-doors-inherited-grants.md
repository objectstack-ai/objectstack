---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): duplicating a package copies a permission set that grants on an optional plugin's object not installed here, as the permission-set clone door does

Clause-②: no
Metadata-protocol: none

- **Now.** `duplicatePackage` saves a copied permission set with the grant keys of its SOURCE row as stored passed as `inheritedGrantObjects`, so the save door's unknown-object refusal does not judge them (#30255's rule for the clone door). A platform set granting on `sys_comment` / `sys_activity` on a deployment without `@objectstack/plugin-audit` is copied; before, it was left in `failed[]` with the 422 finding and the duplicate answered `success: false`.
- **Still refused.** A grant the copy's rewrite renames onto the copy's own object (`<source ns>_x` → `<target ns>_x`) is not the source's key and is judged as before: when that object did not copy, the set lands in `failed[]` naming that grant alone. The keys come from the stored row, never from the request.
- **Unchanged, by ruling.** `importUnmanagedPackage` still refuses such a set `422 INVALID_METADATA` and rolls the import back: the package is the request's body, not a stored row, so its permission sets are new writes and every grant is judged.
