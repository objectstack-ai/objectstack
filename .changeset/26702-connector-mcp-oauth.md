---
'@objectstack/connector-mcp': minor
'@objectstack/service-automation': minor
---

feat(connector-mcp): an OAuth-protected MCP server is connected through the MCP authorization flow and dispatched with each organization's token (ADR-0143 S2, part of #26702)

Clause-②: yes (widening)
Metadata-protocol: semantic

ADR-0143 lets a `provider: 'mcp'` instance over an http transport declare `auth: { type: 'oauth2', grant: 'authorization_code' }` and leave its endpoints, and its client, to discovery. Until now such an instance was held degraded, and the `mcp` provider did not ask the credential handle. Now:

- **The connect runs the MCP authorization flow** (`@objectstack/service-automation`). When an administrator begins a connect, the server reads the MCP server's protected-resource metadata (RFC 9728), then its authorization server's metadata (RFC 8414, or OpenID Connect discovery). The `issuer` must be the one the server named, and `S256` must be listed. A declared `clientId` is used as is (the pre-registered form). Otherwise a public client is registered (RFC 7591) for the deployment's redirect URI. Every authorization and token request carries the server's resource indicator (RFC 8707), PKCE stays on, and a callback that names another issuer is refused before its code is used (RFC 9207). Every URL on the way must be https (plain http only to a loopback host). No request follows a redirect.
- **The connection keeps its client.** `sys_connector_connection` gains `registered_client`, an encrypted, masked field holding the discovered endpoints, the client id, and any client secret the registration issued (a declared client's secret stays behind its `credentialRef`). Refreshes use it, and a reconnect reuses it instead of registering again.
- **The `mcp` provider asks the credential handle** (`@objectstack/connector-mcp`). The plugin registers it with `{ credentialHandle: true }`. Over http, every request of the MCP session goes through a fetch that asks the handle. A `401` refreshes once and is sent once more; a second `401` fails the call with the `503` naming the instance. Each organization a dispatch runs for gets its own MCP session and token. The tools are listed at materialization with a request that names no organization, which the handle answers from the instance's only connection. A handle on a stdio transport, or beside a static credential, is refused.
- An `oauth2` instance on `mcp` whose transport URL is not https is held degraded, and a `client_credentials` one still needs its declared endpoints.
