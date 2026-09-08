// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15624 — ADR-0049 enforce-or-remove (PM ruling on the card, conditioned on
// the measurement it carries). `MetadataManagerConfig.cache.enabled` was
// declared, defaulted (`true`), documented on the published reference page —
// and read by nothing: the only runtime consumer of the `cache` block is
// `MetadataManager`, which hands `cache.databaseLoader` (and only that) to
// `new DatabaseLoader({ cache })`. `enabled: false` switched nothing off.
// Tombstoned with `retiredKey()` (the nested object is not strict; a bare
// deletion would strip the key in silence — the same no-op one layer down).
// The switch that is honoured is `cache.databaseLoader.enabled`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts` — the
// `kernel/MetadataManagerConfig:persistence.overlayWritable` reasoning: a
// metadata-manager config is not a stack collection member, so a
// MetadataConversion would be a transform with no seam that ever runs. The
// prescription reaches authors through the tombstone (`tsc` + the parse) and
// the D3 semantic entry `metadata-manager-config-inert-cache-keys-retired`.
export const entry = 'kernel/MetadataManagerConfig:cache.enabled';
