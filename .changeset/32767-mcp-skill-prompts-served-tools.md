---
'@objectstack/mcp': patch
---

fix(mcp)!: the HTTP MCP door offers a skill as a prompt only when the connection serves every tool the skill binds

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `SkillSchema.tools` keeps its shape and meaning. What moves is which skills one MCP connection's `prompts/list` answers, a per-request read of stored skills that nothing at rest records, so there is nothing for a migration to rewrite. -->

A skill's `instructions` teach the model to call the tools the skill binds (`SkillSchema.tools`). Over Streamable HTTP, `prompts/list` listed every skill that carries instructions, whatever the connection could call: a `data:read` token was offered `metadata_authoring` and other authoring skills whose tools its own `tools/list` never lists, so the client's model was handed playbooks it could not run.

Now `prompts/list` and `prompts/get` offer a skill only when this connection's tool list serves every tool in its binding:

- A plain name is served when `tools/list` lists it. A trailing wildcard (`describe_*`) is served when any listed tool matches it.
- An `action_<name>` entry (and `action_*`) is served when `run_action` is listed: the MCP server serves AI-exposed actions through `list_actions` / `run_action`, never as `action_<name>` tools.
- A skill that binds no tool is offered as before.
- `prompts/get` answers a withheld skill exactly as it answers a name no skill derives (`-32602`, `Prompt "NAME" not found`).

**BREAKING** narrowing of the HTTP prompt surface (`@objectstack/mcp`): a connection whose grant does not register a skill's bound tools no longer lists or gets that skill. A connection that serves every bound tool (for example a token granting `data:read`, `data:write`, `actions:execute` and `metadata:write` with the host's authoring family injected) lists the same skills as before. The stdio transport is unchanged.

**The remedy.** Connect with a grant that registers the skill's tools, or bind the skill only to tools its intended connections serve. A host that filtered prompts in a proxy of its own can drop that proxy.
