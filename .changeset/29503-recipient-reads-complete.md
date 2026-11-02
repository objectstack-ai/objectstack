---
'@objectstack/types': patch
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-approvals': patch
---

fix(plugins)!: team and position recipients reach every holder past 10,000 rows in sharing and approvals, and a team, position or role holder read that fails is refused loudly instead of answered with nobody

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata changes: the team and position expansions read lists they already read, to completion, and the holder checks refuse a read that already failed. The one new export (isObjectAbsentError in @objectstack/types) is an addition. No author has anything to rewrite. -->

**BREAKING** only where a `sys_team_member`, `sys_user_position` or `sys_member` read fails: the team and position expansions and the user-scoped holder checks used to answer nobody (an empty list, or `false`) then, and now refuse.

This completes the family the role and membership-tier fix started. The team and position reads still read once with a 10,000-row bound and turned any read error into nobody.

- **Every holder, nobody else.** In plugin-sharing, `TeamGraphService.expandUsers` (`sys_team_member`, every `team` sharing recipient) and the assignment limb of `PositionGraphService.expandPositionUsers` (`sys_user_position`, every `position` sharing recipient) now read in pages of 10,000 ordered by id until the holders are exhausted. In plugin-approvals, the `team` approver and the assignment limb of the `position` approver (and every caller of the position expansion: escalation targets, reassign checks, `resolveAs` expressions) do the same. Past 10,000 holders, the holders past the 10,000th row used to get no grant and no approval slot. They now do.
- **Smaller groups are unchanged.** A team or position held by fewer than 10,000 people issues one read, as before, and answers the same set.
- **Loud, never short or empty.** A read that fails, or a page the driver returned without honouring the id cursor, now throws.
  - Sharing, whole-rule passes: the expansion rejects, so that rule's reconcile or revoke pass fails, its callers log their existing per-rule warning, and the grants it already holds stay. Before, a failed team read answered `[]`, and a failed assignment read answered the `sys_member.role` holders alone, so the retired-recipient revoke took grants away from people who still held the recipient.
  - Sharing, per-user recompute (a write to `sys_team_member` or `sys_user_position`): the holder checks `teamHasMember`, `holdsRole` and `PositionGraphService.holdsPosition` now refuse a failed read instead of answering `false`. The recompute logs `recipient membership re-evaluation failed` for that rule and user, and the user's grants stay. Before, an outage revoked that user's grants.
  - Approvals: the approver slot falls back to its literal (`team:ID` or `position:NAME`) and logs `could not be expanded — a directory or read-filter lookup failed` with its `error`. Before, a failed team read logged "expanded to nobody", and a failed assignment read routed a `position` approver to its membership-tier holders alone, which looked like a complete slate.
- **Ownership queues: a position specification now contributes nobody on a `sys_user_position` outage.** A queue team specification whose `sys_team_member` read fails still contributes nobody, as before. A queue position specification whose `sys_user_position` read fails now contributes nobody too, on the expansion and on the queue's holder check alike, where before it contributed that position's `sys_member.role` transition-source holders. That is the posture the queue declares for a failed member-table read, reached here for the first time. Both now log once. Whether a queue should refuse instead is left to a ruling.
- **A missing object is still no holders.** A stack that never registers, or never creates, `sys_team_member`, `sys_user_position` or `sys_member` keeps answering no holders through it. That is judged by the new `isObjectAbsentError(error, readObject)` in `@objectstack/types`: the shared missing-table predicate for that object, or the engine's `OBJECT_NOT_FOUND` naming that object. Any other error, including an absence of a different object, stays loud.

**The remedy.** None is needed. A refusal means the membership table could not be read: fix that read, and the next expansion succeeds. A failed read is never cached.
