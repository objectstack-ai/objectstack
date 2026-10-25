/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Contract pin — a `filter-builder` node's `value` is a filter GROUP only, and
 * `defaultValue` is RETIRED (objectui#10825, ADR-0049 enforce-or-remove).
 *
 * ## The failure this pin exists to prevent
 *
 * The TypeScript face declared `value?: FilterGroup` and `defaultValue?:
 * FilterGroup`, while the zod mirror took `union([condition, group])` for
 * both. So a bare condition `{ id, field, operator, value }` authored as
 * `value` passed `safeValidateSchema`, and `FilterBuilder` then drew an EMPTY
 * builder: its `isValidGroup` gate needs `logic` and `conditions`, and it falls
 * back to `EMPTY_GROUP` without an error. `defaultValue` had no reader at all:
 * the registration hands `FilterBuilder` `schema.value || props.value`, and
 * `FilterBuilder` has no `defaultValue` prop. The render readings were taken
 * once, on the card's pull request; this file is the instrument that keeps the
 * contract.
 *
 * ## How refusals are asserted
 *
 * By the issue ENVELOPE — `code` and `path`, and that it is the ONLY issue —
 * at the public door `safeValidateSchema` and on the mirror. Beyond the
 * envelope, the bare-condition refusal must carry its prescription (wrap it in
 * a group), because that sentence is what tells an author the fix; and each
 * refusal's message must be the published `.describe()` metadata, one string.
 *
 * The `@ts-expect-error` directives and the `Expect<Equal<…>>` aliases in block
 * (e) are REAL enforcement: this package type-checks its tests through
 * `tsconfig.test.json`, so re-widening a member fails the build (TS2578 on an
 * unused directive, TS2344 on a false `Expect`). A green `vitest` run is NOT
 * evidence about them — type assertions are erased before it runs.
 */

import { describe, it, expect } from 'vitest';
import type { FilterBuilderSchema, FilterGroup } from '../complex';
import { FilterBuilderSchema as FilterBuilderMirror } from '../zod/complex.zod';
import { safeValidateSchema } from '../zod/index.zod';

const FIELDS = [{ value: 'amount', label: 'Amount', type: 'number' }];
const ROW = { id: 'c1', field: 'amount', operator: 'greater_than', value: 100 };
const group = (conditions: unknown[]) => ({ id: 'root', logic: 'and', conditions });
const node = (extra: Record<string, unknown>) => ({ type: 'filter-builder', name: 'f', fields: FIELDS, ...extra });

type Issue = { code: string; path: PropertyKey[]; message: string };
type Result = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
const issuesOf = (r: Result): Issue[] => r.error?.issues ?? [];
const envelope = (r: Result) => issuesOf(r).map(({ code, path }) => ({ code, path }));
const bothDoors = (doc: unknown): Result[] => [safeValidateSchema(doc as never) as Result, FilterBuilderMirror.safeParse(doc) as Result];

type Described = { description?: string };
const nodeShape = (FilterBuilderMirror as unknown as { shape: Record<string, Described> }).shape;

/** The prescription the refusal must carry, spelled as the triage ruling spells it. */
const WRAP_PRESCRIPTION = 'Wrap it in `{ logic, conditions: [ … ] }`';

/* ── (a) a bare condition as `value` is REFUSED by name ────────────────────── */

describe('objectui#10825 (a) — a bare condition authored as `value` is REFUSED by name', () => {
  const BARE: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['a complete condition', ROW],
    ['an id-less condition', { field: 'amount', operator: 'equals', value: 1 }],
    ['a value-less condition', { id: 'c1', field: 'amount', operator: 'is_null' }],
    ['a condition missing its field', { id: 'c1', operator: 'equals', value: 1 }],
  ];

  it.each(BARE)('%s: ONE `custom` issue at `value`, at both doors', (_label, condition) => {
    for (const r of bothDoors(node({ value: condition }))) {
      expect(r.success, 'a bare condition authored as `value` was ACCEPTED').toBe(false);
      expect(envelope(r)).toEqual([{ code: 'custom', path: ['value'] }]);
    }
  });

  it('the refusal carries the wrap prescription, and it is the published `value` metadata', () => {
    const [issue] = issuesOf(FilterBuilderMirror.safeParse(node({ value: ROW })) as Result);
    expect(issue!.message).toContain(WRAP_PRESCRIPTION);
    expect(issue!.message).toMatch(/objectui#10825/);
    expect(nodeShape.value!.description).toContain(issue!.message);
  });
});

/* ── (b) the union is gone: a group's refusal is reported at its own path ──── */

describe('objectui#10825 (b) — with the condition arm gone there is no union at `value`', () => {
  it('an id-less row in a group `value` is reported at its own path, not as an `invalid_union` at `value`', () => {
    // The union wrapped every refusal of a group in one `invalid_union` at
    // `value`, so a consumer reading `issue.path` never found the row.
    const idLess = node({ value: group([{ field: 'amount', operator: 'equals', value: 1 }]) });
    for (const r of bothDoors(idLess)) {
      expect(envelope(r)).toEqual([{ code: 'invalid_type', path: ['value', 'conditions', 0, 'id'] }]);
    }
  });
});

/* ── (c) LIT CONTROL: a group parses, and other shapes are judged as a group ─ */

describe('objectui#10825 (c) — LIT CONTROL: a group `value` is accepted, and nothing else moved', () => {
  it('the same condition, wrapped in a group, is accepted at both doors and parses to itself', () => {
    for (const r of bothDoors(node({ value: group([ROW]) }))) {
      expect(issuesOf(r)).toEqual([]);
      expect((r.data as { value: unknown }).value).toEqual(group([ROW]));
    }
    expect(issuesOf(safeValidateSchema(node({ value: group([]) }) as never) as Result)).toEqual([]);
    expect(issuesOf(safeValidateSchema(node({ value: { logic: 'or', conditions: [ROW] } }) as never) as Result)).toEqual([]);
    expect(issuesOf(safeValidateSchema(node({}) as never) as Result)).toEqual([]);
  });

  it('a malformed GROUP is judged by the group schema, not by the bare-condition refusal', () => {
    // The discriminator is a condition's own `field` / `operator` with no
    // `conditions`: these carry neither, so the named refusal must not fire.
    for (const value of [{ conditions: [] }, { status: 'active' }, 'amount > 100']) {
      const issues = issuesOf(safeValidateSchema(node({ value }) as never) as Result);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.code !== 'custom'), JSON.stringify(issues)).toBe(true);
    }
  });
});

/* ── (d) `defaultValue` is RETIRED on `filter-builder` ─────────────────────── */

describe('objectui#10825 (d) — `defaultValue` is RETIRED on `filter-builder`', () => {
  it.each([
    ['a group', group([ROW])],
    ['a bare condition', ROW],
    ['an empty group', group([])],
  ] as const)('refuses `defaultValue` holding %s: ONE `invalid_type` issue at the key, at both doors', (_label, value) => {
    for (const r of bothDoors(node({ defaultValue: value }))) {
      expect(r.success, 'an authored `defaultValue` was ACCEPTED').toBe(false);
      expect(envelope(r)).toEqual([{ code: 'invalid_type', path: ['defaultValue'] }]);
    }
  });

  it('the refusal names `value`, and it is the published `.describe()` metadata — ONE string', () => {
    const [issue] = issuesOf(FilterBuilderMirror.safeParse(node({ defaultValue: group([ROW]) })) as Result);
    expect(issue!.message).toBe(nodeShape.defaultValue!.description);
    expect(issue!.message).toMatch(/objectui#10825/);
    expect(issue!.message).toContain('`value`');
  });

  it('it stays DECLARED on the node shape — a tombstone, not a deletion', () => {
    // A deleted key would be KEPT in silence: the node is `.passthrough()`.
    expect(Object.keys(nodeShape)).toContain('defaultValue');
  });
});

/* ── (e) the TS twin carries the same contract ────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionDefaultValueRetired = Expect<Equal<FilterBuilderSchema['defaultValue'], undefined>>;
export type assertionValueIsAGroup = Expect<Equal<FilterBuilderSchema['value'], FilterGroup | undefined>>;
/** The helper can FAIL — control on the surviving `value` member of the same node. */
export type assertionEqualCanFail = Expect<Equal<Equal<FilterBuilderSchema['value'], undefined>, false>>;

describe('objectui#10825 (e) — the TS twin refuses what the mirror refuses', () => {
  it('an authored `defaultValue` is a compile error — checked by `tsc -p tsconfig.test.json`', () => {
    const withDefault: FilterBuilderSchema = {
      type: 'filter-builder',
      fields: [],
      // @ts-expect-error — retired: nothing reads `defaultValue`; author the group as `value`
      defaultValue: { logic: 'and', conditions: [] },
    };
    expect(withDefault.type).toBe('filter-builder');
  });

  it('CONTROL — a bare condition as `value` was already a compile error, and a group compiles', () => {
    const bare: FilterBuilderSchema = {
      type: 'filter-builder',
      fields: [],
      // @ts-expect-error — `value` is a group: a bare condition has no `logic` / `conditions`
      value: { id: 'c1', field: 'amount', operator: 'greater_than', value: 100 },
    };
    const wrapped: FilterBuilderSchema = {
      type: 'filter-builder',
      fields: [],
      value: { logic: 'and', conditions: [{ id: 'c1', field: 'amount', operator: 'greater_than', value: 100 }] },
    };
    expect([bare.type, wrapped.value?.conditions.length]).toEqual(['filter-builder', 1]);
  });
});
