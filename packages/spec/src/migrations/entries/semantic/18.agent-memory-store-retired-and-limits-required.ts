// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20274 — ADR-0049 enforce-or-remove (ruling record 5950198150, letter A′) —
// the D3 entry of the `agent.memory` contract: one entry for the one decision,
// because its two halves leave an upgrading author ONE job between them. The
// `store` half is mechanical (the D2 conversion
// `agent-memory-long-term-store-removed` deletes it, losslessly); the two
// required numbers are not — no default is declared, so only the author can
// choose them, which is the judgement this entry exists to carry.
export const entry: SemanticMigration = {
  id: 'agent-memory-store-retired-and-limits-required',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code span.
  surface:
    'agent.memory — longTerm.store left the shape (the memory store is the platform\'s); '
    + 'longTerm.maxEntries and reflectionInterval are required when longTerm.enabled is true, and '
    + 'reflectionInterval is refused without an enabled longTerm; longTerm.enabled is unchanged',
  replacement:
    'no storage key: delete `longTerm.store`, whatever it held — where long-term memory notes are '
    + 'kept is the platform\'s choice. An agent whose `longTerm.enabled` is true declares '
    + '`longTerm.maxEntries` (how many distilled notes are kept for each user; the newest are recalled '
    + 'before the first round and older ones evicted) and `memory.reflectionInterval` (how many '
    + 'delivered interactions pass between the reflections that write a note). An agent without '
    + 'enabled long-term memory declares no `reflectionInterval`',
  reason:
    'ADR-0049 enforce-or-remove: the `agent.memory` contract states exactly what the runtime honours. '
    + 'The cloud AI runtime, the one runtime that executes agents, enforces long-term memory from '
    + '`enabled`, `maxEntries` and `reflectionInterval`: it recalls the newest `maxEntries` notes '
    + 'before the first round, writes one note every `reflectionInterval` delivered interactions, and '
    + 'evicts notes beyond `maxEntries`. It keeps the notes in its own database store, and before an '
    + 'agent\'s first turn it refused the `vector` store (the old default, so what an omitted `store` '
    + 'parsed to), `redis`, an enabled `longTerm` missing either number, and a `reflectionInterval` '
    + 'without an enabled `longTerm`. Authoring now refuses the same declarations, each with a '
    + 'prescription. The D2 conversion `agent-memory-long-term-store-removed` deletes `store` from '
    + 'existing sources and stored rows, losslessly: no value of it ever chose a backend. No default '
    + 'is declared for either number, because none has a measured basis — so an agent with long-term '
    + 'memory enabled and either number missing no longer parses, and only its author can choose the '
    + 'numbers it needs',
  acceptanceCriteria:
    'No agent declares `memory.longTerm.store`, or a `backend`, `storage` or `provider` key under '
    + '`longTerm`; each is refused at parse with its prescription, and TypeScript rejects `store`. '
    + 'Every agent whose `longTerm.enabled` is true declares both `longTerm.maxEntries` and '
    + '`memory.reflectionInterval`, each an integer of at least 1 chosen for that agent, and no agent '
    + 'declares `reflectionInterval` without an enabled `longTerm`. Every agent parses under the new '
    + 'schema.',
  conversionIds: ['agent-memory-long-term-store-removed'],
  relevantWhen: { kind: 'stack-declares', keys: ['agents'] },
};
