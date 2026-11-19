---
'@objectstack/skills': patch
---

docs(skills): objectstack-ai teaches that an AI-gated action guards its own door only, and pairs an irreversible transition with a lock on the field it changes; the tool-name ladder names its fourth source and the MCP prompts paragraph names `mcpPrompt`

Clause-②: no
Metadata-protocol: none

objectstack-ai's Common Pitfalls gains "Gating the action, not the state". `ai.requiresConfirmation` guards the action's door, and an agent can still write the same field with `update_record` or any data write. An irreversible transition is a gated `script` action, whose body writes elevated, over a field a non-system write cannot set: `readonly: true` (the value is stripped) or field permissions that leave the caller no `editable` on it (refused `403`). A declarative `operation: 'update'` action and a `flow` action under `runAs: 'user'` write as the caller, so the lock stops them too. `readonlyWhen` and a `state_machine` rule bind the elevated body as well, so neither is the door; a `state_machine` dead-end still makes the reached state final for every writer. objectstack-automation's `references/state-machines-and-approvals.md` points to it.

The resolution ladder for `skill.tools[]` names four sources: the fourth is `MCP_FILE_TOOL_NAMES`, the MCP door's file tools, resolved only for a skill MCP can offer (`mcpPrompt` not `false`).

The paragraph on which skills MCP offers as prompts names `mcpPrompt`: `false` keeps a skill for the in-product agents only, never offered over MCP on any connection whatever its binding, and the stdio transport withholds it too; absent or `true` keeps the binding rule.
