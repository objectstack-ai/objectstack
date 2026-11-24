---
"@objectstack/types": patch
"@objectstack/runtime": patch
"@objectstack/mcp": patch
---

Clause-②: no
Metadata-protocol: none

An MCP definition reader now says when an admin has switched a flow off. The open authoring door's `get_metadata_item` answers a flow with `runtimeState: { enabled }`, the engine's own reading (the one `GET /automation/_status` serves), placed ahead of the item; the switch moves only that bit and leaves the definition, `status: 'active'` included, as it was, so before this a switched-off approval read as running. The app-docs answer-order text sent on `initialize` (`packageDocAnswerRule`) now tells the agent that `runtimeState.enabled: false` means the process is switched off and does not run. `@objectstack/types` exports the key and the reading (`FLOW_RUNTIME_STATE_KEY`, `flowRuntimeStateOf`) for a host's own reader.
