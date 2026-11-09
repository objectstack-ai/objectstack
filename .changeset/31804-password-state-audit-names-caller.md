---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the forced-reset flag and its clear are audited under the person who caused them

Clause-②: no
Metadata-protocol: none

An administrator's forced password reset (`POST /api/v1/auth/admin/set-user-password`) and the user's own password change (`POST /api/v1/auth/change-password`) each write `sys_user.must_change_password`, and plugin-audit recorded both writes with a null `actor` and `user_id`, as if the system had made them. Both writes now carry their caller on the attribution seam every identity write already uses (`authSystemWriteContext`), so the `sys_audit_log` row for the set names the administrator (and, from an impersonation session, the administrator at the keyboard as `impersonated_by`), and the row for the clear names the user.

- **Unchanged.** Both writes still run as the system: what they may write, the values they write and both doors' answers are the same. The sign-in stamp row is unchanged. A password change is credited only to the account's own holder: a request whose session names nobody (the emailed-link reset) or another account leaves the row the system's, as before.
- **Also attributed.** The administrator-created user's `must_change_password` set (`POST /api/v1/auth/admin/create-user`) goes through the same write and is now credited to the creating administrator.
