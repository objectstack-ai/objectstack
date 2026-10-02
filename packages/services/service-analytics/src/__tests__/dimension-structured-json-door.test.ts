// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A GROUPED dimension on a structured-JSON field — `json`, `composite`,
 * `repeater`, `record`, `location`, `address`, `vector` — is refused
 * `INVALID_FIELD` / 400 at the analytics door, naming the member the caller
 * wrote, before either strategy builds anything.
 *
 * What these pins hold, beside the HTTP pins on SQLite and PostgreSQL
 * (`packages/runtime/src/analytics-json-dimension-door.test.ts` for
 * `/api/v1/analytics/query` and `/sql`,
 * `packages/rest/src/analytics-dataset-json-dimension-door.test.ts` for
 * `/api/v1/analytics/dataset/query`):
 *
 * - one answer on BOTH strategy faces — `NativeSQLStrategy` (which compiled
 *   `GROUP BY` by hand and never reached the engine's own `groupBy` door) and
 *   `ObjectQLStrategy` (which reached it, and was refused there under the
 *   engine's `groupBy[0]` position rather than the member);
 * - the member as the caller spelled it: a cube key that differs from its
 *   column, a cube-qualified spelling, a dataset dimension, an ad-hoc
 *   (inferred) cube, and a bucketed time dimension;
 * - no statement and no aggregate reaches the host bridges on a refusal;
 * - [#21232] a relationship path the cube declares no join for is judged on
 *   the object the one hop resolver (`hop-object.ts`) names — the field's
 *   declared reference, else the alias — and stands down only where the host
 *   describes nothing there;
 * - GUARD: the judged types are exactly `@objectstack/spec/data`'s
 *   `STRUCTURED_JSON_TYPES` and `isMultiValueField`, over every `FieldType` —
 *   the predicates the engine's door reads, never a second list.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { FieldType, STRUCTURED_JSON_TYPES, isMultiValueField } from '@objectstack/spec/data';
import type { Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

const OBJECT = 'ledger';

/** One field per `FieldType`, named `f_<type>`, plus the text control `title` and a lookup to `account`. */
const FIELDS: Record<string, { type: string }> = {
  title: { type: 'text' },
  account: { type: 'lookup' },
  ...Object.fromEntries(FieldType.options.map((type) => [`f_${type}`, { type }])),
};

/** The joined object: a text column and a json one. */
const JOINED = 'account';
const JOINED_FIELDS: Record<string, { type: string }> = {
  name: { type: 'text' },
  hq: { type: 'json' },
};

/** An authored cube: a text dimension, a json one filed under a key that is not its column, and a time one. */
const LEDGER_CUBE: Cube = {
  name: 'ledger_cube',
  title: 'Ledger',
  sql: OBJECT,
  public: true,
  measures: { count: { label: 'Rows', type: 'count', sql: '*' } },
  dimensions: {
    title: { label: 'Title', type: 'string', sql: 'title' },
    doc: { label: 'Doc', type: 'string', sql: 'f_json' },
    stamped: { label: 'Stamped', type: 'time', sql: 'f_json', granularities: ['month'] },
    ...Object.fromEntries(
      [...STRUCTURED_JSON_TYPES].map((type) => [`f_${type}`, { label: type, type: 'string' as const, sql: `f_${type}` }]),
    ),
  },
} as Cube;

const LEDGER_DATASET = {
  name: 'ledger_ds',
  label: 'Ledger dataset',
  object: OBJECT,
  include: ['account'],
  dimensions: [
    { name: 'title_dim', field: 'title', type: 'string' },
    { name: 'meta_doc', field: 'f_json', type: 'string' },
    { name: 'acct_name', field: 'account.name', type: 'string' },
    { name: 'acct_hq', field: 'account.hq', type: 'string' },
  ],
  measures: [{ name: 'row_count', aggregate: 'count' }],
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

/**
 * `describes`: the object whose fields the host describes as {@link JOINED_FIELDS}
 * (`null`: none). `reference`: the target a relationship resolver declares for
 * `ledger.account` (absent: no resolver is wired).
 */
function makeService(
  face: Face,
  opts: { sourceFieldMeta?: boolean; describes?: string | null; reference?: string } = {},
) {
  const described = opts.describes === undefined ? JOINED : opts.describes;
  const calls = { raw: [] as string[], aggregate: [] as unknown[] };
  const service = new AnalyticsService({
    logger: silentLogger,
    cubes: [LEDGER_CUBE],
    queryCapabilities: () => ({ nativeSql: face === 'native', objectqlAggregate: face === 'objectql', inMemory: false }),
    executeRawSql: async (_object: string, sql: string) => {
      calls.raw.push(sql);
      return [{ title: 'x', count: 2 }];
    },
    executeAggregate: async (_object: string, options: unknown) => {
      calls.aggregate.push(options);
      return [{ title: 'x', count: 2 }];
    },
    isRegisteredObject: (n: string) => n === OBJECT,
    getObjectFieldNames: (n: string) => (n === OBJECT ? Object.keys(FIELDS) : undefined),
    ...(opts.sourceFieldMeta === false
      ? {}
      : { sourceFieldMeta: (o: string, f: string) => (o === OBJECT ? FIELDS[f] : o === described ? JOINED_FIELDS[f] : undefined) }),
    ...(opts.reference === undefined
      ? {}
      : { relationshipResolver: (o: string, rel: string) => (o === OBJECT && rel === 'account' ? opts.reference : undefined) }),
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

describe('a dimension on a structured-JSON field is refused at the analytics door, on both strategy faces', () => {
  for (const face of ['native', 'objectql'] as const) {
    it(`${face}: every structured-JSON type answers INVALID_FIELD / 400 naming the member — no statement, no aggregate`, async () => {
      const { service, calls } = makeService(face);
      for (const type of STRUCTURED_JSON_TYPES) {
        const member = `f_${type}`;
        const err = await rejection(service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: [member] }));
        expect(envelopeOf(err), type).toEqual({
          code: 'INVALID_FIELD', status: 400, member, param: 'dimensions', field: member, object: OBJECT,
        });
        expect(err.message, type).toContain(`Dimension '${member}' on cube 'ledger_cube' groups by field '${member}'`);
        expect(err.message, type).toContain(`declares as ${type}`);
      }
      expect(calls.raw, 'no statement reached the raw-SQL bridge').toEqual([]);
      expect(calls.aggregate, 'no aggregate reached the engine bridge').toEqual([]);
    });
  }

  it('names the member as the caller spelled it: a cube key over another column, and the cube-qualified spelling', async () => {
    const { service, calls } = makeService('native');
    const keyed = await rejection(service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['title', 'doc'] }));
    expect(envelopeOf(keyed)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'doc', param: 'dimensions', field: 'f_json', object: OBJECT });
    expect(keyed.message).toContain(`Dimension 'doc' on cube 'ledger_cube' groups by field 'f_json'`);
    const qualified = await rejection(service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['ledger_cube.doc'] }));
    expect(envelopeOf(qualified)).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'ledger_cube.doc', field: 'f_json' });
    expect(calls.raw).toEqual([]);
  });

  it('a bucketed time dimension on a json field is refused the same way, under timeDimensions — on the ObjectQL face too', async () => {
    for (const face of ['native', 'objectql'] as const) {
      const { service, calls } = makeService(face);
      const err = await rejection(service.query({
        cube: 'ledger_cube',
        measures: ['count'],
        timeDimensions: [{ dimension: 'stamped', granularity: 'month' }],
      }));
      expect(envelopeOf(err), face).toEqual({
        code: 'INVALID_FIELD', status: 400, member: 'stamped', param: 'timeDimensions', field: 'f_json', object: OBJECT,
      });
      expect(err.message, face).toContain(`Time dimension 'stamped' on cube 'ledger_cube' buckets field 'f_json'`);
      expect(calls.aggregate, `${face}: the engine was not asked`).toEqual([]);
      // …and the cube's declared default bucket makes a GROUPED time dimension out of a plain `dimensions` entry.
      const defaulted = await rejection(service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['stamped'] }));
      expect(envelopeOf(defaulted), face).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'stamped', param: 'dimensions' });
    }
  });

  it('a dataset dimension is refused naming the dataset dimension', async () => {
    const { service, calls } = makeService('native');
    const err = await rejection(service.queryDataset(LEDGER_DATASET, { measures: ['row_count'], dimensions: ['meta_doc'] }));
    expect(envelopeOf(err)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'meta_doc', param: 'dimensions', field: 'f_json', object: OBJECT });
    expect(err.message).toContain(`Dimension 'meta_doc' on cube 'ledger_ds' groups by field 'f_json'`);
    expect(calls.raw).toEqual([]);
  });

  it('a dataset dimension over an included relationship is judged on the JOINED object — naming the dataset dimension', async () => {
    const { service, calls } = makeService('native');
    const err = await rejection(service.queryDataset(LEDGER_DATASET, { measures: ['row_count'], dimensions: ['acct_hq'] }));
    expect(envelopeOf(err)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'acct_hq', param: 'dimensions', field: 'account.hq', object: JOINED });
    expect(err.message).toContain(`Dimension 'acct_hq' on cube 'ledger_ds' groups by field 'account.hq', whose column 'hq' the joined object '${JOINED}' declares as json`);
    expect(calls.raw).toEqual([]);
    // CONTROL the joined text column is served.
    await service.queryDataset(LEDGER_DATASET, { measures: ['row_count'], dimensions: ['acct_name'] });
    expect(calls.raw).toHaveLength(1);
  });

  it('an ad-hoc query (no cube registered under the object name) is refused the same way', async () => {
    const { service, calls } = makeService('native');
    const err = await rejection(service.query({ cube: OBJECT, measures: ['count'], dimensions: ['f_json'] }));
    expect(envelopeOf(err)).toEqual({ code: 'INVALID_FIELD', status: 400, member: 'f_json', param: 'dimensions', field: 'f_json', object: OBJECT });
    expect(calls.raw).toEqual([]);
  });

  it('the dry-run door refuses before building the statement', async () => {
    const { service } = makeService('native');
    const err = await rejection(service.generateSql({ cube: 'ledger_cube', measures: ['count'], dimensions: ['doc'] }));
    expect(envelopeOf(err)).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'doc' });
  });
});

describe('[#21232] a dotted path the cube declares no join for is judged on the object the one hop resolver names', () => {
  // `ledger_cube` declares no join; `account.hq` is an undeclared member, so
  // its column is the path itself. The live-driver pins over the plugin's own
  // composition are `json-stored-door-undeclared-join.test.ts`.
  const REFERENCED = 'crm_account';

  for (const face of ['native', 'objectql'] as const) {
    it(`${face}: the relationship field's declared reference names the object — INVALID_FIELD / 400, nothing read`, async () => {
      const { service, calls } = makeService(face, { describes: REFERENCED, reference: REFERENCED });
      const err = await rejection(service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['account.hq'] }));
      expect(envelopeOf(err)).toEqual({
        code: 'INVALID_FIELD', status: 400, member: 'account.hq', param: 'dimensions', field: 'account.hq', object: REFERENCED,
      });
      expect(calls.raw, 'no statement reached the raw-SQL bridge').toEqual([]);
      expect(calls.aggregate, 'no aggregate reached the engine bridge').toEqual([]);
    });
  }

  it('the reference, not the alias: an alias that names a described object is not what the door reads', async () => {
    // The host describes `account` (the alias) with `hq` json, but the lookup
    // declares `crm_account`, which it does not describe: the strategy joins
    // `crm_account`, so the door has nothing to answer and stands down.
    const { service, calls } = makeService('native', { describes: JOINED, reference: REFERENCED });
    await service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['account.hq'] });
    expect(calls.raw).toHaveLength(1);
    expect(calls.raw[0]).toContain(`"${REFERENCED}"`);
  });

  it('a host that names no reference: the hop reads its alias, the table the strategy joins, and is judged there', async () => {
    const { service, calls } = makeService('native');
    const err = await rejection(service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['account.hq'] }));
    expect(envelopeOf(err)).toEqual({
      code: 'INVALID_FIELD', status: 400, member: 'account.hq', param: 'dimensions', field: 'account.hq', object: JOINED,
    });
    const dry = await rejection(service.generateSql({ cube: 'ledger_cube', measures: ['count'], dimensions: ['account.hq'] }));
    expect(envelopeOf(dry)).toEqual(envelopeOf(err));
    expect(calls.raw).toEqual([]);
  });

  it('CONTROL the referenced object\'s text column is served', async () => {
    const { service, calls } = makeService('native', { describes: REFERENCED, reference: REFERENCED });
    await service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['account.name'] });
    expect(calls.raw).toHaveLength(1);
  });
});

describe('what the door does not judge', () => {
  it('CONTROL a text dimension is served — the native face runs its one statement', async () => {
    const { service, calls } = makeService('native');
    const result = await service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['title'] });
    expect(result.rows).toEqual([{ title: 'x', count: 2 }]);
    expect(calls.raw).toHaveLength(1);
  });

  it('an unknown field keeps the existence gate\'s answer: that verdict comes first', async () => {
    const { service } = makeService('native');
    const err = await rejection(service.query({ cube: OBJECT, measures: ['count'], dimensions: ['nope'] }));
    expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
    expect(err.message).toContain("which object 'ledger' does not have");
  });

  it('a dotted path whose column the host does not describe cannot be answered, so the door stands down', async () => {
    const { service, calls } = makeService('native', { describes: null });
    await service.generateSql({ cube: 'ledger_cube', measures: ['count'], dimensions: ['account.hq'] });
    await service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['account.hq'] });
    expect(calls.raw).toHaveLength(1);
  });

  it('a host that wires no sourceFieldMeta cannot name the type, so the door stands down', async () => {
    const { service, calls } = makeService('native', { sourceFieldMeta: false });
    await service.query({ cube: 'ledger_cube', measures: ['count'], dimensions: ['doc'] });
    expect(calls.raw).toHaveLength(1);
  });

  it('GUARD the judged types are exactly the spec\'s STRUCTURED_JSON_TYPES and isMultiValueField, over every FieldType', async () => {
    // The multi-value class joined the door with the engine's: an inherently
    // multi option type (`multiselect`, `checkboxes`, `tags`) is judged with or
    // without the flag. The flagged half is pinned in
    // `multi-value-json-stored-door.test.ts`.
    const { service } = makeService('native');
    for (const type of FieldType.options) {
      const query: AnalyticsQuery = { cube: OBJECT, measures: ['count'], dimensions: [`f_${type}`] };
      const verdict = await service.generateSql(query).then(
        () => null,
        (e: Refusal) => ({ code: e.code, status: e.status, member: e.member }),
      );
      expect(verdict, type).toEqual(
        STRUCTURED_JSON_TYPES.has(type) || isMultiValueField({ type })
          ? { code: 'INVALID_FIELD', status: 400, member: `f_${type}` }
          : null,
      );
    }
  });
});
