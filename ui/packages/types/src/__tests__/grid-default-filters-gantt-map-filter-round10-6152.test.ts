/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 10 — three flat members follow their `@objectstack/spec` rows by
 * reference, on both faces of this package.
 *
 *   - `ObjectGridSchema.defaultFilters` is the `object-grid` row's own member: the SAME
 *     `ViewFilterRule` array as `filter`, which the row has declared since 17.6.0. It was
 *     `Record<string, any>` / `z.record(z.string(), z.any())`, so the MongoDB-style record
 *     the row refuses type-checked and parsed here, and the rule array the row takes was
 *     REFUSED by the mirror. The flat grid mirror is not an authoring arm
 *     (objectui#11276), but it is the source of the `object-view` `table` slot, so
 *     `table.defaultFilters` — objectui's own door — moves with it.
 *   - `ObjectGanttSchema.filter` / `ObjectMapSchema.filter` are their rows' own member,
 *     the `ViewFilterRule` array. They were `any[]` / `z.array(z.any())`. Their authored
 *     arms are the rows themselves (the `properties` bag), so no authored door moves.
 *
 * The first block re-reads the precondition against the INSTALLED spec, and the
 * differential blocks hold every local verdict to the row's on the same values: the local
 * faces must never refuse what the installed protocol accepts, nor accept what it refuses.
 * `filter` on the grid is the lit control throughout: round 8 moved it, this round does not.
 *
 * ⚠️ `@objectstack/spec` 18 RETIRED `object-grid.defaultFilters` (objectstack#11509): the
 * row's member is a tombstone that refuses every value by name. Both faces carry it by
 * reference, so both refuse it too — the rows below that held the rule-array verdict now
 * hold the retirement (objectui#12030). The renderers stopped reading it in the same
 * change: neither `ObjectGrid` nor `ObjectView` reads a stored document's
 * `defaultFilters`, and these faces judge what is authored.
 */
import { describe, it, expect } from 'vitest';

import {
  ObjectGanttPropsSchema as SpecObjectGanttPropsSchema,
  ObjectGridPropsSchema as SpecObjectGridPropsSchema,
  ObjectMapPropsSchema as SpecObjectMapPropsSchema,
} from '@objectstack/spec/ui';
import type {
  ObjectGanttProps as SpecObjectGanttProps,
  ObjectGridProps as SpecObjectGridProps,
  ObjectMapProps as SpecObjectMapProps,
  ViewFilterRule,
} from '@objectstack/spec/ui';
import type {
  ObjectGanttSchema as TsObjectGanttSchema,
  ObjectGridSchema as TsObjectGridSchema,
  ObjectMapSchema as TsObjectMapSchema,
  ObjectViewSchema as TsObjectViewSchema,
} from '../objectql';
import { ObjectGanttSchema, ObjectGridSchema, ObjectMapSchema, ObjectViewSchema } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };
type Parse = (doc: unknown) => Parsed;

const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path })));
const paths = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => i.path.join('.')));
const firstMessage = (r: Parsed) => (r.success ? '' : r.error!.issues[0].message);

const GRID = { type: 'object-grid', objectName: 'task' };
const GANTT = { type: 'object-gantt', objectName: 'task' };
const MAP = { type: 'object-map', objectName: 'site' };
const VIEW = { type: 'object-view', objectName: 'task' };

const RULES: ViewFilterRule[] = [{ field: 'status', operator: 'equals', value: 'open' }];
const TUPLES = [['status', '=', 'open']];
const RECORD = { status: 'open' };

const DOORS: ReadonlyArray<readonly [string, Parse]> = [
  ['the tolerant face', (d) => AnyComponentSchema.safeParse(d)],
  ['the strict face', (d) => StrictAnyComponentSchema.safeParse(d)],
  ['safeValidateSchema', (d) => safeValidateSchema(d)],
];

/** The values every differential below is read over: both verdicts occur (asserted). */
const VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ['the rule array', RULES],
  ['an empty array', []],
  ['the tuple array', TUPLES],
  ['an AST `and` node', ['and', ['status', '=', 'open'], ['amount', '>', 100]]],
  ['the record', RECORD],
  ['an empty record', {}],
  ['a string clause', 'status = open'],
  ['a rule with an unknown operator', [{ field: 'status', operator: '=', value: 'open' }]],
];

/* ── The precondition, on the installed protocol ─────────────────────────────── */

describe('objectui#6152 round 10 — the installed protocol (the precondition)', () => {
  it('the `object-grid` row refuses `defaultFilters` BY NAME, whatever the value — a tombstone since 18 (objectui#12030)', () => {
    for (const [, value] of VALUES) {
      const r = SpecObjectGridPropsSchema.safeParse({ defaultFilters: value });
      expect(codeAndPath(r), JSON.stringify(value)).toEqual([{ code: 'invalid_type', path: ['defaultFilters'] }]);
    }
    // The refusal points at the live key.
    expect(firstMessage(SpecObjectGridPropsSchema.safeParse({ defaultFilters: RULES }))).toContain('filter');
    // Lit control: the row's `filter` takes the rule array the retired key took.
    expect(SpecObjectGridPropsSchema.safeParse({ filter: RULES }).success).toBe(true);
  });

  it.each([
    ['object-gantt', SpecObjectGanttPropsSchema],
    ['object-map', SpecObjectMapPropsSchema],
  ] as const)('the `%s` row takes the rule array on `filter` and refuses the tuple array and the record', (_type, row) => {
    expect(row.safeParse({ filter: RULES }).success).toBe(true);
    expect(paths(row.safeParse({ filter: TUPLES }))).toEqual(['filter.0']);
    const record = row.safeParse({ filter: RECORD });
    expect(paths(record)).toEqual(['filter']);
    expect(firstMessage(record)).toContain("[{ field: 'status', operator: 'equals', value: 'open' }]");
  });
});

/* ── The members ARE the rows' ───────────────────────────────────────────────── */

describe('objectui#6152 round 10 — the mirror members are the rows\' own, by reference', () => {
  it('`ObjectGridSchema.defaultFilters` is the row\'s member (identity, not a copy)', () => {
    expect(ObjectGridSchema.shape.defaultFilters).toBe(SpecObjectGridPropsSchema.shape.defaultFilters);
    // CONTROL — the identity check can fail: the row's `defaultFilters` is not its `filter`.
    expect(ObjectGridSchema.shape.defaultFilters).not.toBe(SpecObjectGridPropsSchema.shape.filter);
    // Lit control: round 8's `filter` is still the row's own `filter`.
    expect(ObjectGridSchema.shape.filter).toBe(SpecObjectGridPropsSchema.shape.filter);
  });

  it('the flat gantt and map `filter` are their rows\' members', () => {
    expect(ObjectGanttSchema.shape.filter).toBe(SpecObjectGanttPropsSchema.shape.filter);
    expect(ObjectMapSchema.shape.filter).toBe(SpecObjectMapPropsSchema.shape.filter);
    // CONTROL — the gantt row's member is not the map row's.
    expect(ObjectGanttSchema.shape.filter).not.toBe(SpecObjectMapPropsSchema.shape.filter);
  });
});

/* ── Every local verdict is the row's ────────────────────────────────────────── */

describe('objectui#6152 round 10 — every flat mirror verdict is its row\'s', () => {
  it('object-grid `defaultFilters`: the mirror refuses every value, as the retired row member does (objectui#12030)', () => {
    for (const [, value] of VALUES) {
      const local = (ObjectGridSchema as unknown as { safeParse: Parse }).safeParse({ ...GRID, defaultFilters: value });
      expect(local.success, JSON.stringify(value)).toBe(false);
      expect(paths(local), JSON.stringify(value)).toEqual(['defaultFilters']);
      expect(SpecObjectGridPropsSchema.safeParse({ defaultFilters: value }).success).toBe(false);
    }
  });

  describe.each([
    ['object-grid `filter` (lit control, round 8)', ObjectGridSchema as unknown as { safeParse: Parse }, SpecObjectGridPropsSchema, GRID, 'filter'],
    ['object-gantt `filter`', ObjectGanttSchema as unknown as { safeParse: Parse }, SpecObjectGanttPropsSchema, GANTT, 'filter'],
    ['object-map `filter`', ObjectMapSchema as unknown as { safeParse: Parse }, SpecObjectMapPropsSchema, MAP, 'filter'],
  ] as const)('%s', (_label, mirror, row, node, key) => {
    it('CONTROL: the node without the key parses', () => {
      const r = mirror.safeParse(node);
      expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
    });

    it.each(VALUES)('%s: the mirror and the installed row agree', (_value, value) => {
      const local = mirror.safeParse({ ...node, [key]: value });
      const upstream = row.safeParse({ [key]: value });
      expect(local.success).toBe(upstream.success);
      if (!local.success) expect(paths(local).every((p) => p.startsWith(key))).toBe(true);
    });

    it('both verdicts occur, so the agreement above is a reading', () => {
      const verdicts = VALUES.map(([, value]) => row.safeParse({ [key]: value }).success);
      expect(verdicts).toContain(true);
      expect(verdicts).toContain(false);
    });
  });
});

/* ── The `object-view` `table` slot: objectui's own door ─────────────────────── */

describe('objectui#6152 round 10 — `table.defaultFilters` follows the row: refused for every value since 18 (objectui#12030)', () => {
  describe.each(DOORS)('%s', (_door, parse) => {
    it.each(VALUES)('%s: refused AT `table.defaultFilters`, as the row refuses it', (_value, value) => {
      const local = parse({ ...VIEW, table: { defaultFilters: value } });
      expect(local.success).toBe(false);
      expect(paths(local)).toEqual(['table.defaultFilters']);
      expect(SpecObjectGridPropsSchema.safeParse({ defaultFilters: value }).success).toBe(false);
    });

    it('LIT CONTROL: `table.filter` is unchanged — the rule array parses, the tuple array is refused', () => {
      expect(parse({ ...VIEW, table: { filter: RULES } }).success).toBe(true);
      expect(paths(parse({ ...VIEW, table: { filter: TUPLES } }))).toEqual(['table.filter.0']);
    });
  });

  it('the `object-view` mirror\'s own slot agrees with the doors above', () => {
    expect(paths(ObjectViewSchema.safeParse({ ...VIEW, table: { defaultFilters: RULES } }))).toEqual(['table.defaultFilters']);
    expect(ObjectViewSchema.safeParse({ ...VIEW, table: { filter: RULES } }).success).toBe(true);
  });

  it('CONTROL: the authored `object-grid` node\'s bag (the row itself) gives the same verdicts', () => {
    for (const [, parse] of DOORS) {
      expect(paths(parse({ type: 'object-grid', properties: { objectName: 'task', defaultFilters: RULES } })))
        .toEqual(['properties.defaultFilters']);
      const ok = parse({ type: 'object-grid', properties: { objectName: 'task', filter: RULES } });
      expect(ok.success, JSON.stringify(codeAndPath(ok))).toBe(true);
    }
  });
});

/* ── The TypeScript face ─────────────────────────────────────────────────────── */

describe('objectui#6152 round 10 — the TypeScript face', () => {
  it('the record `defaultFilters` and the tuple / record gantt and map `filter` are `tsc` errors; the rule array type-checks', () => {
    // Real directives: this package type-checks its tests (`tsconfig.test.json`), so a
    // re-widened member fails on the unused directive.
    // @ts-expect-error `defaultFilters` is the `ViewFilterRule` array, not the record form
    const gridRecord: TsObjectGridSchema = { type: 'object-grid', objectName: 'task', defaultFilters: { status: 'open' } };
    // @ts-expect-error the `table` slot's `defaultFilters` is the grid's: the record is refused there too
    const slotRecord: TsObjectViewSchema = { type: 'object-view', objectName: 'task', table: { defaultFilters: { status: 'open' } } };
    // @ts-expect-error `filter` is the `ViewFilterRule` array, not the AST tuple array
    const ganttTuples: TsObjectGanttSchema = { type: 'object-gantt', objectName: 'task', filter: [['status', '=', 'open']] };
    // @ts-expect-error `filter` is the `ViewFilterRule` array, not the record form
    const mapRecord: TsObjectMapSchema = { type: 'object-map', objectName: 'site', filter: { status: 'open' } };
    // @ts-expect-error `filter` is the `ViewFilterRule` array, not the AST tuple array
    const mapTuples: TsObjectMapSchema = { type: 'object-map', objectName: 'site', filter: [['status', '=', 'open']] };
    // Lit controls on the same faces. The grid's `defaultFilters` is not one of them
    // any more: its verdict on the rule array is the row's (objectui#12093, below).
    const gantt: TsObjectGanttSchema = { type: 'object-gantt', objectName: 'task', filter: RULES };
    const map: TsObjectMapSchema = { type: 'object-map', objectName: 'site', filter: RULES };
    expect([gridRecord, slotRecord, ganttTuples, mapRecord, mapTuples]).toHaveLength(5);
    expect([gantt.filter, map.filter]).toEqual([RULES, RULES]);
  });

  it('`defaultFilters` takes the rule array on both grid faces exactly where the installed row does (objectui#12093)', () => {
    // objectstack#11509 retires `object-grid.defaultFilters` (objectstack PR #22421: a
    // tombstone on objectstack `main`), and the installed release still declares it as
    // the rule array. This file is compiled against both: by the pull-request type-check
    // against the installed spec, and by the Spec Main Shape Gate against `main`. So the
    // pin is the ROW's verdict held on each face, not either answer written down: where
    // the row refuses the rule array, the flat mirror and the `object-view` `table` slot
    // refuse it too. These replace the two literals that asserted the rule array
    // compiles there.
    type RowTakesRules = { defaultFilters: ViewFilterRule[] } extends Pick<SpecObjectGridProps, 'defaultFilters'> ? true : false;
    type GridTakesRules = { defaultFilters: ViewFilterRule[] } extends Pick<TsObjectGridSchema, 'defaultFilters'> ? true : false;
    type SlotTakesRules = { defaultFilters: ViewFilterRule[] } extends Pick<NonNullable<TsObjectViewSchema['table']>, 'defaultFilters'>
      ? true
      : false;
    const grid: Equal<GridTakesRules, RowTakesRules> = true;
    const slot: Equal<SlotTakesRules, RowTakesRules> = true;
    expect([grid, slot]).toEqual([true, true]);
  });
});

/* Read off the members: each is the row's own type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionRound10MembersAreTheRows = [
  // `defaultFilters` is the row's member on both grid faces, by reference, whatever the
  // row declares: the rule array on the installed release, the tombstone on objectstack
  // `main` (objectstack#11509). It used to be written down as `ViewFilterRule[]`, which
  // only the installed release satisfies (objectui#12093).
  Expect<Equal<TsObjectGridSchema['defaultFilters'], SpecObjectGridProps['defaultFilters']>>,
  Expect<Equal<NonNullable<TsObjectViewSchema['table']>['defaultFilters'], SpecObjectGridProps['defaultFilters']>>,
  Expect<Equal<TsObjectGanttSchema['filter'], SpecObjectGanttProps['filter']>>,
  Expect<Equal<TsObjectMapSchema['filter'], SpecObjectMapProps['filter']>>,
  Expect<Equal<TsObjectGanttSchema['filter'], ViewFilterRule[] | undefined>>,
  Expect<Equal<TsObjectMapSchema['filter'], ViewFilterRule[] | undefined>>,
  // Lit control: round 8's grid `filter` is unchanged.
  Expect<Equal<TsObjectGridSchema['filter'], SpecObjectGridProps['filter']>>,
];
