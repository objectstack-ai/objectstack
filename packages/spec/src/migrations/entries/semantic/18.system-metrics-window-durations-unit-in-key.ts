// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-metrics-window-durations-unit-in-key',
  surface: 'the three metrics window/period lengths whose name carried no unit: '
    + 'MetricAggregationConfig.window.size, ServiceLevelIndicator.window.size and '
    + 'ServiceLevelObjective.period.duration (system/metrics.zod.ts)',
  replacement: 'window.durationSeconds, window.durationSeconds and period.durationSeconds — '
    + 'rename each key; every value is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'The three are one entry because they are one measurement expressed three times on one '
    + 'file: how long a window or period is. The new name is deliberately NOT the mechanical '
    + 'sizeSeconds the gate prints. size means a byte or row count everywhere else in this '
    + 'spec — CacheTier.maxSize is megabytes, RegistryConfig.cache.maxSize is bytes, and this '
    + 'very file spells a batch row count size — so sizeSeconds would have kept the '
    + 'misleading half of the name and bolted a unit onto it, leaving a reader to decide '
    + 'whether a window is measured in bytes-per-second or in time. windowSeconds was '
    + 'rejected for a plainer reason: the parent key is already window, so it would read '
    + 'window.windowSeconds. durationSeconds names what the number IS, and the file itself '
    + 'supplied the precedent — ServiceLevelObjective.period already called its length a '
    + 'duration, so after the rename all three read alike instead of one borrowing byte '
    + 'vocabulary. All three are retiredKey() tombstones; the shapes are not strict, so a bare '
    + 'deletion would strip in silence. Why a semantic entry and not a D2 conversion: '
    + 'stack.zod.ts declares no metrics collection, and none of an aggregation config, an SLI '
    + 'or an SLO is a registered metadata kind stored as a sys_metadata row. '
    + '#15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every aggregation window and SLI window spells durationSeconds, and every SLO period '
    + 'spells durationSeconds. Authoring window.size or period.duration fails to compile '
    + '(input type `never`) and fails to parse with the rename prescription. Behaviour is '
    + 'unchanged: window.durationSeconds: 300 aggregates over five minutes exactly as '
    + 'size: 300 did, and the positive-integer bounds ride along with the renamed keys. Two '
    + 'keys on this same file deliberately do NOT move, and a sweep that renamed either has '
    + 'over-applied the rule: the error-budget burn-rate window, whose describe reads only '
    + '"Window size" and names no unit anywhere, is outside the gate population entirely; '
    + 'and the exporter batch size is a COUNT of records, not a duration, so it has no unit '
    + 'to carry. Both keep their names.',
};
