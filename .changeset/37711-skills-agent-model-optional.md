---
'@objectstack/skills': patch
---

docs(skills): an agent's model name and provider are optional

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md` (Model Configuration) now teaches that `model.model` is optional, and that an agent without one runs on the host's default model for the environment, and that `model.provider` is optional with no default (the deployment's choice) instead of defaulting to `openai`. The inline enum list is unchanged, and the schema citation now points at `packages/spec/src/ai/agent.zod.ts:37-45`. The `objectstack-ai` eval case on sampling settings accepts an omitted `model` and states the provider has no default. Published prose only: it teaches the optional `model` / `provider` already on main since #37697. The file sat at zero token headroom, so the words are paid for by tightening the same section; no fact is removed.
