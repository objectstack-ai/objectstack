---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

fix(lint): `ai-skill-tool-unresolved` resolves every tool the MCP door registers for a skill offered over MCP, and says why when a skill kept out of MCP names one

Clause-②: yes (widening) — `ai-skill-tool-unresolved` stops warning on eight tool names the MCP door registers, and `@objectstack/spec/system` gains the export `MCP_DOOR_TOOL_NAMES`; nothing that resolved before is reported
Metadata-protocol: none

The MCP door in `@objectstack/mcp` registers record, file, action, federation and dataset tools, and offers a skill bound to them over MCP. The lint rule knew only the two file tools, so a skill bound to `aggregate_records`, `delete_record`, `delete_records`, `list_actions`, `run_action`, `resume_run`, `list_remote_tables` or `import_object` was warned that the agent cannot call it, and `os lint --strict` failed.

`@objectstack/spec/system` now exports `MCP_DOOR_TOOL_NAMES`, every tool the door registers on a bridge carrying every optional member under a grant naming every scope. For a skill offered over MCP (`mcpPrompt` not `false`), the rule resolves every name in it. `@objectstack/mcp` has a test that keeps this list equal to what the door registers, so a tool added to or renamed at the door fails there until the list follows it. Some door names (`get_record`, `query_records`, `describe_object`, …) are cloud registrations as well and stay in `PLATFORM_PROVIDED_TOOL_NAMES`; the door's names do not join `PLATFORM_TOOLS_BY_PACKAGE`, so each group there stays the exact set one cloud package registers. `MCP_FILE_TOOL_NAMES` stays as it was and is part of the new list.

A skill kept out of MCP (`mcpPrompt: false`) runs only in the in-product agents, which do not have the door tools no cloud package registers, so naming one there is still reported. The warning now says so: "Tool "run_action" resolves only for a skill offered over MCP, and this skill sets `mcpPrompt: false`, so the in-product agents it runs in have no such tool". The fix line offers dropping `mcpPrompt: false` or removing the name. A trailing-wildcard entry that matches only door tools gets the same verdict.

`os explain ai-skill-tool-unresolved` names `MCP_DOOR_TOOL_NAMES` as the third source and adds that a skill which runs an app action binds `action_<name>` (or `action_*`) rather than `run_action`: the MCP door serves that entry through `run_action`, and the in-product agents call the action tool itself.
