---
'@objectstack/spec': patch
'@objectstack/skills': patch
'@objectstack/mcp': patch
---

docs(spec,skills): `SkillSchema.tools` is described as what it now does on an MCP server, not as inert in the open framework

Clause-②: no
Metadata-protocol: none

Since 18.4.0 the prompt surface `registerSkillPrompts` (`@objectstack/mcp`) installs offers a skill on `prompts/list` and `prompts/get` only when the server it is installed on lists every tool the skill binds. The published texts still said the binding was authored for the cloud runtime and inert in the open framework, or that every skill with instructions is served to any connected client. They now state the rule; no schema, accept set or behaviour changes.

- **`@objectstack/spec`**: the `SkillSchema` class JSDoc, the `tools` JSDoc and its describe text (so the generated JSON Schema description and the skill reference page), plus one clause on the `instructions` JSDoc. `tools` is bound by the cloud agent runtime and read by MCP: a plain name is served by a tool of that name, a trailing wildcard by any listed tool it matches, and an `action_<name>` entry (or `action_*`) also by `run_action`. A skill that binds no tool is offered as before, and `prompts/get` answers a withheld skill as it answers a prompt name no skill derives. The rule reaches every server `registerSkillPrompts` is installed on, `MCPServerRuntime`'s HTTP door and a host's own `McpServer` alike, stdio included; `MCPServerRuntime.bridgePrompts`, which projects skills onto the long-lived server without it, applies no such filter. `surface` and `triggerConditions` stay cloud-runtime-only.
- **`@objectstack/skills`** (`objectstack-ai`): the built-in-skills note says the same, and the `instructions` row calls it the one field the open edition serves, since the open edition now reads `tools` as well.
- **`@objectstack/spec`**, liveness ledger (`liveness/skill.json`): the `tools` entry cites its in-repo reader, `skillBindingServed` in `packages/mcp/src/skill-prompts.ts`, beside the cloud readers, and its note no longer calls the key cloud-runtime-only.
- **`@objectstack/mcp`**: the README's Prompts section says which servers apply the rule. `bridgePrompts` lists every skill that carries instructions on the long-lived server; the HTTP door and any server a host installs `registerSkillPrompts` on offer a skill only when that server lists every tool it binds.
- The agents guide (`content/docs/ai/agents.mdx`) carries the rule under its two-halves table and advises binding a skill only to tools its intended connections serve. The MCP connection guide (`content/docs/ai/connect-mcp.mdx`) says a skill is offered only where its tools are: its example skill, bound to `query_records` and `action_resolve_case`, is not offered to a token without the `actions:execute` scope, which lists no `run_action`.
