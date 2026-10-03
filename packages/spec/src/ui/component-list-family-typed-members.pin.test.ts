// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21464, stage 2] Eight of the list family's nine `z.unknown()` members are
 * typed: `object-grid` `fields`, `selection`, `selectable`, `rowActions`,
 * `bulkActions` and `batchActions`, `object-kanban` `columns`, and
 * `object-calendar` `calendar`. The ninth, `object-grid` `columns`, is held in
 * the enumeration pin's ledger: the grid draws a column's `options`, which the
 * list view's column entry does not declare (objectstack-ai/objectui#11544).
 *
 * ## The defect this file closes
 *
 * Each renderer reads these members with one shape (measured at the
 * `.objectui-sha` pin `89cad75d55`; the read points are in the members'
 * docblocks), and each row declared them `z.unknown()`. So an object entry in
 * the grid's `fields`, a `{ name }` entry in `bulkActions`, a kanban lane list
 * mixing objects and strings and a calendar block with no `startDateField` all
 * passed the component-props gate, and the block drew no column, skipped the
 * action, drew a blank lane or placed no event, with no report.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE DECLARED SHAPES PARSE: a value of each member's shape parses, and
 *   parses to what the shared schema itself answers. A refusal pin with no lit
 *   control passes just as well when the door refuses everything.
 * - §2 THE REFUSALS: an off-shape value of each member is refused with the
 *   code AND the path — and, for the kanban's two-array union, the issue
 *   inside the arm that should have taken it — so a refusal for the wrong reason reds.
 * - §3 ONE SCHEMA: the four members a list view also declares hold the list
 *   view's own defs by identity (`batchActions` holds `bulkActions`'s), and the
 *   shapes declared here hold exactly the measured vocabulary.
 * - §4 THE REGISTRATION: the ADR-0087 D3 entry step 18 carries.
 *
 * The enumeration pin (`component-props-unknown-members.pin.test.ts`) holds the
 * other half: these eight left its ledger, so a member reverted to
 * `z.unknown()` reds there.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import {
  ComponentPropsMap,
  ObjectCalendarPropsSchema,
  ObjectGridPropsSchema,
  ObjectKanbanPropsSchema,
} from './component.zod';
import { CalendarConfigSchema, ListViewSchema, SelectionConfigSchema } from './view.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

const BASE = { objectName: 'account' } as const;
type Row = 'object-grid' | 'object-kanban' | 'object-calendar';
const parse = (row: Row, props: Record<string, unknown>) => ComponentPropsMap[row].safeParse({ ...BASE, ...props });

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

/** Inside a two-array union's refusal: each arm's issues, `code@path` relative to the member. */
function armIssues(result: z.ZodSafeParseResult<unknown>): string[][] {
  if (result.success) return [];
  const union = result.error.issues[0] as { errors?: Array<Array<{ code: string; path: PropertyKey[] }>> };
  return (union.errors ?? []).map((arm) => arm.map((i) => `${i.code}@${i.path.join('.')}`));
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the declared shapes parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 each member accepts a value of its declared shape', () => {
  const BYTE_IDENTICAL: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>]> = [
    ['grid fields', 'object-grid', { fields: ['name', 'amount'] }],
    ['each selection type', 'object-grid', { selection: { type: 'single' } }],
    ['grid rowActions', 'object-grid', { rowActions: ['edit', 'delete', 'approve'] }],
    ['grid bulkActions', 'object-grid', { bulkActions: ['delete', 'export'] }],
    ['grid batchActions', 'object-grid', { batchActions: ['approve'] }],
    ['kanban lanes with every member, a static card carrying its row values', 'object-kanban', {
      columns: [
        { id: 'todo', title: 'To Do', limit: 5, className: 'border-t-2 border-blue-500', collapsed: false },
        { id: 'done', title: 'Done', cards: [{ id: 'c1', title: 'Ship it', description: 'Release notes', owner: 'ana' }] },
      ],
    }],
    ['kanban lanes as bare values', 'object-kanban', { columns: ['todo', 'doing'] }],
    ['a calendar block with all five bindings', 'object-calendar', {
      calendar: { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name', colorField: 'status', allDayField: 'is_all_day' },
    }],
    ['a calendar block with only startDateField', 'object-calendar', { calendar: { startDateField: 'starts_at' } }],
  ];

  for (const [label, row, props] of BYTE_IDENTICAL) {
    it(`parses ${label}, byte-identical`, () => {
      const r = parse(row, props);
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, ...props });
    });
  }

  for (const type of ['none', 'single', 'multiple'] as const) {
    it(`parses selection.type '${type}'`, () => {
      expect(issues(parse('object-grid', { selection: { type } }))).toEqual([]);
    });
  }

  for (const selectable of [true, false, 'single', 'multiple'] as const) {
    it(`parses selectable: ${JSON.stringify(selectable)}`, () => {
      const r = parse('object-grid', { selectable });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, selectable });
    });
  }

  it('parses an empty selection block to exactly what the list view\'s selection answers (its default included)', () => {
    const r = parse('object-grid', { selection: {} });
    expect(issues(r)).toEqual([]);
    expect(r.success && (r.data as { selection?: unknown }).selection).toStrictEqual(SelectionConfigSchema.parse({}));
  });

  it('an absent member stays absent', () => {
    for (const row of ['object-grid', 'object-kanban', 'object-calendar'] as const) {
      const r = parse(row, {});
      expect(issues(r)).toEqual([]);
      expect(r.success && Object.keys(r.data)).toEqual(['objectName']);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the refusals
// ───────────────────────────────────────────────────────────────────────────

describe('§2 each member refuses an off-shape value', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>, code: string, path: string]> = [
    ['an object entry in grid fields', 'object-grid', { fields: [{ field: 'name' }] }, 'invalid_type', 'fields.0'],
    ['a bare-string grid fields', 'object-grid', { fields: 'name' }, 'invalid_type', 'fields'],
    ['a bare-string selection', 'object-grid', { selection: 'multiple' }, 'invalid_type', 'selection'],
    ['an unknown selection type', 'object-grid', { selection: { type: 'all' } }, 'invalid_value', 'selection.type'],
    ['an undeclared selection key', 'object-grid', { selection: { mode: 'single' } }, 'unrecognized_keys', 'selection'],
    ['selectable: \'none\'', 'object-grid', { selectable: 'none' }, 'invalid_union', 'selectable'],
    ['a numeric selectable', 'object-grid', { selectable: 1 }, 'invalid_union', 'selectable'],
    ['a bare-string rowActions', 'object-grid', { rowActions: 'edit' }, 'invalid_type', 'rowActions'],
    ['an object entry in rowActions', 'object-grid', { rowActions: [{ name: 'edit' }] }, 'invalid_type', 'rowActions.0'],
    ['a def entry in bulkActions', 'object-grid', { bulkActions: [{ name: 'approve' }] }, 'invalid_type', 'bulkActions.0'],
    ['a def entry in batchActions', 'object-grid', { batchActions: [{ name: 'approve' }] }, 'invalid_type', 'batchActions.0'],
    ['a bare-string batchActions', 'object-grid', { batchActions: 'approve' }, 'invalid_type', 'batchActions'],
    ['a lane limit of 0', 'object-kanban', { columns: [{ id: 'todo', title: 'To Do', limit: 0 }] }, 'too_small', 'columns.0.limit'],
    ['a calendar block with no startDateField', 'object-calendar', { calendar: { titleField: 'name' } }, 'invalid_type', 'calendar.startDateField'],
    ['the retired endField alias', 'object-calendar', { calendar: { startDateField: 'kickoff', endField: 'wrapup' } }, 'unrecognized_keys', 'calendar'],
    ['a bare-string calendar', 'object-calendar', { calendar: 'starts_at' }, 'invalid_type', 'calendar'],
  ];

  for (const [label, row, props, code, path] of REFUSED) {
    it(`${row}: refuses ${label} — ${code} at ${path}`, () => {
      const r = parse(row, props);
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code, path }]);
    });
  }

  // The kanban's two-array union answers `invalid_union` at the member; the arm that
  // should have taken the value says why it did not.
  const UNION_REFUSED: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>, arms: string[][]]> = [
    ['a kanban lane list mixing objects and strings', 'object-kanban',
      { columns: [{ id: 'done', title: 'Done' }, 'todo'] }, [['invalid_type@0'], ['invalid_type@1']]],
    ['a numeric lane id', 'object-kanban', { columns: [{ id: 1, title: 'One' }] }, [['invalid_type@0'], ['invalid_type@0.id']]],
    ['a lane with no title', 'object-kanban', { columns: [{ id: 'todo' }] }, [['invalid_type@0'], ['invalid_type@0.title']]],
    ['a static card with no title', 'object-kanban',
      { columns: [{ id: 'todo', title: 'To Do', cards: [{ id: 'c1' }] }] }, [['invalid_type@0'], ['invalid_type@0.cards.0.title']]],
    ['a lane color', 'object-kanban',
      { columns: [{ id: 'todo', title: 'To Do', color: 'red' }] }, [['invalid_type@0'], ['unrecognized_keys@0']]],
    ['a bare-string kanban columns', 'object-kanban', { columns: 'todo' }, [['invalid_type@'], ['invalid_type@']]],
  ];

  for (const [label, row, props, arms] of UNION_REFUSED) {
    it(`${row}: refuses ${label} — invalid_union at columns, for the arm's reason`, () => {
      const r = parse(row, props);
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code: 'invalid_union', path: 'columns' }]);
      expect(armIssues(r)).toEqual(arms);
    });
  }

  it('object-kanban: says a lane `color` is not read, and names `className`', () => {
    const r = parse('object-kanban', { columns: [{ id: 'todo', title: 'To Do', color: 'red' }] });
    const union = (r.success ? undefined : r.error.issues[0]) as { errors?: Array<Array<{ message: string }>> } | undefined;
    expect(union?.errors?.[1]?.[0]?.message).toMatch(/`color` is not a lane member: no board reads it\. Style a lane through its `className`/);
  });

  it('LIT CONTROL — an unknown top-level key is still refused at each row itself', () => {
    expect(issues(parse('object-grid', { fields: ['name'], notAGridKey: 1 }))).toEqual([{ code: 'unrecognized_keys', path: '' }]);
    expect(issues(parse('object-kanban', { columns: ['todo'], notABoardKey: 1 }))).toEqual([{ code: 'unrecognized_keys', path: '' }]);
    expect(issues(parse('object-calendar', { calendar: { startDateField: 'd' }, notACalendarKey: 1 })))
      .toEqual([{ code: 'unrecognized_keys', path: '' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one schema, not a copy of its shape
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the members hold the list view\'s own defs, and the measured vocabulary', () => {
  const grid = () => ObjectGridPropsSchema.shape;
  const listView = () => ListViewSchema.shape;

  it('object-grid selection, rowActions and bulkActions are the list view\'s own members — the same defs', () => {
    expect(grid().selection.unwrap()._zod.def).toBe(SelectionConfigSchema._zod.def);
    expect(grid().selection.unwrap()._zod.def).toBe(listView().selection.unwrap()._zod.def);
    expect(grid().rowActions.unwrap()._zod.def).toBe(listView().rowActions.unwrap()._zod.def);
    expect(grid().bulkActions.unwrap()._zod.def).toBe(listView().bulkActions.unwrap()._zod.def);
  });

  it('object-grid batchActions holds bulkActions\'s def — one capability, one accept set', () => {
    expect(grid().batchActions.unwrap()._zod.def).toBe(listView().bulkActions.unwrap()._zod.def);
  });

  it('object-calendar calendar is the list view\'s own calendar member — CalendarConfigSchema', () => {
    const calendar = ObjectCalendarPropsSchema.shape.calendar.unwrap();
    expect(calendar._zod.def).toBe(CalendarConfigSchema._zod.def);
    expect(calendar._zod.def).toBe(listView().calendar.unwrap()._zod.def);
  });

  it('object-grid selectable declares exactly the read\'s set: a boolean, `single`, `multiple`', () => {
    const [bool, modes] = grid().selectable.unwrap().options;
    expect(bool._zod.def.type).toBe('boolean');
    expect([...(modes as z.ZodEnum).options].sort()).toEqual(['multiple', 'single']);
  });

  it('an object-kanban lane declares exactly the six members the board reads', () => {
    const [strings, lanes] = ObjectKanbanPropsSchema.shape.columns.unwrap().options;
    expect(strings.element._zod.def.type).toBe('string');
    expect(Object.keys(lanes.element.shape).sort()).toEqual(['cards', 'className', 'collapsed', 'id', 'limit', 'title']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§4 the ADR-0087 entry', () => {
  it('is registered as the D3 entry step 18 carries, beside the stage-1 entry', () => {
    const ids = MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id);
    expect(ids).toContain('ui-object-grid-kanban-calendar-list-members-typed');
    expect(ids).toContain('ui-object-map-gantt-tree-navigation-typed');
  });
});
