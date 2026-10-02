// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #21320 — `automation/state-machine.zod.ts` `StateMachineSchema`, the
// XState-style machine (hierarchical and parallel states, guarded transitions,
// entry/exit actions), retired whole with its last authorable door, the
// tombstoned `agent.lifecycle` (ADR-0049 enforce-or-remove, ruled D on
// objectstack-ai/cloud#2569). ADR-0020 had already retired it as a
// record-lifecycle declaration — the `workflow` type and `object.stateMachines`
// went, and a record's legal transitions are the `state_machine` validation
// rule — and kept the file only because the agent door still imported it
// (ADR-0020 implementation note 1). The rest of the family — `StateNode`,
// `Transition`, `ActionRef`, `GuardRef` — left with it, each registered in its
// own entry file beside this one. Upgraders get the D3 semantic entry
// `agent-lifecycle-retired`. Registered under 18 for the launch-window reason
// its neighbours state.
export const entry = 'automation/StateMachine';
