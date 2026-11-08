// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { flowStartScheduleReadsNothing } from '@objectstack/spec/automation';
import { normalizeSchedule } from './schedule-trigger.js';

/**
 * [#31224 B1] The flow parse refuses a start-node `config.schedule` this
 * reader reads nothing from (`flowStartConfigRefusals`, `@objectstack/spec`),
 * through a predicate that mirrors {@link normalizeSchedule} branch for
 * branch. If the two drift, the parse either refuses a schedule that runs or
 * accepts one that never binds, so they are pinned together here, over every
 * form either side distinguishes.
 */
const SHAPES: unknown[] = [
  '0 8 * * *', '', '   ',
  { type: 'cron', expression: '0 8 * * *' }, { type: 'cron', expression: '' }, { type: 'cron' },
  { type: 'cron', cron: '0 8 * * *' }, { type: 'cron', expression: { dialect: 'cron', source: '0 8 * * *' } },
  { cron: '0 8 * * *' }, { expression: '0 8 * * *' }, { expression: '', cron: '0 8 * * *' }, { cron: '' },
  { type: 'interval', intervalMs: 60000 }, { type: 'interval', intervalMs: 0 }, { type: 'interval', intervalMs: -1 },
  { type: 'interval', every: 60000 }, { type: 'interval' }, { intervalMs: 60000 }, { every: 60000 },
  { intervalMs: -1, every: 60000 }, { intervalMs: 0, every: 60000 }, { every: Number.NaN },
  { type: 'once', at: '2027-01-01T08:00:00Z' }, { type: 'once', at: '' }, { type: 'once' }, { at: '2027-01-01T08:00:00Z' },
  { type: 'hourly' }, { type: 7, cron: '0 8 * * *' }, { cadence: 'daily' }, {}, [], 42, true,
];

describe('flowStartScheduleReadsNothing ⇔ normalizeSchedule(x) === null', () => {
  for (const shape of SHAPES) {
    it(JSON.stringify(shape) ?? String(shape), () => {
      expect(flowStartScheduleReadsNothing(shape)).toBe(normalizeSchedule(shape) === null);
    });
  }

  it('an absent schedule is not a written one: neither side binds it, and the parse does not refuse it', () => {
    expect(normalizeSchedule(undefined)).toBeNull();
    expect(flowStartScheduleReadsNothing(undefined)).toBe(false);
  });
});
