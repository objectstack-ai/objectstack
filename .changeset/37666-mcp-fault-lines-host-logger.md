---
'@objectstack/mcp': patch
---

fix(mcp): the MCP doors write their 5xx fault lines through the host's logger

Clause-②: no
Metadata-protocol: none

The `/mcp` and stdio doors log a tool's or the record resource's server fault once, for the operator (`logServerFault`, `@objectstack/types`). They called it with no logger, so the line went to the console with only the default redact words (`password`, `token`, `secret`, `key`), outside the host's log sink. `MCPServerRuntime` now hands its configured logger to that line; `MCPServerPlugin` builds the runtime with the kernel's logger, so the line goes through the host's sink and the host's own redact words apply to it and to its cause chain.

`RegisterObjectToolsOptions` and `RegisterActionToolsOptions` gain an optional `logger`. A runtime or a direct `registerObjectTools` / `registerActionTools` caller with no logger keeps the console fallback. The answer a client reads is unchanged byte for byte.
