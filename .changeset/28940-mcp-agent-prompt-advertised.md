---
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

The stdio MCP server lists `agent_prompt` only on a boot that registers at least one agent. A boot with no agent, which is every open-framework boot, used to list it anyway. Its `agentName` argument suggested `"ask"` and `"build"`, and every `prompts/get` came back as a successful prompt whose one message read `Error: Agent "ask" not found`, which an MCP client passes to its model as instructions. On such a boot the prompt is now left out of `prompts/list`, a get on it is the protocol's own unknown-prompt error, and the boot log says once why. On a boot with agents nothing changes for a client: the prompt is listed, its argument suggests names the boot actually holds, and a miss still answers `Error: Agent "X" not found`. If the agent metadata cannot be fully read at boot, the prompt stays listed, because an outage is not proof that no agent exists. Its argument then suggests no names.
