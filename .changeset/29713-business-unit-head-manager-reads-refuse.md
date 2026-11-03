---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing)!: a failed business-unit head or standalone manager read refuses instead of answering no head or no manager

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata changes: the two lookups read the rows they already read, and refuse a read that already failed. No author has anything to rewrite. -->

**BREAKING** only where the read fails: `BusinessUnitGraphService.headOf` and the standalone `BusinessUnitGraphService.managerOf` used to answer `null` then, and now refuse.

The member, seed and descent reads of `BusinessUnitGraphService` already refuse on a failed read. Two sibling lookups on the same service did not.

- **`headOf(businessUnitId)`.** A failed `sys_business_unit` read now throws. Before, it answered `null` (no head) and kept that answer for the rest of the pass, so the head stayed missing after the read recovered. Nothing is cached after a failed read now: the next call reads again.
- **`managerOf(userId, organizationId)` without a `TeamGraphService`.** A failed `sys_user` read now throws. Before, it answered `null` (no manager). This fallback caches nothing, before or after. The organization screen keeps its fail-open posture, and a service built with a `teamGraph` still answers exactly what `TeamGraphService.managerOf` answers.
- **A missing object is still nobody.** A stack that never registers, or never creates, `sys_business_unit` or `sys_user` keeps answering `null`. That is judged by `isObjectAbsentError`; any other error stays loud.
- **No caller on this release changes behaviour.** No sharing rule, approval or ownership queue on this release calls either lookup. A caller of the exported class sees the refusal instead of `null`.

**The remedy.** None is needed. A refusal means the business-unit or user table could not be read: fix that read, and the next lookup succeeds.
