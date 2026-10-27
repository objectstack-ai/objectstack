// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8057 — the never-implemented upsert flag on `engine.update()`'s option
// surface, tombstoned on BOTH update-options schemas (this one and the
// deprecated `DataEngineUpdateOptions` sibling) with one prescription:
// `ENGINE_UPDATE_UPSERT_REMOVED` in `data/data-engine.zod.ts`, which the
// objectql engine's unknown-option gate quotes too. Declared-but-unenforced
// (ADR-0049): the key sat on the engine's update allowlist while no code path
// read it, so `{ upsert: true }` was accepted and silently dropped.
//
// Registered here but NOT in `src/conversions/registry.ts`, and that asymmetry
// is the point rather than an omission: a D2 conversion rewrites an authored
// source or a stored `sys_metadata` row, and an engine option bag is call-time
// only — nobody authors one and nothing persists one. The prescription reaches
// consumers as the D3 semantic entry `engine-update-upsert-retired` plus this
// tombstone (the `BatchOptions.validateOnly` / `ListNotificationsRequest:cursor`
// disposition).
export const entry = 'data/EngineUpdateOptions:upsert';
