// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `object-grid`'s `singleClickEdit` RETIRED (#36270) — ADR-0049
 * enforce-or-remove through the ADR-0087 D2 route, on the maintainer's ruling
 * A (one editing model). A grid that renders editable now selects a cell first
 * and opens its editor on double-click, Enter, F2 or typing, so the key has no
 * single-click entry left to switch. In the same change `keyboardNavigation`'s
 * describe narrows to what is enforced.
 *
 * - §1 THE TOMBSTONE: the key is refused with its prescription at both
 *   channels (`tsc` and the parse), whatever its value, and `editable` still
 *   parses.
 * - §2 THE NARROWED DESCRIBE: `keyboardNavigation` no longer promises that
 *   `false` turns the navigation off on an editable grid.
 * - §3 THE REGISTRATION: the conversion's delete, and the ADR-0087 entries the
 *   upgrade path reads.
 *
 * The tree-scoped absence half is `object-grid-single-click-edit-retirement.test.ts`
 * (the `repo` project).
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap, ObjectGridPropsSchema, type ObjectGridProps } from './component.zod';
import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

const GRID = () => ComponentPropsMap['object-grid'];
const BASE = { objectName: 'task' } as const;

function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

const PRESCRIPTION =
  /^`object-grid` property `singleClickEdit` was removed in @objectstack\/spec 18\.7\.0 \(ADR-0049\) — a grid that renders editable now selects a cell.*Delete the key; `editable`.*Run `os migrate meta --from 17`/s;

describe('§1 `singleClickEdit` is retired to a tombstone', () => {
  for (const value of [true, false]) {
    it(`refuses singleClickEdit: ${value} with the prescription, at the key`, () => {
      const r = GRID().safeParse({ ...BASE, editable: true, singleClickEdit: value });
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code: 'invalid_type', path: 'singleClickEdit' }]);
      expect(r.success ? '' : r.error.issues[0]!.message).toMatch(PRESCRIPTION);
    });
  }

  for (const editable of [true, false]) {
    it(`keeps editable: ${editable}, byte-identical (control)`, () => {
      const r = GRID().safeParse({ ...BASE, editable });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, editable });
    });
  }

  it('does not materialize the retired key on a clean parse', () => {
    expect(GRID().parse({ ...BASE, editable: true })).not.toHaveProperty('singleClickEdit');
  });

  it('is refused by tsc as well (the input type is never)', () => {
    // @ts-expect-error — `singleClickEdit` is a retiredKey tombstone: its input type is `never`.
    const props: ObjectGridProps = { objectName: 'task', editable: true, singleClickEdit: true };
    expect(GRID().safeParse(props).success).toBe(false);
  });
});

describe('§2 `keyboardNavigation` describes what is enforced', () => {
  const describeOf = () => ObjectGridPropsSchema.shape.keyboardNavigation.description ?? '';

  it('says the navigation is always on for a grid that renders editable', () => {
    expect(describeOf()).toMatch(/Always on when the grid renders editable/);
    expect(describeOf()).toMatch(/unless this is `true`/);
  });

  it('no longer promises that `false` turns it off on an editable grid', () => {
    expect(describeOf()).not.toMatch(/`false` turns it off/);
  });
});

describe('§3 the conversion and the ADR-0087 entries', () => {
  const CONVERSION_ID = 'object-grid-single-click-edit-removed';
  const grid = (type: string, properties: Record<string, unknown>) => ({
    pages: [{ name: 'desk', regions: [{ name: 'main', components: [{ type, id: 'g', properties }] }] }],
  });
  const propsOf = (stack: Record<string, unknown>) =>
    ((stack.pages as Array<{ regions: Array<{ components: Array<{ properties: unknown }> }> }>)[0]!
      .regions[0]!.components[0]!.properties);
  const convert = (properties: Record<string, unknown>, type = 'object-grid') => {
    const { stack, notices } = collectConversionNotices(grid(type, properties), { includeRetired: true });
    return { properties: propsOf(stack), notices: notices.filter((n) => n.conversionId === CONVERSION_ID) };
  };

  for (const value of [true, false]) {
    it(`deletes singleClickEdit: ${value} and keeps editable`, () => {
      const { properties, notices } = convert({ objectName: 'task', editable: true, singleClickEdit: value });
      expect(properties).toStrictEqual({ objectName: 'task', editable: true });
      expect(notices).toHaveLength(1);
    });
  }

  it('leaves a grid without the key, and the same key on another component, untouched', () => {
    expect(convert({ objectName: 'task', editable: true })).toStrictEqual({
      properties: { objectName: 'task', editable: true },
      notices: [],
    });
    expect(convert({ objectName: 'task', singleClickEdit: true }, 'object-kanban').notices).toEqual([]);
  });

  it('is retired from the load path, and wired into step 18 beside its D3 entry and the retired-key row', () => {
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion?.toMajor).toBe(18);
    expect(conversion?.retiredFromLoadPath).toBe(true);
    const step = MIGRATIONS_BY_MAJOR[18]!;
    expect(step.conversionIds).toContain(CONVERSION_ID);
    expect(step.semantic.map((s) => s.id)).toContain('object-grid-single-click-edit-retired');
    expect(step.rationale).toMatch(/retires `object-grid`'s `singleClickEdit`/);
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/ObjectGridProps:singleClickEdit');
  });
});
