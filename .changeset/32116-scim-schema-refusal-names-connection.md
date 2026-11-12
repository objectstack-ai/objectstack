---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a SCIM request refused by the provider's schema check names the connection its valid bearer belongs to

Clause-②: no
Metadata-protocol: none

A SCIM request whose body fails the provider's schema check (a malformed PATCH operation, a `POST /Users` with no `userName`) is refused `400 invalidValue` before the bearer is verified. Its `scim_refused` audit row used to name no connection (actor empty, `scim_connection_id: unknown`), even when the bearer was valid, so a SCIM console that filters on the connection's `svc:scim:` actor never showed the most common identity-provider mapping error.

The row now names the connection (and the credential's organization) when the presented bearer belongs to a live credential. The bearer is resolved after the SCIM answer has been sent, only for a row the existing per-address and global bounds admit, through the same read-only lookup the verifier uses. A forged, revoked or expired bearer still reads `unknown`; a credential of any other shape is unchanged. The lookup writes nothing: a refused request does not update the credential's last use. The bearer, any part of it and its digest still never reach the event, the row or a log line. The SCIM answer itself is unchanged.
