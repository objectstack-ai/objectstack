---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): position- and team-recipient sharing rules are re-evaluated for the affected user when the membership behind the recipient changes

Clause-②: no

A sharing rule's grants are materialised per user. When a position assignment (`sys_user_position`), a membership role (`sys_member.role`, the position transition source) or a team membership (`sys_team_member`) is inserted, deleted, or updated in a column the recipient expansion reads (the user, the position or team, the organization, the validity window), every sharing rule whose recipient the row names is now re-evaluated for the user the row names, before the write returns. A new holder gains the rule's grants and a former holder loses them. Other users' grants, and rules naming other recipients, are not touched.

The re-evaluation is scoped to that one user and to the rules naming the recipient: an indexed holder check, that user's grants of the rule, and the rule's criteria read only when the rule reaches the user. A bulk assignment import therefore costs one user-scoped pass per row and never a whole-rule pass. An organization's rule is re-evaluated only for rows of its own organization; a platform-global rule for every row.

`SharingRuleService` gains `reconcileRuleForUser(rule, userId)`, the user-scoped pass these hooks run. No spec key, endpoint or configuration changes.
