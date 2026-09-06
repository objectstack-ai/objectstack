// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'data-nosql-query-options-timeout-unit-in-key',
  surface: 'NoSQLQueryOptions.timeout, the per-query driver deadline whose name carried no '
    + 'unit (data/driver-nosql.zod.ts)',
  replacement: 'timeoutMs — rename the key; the value is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'It stands alone because it is the only offender on its file. The neighbour is what '
    + 'makes it a real hazard rather than a naming preference: batchSize sits directly beside '
    + 'it, a plain row COUNT with the same z.number().int().positive() shape and the same '
    + 'order of magnitude, so two adjacent bare integers meant milliseconds and documents '
    + 'respectively with nothing at the call site to separate them. Tombstoned with '
    + 'retiredKey(); the shape is not strict, so a bare deletion would strip in silence and '
    + 'the query would run with no deadline at all while its author believed one was set — '
    + 'the failure a driver timeout exists to prevent. Why a semantic entry and not a D2 '
    + 'conversion: these options are a per-call driver argument, reached only through '
    + 'AggregationPipeline.options, which no stack.zod.ts collection declares and no '
    + 'sys_metadata row stores, so the chain has no seam. #15680, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every caller that passes NoSQL query options spells timeoutMs. Authoring timeout fails '
    + 'to compile (input type `never`) and fails to parse with the rename prescription. '
    + 'Behaviour is unchanged: timeoutMs: 5000 is the same five seconds timeout: 5000 was, and '
    + 'the positive-integer bound rides along with the renamed key so a zero or negative '
    + 'deadline is still refused. Two neighbours on this same shape deliberately do NOT move, '
    + 'and a sweep that renamed either has over-applied the rule: batchSize is a COUNT of '
    + 'documents, not a duration, and consistency / projection / hint are not numbers at all.',
};
