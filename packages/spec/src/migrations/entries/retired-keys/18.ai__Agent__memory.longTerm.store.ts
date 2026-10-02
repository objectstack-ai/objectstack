// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20274 — ADR-0049 enforce-or-remove, ruling record 5950198150 (letter A′,
// maintainer 「同意」): the `agent.memory` contract states exactly what the
// runtime honours, and the memory store is platform infrastructure, not agent
// metadata. Retired as a WHOLE key, ⛔ not narrowed to a one-value enum: the
// cloud AI runtime keeps the notes in its own database store and refused the
// `vector` default and `redis` before an agent's first turn. Tombstoned with
// `retiredKey()` inside the live `longTerm` block; its old aliases (`backend` /
// `storage` / `provider`) became `guidance` entries carrying the same answer.
// D2 conversion `agent-memory-long-term-store-removed` (lossless delete,
// retired from the load path); D3 semantic entry
// `agent-memory-store-retired-and-limits-required`. Registered under 18 for the
// launch-window reason its neighbours state.
//
// ⚠️ The key was DEFAULTED (`'vector'`), so a released toolchain materialized
// it into every parsed agent that declared `longTerm`. The
// `acceptRetiredDefaultResidue` stage is deliberately NOT adopted: the producer
// census is zero (no agent outside `packages/spec` declares `longTerm`, measured
// in this repository; none of cloud's built-in agents does, per the cloud
// seat's reading), and the ruling names the tombstone's prescription as the
// backstop for the unmeasured tenant population. Stored rows and built
// artifacts are healed by the replayed D2 conversion; a pre-retirement compiled
// definition fed back through the authoring funnel meets the prescription.
//
// Nested key of an inline block — no `authorable-surface/` line of its own.
export const entry = 'ai/Agent:memory.longTerm.store';
