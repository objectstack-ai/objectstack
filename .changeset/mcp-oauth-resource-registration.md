---
"@objectstack/plugin-auth": patch
---

MCP OAuth can complete again: the MCP resource is registered as an RFC 8707 resource and DCR-registered clients are linked to it, so `authorize?resource=<mcp url>` no longer answers `invalid_target`.

On 17.3.0 no MCP client could ever obtain a token. `plugin-auth` configured `@better-auth/oauth-provider` with `validAudiences: [authIssuer, mcpResourceUrl]`, an option the pinned 1.7.2 does not read — the string does not occur once in its dist. In 1.7.2 a requested `resource` is resolved from the `oauthResource` table (`sys_oauth_resource`) and `enforcePerClientResources` defaults to `true`, so the client must also be linked in `oauthClientResource` (`sys_oauth_client_resource`). Neither row was ever written, so every client that sends `resource=` — Claude Code does — was refused at `/oauth2/authorize` with `invalid_target: requested resource <mcp url> is not configured`. Discovery, dynamic client registration and the login page all worked; the flow died one step before consent.

- **`resources: [mcpResourceUrl]`** seeds the `sys_oauth_resource` row from the provider's own `init`. Seeding is idempotent and defaults to `insertOnly`, so an administrator's later edits to the row's token policy are never reverted by a restart.
- **`clientRegistrationDefaultResources: [mcpResourceUrl]`** links each newly registered client to that resource inside the DCR transaction. This is the only place the link can be made: a client registers anonymously about one second before the browser login, leaving no window for an administrator to insert the row by hand.
- **`enforcePerClientResources` is left at its `true` default.** The per-client linkage check stays on — the fix makes the link exist rather than switching the check off. A client with no link row is still refused with `invalid_target`, and a test asserts that.
- **`validAudiences` is removed.** It was passed and read by nobody, which is precisely how the defect survived a version bump: it looked like configuration and enforced nothing.

No configuration change is required. Deployments that already ran 17.3.0 get the resource row on the next boot; MCP clients that failed to connect need to reconnect so a fresh registration picks up the link.
