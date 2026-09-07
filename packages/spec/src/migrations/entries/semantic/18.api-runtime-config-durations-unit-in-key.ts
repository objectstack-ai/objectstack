// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'api-runtime-config-durations-unit-in-key',
  surface: 'two api-layer runtime configuration durations whose name carried no unit: '
    + 'DataLoaderConfig.cacheTtl (api/contract.zod.ts) and RouteDefinition.timeout '
    + '(api/router.zod.ts)',
  replacement: 'cacheTtlSeconds (seconds) and timeoutMs (milliseconds) — rename each key; both '
    + 'values are unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'Two keys on two shapes, in one entry because they share a disposition and an audience: '
    + 'both are api-layer runtime configuration a host or plugin builds in code, and neither is '
    + 'part of a published metadata document. DataLoaderConfig.cacheTtl named seconds only in its '
    + 'describe on a batching config whose other numbers are counts (maxBatchSize, '
    + 'maxConcurrency); RouteDefinition.timeout said "Execution timeout in ms" in prose and '
    + 'nothing else. Both are retiredKey() tombstones — neither shape is strict, so a bare '
    + 'deletion would strip the old key in silence and an unknown-key error could not carry the '
    + 'rename. Why a semantic entry and not a D2 conversion: a DataLoaderConfig is a per-request '
    + 'batch-loader construction argument and a RouteDefinition is a router registration built by '
    + 'a plugin at start — neither is a stack collection member and neither is ever stored, so the '
    + 'chain has no seam that would run on them (the kernel/Manifest:loading precedent). Worth '
    + 'knowing while grepping: packages/runtime declares its OWN local RouteDefinition interface '
    + 'for the ai:routes hook payload — a different type with no duration key at all, untouched by '
    + 'this rename. #15677, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every DataLoaderConfigSchema.parse(…) and RouteDefinitionSchema.parse(…) site spells '
    + '`cacheTtlSeconds` / `timeoutMs`; authoring either old spelling fails to compile (input type '
    + '`never`) and fails to parse with the rename prescription naming the suffixed key. A '
    + 'DataLoader configured with `cacheTtlSeconds: 60` expires per-request cache entries after 60 '
    + 'seconds exactly as `cacheTtl: 60` did, and its `min(0)` bound rides along, so a negative '
    + 'TTL is still refused. A route declared with `timeoutMs: 30000` aborts after 30 seconds '
    + 'exactly as `timeout: 30000` did.',
};
