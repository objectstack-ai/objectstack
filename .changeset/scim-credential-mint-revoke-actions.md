---
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
---

feat(platform-objects): mint and revoke SCIM connection credentials from the console

Clause-②: no
Metadata-protocol: none

`sys_scim_connection_credential` gains two actions, so a platform administrator setting up SCIM provisioning no longer needs curl to get a bearer token:

- **Mint Credential** (list toolbar) posts `POST /api/v1/auth/admin/scim/mint-credential` with a connection ID and the optional label, organization, provisioning domain and expiry, then shows the token once in a result dialog the administrator must close. Only the token's one-way digest is stored, so it cannot be shown again. Mint is not exposed to AI tools: an agent that ran it would hold a live SCIM bearer.
- **Revoke Credential** (a credential row or its record header) posts `POST /api/v1/auth/admin/scim/revoke-credential` for that row, after a confirmation. It is offered on an active credential only; the route's 404 and 409 answers show as the action's error. Revoke is exposed to AI tools and always asks the human to confirm first.

Both are offered only to a platform administrator and declare the routes' own gate (`manage_platform_settings`). Who may mint or revoke is unchanged: the routes still decide.

`@objectstack/plugin-auth`: a mint made on an impersonation session now names the administrator at the keyboard in its `sys_audit_log` row, as `metadata.impersonated_by` (the key the audit writers use). A mint on an ordinary session writes the same row as before.
