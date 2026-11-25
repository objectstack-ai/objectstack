// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36677] The draft preview answers a `{ $field }` comparand as the live
 * faces of the dataset door answer it: a scalar-to-scalar reference compares
 * the row's two columns, and a reference the live faces refuse is refused with
 * their `INVALID_FILTER` / 400.
 *
 * Measured on `origin/main` (`e845656d`) before the change, through
 * `queryDataset` on the production composition below (counts over the six
 * rows of {@link ROWS}):
 *
 * | filter | native | ObjectQL | preview |
 * |---|---|---|---|
 * | `label $eq {$field:'alias'}` | 2 | 2 | 0 |
 * | `label $ne {$field:'alias'}` | 4 | 4 | 6 |
 * | `label $gt {$field:'alias'}` | 1 | 1 | 4 |
 * | `label $eq {$field:'tags'}` (and `picks`, a `select` declared `multiple`) | 400 | 400 | 0 |
 * | `label $ne {$field:'tags'}` (and `picks`) | 400 | 400 | 6 |
 * | `label $eq {$field:'amount'}` (cross-class) | 400 | 400 | 0 |
 * | `label $in [{$field:'alias'}]` | 400 | 400 | 0 |
 *
 * The preview compared the row value with the reference OBJECT, as text.
 *
 * What these pins hold:
 * - the scalar rows, under all six operators, `$not` and `$or`: the preview's
 *   count EQUALS the native strategy's, and both equal the declared count;
 * - the multi-value rows, and every other reference the live faces refuse:
 *   the preview refuses with the same `code` and `status`;
 * - the shared cross-field corpus (`@objectstack/driver-sql`'s
 *   `CROSS_FIELD_CASES`, which holds `@objectstack/formula`'s evaluator and the
 *   SQL compile to the same rows) row for row at the preview's filters, and
 *   its refusal table refused, but for the two tenant-column rows the preview
 *   does not judge (`preview-field-reference.ts`);
 * - the one shape the preview refuses where a live face serves it: an
 *   `addDays` offset reference, refused by name over the corpus's offset
 *   cases, while the same corpus's bare-reference controls are served with its
 *   rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import {
  CROSS_FIELD_CASES,
  CROSS_FIELD_OBJECT_FIELDS,
  CROSS_FIELD_OFFSET_CASES,
  CROSS_FIELD_OFFSET_OBJECT_FIELDS,
  CROSS_FIELD_OFFSET_ROWS,
  CROSS_FIELD_REFUSALS,
  CROSS_FIELD_ROWS,
  SqlDriver,
} from '@objectstack/driver-sql';
import type { ValueShapeFieldDef } from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { lowerPreviewRowFilters } from '../preview-evaluator.js';
import { PREVIEW_FIELD_REFERENCE_OPERATORS } from '../preview-field-reference.js';
import { CROSS_FIELD_COMPARISON_OPERATORS } from '../comparand-shape.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os36677_item';

/** One row per cell of the comparison's truth table, on a text pair and a numeric pair. */
const ROWS = [
  { id: 'r1', label: 'b', alias: 'a', amount: 10, budget: 5, tags: ['b'], picks: ['b'] }, // target > referent
  { id: 'r2', label: 'a', alias: 'b', amount: 3, budget: 5, tags: ['a'], picks: ['a'] }, // target < referent
  { id: 'r3', label: 'm', alias: 'm', amount: 7, budget: 7, tags: ['m'], picks: ['m'] }, // equal
  { id: 'r4', label: null, alias: 'm', amount: null, budget: 5, tags: null, picks: null }, // target empty
  { id: 'r5', label: 'w', alias: null, amount: 10, budget: null, tags: ['w'], picks: ['w'] }, // referent empty
  { id: 'r6', label: null, alias: null, amount: null, budget: null, tags: null, picks: null }, // both empty
];

const DATASET = DatasetSchema.parse({
  name: 'os36677_items',
  label: 'Items',
  object: OBJECT,
  dimensions: [{ name: 'label', field: 'label', type: 'string' }],
  measures: [{ name: 'cnt', aggregate: 'count' }],
}) as Dataset;

/** A `'protocol'` service answering one pending seed draft of the same rows, which routes `previewDrafts` onto the draft preview. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os36677_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

/** The scalar rows: the filter and the count the native strategy answers (measured, see the header). */
const SCALAR: Array<[Record<string, unknown>, number]> = [
  [{ label: { $eq: { $field: 'alias' } } }, 2],
  [{ label: { $ne: { $field: 'alias' } } }, 4],
  [{ label: { $gt: { $field: 'alias' } } }, 1],
  [{ label: { $gte: { $field: 'alias' } } }, 2],
  [{ label: { $lt: { $field: 'alias' } } }, 1],
  [{ label: { $lte: { $field: 'alias' } } }, 2],
  [{ amount: { $eq: { $field: 'budget' } } }, 2],
  [{ amount: { $ne: { $field: 'budget' } } }, 4],
  [{ amount: { $gt: { $field: 'budget' } } }, 1],
  [{ $not: { label: { $eq: { $field: 'alias' } } } }, 4],
  [{ $or: [{ label: { $gt: { $field: 'alias' } } }, { label: 'w' }] }, 2],
  [{ label: { $eq: { $field: 'label' } } }, 6],
];

/** References every live face refuses `INVALID_FILTER` / 400. */
const REFUSED: Record<string, unknown>[] = [
  { label: { $eq: { $field: 'tags' } } },
  { label: { $ne: { $field: 'tags' } } },
  { label: { $eq: { $field: 'picks' } } },
  { label: { $ne: { $field: 'picks' } } },
  { label: { $gt: { $field: 'tags' } } },
  { tags: { $eq: { $field: 'label' } } },
  { label: { $eq: { $field: 'amount' } } },
  { label: { $eq: { $field: 'nope' } } },
  { label: { $eq: { $field: 'account.name' } } },
  { label: { $in: [{ $field: 'alias' }] } },
  { label: { $contains: { $field: 'alias' } } },
  { amount: { $eq: { $field: 'budget', addDays: 1 } } },
];

describe('[#36677] the draft preview resolves a { $field } comparand as the live faces do', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const query = (face: Face, runtimeFilter: Record<string, unknown>) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      DATASET,
      { measures: ['cnt'], runtimeFilter } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    ) as Promise<{ rows: Array<Record<string, unknown>> }>;

  const countOf = async (face: Face, filter: Record<string, unknown>) => Number((await query(face, filter)).rows[0]?.cnt ?? 0);

  const refusalOf = async (face: Face, filter: Record<string, unknown>) => {
    try {
      await query(face, filter);
    } catch (e) {
      const { code, status } = e as { code?: unknown; status?: unknown };
      return { code, status };
    }
    return 'served';
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
        alias: { name: 'alias', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        budget: { name: 'budget', type: 'number' },
        tags: { name: 'tags', type: 'tags' },
        picks: { name: 'picks', type: 'select', multiple: true, options: ['a', 'b', 'm', 'w'].map((value) => ({ label: value, value })) },
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

  for (const [filter, count] of SCALAR) {
    it(`${JSON.stringify(filter)} → ${count}, the preview equal to the native strategy`, async () => {
      const [native, objectql, preview] = await Promise.all(FACES.map((face) => countOf(face, filter)));
      expect({ native, objectql, preview }).toEqual({ native: count, objectql: count, preview: count });
    });
  }

  for (const filter of REFUSED) {
    it(`${JSON.stringify(filter)} is refused INVALID_FILTER / 400 on every face`, async () => {
      const answers = await Promise.all(FACES.map((face) => refusalOf(face, filter)));
      const refused = { code: 'INVALID_FILTER', status: 400 };
      expect(answers).toEqual([refused, refused, refused]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

/** The preview's row filters for `where`, with the corpus fixture's declarations. */
function previewFiltersOver(fields: Record<string, Record<string, unknown>>) {
  const declaredType = (field: string) => (typeof fields[field]?.type === 'string' ? (fields[field]!.type as string) : undefined);
  const declaredShape = (field: string): ValueShapeFieldDef | undefined => {
    const type = declaredType(field);
    return type === undefined ? undefined : { type, multiple: fields[field]!.multiple === true };
  };
  const CUBE = { name: 'c', sql: 'x', measures: {}, dimensions: {} } as never;
  return (where: unknown) =>
    lowerPreviewRowFilters({ cube: 'c', measures: [], where } as unknown as AnalyticsQuery, CUBE, declaredType, undefined, declaredShape);
}

/** Does any `{ $field }` in `node` carry an `addDays` offset? */
function carriesOffset(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(carriesOffset);
  if (node === null || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  if (typeof record.$field === 'string' && record.addDays !== undefined) return true;
  return Object.values(record).some(carriesOffset);
}

describe('[#36677] the preview filters, measured against the shared cross-field corpus', () => {
  const filtersOf = previewFiltersOver(CROSS_FIELD_OBJECT_FIELDS);

  it('evaluates exactly the six operators the live faces compile a reference under', () => {
    expect([...PREVIEW_FIELD_REFERENCE_OPERATORS.keys()].sort()).toEqual([...CROSS_FIELD_COMPARISON_OPERATORS].sort());
  });

  it.each(CROSS_FIELD_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { matches } = filtersOf(c.filter);
    const ids = CROSS_FIELD_ROWS.filter((row) => matches({ ...row })).map((row) => row.id);
    expect(ids).toEqual(c.expected);
  });

  /** The two rows the preview cannot judge: it is handed no tenant-column fact (see `preview-field-reference.ts`). */
  const TENANT_ROWS = new Set([
    'the tenant-isolation column is refused as the REFERENT',
    'the tenant-isolation column is refused as the TARGET',
  ]);

  it('the tenant rows are present in the corpus, so the exclusion below names real rows', () => {
    expect(CROSS_FIELD_REFUSALS.filter((c) => TENANT_ROWS.has(c.name))).toHaveLength(TENANT_ROWS.size);
  });

  it.each(CROSS_FIELD_REFUSALS.filter((c) => !TENANT_ROWS.has(c.name)).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(() => filtersOf(c.filter)).toThrow(expect.objectContaining({ code: 'INVALID_FILTER', status: 400 }));
  });

  const offsetFiltersOf = previewFiltersOver(CROSS_FIELD_OFFSET_OBJECT_FIELDS);
  const OFFSET = CROSS_FIELD_OFFSET_CASES.filter((c) => carriesOffset(c.filter));
  const BARE = CROSS_FIELD_OFFSET_CASES.filter((c) => !carriesOffset(c.filter));

  it('the offset corpus carries both kinds of row, so neither table below is empty', () => {
    expect({ offset: OFFSET.length > 0, bare: BARE.length > 0 }).toEqual({ offset: true, bare: true });
  });

  it.each(OFFSET.map((c) => [c.name, c] as const))('an offset reference is refused by name: %s', (_name, c) => {
    expect(() => offsetFiltersOf(c.filter)).toThrow(
      expect.objectContaining({ code: 'INVALID_FILTER', status: 400, message: expect.stringContaining('addDays offset') }),
    );
  });

  it.each(BARE.map((c) => [c.name, c] as const))('a bare reference on the offset fixture is served: %s', (_name, c) => {
    const { matches } = offsetFiltersOf(c.filter);
    const ids = CROSS_FIELD_OFFSET_ROWS.filter((row) => matches({ ...row })).map((row) => row.id);
    expect(ids).toEqual(c.expected);
  });
});
