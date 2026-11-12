---
'@objectstack/core': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/metadata': minor
'@objectstack/plugin-security': minor
---

feat(core, objectql, metadata-protocol): a permission-set name is held once per namespace, judged by one predicate at the install gate and the save door (ADR-0150 child B, #31698)

Clause-②: yes (widening) — two packages of two namespaces may each hold a permission set of one name, each granted, cloned, activated and read by its own `(package, name)`, where the first holder ships its set (the save door keeps a name another package stores at one holder); co-owners of one namespace, a package with no namespace, a holder in a shareable platform namespace (`base`, `system`, `sys`), the platform-requested `guest_portal`, the environment's own set and a built-in name keep one holder, refused with today's envelope; the save door's 422 sentence now states the namespace rule (row below). Measured first-party: 0 co-owner pairs and 0 cross-namespace pairs (showcase, crm, todo, multi-package).
Metadata-protocol: added

The one-holder rule for `permission` narrows from one package per environment to one per namespace (ADR-0150 D2, D9). `permissionSetHoldersMeet` (`@objectstack/core`) is the one predicate the registry's package door, its item seam and the metadata save door ask (the save door beside a shipped set; a set another package stores keeps its name); the registry remembers every claimant of a name.

| What | FROM | TO |
| --- | --- | --- |
| Install of a package of another namespace declaring a permission-set name a package holds | refused, `SecurityCatalogNameConflictError` naming the holder | installed; both claims kept, each released by its own uninstall |
| A package of another namespace registering a set of that name at the item seam | refused | registered |
| Save, publish or restore of a set of that name into a package of another namespace, the name's holder shipping its set | `422 NAMESPACE_CONFLICT` | saved |
| The same, where another package stores a set of the name | `422 NAMESPACE_CONFLICT` | `422 NAMESPACE_CONFLICT`, unchanged (the registry keeps one entry per stored set of a name; a package duplicate lists that set in `failed[]`, as before) |
| A co-owner of one namespace, a package with no namespace, a holder in `base` / `system` / `sys` (either side), `guest_portal`, the environment's own set, a built-in name | refused | refused, same envelope (stricter than the sibling `namespacedHoldersMeet`, which admits `sys` / `base` beside another namespace and `guest_portal` across two) |
| The save door's refusal sentence (`422 NAMESPACE_CONFLICT`, envelope unchanged), after naming the holders and the remedy | "Positions, permission sets and capabilities each hold one name per deployment: … See ADR-0048." | "A permission set holds one name per namespace: two packages of one namespace, a platform package (`base`, `system`, `sys`), a package with no namespace, the environment, or a name the platform requests by spelling share one set of it, and a set another package stores holds its name. See ADR-0150 D2." |
| A bare read, grant, clone or activation of a name two packages hold, naming no package | (unreachable) | `409 RESOURCE_CONFLICT` naming both, as declared by #32162 and #32164; a grant with no `permission_set_package` confers nothing |

Before two holders of one name could exist, these readers and writers were made to keep them apart:

- The security catalog reads a set two packages' metadata-service slots hold as a refusal naming both, and a stored column reads its own package's slot.
- The packaged-set lock names every package that declares the name, and its registry-less read goes to each holder.
- The security-catalog echo is kept per package: a permission projector event names the package its row landed in, every other echo slot is judged by its own row, and a gone slot is removed from memory only, never from storage. A binding read that fails keeps the package the existing slot names.
- `MetadataManager.unregisterInMemory` drops one registry slot and deletes from no loader; a cluster peer that hears a removal naming a package drops that package's slot only.
- A grant whose package no longer serves its set confers nothing where another grant of the same user, set and organization is bound to the holder it reads; the bound grant, with its validity window, grants that set. The authorization resolver says so once per process, and the catalog reference boot report lists each such grant.
- A stored reference whose package column names a package that no longer serves the set is read by the resolution rule inside that package's namespace only. A holder outside it (another namespace's package, a package with no namespace, the environment's own set) is refused, naming that holder, and confers nothing. A column of a package with no namespace the registry knows (not installed, authored at runtime, or declaring none) has none to bound the reading, and reads as before (D8 R1): one holder grants, two are refused naming both. The catalog reference boot report lists each such grant with the holder; its fix is to grant the holder's set again, naming its package, where that set is the one meant, and to remove the grant.
