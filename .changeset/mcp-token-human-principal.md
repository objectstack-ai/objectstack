---
'@objectstack/plugin-auth': patch
---

MCP OAuth: refuse a `client_credentials` (machine-to-machine) access token

`AuthManager.verifyMcpAccessToken` resolved an M2M access token to a
principal — a machine ran as an authenticated member, stamping a user id that
belongs to no user into `created_by` / `updated_by` and owner columns — while
the method's own contract declared such tokens rejected. The contract's
premise was that they carry no `sub`; the OAuth provider stamps
`sub = user?.id ?? client.clientId`, so the premise was never true and the
rejection it described could never fire.

The subject and the client identity are now read as a pair, the way RFC 9068
defines them for a JWT access token: `client_id` is REQUIRED (§2.2), and `sub`
is the resource owner for a grant that had one or an identifier for the client
application for a grant that did not (§2.2.3.1). A token whose `sub` equals its
own `client_id` / `azp` therefore assembles no principal, and the MCP HTTP door
answers `401`. A token carrying neither client claim is refused as well: the
check has no input, and a check that cannot run must not silently pass.

Unchanged: interactive OAuth clients (authorization code + PKCE) resolve
exactly as before, and the headless track is untouched — `x-api-key` /
`Bearer osk_…` over HTTP and `OS_MCP_STDIO_API_KEY` over stdio are a separate
chain with a separate credential shape, and remain the supported way for a
machine to call this platform.
