---
'@objectstack/connector-mcp': minor
---

feat(connector-mcp): `providerConfig.toolsSnapshot` pins each tool of an `mcp` instance by name

Clause-②: yes (widening)
Metadata-protocol: added

An `mcp` instance's `include` decides which tools it exposes. Until now nothing noticed when the server rewrote one of them, for example a new description that steers an agent or an `inputSchema` that asks for more than it did. `providerConfig.toolsSnapshot` is a record of tool name → the sha256 of that tool's definition. It is keyed by tool name, like `include`, and the two compose.

- **The digest.** sha256, lowercase hex, of the UTF-8 canonical JSON of `{ name, description, inputSchema }` from the tool's `tools/list` entry. A member the server does not send is left out. Canonical JSON sorts object keys in UTF-16 code-unit order at every depth, keeps array order, writes primitives as `JSON.stringify` does and has no whitespace: the RFC 8785 (JCS) form for values read from JSON. `computeMcpToolsSnapshot(tools)` and `mcpToolDigest(tool)` are exported and are the functions the check uses.
- **The check.** On every materialization each pinned tool is hashed and compared on its own. A pinned tool served with a different description or `inputSchema`, or no longer served, degrades the instance. Its reason names each such tool and the digest the server now serves, and none of the instance's tools are exposed. The instance is re-checked on the retry backoff and recovers once the server serves the pinned definitions again. An edited pin re-materializes it at once. A pinned tool that `include` also lists is reported by the pin when the server stops serving it, not as an `include` typo.
- **Refused before connecting.** A `toolsSnapshot` that is not a record of tool name → 64 lowercase hex characters fails the boot, and so does a pin on a tool `include` leaves out, since that pin would never be checked.
- Without `toolsSnapshot`, an instance behaves exactly as before. A tool the pin does not name is not checked.
- `McpConnectorOptions.include` now also receives the tool's `tools/list` entry as a second argument. An existing one-argument predicate is unaffected.
