---
'@objectstack/platform-objects': patch
'@objectstack/plugin-security': patch
---

Setup's user page grants a position or a permission set by picking its name from the security catalog (ADR-0131 D4)

Clause-②: no

- `@objectstack/plugin-security`: `sys_user_position.position` declares `widget: 'position-ref'` and `sys_user_permission_set.permission_set` declares `widget: 'permission-ref'`, so the grant form offers a picker over the positions and permission sets the catalog serves, and stores the chosen name. A console without those widgets keeps the text input. `sys_user_permission_set.permission_set_id`, the legacy id that grants nothing, is now `hidden` and no longer appears on the grant form; the column stays until a later release drops its data.
- `@objectstack/platform-objects`: the user page's Positions and Permission Sets lists no longer carry the "Assign position" / "Grant permission set" buttons. Those buttons listed `sys_position` / `sys_permission_set` rows, which a deployment need not hold. Grant with the list's **New**, which opens the grant form; removing a grant is unchanged.
