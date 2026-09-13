// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `performance.schemaCacheTTL`
// said "Schema cache TTL in seconds" in a source JSDoc and "Schema cache TTL" in
// the `.describe()` the reference pages publish, so the published channel named
// no unit at all. Renamed to `schemaCacheTtlSeconds` — `Ttl`, not `TTL`, because
// that is how every member of the suffixed family on this tree already spells it
// (`cacheTtlSeconds`, `ttlSeconds`, `defaultCacheTtlSeconds`). The value and the
// 3600 default are unchanged. Tombstoned with `retiredKey()`: the nested
// `performance` object is not strict, so a bare deletion would silently strip the
// key. No D2 conversion: not a stack collection member, not a stored row. See
// `tenant-schema-cache-ttl-unit-in-key`.
export const entry = 'system/SchemaLevelIsolationStrategy:performance.schemaCacheTTL';
