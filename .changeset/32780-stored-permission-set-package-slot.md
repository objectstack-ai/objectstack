---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol)!: two namespaces' stored permission sets of one name are each kept and served at their own package

Clause-②: yes (narrowing) — widened: a save, publish or restore of a permission set whose name a package of another namespace stores moves from `422 NAMESPACE_CONFLICT` to saved, and each package serves its own stored set; narrowed: after a restart, a grant naming no package of a name two packages hold (one ships it, one of another namespace stores it) moves from conferring a set to conferring nothing, as the running kernel already answered before the restart (ADR-0150 D3).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is where a stored permission set bound to a package is served, which save the door admits, and what a grant naming no package confers when two packages hold the name, so there is nothing for a migration to rewrite and no tombstone -->

**BREAKING** for a grant that names no package while two packages hold the set's name: a grant naming no package confers nothing when two packages hold the name, after a restart as before it. Name the package on the grant (`permission_set_package`) to confer that package's set. A name one package holds confers as before.

A permission set is `(package, name)` (ADR-0150 D2). The host kernel now keeps a stored permission set bound to a package in that package's own registry slot, at the save's write-through and at the boot hydration alike. It used to put every stored set of a name into the name's one bare registry entry, so a second package's set of the name took the first one's place. The save door therefore refused it, even when the two packages had two namespaces.

What moves, for packages `crm` and `hr` of two namespaces:

- FROM `422 NAMESPACE_CONFLICT` naming `crm` TO saved, for `hr`'s save, publish or restore of a set whose name `crm` stores. `crm`'s own save of a set of the name beside the one `hr` stores, and a third namespace's, are admitted too. A grant bound to each package confers that package's set, in every order the boot reads the stored rows.
- FROM a set TO nothing, for a grant naming no package of a name `crm` ships and `hr` stores, after a restart (ADR-0150 D3), as for two shipped sets.
- A set `hr` stores beside a set `crm` ships is `hr`'s own set: it is served at `hr`, `crm` keeps serving the set it ships, and the stored set is tenant-authored and bound to `hr`. The packaged-permission-set lock reads only the shipped set as packaged.
- A delete of one package's stored set retires that package's slot alone, and the other package's set stays served, before and after a restart.
- The refusal that stays (two packages of one namespace, a platform namespace, a package with no namespace, the environment, a name the platform requests by spelling) now names steps the writer can take: rename its own set, or delete a set the environment or another package stores. It no longer tells the writer to rename the set inside another package. Envelope unchanged: `422 NAMESPACE_CONFLICT`.

Unchanged (ADR-0048 N.3): a stored set bound to the package that declares the name is the environment's at the cold boot, so the boot still refuses with `422 NAMESPACE_CONFLICT` naming that package. A package-less stored permission row keeps the name's bare registry entry, as before.
