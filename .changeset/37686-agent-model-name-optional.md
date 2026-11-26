---
'@objectstack/spec': minor
---

feat(spec): an agent's model name is optional — absent means the host's default model for the environment

Clause-②: no
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-ai/SKILL.md, skills/objectstack-ai/evals/skills-tools-knowledge.json

`AIModelConfigSchema.model` (the `model` key inside an agent's `model` block) is now optional. An agent that only tunes sampling can write `model: { temperature: 0.2 }` without naming a model; the host then runs it on its default model for the environment. Before, the block refused a missing `model`, so such an agent had to invent a model name it did not mean.

Unchanged: an explicit `model: { model: 'gpt-4o' }` parses and is carried as written; the block is still strict, so an unknown key is refused; `provider` still defaults to `openai` and `temperature` to `0.7`. There is no sentinel value and no tier key.

What to do: nothing for existing agents. Code that reads `agent.model.model` gets `string | undefined` from the `Agent` type now and treats `undefined` as "use the host's default model".
