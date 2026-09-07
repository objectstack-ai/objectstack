// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-event-bus-retention-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'the two event-bus retention windows whose name carried no unit: '
    + 'EventPersistence.retention (kernel/events/handlers.zod.ts) and '
    + 'EventSourcingConfig.retention (kernel/events/queue.zod.ts)',
  replacement: 'retentionDays on both — rename each key; both values are unchanged, and so is '
    + 'the 365 default on EventSourcingConfig',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'What makes these two one entry rather than two is the neighbour they share and the one '
    + 'they do not. Both hang off EventBusConfig, so an author configuring a bus met the same '
    + 'bare word twice and had to learn the unit twice; and on EventSourcingConfig the bare '
    + 'retention sits two keys below snapshotRetention, which is a COUNT of snapshots to keep, '
    + 'not a span of time. `retention: 365` and `snapshotRetention: 10` read as the same kind '
    + 'of number and are not. Suffixing the duration separates the families at the authoring '
    + 'site; snapshotRetention keeps its name, because a count has no unit to carry. Both are '
    + 'retiredKey() tombstones — neither shape is strict, so a bare deletion would strip in '
    + 'silence. Why a semantic entry and not a D2 conversion: an EventBusConfig is the event '
    + 'bus construction argument a host builds in code (stack.zod.ts declares no eventBus key '
    + 'and no metadata kind is bound to one), so it is never a stack collection member and '
    + 'never a stored sys_metadata row, and the conversion chain has no seam that would see '
    + 'one. That is what ruling B prescribes for a key that is not authorable metadata, and '
    + 'the disposition the epoch-instant renames on this same kernel took '
    + '(epoch-instant-keys-renamed). #15678, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every EventPersistenceSchema.parse(…) / EventSourcingConfigSchema.parse(…) site and every '
    + 'literal handed to an event bus spells retentionDays; authoring either old spelling fails '
    + 'to compile (input type `never`) and fails to parse with the rename prescription. '
    + 'Behaviour is unchanged in both cases: a bus configured with `retentionDays: 90` keeps '
    + 'events for ninety days exactly as `retention: 90` did, and a config that omits the key '
    + 'still gets the 365 default on EventSourcingConfig. The positive-integer bound rides '
    + 'along with the renamed key, so a zero or negative window is still refused — the pin '
    + 'covering that in kernel/events.test.ts was moved onto the new spelling rather than '
    + 'dropped.',
};
