---
'@objectstack/spec': minor
'@objectstack/cli': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(spec)!: retire an agent's `model.provider` — no runtime read it; the deployment's AI settings choose the provider

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37796

<!-- adr-0087: registered agent-model-provider-removed, agent-model-provider-retired -->

**BREAKING** key removal on `AIModelConfigSchema` (`@objectstack/spec/ai`), an agent's `model` block. The key declared which provider served the agent, from an enum of `openai`, `azure_openai`, `anthropic` and `local`, and no runtime ever read it: the AI runtime that executes agents applies the model name, `temperature` and `maxTokens` from the block and nothing else, so an agent that declared `anthropic` ran on whatever provider the deployment served. The providers a deployment can turn on are its own AI settings, a list the enum neither matched nor could follow.

| FROM | TO |
|:--|:--|
| `model: { provider: 'anthropic', model: 'claude-sonnet-4' }` | `model: { model: 'claude-sonnet-4' }` — the deployment resolves the name among the providers it has turned on |
| `model: { provider: 'openai' }` (a provider and no model name) | `model: {}` or no `model` block — the agent runs on the deployment's default model — or name a model the deployment offers |

The one-line fix: delete `provider` from every agent's `model` block; `os migrate meta --from 18 --write` deletes it from agent sources. Writing it after upgrade fails `tsc` (the input type is `never`) and fails the parse with that prescription. `provider: 'openai'`, the default every released 18.x toolchain wrote into a parsed agent's `model` block, is accepted as inert residue and stripped, so agents built and stored by 18.x keep loading. The model name, `temperature`, `maxTokens` and `topP` are unchanged.

The retirement kit:

- **`@objectstack/spec`**: `provider` is a `retiredKey()` tombstone on `AIModelConfigSchema`, and the 18.x emitted default is stripped by `acceptRetiredDefaultResidue`. The D2 conversion `agent-model-provider-removed` (lossless, retired from the load path) deletes the key from `agents[]` on every data-at-rest seam (stored rows, built artifacts, `os migrate meta`); the D3 entry `agent-model-provider-retired` names what the upgrade still owes: whether an agent whose author wrote a provider should now name a model the deployment offers or run on its default model. The key is registered in `RETIRED_KEYS_BY_MAJOR[19]`. The liveness ledger's `model` row records the removal. The agent form's model help text no longer names a provider.
- **`@objectstack/platform-objects`**: the agent form's regenerated help-text labels.
- **`@object-ui/app-shell`**: the agent metadata preview shows the model name alone and never a provider pill.
- **`@object-ui/console`**: the agent preview sample no longer writes `provider`.
- **`@objectstack/cli`**: `os explain agent` describes the `model` block without `provider`, and its example drops it.
