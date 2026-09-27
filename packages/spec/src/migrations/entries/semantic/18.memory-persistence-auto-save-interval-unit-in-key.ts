// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15680 (stack card of #14478, maintainer ruling B: a duration key carries its
// unit in its NAME) — the D3 entry of the
// `memory-persistence-auto-save-interval-to-ms` family (ruling B on #17152: one
// D3 entry per retirement family, even when D2 is lossless). Registered keys:
// `data/FilePersistenceConfig:autoSaveInterval` and
// `data/AutoPersistenceConfig:autoSaveInterval` — both arms of the persistence
// union, because both forward the same value to the same file adapter.
export const entry: SemanticMigration = {
  id: 'memory-persistence-auto-save-interval-unit-in-key',
  surface: 'datasource.config.persistence.autoSaveInterval on the memory driver — the file and '
    + 'auto persistence arms',
  replacement: '`autoSaveIntervalMs` — the same interval, in milliseconds, on both arms; the '
    + 'minimum of 100 and the file arm\'s 2000 default are unchanged.',
  reason: 'The D2 conversion `memory-persistence-auto-save-interval-to-ms` renames the key on both '
    + 'persistence arms of every memory-driver datasource and on stored datasource rows, keeping the '
    + 'value, and leaves a string persistence mode, a custom adapter and every other driver\'s '
    + 'config alone; the rename is lossless because the key always meant milliseconds. The '
    + 'judgment is whether each value was written in that unit. Nothing in the old name said so, '
    + 'and the auto arm\'s description named no unit at all. A seconds value below 100 was already '
    + 'refused by the bound, but one above it was not — `autoSaveInterval: 300` meant as five '
    + 'minutes saved every 300 milliseconds, and the rename keeps 300. The interval also bounds how '
    + 'much in-memory data a crash can lose, so the author is choosing a durability trade-off, not '
    + 'only a number.',
  acceptanceCriteria: 'No memory-driver datasource carries `autoSaveInterval` on either arm; the '
    + 'parse refuses it with the rename. Every `autoSaveIntervalMs` value is the interval the author '
    + 'intends in milliseconds — a store meant to save every five seconds reads '
    + '`autoSaveIntervalMs: 5000`. With file persistence on, a write followed by waiting longer than '
    + 'that interval leaves the change in the persisted file, and the author accepts losing at most '
    + 'that interval of writes on a crash.',
};
