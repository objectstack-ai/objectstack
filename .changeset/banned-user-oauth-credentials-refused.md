---
'@objectstack/runtime': patch
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(runtime,plugin-auth)!: a banned user's OAuth access tokens and refresh grants are refused while the ban holds

Clause-②: yes (narrowing) — while a user's ban holds, an OAuth access token that user consented to is answered at the MCP door as a token that does not verify (the generic `401`, with the same body and `WWW-Authenticate` header), and so is an agent forward credential acting for that user; `/oauth2/userinfo` answers that token as an access token that does not verify (`401 invalid_token`), and `/oauth2/introspect` answers that user's access and refresh tokens as inactive (`{ "active": false }`); the token endpoint mints that user no token: a `refresh_token` grant answers as an invalid refresh token (`400 invalid_grant`), and an `authorization_code` exchange is refused, with the code spent: by the provider's own session answer (`400 invalid_request`) when the ban ended the user's sessions, as the ban routes do, and otherwise as an invalid code (`400 invalid_grant`). Those are the doors this change narrows.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest changes: the ban columns are read where an OAuth credential becomes its user or is read back, and no token, grant or consent row is revoked or rewritten. -->

**BREAKING** accept-set narrowing at the MCP door and at the OAuth authorization server's token, userinfo and introspection endpoints: a banned user's OAuth access tokens and refresh grants are refused while the ban holds.

- **The rule.** Banning a user already ends their sessions and refuses their sign-in and their API keys. While the ban holds, their OAuth access tokens are now also refused at the MCP door and read as not valid at userinfo and introspection, and the token endpoint mints them no new token (no refresh, no code exchange). A ban with an expiry stops binding once the expiry has passed, exactly as sign-in does.
- **Not a revocation.** No token, refresh token or consent row is revoked or rewritten. Lifting the ban (or letting it expire) admits the same access token at the MCP door and lets the same refresh token renew, with nothing reissued. An authorization code presented while the ban held is spent, so the client signs the user in again.
- **Cost.** One primary-key read of the user's ban columns per OAuth credential the MCP door resolves, and one read of the user row per active introspection answer that names a user; the token and userinfo endpoints read nothing extra. A store fault on the MCP door's read answers `503 SERVICE_UNAVAILABLE`, as every other authorization-input read on that door does; a store fault on the introspection read fails the request rather than answering active or inactive.
- **Who moves.** An MCP client or OIDC relying party connected over OAuth on behalf of a banned user gets `401` at the MCP door and at userinfo, `{ "active": false }` from introspection, and `400` from the token endpoint, until the ban is lifted or expires. The Ban User confirmation (`@objectstack/platform-objects`) and the administrator and authentication guides now say so.

**The remedy.** Lift the ban, or connect the client as a user who is not banned.
