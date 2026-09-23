// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #18669 — maintainer ruling A (2026-09-17, decision batch #151 item 4):
// `CompatibilityMatrixEntry.estimatedMigrationTime` said "Estimated migration
// time in hours" in a source JSDoc and carried no `.describe()` at all, so the
// published reference page rendered a bare number beside `migrationComplexity`'s
// named scale — the JSDoc-channel shape #15939 was filed on, one def over.
// Renamed to `estimatedMigrationTimeHours` AND given the describe: the rename
// alone would have left the two channels that name the unit (the key name and a
// source comment) agreeing about something `content/docs/references/**` does not
// print, which `check:duration-unit-keys` refuses as
// `unit-in-jsdoc-not-in-describe` (ruled an offence 2026-09-18, decision batch
// #158 item 5). HOURS is the unit the JSDoc named, kept rather than converted to
// seconds: the value is unchanged and the ruling forbade narrowing. Tombstoned
// with `retiredKey()`: `CompatibilityMatrixEntrySchema` is a plain `z.object`,
// not strict, so a bare deletion would strip the old spelling in silence. No D2
// conversion: a compatibility matrix is a plugin-published version manifest —
// `stack.zod.ts` declares no collection of them and it is not a registered
// metadata kind stored as a `sys_metadata` row.
// See `kernel-compatibility-matrix-estimated-migration-time-unit-in-key`.
export const entry = 'kernel/CompatibilityMatrixEntry:estimatedMigrationTime';
