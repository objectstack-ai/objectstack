/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10293 — `CalendarSchema.defaultValue` / `.value` cross the JSON/TS
 * boundary once (objectui#7759, ruling D1-(iii)).
 *
 * - The MIRROR's authoring type is an ISO 8601 date string. Its `z.date()`
 *   arm stays for in-process callers, the shape every settled date-value key
 *   in `form.zod.ts` already has (`DatePickerSchema`'s `defaultValue` /
 *   `value`, and this schema's own `minDate` / `maxDate`).
 * - The DECLARATION keeps `Date` and gains the ISO string, so the two faces
 *   are the same set: `Date | string`. It was `Date | Date[]`, disjoint from
 *   the mirror on the string arm and wider on the list arm, and ledgered in
 *   `zod-mirror-parity.test.ts` until this card removed the rows.
 * - The `calendar` renderer coerces the string (its own pin sits beside it in
 *   `packages/components`, `calendar.dateValueZone-10293.test.tsx`).
 *
 * The type-level half reddens under `tsc -p tsconfig.test.json` (this
 * package's `type-check`), not under vitest; the runtime half reddens here.
 *
 * objectui#10304 then made both keys mode-dependent: a list for
 * `mode: 'multiple'`, `{ from, to }` for `mode: 'range'`. The DAY this file
 * pins is unchanged — it is now the element type of every shape — and a list
 * is refused only where the mode does not read one; the per-mode pins are in
 * `calendar-selection-mode-10304.test.ts`.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { z } from 'zod';
import { CalendarSchema, UiCalendarSchema } from '../zod/form.zod';
import type { CalendarSchema as TsCalendarSchema } from '../form';

type MirrorInput = z.input< typeof CalendarSchema >;

describe('CalendarSchema date-value keys: one face on each side of the boundary (objectui#10293)', () => {
  it('the declaration and the mirror admit the same set, a `Date | string` day in every shape', () => {
    type Day = Date | string;
    type Selection = Day | Day[] | { from: Day; to?: Day } | undefined;
    expectTypeOf< TsCalendarSchema['value'] >().toEqualTypeOf< Selection >();
    expectTypeOf< TsCalendarSchema['defaultValue'] >().toEqualTypeOf< Selection >();
    expectTypeOf< MirrorInput['value'] >().toEqualTypeOf< TsCalendarSchema['value'] >();
    expectTypeOf< MirrorInput['defaultValue'] >().toEqualTypeOf< TsCalendarSchema['defaultValue'] >();
  });

  it('a TypeScript author can write the ISO string the mirror accepts', () => {
    const node: TsCalendarSchema = { type: 'calendar', value: '2026-09-15', defaultValue: '2026-09-15T09:00:00Z' };
    expect(CalendarSchema.safeParse(node).success).toBe(true);
  });

  it('the mirror accepts an ISO date-only string, an ISO date-time string and a `Date`', () => {
    for (const value of ['2026-09-15', '2026-09-15T09:00:00Z', new Date(2026, 8, 15)]) {
      expect(CalendarSchema.safeParse({ type: 'calendar', value }).success, String(value)).toBe(true);
      expect(CalendarSchema.safeParse({ type: 'calendar', defaultValue: value }).success, String(value)).toBe(true);
      expect(UiCalendarSchema.safeParse({ type: 'ui:calendar', value }).success, String(value)).toBe(true);
    }
  });

  it('the mirror refuses a list in single mode — a list is `mode: \'multiple\'` only (objectui#10304)', () => {
    const list = ['2026-09-15', '2026-09-17'];
    const parsed = CalendarSchema.safeParse({ type: 'calendar', value: list });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['value']);
  });
});
