---
"@objectstack/spec": patch
---

docs(ai): stop `tool.requiresConfirmation` promising a gate it does not provide (#3715)

The flag is read by **no execution path** — not the LLM tool set, not
`ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, not the MCP bridge.
Yet the authoring surface actively taught reliance on it: the Studio form
section was titled *"Access & safety"* with helpText *"Ask user to approve
before executing (for destructive actions)"*, and the AI skill doc, MCP guide
and spec README all recommended it for destructive operations.

The prune-or-wire decision is deliberately **deferred** (#3715 — the field's
shape is likely needed once side-effect tools exist, which `ToolCategory`
already anticipates with `action` / `integration` / `flow`). What changes now
is only the promise:

- spec `.describe()` carries `[EXPERIMENTAL — not enforced]` + a pointer to the
  real gate;
- the form section is renamed *"Declarative metadata (not enforced)"* and both
  its fields (this and the already-dead `permissions`) say so, with the enforced
  alternative spelled out;
- `skills/objectstack-ai/SKILL.md`, `MCP_GUIDE.md` and `README.md` now point at
  the action-level `ai.requiresConfirmation` + approval queue (and note that AI
  metadata edits are already gated by draft/publish, ADR-0033).

No behaviour change: nothing read the flag before and nothing reads it now.
