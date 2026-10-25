/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `'agenda'` leaves `CalendarViewMode` and
 * `CalendarViewModeSchema` (objectui#5740, the value-level residue of
 * objectui#5667's key-level convergence on the `calendar-view` renderer's
 * measured read set).
 *
 * The declared union named `'agenda'`, but the registered renderer's `view`
 * input declares `enum: ['month','week','day']`, `resolveAuthoredView`
 * resolves any off-enum value to `undefined` (the component's `'month'`
 * default), and `CalendarView` renders no agenda view — so an author writing
 * the type-legal, zod-valid `view: 'agenda'` got a month calendar with no
 * error. Declared ≠ enforced, on a published surface (ADR-0049).
 *
 * ⚠️ Unlike #5667's key retirements, this one NARROWS the accept set: `view`
 * is a DECLARED key, and declared keys are validated even under
 * `.passthrough()`, so `view: 'agenda'` — which parsed green before — is now
 * a validation error. That is exactly why the zod half is pinned by the
 * REFUSAL ENVELOPE (a `view`-path `invalid_value` issue naming the surviving
 * vocabulary) rather than a bare `success === false`, and why the passthrough
 * control below pins that the rejection is declared-key validation, not a
 * strictness change. The TS half erases at runtime, so it is pinned with
 * `@ts-expect-error`, which is real enforcement here because
 * `packages/types/tsconfig.test.json` is chained from this package's
 * `type-check` script (#3009).
 *
 * The runtime resolver is deliberately NOT changed: an off-union value in raw
 * metadata still falls back to `'month'` at the renderer boundary
 * (`calendar-view-renderer.propsContract.test.tsx` pins that branch).
 */

import { describe, it, expect } from 'vitest';
import { CalendarViewModeSchema, CalendarViewSchema } from '../zod/complex.zod.js';
import type { CalendarViewMode } from '../complex.js';

/** The retired value, and the survivors the renderer actually renders. */
const RETIRED = 'agenda';
const SURVIVORS = ['month', 'week', 'day'] as const;

describe('CalendarViewModeSchema — the shared enum no longer offers the retired value', () => {
  it('is exactly the rendered set', () => {
    expect(CalendarViewModeSchema.options).toEqual([...SURVIVORS]);
  });

  it('rejects the retired value with an invalid_value issue', () => {
    const result = CalendarViewModeSchema.safeParse(RETIRED);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0].code).toBe('invalid_value');
  });
});

describe('CalendarViewSchema.view — the NEW rejection this retirement creates', () => {
  it("rejects `view: 'agenda'` on the `view` path, where it previously parsed green", () => {
    const result = CalendarViewSchema.safeParse({ type: 'calendar-view', view: RETIRED });

    expect(result.success).toBe(false);
    if (result.success) return;

    // The envelope, not just the verdict: exactly one issue, on the `view`
    // path, coded as a closed-vocabulary violation. A bare `success === false`
    // would also pass if the node had been rejected for an unrelated reason.
    //
    // The offending value is deliberately NOT asserted to appear in the
    // message: measured on zod 4, an `invalid_value` issue carries the ALLOWED
    // `values` and no echo of the input.
    const viewIssues = result.error.issues.filter((i) => i.path.join('.') === 'view');
    expect(viewIssues).toHaveLength(1);
    expect(viewIssues[0].code).toBe('invalid_value');

    // The shrink, read off the refusal: the retired value is gone from the
    // offered vocabulary and every survivor is still in it.
    const offered = (viewIssues[0] as { values?: unknown[] }).values ?? [];
    expect(offered).not.toContain(RETIRED);
    for (const survivor of SURVIVORS) expect(offered).toContain(survivor);
  });

  it('still accepts every rendered view mode in full', () => {
    // Full green parses, not merely "no `view` issue": a value-level shrink
    // that quietly invalidated a survivor would otherwise go unseen.
    for (const survivor of SURVIVORS) {
      const result = CalendarViewSchema.safeParse({ type: 'calendar-view', view: survivor });
      expect(result.success).toBe(true);
    }
  });

  it('passthrough control: an UNDECLARED key still parses — the rejection above is declared-key validation, not a strictness change', () => {
    // `BaseSchema` is `.passthrough()`. This pin keeps the two facts apart:
    // unknown keys pass (unchanged since #5667), while a declared key's value
    // is validated (the new rejection above). If this control ever reds, the
    // schema's strictness changed — a different contract decision than #5740.
    const result = CalendarViewSchema.safeParse({
      type: 'calendar-view',
      someUndeclaredKey: RETIRED,
    });
    expect(result.success).toBe(true);
  });
});

describe('the published TS twin no longer offers the retired value', () => {
  it('`CalendarViewMode` rejects it at compile time and keeps the survivors', () => {
    // @ts-expect-error — 'agenda' left the union (objectui#5740).
    const retired: CalendarViewMode = RETIRED;
    expect(retired).toBe(RETIRED);

    const survivors: CalendarViewMode[] = [...SURVIVORS];
    expect(survivors).toEqual([...SURVIVORS]);
  });
});
