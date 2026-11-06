---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: an MCP access token can be revoked — `/oauth2/revoke` and the Console's consent withdraw end it on the next request, through the OAuth consent it was minted under

Clause-②: no (narrowing) — the MCP door refuses a bearer whose consent is gone or newer than the token, which the published contract already promises (`packages/spec/src/contracts/auth-service.ts` `verifyMcpAccessToken`: "a falsy value when the token is unknown/expired/revoked … callers fail CLOSED"), and a bearer with no `azp` claim to key that read; the revoke door's 200 for an invalid or another client's token removes a refusal RFC 7009 §2.1/§2.2 already negates. The contract text is not changed.
Metadata-protocol: none
Skills-docs: none — `skills/**` says nothing about revoking an MCP OAuth access token or withdrawing a consent, so no published skill text moves; the rule is documented in `mcp-token-revocation.ts` and on `AuthManager.verifyMcpAccessToken`.

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, value or export is removed or renamed; no metadata parses or saves differently, and only which OAuth bearers the MCP door admits after a revoke narrows -->

**BREAKING** narrowing at the MCP OAuth door and `/oauth2/revoke` (`@objectstack/plugin-auth`), executing the maintainer's ruling A of objectstack-ai/cloud#3606.

- **The consent is the revocable record.** An MCP access token is a JWT the authorization server never stores, so `verifyMcpAccessToken` now reads, on every MCP request, the consent the token was minted under: one indexed read of `sys_oauth_consent` by the token's client (`azp`), user (`sub`) and organization (`organization_id`). The token is refused when that consent is gone, when it was created after the token was issued (revoked, then granted again), when the token carries no `azp`, and when the read fails (fail closed). The MCP route answers a refused bearer `401`.
- **`POST /oauth2/revoke`.** The provider still authenticates the client first, unchanged. For an MCP access token issued to that client, the revoke now deletes the consent and the client's refresh family for that user and answers `200`, where it answered `400 unsupported_token_type` and the token kept working until it expired. A token issued to another client answers `200` and changes nothing. An unknown or invalid token answers `200` (RFC 7009 §2.2) where it answered `400 invalid_request`. A `token_type_hint` that names another token type does not end the search (RFC 7009 §2.1): the MCP access token is revoked all the same. A request the provider refuses before it looks at the token (no client, an unknown client, a malformed request) keeps its refusal. A store error while revoking answers `503 server_error` (RFC 7009 §2.2.1: the token still stands, retry later), and a retry completes it.
- **The Console's withdraw (`POST /oauth2/delete-consent`)** now ends the agent's access on its next request, with no other change: it deletes the same row the MCP door reads.
- **A server-only `skip_consent` client** has no consent row: its tokens are admitted without one, and revoking one keeps the honest `unsupported_token_type`.
- **The accepted cost.** After a revoke, the person sees the consent page again on the next connect.
