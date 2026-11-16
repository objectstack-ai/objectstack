---
'@objectstack/spec': minor
'@objectstack/mcp': minor
---

feat(spec, mcp): a skill written for the in-product agents only opts out of MCP prompt projection with `mcpPrompt: false`

Clause-②: yes (widening)
Metadata-protocol: added

`SkillSchema` gains an optional boolean, `mcpPrompt`. A skill that sets `mcpPrompt: false` is never offered as an MCP prompt: `prompts/list` leaves it out and `prompts/get` answers it exactly as it answers an unknown prompt name. This holds on every MCP connection, the per-request HTTP endpoint and the long-lived stdio server alike, and whatever the skill's `tools` binding, including on a connection that serves every tool it binds.

The binding test (a skill is offered only where the connection serves every tool it binds) answers whether a connection can run a playbook. It cannot tell whether the playbook is written for MCP. A skill can bind tools MCP serves under the same names, such as `create_record` and `update_record`, or `action_*` through `run_action`, and still tell the model to call in-product tools and wait for the in-product approval card, which an MCP client does not have. The skill's owner now says so on the skill.

The stdio server takes its prompt list once, at boot. A skill saved with `mcpPrompt: false` while it runs stays on that list until restart, as any skill saved after boot is missing from it, but its `prompts/get` answers it as unknown at once.

A skill without the key, or with `mcpPrompt: true`, is offered exactly as before, and nothing parses differently: the key has no default. The key changes nothing on the in-product agent runtime, which resolves, binds and activates the skill as it did, and the authoring checks on `tools` and `surface` report the same findings. The skill form does not offer the key: unset means offered, and the form's boolean switch would draw every offered skill as off, so `mcpPrompt` is authored in source or through the metadata API.

Nothing to migrate.
