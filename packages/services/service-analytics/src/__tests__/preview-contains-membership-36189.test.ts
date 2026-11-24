// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36189] The draft preview answers `$contains` / `$notContains` as the live
 * faces of the dataset door answer them: MEMBERSHIP on a field declared
 * multi-valued or JSON-stored, the case-exact substring of a stored string
 * elsewhere.
 *
 * Measured on `origin/main` (`3cf6a44b`) before the change, through
 * `queryDataset` on the production composition below (counts over the four
 * rows of {@link ROWS}):
 *
 * | filter | native | ObjectQL | preview |
 * |---|---|---|---|
 * | `tags $contains 'a'` (substring-only `['ab']`, case-only `['A']`) | 1 | 1 | 3 |
 * | `tags $contains 'A'` | 1 | 1 | 3 |
 * | `tags $contains 'a,b'` (the comma-joined string form) | 0 | 0 | 1 |
 * | `$not tags $contains 'a'` | 3 | 3 | 1 |
 * | `tags $notContains 'a'` | 3 | 3 | 400, not evaluated |
 * | `label $contains 'A'` (scalar text, case-only) | 1 | 1 | 3 |
 *
 * the same on the `select` declared `multiple: true`. The preview read
 * `String(value).toLowerCase().includes(…)` on every column: the drafted
 * list's string form, folded.
 *
 * What these pins hold:
 * - on both JSON-stored fields, the substring-only value, the case-only
 *   difference and the comma-joined value, under `$contains`, `$notContains`
 *   and `$not`: the preview's count EQUALS the native strategy's, and both
 *   equal the declared count;
 * - CONTROL: the scalar text column keeps the substring reading, case-exact
 *   (`FILTER_TEXT_CASES`, #4706 Q2 = A), equal on every face;
 * - the member reading `jsonMembershipCandidates` gives every SQL face
 *   (a number or boolean named by its text, a nested array or a non-array
 *   value holding no member), at the matcher;
 * - `$notContains`, new to the preview's table, and the case rule, measured
 *   against `FILTER_TEXT_CASES`: every row of the shared text kit whose
 *   operators the preview evaluates is answered with the kit's ids.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  lowerFilterCondition,
  type ValueShapeFieldDef,
} from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { matchesWhere } from '../preview-evaluator.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os36189_item';

/** Each row makes one wrong answer visible for the comparand `'a'` / `'A'` / `'a,b'`. */
const ROWS = [
  // substring-only: `'a'` is in the TEXT `ab`, and no member is `'a'`.
  { id: 'r1', label: 'ab', tags: ['ab'], picks: ['ab'] },
  // case-only: `'a'` folds onto `'A'`, and no member is `'a'`.
  { id: 'r2', label: 'A', tags: ['A'], picks: ['A'] },
  // comma-joined: `String(['a', 'b'])` is `'a,b'`, and no member is `'a,b'`.
  { id: 'r3', label: 'a,b', tags: ['a', 'b'], picks: ['a', 'b'] },
  { id: 'r4', label: null, tags: null, picks: null },
];

const DATASET = DatasetSchema.parse({
  name: 'os36189_items',
  label: 'Items',
  object: OBJECT,
  dimensions: [{ name: 'label', field: 'label', type: 'string' }],
  measures: [{ name: 'cnt', aggregate: 'count' }],
}) as Dataset;

/** A `'protocol'` service answering one pending seed draft of the same rows, which routes `previewDrafts` onto the draft preview. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os36189_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

/** The JSON-stored fields: an inherently multi-value type and a `multiple: true` declaration. */
const JSON_FIELDS = ['tags', 'picks'] as const;

/** On a JSON-stored field: the filter and the rows whose MEMBERS answer it. */
const MEMBERSHIP: Array<[string, (f: string) => Record<string, unknown>, number]> = [
  ["$contains 'a' (substring-only and case-only rows excluded)", (f) => ({ [f]: { $contains: 'a' } }), 1],
  ["$contains 'A' (case-only)", (f) => ({ [f]: { $contains: 'A' } }), 1],
  ["$contains 'a,b' (the comma-joined string form)", (f) => ({ [f]: { $contains: 'a,b' } }), 0],
  ["$contains 'ab' (a whole member)", (f) => ({ [f]: { $contains: 'ab' } }), 1],
  ["$notContains 'a'", (f) => ({ [f]: { $notContains: 'a' } }), 3],
  ["$notContains 'A'", (f) => ({ [f]: { $notContains: 'A' } }), 3],
  ["$notContains 'a,b'", (f) => ({ [f]: { $notContains: 'a,b' } }), 4],
  ["$not $contains 'a'", (f) => ({ $not: { [f]: { $contains: 'a' } } }), 3],
  ["$or of two $contains", (f) => ({ $or: [{ [f]: { $contains: 'A' } }, { [f]: { $contains: 'ab' } }] }), 2],
];

/** CONTROL, on the scalar text column: the case-exact substring. */
const SCALAR: Array<[Record<string, unknown>, number]> = [
  [{ label: { $contains: 'a' } }, 2],
  [{ label: { $contains: 'A' } }, 1],
  [{ label: { $contains: 'a,b' } }, 1],
  [{ label: { $notContains: 'a' } }, 2],
  [{ label: { $notContains: 'A' } }, 3],
  [{ $not: { label: { $contains: 'a' } } }, 2],
];

describe('[#36189] the draft preview answers $contains on a multi-value field as membership, as the live faces do', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const countOf = async (face: Face, runtimeFilter: Record<string, unknown>): Promise<number> => {
    const result = (await services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      DATASET,
      { measures: ['cnt'], runtimeFilter } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    )) as { rows: Array<Record<string, unknown>> };
    return Number(result.rows[0]?.cnt ?? 0);
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Item',
      fields: {
        label: { name: 'label', type: 'text' },
        tags: { name: 'tags', type: 'tags' },
        picks: {
          name: 'picks',
          type: 'select',
          multiple: true,
          options: ['a', 'b', 'ab', 'A'].map((value) => ({ label: value, value })),
        },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never);

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine, protocol: pendingSeedProtocol };
      await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
        getService: (name: string) => provided[name] ?? registered[name],
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      services[face] = registered.analytics as AnalyticsService;
    }
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('CONTROL: the fixture is served unfiltered on every face', async () => {
    for (const face of FACES) expect(await countOf(face, {}), face).toBe(ROWS.length);
  });

  for (const field of JSON_FIELDS) {
    for (const [label, filterOf, count] of MEMBERSHIP) {
      it(`${field}: ${label} → ${count}, the preview equal to the native strategy`, async () => {
        const filter = filterOf(field);
        const [native, objectql, preview] = await Promise.all(FACES.map((face) => countOf(face, filter)));
        expect({ native, objectql, preview }, JSON.stringify(filter)).toEqual({ native: count, objectql: count, preview: count });
      });
    }
  }

  it('CONTROL: the scalar text column keeps the case-exact substring, equal on every face', async () => {
    for (const [filter, count] of SCALAR) {
      const [native, objectql, preview] = await Promise.all(FACES.map((face) => countOf(face, filter)));
      expect({ native, objectql, preview }, JSON.stringify(filter)).toEqual({ native: count, objectql: count, preview: count });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#36189] the matcher reads a comparand as the members every SQL face binds', () => {
  const SHAPES: Record<string, ValueShapeFieldDef> = {
    tags: { type: 'tags' },
    doc: { type: 'json' },
    label: { type: 'text' },
  };
  const shapeOf = (field: string) => SHAPES[field];
  const hit = (row: Record<string, unknown>, where: Record<string, unknown>) => matchesWhere(row, where, shapeOf);

  it('a number or a boolean member is named by its text', () => {
    expect(hit({ doc: [1, 2] }, { doc: { $contains: '1' } })).toBe(true);
    expect(hit({ doc: [1.5, 0] }, { doc: { $contains: '1.50' } })).toBe(true);
    expect(hit({ doc: [true] }, { doc: { $contains: 'true' } })).toBe(true);
    expect(hit({ doc: [10, 21] }, { doc: { $contains: '1' } })).toBe(false);
  });

  it('a nested array, an object and a value that is not an array hold no member', () => {
    expect(hit({ doc: [['a']] }, { doc: { $contains: 'a' } })).toBe(false);
    expect(hit({ doc: { k: 'a' } }, { doc: { $contains: 'a' } })).toBe(false);
    expect(hit({ tags: '["a"]' }, { tags: { $contains: 'a' } })).toBe(false);
    expect(hit({ tags: '["a"]' }, { tags: { $notContains: 'a' } })).toBe(true);
  });

  it('a field the caller cannot name keeps the substring reading, as the native compile does', () => {
    expect(matchesWhere({ tags: 'ab' }, { tags: { $contains: 'a' } })).toBe(true);
    expect(hit({ other: 'ab' }, { other: { $contains: 'a' } })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#36189] the $contains pair on the preview, measured against FILTER_TEXT_CASES', () => {
  /** The text operators the preview's table carries; a case naming any other operator is not this face's. */
  const EVALUATED_TEXT_OPERATORS = new Set(['$contains', '$notContains']);
  const operatorsOf = (node: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(node)) node.forEach((n) => operatorsOf(n, out));
    else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('$') && key !== '$and' && key !== '$or' && key !== '$not') out.add(key);
        operatorsOf(value, out);
      }
    }
    return out;
  };
  const CASES = FILTER_TEXT_CASES.filter(
    (c) => c.expectRejection !== true && [...operatorsOf(c.filter)].every((op) => EVALUATED_TEXT_OPERATORS.has(op)),
  );

  it('selects the kit rows about the $contains pair — otherwise the table below asserts nothing', () => {
    expect(CASES.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        '$contains treats _ as a literal character too',
        '$contains is case-SENSITIVE — a lower-case comparand misses the upper-case row',
        '$contains is case-SENSITIVE — an upper-case comparand misses the lower-case row',
        '$notContains is case-SENSITIVE, and negation does not widen it',
        '$contains never matches a stored value that is not a string',
        '$notContains is satisfied by every stored value that is not a string — complementarity holds',
      ]),
    );
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const where = lowerFilterCondition(c.filter) as Record<string, unknown>;
    const ids = FILTER_TEXT_ROWS.filter((row) => matchesWhere({ ...row }, where)).map((row) => row.id);
    expect(ids).toEqual(c.expectRejection === true ? [] : c.expected);
  });
});
