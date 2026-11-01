// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28555, #28556, #28557, #28558] Members read through a relationship path,
 * through `queryDataset` on the native strategy, the ObjectQL strategy and the
 * draft preview, on real SQLite (the #28201 / #28258 harness).
 *
 * ## What these pins hold
 *
 * - #28555. A BACKED dotted member (`account.name` with `include: ['account']`,
 *   a declared dimension over `account.name`, a `runtimeFilter` member, a
 *   windowed time dimension, a declared measure over a related field) is
 *   refused by the draft preview `INVALID_FIELD` / 400 naming the member:
 *   the preview reads the base object's drafted seed rows and joins nothing.
 *   Before, it served one `null` group with the whole total, `[]`, or a total
 *   of `0`. The live strategies still serve it. A dotted spelling that
 *   resolves to a declared dimension (`OBJECT.region`, `CUBE.region`) is
 *   answered by the preview with the live faces' groups.
 * - #28558. A declared path to a column the related object lacks
 *   (`account.bogus`) is refused before SQL on every face, `INVALID_FIELD` /
 *   400 naming the member, the column and the object, with one message.
 *   Before, the native strategy answered `DATABASE_ERROR` / 500.
 * - #28556. A `timeDimensions` entry through an undeclared path is refused on
 *   every face with one message. Before, the preview dropped the axis, and the
 *   native strategy answered a windowed one `DATASET_INVALID`.
 * - #28557. A `runtimeFilter` member through an undeclared path is refused on
 *   every face with one message, also under an `$or`. Before: `DATASET_INVALID`
 *   (native), the cross-object filter refusal (ObjectQL), `[]` or the other
 *   arm's rows (preview).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28555_deal';
const ACCOUNT = 'os28555_account';

const ACCOUNTS = [
  { id: 'a1', name: 'Acme', score: 7, founded_at: '2026-01-15T00:00:00.000Z' },
  { id: 'a2', name: 'Globex', score: 3, founded_at: '2026-02-15T00:00:00.000Z' },
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
  ],
  measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
};
/** Declares no relationship at all. */
const UNBACKED = DatasetSchema.parse({ name: 'os28555_deals', ...shape });
/** Declares `account`. */
const BACKED = DatasetSchema.parse({ name: 'os28555_deals_by_account', include: ['account'], ...shape });
/** Declares `account`, a dimension over `account.name` and a measure over `account.score`. */
const DECLARED = DatasetSchema.parse({
  name: 'os28555_deals_declared',
  include: ['account'],
  ...shape,
  dimensions: [...shape.dimensions, { name: 'account_name', field: 'account.name', type: 'string' }],
  measures: [...shape.measures, { name: 'score_max', aggregate: 'max', field: 'account.score' }],
});

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];
const LIVE = ['native', 'objectql'] as const;

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & {
  code?: string; status?: number; param?: string; field?: string; object?: string; member?: string; cube?: string;
};
type Selection = {
  dimensions?: string[];
  measures: string[];
  runtimeFilter?: Record<string, unknown>;
  timeDimensions?: Array<Record<string, unknown>>;
};

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28555_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

const PREVIEW_JOINS_NOTHING = "The draft preview evaluates the drafted seed rows of 'os28555_deal' alone and joins no related object";

describe('[#28555–#28558] members read through a relationship path, on the native, ObjectQL and preview faces', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, dataset: typeof UNBACKED, selection: Selection) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      dataset,
      { ...selection } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    );

  const rowsOf = async (face: Face, dataset: typeof UNBACKED, selection: Selection, key: string) =>
    ((await ask(face, dataset, selection)).rows as Array<Record<string, unknown>>)
      .map((r) => ({ key: r[key], total: Number(r.total) }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  /** The same refusal on every face: code, status, param and member, and one message. */
  const refusedAlike = async (dataset: typeof UNBACKED, selection: Selection, param: string, member: string) => {
    const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, dataset, selection))));
    for (const [i, err] of refusals.entries()) {
      expect(err.code, `${FACES[i]}: ${err.message}`).toBe('INVALID_FIELD');
      expect(err.status, FACES[i]).toBe(400);
      expect(err.param, FACES[i]).toBe(param);
      expect(err.member, FACES[i]).toBe(member);
      expect(err.cube, FACES[i]).toBe(dataset.name);
    }
    expect(refusals[1].message).toBe(refusals[0].message);
    expect(refusals[2].message).toBe(refusals[0].message);
    return refusals[0];
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: ACCOUNT,
      label: 'Account',
      fields: {
        name: { name: 'name', type: 'text' },
        score: { name: 'score', type: 'number' },
        founded_at: { name: 'founded_at', type: 'datetime' },
      },
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

  describe('#28555 — the draft preview joins nothing', () => {
    it("refuses a backed 'account.name' that both live strategies serve, where it served one null group", async () => {
      for (const face of LIVE) {
        expect(await rowsOf(face, BACKED, { dimensions: ['account.name'], measures: ['total'] }, 'account.name'), face)
          .toEqual([{ key: 'Acme', total: 130 }, { key: 'Globex', total: 50 }]);
      }
      const err = await refusalOf(ask('preview', BACKED, { dimensions: ['account.name'], measures: ['total'] }));
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.param).toBe('dimensions');
      expect(err.member).toBe('account.name');
      expect(err.cube).toBe(BACKED.name);
      expect(err.message).toContain(
        `Dimension 'account.name' on cube '${BACKED.name}' reads 'account.name' through relationship path 'account'. ${PREVIEW_JOINS_NOTHING}`,
      );
    });

    for (const [label, dataset, selection, param, member] of [
      ["a declared dimension over 'account.name'", DECLARED, { dimensions: ['account_name'], measures: ['total'] }, 'dimensions', 'account_name'],
      ["a declared measure over 'account.score'", DECLARED, { dimensions: ['region'], measures: ['score_max'] }, 'measures', 'score_max'],
      ["a backed 'runtimeFilter' member", BACKED, { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'account.name': 'Acme' } }, 'where', 'account.name'],
      ['a backed windowed time dimension', BACKED, { measures: ['total'], timeDimensions: [{ dimension: 'account.founded_at', dateRange: ['2026-01-01', '2026-01-31'] }] }, 'timeDimensions', 'account.founded_at'],
    ] as const) {
      it(`refuses ${label} with the same refusal`, async () => {
        const err = await refusalOf(ask('preview', dataset, selection as Selection));
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
        expect(err.member).toBe(member);
        expect(err.message).toContain(PREVIEW_JOINS_NOTHING);
      });
    }

    it('CONTROL: the native strategy serves the backed runtimeFilter member and the windowed time dimension', async () => {
      expect(await rowsOf('native', BACKED, { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'account.name': 'Acme' } }, 'region'))
        .toEqual([{ key: 'amer', total: 100 }, { key: 'emea', total: 30 }]);
      expect(await rowsOf('native', BACKED, { measures: ['total'], timeDimensions: [{ dimension: 'account.founded_at', dateRange: ['2026-01-01', '2026-01-31'] }] }, 'none'))
        .toEqual([{ key: undefined, total: 130 }]);
    });

    for (const member of [`${OBJECT}.region`, `${UNBACKED.name}.region`]) {
      it(`answers '${member}', which resolves to the declared 'region', with the live faces' groups`, async () => {
        for (const face of FACES) {
          expect(await rowsOf(face, UNBACKED, { dimensions: [member], measures: ['total'] }, member), face)
            .toEqual([{ key: 'amer', total: 150 }, { key: 'emea', total: 30 }]);
        }
      });
    }

    it('CONTROL: the base lookup column itself groups alike on every face', async () => {
      for (const face of FACES) {
        expect(await rowsOf(face, BACKED, { dimensions: ['account'], measures: ['total'] }, 'account'), face)
          .toEqual([{ key: 'a1', total: 130 }, { key: 'a2', total: 50 }]);
      }
    });
  });

  describe('#28558 — a declared path to a column the related object lacks', () => {
    for (const [label, selection, param, member] of [
      ['as a dimension', { dimensions: ['account.bogus'], measures: ['total'] }, 'dimensions', 'account.bogus'],
      ['as a runtimeFilter member', { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'account.bogus': 'x' } }, 'where', 'account.bogus'],
    ] as const) {
      it(`is refused before SQL on every face ${label}, with one message`, async () => {
        const err = await refusedAlike(BACKED, selection as Selection, param, member);
        expect(err.field).toBe('bogus');
        expect(err.object).toBe(ACCOUNT);
        expect(err.message).toContain(
          `reads field 'bogus' through relationship path 'account', which object '${ACCOUNT}' does not have.`,
        );
      });
    }
  });

  describe('#28556 — a time dimension through an undeclared path', () => {
    for (const [label, entry] of [
      ['bucketed', { dimension: 'account.founded_at', granularity: 'month' }],
      ['windowed', { dimension: 'account.founded_at', dateRange: ['2026-01-01', '2026-01-31'] }],
    ] as const) {
      it(`is refused on every face when ${label}, with one message`, async () => {
        const err = await refusedAlike(UNBACKED, { measures: ['total'], timeDimensions: [{ ...entry }] }, 'timeDimensions', 'account.founded_at');
        expect(err.message).toContain(
          `Time dimension 'account.founded_at' on cube '${UNBACKED.name}' traverses relationship path 'account', which the dataset does not declare`,
        );
      });
    }
  });

  describe('#28557 — a runtimeFilter member through an undeclared path', () => {
    for (const [label, runtimeFilter] of [
      ['alone', { 'account.name': 'Acme' }],
      ["under an '$or'", { $or: [{ region: 'emea' }, { 'account.name': 'Acme' }] }],
    ] as const) {
      it(`is refused INVALID_FIELD on every face ${label}, the native strategy no longer DATASET_INVALID`, async () => {
        const err = await refusedAlike(UNBACKED, { dimensions: ['region'], measures: ['total'], runtimeFilter: { ...runtimeFilter } }, 'where', 'account.name');
        expect(err.message).toContain(
          `Filter member 'account.name' on cube '${UNBACKED.name}' traverses relationship path 'account', which the dataset does not declare`,
        );
      });
    }
  });
});
