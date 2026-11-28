---
'@objectstack/mcp': patch
---

fix(mcp): a tool argument that fails the published JSON Schema is refused with the platform's coded refusal

Clause-②: no
Metadata-protocol: none

On both MCP doors (Streamable HTTP and stdio), a `tools/call` whose arguments fail the tool's published JSON Schema used to come back as the SDK's own text, `MCP error -32602: Input validation error: …`, with no `code` and no `status`, and with every unknown key echoed exactly as sent (a raw newline or NUL included, however many there were).

It now answers the same coded tool error every other refusal on these doors answers: `isError: true`, one text content holding `{ "error": { "code": "VALIDATION_ERROR", "status": 400, "message": "Invalid arguments for tool NAME: …" } }`. The message still names each problem at its path, and an unknown key's rename advice (`sort` → `orderBy`) is kept. The keys are echoed bounded and sanitised: at most five unknown keys per object are named and the rest are counted, each key is cut at 64 characters, and every control character is written as its escape. A client that matched the `-32602` text should branch on `error.code` instead.
