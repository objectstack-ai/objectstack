---
'@objectstack/core': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/metadata': patch
'@objectstack/plugin-security': patch
---

feat(core, objectql, metadata-protocol): a permission-set name is held once per namespace, judged by one predicate at the install gate and the save door (ADR-0150 child B, #31698)

Clause-②: yes (widening) — two packages of two namespaces may each hold a permission set of one name, each granted, cloned, activated and read by its own `(package, name)`; co-owners of one namespace, a package with no namespace, a holder in a shareable platform namespace (`base`, `system`, `sys`), the platform-requested `guest_portal`, the environment's own set and a built-in name keep one holder, refused with today's envelope and sentence. Measured first-party: 0 co-owner pairs and 0 cross-namespace pairs (showcase, crm, todo, multi-package).
Metadata-protocol: added

The one-holder rule for `permission` narrows from one package per environment to one per namespace (ADR-0150 D2, D9). `permissionSetHoldersMeet` (`@objectstack/core`) is the one predicate the registry's package door, its item seam and the metadata save door ask; the registry remembers every claimant of a name.

| What | FROM | TO |
| --- | --- | --- |
| Install of a package of another namespace declaring a permission-set name a package holds | refused, `SecurityCatalogNameConflictError` naming the holder | installed; both claims kept, each released by its own uninstall |
| A package of another namespace registering a set of that name at the item seam | refused | registered |
| Save, publish or restore of a set of that name into a package of another namespace | `422 NAMESPACE_CONFLICT` | saved |
| A co-owner of one namespace, a package with no namespace, a holder in `base` / `system` / `sys` (either side), `guest_portal`, the environment's own set, a built-in name | refused | refused, unchanged (stricter than the sibling `namespacedHoldersMeet`, which admits `sys` / `base` beside another namespace and `guest_portal` across two) |
| A bare read, grant, clone or activation of a name two packages hold, naming no package | (unreachable) | `409 RESOURCE_CONFLICT` naming both, as declared by #32162 and #32164; a grant with no `permission_set_package` confers nothing |

Before two holders of one name could exist, these readers and writers were made to keep them apart:

- The security catalog reads a set two packages' metadata-service slots hold as a refusal naming both, and a stored column reads its own package's slot.
- The packaged-set lock names every package that declares the name, and its registry-less read goes to each holder.
- The security-catalog echo is kept per package: a permission projector event names the package its row landed in, every other echo slot is judged by its own row, and a gone slot is removed from memory only, never from storage. A binding read that fails keeps the package the existing slot names.
- `MetadataManager.unregisterInMemory` drops one registry slot and deletes from no loader; a cluster peer that hears a removal naming a package drops that package's slot only.
- A grant whose package no longer serves its set confers nothing where another grant of the same user, set and organization is bound to the holder it reads; the bound grant, with its validity window, grants that set. The authorization resolver says so once per process, and the catalog reference boot report lists each such grant.
