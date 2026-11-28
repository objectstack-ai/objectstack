---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs: the retired agent keys are refused as unknown keys, not tombstones

Clause-②: no
Metadata-protocol: none

`agent.tools` and `agent.knowledge` were removed in protocol 17, and their tombstones left the shape at protocol 18. Since then the strict `AgentSchema` refuses each as an unknown key, and the refusal names https://objectstack.ai/docs/protocol-upgrade. Three texts still described the older behaviour and now say what happens today:

- **`@objectstack/skills`.** In the `objectstack-ai` skill's `skills-tools-knowledge` evals, case 5's `expected_output` no longer calls the two keys protocol-17 tombstones. The case's prompt and assertions are unchanged.
- **`@objectstack/spec`.** The comment in `src/ai/agent.zod.ts` on the removed `AIKnowledgeSchema` no longer says `agent.knowledge` is tombstoned below it. No schema, type or export changes.

The `ai/agents` docs page says the same in its `tools` and `knowledge` rows: the key is not on the type, so there is no `never` member for `tsc` to refuse by name. Nothing to migrate.
