// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `agent-lifecycle-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `agentLifecycleRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * An agent's conversation state machine — `agent.lifecycle` — leaves the spec
 * (protocol 18, #21320; ADR-0049 enforce-or-remove, ruled D (retire) on
 * objectstack-ai/cloud#2569).
 *
 * It was parsed and never read: no runtime, in this repository or in cloud's
 * AI service (the one runtime that executes agents), moved an agent through a
 * declared state or refused an undeclared transition. So no authored value
 * ever changed what an agent did, and the delete is LOSSLESS. Authoring now
 * refuses the key by name (`retiredKey`, ai/agent.zod.ts). Its value schema,
 * the XState `StateMachineSchema` family, had no other authorable door and
 * left the package with it.
 *
 * One edit: the key is deleted from each `agents[]` entry, whatever it holds.
 * Every other key of the agent stays. One notice per agent that carried it.
 *
 * ⛔ What it does NOT do: rewrite the machine into a skill, a Flow or a
 * `state_machine` validation rule. Which of the three an author meant — a
 * conversation phase, a multi-step process, or a record's status transitions
 * — is a judgement no mechanical rewrite can make; the D3 entry
 * `agent-lifecycle-retired` carries it.
 *
 * Idempotent by construction: `stripKeys` skips an absent key and hands the
 * input back by reference. Retired from the load path: an author is refused at
 * parse with the prescription; data at rest (`applyConversionsToStoredItem`),
 * built artifacts and `os migrate meta` replay it.
 */
const agentLifecycleRemoved: MetadataConversion = {
  id: 'agent-lifecycle-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface: 'agent.lifecycle',
  summary:
    "agent key 'lifecycle' removed: the conversation state machine was parsed and never read — no runtime "
    + 'moved an agent through a declared state. The key is deleted; a conversation phase is a skill with '
    + 'triggerConditions, orchestration is a Flow, record transitions are a state_machine validation rule',
  apply(stack, emit) {
    return mapCollection(stack, 'agents', (agent, path) => stripKeys(agent, ['lifecycle'], emit, path));
  },
  fixture: {
    before: {
      agents: [
        {
          // A full machine, the shape the retired schema accepted: deleted
          // whole — no state of it ever ran.
          name: 'intake_agent',
          label: 'Intake',
          lifecycle: {
            id: 'intake',
            initial: 'greeting',
            states: {
              greeting: { on: { IDENTIFIED: 'triage' } },
              triage: { on: { RESOLVED: 'done' } },
              done: { type: 'final' },
            },
          },
        },
        // A minimal machine.
        { name: 'review_agent', label: 'Review', lifecycle: { id: 'review', initial: 'open', states: { open: {} } } },
        // A non-object value a hand-edited stored row could carry: the key
        // goes whatever it holds.
        { name: 'stray_agent', label: 'Stray', lifecycle: 'draft' },
        // No machine at all: rides through untouched.
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    after: {
      agents: [
        { name: 'intake_agent', label: 'Intake' },
        { name: 'review_agent', label: 'Review' },
        { name: 'stray_agent', label: 'Stray' },
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    // Three: one per agent that carried the key.
    expectedNotices: 3,
  },
};

export { agentLifecycleRemoved };
