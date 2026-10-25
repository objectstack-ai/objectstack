---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

fix(mcp)!: the stateless `/api/v1/mcp` surface answers `GET` and `DELETE` with `405` and `Allow: POST`, so an MCP client stops re-opening a GET stream that ends at once

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A transport verb answer on the MCP HTTP surface: no key of any metadata schema is removed, renamed or re-shaped, no export, type or error code is removed or renamed, and the 405 body is the MCP SDK transport's own. There is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the MCP HTTP transport (`MCPServerRuntime.handleHttpRequest`, `@objectstack/mcp`), and on the standalone server's `/api/v1/mcp` route (`createDispatcherPlugin`, `@objectstack/runtime`).

- **Before.** The transport is stateless (no session id) and closes its per-request server when the request ends. A `GET` still reached the SDK's stream handler, which answered `200 text/event-stream` and then lost the stream when the server closed. An MCP client reads a GET stream that ends as a dropped connection and opens another one: claude-code re-opened it 2–3 times a second for as long as a session stayed connected. A `DELETE` answered `200` and ended nothing, because no session exists. Every other verb answered `405` with `Allow: GET, POST, DELETE`.
- **Now.** Every verb but `POST` answers `405` with `Allow: POST` and the JSON-RPC body `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}`, before a server is built. This is the Streamable HTTP transport's answer for a server that offers no GET stream and does not end sessions. The MCP SDK client treats a `405` on GET as "no stream offered" and does not retry it.
- **The standalone server.** `createDispatcherPlugin` mounts `/api/v1/mcp` for `GET`, `POST` and `DELETE`, and now also declares it a path whose domain decides every verb (the declaration `/mcp/skill` and `/keys` already carry). Before, a `PUT`, a `PATCH` or an `OPTIONS` with CORS off matched no route there and the HTTP adapter answered it itself: `405` with `Allow: DELETE, GET, HEAD, POST` and a `METHOD_NOT_ALLOWED` envelope, to an anonymous caller too. Now those verbs reach the dispatcher like the mounted ones: an anonymous caller gets `401`, a signed-in one the transport's `405` with `Allow: POST`. A `createHonoApp` host already handed every verb to the dispatcher, so both doors now answer every verb alike.
- **Unchanged.** `POST` (JSON-RPC: `initialize`, `tools/list`, `tools/call`, …) answers exactly as before. An anonymous caller is refused `401` before any verb answer, on every verb and on both doors.
- **Who sees it.** A client that opens the GET stream on `/api/v1/mcp` now gets `405` instead of a `200` stream that ends at once. Nothing was ever sent on that stream. On the standalone server, an anonymous `PUT`, `PATCH` or `OPTIONS` on `/api/v1/mcp` now gets `401` instead of `405`.

**The remedy.** None needed for an MCP client: it stops opening the stream. A probe or health check that read `GET /api/v1/mcp` as `200` should send a `POST initialize` instead.
