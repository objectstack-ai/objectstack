---
'@objectstack/skills': patch
---

docs(skills): the `controlled_by_parent` authoring guidance teaches `sharing.controlledByParent.writeRequiresMasterRead`

Clause-②: no
Metadata-protocol: none

The data skill's relationship rules said every write of a `controlled_by_parent` detail needs edit on its master, with `ownerMayEdit` as the only opt-in. They now teach the second opt-in as well: with `writeRequiresMasterRead: true` on the detail, whoever can read the master inserts, updates and deletes detail rows under the detail's own object permissions, row-level security and field-level security, on re-points and on each opted-in chain hop too; an on-behalf-of write needs both users to read the master, and the platform ownership floor still binds predicate and on-behalf-of updates and deletes. The rules name its parse refusals (beside `ownerMayEdit: true`, off a `controlled_by_parent` object, one level up) and that `security-controlled-by-parent-owner-policy-without-opt-in` stays silent on such a detail. Without the key every write still needs edit on the master. The optional-master paragraph says setting or emptying a master asks read under the opt-in. One eval prompt covers the opt-in. The lookup and junction examples drop their boilerplate parent objects to pay for the new text inside the file's token ceiling.
