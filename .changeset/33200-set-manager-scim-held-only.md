---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/lint': patch
---

fix(plugin-auth): Set Manager refuses only a person a SCIM directory holds, so an admin can change the manager of someone who signs in through SSO

Clause-②: yes (widening)
Metadata-protocol: none

`POST /api/v1/auth/admin/set-user-manager` refused every user whose `sys_user.source` is `idp_provisioned` with `403 PERMISSION_DENIED`, saying a directory owns their manager. ADR-0135 D4 stamps that value on every sign-in through an identity provider by a person with no local password: the platform's own SSO on a hosted environment, and any social or enterprise OIDC provider. Those people have no directory behind them. So after their first sign-in, nobody could change their manager, and approvals routed to the manager could not follow a reorganisation.

The endpoint now refuses only a person a SCIM directory holds: `source` is `idp_provisioned` and a SCIM connection has provisioned or linked them (a `sys_scim_subject` row). The answer is unchanged for them (`403 PERMISSION_DENIED`, `details.reason: 'idp_provisioned'`), and its message says to change the manager in the directory. Everyone else gets the answer a local user gets. The admin user import's `manager_id` column runs the same check, so an SSO-only row's manager link now lands. The self-assignment, cycle, depth and cross-organization refusals are unchanged. Nothing that was accepted before is refused now.

`sys_user`'s **Set Manager** action is now offered to a platform admin on every user row. It used to be hidden on `idp_provisioned` rows. A SCIM-held row is refused by the endpoint, which names the directory.

`os explain approval-approvers-may-resolve-empty` now says the admin operation refuses an identity a SCIM directory holds, and that an identity that only signs in through SSO is set like any other.

The `idp_provisioned` stamp itself (ADR-0135 D4) and the password refusals are unchanged.
