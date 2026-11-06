---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a person can read the AI assistants they have authorized and when each was last used, and a platform administrator can read another person's

Clause-②: yes (widening)
Metadata-protocol: none

Two new reads, both ObjectStack mounts ahead of the better-auth catch-all and both in `AUTH_ROUTE_LEDGER`:

- `GET /api/v1/auth/authorized-clients` answers the signed-in person's own OAuth consents (Claude Desktop, an IDE agent, any MCP client). It is keyed by the session and nothing else: it takes no query parameter, and one that is sent (`?userId=` included) is refused `400 VALIDATION_ERROR` rather than ignored.
- `GET /api/v1/auth/admin/authorized-clients?userId=ID` answers another person's, for a platform administrator only. It is gated exactly as the admin session doors are (ADR-0068 D2, a held session refused per ADR-0069 D3). The gate runs before the query is read, so anyone else (an organization owner or admin included) gets one `403 PERMISSION_DENIED` whether or not the person exists. It lists every organization the person granted in. A missing, empty or repeated `userId` is `400`, and an id naming no user is `404 RESOURCE_NOT_FOUND`. It is read only.

Each row carries exactly `id` (the consent id, the key `POST /oauth2/delete-consent` takes), `clientId`, `name`, `scopes`, `organizationId`, `authorizedAt` and `lastUsedAt`. Nothing in it identifies or reconstructs a token. The answer is newest first, at most 200 rows, with `truncated: true` when the person holds more, and it is sent with `Cache-Control: no-store`.

`lastUsedAt` is the start of the most recent clock hour in which the client made a verified MCP call under that consent, or `null` when none has been recorded. The server writes it after `verifyMcpAccessToken` admits a token, and only on the consent that admitted it: the consent for the token's client, person and organization, created no later than the token was issued, the rule the verifier's own consent read applies. So a revoked consent, or a token of an earlier grant, stamps nothing. The write is off the request path, at most once per consent per hour in each process (several processes may each write the same hour start), from the verified token and the server clock alone. A store failure never fails the MCP call, and each distinct failure is logged once per process at `error`; a consent withdrawn between the stamp's read and its write is not a failure. It lands in the new `sys_oauth_consent.last_used_at` column, so a deployment picks it up at its next schema sync. Until then the reads answer `500` and the stamp logs that error once per process.
