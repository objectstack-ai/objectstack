---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-ai` skill names what replaces the two retired agent keys

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md`: the `agent.tools` tombstone row now says where the tools go (a `defineSkill` under the stack's `skills`), and the `agent.knowledge` row names the two keys that restrict retrieval on the knowledge source (`aiExposed`, `source.where`). The words are paid for in the same file: the skill example loses one sample instruction line. No fact is removed.
