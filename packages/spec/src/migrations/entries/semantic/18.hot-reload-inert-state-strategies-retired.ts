// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'hot-reload-inert-state-strategies-retired',
  surface:
    "`HotReloadConfig.stateStrategy` values 'disk' and 'distributed', plus the "
    + '`HotReloadConfig.distributedConfig` key and the `DistributedStateConfig` def '
    + 'it carried (3 exported names: `DistributedStateConfigSchema` / '
    + '`DistributedStateConfig` / `DistributedStateConfigParsed`)',
  replacement:
    "'memory' for in-process state preservation across a reload, or 'none' to "
    + 'disable it — the two values `PluginStateManager` actually implements. There '
    + 'is no in-tree replacement for durable or distributed plugin state: persist '
    + 'it in the host, which owns the process lifetime these strategies pretended '
    + 'to outlive. Real disk or distributed persistence returns only via the '
    + 'ENFORCE route of ADR-0049 — the implementation first, the declaration with '
    + 'it.',
  reason:
    'ADR-0049 enforce-or-remove, applied one level INSIDE the library the '
    + '2026-08-25 #11825 ruling kept. That ruling retired the authorable '
    + 'lifecycle-config container and deliberately kept `HotReloadConfigSchema` as '
    + 'a host-driven library parameter type; this card measured the kept '
    + "vocabulary's own remainder and found the same defect in it. Measured at "
    + 'cdbd9204b6 with a firing positive control (`stateStrategy` resolves to real '
    + 'readers in `core/src/hot-reload.ts`, so the scan sees readers): the '
    + "'disk' and 'distributed' arms of `PluginStateManager.saveState` both wrote "
    + "to the SAME in-memory Map as 'memory' — the in-source comments said "
    + "'memory fallback' — and announced the substitution at DEBUG level only, so "
    + 'a host that asked for durable or cluster-replicated state got process-local '
    + 'memory and no error: state that does not survive the restart it was '
    + 'configured to survive. `distributedConfig` had ZERO readers anywhere '
    + '(every reference inside `packages/spec` itself plus the generated reference '
    + 'page; nothing in objectui), so an author could name a Redis endpoint, a TTL '
    + 'and a replication factor and nothing ever opened a connection — the #3950 '
    + 'shape, sharpened by cluster-persistence vocabulary an AI author (ADR-0033) '
    + 'reads as proof the capability exists. The key left with the enum value its '
    + 'own doc comment named it "required" for, and `DistributedStateConfig` was '
    + 'its orphan value schema. Two routes in one card because the surface has two '
    + 'shapes: an enum-VALUE narrowing is invisible to the four ratchets (the def '
    + 'still emits), so its prescription hangs on the enum\'s own `error` map '
    + 'dispatched by `issue.input` (the `crypto.hash` / `managedBy: \'system\'` '
    + 'precedent); the whole-def removal MUST move them, and that movement is its '
    + 'own evidence. No D2 conversion and no tombstone: `HotReloadConfig` is not '
    + 'an authorable surface — no metadata-type binding, stack collection or '
    + 'manifest embed ever carried it, and nothing in the tree parses '
    + '`HotReloadConfigSchema` outside its own unit test — so there is no authored '
    + 'document to rewrite and no one who could receive a parse-time '
    + 'prescription. Route 3, the #4834 / #11825 shape: this entry IS the '
    + 'declaration.',
  acceptanceCriteria:
    "No host passes `stateStrategy: 'disk'` or `'distributed'` to "
    + '`HotReloadManager.registerPlugin`. TypeScript hosts cannot: '
    + "`HotReloadConfigParsed['stateStrategy']` is now `'memory' | 'none'`, so "
    + 'either value is a compile error at the call site. JavaScript hosts, and '
    + 'config that arrived as JSON, get a loud registration-time refusal carrying '
    + 'the prescription — an ADR-0112 envelope (`code: VALIDATION_ERROR`, '
    + '`status: 400`) thrown BEFORE the `enabled` check, so a disabled config '
    + 'cannot smuggle the false declaration through. No import of '
    + '`DistributedStateConfigSchema`, `DistributedStateConfig` or '
    + '`DistributedStateConfigParsed` from `@objectstack/spec` or '
    + '`@objectstack/spec/kernel` survives — every one is TS2305 after upgrade, '
    + 'pinned by resolved symbol identity in '
    + '`kernel/plugin-lifecycle-advanced-retirement.test.ts`. ⚠️ Runtime state '
    + "behaviour is UNCHANGED for every config that worked: 'disk' and "
    + "'distributed' already stored to memory, so a host that migrates either to "
    + "'memory' keeps byte-identical behaviour — what changes is that the two "
    + 'spellings which never described what happened are now refused instead of '
    + 'silently honoured. The #11825 keep itself stands: `HotReloadConfigSchema`, '
    + '`PluginStateSnapshotSchema` and the health vocabularies still export from '
    + '`./kernel`, and `HotReloadManager` / `PluginHealthMonitor` still export '
    + 'from `@objectstack/core` with their tests green.',
};
