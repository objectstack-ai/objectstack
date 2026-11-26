---
'@objectstack/plugin-auth': patch
---

Clause-②: no
Metadata-protocol: none

`POST /api/v1/auth/admin/ban-user` and `POST /api/v1/auth/admin/unban-user` now write one `sys_audit_log` row for a change that committed, through the same writer the other admin user doors use: `action: 'update'` on the target `sys_user`, naming the administrator, with `metadata` `{ event: 'user.admin_banned' | 'user.admin_unbanned', hostNotified }`. A refused ban or unban writes no row. Without the admin plugin, the ban columns' write now carries the administrator's attribution too, so plugin-audit's own row for that change names the administrator instead of the system, as it already did with the admin plugin; the written fields are unchanged. The ban reason and expiry stay on plugin-audit's row for the user's change, not in `metadata`. The route ledger note for `admin/remove-sso-user` and the authentication docs now name that door's `user.admin_removed_pending` row.
