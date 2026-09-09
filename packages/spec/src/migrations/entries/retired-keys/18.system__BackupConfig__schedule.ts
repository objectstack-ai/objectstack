// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16320 — ADR-0049 enforce-or-remove on the seven cron-typed positions nothing
// reads (#15954 ruling, decision batch #56, 2026-09-06: option A — retire — per
// family). Backup / DR-testing family, first of two positions:
// `BackupConfig.schedule`. Declared, parsed into the cron envelope and read by
// NOTHING — `BackupConfigSchema` has no consumer outside `packages/spec`, so
// no automated backup ever ran on it. Tombstoned with `retiredKey()`
// (non-strict `z.object`, ADR-0104).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`: a disaster-recovery
// plan is operator configuration, never a stack collection member or a
// `sys_metadata` row, so a MetadataConversion would be a transform with no
// seam that ever runs (the `kernel/MetadataPluginConfig:additionalTypes`
// precedent). No `os migrate meta` sentence, for the same reason.
// D3 semantic entry: `disaster-recovery-schedules-retired`.
export const entry = 'system/BackupConfig:schedule';
