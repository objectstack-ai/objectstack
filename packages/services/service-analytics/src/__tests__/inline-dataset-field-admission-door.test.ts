// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21177] A dataset's own `field` text, judged at the analytics dataset door.
 *
 * A caller POSTs an inline dataset to `/analytics/dataset/query`. Its
 * dimension/measure `field` text is caller content at query time, and the service
 * compiles that dataset into a cube whose members read as DECLARED — so a
 * dimension/measure whose `field` is a raw expression resolves to a declared cube
 * member whose `sql` is that expression. #21156's caller-member gate leaves a
 * DECLARED expression member to the field-level gate (#20965), which stands down
 * with no security service and on an object its reader answers `undefined` for;
 * in those tiers the expression reached `NativeSQLStrategy`'s statement as
 * written. This pins the residual: the dataset's own `field` text is judged at
 * the door, on the one judge — `PERMISSION_DENIED` / 403, the SAME refusal #21156
 * reaches, no new error code — for EVERY caller (admin included) and whether or
 * not a security provider is wired, before any strategy runs.
 *
 * The door judges every dataset `queryDataset` is handed — the route's SAVED
 * branch (`body.datasetName`) included, since it calls the same method; that
 * branch is pinned end to end in `packages/rest`'s
 * `analytics-16019-driver-declared-fault.test.ts`.
 *
 * The controls stay served: a plain-column inline dataset, and a dataset
 * registered through the configuration door and queried by cube name (it runs
 * through `query()`, where #21156 leaves its members to the existing gates). The
 * `/analytics/query` door's own caller members are #21156's and are pinned in
 * `caller-member-column-reference-gate.test.ts` / `field-read-admission-gate.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

const BASE = 'id_base';
const OTHER = 'id_other';

/** Each object's declared fields, as the registry answers them. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  [BASE]: ['id', 'title', 'status', 'amount'],
  [OTHER]: ['id', 'secret'],
};
/** What a non-admin caller may read of the base object. */
const READABLE: Readonly<Record<string, readonly string[]>> = { [BASE]: ['id', 'title', 'status', 'amount'] };

const MEMBER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;
const ADMIN = { userId: 'u_admin', tenantId: 'org_a' } as ExecutionContext;

const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });
const STRATEGY_PATHS = [
  { label: 'NativeSQLStrategy', capabilities: nativeSqlOnly },
  { label: 'ObjectQLStrategy', capabilities: objectqlOnly },
] as const;

type ReadableFields = (object: string, context?: ExecutionContext) => readonly string[] | undefined;

function makeService(opts: {
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };
  getReadableFields?: ReadableFields;
  datasets?: unknown[];
}) {
  const executed: string[] = [];
  const service = new AnalyticsService({
    datasets: opts.datasets,
    queryCapabilities: opts.capabilities,
    getReadableFields: opts.getReadableFields,
    getObjectFieldNames: (object: string) => FIELDS[object],
    executeRawSql: async (object: string, sql: string) => { executed.push(`sql:${object}:${sql}`); return []; },
    executeAggregate: async (object: string) => { executed.push(`aggregate:${object}`); return []; },
  } as never);
  return { service, executed };
}

/**
 * The four provider postures the residual refusal must hold across. #20965's
 * field gate already refuses the `non-admin — a field list` posture; the three
 * others (no provider, admin-unrestricted, reader answers `undefined` for the
 * object) are the tiers where it stands down and the expression reached the
 * strategy before this gate.
 */
const PROVIDERS: ReadonlyArray<{ label: string; provider?: ReadableFields; ctx: ExecutionContext }> = [
  { label: 'no security provider wired', provider: undefined, ctx: ADMIN },
  { label: 'admin — provider answers undefined (unrestricted)', provider: () => undefined, ctx: ADMIN },
  { label: 'non-admin — provider answers a field list', provider: (object) => READABLE[object], ctx: MEMBER },
  { label: 'reader answers undefined for the base object', provider: (object) => (object === BASE ? undefined : []), ctx: MEMBER },
];

/** An expression that reads another object's column — not attributable to any field. */
const EXPRESSION = `(SELECT secret FROM ${OTHER})`;

function datasetWith(overrides: Record<string, unknown>) {
  return DatasetSchema.parse({
    name: 'id_ds', label: 'DS', object: BASE,
    dimensions: [{ name: 'status', field: 'status', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
    ...overrides,
  });
}

describe('[#21177] inline-dataset `field` admission — the dataset door', () => {
  describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
    describe.each(PROVIDERS)('$label', ({ provider, ctx }) => {
      it('refuses a dimension-field expression — PERMISSION_DENIED / 403, strategy never called', async () => {
        const { service, executed } = makeService({ capabilities, getReadableFields: provider });
        const dataset = datasetWith({ dimensions: [{ name: 'leaked', field: EXPRESSION, type: 'string' }] });
        const err = await service.queryDataset(dataset as never, { dimensions: ['leaked'], measures: ['total'] } as never, ctx)
          .then(() => null, (e) => e as Record<string, unknown>);
        expect(err).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, member: 'leaked' });
        // ⛔ The refusal names the member the caller can find, never the expression text.
        expect(String(err?.message)).not.toContain('SELECT');
        expect(String(err?.message)).not.toContain(OTHER);
        expect(executed).toEqual([]);
      });

      it('refuses a measure-field expression', async () => {
        const { service, executed } = makeService({ capabilities, getReadableFields: provider });
        const dataset = datasetWith({ measures: [{ name: 'leaked', aggregate: 'sum', field: `amount + ${EXPRESSION}` }] });
        const err = await service.queryDataset(dataset as never, { dimensions: ['status'], measures: ['leaked'] } as never, ctx)
          .then(() => null, (e) => e as Record<string, unknown>);
        expect(err).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, member: 'leaked' });
        expect(String(err?.message)).not.toContain('SELECT');
        expect(executed).toEqual([]);
      });
    });

    it('still answers a legitimate inline dataset on declared fields', async () => {
      const { service, executed } = makeService({ capabilities, getReadableFields: (o) => READABLE[o] });
      await service.queryDataset(datasetWith({}) as never, { dimensions: ['status'], measures: ['total'] } as never, MEMBER);
      expect(executed.length).toBeGreaterThan(0);
    });

    it('still answers a dataset registered through the configuration door and queried by cube name', async () => {
      const registered = datasetWith({ name: 'id_registered' });
      const { service, executed } = makeService({ capabilities, getReadableFields: (o) => READABLE[o], datasets: [registered] });
      await service.query({ cube: 'id_registered', measures: ['total'], dimensions: ['status'] } as never, MEMBER);
      expect(executed.length).toBeGreaterThan(0);
    });
  });
});
