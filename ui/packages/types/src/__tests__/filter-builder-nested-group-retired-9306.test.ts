/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — a filter group's `conditions` is FLAT, and a nested
 * sub-group, `allowGroups` and `maxDepth` are REFUSED BY NAME on the
 * `filter-builder` node (objectui#9306, maintainer ruling 「A 撤掉嵌套声明」,
 * ADR-0049 enforce-or-remove).
 *
 * ## The failure this pin exists to prevent
 *
 * Both published faces declared nesting: `FilterGroup.conditions` was
 * `(FilterBuilderCondition | FilterGroup)[]`, its zod mirror took the same
 * union, and the node declared `allowGroups` (documented default `true`) and
 * `maxDepth` (documented default `3`). Nothing honoured any of it.
 * `FilterBuilder` draws every entry of `conditions` as one flat row and has no
 * control that creates a group, so a sub-group validated green, drew as a row
 * with blank field and operator triggers, and its own conditions were shown
 * nowhere; no renderer read either switch. The render reading and the producer
 * census were taken once, on the card's pull request; this file is the
 * instrument that keeps the contract.
 *
 * ## How refusals are asserted
 *
 * By the issue ENVELOPE — `code` and `path`, and that it is the ONLY issue, so
 * a refusal cannot ride on some other failure of the same document — at the
 * public door `safeValidateSchema` (the tolerant face) and on the mirror. The wording is not pinned; that the message and the
 * published `.describe()` metadata are one string is.
 *
 * The `@ts-expect-error` directives in block (e) are REAL enforcement: this
 * package type-checks its tests through `tsconfig.test.json`, so re-widening a
 * member fails the build on the unused directive (TS2578). A green `vitest` run
 * is NOT evidence about them — type assertions are erased before it runs.
 */

import { describe, it, expect } from 'vitest';
import type { FilterBuilderCondition, FilterBuilderSchema, FilterGroup } from '../complex';
import {
  FilterBuilderSchema as FilterBuilderMirror,
  FilterGroupSchema,
} from '../zod/complex.zod';
import { safeValidateSchema } from '../zod/index.zod';

const FIELDS = [{ value: 'amount', label: 'Amount', type: 'number' }];
const ROW = { id: 'c1', field: 'amount', operator: 'greater_than', value: 100 };
const ROW_2 = { id: 'c2', field: 'amount', operator: 'less_than', value: 500 };
const SUB_GROUP = { id: 'g2', logic: 'or', conditions: [ROW_2] };
const group = (conditions: unknown[]) => ({ id: 'root', logic: 'and', conditions });
const node = (extra: Record<string, unknown>) => ({ type: 'filter-builder', name: 'f', fields: FIELDS, ...extra });

type Issue = { code: string; path: PropertyKey[]; message: string };
const issuesOf = (r: { success: boolean; error?: { issues: Issue[] } }): Issue[] => r.error?.issues ?? [];
const envelope = (r: { success: boolean; error?: { issues: Issue[] } }) =>
  issuesOf(r).map(({ code, path }) => ({ code, path }));

type Described = { description?: string };
const groupShape = (FilterGroupSchema as unknown as { unwrap(): { shape: Record<string, Described> } }).unwrap().shape;
const nodeShape = (FilterBuilderMirror as unknown as { shape: Record<string, Described> }).shape;

/* ── (a) a nested sub-group is refused BY NAME, at the entry's own path ───── */

describe('objectui#9306 (a) — a nested sub-group in `conditions` is REFUSED by name', () => {
  it('on the mirror: ONE `custom` issue at the sub-group entry', () => {
    const r = FilterGroupSchema.safeParse(group([ROW, SUB_GROUP]));
    expect(r.success, 'a nested sub-group was ACCEPTED').toBe(false);
    expect(envelope(r)).toEqual([{ code: 'custom', path: ['conditions', 1] }]);
  });

  // `defaultValue` was the second row of this table until objectui#10825
  // retired that key: a group authored there is now refused at the key itself,
  // whatever its entries say, pinned in `filter-builder-value-group-only-10825.test.ts`.
  it.each([['value']])(
    'at the public door, through the node `%s`: ONE `custom` issue at the sub-group entry',
    (key) => {
      const doc = node({ [key]: group([ROW, SUB_GROUP]) });
      for (const r of [safeValidateSchema(doc), FilterBuilderMirror.safeParse(doc)]) {
        expect(r.success, `a nested sub-group under \`${key}\` was ACCEPTED`).toBe(false);
        expect(envelope(r)).toEqual([{ code: 'custom', path: [key, 'conditions', 1] }]);
      }
    },
  );

  it('an EMPTY sub-group and a sub-group missing `logic` are refused the same way — the test is `conditions`', () => {
    for (const sub of [{ logic: 'and', conditions: [] }, { conditions: [ROW_2] }]) {
      expect(envelope(FilterGroupSchema.safeParse(group([sub])))).toEqual([
        { code: 'custom', path: ['conditions', 0] },
      ]);
    }
  });

  it('the refusal names itself: its message is the one the published `conditions` metadata carries', () => {
    const [issue] = issuesOf(FilterGroupSchema.safeParse(group([SUB_GROUP])));
    expect(issue!.message).toMatch(/sub-group is RETIRED \(objectui#9306/);
    expect(groupShape.conditions!.description).toContain(issue!.message);
  });
});

/* ── (b) `allowGroups` / `maxDepth` are refused by name on the node ────────── */

describe('objectui#9306 (b) — `allowGroups` and `maxDepth` are RETIRED on `filter-builder`', () => {
  const AUTHORED: ReadonlyArray<readonly [string, unknown]> = [
    ['allowGroups', true],
    ['allowGroups', false],
    ['maxDepth', 3],
    ['maxDepth', 1],
  ];

  it.each(AUTHORED)(
    'refuses `%s: %s` at the public door and on the mirror: ONE `invalid_type` issue at the key',
    (key, value) => {
      const doc = node({ value: group([ROW]), [key]: value });
      for (const r of [safeValidateSchema(doc), FilterBuilderMirror.safeParse(doc)]) {
        expect(r.success, `an authored \`${key}\` was ACCEPTED`).toBe(false);
        expect(envelope(r)).toEqual([{ code: 'invalid_type', path: [key] }]);
      }
    },
  );

  it.each([['allowGroups'], ['maxDepth']])(
    '`%s`: the refusal message and the published `.describe()` metadata are ONE string',
    (key) => {
      const [issue] = issuesOf(FilterBuilderMirror.safeParse(node({ [key]: 1 })));
      expect(issue!.message).toBe(nodeShape[key]!.description);
      expect(issue!.message).toMatch(/objectui#9306/);
    },
  );

  it('both stay DECLARED on the node shape — tombstones, not deletions (see block d)', () => {
    expect(Object.keys(nodeShape)).toEqual(expect.arrayContaining(['allowGroups', 'maxDepth']));
  });
});

/* ── (c) LIT CONTROL: flat groups parse, and parse as they did ────────────── */

describe('objectui#9306 (c) — LIT CONTROL: a flat group parses, at both doors', () => {
  it('the same rows, as siblings in ONE group', () => {
    expect(issuesOf(FilterGroupSchema.safeParse(group([ROW, ROW_2])))).toEqual([]);
    expect(issuesOf(safeValidateSchema(node({ value: group([ROW, ROW_2]) })))).toEqual([]);
    expect(issuesOf(safeValidateSchema(node({ value: group([]) })))).toEqual([]);
  });

  it('a row is still judged by the ROW schema — an alias operator still folds, a bad one is still refused at its own key', () => {
    const folded = FilterGroupSchema.safeParse(group([{ ...ROW, operator: 'lessThan' }]));
    expect(folded.success).toBe(true);
    expect((folded.data as { conditions: Array<{ operator: string }> }).conditions[0]!.operator).toBe('less_than');

    const bad = FilterGroupSchema.safeParse(group([{ ...ROW, operator: 'qqzz_absent' }]));
    expect(bad.success).toBe(false);
    expect(envelope(bad).map(({ path }) => path)).toEqual([['conditions', 0, 'operator']]);
  });
});

/* ── (d) why tombstones: an undeclared NODE key is KEPT in silence ─────────── */

describe('objectui#9306 (d) — CONTROL: an undeclared `filter-builder` key is KEPT, not refused', () => {
  it('a misspelled `allowGroup` parses green and survives the parse — what a deletion would have left', () => {
    const r = safeValidateSchema(node({ allowGroup: true }));
    expect(r.success).toBe(true);
    expect(r.data as Record<string, unknown>).toHaveProperty('allowGroup', true);
  });
});

/* ── (e) the TS twin carries the same contract ────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionConditionsFlat = Expect<Equal<FilterGroup['conditions'], FilterBuilderCondition[]>>;
export type assertionAllowGroupsRetired = Expect<Equal<FilterBuilderSchema['allowGroups'], undefined>>;
export type assertionMaxDepthRetired = Expect<Equal<FilterBuilderSchema['maxDepth'], undefined>>;
/** The helper can FAIL — control on a surviving optional member of the same node. */
export type assertionEqualCanFail = Expect<Equal<Equal<FilterBuilderSchema['wrapperClass'], undefined>, false>>;

describe('objectui#9306 (e) — the TS twin refuses what the mirror refuses', () => {
  it('a sub-group in `conditions` is a compile error — checked by `tsc -p tsconfig.test.json`', () => {
    const refused: FilterGroup = {
      logic: 'and',
      conditions: [
        { id: 'c1', field: 'amount', operator: 'greater_than', value: 100 },
        // @ts-expect-error — retired: `conditions` holds flat rows, never a sub-group
        { id: 'g2', logic: 'or', conditions: [] },
      ],
    };
    expect(refused.conditions).toHaveLength(2);
  });

  it('an authored `allowGroups` / `maxDepth` is a compile error', () => {
    const withAllowGroups: FilterBuilderSchema = {
      type: 'filter-builder',
      fields: [],
      // @ts-expect-error — retired: `filter-builder` has no nested groups to allow
      allowGroups: true,
    };
    const withMaxDepth: FilterBuilderSchema = {
      type: 'filter-builder',
      fields: [],
      // @ts-expect-error — retired: `filter-builder` has no nesting depth to limit
      maxDepth: 3,
    };
    expect([withAllowGroups.type, withMaxDepth.type]).toEqual(['filter-builder', 'filter-builder']);
  });

  it('CONTROL — the same group with its rows flat, and the node without the two keys, compile', () => {
    const flat: FilterGroup = {
      logic: 'and',
      conditions: [
        { id: 'c1', field: 'amount', operator: 'greater_than', value: 100 },
        { id: 'c2', field: 'amount', operator: 'less_than', value: 500 },
      ],
    };
    const bare: FilterBuilderSchema = { type: 'filter-builder', fields: [], value: flat };
    expect(bare.value?.conditions).toHaveLength(2);
  });
});
