---
'@objectstack/platform-objects': patch
---

feat(platform-objects): `sys_oauth_consent` gains `last_used_at`, the start of the most recent hour in which the client made a verified MCP call under the consent

Clause-②: yes (widening)
Metadata-protocol: none

A nullable, read-only datetime on the better-auth-managed consent table, owned by ObjectStack. The OAuth provider neither reads nor writes it. Its one writer is plugin-auth, server-side, after it verifies an MCP access token minted under the consent. The object stays off the data API (`apiEnabled: false`), so no client reaches the column. A withdrawn or revoked consent takes the stamp with it. Schema sync adds the column, and existing rows read `null`.
