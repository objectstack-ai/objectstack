// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #37712 — ADR-0049 enforce-or-remove — the D3 entry of the `agent.model.provider`
// retirement. The data half is mechanical (the D2 conversion
// `agent-model-provider-removed` deletes the key, losslessly); what it cannot do
// is the judgement this entry carries: an author who wrote a provider meant a
// model from it, and only the author can tell whether the deployment's default
// model or a named one is what the agent should run on.
export const entry: SemanticMigration = {
  id: 'agent-model-provider-retired',
  surface: 'agent.model.provider — left the shape (the provider is the deployment\'s choice); '
    + 'agent.model.model, temperature, maxTokens and topP are unchanged',
  replacement:
    'no provider key: delete `model.provider`, whatever it held. The provider that serves an agent is '
    + 'chosen by the deployment\'s AI settings. An agent that must run on a particular model names it in '
    + '`model.model`, which the deployment resolves among the providers it has turned on; an agent that '
    + 'names no model runs on the deployment\'s default model',
  reason:
    'ADR-0049 enforce-or-remove: `model.provider` was parsed and never read. The cloud AI runtime, the '
    + 'one runtime that executes agents, applies the model name, `temperature` and `maxTokens` from the '
    + '`model` block and nothing else, so an agent that declared `anthropic` ran on whatever provider the '
    + 'deployment served. The providers a deployment can turn on are its own AI settings, and the key\'s '
    + 'four values (`openai`, `azure_openai`, `anthropic`, `local`) neither matched that list nor could '
    + 'follow it. Authoring now refuses the key with a prescription, and TypeScript rejects it. The D2 '
    + 'conversion `agent-model-provider-removed` deletes it from existing sources and stored rows, '
    + 'losslessly: no value of it ever chose a provider. What no conversion can decide is whether an '
    + 'agent whose author wrote a provider, and no model name, should now name a model the deployment '
    + 'offers or run on its default model',
  acceptanceCriteria:
    'No agent declares `model.provider`; the key is refused at parse with its prescription, and '
    + 'TypeScript rejects it. Every agent that must run on a particular model names it in `model.model`, '
    + 'and that name is one of the models the target deployment\'s AI settings offer. Every agent parses '
    + 'under the new schema.',
  conversionIds: ['agent-model-provider-removed'],
  relevantWhen: { kind: 'stack-declares', keys: ['agents'] },
};
