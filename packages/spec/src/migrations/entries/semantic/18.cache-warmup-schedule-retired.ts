// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cache-warmup-schedule-retired',
  surface: 'cache warmup cron: `CacheWarmup.schedule` (`system/cache.zod.ts`)',
  replacement:
    'nothing to re-declare — delete the key. No cache-warmup engine exists on the platform, so '
    + 'there is no live mechanism to declare a warmup cadence to. The one cron slot the platform '
    + 'evaluates is `Job.schedule.expression` (`system/job.zod.ts`): a warmup on a cadence is a '
    + 'job whose handler you write. The `strategy` enum keeps its `scheduled` member — a value, '
    + 'not a position the ruling names, and exactly as inert before',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-06 on #15954 (director decision '
    + 'batch #56, option A — retire — per family), executed by #16320. The key was parsed into '
    + 'the cron envelope and read by NOTHING: `CacheWarmupSchema` has no consumer outside '
    + '`packages/spec` (the ADR-0058 D7 ledger row `cron-declared-unwired` recorded it '
    + '`unevaluated`), so `strategy: \'scheduled\'` plus a cron warmed nothing. Why D3 semantic '
    + 'and not a D2 conversion: a cache configuration is plugin TS configuration, never a stack '
    + 'collection member or a `sys_metadata` row, so a conversion would be a transform with no '
    + 'seam that ever runs (the `kernel/MetadataPluginConfig:additionalTypes` precedent). The '
    + 'prescription therefore carries no `os migrate meta` sentence.',
  acceptanceCriteria:
    'No `CacheWarmup` literal — standalone or as `DistributedCacheConfig.warmup` — carries '
    + '`schedule`. TypeScript authors get the refusal at compile time (the key is typed '
    + '`never`); a value reaching the parse is refused with the prescription (`invalid_type` '
    + 'at path `schedule`). ⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified '
    + 'as such: nothing ever read the key, so removing it removes no behaviour.',
};
