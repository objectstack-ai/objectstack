// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `agent-memory-long-term-store-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `agentMemoryLongTermStoreRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * An agent's long-term memory store — `agent.memory.longTerm.store` — leaves
 * the spec (protocol 18, #20274; ADR-0049 enforce-or-remove, ruling record
 * 5950198150, letter A′: the `agent.memory` contract states exactly what the
 * runtime honours).
 *
 * The memory store is platform infrastructure, not agent metadata. Cloud's AI
 * service, the one runtime that executes agents, keeps long-term memory notes
 * in its own database store; it refused `vector` — the key's old DEFAULT, so
 * what an omitted `store` parsed to — and `redis` before an agent's first
 * turn, and honoured `database` only because that is the store it uses anyway.
 * Before that reader landed nothing read the block at all. So no authored
 * value ever chose a backend, and the delete is LOSSLESS: authoring now
 * refuses the key by name (`retiredKey`, ai/agent.zod.ts).
 *
 * One edit: the key is deleted from `memory.longTerm`, whatever it holds — an
 * explicit `database`, a refused `vector` / `redis`, or the `vector` default a
 * released toolchain materialized into a parsed agent. Every other key of the
 * block stays. One notice per agent that carried it.
 *
 * ⛔ What it does NOT do: supply `maxEntries` or `reflectionInterval`. The same
 * ruling made both REQUIRED once `longTerm.enabled` is true, with no default,
 * so no mechanical rewrite can choose them; the D3 entry
 * `agent-memory-store-retired-and-limits-required` carries that judgement.
 *
 * Idempotent by construction: `stripKeys` skips an absent key and hands the
 * input back by reference. Retired from the load path: an author is refused at
 * parse with the prescription; data at rest (`applyConversionsToStoredItem`),
 * built artifacts and `os migrate meta` replay it.
 */
const agentMemoryLongTermStoreRemoved: MetadataConversion = {
  id: 'agent-memory-long-term-store-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface: 'agent.memory.longTerm.store',
  summary:
    "agent memory key 'longTerm.store' removed: the memory store is platform infrastructure, not agent "
    + "metadata — the AI runtime keeps long-term memory notes in its own database store and refused the "
    + "'vector' default and 'redis' before the first turn. The key is deleted; every other memory key stays",
  apply(stack, emit) {
    return mapCollection(stack, 'agents', (agent, path) => {
      const memory = agent.memory;
      if (!isDict(memory)) return agent;
      const longTerm = memory.longTerm;
      if (!isDict(longTerm)) return agent;
      const nextLongTerm = stripKeys(longTerm, ['store'], emit, `${path}.memory.longTerm`);
      return nextLongTerm === longTerm ? agent : { ...agent, memory: { ...memory, longTerm: nextLongTerm } };
    });
  },
  fixture: {
    before: {
      agents: [
        {
          // The one value the runtime honoured: deleted all the same — the
          // store is the platform's, whatever the agent says.
          name: 'recall_agent',
          label: 'Recall',
          memory: { longTerm: { enabled: true, store: 'database', maxEntries: 20 }, reflectionInterval: 5 },
        },
        {
          // The old default, as a released toolchain materialized it into a
          // parsed agent whose author never wrote `store`.
          name: 'paused_agent',
          label: 'Paused',
          memory: { longTerm: { enabled: false, store: 'vector' } },
        },
        {
          // A refused backend.
          name: 'cache_agent',
          label: 'Cache',
          memory: { longTerm: { enabled: true, store: 'redis', maxEntries: 50 }, reflectionInterval: 10 },
        },
        {
          // Already canonical, and an agent with no memory at all: both ride
          // through untouched.
          name: 'notes_agent',
          label: 'Notes',
          memory: { longTerm: { enabled: true, maxEntries: 5 }, reflectionInterval: 3 },
        },
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    after: {
      agents: [
        {
          name: 'recall_agent',
          label: 'Recall',
          memory: { longTerm: { enabled: true, maxEntries: 20 }, reflectionInterval: 5 },
        },
        { name: 'paused_agent', label: 'Paused', memory: { longTerm: { enabled: false } } },
        {
          name: 'cache_agent',
          label: 'Cache',
          memory: { longTerm: { enabled: true, maxEntries: 50 }, reflectionInterval: 10 },
        },
        {
          name: 'notes_agent',
          label: 'Notes',
          memory: { longTerm: { enabled: true, maxEntries: 5 }, reflectionInterval: 3 },
        },
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    // Three: one per agent whose `longTerm` carried the key.
    expectedNotices: 3,
  },
};

export { agentMemoryLongTermStoreRemoved };
