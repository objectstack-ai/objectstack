---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-auth': patch
'@objectstack/runtime': patch
'@objectstack/rest': patch
'@objectstack/mcp': patch
---

feat(plugin-audit): the `credential_use` row records where the use came from, the client address and the user agent

Clause-②: yes (widening)
Metadata-protocol: none

A `credential_use` row in `sys_audit_log` named which API key or OAuth access token acted as whom, but not from where: `ip_address` and `user_agent` were null, because neither credential's use stamp held the request's client facts. A leaked key used from a new address looked the same as normal use.

- **`ip_address`** is the address the deployment establishes for the request under its one client-address trust rule: `X-Forwarded-For` / `X-Real-IP` only when `server.trustProxy` is declared, otherwise the transport's own peer address. No forwarded header is ever recorded as the address without `trustProxy`. **`user_agent`** is the request's `User-Agent`, as presented.
- **Why an address is missing** is written on the row as `metadata.ip_address_absent`: `stdio` (the stdio MCP transport has no network peer), `undetermined` (the trust rule established no address), `not_supplied` (the door that admitted the credential handed over no client facts yet), or `unrecordable` (the established value does not fit the address column, so it is not stored). An address is never guessed.
- **The facts are the first use's in the window.** The row is still written once per credential per use window, when the credential's own throttled stamp lands, so `ip_address` and `user_agent` are those of the use that opened the window. A second use inside the window, from any address, writes no row.
- **Doors:** REST, the runtime dispatcher (its `/mcp` face included) and the stdio MCP transport hand their client facts over. An API key admitted at any other door records its user agent and `not_supplied` for the address.
- **Contract (`@objectstack/spec`, widening):** `IAuthService` gains the optional `resolveClientAddress(transport)` (the address the deployment establishes for a request; `AuthManager` already implements it), and `recordMcpAccessTokenUse(principal, transport?)` takes the admitted request's headers and peer address as an optional second argument. The new `AuthRequestTransport` type names that argument.
- **`@objectstack/core`:** `resolveApiKeyAdmission` takes an optional trailing `client` argument, `resolveAuthzContext` an optional `client` input and `resolveRequestExecutionContext` an optional `transport` input. None is read for any admission verdict: which credentials are admitted does not change.

The address and user agent are stored under the audit log's existing retention and access rules, and the row still never carries a key, a token, a key hash or a key prefix.
