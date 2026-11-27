---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-ai` skill describes the refusal the two retired agent keys get today

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md`: the paragraph above the retired-key table called `agent.tools` and `agent.knowledge` tombstones whose parse error carries its migration, and cited two line numbers of `agent.zod.ts` that no longer point at either key. Both tombstones left the schema in protocol 18. The paragraph now says what the strict `AgentSchema` does: it refuses each as an unknown key, and the refusal names https://objectstack.ai/docs/protocol-upgrade. The table header says the same in short. In the `agent.tools` row, the clause that said a migration deletes the key and names each listed tool now says the strict schema refuses the key as unknown: the conversion that did that left the load path in 17.0.0. The replacements both rows teach are unchanged, and the file is 4 tokens shorter.
