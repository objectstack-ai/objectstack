// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20917] The FIELD-LEVEL read gate at the analytics door.
 *
 * Every member a query names is resolved to the field it reads — through the
 * cube's own declaration, through a join, or as the object's own column — and
 * judged against the caller's readable fields, asked of the host's reader
 * (`AnalyticsServiceConfig.getReadableFields`; the plugin bridges it to the
 * `security` service). A member the caller may not read is refused
 * `PERMISSION_DENIED` / 403 in the engine's words, BEFORE a strategy is
 * selected — so every case below runs through both strategy paths from one
 * table, and asserts that nothing executed.
 *
 * The route-level half, over the real `SecurityPlugin`, `ObjectQL` and
 * `SqlDriver`, compares each refusal with the engine's own answer:
 * `packages/rest/src/analytics-field-permission-gate.test.ts`.
 *
 * [#20965] A member that resolves to neither a field nor `'*'` is refused, in
 * the same envelope, and never stood down — see the block of that name below.
 * Its fixture, `AUTHORED`'s two expression members, is written around the
 * parse: `CubeSchema` refuses both, and the registry never parses, which is
 * how a cube configured before that refusal (or never put through it) still
 * reaches the gate.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { CubeSchema, type Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const LEDGER = 'fr_ledger';
const OWNER = 'fr_owner';

/** Each object's declared fields, as the schema registry answers them. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  [LEDGER]: ['title', 'hidden_text', 'hidden_number', 'hidden_at', 'owner', 'hidden_link', 'created_at'],
  [OWNER]: ['region', 'hidden_text'],
};

/** What the caller may read of each: the reader's answer. */
const READABLE: Readonly<Record<string, readonly string[]>> = {
  [LEDGER]: ['id', 'title', 'owner', 'created_at'],
  [OWNER]: ['id', 'region'],
};

const CALLER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;

const AUTHORED: Cube = {
  name: 'fr_authored',
  title: 'Authored ledger',
  sql: LEDGER,
  public: true,
  measures: {
    count: { type: 'count', sql: '*', label: 'Count' },
    alias_total: { type: 'sum', sql: 'hidden_number', label: 'Total' },
    expression_total: { type: 'sum', sql: 'SUM(hidden_number) / 2', label: 'Expression total' },
  },
  dimensions: {
    title: { type: 'string', sql: 'title', label: 'Title' },
    alias_code: { type: 'string', sql: 'hidden_text', label: 'Code' },
    alias_owner_code: { type: 'string', sql: 'owner.hidden_text', label: 'Owner code' },
    alias_owner_region: { type: 'string', sql: 'owner.region', label: 'Owner region' },
    alias_link_region: { type: 'string', sql: 'hidden_link.region', label: 'Linked region' },
    expression_flag: { type: 'number', sql: "CASE WHEN hidden_text = 'x1' THEN 1 ELSE 0 END", label: 'Flag' },
  },
  joins: { owner: { name: OWNER }, hidden_link: { name: OWNER } },
} as Cube;

/** [#20965] A declared member with no `sql` string at all — refused at parse, unparsed here. */
const NO_SQL: Cube = {
  name: 'fr_no_sql',
  title: 'No sql',
  sql: LEDGER,
  public: true,
  measures: { count: { type: 'count', sql: '*', label: 'Count' } },
  dimensions: { bare: { type: 'string', label: 'Bare' } },
} as unknown as Cube;

/** A registered dataset whose OWN filter, and one of whose measures' filter, name a hidden field. */
const SCOPED_DATASET = DatasetSchema.parse({
  name: 'fr_scoped',
  label: 'Scoped',
  object: LEDGER,
  filter: { hidden_text: 'x1' },
  dimensions: [{ name: 'title', field: 'title', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
  ],
});
const MEASURE_FILTER_DATASET = DatasetSchema.parse({
  name: 'fr_measure_scoped',
  label: 'Measure scoped',
  object: LEDGER,
  dimensions: [{ name: 'title', field: 'title', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'filtered_count', aggregate: 'count', filter: { hidden_text: 'x1' } },
  ],
});

const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

const STRATEGY_PATHS = [
  { label: 'NativeSQLStrategy', capabilities: nativeSqlOnly },
  { label: 'ObjectQLStrategy', capabilities: objectqlOnly },
] as const;

type ReadableFields = (object: string, context?: ExecutionContext) =>
  readonly string[] | undefined | Promise<readonly string[] | undefined>;

function makeService(opts: {
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };
  getReadableFields?: ReadableFields;
  getObjectFieldNames?: ((object: string) => readonly string[] | undefined) | null;
  getReadScope?: (object: string) => Record<string, unknown> | undefined;
  draftRowsResolver?: (object: string) => Promise<Record<string, unknown>[] | null>;
  logger?: Record<string, unknown>;
}) {
  const executed: string[] = [];
  const service = new AnalyticsService({
    cubes: [AUTHORED, NO_SQL],
    datasets: [SCOPED_DATASET, MEASURE_FILTER_DATASET],
    queryCapabilities: opts.capabilities,
    getReadableFields: opts.getReadableFields,
    getObjectFieldNames: opts.getObjectFieldNames === null
      ? undefined
      : (opts.getObjectFieldNames ?? ((object: string) => FIELDS[object])),
    getReadScope: opts.getReadScope as never,
    draftRowsResolver: opts.draftRowsResolver,
    ...(opts.logger ? { logger: opts.logger as never } : {}),
    executeRawSql: async (object: string, sql: string) => {
      executed.push(`sql:${object}:${sql}`);
      return [];
    },
    executeAggregate: async (object: string) => {
      executed.push(`aggregate:${object}`);
      return [];
    },
  } as never);
  return { service, executed };
}

const readable: ReadableFields = (object) => READABLE[object];

/** The first sentence of each of the engine's two refusals. */
const aggregateSentence = (object: string, fields: string[]) =>
  `[Security] Field read denied: not permitted to aggregate [${fields.join(', ')}] on '${object}'`;
const predicateSentence = (object: string, fields: string[]) =>
  `[Security] Access denied: query on '${object}' references field(s) not readable by the caller: ${fields.join(', ')}.`;

interface RefusalCase {
  label: string;
  query: Record<string, unknown>;
  role: 'aggregate' | 'predicate';
  object: string;
  fields: string[];
}

const REFUSED: readonly RefusalCase[] = [
  { label: 'a grouped alias', query: { cube: 'fr_authored', measures: ['count'], dimensions: ['alias_code'] }, role: 'aggregate', object: LEDGER, fields: ['hidden_text'] },
  { label: 'an aggregated alias', query: { cube: 'fr_authored', measures: ['alias_total'] }, role: 'aggregate', object: LEDGER, fields: ['hidden_number'] },
  { label: 'an inferred measure', query: { cube: LEDGER, measures: ['hidden_number_sum'] }, role: 'aggregate', object: LEDGER, fields: ['hidden_number'] },
  { label: 'a grouped column of the inferred cube', query: { cube: LEDGER, measures: ['count'], dimensions: ['hidden_text'] }, role: 'aggregate', object: LEDGER, fields: ['hidden_text'] },
  { label: 'a bucketed time dimension', query: { cube: LEDGER, measures: ['count'], timeDimensions: [{ dimension: 'hidden_at', granularity: 'month' }] }, role: 'aggregate', object: LEDGER, fields: ['hidden_at'] },
  { label: 'a time dimension\'s window', query: { cube: LEDGER, measures: ['count'], timeDimensions: [{ dimension: 'hidden_at', dateRange: ['2026-01-01', '2026-01-31'] }] }, role: 'predicate', object: LEDGER, fields: ['hidden_at'] },
  { label: 'a filtered alias', query: { cube: 'fr_authored', measures: ['count'], where: { alias_code: 'x1' } }, role: 'predicate', object: LEDGER, fields: ['hidden_text'] },
  { label: 'a filtered column under $or and $not', query: { cube: LEDGER, measures: ['count'], where: { $or: [{ title: 't1' }, { $not: { hidden_text: 'x1' } }] } }, role: 'predicate', object: LEDGER, fields: ['hidden_text'] },
  { label: 'an order key', query: { cube: LEDGER, measures: ['count'], dimensions: ['title'], order: { hidden_text: 'asc' } }, role: 'predicate', object: LEDGER, fields: ['hidden_text'] },
  { label: 'a joined alias, judged on the joined object', query: { cube: 'fr_authored', measures: ['count'], dimensions: ['alias_owner_code'] }, role: 'aggregate', object: OWNER, fields: ['hidden_text'] },
  { label: 'an undeclared joined member', query: { cube: 'fr_authored', measures: ['count'], where: { 'owner.hidden_text': 'h1' } }, role: 'predicate', object: OWNER, fields: ['hidden_text'] },
  { label: 'a join through a hidden relationship field', query: { cube: 'fr_authored', measures: ['count'], dimensions: ['alias_link_region'] }, role: 'aggregate', object: LEDGER, fields: ['hidden_link'] },
  { label: 'a dataset\'s own filter', query: { cube: 'fr_scoped', measures: ['row_count'], dimensions: ['title'] }, role: 'predicate', object: LEDGER, fields: ['hidden_text'] },
  { label: 'a requested measure\'s own filter', query: { cube: 'fr_measure_scoped', measures: ['filtered_count'], dimensions: ['title'] }, role: 'predicate', object: LEDGER, fields: ['hidden_text'] },
];

describe('[#20917] analytics — the field-level read gate at the door', () => {
  describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
    it.each(REFUSED)('$label: refused PERMISSION_DENIED / 403 in the engine\'s words, before any strategy ran', async ({ query, role, object, fields }) => {
      const { service, executed } = makeService({ capabilities, getReadableFields: readable });
      const sentence = role === 'aggregate' ? aggregateSentence(object, fields) : predicateSentence(object, fields);
      for (const run of [() => service.query(query as never, CALLER), () => service.generateSql(query as never, CALLER)]) {
        const refusal = await run().then(() => null, (e: unknown) => e as Record<string, unknown>);
        expect(refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object, fields });
        expect(String(refusal?.message).startsWith(sentence), String(refusal?.message)).toBe(true);
      }
      expect(executed).toEqual([]);
    });

    it('members the caller may read are served, and the reader is asked once per object with the caller\'s context', async () => {
      const getReadableFields = vi.fn(readable);
      const { service, executed } = makeService({ capabilities, getReadableFields });
      await service.query({ cube: 'fr_authored', measures: ['count'], dimensions: ['title', 'alias_owner_region'], where: { title: 't1' } } as never, CALLER);
      expect(executed.length).toBeGreaterThan(0);
      expect(getReadableFields.mock.calls.map((c) => c[0]).sort()).toEqual([LEDGER, OWNER]);
      for (const call of getReadableFields.mock.calls) expect(call[1]).toBe(CALLER);
    });

    it('a query naming no field asks the reader nothing', async () => {
      const getReadableFields = vi.fn(readable);
      const { service } = makeService({ capabilities, getReadableFields });
      await service.query({ cube: LEDGER, measures: ['count'] } as never, CALLER);
      expect(getReadableFields).not.toHaveBeenCalled();
    });

    it('grouping words win over filtering words on the same object, and the base object is judged before a joined one', async () => {
      const { service } = makeService({ capabilities, getReadableFields: readable });
      const both = await service
        .query({ cube: 'fr_authored', measures: ['count'], dimensions: ['alias_owner_code'], where: { alias_code: 'x1' } } as never, CALLER)
        .then(() => null, (e: Error) => e.message);
      expect(both?.startsWith(predicateSentence(LEDGER, ['hidden_text'])), String(both)).toBe(true);
      const grouped = await service
        .query({ cube: LEDGER, measures: ['count'], dimensions: ['hidden_text'], where: { hidden_number: 1 } } as never, CALLER)
        .then(() => null, (e: Error) => e.message);
      expect(grouped).toBe(aggregateSentence(LEDGER, ['hidden_text']));
    });

    it('stands down for an object the reader has no answer for', async () => {
      const unanswered = makeService({ capabilities, getReadableFields: (object) => (object === OWNER ? undefined : READABLE[object]) });
      await unanswered.service.query({ cube: 'fr_authored', measures: ['count'], dimensions: ['alias_owner_code'] } as never, CALLER);
      expect(unanswered.executed.length).toBeGreaterThan(0);
    });

    it('judges only names the object\'s field list carries, and every name when that list is unavailable', async () => {
      const listed = makeService({ capabilities: nativeSqlOnly, getReadableFields: readable });
      await listed.service.query({ cube: 'fr_authored', measures: ['count'], where: { 'owner.not_a_field': 'v' } } as never, CALLER);
      expect(listed.executed).toHaveLength(1);

      const unlisted = makeService({ capabilities, getReadableFields: readable, getObjectFieldNames: null });
      await expect(
        unlisted.service.query({ cube: 'fr_authored', measures: ['count'], where: { 'owner.not_a_field': 'v' } } as never, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: OWNER, fields: ['not_a_field'] });
      expect(unlisted.executed).toEqual([]);
    });

    it('a host read scope is not judged: a policy predicate may name a field the caller cannot read', async () => {
      const { service, executed } = makeService({
        capabilities,
        getReadableFields: readable,
        getReadScope: (object) => (object === LEDGER ? { hidden_text: 'x1' } : undefined),
      });
      await service.query({ cube: LEDGER, measures: ['count'], dimensions: ['title'] } as never, CALLER);
      expect(executed.length).toBeGreaterThan(0);
    });

    it('fails closed: a reader that throws refuses the query, and says so in the error log', async () => {
      const error = vi.fn();
      const logger = { debug() {}, info() {}, warn() {}, error, child() { return logger; } };
      const { service, executed } = makeService({
        capabilities,
        getReadableFields: () => { throw new Error('reader unavailable'); },
        logger,
      });
      await expect(
        service.query({ cube: LEDGER, measures: ['count'], dimensions: ['title'] } as never, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER });
      expect(executed).toEqual([]);
      expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/field-level read admission could not be resolved .*\(fail-closed\)/);
    });

    it('with no reader wired, no field-level gate applies', async () => {
      const { service, executed } = makeService({ capabilities });
      await service.query({ cube: LEDGER, measures: ['count'], dimensions: ['hidden_text'] } as never, CALLER);
      expect(executed.length).toBeGreaterThan(0);
    });
  });

  it('the draft-preview branch asks the same gate before it evaluates drafted rows', async () => {
    const draft = makeService({
      capabilities: nativeSqlOnly,
      getReadableFields: readable,
      draftRowsResolver: async () => [{ id: 'd1', title: 't1', hidden_text: 'x1' }],
    });
    const dataset = DatasetSchema.parse({
      name: 'fr_draft',
      label: 'Draft',
      object: LEDGER,
      dimensions: [{ name: 'code', field: 'hidden_text', type: 'string' }, { name: 'title', field: 'title', type: 'string' }],
      measures: [{ name: 'row_count', aggregate: 'count' }],
    });
    await expect(
      draft.service.queryDataset(dataset, { measures: ['row_count'], dimensions: ['code'] } as never, CALLER, { previewDrafts: true }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER, fields: ['hidden_text'] });
    const served = await draft.service.queryDataset(dataset, { measures: ['row_count'], dimensions: ['title'] } as never, CALLER, { previewDrafts: true });
    expect(served.rows).toEqual([{ title: 't1', row_count: 1 }]);
  });
});

// ── [#20965] A member that names no field ─────────────────────────────────────

/** The cube author's expression text — which no refusal may hand back to the caller. */
const AUTHORED_EXPRESSIONS = [
  (AUTHORED.measures as Record<string, { sql: string }>).expression_total.sql,
  (AUTHORED.dimensions as Record<string, { sql: string }>).expression_flag.sql,
];

/** A member the query names itself, spelled as no column is. */
const NAMED_EXPRESSION = 'hidden_number * 2';

interface ExpressionCase {
  label: string;
  query: Record<string, unknown>;
  member: string;
}

const EXPRESSION_REFUSED: readonly ExpressionCase[] = [
  { label: 'an aggregated expression measure', query: { cube: 'fr_authored', measures: ['expression_total'] }, member: 'expression_total' },
  { label: 'a grouped expression dimension', query: { cube: 'fr_authored', measures: ['count'], dimensions: ['expression_flag'] }, member: 'expression_flag' },
  { label: 'a filtered expression member', query: { cube: 'fr_authored', measures: ['count'], where: { expression_flag: 1 } }, member: 'expression_flag' },
  { label: 'an expression member as an order key', query: { cube: 'fr_authored', measures: ['count'], dimensions: ['title'], order: { expression_flag: 'asc' } }, member: 'expression_flag' },
  { label: 'a declared member with no sql string', query: { cube: 'fr_no_sql', measures: ['count'], dimensions: ['bare'] }, member: 'bare' },
  { label: 'a member the query names itself that is not a column reference', query: { cube: 'fr_authored', measures: ['count'], dimensions: [NAMED_EXPRESSION] }, member: NAMED_EXPRESSION },
];

describe('[#20965] the field-level read gate — a member that names no field is refused, never stood down', () => {
  it('the fixture is written around the parse: CubeSchema refuses exactly the members the gate now refuses', () => {
    for (const [cube, paths] of [
      [AUTHORED, ['dimensions.expression_flag.sql', 'measures.expression_total.sql']],
      [NO_SQL, ['dimensions.bare.sql']],
    ] as const) {
      const parsed = CubeSchema.safeParse(cube);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual(paths);
    }
  });

  describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
    it.each(EXPRESSION_REFUSED)('$label: refused PERMISSION_DENIED / 403 on both doors, before any strategy ran, without the author\'s text', async ({ query, member }) => {
      const { service, executed } = makeService({ capabilities, getReadableFields: readable });
      for (const run of [() => service.query(query as never, CALLER), () => service.generateSql(query as never, CALLER)]) {
        const refusal = await run().then(() => null, (e: unknown) => e as Record<string, unknown>);
        expect(refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER, member });
        for (const text of AUTHORED_EXPRESSIONS) expect(String(refusal?.message)).not.toContain(text);
      }
      expect(executed).toEqual([]);
    });

    it('no grant makes it judgeable: a reader answering every field of the object still refuses it', async () => {
      const { service, executed } = makeService({ capabilities, getReadableFields: (object) => FIELDS[object] });
      await expect(
        service.query({ cube: 'fr_authored', measures: ['expression_total'] } as never, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER, member: 'expression_total' });
      expect(executed).toEqual([]);
    });

    it('it is refused ahead of a hidden field on the same object', async () => {
      const { service } = makeService({ capabilities, getReadableFields: readable });
      await expect(
        service.query({ cube: 'fr_authored', measures: ['expression_total'], dimensions: ['alias_code'] } as never, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER, member: 'expression_total' });
    });

    it('every field member is judged as before: a query naming none of the cube\'s expression members gets the field verdicts', async () => {
      const { service, executed } = makeService({ capabilities, getReadableFields: readable });
      await expect(
        service.query({ cube: 'fr_authored', measures: ['alias_total'] } as never, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER, fields: ['hidden_number'] });
      expect(executed).toEqual([]);
      await service.query({ cube: 'fr_authored', measures: ['count'], dimensions: ['title', 'alias_owner_region'] } as never, CALLER);
      expect(executed.length).toBeGreaterThan(0);
    });

    it('\'*\' still counts (the control): a count names no field and is served, beside a field member and alone', async () => {
      const beside = makeService({ capabilities, getReadableFields: vi.fn(readable) });
      await beside.service.query({ cube: 'fr_authored', measures: ['count'], dimensions: ['title'] } as never, CALLER);
      expect(beside.executed.length).toBeGreaterThan(0);

      const getReadableFields = vi.fn(readable);
      const alone = makeService({ capabilities, getReadableFields });
      await alone.service.query({ cube: 'fr_authored', measures: ['count'] } as never, CALLER);
      expect(alone.executed.length).toBeGreaterThan(0);
      expect(getReadableFields).not.toHaveBeenCalled();
    });
  });
});

// ── The plugin's bridge to the `security` service ─────────────────────────────

function fakeEngine() {
  const reads: string[] = [];
  return {
    reads,
    engine: {
      execute: async (_sql: unknown, options?: { object?: string }) => {
        reads.push(`execute:${options?.object ?? ''}`);
        return { rows: [] };
      },
      aggregate: async (object: string) => {
        reads.push(`aggregate:${object}`);
        return [];
      },
      // [#21080] The engine this double models answers which objects carry a
      // middleware registered for them; none of this file's objects does.
      hasObjectMiddleware: () => false,
      getObject: (name: string) =>
        FIELDS[name] ? { fields: Object.fromEntries(FIELDS[name].map((f) => [f, { type: 'text' }])) } : undefined,
      resolveEffectiveDatasource: () => undefined,
    },
  };
}

async function bootPlugin(security?: () => unknown, cubes?: Cube[]) {
  const { engine, reads } = fakeEngine();
  const registered: Record<string, unknown> = {};
  const error = vi.fn();
  const ctx = {
    getService: (name: string) => {
      if (name === 'security') return security ? security() : undefined;
      if (name === 'data') return engine;
      return registered[name];
    },
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn() {}, error, debug() {} },
  };
  await new AnalyticsServicePlugin({ queryCapabilities: nativeSqlOnly, ...(cubes ? { cubes } : {}) }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, reads, error };
}

/** The object-level and row-level halves of a working security service. */
const objectAndRowsOpen = { getReadFilter: async () => undefined, canReadObject: async () => true };
const groupedHidden = { cube: LEDGER, measures: ['count'], dimensions: ['hidden_text'] };
const groupedReadable = { cube: LEDGER, measures: ['count'], dimensions: ['title'] };

describe('[#20917] analytics plugin — the field-level half of the "security" bridge', () => {
  it('asks the security service\'s getReadableFields with the caller\'s context, refusing a hidden member and serving a readable one', async () => {
    const getReadableFields = vi.fn(async (object: string) => READABLE[object]);
    const { service, reads } = await bootPlugin(() => ({ ...objectAndRowsOpen, getReadableFields }));
    await expect(service.query(groupedHidden as never, CALLER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, fields: ['hidden_text'] });
    expect(reads).toEqual([]);
    expect(getReadableFields).toHaveBeenCalledWith(LEDGER, CALLER);
    await service.query(groupedReadable as never, CALLER);
    expect(reads).toHaveLength(1);
  });

  it('refuses, and says why, when the registered security service exposes no getReadableFields', async () => {
    const { service, reads, error } = await bootPlugin(() => ({ ...objectAndRowsOpen }));
    await expect(service.query(groupedReadable as never, CALLER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(reads).toEqual([]);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/getReadableFields\(\)/);
  });

  it('applies no field-level gate when no security service is registered at all', async () => {
    const { service, reads } = await bootPlugin(undefined);
    await service.query(groupedHidden as never, CALLER);
    expect(reads).toHaveLength(1);
  });

  it('[#20965] refuses a configured cube\'s expression member through the security service\'s reader — `cubes` reach the registry unparsed', async () => {
    const getReadableFields = vi.fn(async (object: string) => READABLE[object]);
    const { service, reads } = await bootPlugin(() => ({ ...objectAndRowsOpen, getReadableFields }), [AUTHORED]);
    await expect(
      service.query({ cube: 'fr_authored', measures: ['expression_total'] } as never, CALLER),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER, member: 'expression_total' });
    expect(reads).toEqual([]);
    expect(getReadableFields).toHaveBeenCalledWith(LEDGER, CALLER);
    await service.query({ cube: 'fr_authored', measures: ['count'], dimensions: ['title'] } as never, CALLER);
    expect(reads).toHaveLength(1);
  });
});
