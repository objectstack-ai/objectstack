---
'@objectstack/mcp': patch
---

fix(mcp): the MCP doors write their 5xx fault lines through the host's logger

Clause-②: yes (widening)
Metadata-protocol: none

The `/mcp` and stdio doors log a tool's or the record resource's server fault once, for the operator: through `logServerFault` (`@objectstack/types`) for the data and metadata tools, `list_actions` and the record resource, and as the actions door's operator lines for `run_action` and `resume_run`. They wrote those lines to the console, outside the host's log sink. `MCPServerRuntime` now hands its configured logger to them, and `MCPServerPlugin` builds the runtime with the kernel's logger. So the host's logger handles the line, with its configured `redact` list, which replaces the default words (`password`, `token`, `secret`, `key`) rather than adding to them. Object members of a cause are redacted by field name.

`RegisterObjectToolsOptions` and `RegisterActionToolsOptions` gain an optional `logger`. A runtime or a direct `registerObjectTools` / `registerActionTools` caller with no logger keeps the console fallback. The answer a client reads is unchanged byte for byte.
