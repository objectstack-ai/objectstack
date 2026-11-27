---
'@objectstack/skills': patch
---

docs(skills): the context-pack rule table lists `ai-context-field-unprovisioned`; one source citation and one eval case corrected

Clause-②: no (published prose and an eval fixture only)
Metadata-protocol: none

`skills/objectstack-ai/references/context-packs.md` lists the `os validate` warning `ai-context-field-unprovisioned` (an injected column with no storage on an `external` object) in its rule table. The file sat at zero token headroom, so the row is paid for in the same file: two sample fields leave each `fields` list of the example, and three sentences are tightened with no fact removed. `skills/objectstack-ai/SKILL.md` cites the trigger-condition blocks of `packages/spec/src/ai/skill.zod.ts` at the lines they sit on (`38-52, 140-203`). Eval case 12 of `skills-tools-knowledge.json` no longer requires the literals `get_record_context` and `recordId`: its reference answer admits a wildcard tool binding and a skill file with no prose on the MCP argument, and both were graded as failures.
