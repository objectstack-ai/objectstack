---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an MCP client that registers over OAuth dynamic client registration with a loopback or custom-scheme redirect, and no `application_type`, is registered as a native client instead of being refused

Clause-②: no (a runtime security-boundary change the maintainer ruled; no published type, export or metadata key moves)
Metadata-protocol: none

Local MCP clients (Claude Code, Cursor, VS Code, Codex CLI) register at `POST /api/v1/auth/oauth2/register` with a loopback `http` redirect (`http://localhost:PORT/...`, `http://127.0.0.1:PORT/...`) or a custom-scheme redirect, and send no `application_type`. The OAuth provider used to fill the missing type with `web` and refuse both redirect forms (`invalid_redirect_uri: web clients require https redirect URIs on non-loopback hosts`), so these clients could not connect to the MCP endpoint over OAuth and API keys were the only working path.

plugin-auth now passes `clientRegistrationDefaultApplicationType: 'infer'` to `@better-auth/oauth-provider`. A dynamic registration that omits `application_type` is classified `native` when any redirect URI uses a non-http(s) scheme or `http` on exactly `localhost`, `127.0.0.1` or `[::1]`, and every redirect URI is then validated by the native rule. Otherwise it stays `web`. What this changes and what it keeps:

- Accepted as `native`: the body a local MCP client sends (a public client with a loopback or custom-scheme redirect).
- Unchanged: an `application_type` the client sends is never overridden; `https://example.com/cb` alone stays `web`; `http://example.com/cb` and `http://localhost.example.com/cb` stay refused; with dynamic client registration off, every registration is still refused.
- Also accepted as `native`: a confidential registration (`client_secret_basic`, or no `token_endpoint_auth_method`, which the provider fills as `client_secret_basic`) with a loopback or custom-scheme redirect and no `application_type`, which is issued a `client_secret`. The same body was already accepted with `application_type: 'native'` spelled out, so no new client shape becomes registrable.
- PKCE stays required at `/oauth2/authorize` for every one of these clients, and every token still needs the user's sign-in and consent.

The Setup form's own OAuth application door (`/sys-oauth-application/register`) is not affected.
