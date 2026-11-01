// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28690, #28691, #28692] Three answers the faces of `queryDataset` gave
 * differently, on the native strategy, the ObjectQL strategy and the draft
 * preview, on real SQLite (the #28201 / #28258 / #28555 harness).
 *
 * ## What these pins hold
 *
 * - #28690. A `timeDimensions` entry with a granularity is grouped by its
 *   bucket whether or not the member is also in `dimensions`, on every face,
 *   with the bucket in `fields`. Before, the preview grouped by `dimensions`
 *   alone: one total where the live faces answered one group per month, and
 *   regions without months.
 * - #28691. A `runtimeFilter` member spelled other than its column
 *   (`OBJECT.region`, `CUBE.region`, a dataset dimension `zone` over
 *   `region`, `OBJECT.closed_at`) is read from that column by the preview, as
 *   both live strategies read it. Before, the preview matched no drafted row
 *   (`[]`, or under an `$or` only the other arm's rows).
 * - #28692. The ObjectQL strategy answers a backed `account.id` dimension, and
 *   two dimensions through one relationship, with the native strategy's
 *   groups. Before, it handed the engine a groupBy naming one column twice and
 *   answered `INVALID_QUERY`.
 * - #28744. The ObjectQL strategy answers two dataset dimensions over one
 *   column (`region`, and `zone` declared over `region`) with one group per
 *   value, keyed by both names, as native and the preview do, on its direct
 *   path and beside a cross-object dimension. Before, it answered
 *   `INVALID_QUERY` for the same duplicate groupBy column.
 * - #28765. A selection that asks one column raw beside its own bucket (or for
 *   two buckets of it) under one name is refused by the draft preview with the
 *   live faces' refusal: `INVALID_QUERY` / 400, the same message, path, param,
 *   object and fields. Before, the preview served both columns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28690_deal';
const ACCOUNT = 'os28690_account';

const ACCOUNTS = [
  { id: 'a1', name: 'Acme' },
  { id: 'a2', name: 'Globex' },
] as const;
const ROWS = [
  { id: 'd1', region: 'amer', amount: 100, account: 'a1', closed_at: '2026-03-01T00:00:00.000Z' },
  { id: 'd2', region: 'amer', amount: 50, account: 'a2', closed_at: '2026-04-01T00:00:00.000Z' },
  { id: 'd3', region: 'emea', amount: 30, account: 'a1', closed_at: '2026-04-02T00:00:00.000Z' },
] as const;

const shape = {
  label: 'Deals',
  object: OBJECT,
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'closed_at', field: 'closed_at', type: 'date' },
    { name: 'zone', field: 'region', type: 'string' },
  ],
  measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
};
/** Declares no relationship. */
const UNBACKED = DatasetSchema.parse({ name: 'os28690_deals', ...shape });
/** Declares `account`. */
const BACKED = DatasetSchema.parse({ name: 'os28690_deals_by_account', include: ['account'], ...shape });

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];
const LIVE: readonly Face[] = ['native', 'objectql'];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Selection = {
  dimensions?: string[];
  measures: string[];
  runtimeFilter?: Record<string, unknown>;
  timeDimensions?: Array<Record<string, unknown>>;
};
type Answer = { rows: Array<Record<string, unknown>>; fields: string[] };

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28690_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[#28690–#28692] time-dimension buckets, column-spelled filter members and FK-id groups on every face', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, dataset: typeof UNBACKED, selection: Selection) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      dataset,
      { ...selection } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    );

  /** One face's rows (measures as numbers, sorted) and its `fields` as `name:type`. */
  const answerOf = async (face: Face, dataset: typeof UNBACKED, selection: Selection): Promise<Answer> => {
    const result = await ask(face, dataset, selection);
    const rows = (result.rows as Array<Record<string, unknown>>)
      .map((r) => ({ ...r, total: Number(r.total) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { rows, fields: (result.fields ?? []).map((f: { name: string; type: string }) => `${f.name}:${f.type}`) };
  };

  /** Every face in `faces` answers `expected`, rows and fields alike. */
  const answeredAlike = async (faces: readonly Face[], dataset: typeof UNBACKED, selection: Selection, expected: Answer) => {
    for (const face of faces) {
      expect(await answerOf(face, dataset, selection), face).toEqual(expected);
    }
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: ACCOUNT,
      label: 'Account',
      fields: { name: { name: 'name', type: 'text' } },
    } as never);
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        closed_at: { name: 'closed_at', type: 'datetime' },
        account: { name: 'account', type: 'lookup', reference: ACCOUNT },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    for (const row of ACCOUNTS) await engine.insert(ACCOUNT, { ...row } as never);
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

  describe('#28690 — a bucketed time dimension is grouped whether or not it is also a dimension', () => {
    it('groups by month with no dimensions, where the preview answered one total', async () => {
      await answeredAlike(FACES, UNBACKED, { measures: ['total'], timeDimensions: [{ dimension: 'closed_at', granularity: 'month' }] }, {
        rows: [{ closed_at: '2026-03', total: 100 }, { closed_at: '2026-04', total: 80 }],
        fields: ['closed_at:time', 'total:number'],
      });
    });

    it('groups by region and month, where the preview grouped by region alone', async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { dimensions: ['region'], measures: ['total'], timeDimensions: [{ dimension: 'closed_at', granularity: 'month' }] },
        {
          rows: [
            { region: 'amer', closed_at: '2026-03', total: 100 },
            { region: 'amer', closed_at: '2026-04', total: 50 },
            { region: 'emea', closed_at: '2026-04', total: 30 },
          ],
          fields: ['region:string', 'closed_at:time', 'total:number'],
        },
      );
    });

    it('keys an OBJECT-qualified time dimension by its spelling, as the live faces do', async () => {
      const member = `${OBJECT}.closed_at`;
      await answeredAlike(FACES, UNBACKED, { measures: ['total'], timeDimensions: [{ dimension: member, granularity: 'month' }] }, {
        rows: [{ [member]: '2026-03', total: 100 }, { [member]: '2026-04', total: 80 }],
        fields: [`${member}:time`, 'total:number'],
      });
    });

    it('buckets a windowed year, where the preview answered the total with no key', async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { measures: ['total'], timeDimensions: [{ dimension: 'closed_at', granularity: 'year', dateRange: ['2026-04-01', '2026-04-30'] }] },
        { rows: [{ closed_at: '2026', total: 80 }], fields: ['closed_at:time', 'total:number'] },
      );
    });

    it('still projects nothing for a time dimension with no granularity (a window only)', async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { measures: ['total'], timeDimensions: [{ dimension: 'closed_at', dateRange: ['2026-04-01', '2026-04-30'] }] },
        { rows: [{ total: 80 }], fields: ['total:number'] },
      );
    });
  });

  describe('#28691 — a filter member spelled other than its column is read from that column', () => {
    const emeaOnly: Answer = { rows: [{ region: 'emea', total: 30 }], fields: ['region:string', 'total:number'] };
    const amerAprilAndEmea: Answer = {
      rows: [{ region: 'amer', total: 50 }, { region: 'emea', total: 30 }],
      fields: ['region:string', 'total:number'],
    };

    it.each([
      ['OBJECT.region', `${OBJECT}.region`],
      ['CUBE.region', `${UNBACKED.name}.region`],
      ['the dimension zone over region', 'zone'],
    ])('matches %s, where the preview answered []', async (_label, member) => {
      await answeredAlike(FACES, UNBACKED, { dimensions: ['region'], measures: ['total'], runtimeFilter: { [member]: 'emea' } }, emeaOnly);
    });

    it("matches OBJECT.region's arm under an $or, where the preview answered only the other arm's rows", async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { dimensions: ['region'], measures: ['total'], runtimeFilter: { $or: [{ [`${OBJECT}.region`]: { $in: ['emea'] } }, { amount: 50 }] } },
        amerAprilAndEmea,
      );
    });

    it('reads an OBJECT-qualified datetime member as the datetime column, where the preview answered []', async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { dimensions: ['region'], measures: ['total'], runtimeFilter: { [`${OBJECT}.closed_at`]: { $gte: '2026-04-01' } } },
        amerAprilAndEmea,
      );
    });

    it("compares an OBJECT-qualified datetime member's instants, as the column's declaration reads them", async () => {
      // 2026-04-02T01:00+02:00 is 2026-04-01T23:00Z, so d3 (2026-04-02T00:00Z)
      // is after it. Compared as text, as an undeclared column would be, it is not.
      await answeredAlike(
        FACES,
        UNBACKED,
        { dimensions: ['region'], measures: ['total'], runtimeFilter: { [`${OBJECT}.closed_at`]: { $gte: '2026-04-02T01:00:00+02:00' } } },
        { rows: [{ region: 'emea', total: 30 }], fields: ['region:string', 'total:number'] },
      );
    });

    it('reads a filter on a measure key from the measure\'s column, as the live faces resolve it', async () => {
      // `total` is a measure over `amount`; the strategies' filter-member
      // lookup falls through to the measures, so the row filter is `amount > 60`.
      await answeredAlike(FACES, UNBACKED, { dimensions: ['region'], measures: ['total'], runtimeFilter: { total: { $gt: 60 } } }, {
        rows: [{ region: 'amer', total: 100 }],
        fields: ['region:string', 'total:number'],
      });
    });

    it('filters on zone beside a time-dimension-only bucket', async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { measures: ['total'], timeDimensions: [{ dimension: 'closed_at', granularity: 'month' }], runtimeFilter: { zone: 'amer' } },
        { rows: [{ closed_at: '2026-03', total: 100 }, { closed_at: '2026-04', total: 50 }], fields: ['closed_at:time', 'total:number'] },
      );
    });
  });

  describe('#28692 — the ObjectQL strategy groups a backed FK path once', () => {
    it("serves a backed 'account.id' with the native strategy's groups, where it answered INVALID_QUERY", async () => {
      await answeredAlike(LIVE, BACKED, { dimensions: ['account.id'], measures: ['total'] }, {
        rows: [{ 'account.id': 'a1', total: 130 }, { 'account.id': 'a2', total: 50 }],
        fields: ['account.id:string', 'total:number'],
      });
    });

    it("serves 'account.id' beside 'account.name', where it answered INVALID_QUERY", async () => {
      await answeredAlike(LIVE, BACKED, { dimensions: ['account.id', 'account.name'], measures: ['total'] }, {
        rows: [
          { 'account.id': 'a1', 'account.name': 'Acme', total: 130 },
          { 'account.id': 'a2', 'account.name': 'Globex', total: 50 },
        ],
        fields: ['account.id:string', 'account.name:string', 'total:number'],
      });
    });

    it.each([
      ['after', ['account.name', 'account']],
      ['before', ['account', 'account.name']],
    ])("serves the FK column 'account' %s 'account.name'", async (_label, dimensions) => {
      await answeredAlike(LIVE, BACKED, { dimensions, measures: ['total'] }, {
        rows: [
          { account: 'a1', 'account.name': 'Acme', total: 130 },
          { account: 'a2', 'account.name': 'Globex', total: 50 },
        ],
        fields: [...dimensions.map((d) => `${d}:string`), 'total:number'],
      });
    });

    it('leaves the draft preview refusing a backed relationship path (#28555)', async () => {
      await expect(ask('preview', BACKED, { dimensions: ['account.id'], measures: ['total'] })).rejects.toMatchObject({
        code: 'INVALID_FIELD',
        status: 400,
        member: 'account.id',
      });
    });
  });
  describe('#28744 — the ObjectQL strategy groups a column once when two dimensions read it', () => {
    it.each([
      ['region, zone', ['region', 'zone']],
      ['zone, region', ['zone', 'region']],
    ])('serves dimensions %s over one column with one group per value, where it answered INVALID_QUERY', async (_label, dimensions) => {
      await answeredAlike(FACES, UNBACKED, { dimensions, measures: ['total'] }, {
        rows: [
          { region: 'amer', zone: 'amer', total: 150 },
          { region: 'emea', zone: 'emea', total: 30 },
        ],
        fields: [...dimensions.map((d) => `${d}:string`), 'total:number'],
      });
    });

    it('serves them beside a month bucket', async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { dimensions: ['region', 'zone'], measures: ['total'], timeDimensions: [{ dimension: 'closed_at', granularity: 'month' }] },
        {
          rows: [
            { region: 'amer', zone: 'amer', closed_at: '2026-03', total: 100 },
            { region: 'amer', zone: 'amer', closed_at: '2026-04', total: 50 },
            { region: 'emea', zone: 'emea', closed_at: '2026-04', total: 30 },
          ],
          fields: ['region:string', 'zone:string', 'closed_at:time', 'total:number'],
        },
      );
    });

    it("still hands the engine a column raw beside its bucket, which it refuses (two values under one name)", async () => {
      // `closed_at` raw and `OBJECT.closed_at` bucketed by month are different
      // keys over one column: nothing is merged, and the engine's
      // duplicate-column refusal stands on both live faces.
      for (const face of LIVE) {
        await expect(
          ask(face, UNBACKED, {
            dimensions: ['closed_at'],
            measures: ['total'],
            timeDimensions: [{ dimension: `${OBJECT}.closed_at`, granularity: 'month' }],
          }),
          face,
        ).rejects.toMatchObject({ code: 'INVALID_QUERY', status: 400 });
      }
    });

    it("serves them beside a cross-object 'account.name' dimension", async () => {
      await answeredAlike(LIVE, BACKED, { dimensions: ['region', 'zone', 'account.name'], measures: ['total'] }, {
        rows: [
          { region: 'amer', zone: 'amer', 'account.name': 'Acme', total: 100 },
          { region: 'amer', zone: 'amer', 'account.name': 'Globex', total: 50 },
          { region: 'emea', zone: 'emea', 'account.name': 'Acme', total: 30 },
        ],
        fields: ['region:string', 'zone:string', 'account.name:string', 'total:number'],
      });
    });
  });
  describe('#28765 — the draft preview refuses one column asked twice under one name, as the live faces do', () => {
    /** Every face refuses `selection`, and the preview's refusal is the ObjectQL face's, field for field. */
    const refusedAsLive = async (selection: Selection, path: string) => {
      const refusals: Array<Record<string, unknown>> = [];
      for (const face of FACES) {
        const err = (await ask(face, UNBACKED, selection).then(
          () => { throw new Error(`${face}: expected a refusal, but the query resolved`); },
          (e: unknown) => e,
        )) as Error & Record<string, unknown>;
        expect(err.code, `${face}: ${err.message}`).toBe('INVALID_QUERY');
        expect(err.status, face).toBe(400);
        expect(err.path, face).toBe(path);
        refusals.push({
          message: err.message, code: err.code, status: err.status, httpStatus: err.httpStatus,
          object: err.object, param: err.param, path: err.path, fields: err.fields,
        });
      }
      expect(refusals[2], 'preview vs ObjectQL').toEqual(refusals[1]);
      expect(refusals[2], 'preview vs native').toEqual(refusals[0]);
    };

    it('refuses a column raw beside its own month bucket, where the preview served both', async () => {
      await refusedAsLive(
        { dimensions: ['closed_at'], measures: ['total'], timeDimensions: [{ dimension: `${OBJECT}.closed_at`, granularity: 'month' }] },
        'groupBy.1.field',
      );
    });

    it('refuses it after another dimension, naming the later position', async () => {
      await refusedAsLive(
        { dimensions: ['region', 'closed_at'], measures: ['total'], timeDimensions: [{ dimension: `${OBJECT}.closed_at`, granularity: 'month' }] },
        'groupBy.2.field',
      );
    });

    it('refuses two buckets of one column', async () => {
      await refusedAsLive(
        {
          measures: ['total'],
          timeDimensions: [
            { dimension: 'closed_at', granularity: 'month' },
            { dimension: `${OBJECT}.closed_at`, granularity: 'year' },
          ],
        },
        'groupBy.1.field',
      );
    });

    it('still serves a dimension that is also its own time dimension, as one bucket', async () => {
      await answeredAlike(
        FACES,
        UNBACKED,
        { dimensions: ['closed_at'], measures: ['total'], timeDimensions: [{ dimension: 'closed_at', granularity: 'month' }] },
        { rows: [{ closed_at: '2026-03', total: 100 }, { closed_at: '2026-04', total: 80 }], fields: ['closed_at:time', 'total:number'] },
      );
    });
  });
});
