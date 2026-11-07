---
'@objectstack/mcp': patch
---

feat(mcp): a host passes per-request server instructions on `McpAuthoringInjection`, answered at `initialize` only where the authoring family registers

Clause-②: yes
Metadata-protocol: none

`McpAuthoringInjection` gains an optional `instructions` string. `MCPServerRuntime.handleHttpRequest` answers `initialize` with it when the request's grant registers the injected authoring family (a scope list naming `metadata:write`, the same predicate that admits the registry). Every other request — a `data:read`, `data:write` or `actions:execute` token, an API key or a session — is answered with the runtime's configured `instructions`, or the default sentence, and never sees the injected text; an authoring request whose injection carries no `instructions` gets the configured or default text too. A host that serves a build door can now tell the MCP client where its authoring rules live without widening what a read-only connection is told. Nothing existing changes: a host that passes no `instructions` answers exactly as before.
