---
'@objectstack/plugin-auth': patch
'@objectstack/verify': patch
'@objectstack/platform-objects': patch
---

Grants name their permission set, with no `sys_permission_set` row read (ADR-0131 D4)

- `@objectstack/plugin-auth`: the self-registration grant names the declared set alone. Admission asks the security catalog and the activation ledger whether the set grants, and the settlement writes `{ user_id, permission_set }` with no row read, so a deployment with no `sys_permission_set` row for the set still grants it. The last-administrator guard reads which set a grant holds from its name only; writing `permission_set_id` moves no standing.
- `@objectstack/verify`: the RLS probe persona's grant names the registered probe set alone; it no longer needs, or refuses for want of, a boot-seeded `sys_permission_set` row.
- `@objectstack/platform-objects`: Setup's user page grants a permission set by name: the Add picker stores the set's machine name (`valueField: 'name'`, `linkField: 'permission_set'`), and the list shows the name column. The picker still lists `sys_permission_set` rows; listing the security catalog itself is a console change.
