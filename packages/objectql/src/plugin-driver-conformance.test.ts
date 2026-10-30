// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27744] The plugin-driver conformance kit (`plugin-driver-conformance.ts`),
 * held to both halves of being an instrument: it passes the drivers that keep
 * the floor's contract, and it FAILS each one that breaks a rule of it, on the
 * case that names the rule.
 *
 * - The exact driver answers the whole query itself: both tiers pass.
 * - The every-row driver ignores the query but its `limit` (the guide's first
 *   step): the floor tier passes, and the direct tier fails on the filter.
 * - Each mutant breaks one rule; its failing case ids are pinned.
 *
 * The case batteries are pinned by count against the spec tables, so a kit
 * that silently stopped generating a battery fails here, not in a vendor's CI.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import {
  FILTER_LOGIC_CASES,
  FILTER_TEXT_CASES,
  PAGINATION_CASES,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
  TEMPORAL_CASES,
} from '@objectstack/spec/data';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';
import {
  PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES,
  createPluginDriverConformance,
  definePluginDriverConformanceSuite,
  pluginDriverConformanceFixtures,
  runPluginDriverConformance,
  type PluginDriverConformanceFixture,
  type PluginDriverConformanceOptions,
  type PluginDriverConformanceReport,
  type PluginDriverConformanceWriteProbe,
} from './plugin-driver-conformance.js';

type Row = Record<string, unknown>;

interface Behaviour {
  /** Apply `where` / `orderBy` / `offset` itself (exact), or answer every row up to `limit`. */
  pushdown: 'exact' | 'none';
  /** Rewrites the stored rows (a remote that stores a value differently). */
  store?: (row: Row) => Row;
  /** Rewrites the `where` before it is applied (a translation slip). */
  translate?: (where: unknown) => unknown;
  /** Throws instead of answering, for these `where`s. */
  refuse?: (where: unknown) => Error | undefined;
  /** The rows `find` answers are rewritten last (duplicates, invented rows). */
  answer?: (rows: Row[]) => Row[];
  count?: 'exact' | 'every-row';
  /** A paged walk with no stable order: every other page (`offset` present) is cut from the reversed rows. */
  unstablePaging?: boolean;
  /** The status a refused write declares. */
  writeRefusalStatus?: number;
  introspectSchema?: IDataDriver['introspectSchema'] | null;
}

/** The status a refusal declares, as `refuse()` in the plugin-driver guide does. */
const refusal = (message: string, status?: number) =>
  Object.assign(new Error(message), status === undefined ? {} : { status });

/**
 * A plugin driver over a fake remote holding `fixture.rows`. `find` applies
 * the filter itself when `pushdown` is `exact`; every variant applies `limit`
 * by presence, after the filter.
 */
function fakeDriver(fixture: PluginDriverConformanceFixture, behaviour: Behaviour): IDataDriver {
  const stored = fixture.rows.map((row) => (behaviour.store ? behaviour.store({ ...row }) : { ...row }));
  let pageCalls = 0;
  const read = (query: DriverQuery = {}): Row[] => {
    const where = behaviour.translate ? behaviour.translate(query.where) : query.where;
    const thrown = behaviour.refuse?.(query.where);
    if (thrown) throw thrown;
    let rows: Row[];
    if (behaviour.pushdown === 'exact') {
      rows = applyDriverQueryInMemory(stored, {
        ...(where !== undefined ? { where: where as DriverQuery['where'] } : {}),
        ...(query.orderBy ? { orderBy: query.orderBy as never } : {}),
        ...(typeof query.offset === 'number' ? { offset: query.offset } : {}),
        ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
      });
      if (behaviour.unstablePaging && typeof query.limit === 'number' && typeof query.offset === 'number' && (pageCalls++ % 2 === 1)) {
        const all = applyDriverQueryInMemory(stored, query.orderBy ? { orderBy: query.orderBy as never } : {}).reverse();
        rows = all.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
      }
    } else {
      rows = stored.map((row) => ({ ...row }));
      if (typeof query.limit === 'number') rows = rows.slice(0, query.limit);
    }
    return behaviour.answer ? behaviour.answer(rows) : rows;
  };
  const writable = (data: Row) => {
    if (data.a === 'refuse_me') throw refusal('the remote validation rejects a = refuse_me', behaviour.writeRefusalStatus ?? 422);
  };
  const driver: Record<string, unknown> = {
    name: 'conformance_fake',
    version: '0.0.1',
    supports: { transactionsUnsupported: true },
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async find(_object: string, query?: DriverQuery) { return read(query); },
    async findOne(_object: string, query?: DriverQuery) { return read({ ...query, limit: 1 })[0] ?? null; },
    async count(_object: string, query?: DriverQuery) {
      return behaviour.count === 'every-row' ? stored.length : read({ where: query?.where }).length;
    },
    async update(_object: string, id: string, data: Row) {
      writable(data);
      return { id, ...data };
    },
    async create(_object: string, data: Row) {
      writable(data);
      return { id: 'new_1', ...data };
    },
    async syncSchema() {},
  };
  if (behaviour.introspectSchema !== null) {
    driver.introspectSchema = behaviour.introspectSchema ?? (async () => ({
      dialect: 'fake_rest',
      introspectedAt: '2026-10-29T12:00:00.000Z',
      tables: {
        [fixture.object]: {
          name: fixture.object,
          columns: [
            { name: 'id', type: 'string', nullable: false, primaryKey: true },
            ...Object.entries(fixture.fields).map(([name, f]) => ({ name, type: f.type, nullable: true, primaryKey: false })),
          ],
        },
      },
    }));
  }
  return driver as unknown as IDataDriver;
}

/** A driver over a remote that is down, answering each read with `outage()`. */
function downDriver(fixture: PluginDriverConformanceFixture, outage: () => Promise<unknown>): IDataDriver {
  return {
    ...(fakeDriver(fixture, { pushdown: 'exact' }) as unknown as Row),
    find: outage,
    findOne: outage,
    count: outage,
  } as unknown as IDataDriver;
}

const PROBES: PluginDriverConformanceWriteProbe[] = [
  { name: 'an update the remote validation rejects', operation: 'update', args: ['1', { a: 'refuse_me' }], expect: 'refused' },
  { name: 'an update the remote accepts', operation: 'update', args: ['1', { a: 'ok' }], expect: 'accepted' },
];

const options = (behaviour: Behaviour, extra: Partial<PluginDriverConformanceOptions> = {}): PluginDriverConformanceOptions => ({
  setup: (fixture) => ({ driver: fakeDriver(fixture, behaviour) }),
  setupUnavailable: (fixture) => ({
    driver: downDriver(fixture, async () => { throw new Error('connect ECONNREFUSED'); }),
  }),
  writeProbes: PROBES,
  ...extra,
});

const failed = (report: PluginDriverConformanceReport) => report.results.filter((r) => r.status === 'fail').map((r) => r.id);
const messageOf = (report: PluginDriverConformanceReport, id: string) => report.results.find((r) => r.id === id)?.message ?? '';

const TEXT_ROWS_CASES = FILTER_TEXT_CASES.filter((c) => c.expectRejection !== true).length;
const TEMPORAL_FILTERS = TEMPORAL_CASES.length + TEMPORAL_CASES.filter((c) => c.tokenFilter).length;
const FILTERS = FILTER_LOGIC_CASES.length + TEXT_ROWS_CASES + TEMPORAL_FILTERS;

describe('[#27744] the case batteries', () => {
  it('generate one case per table row, per tier, and nothing calls setup until a case runs', () => {
    let setups = 0;
    const { cases } = createPluginDriverConformance({
      setup: (fixture) => { setups += 1; return { driver: fakeDriver(fixture, { pushdown: 'exact' }) }; },
      tiers: ['floor', 'direct'],
    });
    const count = (tier: string, group: string) => cases.filter((c) => c.tier === tier && c.group === group).length;
    expect(setups).toBe(0);
    expect(count('floor', 'shape')).toBe(PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES.length);
    expect(count('floor', 'filter')).toBe(FILTERS);
    expect(count('floor', 'count')).toBe(FILTER_LOGIC_CASES.length);
    expect(count('floor', 'order')).toBe(PAGINATION_CASES.length);
    expect(count('floor', 'write')).toBe(1); // no probes given ⇒ one not-offered case, never silence
    expect(count('floor', 'outage')).toBe(3);
    expect(count('floor', 'introspect')).toBe(1);
    expect(count('direct', 'filter')).toBe(FILTERS);
    expect(count('direct', 'count')).toBe(FILTER_LOGIC_CASES.length);
    expect(count('direct', 'find-one')).toBe(FILTER_LOGIC_CASES.length);
    expect(count('direct', 'paging')).toBe(
      PAGINATION_CASES.length + PAGINATION_UNORDERED_CASES.length + PAGINATION_ZERO_LIMIT_CASES.length);
    // Ids are unique: the P3 credential keys on them.
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    // Plain floor tier unless asked.
    expect(createPluginDriverConformance({ setup: () => { throw new Error('unused'); } }).cases.every((c) => c.tier === 'floor')).toBe(true);
  });

  it('refuses an unknown tier by name', () => {
    expect(() => createPluginDriverConformance({ setup: () => { throw new Error('unused'); }, tiers: ['fast' as never] }))
      .toThrow(/unknown tier 'fast'/);
  });

  it('hands out fixtures a remote can be seeded with: fresh copies, string ids, the null family intact', () => {
    const first = pluginDriverConformanceFixtures();
    expect(first.map((f) => f.name)).toEqual([...PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES]);
    for (const f of first) expect(f.rows.every((row) => typeof row.id === 'string')).toBe(true);
    expect(first[0]!.rows.some((row) => row.d === null)).toBe(true);
    first[0]!.rows[0]!.a = 'mutated';
    expect(pluginDriverConformanceFixtures()[0]!.rows[0]!.a).not.toBe('mutated');
  });
});

describe('[#27744] drivers that keep the contract pass', () => {
  it('the exact driver passes both tiers, every read answered exactly', async () => {
    const report = await runPluginDriverConformance(options({ pushdown: 'exact' }, { tiers: ['floor', 'direct'] }));
    expect(failed(report)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.driver).toBe('conformance_fake');
    const floorFilters = report.results.filter((r) => r.tier === 'floor' && r.group === 'filter');
    expect(floorFilters.every((r) => r.pushdown === 'exact')).toBe(true);
    expect(report.results.filter((r) => r.group === 'order').every((r) => r.order === 'honoured')).toBe(true);
    expect(report.results.some((r) => r.status === 'not-offered')).toBe(false);
  });

  it('the every-row driver passes the floor tier, measured as a superset, and fails the direct tier on the filter', async () => {
    const floor = await runPluginDriverConformance(options({ pushdown: 'none', count: 'every-row' }));
    expect(failed(floor)).toEqual([]);
    const narrowing = floor.results.filter((r) => r.group === 'filter' && r.pushdown === 'superset');
    expect(narrowing.length).toBeGreaterThan(0);
    expect(floor.results.filter((r) => r.group === 'order').every((r) => r.order === 'not-honoured')).toBe(true);

    const direct = await runPluginDriverConformance(options({ pushdown: 'none', count: 'every-row' }, { tiers: ['direct'] }));
    const directFailures = failed(direct);
    expect(directFailures).toContain('direct/filter/filter_logic/single-key $or branches stay a plain OR');
    expect(directFailures.some((id) => id.startsWith('direct/count/'))).toBe(true);
  });

  it('a driver that refuses what it cannot translate (status 400) passes the floor tier, measured as refused', async () => {
    const hasOr = (where: unknown) => JSON.stringify(where ?? null).includes('"$or"');
    const report = await runPluginDriverConformance(options({
      pushdown: 'exact',
      refuse: (where) => (hasOr(where) ? refusal('the remote cannot run $or', 400) : undefined),
    }));
    expect(failed(report)).toEqual([]);
    expect(report.results.some((r) => r.group === 'filter' && r.pushdown === 'refused')).toBe(true);
  });

  it('a remote that answers an instant as a native Date passes: the floor compares instants, not spellings', async () => {
    const report = await runPluginDriverConformance(options({
      pushdown: 'none',
      store: (row) => (typeof row.at === 'string' ? { ...row, at: new Date(row.at) } : row),
    }));
    expect(failed(report)).toEqual([]);
    expect(report.results.filter((r) => r.id.startsWith('floor/filter/temporal/')).length).toBe(TEMPORAL_FILTERS);
  });

  it('missing optional pieces read as not-offered, never as a pass that measured something', async () => {
    const report = await runPluginDriverConformance({
      setup: (fixture) => ({ driver: fakeDriver(fixture, { pushdown: 'exact', introspectSchema: null }) }),
    });
    expect(report.passed).toBe(true);
    const notOffered = report.results.filter((r) => r.status === 'not-offered').map((r) => r.group);
    expect(notOffered.sort()).toEqual(['introspect', 'outage', 'outage', 'outage', 'write']);
  });

  it('each setup is torn down once, after the run', async () => {
    const torn: string[] = [];
    await runPluginDriverConformance(options({ pushdown: 'exact' }, {
      setup: (fixture) => ({ driver: fakeDriver(fixture, { pushdown: 'exact' }), teardown: () => { torn.push(fixture.name); } }),
    }));
    // One shared setup per fixture, plus a fresh one per write probe.
    expect(torn.sort()).toEqual([...PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES, 'filter_logic', 'filter_logic'].sort());
  });
});

describe('[#27744] each broken rule fails on the case that names it', () => {
  it('dropping a branch of an $or (a narrower filter) loses rows', async () => {
    const report = await runPluginDriverConformance(options({
      pushdown: 'exact',
      translate: (where) => {
        const w = where as Row | undefined;
        if (!w || !Array.isArray(w.$or)) return where;
        const { $or, ...rest } = w;
        return { ...rest, ...(($or as Row[])[0] ?? {}) };
      },
    }));
    const id = 'floor/filter/filter_logic/single-key $or branches stay a plain OR';
    expect(failed(report)).toContain(id);
    expect(messageOf(report, id)).toMatch(/left out matching rows/);
    expect(messageOf(report, id)).toMatch(/WIDER filter/);
  });

  it('a null stored as an empty string fails the shape case and the null family', async () => {
    const report = await runPluginDriverConformance(options({
      pushdown: 'exact',
      store: (row) => (row.d === null ? { ...row, d: '' } : row),
    }));
    expect(failed(report)).toContain('floor/shape/filter_logic/every row, as stored');
    expect(messageOf(report, 'floor/shape/filter_logic/every row, as stored')).toMatch(/d = ""/);
    expect(failed(report).some((id) => id.startsWith('floor/filter/filter_logic/'))).toBe(true);
  });

  it('a number stored as text fails the shape case', async () => {
    const report = await runPluginDriverConformance(options({
      pushdown: 'none',
      store: (row) => (typeof row.score === 'number' ? { ...row, score: String(row.score) } : row),
    }));
    expect(failed(report)).toContain('floor/shape/filter_text/every row, as stored');
  });

  it('a refusal with no status reads as an outage to the caller, and fails', async () => {
    const report = await runPluginDriverConformance(options({
      pushdown: 'exact',
      refuse: (where) => (JSON.stringify(where ?? null).includes('"$or"') ? new Error('unsupported: $or') : undefined),
    }));
    const id = 'floor/filter/filter_logic/single-key $or branches stay a plain OR';
    expect(failed(report)).toContain(id);
    expect(messageOf(report, id)).toMatch(/with no status/);
    expect(messageOf(report, id)).toMatch(/503 ERR_DATASOURCE_UNAVAILABLE/);
  });

  it('answering a row twice, or a row the remote does not hold, fails', async () => {
    const twice = await runPluginDriverConformance(options({ pushdown: 'none', answer: (rows) => [...rows, ...rows.slice(0, 1)] }));
    expect(failed(twice)).toContain('floor/shape/pagination/every row, as stored');
    expect(messageOf(twice, 'floor/shape/pagination/every row, as stored')).toMatch(/twice/);
    const invented = await runPluginDriverConformance(options({ pushdown: 'none', answer: (rows) => [...rows, { id: 'ghost' }] }));
    expect(messageOf(invented, 'floor/shape/filter_logic/every row, as stored')).toMatch(/'ghost', which the remote does not hold/);
  });

  it('an outage answered as no rows, or as a 400, fails all three reads', async () => {
    const empty = await runPluginDriverConformance(options({ pushdown: 'exact' }, {
      setupUnavailable: (fixture) => ({ driver: downDriver(fixture, async () => []) }),
    }));
    expect(failed(empty).filter((id) => id.startsWith('floor/outage/'))).toHaveLength(3); // a count of 0 too
    expect(messageOf(empty, 'floor/outage/filter_logic/find while the remote is down')).toMatch(/no rows match/);
    expect(messageOf(empty, 'floor/outage/filter_logic/count while the remote is down')).toMatch(/answered 0/);
    const asRefusal = await runPluginDriverConformance(options({ pushdown: 'exact' }, {
      setupUnavailable: (fixture) => ({ driver: downDriver(fixture, async () => { throw refusal('upstream gone', 404); }) }),
    }));
    expect(failed(asRefusal).filter((id) => id.startsWith('floor/outage/'))).toHaveLength(3);
    expect(messageOf(asRefusal, 'floor/outage/filter_logic/count while the remote is down')).toMatch(/query is wrong/);
  });

  it('a write refusal declaring a 5xx reaches the caller as an outage, and fails', async () => {
    const report = await runPluginDriverConformance(options({ pushdown: 'exact', writeRefusalStatus: 500 }));
    const id = 'floor/write/filter_logic/an update the remote validation rejects';
    expect(failed(report)).toEqual([id]);
    expect(messageOf(report, id)).toMatch(/422 EXTERNAL_WRITE_REFUSED/);
  });

  it('a probe whose outcome differs from the remote fails both ways', async () => {
    const report = await runPluginDriverConformance(options({ pushdown: 'exact' }, {
      writeProbes: [
        { name: 'expected refused, accepted', operation: 'update', args: ['1', { a: 'ok' }], expect: 'refused' },
        { name: 'expected accepted, refused', operation: 'create', args: [{ a: 'refuse_me' }], expect: 'accepted' },
      ],
    }));
    expect(failed(report).sort()).toEqual([
      'floor/write/filter_logic/expected accepted, refused',
      'floor/write/filter_logic/expected refused, accepted',
    ]);
  });

  it('introspectSchema spelling the primary-key flag isPrimary fails with that name', async () => {
    const report = await runPluginDriverConformance(options({
      pushdown: 'exact',
      introspectSchema: async () => ({
        dialect: 'fake_rest',
        introspectedAt: '2026-10-29T12:00:00.000Z',
        tables: { t: { name: 't', columns: [{ name: 'id', type: 'string', nullable: false, isPrimary: true }] } },
      }) as never,
    }));
    const id = 'floor/introspect/filter_logic/introspectSchema answers the spec shape';
    expect(failed(report)).toEqual([id]);
    expect(messageOf(report, id)).toMatch(/isPrimary/);
  });

  it('direct: a count that ignores the filter, and a paged walk with no tie-breaker, fail', async () => {
    const counting = await runPluginDriverConformance(options({ pushdown: 'exact', count: 'every-row' }, { tiers: ['direct'] }));
    expect(failed(counting).every((id) => id.startsWith('direct/count/'))).toBe(true);
    expect(failed(counting).length).toBeGreaterThan(0);
    const paging = await runPluginDriverConformance(options({ pushdown: 'exact', unstablePaging: true }, { tiers: ['direct'] }));
    expect(failed(paging).some((id) => id.startsWith('direct/paging/pagination/'))).toBe(true);
    expect(failed(paging).every((id) => id.startsWith('direct/paging/'))).toBe(true);
  });
});

// The suite form, as a vendor's CI registers it: one test per case.
const torn: string[] = [];
definePluginDriverConformanceSuite(
  { describe, it, afterAll },
  {
    ...options({ pushdown: 'exact' }, { tiers: ['floor', 'direct'] }),
    setup: (fixture) => ({ driver: fakeDriver(fixture, { pushdown: 'exact' }), teardown: () => { torn.push(fixture.name); } }),
  },
  '[#27744] definePluginDriverConformanceSuite — the exact driver',
);
