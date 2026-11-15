---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): two namespaces' stored permission sets of one name are each kept and served at their own package

Clause-②: yes (widening)
Metadata-protocol: none

A permission set is `(package, name)` (ADR-0150 D2). The host kernel now keeps a stored permission set bound to a package in that package's own registry slot, at the save's write-through and at the boot hydration alike. It used to put every stored set of a name into the name's one bare registry entry, so a second package's set of the name took the first one's place. The save door therefore refused it, even when the two packages had two namespaces.

What moves, for packages `crm` and `hr` of two namespaces:

- FROM `422 NAMESPACE_CONFLICT` naming `crm` TO saved, for `hr`'s save, publish or restore of a set whose name `crm` stores. `crm`'s own save of a set of the name beside the one `hr` stores, and a third namespace's, are admitted too. A grant bound to each package confers that package's set, in every order the boot reads the stored rows. A grant naming no package of a name two packages hold confers nothing, as for two shipped sets (ADR-0150 D3).
- FROM the shipper's set replaced TO each set served at its own package, for a set `hr` stores beside a set `crm` ships. The stored set used to take the shipper's envelope, so `crm`'s grants conferred `hr`'s stored body and `hr`'s grants conferred nothing. Each package's stored set is now tenant-authored and bound to its own package. The packaged-permission-set lock reads only the shipped set as packaged.
- A delete of one package's stored set retires that package's slot alone, and the other package's set stays served, before and after a restart.
- The refusal that stays (two packages of one namespace, a platform namespace, a package with no namespace, the environment, a name the platform requests by spelling) now names steps the writer can take: rename its own set, or delete a set the environment or another package stores. It no longer tells the writer to rename the set inside another package. Envelope unchanged: `422 NAMESPACE_CONFLICT`.

Nothing to migrate. A package-less stored permission row keeps the name's bare registry entry, as before.
