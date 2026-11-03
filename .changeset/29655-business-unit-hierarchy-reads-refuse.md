---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-approvals': patch
---

fix(plugins)!: a failed `sys_business_unit` read refuses instead of answering nobody, and a business unit with more than 1,000 child units keeps every child

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata changes: the business-unit expansions read the unit rows they already read, to completion, and refuse a read that already failed. No author has anything to rewrite. -->

**BREAKING** only where a `sys_business_unit` read fails: the business-unit expansions used to answer nobody (an empty list) then, and now refuse.

The member reads of a business unit (`sys_business_unit_member`) read to completion and refuse on failure. The reads of the unit table they are keyed by did not: the check that the unit exists and is active, and the read of each unit's child units, still turned any read error into nobody, and the child-unit read stopped at 1,000 rows.

- **A failed unit read refuses.** In plugin-sharing, `BusinessUnitGraphService.descendants`, `expandUnitMembers` (every `business_unit` sharing recipient) and `expandUsers` (every `unit_and_subordinates` recipient) now throw when the unit's own row or a child-unit read fails. In plugin-approvals, the `department` / `business_unit` / `bu` approver and an `expression` approver with `resolveAs: 'department'` do the same.
  - Sharing: the expansion rejects, so that rule's reconcile or revoke pass fails, its callers log their existing per-rule warning, and the grants it already holds stay. Before, a failed unit read answered `[]` and that answer was kept for the rest of the pass, so the recompute a business-unit graph write triggers revoked every grant the rule gave.
  - Approvals: the approver slot falls back to its literal (`department:ID`) and logs `could not be expanded — a directory or read-filter lookup failed` with its `error`. Before, a failed seed read logged "expanded to nobody", and a failed child-unit read routed to the units that did read, with no signal.
  - Ownership queues: a `business_unit` or `unit_and_subordinates` queue specification whose unit read fails contributes nobody, the posture the queue declares for a failed expansion, and logs it once.
- **Nothing is cached after a failed read.** The next expansion on the same pass reads again.
- **Every child unit.** The child units of each unit are read in pages of 1,000 ordered by id until they are exhausted. A unit with more than 1,000 active child units used to lose the children past the 1,000th row, with all their members and descendants. A unit with fewer issues one read, as before.
- **A missing object is still nobody.** A stack that never registers, or never creates, `sys_business_unit` keeps answering no members. That is judged by `isObjectAbsentError(error, 'sys_business_unit')`; any other error stays loud.

**The remedy.** None is needed. A refusal means the business-unit table could not be read: fix that read, and the next expansion succeeds.
