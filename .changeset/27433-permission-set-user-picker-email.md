---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(setup): Permission set › Add user's picker shows each person's email beside their name

Clause-②: no
Metadata-protocol: none

- **Before.** On a Setup permission-set page, Assigned users › Add user opened a user picker that drew one column, the user's name. An administrator could not tell two people of the same name apart, nor confirm the account before granting the set, although the assigned-user list on the same page already shows each person's email under the name.
- **Now.** The picker draws a Name column and an Email column (`sys_user`'s `name` and `email`), and titles each person by `sys_user` as the registry serves it.
- **Unchanged.** The picker still draws only the columns the caller may read: for a caller whose policy denies `sys_user.email`, the Email column is not drawn and the Name column stands alone. Choosing people still writes the grant by name (`{ user_id, permission_set }`), offers the active organization's members only, and shows the AI-seat cap refusal inline.
