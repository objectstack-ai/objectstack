---
'@objectstack/client': patch
---

feat(client): `client.oauth.authorizedClients.list()` and `.listForUser(userId)` read the AI assistants a person has authorized and when each was last used

Clause-②: yes (widening)
Metadata-protocol: none

`list()` calls `GET /api/v1/auth/authorized-clients` with no parameter: the caller's own grants. `listForUser(userId)` calls `GET /api/v1/auth/admin/authorized-clients?userId=...` and is answered for a platform administrator only. Both unwrap the `{ success, data }` envelope to the new exported `AuthorizedClientsList` type, `{ clients: AuthorizedClient[]; truncated: boolean }`. `AuthorizedClient.lastUsedAt` is an hour start, `null` when no use has been recorded. A refusal throws, as every other method does. Nothing existing changes.
