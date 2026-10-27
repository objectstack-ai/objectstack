---
'@objectstack/connector-mcp': minor
---

fix(connector-mcp): `tools/list` follows `nextCursor` through every page, and a rejected credential (HTTP 401 / 403) is a fatal configuration fault, not a retried upstream outage

Clause-②: no (narrowing)
Metadata-protocol: narrowed

- **Pagination.** Discovery called `tools/list` once with no cursor, so a server that pages its tool list lost every tool past the first page, silently. The SDK-backed client now follows `nextCursor` until the server stops answering one, so every tool on every page becomes an action (and is offered to `providerConfig.include`). The walk is bounded at 100 pages: a server still answering a `nextCursor` after that fails discovery with an error naming the bound, never a connector built from a truncated tool list. On a declarative instance that failure is classified like any other failed discovery (the instance degrades and is retried). `McpClientLike.listTools()` is documented as returning every page; an injected client returns the whole list.
- **Rejected credential.** An HTTP 401 / 403 during connect, handshake or `tools/list` was wrapped as `ConnectorUpstreamUnavailableError`, so the instance degraded and was retried as if the server were down. The `mcp` provider now tells it apart by the MCP SDK's own HTTP-transport error (`StreamableHTTPError` with status 401 / 403, or `UnauthorizedError`, anywhere in the `cause` chain) and throws it plain: fatal at boot, a skipped entry on reload, never retried. A JSON-RPC error that merely carries code 401 is not one, and every other connect / discovery failure keeps the retryable classification.

Migration: a `provider: 'mcp'` instance whose server rejects its credential now fails boot with `connector-mcp provider: connector 'NAME' was refused by its MCP server (HTTP 401): … This is a configuration fault and is not retried …` instead of booting degraded. FROM a missing, wrong or under-scoped credential (instance `auth` or `providerConfig.transport.headers`) TO a credential the server accepts; nothing else changes.
