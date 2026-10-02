// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21445] `ComponentPropsMap['object-grid']` types the seven members the grid
 * reads with a fixed shape, and retires `resizableColumns` to a tombstone
 * naming `resizable`.
 *
 * ## The defect this file closes
 *
 * `rowHeight`, `aggregations`, `conditionalFormatting`, `rowColor`,
 * `navigation` and `operations` were `z.unknown()`, and `bulkActionDefs` an
 * array of it, while objectui's `ObjectGrid` reads each with one shape
 * (measured at the `.objectui-sha` pin `89cad75d55`; the read points are in
 * the row's docblock). So `rowHeight: 42` passed every door and rendered as a
 * compact grid, and every other off-shape value was substituted or dropped
 * with no report. `resizableColumns` was the second spelling of `resizable`,
 * read only when `resizable` was absent.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE DECLARED SHAPES PARSE: a value of each member's shape parses, and
 *   parses to what the shared schema itself answers. A refusal pin with no lit
 *   control passes just as well when the door refuses everything.
 * - §2 THE REFUSALS: an off-shape value of each member is refused with the
 *   code AND the path, so a refusal for the wrong reason reds.
 * - §3 ONE SCHEMA: the five members a list view also declares hold the list
 *   view's own defs by identity, and the two declared here hold exactly the
 *   measured vocabulary. A later copy of a shape reds the identity half even
 *   while it still agrees on today's corpus.
 * - §4 THE TOMBSTONE: `resizableColumns` is refused with its prescription at
 *   both channels (`tsc` and the parse), and `resizable` still parses.
 * - §5 THE REGISTRATION: the conversion's two arms, and the ADR-0087 entries
 *   the upgrade path reads.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap, ObjectGridPropsSchema, type ObjectGridProps } from './component.zod';
import { ListViewSchema, NavigationConfigSchema, RowColorConfigSchema, RowHeightSchema } from './view.zod';
import { BulkActionDefSchema } from './bulk-action.zod';
import { AggregationFunction } from '../data/query.zod';
import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

const GRID = () => ComponentPropsMap['object-grid'];
const BASE = { objectName: 'account' } as const;

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the declared shapes parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 object-grid accepts a value of each declared shape', () => {
  const BYTE_IDENTICAL: ReadonlyArray<readonly [label: string, props: Record<string, unknown>]> = [
    ['every rowHeight value', { rowHeight: 'extra_tall' }],
    ['a rowColor block', { rowColor: { field: 'status', colors: { overdue: 'red', done: 'bg-green-200' } } }],
    ['each aggregation function', {
      aggregations: [
        { field: 'id', type: 'count' },
        { field: 'amount', type: 'sum' },
        { field: 'amount', type: 'avg' },
        { field: 'amount', type: 'min' },
        { field: 'amount', type: 'max' },
        { field: 'owner_id', type: 'count_distinct' },
      ],
    }],
    ['the four operations toggles', { operations: { create: true, update: true, delete: false, export: false } }],
    ['an empty operations block (replaces the default: no row affordance)', { operations: {} }],
    ['an update bulk-action def', { bulkActionDefs: [{ name: 'close_all', label: 'Close', operation: 'update', patch: { status: 'closed' } }] }],
  ];

  for (const [label, props] of BYTE_IDENTICAL) {
    it(`parses ${label}, byte-identical`, () => {
      const r = GRID().safeParse({ ...BASE, ...props });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, ...props });
    });
  }

  for (const rowHeight of ['compact', 'short', 'medium', 'tall', 'extra_tall'] as const) {
    it(`parses rowHeight: '${rowHeight}'`, () => {
      expect(issues(GRID().safeParse({ ...BASE, rowHeight }))).toEqual([]);
    });
  }

  it('parses a navigation block to exactly what NavigationConfigSchema answers (its defaults included)', () => {
    const navigation = { mode: 'drawer', size: 'lg' };
    const r = GRID().safeParse({ ...BASE, navigation });
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data.navigation).toStrictEqual(NavigationConfigSchema.parse(navigation));
  });

  it('parses a conditional formatting rule to exactly what the list view answers (the condition envelope included)', () => {
    const conditionalFormatting = [{ condition: "record.status == 'overdue'", style: { backgroundColor: '#fee2e2' } }];
    const r = GRID().safeParse({ ...BASE, conditionalFormatting });
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data.conditionalFormatting)
      .toStrictEqual(ListViewSchema.shape.conditionalFormatting.parse(conditionalFormatting));
  });

  it('an absent member stays absent', () => {
    const r = GRID().safeParse(BASE);
    expect(issues(r)).toEqual([]);
    expect(r.success && Object.keys(r.data)).toEqual(['objectName']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the refusals
// ───────────────────────────────────────────────────────────────────────────

describe('§2 object-grid refuses an off-shape value of each member', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, props: Record<string, unknown>, code: string, path: string]> = [
    ['a numeric rowHeight', { rowHeight: 42 }, 'invalid_value', 'rowHeight'],
    ['an off-preset rowHeight', { rowHeight: 'huge' }, 'invalid_value', 'rowHeight'],
    ['a bare-string rowColor', { rowColor: 'red' }, 'invalid_type', 'rowColor'],
    ['a rowColor with no field', { rowColor: { colors: { overdue: 'red' } } }, 'invalid_type', 'rowColor.field'],
    ['a bare-string navigation', { navigation: 'drawer' }, 'invalid_type', 'navigation'],
    ['an unknown navigation mode', { navigation: { mode: 'tab' } }, 'invalid_value', 'navigation.mode'],
    ['one formatting rule written as an object', {
      conditionalFormatting: { condition: "record.status == 'overdue'", style: { color: 'red' } },
    }, 'invalid_type', 'conditionalFormatting'],
    ['an aggregations object', { aggregations: { amount: 'sum' } }, 'invalid_type', 'aggregations'],
    ['an unknown aggregation function', { aggregations: [{ field: 'amount', type: 'median' }] }, 'invalid_value', 'aggregations.0.type'],
    ['an aggregation with no field', { aggregations: [{ type: 'sum' }] }, 'invalid_type', 'aggregations.0.field'],
    ['an undeclared aggregation key', { aggregations: [{ field: 'amount', type: 'sum', label: 'Total' }] }, 'unrecognized_keys', 'aggregations.0'],
    ['a boolean operations', { operations: false }, 'invalid_type', 'operations'],
    ['a string operations toggle', { operations: { export: 'no' } }, 'invalid_type', 'operations.export'],
    ['operations.read', { operations: { read: true } }, 'unrecognized_keys', 'operations'],
    ['operations.import', { operations: { import: true } }, 'unrecognized_keys', 'operations'],
    ['a bare action name in bulkActionDefs', { bulkActionDefs: ['close_all'] }, 'invalid_type', 'bulkActionDefs.0'],
    ['a no-op custom bulk-action def', { bulkActionDefs: [{ name: 'notify_all', operation: 'custom' }] }, 'custom', 'bulkActionDefs.0.execution'],
  ];

  for (const [label, props, code, path] of REFUSED) {
    it(`refuses ${label} — ${code} at ${path}`, () => {
      const r = GRID().safeParse({ ...BASE, ...props });
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code, path }]);
    });
  }

  it('refuses an objectui-native formatting rule, naming its keys at the rule', () => {
    const r = GRID().safeParse({
      ...BASE,
      conditionalFormatting: [{ field: 'status', operator: 'equals', value: 'overdue', backgroundColor: '#fee2e2' }],
    });
    expect(r.success).toBe(false);
    expect(issues(r)).toContainEqual({ code: 'unrecognized_keys', path: 'conditionalFormatting.0' });
  });

  it('says why `operations.read` and `operations.import` are refused, not only that they are unknown', () => {
    const read = GRID().safeParse({ ...BASE, operations: { read: true } });
    expect(read.success).toBe(false);
    expect(read.success ? '' : read.error.issues[0]!.message).toMatch(/`operations\.read` has no reader on `object-grid`/);
    const imp = GRID().safeParse({ ...BASE, operations: { import: true } });
    expect(imp.success).toBe(false);
    expect(imp.success ? '' : imp.error.issues[0]!.message).toMatch(/`operations\.import` has no reader on `object-grid`/);
  });

  it('LIT CONTROL — an unknown top-level key is still refused at the row itself', () => {
    const r = GRID().safeParse({ ...BASE, rowHeight: 'tall', notAGridKey: 1 });
    expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: '' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one schema, not a copy of its shape
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the members hold the list view\'s own schemas, and the measured vocabulary', () => {
  const shape = () => ObjectGridPropsSchema.shape;

  it('rowHeight unwraps to RowHeightSchema — the same def', () => {
    expect(shape().rowHeight.unwrap()._zod.def).toBe(RowHeightSchema._zod.def);
  });

  it('rowColor unwraps to RowColorConfigSchema — the same def', () => {
    expect(shape().rowColor.unwrap()._zod.def).toBe(RowColorConfigSchema._zod.def);
  });

  it('navigation unwraps to NavigationConfigSchema — the same def', () => {
    expect(shape().navigation.unwrap()._zod.def).toBe(NavigationConfigSchema._zod.def);
  });

  it('conditionalFormatting is the list view\'s own member — the same array def', () => {
    expect(shape().conditionalFormatting.unwrap()._zod.def)
      .toBe(ListViewSchema.shape.conditionalFormatting.unwrap()._zod.def);
  });

  it('bulkActionDefs holds BulkActionDefSchema — the element the list view holds', () => {
    expect(shape().bulkActionDefs.unwrap().element._zod.def).toBe(BulkActionDefSchema._zod.def);
    expect(ListViewSchema.shape.bulkActionDefs.unwrap().element._zod.def).toBe(BulkActionDefSchema._zod.def);
  });

  it('aggregations[].type is AggregationFunction, whose members are exactly the six functions the grid computes', () => {
    const type = shape().aggregations.unwrap().element.shape.type;
    expect(type._zod.def).toBe(AggregationFunction._zod.def);
    // The grid's own vocabulary at the pin (`AggregationType` in
    // `plugin-grid/src/useGroupedData.ts`). A member added to the query AST's
    // enum widens this door past the grid's reader; this line reds first.
    expect([...AggregationFunction.options].sort()).toEqual(['avg', 'count', 'count_distinct', 'max', 'min', 'sum']);
  });

  it('operations declares exactly the four toggles a grid read point names', () => {
    expect(Object.keys(shape().operations.unwrap().shape).sort()).toEqual(['create', 'delete', 'export', 'update']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the tombstone
// ───────────────────────────────────────────────────────────────────────────

const RESIZABLE_COLUMNS_PRESCRIPTION =
  /^`object-grid` property `resizableColumns` was removed in @objectstack\/spec 17\.7\.0 \(ADR-0049\) — it was the legacy second spelling of `resizable`.*Use `resizable`\. Rename the key; the value \(a boolean\) is unchanged\./s;

describe('§4 `resizableColumns` is retired to a tombstone naming `resizable`', () => {
  for (const value of [true, false]) {
    it(`refuses resizableColumns: ${value} with the prescription, at the key`, () => {
      const r = GRID().safeParse({ ...BASE, resizableColumns: value });
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code: 'invalid_type', path: 'resizableColumns' }]);
      expect(r.success ? '' : r.error.issues[0]!.message).toMatch(RESIZABLE_COLUMNS_PRESCRIPTION);
    });
  }

  it('refuses it beside `resizable` too — no second spelling, whatever the first says', () => {
    expect(issues(GRID().safeParse({ ...BASE, resizable: true, resizableColumns: true })))
      .toEqual([{ code: 'invalid_type', path: 'resizableColumns' }]);
  });

  for (const resizable of [true, false]) {
    it(`keeps resizable: ${resizable}, the canonical spelling, byte-identical`, () => {
      const r = GRID().safeParse({ ...BASE, resizable });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, resizable });
    });
  }

  it('does not materialize the retired key on a clean parse', () => {
    expect(GRID().parse(BASE)).not.toHaveProperty('resizableColumns');
  });

  it('is refused by tsc as well (the input type is never)', () => {
    // @ts-expect-error — `resizableColumns` is a retiredKey tombstone: its input type is `never`.
    const props: ObjectGridProps = { objectName: 'account', resizableColumns: true };
    expect(GRID().safeParse(props).success).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §5 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§5 the conversion and the ADR-0087 entries', () => {
  const CONVERSION_ID = 'object-grid-resizable-columns-removed';
  const grid = (properties: Record<string, unknown>) => ({
    pages: [{ name: 'desk', regions: [{ name: 'main', components: [{ type: 'object-grid', id: 'g', properties }] }] }],
  });
  const propsOf = (stack: Record<string, unknown>) =>
    ((stack.pages as Array<{ regions: Array<{ components: Array<{ properties: unknown }> }> }>)[0]!
      .regions[0]!.components[0]!.properties);
  const convert = (properties: Record<string, unknown>) => {
    const { stack, notices } = collectConversionNotices(grid(properties), { includeRetired: true });
    return { properties: propsOf(stack), notices: notices.filter((n) => n.conversionId === CONVERSION_ID) };
  };

  it('moves the value to `resizable` when `resizable` is absent — it WAS the setting', () => {
    const { properties, notices } = convert({ objectName: 'account', resizableColumns: false });
    expect(properties).toStrictEqual({ objectName: 'account', resizable: false });
    expect(notices).toHaveLength(1);
  });

  it('deletes it when `resizable` holds a value — it was never read then', () => {
    const { properties, notices } = convert({ objectName: 'account', resizable: true, resizableColumns: false });
    expect(properties).toStrictEqual({ objectName: 'account', resizable: true });
    expect(notices).toHaveLength(1);
  });

  it('leaves a grid without the key untouched', () => {
    const { properties, notices } = convert({ objectName: 'account', resizable: false });
    expect(properties).toStrictEqual({ objectName: 'account', resizable: false });
    expect(notices).toEqual([]);
  });

  it('is retired from the load path, and wired into step 18 beside both D3 entries and the retired-key row', () => {
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion?.toMajor).toBe(18);
    expect(conversion?.retiredFromLoadPath).toBe(true);
    const step = MIGRATIONS_BY_MAJOR[18]!;
    expect(step.conversionIds).toContain(CONVERSION_ID);
    const semanticIds = step.semantic.map((s) => s.id);
    expect(semanticIds).toContain('object-grid-resizable-columns-retired');
    expect(semanticIds).toContain('ui-object-grid-row-members-typed');
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/ObjectGridProps:resizableColumns');
  });
});
