/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `'agenda'` leaves `defaultView` on all three declaration
 * faces (objectui#5784, the `defaultView` sibling of objectui#5740's
 * retirement on `CalendarViewSchema.view`):
 *
 *   1. the `ObjectCalendarSchema` TS interface (an INLINE union, not a
 *      `CalendarViewMode` reference — which is exactly why #5740's narrowing
 *      did not move it),
 *   2. the zod `ObjectCalendarSchema`,
 *   3. the list-view `calendar` config (`CalendarConfig`, then the objectui-only
 *      `defaultView` extension of the spec's `CalendarConfigSchema`). Since
 *      objectui#6152 round 11 that block is the spec's list-view slot by
 *      reference and refuses `defaultView` by name for EVERY value, so this face
 *      no longer carries a vocabulary to retire from; its describe below pins the
 *      refusal instead.
 *
 * The enforcement points read three values: `ObjectCalendar`'s props declare
 * `defaultView?: 'month' | 'week' | 'day'`, its schema read casts to the same
 * three, and `CalendarView` renders no agenda view — so an author writing the
 * zod-valid `defaultView: 'agenda'` got a month calendar with no error.
 * Declared ≠ enforced, on a published surface (ADR-0049). The spec side
 * agrees: `@objectstack/spec`'s `ObjectCalendarProps.defaultView` is already
 * `['month', 'week', 'day']`.
 *
 * ⚠️ Like #5740 this NARROWS the accept set: `defaultView` is a DECLARED key,
 * and declared keys are validated even under `.passthrough()`, so
 * `defaultView: 'agenda'` — which parsed green before — is now a validation
 * error. The zod faces are pinned by the REFUSAL ENVELOPE (a
 * `defaultView`-path `invalid_value` issue naming the surviving vocabulary)
 * rather than a bare `success === false`, and the passthrough control pins
 * that the rejection is declared-key validation, not a strictness change. The
 * TS half erases at runtime, so it is pinned with `@ts-expect-error`, which is
 * real enforcement here because `packages/types/tsconfig.test.json` is chained
 * from this package's `type-check` script (#3009).
 *
 * The runtime read is deliberately NOT changed: `ObjectCalendar` still casts
 * an off-union raw value away and falls back to `'month'` at the renderer
 * boundary.
 */

import { describe, it, expect } from 'vitest';
import {
  ObjectCalendarSchema as ObjectCalendarZodSchema,
  ListViewSchema,
} from '../zod/objectql.zod.js';
import type { ObjectCalendarSchema } from '../objectql.js';

/** The retired value, and the survivors the renderer actually renders. */
const RETIRED = 'agenda';
const SURVIVORS = ['month', 'week', 'day'] as const;

/** Refusal-envelope assertion shared by both zod faces. */
function expectDefaultViewRefusal(
  // zod 4 types issue paths as `PropertyKey[]` (symbols admitted), so the
  // parameter must too — `(string | number)[]` fails `type-check` here.
  result: { success: boolean; error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }> } },
  path: string,
) {
  expect(result.success).toBe(false);
  if (result.success || !result.error) return;

  // The envelope, not just the verdict: exactly one issue, on the
  // `defaultView` path, coded as a closed-vocabulary violation. A bare
  // `success === false` would also pass if the node had been rejected for an
  // unrelated reason. (Measured on zod 4, an `invalid_value` issue carries the
  // ALLOWED `values` and no echo of the input — so the offending value is
  // deliberately not asserted to appear in the message.)
  const issues = result.error.issues.filter((i) => i.path.join('.') === path);
  expect(issues).toHaveLength(1);
  expect(issues[0].code).toBe('invalid_value');

  // The shrink, read off the refusal: the retired value is gone from the
  // offered vocabulary and every survivor is still in it.
  const offered = (issues[0] as { values?: unknown[] }).values ?? [];
  expect(offered).not.toContain(RETIRED);
  for (const survivor of SURVIVORS) expect(offered).toContain(survivor);
}

describe("zod ObjectCalendarSchema.defaultView — the NEW rejection this retirement creates", () => {
  it("rejects `defaultView: 'agenda'` on the `defaultView` path, where it previously parsed green", () => {
    const result = ObjectCalendarZodSchema.safeParse({
      type: 'object-calendar',
      objectName: 'events',
      defaultView: RETIRED,
    });
    expectDefaultViewRefusal(result, 'defaultView');
  });

  it('still accepts every rendered view mode in full', () => {
    // Full green parses, not merely "no `defaultView` issue": a value-level
    // shrink that quietly invalidated a survivor would otherwise go unseen.
    for (const survivor of SURVIVORS) {
      const result = ObjectCalendarZodSchema.safeParse({
        type: 'object-calendar',
        objectName: 'events',
        defaultView: survivor,
      });
      expect(result.success).toBe(true);
    }
  });

  it('passthrough control: an UNDECLARED key still parses — the rejection above is declared-key validation, not a strictness change', () => {
    // `BaseSchema` is `.passthrough()`. This pin keeps the two facts apart:
    // unknown keys pass (unchanged), while a declared key's value is validated
    // (the new rejection above). If this control ever reds, the schema's
    // strictness changed — a different contract decision than #5784.
    const result = ObjectCalendarZodSchema.safeParse({
      type: 'object-calendar',
      objectName: 'events',
      someUndeclaredKey: RETIRED,
    });
    expect(result.success).toBe(true);
  });
});

describe("ListViewSchema `calendar.defaultView` — refused by name for every value since objectui#6152 round 11", () => {
  // The list view's calendar block is the spec's slot by reference, which has
  // no `defaultView` member. 'agenda' and the three survivors are refused alike,
  // at the key's own path, by the named arm (not the spec's block-level
  // `unrecognized_keys`). The element's FLAT `defaultView` above is unaffected.
  // Full pin: `list-view-blocks-by-reference-6152.test.ts`.
  it.each([RETIRED, ...SURVIVORS])("refuses `calendar: { defaultView: '%s' }` on the `calendar.defaultView` path", (value) => {
    const result = ListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'events',
      calendar: { startDateField: 'starts_at', defaultView: value },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = result.error.issues.filter((i) => i.path.join('.') === 'calendar.defaultView');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid_type');
  });

  it('CONTROL: the same block without the key parses in full', () => {
    const result = ListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'events',
      calendar: { startDateField: 'starts_at' },
    });
    expect(result.success).toBe(true);
  });
});

describe('the published TS twin no longer offers the retired value', () => {
  it('`ObjectCalendarSchema.defaultView` rejects it at compile time and keeps the survivors', () => {
    const node: ObjectCalendarSchema = {
      type: 'object-calendar',
      objectName: 'events',
      // @ts-expect-error — 'agenda' left the inline union (objectui#5784).
      defaultView: RETIRED,
    };
    expect(node.defaultView).toBe(RETIRED);

    for (const survivor of SURVIVORS) {
      const green: ObjectCalendarSchema = {
        type: 'object-calendar',
        objectName: 'events',
        defaultView: survivor,
      };
      expect(green.defaultView).toBe(survivor);
    }
  });
});
