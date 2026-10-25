/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10304 — a calendar selection has the shape its `mode` reads.
 *
 * The date picker behind `ui:calendar` reads one day in `single` mode (the
 * default), a LIST of days in `multiple` mode and `{ from, to }` in `range`
 * mode. Before this card both faces declared one day only, so the mirror
 * accepted `{ mode: 'multiple', value: '2026-09-15' }` — which crashed the
 * node — and no document could select a range at all.
 *
 * Both faces now admit the three shapes at the key; the MIRROR pairs each
 * shape with its mode through a refinement on the node, on `CalendarSchema`
 * and `UiCalendarSchema` alike. The renderer half is pinned beside it in
 * `packages/components`, `calendar.selectionModes-10304.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { CalendarSchema, UiCalendarSchema } from '../zod/form.zod';
import type { CalendarSchema as TsCalendarSchema } from '../form';

const DAY = '2026-09-15';
const LIST = ['2026-09-15', new Date(2026, 8, 17)];
const RANGE = { from: '2026-09-15', to: '2026-09-17' };

const MIRRORS = [
  ['CalendarSchema', CalendarSchema, 'calendar'],
  ['UiCalendarSchema', UiCalendarSchema, 'ui:calendar'],
] as const;

type Mode = 'single' | 'multiple' | 'range' | undefined;

/** Which shape each mode reads; `undefined` is the `single` default. */
const FITS: ReadonlyArray<readonly [Mode, unknown]> = [
  [undefined, DAY],
  ['single', DAY],
  ['single', new Date(2026, 8, 15)],
  ['multiple', LIST],
  ['multiple', []],
  ['range', RANGE],
  ['range', { from: DAY }],
];

/** Every shape on every mode that does not read it. */
const MISFITS: ReadonlyArray<readonly [Mode, unknown]> = [
  [undefined, LIST],
  [undefined, RANGE],
  ['single', LIST],
  ['single', RANGE],
  ['multiple', DAY],
  ['multiple', new Date(2026, 8, 15)],
  ['multiple', RANGE],
  ['range', DAY],
  ['range', new Date(2026, 8, 15)],
  ['range', LIST],
];

const issuePaths = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('calendar selection shape follows `mode` (objectui#10304)', () => {
  for (const [name, mirror, type] of MIRRORS) {
    for (const key of ['value', 'defaultValue'] as const) {
      it(`${name}.${key}: each mode accepts the shape it reads`, () => {
        for (const [mode, selection] of FITS) {
          const parsed = mirror.safeParse({ type, mode, [key]: selection });
          expect(parsed.success, `${String(mode)} + ${JSON.stringify(selection)}`).toBe(true);
        }
      });

      it(`${name}.${key}: a shape its mode does not read is refused at that key`, () => {
        for (const [mode, selection] of MISFITS) {
          const parsed = mirror.safeParse({ type, mode, [key]: selection });
          expect(parsed.success, `${String(mode)} + ${JSON.stringify(selection)}`).toBe(false);
          expect(issuePaths(parsed), `${String(mode)} + ${JSON.stringify(selection)}`).toEqual([key]);
          expect(parsed.error?.issues[0]?.code).toBe('custom');
        }
      });
    }
  }

  it('the card\'s crash document, `multiple` + one day, is refused', () => {
    const parsed = UiCalendarSchema.safeParse({ type: 'ui:calendar', mode: 'multiple', value: DAY });
    expect(parsed.success).toBe(false);
    expect(issuePaths(parsed)).toEqual(['value']);
  });

  it('a range bound under another name is refused rather than selecting nothing', () => {
    const parsed = UiCalendarSchema.safeParse({
      type: 'ui:calendar',
      mode: 'range',
      value: { start: DAY, end: '2026-09-17' },
    });
    expect(parsed.success).toBe(false);
    expect(issuePaths(parsed)[0]).toBe('value');
  });

  it('a range without `from` is refused', () => {
    const parsed = CalendarSchema.safeParse({ type: 'calendar', mode: 'range', value: { to: DAY } });
    expect(parsed.success).toBe(false);
    expect(issuePaths(parsed)[0]).toBe('value');
  });

  it('value and defaultValue are judged independently', () => {
    const parsed = CalendarSchema.safeParse({ type: 'calendar', mode: 'multiple', value: LIST, defaultValue: DAY });
    expect(parsed.success).toBe(false);
    expect(issuePaths(parsed)).toEqual(['defaultValue']);
  });

  it('a TypeScript author can write every shape the mirror accepts', () => {
    const nodes: TsCalendarSchema[] = [
      { type: 'calendar', mode: 'single', value: DAY },
      { type: 'calendar', mode: 'multiple', value: [DAY, new Date(2026, 8, 17)] },
      { type: 'calendar', mode: 'range', defaultValue: { from: DAY, to: new Date(2026, 8, 17) } },
    ];
    for (const node of nodes) expect(CalendarSchema.safeParse(node).success).toBe(true);
  });
});
