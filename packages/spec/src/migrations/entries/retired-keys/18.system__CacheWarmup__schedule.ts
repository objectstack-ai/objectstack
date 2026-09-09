// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16320 — ADR-0049 enforce-or-remove on the seven cron-typed positions nothing
// reads (#15954 ruling, decision batch #56, 2026-09-06: option A — retire — per
// family). Cache-warmup family: `CacheWarmup.schedule`. Declared, parsed into
// the cron envelope and read by NOTHING — `CacheWarmupSchema` has no consumer
// outside `packages/spec`, so no warmup ever ran on a schedule. Tombstoned with
// `retiredKey()` (non-strict `z.object`, ADR-0104). The `strategy` enum keeps
// its `scheduled` member: a value, not a position this ruling names, and
// exactly as inert before (nothing reads the def).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`: a cache config is
// plugin TS configuration, never a stack collection member or a
// `sys_metadata` row, so a MetadataConversion would be a transform with no
// seam that ever runs (the `kernel/MetadataPluginConfig:additionalTypes`
// precedent). No `os migrate meta` sentence, for the same reason.
// D3 semantic entry: `cache-warmup-schedule-retired`.
export const entry = 'system/CacheWarmup:schedule';
