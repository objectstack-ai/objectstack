---
'@objectstack/plugin-auth': patch
'@objectstack/client': patch
---

feat(auth): withdraw an authorized AI assistant, for the person themself and for a platform administrator

Clause-②: yes (widening)
Metadata-protocol: none

Two new routes beside the authorized-clients reads, each keyed by the consent `id` those reads answer on every row:

- `POST /api/v1/auth/authorized-clients/withdraw` with `{ "id": "…" }` withdraws one of the signed-in person's own authorized assistants. Only that person's grant is withdrawn: an id that names someone else's grant answers `404 RESOURCE_NOT_FOUND`, byte for byte the same as an id that names nothing, and leaves it in place.
- `POST /api/v1/auth/admin/authorized-clients/withdraw` with `{ "userId": "…", "id": "…" }` does the same for a person a platform administrator manages, behind the same gate as `GET /api/v1/auth/admin/authorized-clients`: anyone else is refused once (`401` anonymous, `403 PERMISSION_DENIED` otherwise), whoever the body names and whether or not the person or the grant exists.

A withdraw revokes the grant the way `/oauth2/revoke` does: the consent row, then the client's refresh tokens. The assistant's token is refused on its next MCP call, and it must be authorized again to reconnect. Both routes take a closed body (an unknown key, or a missing or empty value, is `400 VALIDATION_ERROR`) and no query parameter, and answer `{ success: true, data: { id } }` with `Cache-Control: no-store`.

`@objectstack/client` adds `oauth.authorizedClients.withdraw(id)` and `oauth.authorizedClients.withdrawForUser(userId, id)`, both answering `AuthorizedClientWithdrawal` (`{ id }`).

better-auth's own `POST /api/v1/auth/oauth2/delete-consent` is unchanged and stays outside the SDK: it answers an unknown id and another person's id differently, and leaves the refresh tokens behind. Use the new routes instead.
