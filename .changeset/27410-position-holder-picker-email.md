---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(setup): Position › Add holder's user picker shows each person's email beside their name

Clause-②: no
Metadata-protocol: none

- **Before.** On a Setup position page, Add holder opened a user picker that drew one column, the user's name. An administrator could not tell two people of the same name apart, nor confirm the account before granting the position, although the holder list on the same page already shows each holder's email under the name.
- **Now.** The picker draws a Name column and an Email column (`sys_user`'s `name` and `email`), and titles each person by `sys_user` as the registry serves it.
- **Unchanged.** The picker still draws only the columns the caller may read: for a caller whose policy denies `sys_user.email`, the Email column is not drawn and the Name column stands alone. Choosing people still assigns the position by name, offers the active organization's members only, and skips anyone who already holds it.
