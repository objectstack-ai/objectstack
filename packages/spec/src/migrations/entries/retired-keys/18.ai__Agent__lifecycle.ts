// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #21320 — ADR-0049 enforce-or-remove, ruled D (retire) on
// objectstack-ai/cloud#2569: `agent.lifecycle`, the agent conversation state
// machine, was parsed and never read — no runtime in this repository or in
// cloud moved an agent through a declared state, and every enforcement design
// measured there was a subset statechart interpreter beside Flow (the
// two-engine shape ADR-0020 rejected). Tombstoned with `retiredKey()` on the
// strict `AgentSchema`; D2 conversion `agent-lifecycle-removed` (lossless
// delete, retired from the load path); D3 semantic entry
// `agent-lifecycle-retired`. Its value schema, `automation/StateMachine`, left
// with it (RETIRED_DEFS_BY_MAJOR). Registered under 18 for the launch-window
// reason its neighbours state.
export const entry = 'ai/Agent:lifecycle';
