---
'@objectstack/runtime': patch
'@objectstack/plugin-auth': patch
---

fix(runtime,plugin-auth)!: a banned user's OAuth access tokens and refresh grants are refused while the ban holds

Clause-②: yes (narrowing) — while a user's ban holds, an OAuth access token that user consented to is answered at the MCP door as a token that does not verify (the generic `401`, with the same body and `WWW-Authenticate` header), and so is an agent forward credential acting for that user; the token endpoint answers that user's `refresh_token` grant and `authorization_code` exchange as an invalid grant of the same type (`400 invalid_grant`, the same description). Nothing else narrows.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest changes: the ban columns are read where an OAuth credential becomes its user, and no token, grant or consent row is revoked or rewritten. -->

**BREAKING** accept-set narrowing at the MCP door and the OAuth token endpoint: a banned user's OAuth credentials are refused while the ban holds.

- **The rule.** A ban holds every credential of the user. Banning a user already ends their sessions and refuses their sign-in and their API keys; their OAuth access tokens are now refused at the MCP door, and the token endpoint mints them no new token (no refresh, no code exchange), for as long as the ban holds. A ban with an expiry stops binding once the expiry has passed, exactly as sign-in does.
- **Not a revocation.** No token, refresh token or consent row is revoked or rewritten. Lifting the ban (or letting it expire) admits the same access token and lets the same refresh token renew, with nothing reissued.
- **Cost.** One primary-key read of the user's ban columns per OAuth credential the MCP door resolves; the token endpoint reads nothing extra. A store fault on that read answers `503 SERVICE_UNAVAILABLE`, as every other authorization-input read on that door does.
- **Who moves.** An MCP client connected over OAuth on behalf of a banned user gets `401` at the MCP door, and its refresh gets `400 invalid_grant`, until the ban is lifted or expires.

**The remedy.** Lift the ban, or connect the client as a user who is not banned.
