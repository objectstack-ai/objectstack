// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-worker-queue-rate-limit-duration-unit-in-key',
  surface: 'QueueConfig.rateLimit.duration, the worker rate-limit window whose name carried '
    + 'no unit (system/worker.zod.ts)',
  replacement: 'durationMs — rename the key; the value is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'It stands alone because it is the only offender left on its file, and the file itself '
    + 'is what makes it a drift rather than a convention: TaskResult.durationMs, declared '
    + 'ninety lines earlier in the SAME source, already spelled the identical measurement '
    + 'with its unit. One file, one unit, two spellings, and the correct one was already '
    + 'there — so this rename removes an internal inconsistency rather than imposing an '
    + 'external one. Tombstoned with retiredKey(); the shape is not strict, so a bare '
    + 'deletion would strip in silence and a queue would fall back to no rate limit at all '
    + 'without an error. Why a semantic entry and not a D2 conversion: stack.zod.ts declares '
    + 'jobs, not queues, so a QueueConfig is worker host configuration rather than a stack '
    + 'collection member or a stored sys_metadata row, and the conversion chain has no seam '
    + 'that would see it. #15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every queue declaration spells rateLimit.durationMs. Authoring rateLimit.duration fails '
    + 'to compile (input type `never`) and fails to parse with the rename prescription rather '
    + 'than silently dropping the window and leaving the queue unthrottled. Behaviour is '
    + 'unchanged: { max: 100, durationMs: 60000 } is a hundred tasks a minute exactly as '
    + '{ max: 100, duration: 60000 } was, and the positive-integer bound rides along with the '
    + 'renamed key. The sibling max is a COUNT and keeps its name — it has no unit to carry.',
};
