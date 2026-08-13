---
'@objectstack/plugin-auth': minor
---

security: encrypt the OIDC SSO `clientSecret` at rest

`sys_sso_provider.oidc_config` stored the OIDC `clientSecret` in cleartext inside
its JSON blob — measured on a real registration, byte for byte. That secret
authenticates the platform itself to the identity provider, and the object is
readable through the generic data API (`apiMethods: ['get','list']`), so anyone
who could read the row could impersonate the platform's OIDC client.

The secret now lives in `sys_sso_provider.oidc_client_secret`, a `Field.secret()`
column on the engine's encrypted credential channel: the engine wraps it with the
registered `ICryptoProvider`, stores the ciphertext as a `sys_secret` row, keeps
only an opaque ref on the provider row, and returns a mask on every generic read.
`oidc_config` keeps the rest of the config in cleartext on purpose, so the admin
UI can still render endpoints, scopes and mapping.

Both better-auth write doors are covered (`/sso/register` and
`/sso/update-provider`), and the adapter recovers the plaintext server-side for
`/sso/callback`, so federated login is unchanged.

Existing provider rows are migrated forward automatically at start. A row that
cannot be migrated — no `ICryptoProvider` wired — keeps working and is reported
with a warning rather than silently left looking protected.

⚠️ Registering or updating an SSO provider now REFUSES rather than storing
cleartext when no `ICryptoProvider` is registered. Self-hosted deployments get
`LocalCryptoProvider` automatically from `serve`; set `OS_SECRET_KEY` (or swap in
a KMS/Vault provider) so secrets survive a restart.
