---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-approvals': patch
---

fix(plugins)!: a role or membership tier held by more than 10,000 members reaches every holder in sharing and approvals, and a membership read that fails is refused loudly instead of answered with an empty set

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export, type or metadata changes: two expansions read a list they already read, to completion. No author has anything to rewrite; the one new refusal is a membership read that already failed, which used to answer an empty list. -->

**BREAKING** only where a `sys_member` read fails: the role expansion in sharing and the membership-tier expansion in approvals used to answer an empty list then, and now refuse.

Both expansions read `sys_member` once with a 10,000-row bound and took that read as the whole holder list. They also turned any read error into `[]`.

- **Every holder, nobody else.** `TeamGraphService.expandRoleUsers` (plugin-sharing: the `sys_member.role` limb of every `position` sharing recipient, and `expandPrincipal('role')`) and the approvals membership-tier expansion (an `org_membership_level` approver, and the second limb of every `position` approver) now read `sys_member` in pages of 10,000 ordered by id until the holders are exhausted. Past 10,000 holders, a sharing rule used to grant nothing to the holders past the 10,000th row, and an approval used to route without them. Both now reach every holder.
- **Smaller roles are unchanged.** A role or tier held by fewer than 10,000 members issues one read, as before, and answers the same set.
- **Loud, never short or empty.** A read that fails, or a page the driver returned without honouring the id cursor, now throws instead of answering `[]`.
  - Sharing: the expansion rejects, so that rule's reconcile or revoke pass fails, its callers log their existing per-rule warning, and the grants it already holds stay as they were. Before, the retired-recipient revoke compared a rule's materialised grants against that empty answer and revoked every one of them.
  - Approvals: the approver slot falls back to its literal (`position:NAME`, which whoever holds the position can still act on, or `org_membership_level:NAME`), and the warning now reads `could not be expanded — a directory or read-filter lookup failed` and carries its `error`. Before, a `position` approver routed to its assignment-table holders alone, which looked like a complete slate, and an `org_membership_level` approver logged "expanded to nobody".
- **The per-record sharing pass now resolves per rule.** `SharingRuleService.evaluateAllForRecord` (the pass a record write runs) used to reject as a whole when any one rule threw. Now a rule whose recipients cannot be read is left out of the returned results, its existing grants stay, and it logs `[sharing-rule] record reconcile failed for rule` with the rule and the error. The record's other rules still reconcile. This matches what `evaluateAllRulesForObject` already did.
- **A missing membership object is still no holders.** A stack that never creates or never registers `sys_member` keeps answering `[]`. That is judged by the shared missing-table predicate, or by the engine's `OBJECT_NOT_FOUND` for `sys_member`, rather than by swallowing every error.

**The remedy.** None is needed. A refusal means the membership table could not be read: fix that read, and the next expansion succeeds. A failed read is never cached.
