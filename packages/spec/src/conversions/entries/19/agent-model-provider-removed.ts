// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * An agent's model provider — `agent.model.provider` — leaves the spec
 * (protocol 19, #37712; ADR-0049 enforce-or-remove).
 *
 * The key declared which provider served the agent, from an enum of `openai`,
 * `azure_openai`, `anthropic` and `local`. No runtime ever read it: cloud's AI
 * service, the one runtime that executes agents, applies the model name,
 * `temperature` and `maxTokens` from the `model` block and nothing else, and
 * the providers a deployment can turn on are its own AI settings. So no
 * authored value ever chose a provider, and the delete is LOSSLESS: authoring
 * now refuses the key by name (`retiredKey`, ai/agent.zod.ts).
 *
 * One edit: the key is deleted from `model`, whatever it holds — one of the
 * four enum values, or anything else. Every other key of the block stays, and
 * a block left empty stays as an empty block (an empty `model` block parses:
 * every key in it is optional or defaulted). One notice per agent that
 * carried it.
 *
 * Idempotent by construction: `stripKeys` skips an absent key and hands the
 * input back by reference. Retired from the load path: an author is refused at
 * parse with the prescription; data at rest (`applyConversionsToStoredItem`),
 * built artifacts and `os migrate meta` replay it.
 */
const agentModelProviderRemoved: MetadataConversion = {
  id: 'agent-model-provider-removed',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'agent.model.provider',
  summary:
    "agent model key 'provider' removed: no runtime ever read it — the provider that serves an agent is "
    + "chosen by the deployment's AI settings, never by the agent. The key is deleted; the model name, "
    + 'temperature and every other model key stay',
  apply(stack, emit) {
    return mapCollection(stack, 'agents', (agent, path) => {
      const model = agent.model;
      if (!isDict(model)) return agent;
      const next = stripKeys(model, ['provider'], emit, `${path}.model`);
      return next === model ? agent : { ...agent, model: next };
    });
  },
  fixture: {
    before: {
      agents: [
        {
          // The old default, as a released toolchain materialized it into a
          // parsed agent whose author never wrote `provider`.
          name: 'support_agent',
          label: 'Support',
          model: { provider: 'openai', model: 'gpt-4o', temperature: 0.2 },
        },
        {
          // An explicit choice the runtime never honoured: deleted all the
          // same — the provider is the deployment's.
          name: 'review_agent',
          label: 'Review',
          model: { provider: 'anthropic', model: 'claude-sonnet-4', maxTokens: 2000 },
        },
        {
          // The provider alone: the block stays, empty.
          name: 'local_agent',
          label: 'Local',
          model: { provider: 'local' },
        },
        {
          // Already canonical, and an agent with no model block at all: both
          // ride through untouched.
          name: 'tuned_agent',
          label: 'Tuned',
          model: { temperature: 0.3 },
        },
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    after: {
      agents: [
        { name: 'support_agent', label: 'Support', model: { model: 'gpt-4o', temperature: 0.2 } },
        { name: 'review_agent', label: 'Review', model: { model: 'claude-sonnet-4', maxTokens: 2000 } },
        { name: 'local_agent', label: 'Local', model: {} },
        { name: 'tuned_agent', label: 'Tuned', model: { temperature: 0.3 } },
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    // Three: one per agent whose `model` carried the key.
    expectedNotices: 3,
  },
};

export { agentModelProviderRemoved };
