// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21177] The CALLER-CONTENT admission AT THE DOOR.
 *
 * A caller supplies content at query time on two doors: the inline `dataset`
 * POSTed to `/analytics/dataset/query` (every dimension/measure `field` and the
 * dataset's own filter are the caller's text) and the member spellings POSTed to
 * `/analytics/query` (a member the authored cube does not declare is compiled
 * from the caller's own spelling). A member whose text is not a plain column
 * reference the admission can judge is refused `INVALID_FIELD` / 400 — the
 * invalid-member envelope — BEFORE any strategy runs, for EVERY caller (admin and
 * non-admin alike) and whether or not a security provider is wired: it is an
 * invalid request, not a permission verdict. These are the door-level pins; the
 * module's unit tests are in `caller-content-admission.test.ts`.
 *
 * The sibling #20965 pins stay: a member of an AUTHORED (registry) cube whose own
 * `sql` is an expression is NOT caller content, and is refused by the field gate
 * (`PERMISSION_DENIED` / 403), not here.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

const BASE = 'cc_base';
const OTHER = 'cc_other';

/** Each object's declared fields, as the registry answers them. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  [BASE]: ['id', 'title', 'status', 'amount'],
  [OTHER]: ['id', 'secret'],
};
/** What a non-admin caller may read of the base object. */
const READABLE: Readonly<Record<string, readonly string[]>> = { [BASE]: ['id', 'title', 'status', 'amount'] };

const MEMBER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;
const ADMIN = { userId: 'u_admin', tenantId: 'org_a' } as ExecutionContext;

/** An authored cube with a declared expression member — #20965's territory, must stay 403. */
const AUTHORED: Cube = {
  name: 'cc_authored',
  title: 'Authored',
  sql: BASE,
  public: true,
  measures: { count: { type: 'count', sql: '*', label: 'Count' } },
  dimensions: {
    status: { type: 'string', sql: 'status', label: 'Status' },
    flag: { type: 'number', sql: "CASE WHEN status = 'x' THEN 1 ELSE 0 END", label: 'Flag' },
  },
} as Cube;

const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });
const STRATEGY_PATHS = [
  { label: 'NativeSQLStrategy', capabilities: nativeSqlOnly },
  { label: 'ObjectQLStrategy', capabilities: objectqlOnly },
] as const;

type ReadableFields = (object: string, context?: ExecutionContext) => readonly string[] | undefined;

function makeService(opts: { capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean }; getReadableFields?: ReadableFields }) {
  const executed: string[] = [];
  const service = new AnalyticsService({
    cubes: [AUTHORED],
    queryCapabilities: opts.capabilities,
    getReadableFields: opts.getReadableFields,
    getObjectFieldNames: (object: string) => FIELDS[object],
    executeRawSql: async (object: string, sql: string) => { executed.push(`sql:${object}:${sql}`); return []; },
    executeAggregate: async (object: string) => { executed.push(`aggregate:${object}`); return []; },
  } as never);
  return { service, executed };
}

/** The three provider postures a caller-content refusal must hold across. */
const PROVIDERS: ReadonlyArray<{ label: string; provider?: ReadableFields; ctx: ExecutionContext }> = [
  { label: 'no security provider wired', provider: undefined, ctx: ADMIN },
  { label: 'admin — provider answers undefined (unrestricted)', provider: () => undefined, ctx: ADMIN },
  { label: 'non-admin — provider answers a field list', provider: (object) => READABLE[object], ctx: MEMBER },
];

const EXPRESSION = `(SELECT secret FROM ${OTHER})`;

function datasetWith(overrides: Record<string, unknown>) {
  return DatasetSchema.parse({
    name: 'cc_ds', label: 'DS', object: BASE,
    dimensions: [{ name: 'status', field: 'status', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
    ...overrides,
  });
}

describe('[#21177] caller-content admission — the inline dataset door', () => {
  describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
    describe.each(PROVIDERS)('$label', ({ provider, ctx }) => {
      it('refuses a dimension field expression — INVALID_FIELD / 400, strategy never called', async () => {
        const { service, executed } = makeService({ capabilities, getReadableFields: provider });
        const dataset = datasetWith({ dimensions: [{ name: 'leaked', field: EXPRESSION, type: 'string' }] });
        const err = await service.queryDataset(dataset as never, { dimensions: ['leaked'], measures: ['total'] } as never, ctx)
          .then(() => null, (e) => e as Record<string, unknown>);
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'leaked', param: 'dimensions' });
        expect(String(err?.message)).not.toContain('SELECT');
        expect(executed).toEqual([]);
      });

      it('refuses a measure field expression', async () => {
        const { service, executed } = makeService({ capabilities, getReadableFields: provider });
        const dataset = datasetWith({ measures: [{ name: 'leaked', aggregate: 'sum', field: `amount + ${EXPRESSION}` }] });
        const err = await service.queryDataset(dataset as never, { dimensions: ['status'], measures: ['leaked'] } as never, ctx)
          .then(() => null, (e) => e as Record<string, unknown>);
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'leaked', param: 'measures' });
        expect(executed).toEqual([]);
      });

      it('refuses an expression hidden in the dataset filter', async () => {
        const { service, executed } = makeService({ capabilities, getReadableFields: provider });
        const dataset = datasetWith({ filter: { [EXPRESSION]: 'x' } });
        const err = await service.queryDataset(dataset as never, { dimensions: ['status'], measures: ['total'] } as never, ctx)
          .then(() => null, (e) => e as Record<string, unknown>);
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400 });
        expect(executed).toEqual([]);
      });
    });

    it('still answers a legitimate inline dataset on declared fields', async () => {
      const { service, executed } = makeService({ capabilities, getReadableFields: (o) => READABLE[o] });
      await service.queryDataset(datasetWith({}) as never, { dimensions: ['status'], measures: ['total'] } as never, MEMBER);
      expect(executed.length).toBeGreaterThan(0);
    });
  });
});

describe('[#21177] caller-content admission — the /analytics/query door', () => {
  describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
    describe.each(PROVIDERS)('$label', ({ provider, ctx }) => {
      it('refuses an undeclared member spelled as an expression — on both query() and generateSql(), strategy never called', async () => {
        const { service, executed } = makeService({ capabilities, getReadableFields: provider });
        const query = { cube: 'cc_authored', measures: ['count'], dimensions: [EXPRESSION] };
        for (const run of [() => service.query(query as never, ctx), () => service.generateSql(query as never, ctx)]) {
          const err = await run().then(() => null, (e) => e as Record<string, unknown>);
          expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: EXPRESSION, param: 'dimensions' });
        }
        expect(executed).toEqual([]);
      });
    });

    it('still answers declared members and plain field spellings', async () => {
      const { service, executed } = makeService({ capabilities, getReadableFields: (o) => READABLE[o] });
      await service.query({ cube: 'cc_authored', measures: ['count'], dimensions: ['status'] } as never, MEMBER);
      expect(executed.length).toBeGreaterThan(0);
    });

    it('a DECLARED expression member stays the field gate\'s 403, not this gate\'s 400 (#20965 preserved)', async () => {
      const { service, executed } = makeService({ capabilities, getReadableFields: (o) => READABLE[o] });
      const err = await service.query({ cube: 'cc_authored', measures: ['count'], dimensions: ['flag'] } as never, MEMBER)
        .then(() => null, (e) => e as Record<string, unknown>);
      expect(err).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, member: 'flag' });
      expect(executed).toEqual([]);
    });
  });
});
