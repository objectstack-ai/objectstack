---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): one base-path normalisation chain, and an MCP resource identifier that is always a URL

`AuthManager` derived its base path in three independent places. `getMcpResourceUrl()`
read `this.config.basePath` directly and added no leading slash, so a `basePath`
configured without one produced a value that is not a URL at all:

    basePath 'api/v1/auth'   ->  http://localhost:3000api/v1/mcp

`new URL()` throws on that (`3000api` is not a port), so the RFC 9728 path-inserted
well-known route derived from it throws too, and `@better-auth/oauth-provider` 1.7.2
refuses to seed the `sys_oauth_resource` row from it at plugin init ("resource
identifier ... must be an absolute URI (RFC 8707 §2)"). With
`enforcePerClientResources` at its `true` default, every MCP client was then refused
for want of a link row. That input class could never mint or match a token, so
repairing it re-selects nothing.

There is now exactly one read of the configured value and one chain above it:

    configuredBasePath()   the configured value VERBATIM — what better-auth is handed
      └─ rootedBasePath()  + a leading slash when absent (better-auth's own rule)
           ├─ getAuthIssuer()      = origin + this
           └─ getBasePath()        = this, trailing slashes stripped
                └─ getMcpResourceUrl()  = origin + this minus `/auth` + `/mcp`

`getAuthIssuer()` and `getBasePath()` answer byte-identically to before for every
spelling. Only `getMcpResourceUrl()` moves, and only for a non-canonical `basePath`:
a missing leading slash (was not a URL), repeated trailing slashes, or a configured
`/` (was a `//mcp` path no mount serves). A canonical `basePath` is unchanged on all
three getters.
