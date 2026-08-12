---
'@objectstack/mcp': patch
---

Serve the object tools over the stdio MCP transport instead of only advertising them

The stdio MCP server advertised `capabilities.tools` in its `initialize` result and then answered `-32601 Method not found` to every `tools/list` and `tools/call`, so an MCP client that connected successfully could not query or mutate a single object. The same process answered the same requests correctly over HTTP (`POST /api/v1/mcp`), which is what made the cause visible: `registerObjectTools` / `registerActionTools` were reachable only from `handleHttpRequest()`'s throwaway per-request server, and the long-lived server behind stdio received only the AI service's function-calling `ToolRegistry` — a different surface, empty on any app that registers no AI tools.

Both transports now register through one composition (`wireBridgeTools`), and the stdio host builds a principal-bound data bridge from the `OS_MCP_STDIO_API_KEY` identity, re-resolved per call so a revoked key stops working on the next tool call (ADR-0101 D1). Permissions, RLS and FLS apply exactly as they do to the same identity over REST.

The `tools`, `resources` and `prompts` capabilities are no longer hand-declared at construction: the MCP SDK declares each one when something is actually registered, so what a server advertises and what it serves can no longer disagree (ADR-0076 D12). A deployment with no principal to bind — or no metadata service — now advertises no tool capability instead of advertising an empty one, and says so in the boot log.
