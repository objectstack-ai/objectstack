// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15624 — ADR-0049 enforce-or-remove. `MetadataManagerConfig.cache.ttlSeconds`
// (the #14478 respelling of `cache.ttl`, registered under this same major and
// never shipped) was declared, defaulted (3600) and documented, and read by
// nothing — the outer `cache` block has no runtime consumer; only
// `cache.databaseLoader` reaches `DatabaseLoader`. Tombstoned with
// `retiredKey()`; the rename is folded into the removal (`cache.ttl`'s own
// tombstone now prescribes deletion too — see the sibling entry). The TTL that
// is honoured is `cache.databaseLoader.ttlMs` (milliseconds).
//
// No D2 conversion, the `persistence.overlayWritable` reasoning: a
// metadata-manager config is not a stack collection member. D3 semantic entry:
// `metadata-manager-config-inert-cache-keys-retired`.
export const entry = 'kernel/MetadataManagerConfig:cache.ttlSeconds';
