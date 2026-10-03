// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21320 — ADR-0049 enforce-or-remove (ruled D, retire, on
// objectstack-ai/cloud#2569) — the D3 entry of the `agent.lifecycle`
// retirement, one entry for the one family: the key and the XState
// `StateMachineSchema` exports that only it still reached leave for the same
// reason. The key's deletion is mechanical (the D2 conversion
// `agent-lifecycle-removed`); where the intent behind a deleted machine goes —
// a skill, a Flow, or a `state_machine` validation rule — is not, and that
// judgement is what this entry carries.
export const entry: SemanticMigration = {
  id: 'agent-lifecycle-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code span.
  surface:
    'agent.lifecycle — the agent conversation state machine left the shape; with it the XState '
    + 'StateMachineSchema family left @objectstack/spec/automation (StateMachineSchema, StateNodeSchema, '
    + 'TransitionSchema, ActionRefSchema, GuardRefSchema and their types), and StateNodeConfig left the '
    + 'root and /ai entries',
  replacement:
    'no key: delete `lifecycle` from every agent. Put what the machine meant where the platform enforces '
    + 'it — a phase of a conversation is a skill with its own `instructions` and `tools`, selected by its '
    + '`triggerConditions` and attached through the agent\'s `skills`; a multi-step process is a Flow; a '
    + 'record\'s status transitions are a `state_machine` validation rule on the object (a flat table of '
    + 'each state\'s allowed next states). Code that imported the state machine exports declares the shape '
    + 'it needs itself, or drops it',
  reason:
    'ADR-0049 enforce-or-remove: `agent.lifecycle` was parsed and never read. No runtime — not this '
    + 'repository, not the cloud AI runtime that executes agents — moved an agent through a declared '
    + 'state or refused an undeclared transition, so an authored machine changed nothing an agent did. '
    + 'Enforcing it would have meant a statechart interpreter beside Flow, the two-engine shape ADR-0020 '
    + 'rejected, and what it reached for is already served: conversation phases by skills (ADR-0064), '
    + 'orchestration by Flow (ADR-0019), record transitions by the `state_machine` validation rule '
    + '(ADR-0020). Authoring now refuses the key with that prescription, and TypeScript rejects it. The '
    + 'D2 conversion `agent-lifecycle-removed` deletes it from existing sources and stored agent rows, '
    + 'losslessly. `StateMachineSchema` had kept its file only for this door (ADR-0020 implementation '
    + 'note 1), so the family left with it — which of the three destinations each deleted machine meant '
    + 'is the author\'s judgement, not a mechanical rewrite',
  acceptanceCriteria:
    'No agent declares `lifecycle`; it is refused at parse with its prescription, and TypeScript rejects '
    + 'it. Every conversation phase a deleted machine described is a skill the agent lists in `skills`, '
    + 'with its own `instructions`, `tools` and `triggerConditions`; every multi-step process it described '
    + 'is a Flow; every record status transition it described is a `state_machine` validation rule on that '
    + 'object. No source imports StateMachineSchema, StateNodeSchema, TransitionSchema, ActionRefSchema, '
    + 'GuardRefSchema or their types from @objectstack/spec. Every agent parses under the new schema.',
  conversionIds: ['agent-lifecycle-removed'],
};
