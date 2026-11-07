---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a platform administrator can mint and revoke SCIM connection credentials

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: updated here — `content/docs/permissions/authentication.mdx` ("SCIM Connection Credentials" under Admin User Management); `skills/**` teaches no SCIM setup

An identity provider (Okta, Entra ID) provisions users through `/api/v1/auth/scim/v2/*` with a bearer credential that this platform issues, but nothing could issue one: the mint existed with no caller, and the credential object refuses create on the data API, so no identity provider could connect. Two routes now do it, for the platform administrator only (the shared ADR-0068 gate: anyone else is refused `403 PERMISSION_DENIED`, `401 UNAUTHENTICATED` when signed out):

- `POST /api/v1/auth/admin/scim/mint-credential` with `{ connectionId, label?, expiresAt?, provisioningDomainId?, organizationId? }` answers `{ credentialId, connectionId, token, expiresAt }`. `connectionId` is at most 246 characters, so the connection's audit actor `svc:scim:<connectionId>` fits `sys_audit_log.actor`. The `token` is shown once, in that response only (`Cache-Control: no-store`); only its keyed one-way digest is stored, and it is not readable through the data API, the audit log or the logs. Refused `503 SERVICE_UNAVAILABLE` while SCIM is off. The credential row is owned by `organizationId` when given (it must exist), otherwise by the Default Organization.
- `POST /api/v1/auth/admin/scim/revoke-credential` with `{ credentialId }` switches the credential off, so the identity provider's next SCIM request with it answers `401`. `404 RESOURCE_NOT_FOUND` for an unknown credential, `409 RESOURCE_CONFLICT` for one already revoked. Served whether or not SCIM is on.

Exported: two public `AuthManager` methods back the routes. `isScimWired()` answers whether the SCIM service provider is mounted on this deployment (the same decision that mounts `/scim/v2`), and `mintScimConnectionCredential(engine, input)` mints a connection bearer with the deployment's auth secret, the key the mounted SCIM verifier digests with.

Rotation is a second mint for the same `connectionId`, moving the identity provider to the new bearer, then revoking the old one. Each mint and each revoke writes one `sys_audit_log` row naming the administrator and the connection, never the credential. Nothing that existed changes: no route, response or stored row moves, and the credential object stays read-only on the data API.
