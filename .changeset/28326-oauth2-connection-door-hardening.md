---
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

fix(service-automation): harden the OAuth2 connector connection door (ADR-0143 S1 follow-up, #28326)

Clause-②: no
Metadata-protocol: none

- **`@objectstack/service-automation`**:
  - **The connect that is waiting for its callback is held sealed.** The pending authorization (the PKCE verifier, the user, the organization and the redirect URI) is held in the cluster KV, or in process on a single node, as an AES-256-GCM envelope under a key derived from the raw `state`. The server keeps only the state's digest. A party that can read the KV learns none of those values. A value that is edited, or moved to another state's slot, opens as nothing, and its code is never exchanged. A connect begun before the upgrade and completed after it is refused as expired; begin it again.
  - **The connection row is written only over the revision that was read.** A refresh, the "reconnect required" mark and a reconnect are each one conditional write (`where: { id, revision }`), so a stale writer on any replica never overwrites a newer grant. A reconnect that loses such a race is refused `503` and keeps nothing; begin it again.
  - **A connection store that cannot be read refuses a connect or a revoke with `503`**, the declared answer, instead of an undeclared `500`.
  - **An `oauth2` token endpoint's redirect is refused, never followed.** The token request carries the client secret and the refresh token, and a `307` or `308` would replay them to the `Location` it names.
  - **Plain `http://` is accepted only to a loopback host:** `localhost`, a `127.0.0.0/8` address or `[::1]`. A `*.localhost` name is no longer accepted, because the system resolver sends it to DNS like any other name. Every other `tokenUrl` or `authorizationUrl` must be `https://`, or the instance is held degraded with the field named.
- **`@objectstack/runtime`**: the route ledger row for `DELETE /api/v1/automation/connectors/:name/connection` now says that a revoke is local only. No RFC 7009 revocation is sent to the vendor yet, because no revocation endpoint is known for the instance until ADR-0143 S2 discovery. The refresh token stays valid at the vendor until it expires or is revoked there.
