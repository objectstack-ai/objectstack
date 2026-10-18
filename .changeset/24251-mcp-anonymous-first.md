---
'@objectstack/runtime': patch
---

fix(runtime): an anonymous caller of `/api/v1/mcp` is answered `401 UNAUTHENTICATED` whatever `OS_MCP_SERVER_ENABLED` or the `mcp` service says

Clause-②: no

ADR-0138 D2 takes the anonymous decision once per domain, as the domain's first statement. The `/mcp` domain checked the `OS_MCP_SERVER_ENABLED` switch and the `mcp` service before it, so an anonymous caller was answered `404 RESOURCE_NOT_FOUND` with the switch off and `501 NOT_IMPLEMENTED` with no MCP service installed, and learned whether the deployment runs MCP before it was refused. Measured on both hosts, the standalone server (`HonoServerPlugin` with the dispatcher plugin) and a `createHonoApp` host.

- An anonymous request on `/api/v1/mcp` (any verb) is now refused `401 UNAUTHENTICATED` first, in every composition. Only the order of the refusals moves: no request that was refused before is accepted.
- A signed-in caller, or a system principal, keeps the switch's `404` and the service's `501`, in that order.
- The `401` advertises RFC 9728 resource metadata (`WWW-Authenticate: Bearer … resource_metadata="…"`) only where the resource is served: the switch on, an `mcp` service that can take the request, and an auth service that answers a metadata URL. With the switch off or no service the `401` is the plain API-key one, so it never points a client at a protected resource the deployment does not serve.
