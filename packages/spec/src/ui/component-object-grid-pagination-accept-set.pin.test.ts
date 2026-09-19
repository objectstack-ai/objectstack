// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19046] The `object-grid` arm and the view arm must agree on what a PAGE
 * SIZE is — and must keep disagreeing about whether the bag is closed.
 *
 * ## The defect this file closes
 *
 * Two arms of this package declared the same authoring member with different
 * accept sets, and renderers read the looser one:
 *
 * | arm | declaration before #19046 | accepted `pageSize: 0`? |
 * |:--|:--|:--|
 * | view — `PaginationConfigSchema` (`view.zod.ts`) | `z.number().int().positive().default(25)` | no |
 * | grid component — `ComponentPropsMap['object-grid']` | `pagination: z.unknown()`, `pageSize: z.number()` | YES, both |
 *
 * The view arm pins its refusals BY NAME ('should reject negative pageSize' /
 * 'should reject zero pageSize', `view.test.ts`), and every other `pageSize`
 * this package declares is bounded with its own throwing pin
 * (`kernel/metadata-plugin.zod.ts`, `marketplace/marketplace.zod.ts`) — so the
 * component arm was the outlier, not the norm. It was not theoretical:
 * objectui#9853 measured an authored `pagination.pageSize: 0` reaching
 * `ObjectGrid`, going out on the wire as `$top: 0` and rendering ZERO ROWS,
 * through this arm. objectui#9896 repaired the consumer half; this is the
 * declaration half.
 *
 * ## The two halves of this pin, and why the second one is not optional
 *
 * 1. **The page-size accept sets are now one set.** §1 and §2 assert the
 *    refusals by name on the component arm, each beside a LIT CONTROL that a
 *    legal value still parses — a refusal pin with no lit control passes just
 *    as well when the door has stopped accepting anything at all.
 * 2. **The bag is still OPEN.** §3 asserts a sibling key inside `pagination`
 *    still parses and survives byte-identically. The honest fix for §1 is a
 *    bound on two members; closing the bag would refuse every sibling key this
 *    door has accepted since it was written — the `…` in its own describe says
 *    authors write them — which is a WIDER narrowing than the measured defect
 *    and a different decision. Without §3 that widening lands silently, since
 *    every §1 assertion passes under it too.
 *
 * §4 states the cross-arm agreement and the cross-arm asymmetry as one table:
 * on a page-size VALUE the two arms answer identically; on an unknown KEY they
 * deliberately answer differently (`PaginationConfigSchema` is a `strictObject`
 * — `view-union-retirement-prescription.test.ts` §3 pins its `unrecognized_keys`
 * — and the component bag is a `z.looseObject`). A future author harmonising
 * the two arms 'for consistency' reds §3 and §4 rather than discovering the
 * consequence in a renderer.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap } from './component.zod';
import { PaginationConfigSchema } from './view.zod';

const grid = () => ComponentPropsMap['object-grid'];

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

/** Every value that is not a page size, with the issue code each one must raise. */
const NOT_A_PAGE_SIZE: ReadonlyArray<readonly [label: string, value: unknown, code: string]> = [
  ['zero', 0, 'too_small'],
  ['negative', -10, 'too_small'],
  ['non-integer', 25.5, 'invalid_type'],
];

// ───────────────────────────────────────────────────────────────────────────
// §1 `pagination.pageSize` — the member the measured defect came through.
// ───────────────────────────────────────────────────────────────────────────

describe('§1 object-grid `pagination.pageSize` refuses what the view arm refuses', () => {
  it('should reject zero pageSize', () => {
    const r = grid().safeParse({ pagination: { pageSize: 0 } });
    expect(r.success).toBe(false);
    expect(issues(r)).toContainEqual({ code: 'too_small', path: 'pagination.pageSize' });
  });

  it('should reject negative pageSize', () => {
    const r = grid().safeParse({ pagination: { pageSize: -10 } });
    expect(r.success).toBe(false);
    expect(issues(r)).toContainEqual({ code: 'too_small', path: 'pagination.pageSize' });
  });

  it('should reject non-integer pageSize', () => {
    const r = grid().safeParse({ pagination: { pageSize: 25.5 } });
    expect(r.success).toBe(false);
    expect(issues(r)).toContainEqual({ code: 'invalid_type', path: 'pagination.pageSize' });
  });

  it('LIT CONTROL — a legal pageSize still parses and is preserved', () => {
    const r = grid().safeParse({ objectName: 'showcase_task', pagination: { pageSize: 50 } });
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data.pagination).toStrictEqual({ pageSize: 50 });
  });

  it('should reject zero values in pageSizeOptions', () => {
    const r = grid().safeParse({ pagination: { pageSize: 25, pageSizeOptions: [10, 0, 50] } });
    expect(r.success).toBe(false);
    expect(issues(r)).toContainEqual({ code: 'too_small', path: 'pagination.pageSizeOptions.1' });
  });

  it('should reject negative values in pageSizeOptions', () => {
    const r = grid().safeParse({ pagination: { pageSize: 25, pageSizeOptions: [10, -25, 50] } });
    expect(r.success).toBe(false);
    expect(issues(r)).toContainEqual({ code: 'too_small', path: 'pagination.pageSizeOptions.1' });
  });

  it('LIT CONTROL — the whole ruled bag parses, options included', () => {
    const bag = { pageSize: 50, pageSizeOptions: [25, 50, 100] };
    const r = grid().safeParse({ pagination: bag });
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data.pagination).toStrictEqual(bag);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the FLAT shorthand — the second door onto the same renderer read.
// ───────────────────────────────────────────────────────────────────────────

describe('§2 object-grid flat `pageSize` shorthand carries the same accept set', () => {
  for (const [label, value, code] of NOT_A_PAGE_SIZE) {
    it(`should reject ${label} pageSize on the flat shorthand`, () => {
      const r = grid().safeParse({ pageSize: value });
      expect(r.success).toBe(false);
      expect(issues(r)).toContainEqual({ code, path: 'pageSize' });
    });
  }

  it('LIT CONTROL — the flat shorthand still parses and keeps its value', () => {
    const r = grid().safeParse({ objectName: 'showcase_task', pageSize: 25, showPagination: true });
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data.pageSize).toBe(25);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 THE OPENNESS PIN — what #19046 deliberately did NOT narrow.
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the `pagination` bag stays open — the narrowing did not reach sibling keys', () => {
  it('a sibling key inside the bag parses, with no `unrecognized_keys` issue', () => {
    const bag = { pageSize: 25, position: 'bottom' };
    const r = grid().safeParse({ pagination: bag });
    expect(issues(r)).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('and it survives the parse byte-identically — passed through, not stripped', () => {
    const bag = { pageSize: 25, position: 'bottom', mode: { server: true } };
    const r = grid().safeParse({ pagination: bag });
    expect(r.success && r.data.pagination).toStrictEqual(bag);
  });

  it('a bag carrying ONLY sibling keys parses — no page-size member is required', () => {
    const bag = { position: 'bottom' };
    const r = grid().safeParse({ pagination: bag });
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data.pagination).toStrictEqual(bag);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 CROSS-ARM — one accept set for the VALUE, two verdicts for a KEY.
// ───────────────────────────────────────────────────────────────────────────

describe('§4 the two arms agree on a page size and disagree on openness, both on purpose', () => {
  for (const [label, value] of NOT_A_PAGE_SIZE) {
    it(`both arms refuse a ${label} pageSize — the disagreement #19046 closes`, () => {
      expect(PaginationConfigSchema.safeParse({ pageSize: value }).success, 'view arm').toBe(false);
      expect(grid().safeParse({ pagination: { pageSize: value } }).success, 'component arm').toBe(false);
    });
  }

  it('LIT CONTROL — both arms accept the same legal page size', () => {
    expect(PaginationConfigSchema.safeParse({ pageSize: 50 }).success, 'view arm').toBe(true);
    expect(grid().safeParse({ pagination: { pageSize: 50 } }).success, 'component arm').toBe(true);
  });

  it('an unknown KEY is refused by the view arm and accepted by the component bag', () => {
    const bag = { pageSize: 25, position: 'bottom' };
    const view = PaginationConfigSchema.safeParse(bag);
    expect(view.success, 'the view arm is a strictObject and stays closed').toBe(false);
    expect(issues(view).map((i) => i.code)).toContain('unrecognized_keys');
    expect(grid().safeParse({ pagination: bag }).success, 'the component bag stays open').toBe(true);
  });
});
