---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
---

feat(security)!: reconcile the SharingRule authoring surface with the enforced runtime — rename `group` → `team`, add `business_unit`, prune `guest` + owner-type rules (#1878)

The authoring `ShareRecipientType` enum had drifted behind the ADR-0090 D3
rename and the enforced runtime: the runtime expands `team` (via
`sys_team`/`sys_team_member`) and `business_unit`, but the authoring enum
still offered the pre-rename `group` (silently skipped at seed time) and
omitted the two live recipients. After this change **every authorable
recipient and rule type is enforced** — nothing on the SharingRule surface
validates and then silently does nothing (ADR-0078).

- **`sharedWith.type: 'group'` → `'team'`** (wire-rename): the enum member is
  renamed to match the runtime vocabulary and now maps through the seed
  bootstrap to the live `TeamGraphService` expansion. Flat `sys_team`
  membership; enforced.
- **`business_unit` added** to the authoring enum — exactly one business
  unit's members (no subtree; use `unit_and_subordinates` for the subtree).
  The runtime + bootstrap already enforced it; only the enum omitted it.
- **`guest` removed** — it had no runtime recipient mapping. Anonymous access
  is served by the public-form grant and share links, not sharing rules.
- **Owner-type rules removed** (`type: 'owner'`, `ownedBy`,
  `OwnerSharingRuleSchema` + its type export): they depend on live
  team/position membership, which the static materialiser cannot track, so
  they validated but never materialised a share. They return as an enforced
  form if membership-reactive re-materialisation is designed.
  `SharingRuleSchema` is now the criteria form; the `queue` recipient stays
  runtime-reserved (no `sys_queue` yet) and deliberately non-authorable.

**Migration** (stale definitions now fail parse with the valid options listed):
- `sharedWith: { type: 'group', … }` → `sharedWith: { type: 'team', … }`.
- `sharedWith: { type: 'guest', … }` → delete the rule; expose the records
  via a public form or share link instead.
- `type: 'owner'` rules → rewrite as a `type: 'criteria'` rule scoping the
  rows by field values (see the migrated examples:
  `share_open_tasks_with_manager` in app-showcase,
  `share_active_leads_with_manager` in app-crm), or use a scope-depth grant.

<!-- adr-0087: registered sharing-rule-recipient-reconcile -->
