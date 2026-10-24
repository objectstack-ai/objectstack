// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12779 — the start group's Cron schedule field reads every cadence
 * form the engine runs, and its write stores a descriptor that resolves to the
 * cron it then shows.
 *
 * The table of forms below is the engine's: `normalizeSchedule` in objectstack
 * `packages/triggers/trigger-schedule/src/schedule-trigger.ts` (read at
 * objectstack `570c7a2d95`), which the schedule trigger and the time-relative
 * sweep both call on a start node's `config.schedule`. Each row names what that
 * function returns for the stored value; `normalizeScheduleCadence` mirrors it
 * because this package takes no dependency on a `@objectstack/trigger-*`
 * package. The write cases assert the stored descriptor itself, not only its
 * resolution, so they do not lean on the mirror alone.
 *
 * The rendered half (the read-only interval and once reading, and the field's
 * write through the inspector) is pinned in
 * `FlowNodeInspector.scheduleCadence-12779.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import {
  fieldsForNodeType,
  getFieldValue,
  normalizeScheduleCadence,
  readOnlyScheduleCadence,
  scheduleWithExpression,
} from './flow-node-config';

const expr = fieldsForNodeType('start').find((f) => f.id === 'schedule.expression')!;
const startWith = (config: Record<string, unknown>) => ({ id: 'start', type: 'start', config });

/** Every stored form, and what the engine's `normalizeSchedule` returns for it. */
const FORMS: Array<{ name: string; stored: unknown; engine: unknown }> = [
  { name: 'a bare cron string', stored: '0 8 * * *', engine: { type: 'cron', expression: '0 8 * * *' } },
  { name: 'a blank string', stored: '   ', engine: null },
  { name: 'typed { expression }', stored: { type: 'cron', expression: '0 7 * * *' }, engine: { type: 'cron', expression: '0 7 * * *' } },
  {
    name: 'typed { expression } with a timezone',
    stored: { type: 'cron', expression: '0 7 * * *', timezone: 'Asia/Shanghai' },
    engine: { type: 'cron', expression: '0 7 * * *', timezone: 'Asia/Shanghai' },
  },
  { name: 'untyped { expression }', stored: { expression: '0 6 * * *' }, engine: { type: 'cron', expression: '0 6 * * *' } },
  { name: 'typed { cron }', stored: { type: 'cron', cron: '0 5 * * *' }, engine: { type: 'cron', expression: '0 5 * * *' } },
  { name: 'untyped { cron }', stored: { cron: '0 4 * * *' }, engine: { type: 'cron', expression: '0 4 * * *' } },
  {
    name: '{ expression } beside { cron }: expression wins',
    stored: { expression: '0 3 * * *', cron: '0 2 * * *' },
    engine: { type: 'cron', expression: '0 3 * * *' },
  },
  { name: 'typed cron with no value', stored: { type: 'cron' }, engine: null },
  { name: 'typed { intervalMs } (the showcase)', stored: { type: 'interval', intervalMs: 60000 }, engine: { type: 'interval', intervalMs: 60000 } },
  { name: 'untyped { intervalMs }', stored: { intervalMs: 30000 }, engine: { type: 'interval', intervalMs: 30000 } },
  { name: 'untyped { every }', stored: { every: 5000 }, engine: { type: 'interval', intervalMs: 5000 } },
  { name: 'a non-positive interval', stored: { type: 'interval', intervalMs: -1 }, engine: null },
  { name: 'typed { at }', stored: { type: 'once', at: '2026-12-01T08:00:00Z' }, engine: { type: 'once', at: '2026-12-01T08:00:00Z' } },
  { name: 'untyped { at }', stored: { at: '2026-12-01T08:00:00Z' }, engine: { type: 'once', at: '2026-12-01T08:00:00Z' } },
  {
    name: 'an interval type beside an expression: the type wins',
    stored: { type: 'interval', intervalMs: 60000, expression: '0 8 * * *' },
    engine: { type: 'interval', intervalMs: 60000 },
  },
  { name: 'an unknown type', stored: { type: 'weekly', expression: '0 8 * * *' }, engine: null },
  { name: 'a number', stored: 60000, engine: null },
];

describe("the engine's cadence forms (normalizeSchedule, objectui#12779)", () => {
  for (const form of FORMS) {
    it(`${form.name} resolves as the engine resolves it`, () => {
      expect(normalizeScheduleCadence(form.stored)).toEqual(form.engine);
    });
  }
});

describe('the Cron schedule field reads every cron form as its cron (objectui#12779)', () => {
  const cases: Array<[string, unknown, string]> = [
    ['a bare string', '0 8 * * *', '0 8 * * *'],
    ['a typed { cron }', { type: 'cron', cron: '0 5 * * *' }, '0 5 * * *'],
    ['an untyped { cron }', { cron: '0 4 * * *' }, '0 4 * * *'],
    ['an untyped { expression }', { expression: '0 6 * * *' }, '0 6 * * *'],
  ];
  for (const [name, schedule, cron] of cases) {
    it(`${name} reads as its cron and draws as an editable cron`, () => {
      const node = startWith({ schedule });
      expect(getFieldValue(node, expr)).toBe(cron);
      expect(readOnlyScheduleCadence(node, expr)).toBeUndefined();
    });
  }

  it('CONTROL: a typed cron with a timezone reads its expression, unchanged', () => {
    const node = startWith({ schedule: { type: 'cron', expression: '0 7 * * *', timezone: 'Asia/Shanghai' } });
    expect(getFieldValue(node, expr)).toBe('0 7 * * *');
  });

  it('CONTROL: a legacy flat config.cron still reads through the fallback', () => {
    expect(getFieldValue(startWith({ cron: '0 7 * * *' }), expr)).toBe('0 7 * * *');
    // Without the fallback declared, the flat key is not read: the engine never reads it.
    expect(getFieldValue(startWith({ cron: '0 7 * * *' }), { ...expr, fallbackPath: undefined })).toBeUndefined();
  });

  it('an empty node reads nothing', () => {
    expect(getFieldValue(startWith({}), expr)).toBeUndefined();
    expect(getFieldValue({ id: 'start', type: 'start' }, expr)).toBeUndefined();
  });
});

describe('an interval or once cadence is read as what it is, never as a cron (objectui#12779)', () => {
  const cases: Array<[string, unknown, unknown]> = [
    ["the showcase's interval", { type: 'interval', intervalMs: 60000 }, { type: 'interval', intervalMs: 60000 }],
    ['an untyped every', { every: 5000 }, { type: 'interval', intervalMs: 5000 }],
    ['a typed once', { type: 'once', at: '2026-12-01T08:00:00Z' }, { type: 'once', at: '2026-12-01T08:00:00Z' }],
    ['an untyped once', { at: '2026-12-01T08:00:00Z' }, { type: 'once', at: '2026-12-01T08:00:00Z' }],
  ];
  for (const [name, schedule, cadence] of cases) {
    it(`${name} draws read-only, and the field holds the cadence rather than an empty cron`, () => {
      const node = startWith({ schedule });
      expect(readOnlyScheduleCadence(node, expr)).toEqual(cadence);
      expect(getFieldValue(node, expr)).toEqual(cadence);
    });
  }

  it('the read-only reading is the Cron schedule field only', () => {
    const node = startWith({ schedule: { type: 'interval', intervalMs: 60000 } });
    const other = fieldsForNodeType('start').find((f) => f.id === 'condition')!;
    expect(readOnlyScheduleCadence(node, other)).toBeUndefined();
  });
});

describe('a typed cron stores a descriptor that resolves to it (objectui#12779)', () => {
  const resolvesTo = (stored: unknown, cron: string) =>
    expect(normalizeScheduleCadence(stored)).toMatchObject({ type: 'cron', expression: cron });

  it('over a bare string, the string is replaced', () => {
    const stored = scheduleWithExpression('0 8 * * *', '0 9 * * *');
    expect(stored).toBe('0 9 * * *');
    resolvesTo(stored, '0 9 * * *');
  });

  it('over a typed { cron }, the typed cron replaces the stale cron', () => {
    const stored = scheduleWithExpression({ type: 'cron', cron: '0 5 * * *' }, '0 9 * * *');
    expect(stored).toEqual({ type: 'cron', expression: '0 9 * * *' });
    resolvesTo(stored, '0 9 * * *');
  });

  it('over an untyped { cron }, the typed cron replaces the stale cron', () => {
    const stored = scheduleWithExpression({ cron: '0 4 * * *' }, '0 9 * * *');
    expect(stored).toEqual({ expression: '0 9 * * *' });
    resolvesTo(stored, '0 9 * * *');
  });

  it('over nothing, a new { expression } is stored', () => {
    expect(scheduleWithExpression(undefined, '0 9 * * *')).toEqual({ expression: '0 9 * * *' });
    expect(scheduleWithExpression({}, '0 9 * * *')).toEqual({ expression: '0 9 * * *' });
  });

  it('over a descriptor the engine binds nothing from, the cron wins over the leftover type', () => {
    const stored = scheduleWithExpression({ type: 'interval' }, '0 9 * * *');
    expect(stored).toEqual({ expression: '0 9 * * *' });
    resolvesTo(stored, '0 9 * * *');
  });

  it('CONTROL: a typed cron with a timezone keeps its type and timezone', () => {
    const stored = scheduleWithExpression({ type: 'cron', expression: '0 7 * * *', timezone: 'Asia/Shanghai' }, '0 9 * * *');
    expect(stored).toEqual({ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' });
    expect(normalizeScheduleCadence(stored)).toEqual({ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' });
  });

  it('clearing removes the cron, or the whole schedule when nothing is left', () => {
    expect(scheduleWithExpression('0 8 * * *', '')).toBeUndefined();
    expect(scheduleWithExpression({ cron: '0 4 * * *' }, '')).toBeUndefined();
    expect(scheduleWithExpression({ expression: '0 4 * * *' }, undefined)).toBeUndefined();
    expect(scheduleWithExpression({ type: 'interval', intervalMs: 60000 }, undefined)).toBeUndefined();
    expect(scheduleWithExpression({ type: 'cron', expression: '0 7 * * *', timezone: 'UTC' }, '')).toEqual({
      type: 'cron',
      timezone: 'UTC',
    });
  });
});
