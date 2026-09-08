// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14478 tombstoned `MetadataManagerConfig.cache.ttl` as a RENAME to
// `ttlSeconds` (D3 `metadata-manager-config-cache-ttl-unit-in-key`) without
// registering the key here — a nested key the authorable-surface walk does not
// reach, so gate (b) never asked for it. #15624 then retired `ttlSeconds`
// itself before the rename ever shipped (ADR-0049 enforce-or-remove: the
// outer `cache` block was read by nothing), so the rename is folded into the
// removal and `cache.ttl`'s tombstone now prescribes deletion — an author
// upgrading from a published 17.x sees one hop, not two. Registered as the
// deletion it now is. The TTL that is honoured is
// `cache.databaseLoader.ttlMs`.
//
// No D2 conversion (a metadata-manager config is not a stack collection
// member). D3 semantic entry: `metadata-manager-config-inert-cache-keys-retired`.
export const entry = 'kernel/MetadataManagerConfig:cache.ttl';
