---
'@objectstack/skills': patch
---

docs(skills): the data skill teaches `controlled_by_parent` with an optional master

Clause-②: no
Metadata-protocol: none

`objectstack-data` now teaches "a rep sees the contacts of the accounts they own; a contact need not have an account" as a `controlled_by_parent` detail whose only `master_detail` is declared `required: false` (an optional master), not as an owner field copied by hooks. A row with no master is its owner's: the owner or View All on the detail reads it, the owner or Modify All writes it, an insert naming no master is admitted, setting a master asks edit on it, emptying one asks edit on the stored master (`ownerMayEdit` does not cover that), and a chain hop with no master ends there under the same rule. The `relationship/master-detail-required` lint row names the optional master. The platform behaviour shipped earlier in `@objectstack/spec`, `@objectstack/lint` and `@objectstack/plugin-security`; this release only teaches it.
