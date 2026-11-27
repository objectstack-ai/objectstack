---
'@objectstack/spec': minor
'@object-ui/app-shell': patch
---

feat(spec): an agent's model name is optional — absent means the host's default model for the environment; `provider` no longer defaults to `openai`

Clause-②: yes (widening)
Metadata-protocol: semantic
Skills-docs: follow-up #37711

`AIModelConfigSchema.model` (the `model` key inside an agent's `model` block) is now optional. An agent that only tunes sampling can write `model: { temperature: 0.2 }` without naming a model; the host then runs it on its default model for the environment. Before, the block refused a missing `model`, so such an agent had to invent a model name it did not mean.

`AIModelConfigSchema.provider` loses its `openai` default. A block that names no model also names no provider, so the parse no longer stamps `provider: 'openai'` onto it — that would assert a provider for a model the host picks. The key and its enum are unchanged, and a written `provider` is carried as written. No runtime reads an agent's `model.provider`, so no deployed agent changes behaviour; what changes is the parsed value.

Unchanged: an explicit `model: { model: 'gpt-4o' }` parses and is carried as written; the block is still strict, so an unknown key is refused; `temperature` still defaults to `0.7`. There is no sentinel value and no tier key.

`@object-ui/app-shell`: the agent preview's model pill appears when the block names a model or a provider, and reads `PROVIDER · MODEL`, `MODEL` or `PROVIDER` from what is written. Before, it keyed on `provider` alone, so a block that named only a model showed no model at all.

What to do: nothing for existing agents. Code that reads `agent.model.model` gets `string | undefined` from the `Agent` type and treats `undefined` as "use the host's default model". Code that read `model.provider` from a parsed agent and relied on `openai` when the author wrote none now reads `undefined`; to keep `openai`, write `provider: 'openai'` in the agent.
