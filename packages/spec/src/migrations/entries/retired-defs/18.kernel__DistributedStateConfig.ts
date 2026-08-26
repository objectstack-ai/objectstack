// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #12340 — kernel/plugin-lifecycle-advanced.zod.ts
// `DistributedStateConfigSchema`, retired whole (ADR-0049 enforce-or-remove).
//
// The orphan value schema of `HotReloadConfig.distributedConfig`, which had
// ZERO readers — measured at cdbd9204b6 with a firing positive control
// (`stateStrategy` resolves to real readers in `core/src/hot-reload.ts`, so
// the scan sees readers; `distributedConfig` resolved to nothing outside
// `packages/spec` itself in objectstack, and to nothing in objectui). An
// author could name a Redis or etcd endpoint, a key prefix, a TTL, auth
// credentials and a replication factor, and NOTHING ever opened a connection
// — the #3950 shape, sharpened by cluster-persistence vocabulary an AI author
// (ADR-0033) reads as proof the capability exists.
//
// It leaves with the enum value it existed for. `HotReloadConfig.stateStrategy`
// narrowed to ['memory','none'] in the same card, because the 'disk' and
// 'distributed' arms of `PluginStateManager.saveState` both wrote to the same
// in-memory Map as 'memory' and said so at DEBUG level only. With
// 'distributed' gone, a key whose own doc comment called it "required when
// stateStrategy is 'distributed'" names a value that no longer exists — it
// could not honestly outlive the narrowing.
//
// This is the #11825 keep, narrowed from inside, NOT reversed: that ruling
// kept `HotReloadConfigSchema` and `HotReloadManager` as a host-driven library
// and they both stand here. What it also listed among the survivors was
// `DistributedStateConfig` — a line this card reverses on new evidence, since
// #11825 measured the CONTAINER's six groups and never this key's own readers.
// The survival pin in `plugin-lifecycle-advanced-retirement.test.ts` moves in
// the same commit, deliberately and with the reasoning recorded there.
//
// Route 3: `HotReloadConfig` is not an authorable surface — no metadata-type
// binding, stack collection or manifest embed ever carried it, and nothing in
// the tree parses `HotReloadConfigSchema` outside its own unit test — so there
// is no authored document for a D2 conversion to rewrite and nobody who could
// receive a parse-time tombstone. This table plus the D3 semantic entry
// `hot-reload-inert-state-strategies-retired` ARE the declaration.
export const entry = 'kernel/DistributedStateConfig';
