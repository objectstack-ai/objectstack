---
'@objectstack/spec': minor
'@objectstack/mcp': minor
'@objectstack/lint': minor
'@objectstack/runtime': minor
'@objectstack/platform-objects': minor
---

feat(ai): a skill names the context pack it works from (`context`), and its MCP prompt takes a record id

Clause-②: yes (widening)
Metadata-protocol: added

ADR-0160 D8. A skill can now name a context pack (`ai_context`) by its bare name:

```ts
defineSkill({
  name: 'policy_inquiry',
  label: 'Policy inquiry',
  instructions: 'Answer the question about this policy, citing its sections.',
  tools: ['get_record_context'],
  context: 'policy_document',
});
```

- **`@objectstack/spec`.** `SkillSchema.context?: string` (snake_case, the pack's machine name; a face such as `NS-NAME` is refused). A skill that declares it must bind `get_record_context` in `tools`, by name or by a wildcard that matches it (`get_record*`, `get_*`); without the binding it is refused at parse, located on `tools`. `skillBindsRecordContextTool(tools)` answers that binding. The skill form gains a `context` control.
- **`@objectstack/mcp`.** When a skill's `context` resolves to a pack, its prompt lists one optional argument, `recordId`. The name resolves by ADR-0150 D3 from the skill's own package (its own pack, else the one holder in its dependency closure), or as for a caller with no package for an environment skill; a name that resolves to no pack adds no argument. Given a record id, the prompt's one message is the skill's instructions, one fixed line telling the model to call `get_record_context` with the arguments that follow, and those arguments as one JSON object: `objectName` (the pack's root), `recordId`, and `context` (the pack's face). The record id only ever appears as that JSON string value, and the pack is never inlined. Without the argument the prompt is byte-identical to the same skill's prompt without `context`. A blank record id is refused (`-32602`). Both the per-request HTTP prompt surface and the long-lived stdio server serve it. `McpSkillBridge` gains two optional members, `listContextPacks` and `packageResolutionClosure`; `MCPServerRuntime.bridgePrompts` takes the closure as an optional fourth argument.
- **`@objectstack/lint`.** Two warnings where skills are validated (`os validate`): `ai-skill-context-unknown`, for a `context` that names no pack the stack defines, and `ai-skill-context-omitted`, for a skill that binds `get_record_context` without `context` while an object has more than one pack (its call there without a pack name is refused).
- **`@objectstack/runtime`.** The `/mcp` route's bridge hands the skill prompt surface the same pack listing `get_record_context` selects from, and the skill's package closure.
- **`@objectstack/platform-objects`.** The generated metadata-form translation bundles carry the skill form's new `context` control (label and help text; translated locales take the source text until translated).
