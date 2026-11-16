---
'@objectstack/skills': patch
---

docs(skills): `objectstack-data` states what `writeRequiresMasterRead` asks when a master is set or emptied, and whose ownership floor binds an on-behalf-of write

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/relationships.md` is more exact about a `controlled_by_parent` detail's two write opt-ins. Under `sharing.controlledByParent.writeRequiresMasterRead`, setting a master on a row and emptying one both ask read (the sentence read as if only emptying did), and both still ask edit under `ownerMayEdit`. On an on-behalf-of update or delete the ownership floor binds for both users, not one. The `ownerMayEdit` bullet now says "every other write, on-behalf-of included, still needs master edit" where it listed the writes, which pays for the added words: the file is the same size. The eval case for the key also fails an answer that writes `ownerMayEdit: true` beside it, in either order, or puts the key on the `master_detail` field.
