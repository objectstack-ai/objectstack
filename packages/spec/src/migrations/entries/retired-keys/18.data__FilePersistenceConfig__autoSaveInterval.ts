// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — ruling B.
// `FilePersistenceConfig.autoSaveInterval` said "Auto-save interval in ms" in
// prose and nothing else. Its `min(100)` bound is what made the bare name
// dangerous rather than merely untidy: 100 reads as a plausible number of
// SECONDS, so an author who guessed the unit wrong cleared the bound, was
// refused nowhere, and saved a thousand times more often than intended.
// Renamed to `autoSaveIntervalMs`; the value and the 2000 default are
// unchanged. Tombstoned with `retiredKey()` — this shape IS `strictObject`, so
// a bare deletion is not silent, but an unknown-key rejection cannot carry the
// FROM → TO mapping, which is the whole payload of a rename. Covered by the D2
// conversion `memory-persistence-auto-save-interval-to-ms`: a memory datasource
// is a `datasources[]` stack collection member whose `config` is stored whole in
// `sys_metadata`, so the chain has a seam that sees it.
export const entry = 'data/FilePersistenceConfig:autoSaveInterval';
