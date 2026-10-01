// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics door refuses what the engine's aggregate door refuses: a
 * GROUPED dimension on a MULTI-VALUE field, and a `count_distinct` measure
 * over a JSON-STORED field — `INVALID_FIELD` / 400, naming the member the
 * caller wrote, before either strategy builds anything. A dataset measure's
 * `count_distinct` over a multi-capable field declared `multiple: true` is
 * refused at compile time beside the type row (`DATASET_INVALID` / 400).
 *
 * What these pins hold (the live-driver pins on SQLite and PostgreSQL are
 * `json-stored-door-live-drivers.test.ts`; the HTTP pins for the dataset route
 * are `packages/rest/src/analytics-dataset-multi-value-door.test.ts`):
 *
 * - one answer on BOTH strategy faces — `NativeSQLStrategy`, which compiled
 *   the `GROUP BY` / `COUNT(DISTINCT …)` itself and never reached the engine's
 *   door, and `ObjectQLStrategy`, which reached it and was refused there under
 *   the engine's position (`groupBy[0]`, `aggregations[0].field`);
 * - the DECLARATION, not the type alone: a `select` (or `lookup`, `user`,
 *   `file`, `image`, `radio`) with `multiple: true` is judged like `tags`, and
 *   the same type without the flag is served;
 * - no statement and no aggregate reaches the host bridges on a refusal;
 * - GUARD: the judged population is exactly what the spec's predicates
 *   answer, over every `FieldType` with and without `multiple: true` — the
 *   predicates the engine's doors read, never a second list.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import {
  FieldType,
  STRUCTURED_JSON_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
} from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

const OBJECT = 'mv_ledger';
const JOINED = 'mv_account';

type Declared = { type: string; multiple?: boolean };

/** The base object's fields: the scalar controls, every multi-value declaration, and a json field. */
const FIELDS: Record<string, Declared> = {
  title: { type: 'text' },
  status: { type: 'select' },
  owner: { type: 'lookup' },
  account: { type: 'lookup' },
  tags_f: { type: 'tags' },
  ms: { type: 'multiselect' },
  boxes: { type: 'checkboxes' },
  multi_sel: { type: 'select', multiple: true },
  multi_radio: { type: 'radio', multiple: true },
  multi_lookup: { type: 'lookup', multiple: true },
  multi_user: { type: 'user', multiple: true },
  multi_file: { type: 'file', multiple: true },
  multi_image: { type: 'image', multiple: true },
  meta: { type: 'json' },
  // GUARD population: one field per `FieldType`, bare and flagged.
  ...Object.fromEntries(FieldType.options.map((type) => [`f_${type}`, { type }])),
  ...Object.fromEntries(FieldType.options.map((type) => [`m_${type}`, { type, multiple: true }])),
};

/** The joined object: a text column and a multi-value one. */
const JOINED_FIELDS: Record<string, Declared> = {
  name: { type: 'text' },
  labels: { type: 'tags' },
};

/** Every declaration this card judges, as `[field, how it is declared]`. */
const MULTI_VALUE: ReadonlyArray<readonly [string, string]> = [
  ['tags_f', 'tags'],
  ['ms', 'multiselect'],
  ['boxes', 'checkboxes'],
  ['multi_sel', 'select with multiple: true'],
  ['multi_radio', 'radio with multiple: true'],
  ['multi_lookup', 'lookup with multiple: true'],
  ['multi_user', 'user with multiple: true'],
  ['multi_file', 'file with multiple: true'],
  ['multi_image', 'image with multiple: true'],
];

/** An authored cube: one dimension per field, a key over another column, and three authored distinct counts. */
const LEDGER_CUBE: Cube = {
  name: 'mv_cube',
  title: 'MV ledger',
  sql: OBJECT,
  public: true,
  measures: {
    count: { label: 'Rows', type: 'count', sql: '*' },
    distinct_labels: { label: 'Distinct labels', type: 'count_distinct', sql: 'multi_sel' },
    distinct_status: { label: 'Distinct status', type: 'count_distinct', sql: 'status' },
    // `count` over a multi-value column compares nothing: not judged.
    rows_with_tags: { label: 'Rows with tags', type: 'count', sql: 'tags_f' },
  },
  dimensions: {
    picked: { label: 'Picked', type: 'string', sql: 'multi_sel' },
    ...Object.fromEntries(Object.keys(FIELDS).map((f) => [f, { label: f, type: 'string' as const, sql: f }])),
  },
} as Cube;

const LEDGER_DATASET = {
  name: 'mv_ds',
  label: 'MV dataset',
  object: OBJECT,
  include: ['account'],
  dimensions: [
    { name: 'status_dim', field: 'status', type: 'string' },
    { name: 'picked_dim', field: 'multi_sel', type: 'string' },
    { name: 'tag_dim', field: 'tags_f', type: 'string' },
    { name: 'acct_name', field: 'account.name', type: 'string' },
    { name: 'acct_labels', field: 'account.labels', type: 'string' },
  ],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'acct_label_kinds', aggregate: 'count_distinct', field: 'account.labels' },
  ],
} as unknown as Dataset;

type Face = 'native' | 'objectql';

interface Refusal extends Error {
  code?: string;
  status?: number;
  member?: string;
  param?: string;
  field?: string;
  object?: string;
  cube?: string;
}

function makeService(face: Face) {
  const calls = { raw: [] as string[], aggregate: [] as unknown[] };
  const service = new AnalyticsService({
    logger: silentLogger,
    cubes: [LEDGER_CUBE],
    queryCapabilities: () => ({ nativeSql: face === 'native', objectqlAggregate: face === 'objectql', inMemory: false }),
    executeRawSql: async (_object: string, sql: string) => {
      calls.raw.push(sql);
      return [{ status: 'a', count: 2 }];
    },
    executeAggregate: async (_object: string, options: unknown) => {
      calls.aggregate.push(options);
      return [{ status: 'a', count: 2 }];
    },
    isRegisteredObject: (n: string) => n === OBJECT,
    getObjectFieldNames: (n: string) => (n === OBJECT ? Object.keys(FIELDS) : undefined),
    sourceFieldMeta: (o: string, f: string) => (o === OBJECT ? FIELDS[f] : o === JOINED ? JOINED_FIELDS[f] : undefined),
    relationshipResolver: (o: string, rel: string) => (o === OBJECT && rel === 'account' ? JOINED : undefined),
  });
  return { service, calls };
}

/** The error a call rejected with — and a loud failure if it resolved. */
async function rejection(call: Promise<unknown>): Promise<Refusal> {
  let resolved: unknown;
  try {
    resolved = await call;
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, got ${JSON.stringify(resolved)}`);
}

/** The ADR-0112 envelope plus the member the caller wrote. */
function envelopeOf(err: Refusal) {
  return { code: err.code, status: err.status, member: err.member, param: err.param, field: err.field, object: err.object };
}

describe('row 1 — a grouped dimension on a multi-value field is refused at the analytics door, on both faces', () => {
  for (const face of ['native', 'objectql'] as const) {
    it(`${face}: every multi-value declaration answers INVALID_FIELD / 400 naming the member — no statement, no aggregate`, async () => {
      const { service, calls } = makeService(face);
      for (const [field, declared] of MULTI_VALUE) {
        const err = await rejection(service.query({ cube: 'mv_cube', measures: ['count'], dimensions: [field] }));
        expect(envelopeOf(err), field).toEqual({
          code: 'INVALID_FIELD', status: 400, member: field, param: 'dimensions', field, object: OBJECT,
        });
        expect(err.message, field).toContain(
          `Dimension '${field}' on cube 'mv_cube' groups by field '${field}', which object '${OBJECT}' declares as ${declared} `
          + '— a multi-value field, which analytics does not group by. The query was NOT run.',
        );
      }
      expect(calls.raw, 'no statement reached the raw-SQL bridge').toEqual([]);
      expect(calls.aggregate, 'no aggregate reached the engine bridge').toEqual([]);
    });

    it(`${face}: CONTROL the same types without multiple: true, and the text column, are served`, async () => {
      const { service, calls } = makeService(face);
      for (const field of ['status', 'owner', 'title']) {
        await service.query({ cube: 'mv_cube', measures: ['count'], dimensions: [field] });
      }
      expect(calls.raw.length + calls.aggregate.length).toBe(3);
    });
  }

  it('names the member as the caller spelled it: a cube key over another column, the cube-qualified spelling, an ad-hoc cube', async () => {
    const { service, calls } = makeService('native');
    const keyed = await rejection(service.query({ cube: 'mv_cube', measures: ['count'], dimensions: ['title', 'picked'] }));
    expect(envelopeOf(keyed)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'picked', param: 'dimensions', field: 'multi_sel', object: OBJECT });
    const qualified = await rejection(service.query({ cube: 'mv_cube', measures: ['count'], dimensions: ['mv_cube.picked'] }));
    expect(envelopeOf(qualified)).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'mv_cube.picked', field: 'multi_sel' });
    const adhoc = await rejection(service.query({ cube: OBJECT, measures: ['count'], dimensions: ['multi_sel'] }));
    expect(envelopeOf(adhoc)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'multi_sel', param: 'dimensions', field: 'multi_sel', object: OBJECT });
    expect(calls.raw).toEqual([]);
  });

  it('a bucketed time dimension on a multi-value field is refused under timeDimensions', async () => {
    const { service, calls } = makeService('native');
    const err = await rejection(service.query({
      cube: OBJECT,
      measures: ['count'],
      timeDimensions: [{ dimension: 'tags_f', granularity: 'month' }],
    }));
    expect(envelopeOf(err)).toEqual({
      code: 'INVALID_FIELD', status: 400, member: 'tags_f', param: 'timeDimensions', field: 'tags_f', object: OBJECT,
    });
    expect(err.message).toContain(`Time dimension 'tags_f' on cube '${OBJECT}' buckets field 'tags_f'`);
    expect(calls.raw).toEqual([]);
  });

  it('a dataset dimension is refused naming the dataset dimension — and over an included relationship, on the JOINED object', async () => {
    const { service, calls } = makeService('native');
    const picked = await rejection(service.queryDataset(LEDGER_DATASET, { measures: ['row_count'], dimensions: ['picked_dim'] }));
    expect(envelopeOf(picked)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'picked_dim', param: 'dimensions', field: 'multi_sel', object: OBJECT });
    const joined = await rejection(service.queryDataset(LEDGER_DATASET, { measures: ['row_count'], dimensions: ['acct_labels'] }));
    expect(envelopeOf(joined)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'acct_labels', param: 'dimensions', field: 'account.labels', object: JOINED });
    expect(joined.message).toContain(`whose column 'labels' the joined object '${JOINED}' declares as tags`);
    expect(joined.message).toContain(`a record query on '${JOINED}' with where { "labels": { "$contains": VALUE } }`);
    expect(calls.raw).toEqual([]);
    // CONTROL the scalar dataset dimensions are served.
    await service.queryDataset(LEDGER_DATASET, { measures: ['row_count'], dimensions: ['status_dim'] });
    await service.queryDataset(LEDGER_DATASET, { measures: ['row_count'], dimensions: ['acct_name'] });
    expect(calls.raw).toHaveLength(2);
  });

  it('the dry-run door refuses before building the statement', async () => {
    const { service } = makeService('native');
    const err = await rejection(service.generateSql({ cube: 'mv_cube', measures: ['count'], dimensions: ['multi_sel'] }));
    expect(envelopeOf(err)).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'multi_sel' });
  });
});

describe('row 2 — a count_distinct measure over a JSON-stored field is refused at the analytics door, on both faces', () => {
  for (const face of ['native', 'objectql'] as const) {
    it(`${face}: an inferred FIELD_count_distinct over json, a multi-option type and a multiple: true select — ad-hoc and authored cube alike`, async () => {
      const { service, calls } = makeService(face);
      for (const cube of [OBJECT, 'mv_cube']) {
        for (const [field, declared, kind] of [
          ['meta', 'json', 'a structured-JSON value'],
          ['tags_f', 'tags', 'a multi-value field'],
          ['multi_sel', 'select with multiple: true', 'a multi-value field'],
        ] as const) {
          const member = `${field}_count_distinct`;
          const err = await rejection(service.query({ cube, measures: [member] }));
          expect(envelopeOf(err), `${cube} ${member}`).toEqual({
            code: 'INVALID_FIELD', status: 400, member, param: 'measures', field, object: OBJECT,
          });
          expect(err.message, `${cube} ${member}`).toContain(
            `Measure '${member}' on cube '${cube}' counts distinct field '${field}', which object '${OBJECT}' declares as ${declared} `
            + `— ${kind}, which analytics does not count distinct. The query was NOT run.`,
          );
        }
      }
      expect(calls.raw, 'no statement reached the raw-SQL bridge').toEqual([]);
      expect(calls.aggregate, 'no aggregate reached the engine bridge').toEqual([]);
    });

    it(`${face}: an AUTHORED count_distinct measure over a multiple: true select is refused naming the measure`, async () => {
      const { service, calls } = makeService(face);
      const err = await rejection(service.query({ cube: 'mv_cube', measures: ['count', 'distinct_labels'] }));
      expect(envelopeOf(err)).toEqual({
        code: 'INVALID_FIELD', status: 400, member: 'distinct_labels', param: 'measures', field: 'multi_sel', object: OBJECT,
      });
      expect(err.message).toContain('Count the records that hold one member instead');
      expect(calls.raw.length + calls.aggregate.length).toBe(0);
    });

    it(`${face}: CONTROL a scalar count_distinct and a count over a multi-value column are served`, async () => {
      const { service, calls } = makeService(face);
      await service.query({ cube: OBJECT, measures: ['status_count_distinct'] });
      await service.query({ cube: 'mv_cube', measures: ['distinct_status', 'rows_with_tags'] });
      expect(calls.raw.length + calls.aggregate.length).toBe(2);
    });
  }

  it('a dataset count_distinct over an included relationship\'s multi-value field is refused on the JOINED object at query time', async () => {
    const { service, calls } = makeService('native');
    const err = await rejection(service.queryDataset(LEDGER_DATASET, { measures: ['acct_label_kinds'], dimensions: ['status_dim'] }));
    expect(envelopeOf(err)).toEqual({
      code: 'INVALID_FIELD', status: 400, member: 'acct_label_kinds', param: 'measures', field: 'account.labels', object: JOINED,
    });
    expect(calls.raw).toEqual([]);
  });

  it('the structured-JSON route is the scalar one, the multi-value route is the membership filter', async () => {
    const { service } = makeService('native');
    const json = await rejection(service.query({ cube: OBJECT, measures: ['meta_count_distinct'] }));
    expect(json.message).toContain('Count distinct values of a field that stores one scalar value');
    expect(json.message).not.toContain('$contains');
    const multi = await rejection(service.query({ cube: OBJECT, measures: ['multi_sel_count_distinct'] }));
    expect(multi.message).toContain(
      `Count the records that hold one member instead: count with where { "multi_sel": { "$contains": VALUE } } in a record query on '${OBJECT}'`,
    );
  });
});

describe('row 3 — a dataset count_distinct measure over a multiple: true field is refused at compile time, by the declaration', () => {
  const dataset = (field: string) => DatasetSchema.parse({
    name: 'mv_distinct', label: 'MV distinct', object: OBJECT,
    dimensions: [], measures: [{ name: 'n_distinct', aggregate: 'count_distinct', field }],
  });
  const shapeOf = (_o: string, f: string) => {
    const d = FIELDS[f];
    return d ? { type: d.type, multiple: d.multiple === true } : undefined;
  };

  it('compileDataset reads the declaration: every multiple: true declaration answers DATASET_INVALID / 400 and names the flag', () => {
    for (const [field, declared] of MULTI_VALUE) {
      let err: Refusal | undefined;
      try {
        compileDataset(dataset(field), undefined, { declaredValueShape: shapeOf });
      } catch (e) {
        err = e as Refusal;
      }
      expect(err, field).toBeDefined();
      expect({ code: err!.code, status: err!.status }, field).toEqual({ code: 'DATASET_INVALID', status: 400 });
      expect(err!.message, field).toContain(`which object "${OBJECT}" declares as \`${declared.replace(' with multiple: true', '')}\``);
      if (declared.endsWith('with multiple: true')) expect(err!.message, field).toContain('with `multiple: true`');
      expect(err!.message, field).toContain('COMPARES the stored values for equality');
    }
  });

  it('CONTROL the same types without the flag compile', () => {
    for (const field of ['status', 'owner']) {
      expect(compileDataset(dataset(field), undefined, { declaredValueShape: shapeOf }).cube.measures.n_distinct?.type, field)
        .toBe('count_distinct');
    }
  });

  it('through the service: registration and the request door both refuse, before any statement', async () => {
    const { service, calls } = makeService('native');
    const registered = await rejection(Promise.resolve().then(() => service.registerDataset(dataset('multi_sel'))));
    expect({ code: registered.code, status: registered.status }).toEqual({ code: 'DATASET_INVALID', status: 400 });
    const requested = await rejection(service.queryDataset(dataset('multi_sel'), { measures: ['n_distinct'] }));
    expect({ code: requested.code, status: requested.status }).toEqual({ code: 'DATASET_INVALID', status: 400 });
    expect(calls.raw).toEqual([]);
    // CONTROL a single-value select is served.
    await service.queryDataset(dataset('status'), { measures: ['n_distinct'] });
    expect(calls.raw).toHaveLength(1);
  });
});

describe('GUARD the judged population is the spec predicates\', over every FieldType, bare and with multiple: true', () => {
  it('a grouped dimension is refused exactly when STRUCTURED_JSON_TYPES or isMultiValueField says so', async () => {
    const { service } = makeService('native');
    for (const type of FieldType.options) {
      for (const multiple of [false, true]) {
        const field = `${multiple ? 'm' : 'f'}_${type}`;
        const verdict = await service.generateSql({ cube: OBJECT, measures: ['count'], dimensions: [field] }).then(
          () => null,
          (e: Refusal) => ({ code: e.code, status: e.status, member: e.member }),
        );
        const judged = STRUCTURED_JSON_TYPES.has(type) || isMultiValueField({ type, multiple });
        expect(verdict, field).toEqual(judged ? { code: 'INVALID_FIELD', status: 400, member: field } : null);
      }
    }
  });

  it('a count_distinct measure is refused exactly when the table\'s row refuses the type or isMultiValueField says so', async () => {
    const { service } = makeService('native');
    for (const type of FieldType.options) {
      for (const multiple of [false, true]) {
        const field = `${multiple ? 'm' : 'f'}_${type}`;
        const member = `${field}_count_distinct`;
        const verdict = await service.generateSql({ cube: OBJECT, measures: [member] }).then(
          () => null,
          (e: Refusal) => ({ code: e.code, status: e.status, member: e.member }),
        );
        const judged = !isAggregateCompatibleWithFieldType('count_distinct', type) || isMultiValueField({ type, multiple });
        expect(verdict, field).toEqual(judged ? { code: 'INVALID_FIELD', status: 400, member } : null);
      }
    }
  });
});
