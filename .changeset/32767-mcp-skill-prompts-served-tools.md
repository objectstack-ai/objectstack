---
'@objectstack/mcp': minor
---

fix(mcp)!: `registerSkillPrompts` offers a skill as a prompt only when the server it is installed on serves every tool the skill binds

Clause-②: no (narrowing)
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `SkillSchema.tools` keeps its shape. Its meaning on the MCP prompt surface changes (it now decides whether a skill's instructions are offered on a connection), but nothing at rest records which prompts a connection was offered, so there is nothing for a migration to rewrite. -->

A skill's `instructions` teach the model to call the tools the skill binds (`SkillSchema.tools`). `prompts/list` listed every skill that carries instructions, whatever the connection could call: on `MCPServerRuntime`'s Streamable HTTP door a `data:read` token was offered `metadata_authoring` and other authoring skills whose tools its own `tools/list` never lists, so the client's model was handed playbooks it could not run.

Now the exported `registerSkillPrompts(server, bridge)` offers a skill on `prompts/list` and `prompts/get` only when the server it is installed on lists every tool in the skill's binding, read from that server's own tool registry when the prompt request is answered:

- A plain name is served when the server lists a tool of that name. A trailing wildcard (`describe_*`) is served when any listed tool matches it.
- An `action_<name>` entry (and `action_*`) is also served when `run_action` is listed: the native MCP families serve AI-exposed actions through `list_actions` / `run_action`, never as `action_<name>` tools.
- A skill that binds no tool is offered as before.
- `prompts/get` answers a withheld skill exactly as it answers a name no skill derives (`-32602`, `Prompt "NAME" not found`).

**BREAKING** narrowing of the prompt surface `registerSkillPrompts` installs (`@objectstack/mcp`). It applies to every server it is installed on: `MCPServerRuntime`'s HTTP door, and any host that drives its own `McpServer` and calls `registerSkillPrompts` (stdio included, as in the package README), each narrowed by that server's own tool registry. A connection whose server does not list a skill's bound tools no longer lists or gets that skill; a skill binding a tool no MCP family serves (for example a `stack.tools` name nothing registers) is offered on no connection unless a host registers that tool. `MCPServerRuntime.bridgePrompts`, which projects skills onto the long-lived server without `registerSkillPrompts`, is unchanged. The `SkillSchema.tools` prose that still calls the binding inert in the open framework is corrected by follow-up #32885.

**The remedy.** Connect with a grant that registers the skill's tools, register the tools on your own server before it answers prompt requests, or bind the skill only to tools its intended connections serve. A host that filtered prompts in a proxy of its own can drop that proxy.
