---
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

The open MCP door's default `initialize` instructions now say where the usage guide is served: a `GET` on the MCP endpoint's path plus `/skill` (by default `/api/v1/mcp/skill`) returns the `SKILL.md` that carries the teaching text the tool descriptions no longer hold. A host's own instructions and a configured `instructions` text are unchanged. `run_action`'s description again says what a `no_confirmation_service` refusal leaves the caller: a person performs the action in the app, and the agent does not make the same change with another tool.
