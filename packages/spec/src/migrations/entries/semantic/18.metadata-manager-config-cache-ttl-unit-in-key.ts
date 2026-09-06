// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'metadata-manager-config-cache-ttl-unit-in-key',
  surface: 'MetadataManagerConfig `cache.ttl` / `cache.databaseLoader.ttl` (kernel/metadata-loader.zod.ts)',
  replacement: '`cache.ttlSeconds` (seconds, default 3600) and `cache.databaseLoader.ttlMs` '
    + '(milliseconds, default 60000) — rename each key; the values are unchanged',
  reason:
    'Maintainer ruling 2026-09-02 on #14478 (ruled B — no grandfathered baseline): the unit of a '
    + 'duration-shaped `z.number()` key lives in the key NAME or in a unit-carrying value, never '
    + 'only in the description. This block was the founding specimen: two keys spelled `ttl` '
    + 'fourteen lines apart, the outer one in SECONDS (3600) and the nested DatabaseLoader one in '
    + 'MILLISECONDS (60000), each unit named only in `.describe()`. An author who copied the outer '
    + 'number into the inner block got a 3.6-second cache with no error anywhere — the number was '
    + 'valid, the type was right, the cache was simply cold. Both keys are retiredKey tombstones '
    + '(the nested objects are not strict; a bare deletion would strip the old key in silence). '
    + 'Why a semantic entry and not a D2 conversion: `MetadataManagerConfig` is the runtime '
    + 'MetadataManager\'s constructor config, not a stack collection member and never a stored '
    + 'row, so the chain has no seam that ever runs on it (the `kernel/Manifest:loading` and '
    + '`metadata-plugin-additional-types-retired` precedent). The one in-repo reader, '
    + '`DatabaseLoader` (`packages/metadata`), reads `cache.databaseLoader.ttlMs` at the same '
    + 'magnitude it read `ttl`; the outer `cache.ttl` had no runtime reader (measured on '
    + 'ca46f8f12, and filed separately).',
  acceptanceCriteria:
    'Every `new MetadataManager({ cache: … })` / `MetadataManagerConfigSchema.parse(…)` site spells '
    + '`cache.ttlSeconds` and `cache.databaseLoader.ttlMs`; authoring either old `ttl` fails to '
    + 'compile (input type `never`) and fails to parse with the rename prescription naming the '
    + 'suffixed key; a DatabaseLoader configured with `ttlMs: 60000` expires entries after 60 '
    + 'seconds exactly as `ttl: 60000` did.',
};
