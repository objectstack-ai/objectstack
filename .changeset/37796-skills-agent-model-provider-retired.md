---
'@objectstack/skills': patch
---

docs(skills): the AI skill stops teaching an agent's `model.provider`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md` (Model Configuration) drops the `provider` row from the agent model table. The section now says the `model` block names a model and never a provider: the deployment's AI settings choose the provider and resolve the model name among the providers turned on, and a written `provider` is a parse error whose fix is to delete the key (retired in protocol 19, conversion `agent-model-provider-removed`). The schema citation moves to `packages/spec/src/ai/agent.zod.ts:87-95`, the key list after the retirement.

The `objectstack-ai` eval case on sampling settings keeps its prompt (a copilot that should use Anthropic at temperature 0.3 with a 2000-token cap) and now expects the answer to write no provider key: sampling goes under `model`, the model is named in the free-string `model` or left to the host's default, and turning a provider on is the deployment's AI settings. Its assertions no longer require `provider` and `anthropic`; they require `deployment` and refuse `provider:`.

Published prose only: it teaches the retirement already on main. The file sat at zero token headroom, so the new sentences are paid for by the deleted row and no ceiling moves.
