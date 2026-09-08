// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15624 — ADR-0049 enforce-or-remove. `MetadataManagerConfig.cache.maxSize`
// ("Max cache size in bytes") was declared and documented, and read by nothing
// — the outer `cache` block has no runtime consumer; only
// `cache.databaseLoader` reaches `DatabaseLoader`, whose own `maxSize` is an
// ENTRY COUNT (default 500), not bytes. Tombstoned with `retiredKey()`. The
// cap that is honoured is `cache.databaseLoader.maxSize`.
//
// No D2 conversion, the `persistence.overlayWritable` reasoning: a
// metadata-manager config is not a stack collection member. D3 semantic entry:
// `metadata-manager-config-inert-cache-keys-retired`.
export const entry = 'kernel/MetadataManagerConfig:cache.maxSize';
