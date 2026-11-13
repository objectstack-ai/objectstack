---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
---

Clause-②: yes (widening) — `PositionSchema` gains an optional `renamedFrom` (a list of the position's earlier names). A position that does not declare it parses and behaves exactly as before; a declaration is refused only under rules that are new with the key (each entry a position name, never the position's own name, each once, never a name another position of the collection still declares, never an old name two positions claim).
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/rules/security.md (teaches positions and what they grant; does not yet teach that a renamed position declares its earlier names in `renamedFrom` so its holders move with it)

A position can now declare the names it had before, and the people who held it under an old name keep holding it under the new one.

ADR-0150 D7 makes a position one slot per name in an environment, so an app may have to rename its positions after go-live (HotCRM renamed all twelve for 18.4.0). Until now every installed organization's assignments (`sys_user_position`) kept naming the old position, which no longer exists, and those people silently lost every permission set it grants until an administrator edited each assignment.

```ts
definePosition({ name: 'crm_sales_rep', label: 'Sales Rep', renamedFrom: ['sales_rep'], permissionSets: ['crm_sales_user'] });
```

At boot, once every position is registered, `@objectstack/plugin-security` moves each holder of an old name to the new name, as the system, in every organization. Only the `position` column is written; a second boot moves nothing. A holder who already holds the new name in that organization keeps both rows, and the old row is named in the log for an administrator to remove.

An old name is not carried, and its holders stay as they are, when two positions claim it, when a position still declares it, when another package or the environment holds it or the activation ledger records it under another package, or when it is switched off in the activation ledger (its holders would otherwise come back active under the new name). Each case is logged at `warn` with the reason.

Holders only: sharing rules, queue members, record shares, pending approval slots (`position:NAME`), pending invitations and activation-ledger rows that still name an old position are listed in the boot log by table and organization count, and are never rewritten. Re-point them in Setup. Nothing is carried back on a downgrade.
