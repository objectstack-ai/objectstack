// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'metadata-manager-config-inert-cache-keys-retired',
  surface: 'MetadataManagerConfig `cache.enabled` / `cache.ttlSeconds` (formerly `cache.ttl`) / '
    + '`cache.maxSize` (kernel/metadata-loader.zod.ts; tombstoned, see `RETIRED_KEYS_BY_MAJOR[18]`)',
  replacement: 'nothing to re-declare — delete the three outer keys. The cache that actually runs '
    + 'is the DatabaseLoader read-through LRU under `cache.databaseLoader`: its `enabled` '
    + '(default true) is the switch, `ttlMs` (milliseconds, default 60000) the TTL and `maxSize` '
    + '(an entry count, default 500) the cap',
  reason:
    'ADR-0049 enforce-or-remove (#15624, PM ruling on the card, conditioned on the measurement '
    + 'it carries and re-taken on the merged ref): the outer `cache` block of '
    + '`MetadataManagerConfig` advertised three knobs — `enabled` (default true), `ttlSeconds` '
    + '(default 3600; `ttl` until #14478) and `maxSize` ("bytes") — that no runtime read. The '
    + 'only consumer of the block is `MetadataManager` (`packages/metadata`), which hands '
    + '`cache.databaseLoader` and nothing else to `new DatabaseLoader({ cache })`; a '
    + 'repo-wide reader census over `packages/**` (tests and changelogs excluded) found no '
    + 'runtime reader of any outer key, while the same grep shape found the nested '
    + '`cache?.databaseLoader` read twice (the positive control). An author writing '
    + '`cache: { enabled: false }` or `cache: { ttlSeconds: 60 }` got a clean parse and a '
    + 'cache that behaved exactly as before, and the published reference page documented '
    + 'all three as if they configured something. All three are retiredKey tombstones (the '
    + 'nested object is not strict; a bare deletion would strip them in silence — the same '
    + 'no-op one layer down). The #14478 `ttl` → `ttlSeconds` rename, registered under this '
    + 'same major and never shipped, is folded into the removal: `cache.ttl`\'s tombstone now '
    + 'prescribes deletion rather than a rename to a key that is itself retired, so a 17.x '
    + 'author sees one hop. Why a semantic entry and not a D2 conversion: `MetadataManagerConfig` '
    + 'is the runtime MetadataManager\'s constructor config, not a stack collection member and '
    + 'never a stored row, so the chain has no seam that ever runs on it (the '
    + '`kernel/MetadataManagerConfig:persistence.overlayWritable` precedent). The other '
    + 'candidate — wiring readers for a second cache layer — was not taken: no consumer for '
    + 'one exists, and an implementation for an unmeasured need is the shape ADR-0049 refuses.',
  acceptanceCriteria:
    'No `new MetadataManager({ cache: … })` / `MetadataManagerConfigSchema.parse(…)` site '
    + 'spells `cache.enabled`, `cache.ttlSeconds`, `cache.ttl` or `cache.maxSize` (TypeScript '
    + 'authors get the refusal at compile time — the keys are typed `never` — and a value '
    + 'reaching the parse is refused with the prescription at the key\'s path, naming '
    + '`cache.databaseLoader`). ⚠️ Runtime behaviour is deliberately UNCHANGED and must be '
    + 'verified as such: the DatabaseLoader read-through cache configured under '
    + '`cache.databaseLoader` (`enabled` / `maxSize` / `ttlMs`) behaves exactly as before, and a '
    + 'config that never wrote the outer keys parses to the same output minus the two former '
    + 'defaults (`enabled: true`, `ttlSeconds: 3600`) that were materialized and never consulted.',
};
