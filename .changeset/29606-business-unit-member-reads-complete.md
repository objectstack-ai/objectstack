---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-approvals': patch
---

fix(plugins)!: business-unit recipients and approvers reach every member past 10,000 rows, a failed business-unit member read is refused loudly instead of answered with nobody, and a failed `resolveAs` expansion says so

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata changes: the business-unit expansions and the primary-business-unit backfill read lists they already read, to completion, and refuse a read that already failed. No author has anything to rewrite. -->

**BREAKING** only where a `sys_business_unit_member` read fails: the business-unit expansions used to answer nobody (an empty list) then, and now refuse.

This extends the family the team, position and role fixes closed to the last membership object, `sys_business_unit_member`. Its reads still read once with a 10,000-row bound and turned any read error into nobody.

- **Every member, nobody else.** In plugin-sharing, `BusinessUnitGraphService.expandUnitMembers` (every `business_unit` sharing recipient) and `BusinessUnitGraphService.expandUsers` (every `unit_and_subordinates` recipient) now read in pages of 10,000 ordered by id until the members are exhausted. In plugin-approvals, the `department` / `business_unit` / `bu` approver and an `expression` approver with `resolveAs: 'department'` do the same. Past 10,000 members, the members past the 10,000th row used to get no grant and no approval slot. They now do.
- **The primary-business-unit backfill projects every primary membership.** The boot backfill of `sys_user.primary_business_unit_id` used to scan the `is_primary` rows once at the same bound, so users past the 10,000th row were never projected and nothing said so. It now pages to completion. A scan that fails, or a page the driver returned without honouring the id cursor, writes nothing and logs why (a failed scan logged before too, now with the consequence).
- **Smaller units are unchanged.** A unit or subtree with fewer than 10,000 members issues one read, as before, and answers the same set.
- **Loud, never short or empty.** A member read that fails, or a page the driver returned without honouring the id cursor, now throws.
  - Sharing, whole-rule passes: the expansion rejects, so that rule's reconcile or revoke pass fails, its callers log their existing per-rule warning, and the grants it already holds stay. Before, a failed read answered `[]`, so the retired-recipient revoke a business-unit graph write triggers took the rule's grants away from every member.
  - Approvals: the approver slot falls back to its literal (`department:ID`) and logs `could not be expanded — a directory or read-filter lookup failed` with its `error`. Before, a failed read logged "expanded to nobody", indistinguishable from an unstaffed unit.
  - Ownership queues: a `business_unit` or `unit_and_subordinates` queue specification whose member read fails still contributes nobody, the posture the queue declares for a failed member-table read, and now logs it once.
- **A failed `resolveAs` expansion says so.** An `expression` approver whose `resolveAs` value could not be expanded (a `department`, `position` or `team` read failed) kept its `KIND:VALUE` literal slot with no log line. It now logs the same `could not be expanded` warning the static approver types log, with the `error` and the `expression` source.
- **A missing object is still no members.** A stack that never registers, or never creates, `sys_business_unit_member` keeps answering no members through it, and the backfill has nothing to project. That is judged by `isObjectAbsentError(error, 'sys_business_unit_member')`; any other error stays loud.

**The remedy.** None is needed. A refusal means the membership table could not be read: fix that read, and the next expansion succeeds. A failed read is never cached.
