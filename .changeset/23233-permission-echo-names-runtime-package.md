---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a permission set published into a runtime package names that package to the security catalog, so its `isDefault: true` records an `everyone` suggestion

Clause-②: no

- **What was wrong.** A writable runtime package's permission set marked `isDefault: true`, published through the package door with no `packageId` in its body, recorded no audience-binding suggestion on an environment kernel, so ADR-0090 D5's "packages suggest, admins confirm" never happened for it. On that kernel the protocol hydrates no stored row into the engine registry, so the security catalog finds the set in the metadata service. The only body there is the permission-set projection's in-memory copy, and that copy carried no `_packageId`. The catalog served the set as unowned while `GET /api/v1/meta/permission/NAME` named the package, and the suggestion collector skipped it.
- **What changed.** The projection's copy of a tenant-authored set now names the package its stored row is bound to. It reads that binding from the protocol's by-name read (the `_packageId` that read serves) and derives none of its own. The catalog, the by-name read and the layered read (`?layers=true`, whose `packageId` comes from the same copy) now name the same owner. `GET /api/v1/security/suggested-bindings` lists one pending suggestion under that package. A `manage_metadata` holder still has to accept it: the publish grants nothing.
- **When the body's `packageId` disagrees.** A set whose body declares a `packageId` other than the package it is published into is now owned, for the catalog and the suggestions, by the package it is published into, which is what the by-name read already served. On an environment kernel, a suggestion recorded under the body's package is pruned at the next sync while pending, and withheld from `everyone` with its reason logged if it was accepted. A pending suggestion under the publishing package replaces it.
- **Unchanged.** The `sys_permission_set` row (still `managed_by: 'admin'`, with no `package_id`), the packaged-permission-set lock and every edit door. A code package's set, whose owner the catalog reads from its artifact. A set saved into no package, which stays unowned and records no suggestion. A copy of a code-shipped set's legacy overlay, which carries no owner, as before.
- **If the binding cannot be read**, the copy is registered without an owner, as before, and one warning says so. It still enforces the new body, and the next save, publish or boot reads the binding again.
