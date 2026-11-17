---
'@objectstack/plugin-auth': patch
---

fix(auth): the console's Import Users and Add User work on a cloud-managed environment again

Clause-②: yes (widening) — added: `organizationId` in the bodies of `POST /api/v1/auth/admin/add-sso-user`, `/admin/import-sso-users` and `/admin/remove-sso-user`, admitted only when it equals the organization the caller's session is working in. Nothing that was accepted is refused.
Metadata-protocol: none

A `type: 'api'` action forwarded to the auth mount carries the caller's active organization as `body.organizationId`. The three SSO-user doors refused every key outside their own set, so the console's Import Users (`sys_user.import_sso_users`) and Add User (`sys_user.add_sso_user`) always answered `400 INVALID_REQUEST` "Unknown field(s): organizationId".

Each door now admits that one key under a constraint:

- absent: unchanged;
- equal to the session's active organization: admitted, and ignored. The organization a person joins is still read from the session, never from the body;
- any other value, or a value that is not a non-empty string: `400 INVALID_REQUEST`, naming the organization sent and the one the session holds. Nothing is read or written and the host is not told;
- sent by a caller whose session works in no organization: `400 NO_ACTIVE_ORGANIZATION`, nothing written.

The stamp itself (`buildApiActionRequest` in `@objectstack/runtime`) is unchanged: every identity-route forward still carries it.
