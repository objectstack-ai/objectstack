---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): removing a pending person writes an admin audit row, and the host-failure texts say the removal is refused

Clause-②: no
Metadata-protocol: none

`POST /api/v1/auth/admin/remove-sso-user` now writes one `sys_audit_log` row for a removal that committed, through the same writer the add doors use: `action: 'delete'` on the removed `sys_user`, naming the administrator, with `metadata` `{ event: 'user.admin_removed_pending', hostNotified }` (`hostNotified` is whether the environment-user host took the cancellation of the invitation; `false` with no host wired). A refused removal (a host that cannot be reached, a host's refusal, a person who is not pending, a failed delete) writes no row. With plugin-audit uninstalled no row is written, as for the other admin user doors.

The removal door already refused with `503 SERVICE_UNAVAILABLE` when the environment-user host could not be reached, but the `warn` line logged in that case still said "The removal goes ahead.", and the `EnvironmentUserHost` and `environmentUserHost` option docs said a host failure is only reported on a removal. All three now say the removal is refused. Behaviour of the door is unchanged.
