---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(plugin-auth, platform-objects): a SCIM connection credential shows a token hint and when it was last used, so two credentials of one connection can be told apart during a rotation

Clause-②: yes
Metadata-protocol: none

`sys_scim_connection_credential` gains two read-only columns, both in the `all` list view and readable through the data API's list door:

- `token_hint`: the last four characters of the bearer, stored when the credential is minted. The mint door (`POST /api/v1/auth/admin/scim/mint-credential`) answers it as `data.tokenHint` beside the token, and the mint result dialog shows it, so an administrator can match a row to the bearer they pasted into the identity provider. Never a prefix (every bearer starts with the constant `oss_scim_`), never the bearer, never the digest, which stays internal.
- `last_used_at`: written by the SCIM bearer verifier on a successful verification only, at most once per credential per minute. A refused bearer (unknown, revoked or expired) writes nothing. A failed write never fails the SCIM request; it is logged once per distinct failure at `error`, naming the credential row and never the bearer.

Existing credentials: a credential minted before this release has no `token_hint`, and none can be backfilled because the bearer is not stored. It shows empty; mint a new credential to get one. Its `last_used_at` starts filling on its next successful SCIM request.
