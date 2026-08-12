---
"@objectstack/mcp": patch
---

fix(mcp): the stdio MCP transport answers again — resume the stdin it just took ownership of (#7645)

`objectstack serve` with `OS_MCP_STDIO_ENABLED=true` logged
`[MCP] Server started (transport: stdio)`, bound the transport to a real `osk_`
identity — and then **never answered a single request**. `initialize`,
`tools/list`, `resources/list` and `resources/read` all timed out with **zero
bytes on stdout**; malformed input drew no error either. Every stdio MCP session
against the CLI was unusable, and the failure was silent on both sides: the
server looked started, the client just waited.

The pause came from the **host**, above the plugin. oclif's argument parser
reads stdin for any positional argument the caller did not supply (`tryStdin` →
`createInterface({input: process.stdin})`, aborted after 10 ms), and
`Interface.close()` calls `stdin.pause()`. `serve` declares an optional `config`
positional, so plain `objectstack serve --dev` left `process.stdin` explicitly
paused before the kernel ever booted. `StdioServerTransport.start()` only
attaches a `data` listener, and Node auto-switches a stream to flowing mode on
that listener **only while `readableFlowing` is still `null`** — never after an
explicit `pause()`. Listener attached, `bytesRead` stuck at 0, transport deaf.

`MCPServerRuntime.start()` now resumes `process.stdin` immediately after
`connect()`, which is the moment the transport takes ownership of it (after, so
the transport's reader is attached before any byte can flow). The resume lives
in the runtime rather than in the CLI's argument definitions because the pause
is not oclif-specific: any host that touched stdin before `start()` — a readline
prompt, a supervisor, an embedding process — left the transport equally deaf,
and this is the one place that knows a long-lived stdio transport was just
attached.

Measured, both directions: `objectstack serve --dev` (no config path, parser
reads stdin) went from timing out to answering `initialize`, while `objectstack
serve objectstack.config.ts --dev` (parser never touches stdin) answered before
and after. The HTTP transport at `/api/v1/mcp` is unaffected — it is served
per-request and never touches stdin.

Not changed, and deliberately so: the ADR-0101 fail-closed startup contract.
stdio enabled without `OS_MCP_STDIO_API_KEY` still throws at plugin start, an
unknown/revoked key still refuses with no anonymous-but-serving fallback, and a
member key still binds the principal to that member.
