---
'@objectstack/mcp': patch
---

fix(mcp): a tools/call for a name no tool is registered under reaches the tool-call interceptor, answered as before

Clause-②: yes (widening) — the tool-call interceptor contract gains the unregistered case: `McpToolCallContext` gains an optional `registered?: false` member, and an installed interceptor is now also told, once, of a `tools/call` naming a tool the server holds none of. Nothing is narrowed: every answer a client gets is unchanged, and a call to a registered tool is told exactly as before.
Metadata-protocol: none

Before, the MCP SDK answered a `tools/call` for an unregistered name by itself (`Tool NAME not found`) before the seam every MCP tool call passes through, so a host could not record it: a read-only (`data:read`) token calling `create_record` left no trace.

- **What the interceptor is told.** The door, the transport, the requested name, the principal the host admitted the caller as, `registered: false`, and an empty frozen `arguments` (the client's arguments were validated against no schema, so none reach the host). `next()` resolves to a frozen copy of the SDK's own answer.
- **Observation only.** No tool handler runs. The client gets the SDK's own `not found` answer byte for byte, whatever the interceptor returns: a deny or a replacement is not served, and an interceptor that throws or rejects is logged once (the tool name and the failure's kind, never the call's arguments) and the call is answered as before.
- **Registered or not** is read from the SDK's registry at each call, so a tool removed after it registered is told as unregistered.
- **Nothing installed, nothing changed.** With no interceptor, the call goes to the SDK untouched and no principal is resolved.
