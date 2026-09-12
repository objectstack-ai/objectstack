// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'time-update-interval-sub-day-retired',
  surface:
    '`TimeUpdateInterval` — the `/analytics/query` body\'s `timeDimensions[].granularity` and an '
    + 'analytics cube dimension\'s `granularities[]`. The three sub-day members `second`, '
    + '`minute` and `hour` are retired; `day`, `week`, `month`, `quarter` and `year` are '
    + 'unchanged and parse byte-identically',
  replacement:
    'the coarsest declared interval that still answers the question — `day` is the finest bucket '
    + 'the platform labels. A caller who wants raw per-instant rows drops `granularity` entirely, '
    + 'which groups on the unbucketed timestamp deliberately rather than by accident. There is no '
    + 'mechanical replacement that preserves a sub-day bucket, because no backend ever produced '
    + 'one',
  reason:
    'ADR-0049 enforce-or-remove (#17296, the card #17206\'s changeset promised). The rest of the '
    + 'contract never carried these three: `DateGranularity` (`data/query.zod.ts`) — the '
    + 'vocabulary a `groupBy` entry and every driver\'s bucket expression are typed by — declares '
    + 'five, `@objectstack/core`\'s `BUCKET_GRANULARITIES` labels the same five, and '
    + '`DriverCapabilitiesSchema.supports.queryDateGranularity` is a `z.record(DateGranularity, '
    + 'boolean)`, so a driver could not advertise sub-day bucketing even if it had one. Measured '
    + 'on the shipped faces before the narrowing: `driver-memory`\'s analytics face answered '
    + 'NOT_IMPLEMENTED/501, `driver-mongodb`\'s bucket builder answered NOT_IMPLEMENTED/501, and '
    + 'the engine\'s in-memory aggregation — the fallback every SQL/ObjectQL analytics query '
    + 'carrying a granularity lands on, since `NativeSQLStrategy` declines on a granularity — '
    + 'answered 200 with one group per distinct timestamp, echoing the raw instant back as its '
    + 'own bucket label. Two honest refusals and one silently wrong answer, and no third '
    + 'behaviour anywhere. ⚠️ This retires the NAMES, not the idea: offering sub-day analytics '
    + 'means widening `DateGranularity`, the `queryDateGranularity` record, the canonical '
    + 'bucket-key vocabulary and every driver\'s bucket expression together — new capability, '
    + 'decided as such',
  acceptanceCriteria:
    'No analytics request body carries `timeDimensions[].granularity` of `second`, `minute` or '
    + '`hour`, and no cube dimension offers one in `granularities[]` (the D2 conversion '
    + '`cube-sub-day-granularities-removed` strips them from sources, dropping the key entirely '
    + 'when nothing coarser remains). ⚠️ The conversion cannot decide what a dimension that '
    + 'offered ONLY sub-day intervals should offer instead — review each site the run reports '
    + 'and state the granularities that dimension actually serves.',
};
