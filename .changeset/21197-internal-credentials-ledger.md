---
'@objectstack/plugin-audit': minor
'@objectstack/platform-objects': minor
'@objectstack/plugin-auth': minor
'@objectstack/plugin-sharing': minor
'@objectstack/plugin-approvals': minor
'@objectstack/objectql': minor
'@objectstack/runtime': patch
---

fix(plugin-audit,platform-objects,plugin-auth,plugin-sharing,plugin-approvals)!: the audit ledger no longer records fields declared `internal`, and the platform's credential-class fields are declared `internal`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or config field is removed or renamed: the change narrows what the generic data path and the audit ledger return for platform-owned columns, and nothing an author wrote needs rewriting. The objectql half adds exports only. -->

**BREAKING for readers of credential-class columns on the generic data path and in the audit ledger.**

**What changed.**

- The audit plugin's CRUD mirror now omits every field declared `internal: true` from the
  rows it writes to `sys_audit_log` and `sys_activity`: create `new_value`, both sides of an
  update, delete `old_value`, and the activity row. It already masked `secret` and `password`
  fields; `internal` is the same contract the generic data path already enforces ("never
  returned on the generic data path"). An update that changes only an `internal` field still
  writes its row, with neither value.
- These platform fields are now declared `internal: true`, so neither the generic data path
  nor the ledger returns them: the JWT signing key's private key (`sys_jwks`), both credential
  columns of the one-time verification object (`sys_verification`), the two-factor secret and
  backup codes, the SSO provider's OIDC and SAML protocol blobs, the OAuth access and refresh
  token columns, the OAuth client secret digest, the SCIM credential digest, the share link's
  token and password hash, and the approval action-token digest. API key digests and email
  headers were already `internal`; the ledger now honours that too.
- Every built-in consumer that needs one of these values reads it back through the engine's
  privileged accessor rather than the generic path: JWT signing, password reset and the other
  one-time verification flows, two-factor verification, SSO sign-in and the legacy SSO secret
  migration, OAuth client authentication, share-link redemption (the password gate is held)
  and the creator's share-link list, which keeps returning each link's token. The runtime's
  share-link resolve route (the dispatcher twin of the plugin's) still answers "password
  required" for a protected link rather than the unknown-link shape.
- The one-time verification object's record title is now the fixed label `Verification`; it no
  longer shows the identifier column.
- `@objectstack/objectql` exports two helpers from its main and `/core` entries:
  `collectInternalReadFields` (the names of an object's `internal` fields) and
  `readInternalColumn` (recovers one `internal` column for rows already read, through the
  engine's privileged accessor, and fails closed when the value cannot be recovered).

**What to do after upgrading.**

- **Rotate the JWT signing keys.** Ledger rows written before this release are not rewritten
  (the ledger is append-only), so a signing key that existed before the upgrade may have a copy
  in the ledger. Rotate the keys so that copy signs nothing.
- **Revoke and re-mint share links that must stay private.** A share link's token is a
  capability that stays valid until the link expires or is revoked, and links minted before this
  release may have a copy in the ledger.
- A copy of a one-time verification credential is usable only while that credential is still
  outstanding: once it is consumed or expires, its copy names nothing that will be accepted.
- An integration that read any of these columns through `GET /api/v1/data/...` no longer
  receives them. Read share links through `/api/v1/share-links`, and OAuth clients and SSO
  providers through their auth routes.
