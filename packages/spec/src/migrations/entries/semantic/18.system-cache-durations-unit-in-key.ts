// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-cache-durations-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'the two cache durations whose name carried no unit: CacheTier.ttl and '
    + 'CacheAvalanchePrevention.circuitBreaker.resetTimeout (system/cache.zod.ts)',
  replacement: 'ttlSeconds and resetTimeoutSeconds — rename each key; both values, the 300 '
    + 'TTL default and the 30 reset default are unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'These two are one entry because they are one file and one authoring session: a '
    + 'cache tier and the avalanche-prevention block that protects it. Each sat beside a '
    + 'number in a DIFFERENT unit with nothing at the authoring site to separate them — '
    + 'CacheTier.ttl (seconds) beside maxSize (megabytes), and circuitBreaker.resetTimeout '
    + '(seconds) beside lockout.lockTimeoutMs (milliseconds) on the very same schema. That '
    + 'last pair is the sharpest case on this file: one shape already carried both '
    + 'conventions, and the suffixed one was the honest half. Both are retiredKey() '
    + 'tombstones; neither shape is strict, so a bare deletion would strip in silence and '
    + 'the unknown-key error could not carry the rename. Why a semantic entry and not a D2 '
    + 'conversion: stack.zod.ts declares no cache collection, and neither a cache tier nor '
    + 'an avalanche-prevention block is a registered metadata kind stored as a sys_metadata '
    + 'row, so the conversion chain has no seam that would see one. #15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every author of a CacheTier spells ttlSeconds and every author of a '
    + 'CacheAvalanchePrevention spells circuitBreaker.resetTimeoutSeconds. Authoring either '
    + 'old spelling fails to compile (input type `never`) and fails to parse with the rename '
    + 'prescription rather than a bare unrecognized-key error. Behaviour is unchanged: a tier '
    + 'given ttlSeconds: 600 expires after ten minutes exactly as ttl: 600 did, an omitted '
    + 'key still defaults to 300, and resetTimeoutSeconds still defaults to 30. One thing '
    + 'this rename deliberately does NOT touch: lockout.lockTimeoutMs keeps its name and its '
    + 'MILLISECOND unit — the two timeouts on this schema were never the same unit and must '
    + 'not be migrated as if they were.',
};
