---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol): two namespaces' stored permission sets of one name are each kept and served at their own package

Clause-②: yes (widening) — widened: a save, publish or restore of a permission set whose name a package of another namespace stores moves from `422 NAMESPACE_CONFLICT` to saved; and a restart over a stored set of one package beside a set of the name another namespace's package ships or declares moves from a boot refused with `422 NAMESPACE_CONFLICT` to a boot that serves each package's set at its package.
Metadata-protocol: none

A permission set is `(package, name)` (ADR-0150 D2). The host kernel now keeps a stored permission set bound to a package in that package's own registry slot, at the save's write-through and at the boot hydration alike. It used to put every stored set of a name into the name's one bare registry entry, so a second package's set of the name took the first one's place. The save door therefore refused it, even when the two packages had two namespaces, and a restart over a stored set beside another namespace's shipped or declared set of the name was refused.

What moves, for packages `crm` and `hr` of two namespaces:

- FROM `422 NAMESPACE_CONFLICT` naming `crm` TO saved, for `hr`'s save, publish or restore of a set whose name `crm` stores. `crm`'s own save of a set of the name beside the one `hr` stores, and a third namespace's, are admitted too. A grant bound to each package confers that package's set, in every order the boot reads the stored rows.
- FROM a boot refused with `422 NAMESPACE_CONFLICT` TO a boot that serves each set at its package, for a restart over a set `hr` stores beside a set of the name `crm` ships or declares. `crm` keeps serving the set it ships, `hr` serves the set it stores, and the stored set is tenant-authored and bound to `hr`. The packaged-permission-set lock reads only the shipped set as packaged.
- A delete of one package's stored set retires that package's slot alone, and the other package's set stays served, before and after a restart.
- The refusal that stays (two packages of one namespace, a platform namespace, a package with no namespace, the environment, a name the platform requests by spelling) now names steps the writer can take: rename its own set, or delete a set the environment or another package stores. It no longer tells the writer to rename the set inside another package. Envelope unchanged: `422 NAMESPACE_CONFLICT`.

Unchanged: a package's stored set counts as its holding of the name at every name check. A package of the same namespace declaring or registering the name beside it is refused with `422 NAMESPACE_CONFLICT`, and so is a cold boot where it is held against a package that declares or ships the name (ADR-0048 N.3), including a stored set bound to the declaring package itself. A grant naming no package of a name two packages hold confers nothing (ADR-0150 D3). A package-less stored permission row keeps the name's bare registry entry, as before.
