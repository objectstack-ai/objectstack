/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 8 — the `@objectstack/spec` 17.7.0 member moves on `object-grid`,
 * `object-kanban` and `object-calendar`, on both faces of this package.
 *
 *   - `object-grid` `operations` is the row's strict `{ create?, update?, delete?, export? }`
 *     block: the flat mirror takes it BY REFERENCE, and `read` / `import` (which no
 *     `object-grid` code reads, and the row refuses by name) are retired on both faces —
 *     `?: never` on the interface, a `retirementTombstone()` on the mirror.
 *   - `filter` on all three is the row's own member BY REFERENCE: the `ViewFilterRule`
 *     array. It was `any[]` / `z.array(z.any())`, so the AST tuple array and the
 *     MongoDB-style record the rows refuse type-checked and parsed here.
 *   - `conditionalFormatting` needed no stroke in this package: objectui#11533 (grid) and
 *     objectui#11522 (kanban) had already moved both rules onto the list view's.
 *
 * The flat `ObjectGridSchema` is not an authoring arm since objectui#11276 (the authored
 * node's `properties` bag IS the row), but it is the source of the `object-view` `table`
 * slot, so the slot narrows with it; the kanban and calendar mirrors ARE their authored
 * arms. An `object-view`'s own `operations` is a different member: the protocol has no
 * `object-view` row, `ObjectView` reads `read` off it as its row-click gate, and it is
 * untouched (the controls below).
 *
 * The first block re-reads the precondition against the INSTALLED spec, and the
 * differential block holds every mirror verdict to the row's on the same values: the
 * local faces must never refuse what the installed protocol accepts, nor accept what it
 * refuses.
 */
import { describe, it, expect } from 'vitest';

import {
  ComponentPropsMap,
  ObjectCalendarPropsSchema as SpecObjectCalendarPropsSchema,
  ObjectGridPropsSchema as SpecObjectGridPropsSchema,
  ObjectKanbanPropsSchema as SpecObjectKanbanPropsSchema,
} from '@objectstack/spec/ui';
import type {
  ObjectCalendarProps as SpecObjectCalendarProps,
  ObjectGridProps as SpecObjectGridProps,
  ObjectKanbanProps as SpecObjectKanbanProps,
  ViewFilterRule,
} from '@objectstack/spec/ui';
import type {
  ObjectCalendarSchema as TsObjectCalendarSchema,
  ObjectGridSchema as TsObjectGridSchema,
  ObjectKanbanSchema as TsObjectKanbanSchema,
  ObjectViewSchema as TsObjectViewSchema,
} from '../objectql';
import { ObjectCalendarSchema, ObjectGridSchema, ObjectKanbanSchema, ObjectViewSchema } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };
type Parse = (doc: unknown) => Parsed;
type Shaped = { shape: Record<string, { unwrap: () => Shaped } & object> };

const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path })));
const paths = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => i.path.join('.')));
const firstMessage = (r: Parsed) => (r.success ? '' : r.error!.issues[0].message);

const GRID = { type: 'object-grid', objectName: 'task' };
const KANBAN = { type: 'object-kanban', objectName: 'deal', groupBy: 'stage' };
const CALENDAR = { type: 'object-calendar', objectName: 'event', calendar: { startDateField: 'starts_at' } };
const VIEW = { type: 'object-view', objectName: 'task' };

const RULES: ViewFilterRule[] = [{ field: 'status', operator: 'equals', value: 'open' }];
const TUPLES = [['status', '=', 'open']];
const RECORD = { status: 'open' };

const DOORS: ReadonlyArray<readonly [string, Parse]> = [
  ['the tolerant face', (d) => AnyComponentSchema.safeParse(d)],
  ['the strict face', (d) => StrictAnyComponentSchema.safeParse(d)],
  ['safeValidateSchema', (d) => safeValidateSchema(d)],
];

/* ── The precondition, on the installed protocol ─────────────────────────────── */

describe('objectui#6152 round 8 — the installed protocol (the precondition)', () => {
  it('the `object-grid` row takes the four toggles and refuses `read` / `import` by name', () => {
    expect(SpecObjectGridPropsSchema.safeParse({ operations: { create: true, update: false, delete: false, export: false } }).success)
      .toBe(true);
    for (const key of ['read', 'import']) {
      const r = SpecObjectGridPropsSchema.safeParse({ operations: { [key]: true } });
      expect(codeAndPath(r)).toEqual([{ code: 'unrecognized_keys', path: ['operations'] }]);
      expect(firstMessage(r)).toContain(`\`operations.${key}\` has no reader on \`object-grid\``);
    }
  });

  it.each([
    ['object-grid', SpecObjectGridPropsSchema],
    ['object-kanban', SpecObjectKanbanPropsSchema],
    ['object-calendar', SpecObjectCalendarPropsSchema],
  ] as const)('the `%s` row takes the rule array and refuses the tuple array and the record', (_type, row) => {
    expect(row.safeParse({ filter: RULES }).success).toBe(true);
    expect(paths(row.safeParse({ filter: TUPLES }))).toEqual(['filter.0']);
    expect(paths(row.safeParse({ filter: RECORD }))).toEqual(['filter']);
  });

  it('the protocol has no `object-view` row, so the view\'s own `operations` is this package\'s member', () => {
    expect((ComponentPropsMap as Record<string, unknown>)['object-view']).toBeUndefined();
    // Lit control: the same lookup finds a row that exists.
    expect((ComponentPropsMap as Record<string, unknown>)['object-grid']).toBeDefined();
  });
});

/* ── The members ARE the rows' ───────────────────────────────────────────────── */

describe('objectui#6152 round 8 — the mirror members are the rows\' own, by reference', () => {
  it('`filter` on each flat mirror is its row\'s member (identity, not a copy)', () => {
    expect(ObjectGridSchema.shape.filter).toBe(SpecObjectGridPropsSchema.shape.filter);
    expect(ObjectKanbanSchema.shape.filter).toBe(SpecObjectKanbanPropsSchema.shape.filter);
    expect(ObjectCalendarSchema.shape.filter).toBe(SpecObjectCalendarPropsSchema.shape.filter);
    // CONTROL — the identity check can fail: the kanban row's member is not the grid's.
    expect(ObjectKanbanSchema.shape.filter).not.toBe(SpecObjectGridPropsSchema.shape.filter);
  });

  it('the four `operations` toggles are the row\'s own members; `read` / `import` are local tombstones', () => {
    const local = (ObjectGridSchema.shape.operations as unknown as { unwrap: () => Shaped }).unwrap().shape;
    const row = (SpecObjectGridPropsSchema.shape.operations as unknown as { unwrap: () => Shaped }).unwrap().shape;
    for (const key of ['create', 'update', 'delete', 'export']) expect(local[key]).toBe(row[key]);
    expect(Object.keys(row).sort()).toEqual(['create', 'delete', 'export', 'update']);
    expect(Object.keys(local).sort()).toEqual(['create', 'delete', 'export', 'import', 'read', 'update']);
  });
});

/* ── `operations` ────────────────────────────────────────────────────────────── */

describe('objectui#6152 round 8 — `operations.read` / `.import` are retired on the flat grid mirror', () => {
  it('CONTROL: the four toggles parse', () => {
    const r = ObjectGridSchema.safeParse({ ...GRID, operations: { create: true, update: false, delete: false, export: false } });
    expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
  });

  it.each(['read', 'import'])('`operations.%s` is refused AT its own path, with the remedy', (key) => {
    const r = ObjectGridSchema.safeParse({ ...GRID, operations: { [key]: true } });
    expect(codeAndPath(r)).toEqual([{ code: 'invalid_type', path: ['operations', key] }]);
    expect(firstMessage(r)).toContain('objectui#6152');
    expect(firstMessage(r)).toContain(`\`operations.${key}\` has no reader`);
  });

  it('the `read` remedy names the view-level spelling, since an `object-view` reads its own', () => {
    expect(firstMessage(ObjectGridSchema.safeParse({ ...GRID, operations: { read: false } })))
      .toContain('`navigation: { mode: \'none\' }`');
  });

  it('an unknown toggle is still named, in the row\'s own words', () => {
    const r = ObjectGridSchema.safeParse({ ...GRID, operations: { creat: false } });
    expect(codeAndPath(r)).toEqual([{ code: 'unrecognized_keys', path: ['operations'] }]);
    expect(firstMessage(r)).toContain('`object-grid` operations block');
  });
});

describe('objectui#6152 round 8 — the `object-view` `table` slot narrows with the grid; the view\'s own member does not', () => {
  describe.each(DOORS)('%s', (_door, parse) => {
    it('`table.operations.read` is refused at its path', () => {
      expect(codeAndPath(parse({ ...VIEW, table: { operations: { read: false } } })))
        .toEqual([{ code: 'invalid_type', path: ['table', 'operations', 'read'] }]);
    });

    it('CONTROL: the view\'s OWN `operations.read` still parses — `ObjectView`\'s row-click gate', () => {
      const r = parse({ ...VIEW, operations: { read: false } });
      expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
    });

    it('`table.filter` takes the rule array and refuses the tuple array', () => {
      expect(parse({ ...VIEW, table: { filter: RULES } }).success).toBe(true);
      expect(paths(parse({ ...VIEW, table: { filter: TUPLES } }))).toEqual(['table.filter.0']);
    });
  });

  it('the `object-view` mirror\'s own slot agrees with the doors above', () => {
    expect(codeAndPath(ObjectViewSchema.safeParse({ ...VIEW, table: { operations: { import: true } } })))
      .toEqual([{ code: 'invalid_type', path: ['table', 'operations', 'import'] }]);
  });
});

/* ── `filter` ────────────────────────────────────────────────────────────────── */

const VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ['the rule array', RULES],
  ['an empty array', []],
  ['the tuple array', TUPLES],
  ['an AST `and` node', ['and', ['status', '=', 'open'], ['amount', '>', 100]]],
  ['the record', RECORD],
  ['a string clause', 'status = open'],
  ['a rule with an unknown operator', [{ field: 'status', operator: '=', value: 'open' }]],
];

describe('objectui#6152 round 8 — every flat mirror\'s `filter` verdict is its row\'s', () => {
  describe.each([
    ['object-grid', ObjectGridSchema, SpecObjectGridPropsSchema, GRID],
    ['object-kanban', ObjectKanbanSchema, SpecObjectKanbanPropsSchema, KANBAN],
    ['object-calendar', ObjectCalendarSchema, SpecObjectCalendarPropsSchema, CALENDAR],
  ] as const)('%s', (_type, mirror, row, node) => {
    it('CONTROL: the node without `filter` parses', () => {
      expect((mirror as { safeParse: Parse }).safeParse(node).success).toBe(true);
    });

    it.each(VALUES)('%s: the mirror and the installed row agree', (_label, value) => {
      const local = (mirror as { safeParse: Parse }).safeParse({ ...node, filter: value });
      const upstream = row.safeParse({ filter: value });
      expect(local.success).toBe(upstream.success);
      if (!local.success) expect(paths(local).every((p) => p.startsWith('filter'))).toBe(true);
    });

    it('both verdicts occur, so the agreement above is a reading', () => {
      const verdicts = VALUES.map(([, value]) => row.safeParse({ filter: value }).success);
      expect(verdicts).toContain(true);
      expect(verdicts).toContain(false);
    });
  });
});

describe('objectui#6152 round 8 — the authored kanban and calendar doors refuse the tuple array', () => {
  describe.each(DOORS)('%s', (_door, parse) => {
    it.each([
      ['object-kanban', KANBAN],
      ['object-calendar', CALENDAR],
    ] as const)('%s: the rule array parses and the tuple array / record are refused at `filter`', (_type, node) => {
      const ok = parse({ ...node, filter: RULES });
      expect(ok.success, JSON.stringify(codeAndPath(ok))).toBe(true);
      expect(paths(parse({ ...node, filter: TUPLES }))).toEqual(['filter.0']);
      expect(paths(parse({ ...node, filter: RECORD }))).toEqual(['filter']);
    });
  });
});

/* ── The TypeScript face ─────────────────────────────────────────────────────── */

describe('objectui#6152 round 8 — the TypeScript face', () => {
  it('`read` / `import` and the tuple `filter` are `tsc` errors; the canonical shapes type-check', () => {
    // Real directives: this package type-checks its tests (`tsconfig.test.json`), so a
    // re-widened member fails on the unused directive.
    // @ts-expect-error `operations.read` is RETIRED on `object-grid` (objectui#6152)
    const read: TsObjectGridSchema = { type: 'object-grid', objectName: 'task', operations: { read: true } };
    // @ts-expect-error `operations.import` is RETIRED on `object-grid` (objectui#6152)
    const imp: TsObjectGridSchema = { type: 'object-grid', objectName: 'task', operations: { import: true } };
    // @ts-expect-error `filter` is the `ViewFilterRule` array, not the AST tuple array
    const gridTuples: TsObjectGridSchema = { type: 'object-grid', objectName: 'task', filter: [['status', '=', 'open']] };
    // @ts-expect-error `filter` is the `ViewFilterRule` array, not the AST tuple array
    const kanbanTuples: TsObjectKanbanSchema = { type: 'object-kanban', objectName: 'deal', filter: [['status', '=', 'open']] };
    // @ts-expect-error `filter` is the `ViewFilterRule` array, not the record form
    const calendarRecord: TsObjectCalendarSchema = { type: 'object-calendar', objectName: 'event', filter: { status: 'open' } };
    // @ts-expect-error the `table` slot's `operations` is the grid's: `read` is retired there
    const slotRead: TsObjectViewSchema = { type: 'object-view', objectName: 'task', table: { operations: { read: false } } };
    // Lit controls on the same faces.
    const live: TsObjectGridSchema = {
      type: 'object-grid',
      objectName: 'task',
      operations: { create: true, update: false, delete: false, export: false },
      filter: RULES,
    };
    const viewRead: TsObjectViewSchema = { type: 'object-view', objectName: 'task', operations: { read: false } };
    expect([read, imp, gridTuples, kanbanTuples, calendarRecord, slotRead]).toHaveLength(6);
    expect([live.filter, viewRead.operations?.read]).toEqual([RULES, false]);
  });
});

/*
 * Read off the members: each is the row's own type, and the retired toggles read
 * `undefined` (a deletion would not compile here; a re-declared `boolean` would read
 * `boolean | undefined`, as the view's own `read` does).
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type GridOperations = NonNullable<TsObjectGridSchema['operations']>;

export type assertionRound8MembersAreTheRows = [
  Expect<Equal<TsObjectGridSchema['filter'], SpecObjectGridProps['filter']>>,
  Expect<Equal<TsObjectKanbanSchema['filter'], SpecObjectKanbanProps['filter']>>,
  Expect<Equal<TsObjectCalendarSchema['filter'], SpecObjectCalendarProps['filter']>>,
  Expect<Equal<TsObjectGridSchema['filter'], ViewFilterRule[] | undefined>>,
  Expect<Equal<GridOperations['create'], boolean | undefined>>,
  Expect<Equal<GridOperations['export'], boolean | undefined>>,
  Expect<Equal<GridOperations['read'], undefined>>,
  Expect<Equal<GridOperations['import'], undefined>>,
  Expect<Equal<NonNullable<TsObjectViewSchema['operations']>['read'], boolean | undefined>>,
];
