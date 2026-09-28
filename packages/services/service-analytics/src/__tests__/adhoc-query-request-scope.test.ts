// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20381] The two ad-hoc doors — `query()` (`POST /analytics/query`) and
 * `generateSql()` (`POST /analytics/sql`) — write nothing into the registry
 * every caller shares until the request has been admitted, and the measures a
 * caller names on top of a configured cube are never written there at all.
 *
 * `ensureCube` records what it mints in the scope the call runs in. Both doors
 * ran it over the SHARED scope, before `callCtx` asked the object-level
 * admission, so:
 *
 * - a request refused `PERMISSION_DENIED` still left the cube it inferred
 *   (named after the refused object) in every caller's `getMeta()`;
 * - a caller-named suffix measure (`amount_sum` on a cube that declares no
 *   such measure) was appended to the configured cube for every caller —
 *   refused or not.
 *
 * Both doors now run in a request scope (the one `queryDataset` runs in), and
 * the ad-hoc door publishes an INFERRED cube to the shared registry only once
 * the object-level admission has admitted the request — "CubeRegistry source
 * 3", kept. An augmented cube is never published.
 *
 * ## What each case is shaped to catch
 *
 * - The OBSERVER is a second caller: its `getMeta()` and the exact call its
 *   query of the configured cube puts on the driver, before and after. Equality
 *   of the whole snapshot is the assertion.
 * - Every REFUSED leg asserts the ADR-0112 envelope (`PERMISSION_DENIED` /
 *   403) and that the driver never ran.
 * - The ADMITTED augmentation leg is the control a lazy fix loses: the
 *   caller's suffix measure still reaches the strategy.
 * - The ADMITTED inference leg pins the ORDER, not only the outcome: the
 *   admission provider reads the registry at the moment it is asked, and the
 *   inferred cube must not be there yet.
 * - CONTROL: a configured cube still serves, and an admitted scalar metric
 *   over an object still works on a second request, through the published cube.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

const CALLER_A = { userId: 'u_a', tenantId: 'org_a' } as ExecutionContext;
const CALLER_B = { userId: 'u_b', tenantId: 'org_a' } as ExecutionContext;

const OPEN = 'open_obj';
/** The object no caller may read. */
const WALLED = 'walled_obj';
/** A registered object no cube is configured over — the ad-hoc inference target. */
const OTHER = 'other_obj';
const OBJECT_FIELDS = ['name', 'region', 'amount'];

const OPEN_SUMMARY: Cube = {
  name: 'open_summary',
  title: 'Open summary',
  sql: OPEN,
  measures: {
    authored_total: { name: 'authored_total', label: 'Authored total', type: 'count', sql: '*' },
  },
  dimensions: {
    region: { name: 'region', label: 'Region', type: 'string', sql: 'region' },
  },
};

/** A configured cube over the walled object. */
const WALLED_SUMMARY: Cube = {
  name: 'walled_summary',
  title: 'Walled summary',
  sql: WALLED,
  measures: {
    walled_total: { name: 'walled_total', label: 'Walled total', type: 'count', sql: '*' },
  },
  dimensions: {},
};

const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

const STRATEGY_PATHS = [
  { strategy: 'NativeSQLStrategy', capabilities: nativeSqlOnly },
  { strategy: 'ObjectQLStrategy', capabilities: objectqlOnly },
] as const;

type Door = (svc: AnalyticsService, query: AnalyticsQuery, context: ExecutionContext) => Promise<unknown>;

/** The two ad-hoc doors, each answered by what it hands back. */
const DOORS: ReadonlyArray<{ door: string; run: Door }> = [
  { door: 'query', run: (svc, q, ctx) => svc.query(q, ctx) },
  { door: 'generateSql', run: (svc, q, ctx) => svc.generateSql(q, ctx) },
];

type DriverCall = { object: string; detail: unknown };

function makeService(
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean },
  onAdmission?: (object: string) => void,
) {
  const calls: DriverCall[] = [];
  const row = { authored_total: 3, walled_total: 4, count: 5, amount_sum: 7 };
  const svc: AnalyticsService = new AnalyticsService({
    logger: silentLogger,
    cubes: [OPEN_SUMMARY, WALLED_SUMMARY],
    queryCapabilities: capabilities,
    admitObjectRead: async (object) => {
      onAdmission?.(object);
      return object !== WALLED;
    },
    isRegisteredObject: (name) => [OPEN, WALLED, OTHER].includes(name),
    getObjectFieldNames: (name) => ([OPEN, WALLED, OTHER].includes(name) ? OBJECT_FIELDS : undefined),
    executeRawSql: async (object, sql, params) => {
      calls.push({ object, detail: { sql, params } });
      return [row];
    },
    executeAggregate: async (object, options) => {
      calls.push({ object, detail: options });
      return [row];
    },
  });
  return { svc, calls };
}

type Harness = ReturnType<typeof makeService>;

/** The second caller's whole view: discovery, and the driver call its query of the configured cube makes. */
async function observe({ svc, calls }: Harness) {
  const meta = await svc.getMeta();
  const from = calls.length;
  await svc.query({ cube: 'open_summary', measures: ['authored_total'] }, CALLER_B);
  return { meta, driven: calls.slice(from) };
}

describe.each(STRATEGY_PATHS)('[#20381] the ad-hoc doors leave the shared registry alone — $strategy', ({ capabilities }) => {
  it('observer baseline: the configured cubes are listed, and the open one serves by name', async () => {
    const h = makeService(capabilities);
    const { meta, driven } = await observe(h);
    expect(meta.map((c) => c.name).sort()).toEqual(['open_summary', 'walled_summary']);
    expect(driven.map((c) => c.object)).toEqual([OPEN]);
  });

  describe.each(DOORS)('door: $door', ({ run }) => {
    it('a REFUSED ad-hoc query over an object answers PERMISSION_DENIED / 403 and leaves no inferred cube', async () => {
      const h = makeService(capabilities);
      const names = h.svc.cubeRegistry.names();
      const before = await observe(h);
      const from = h.calls.length;

      await expect(run(h.svc, { cube: WALLED, measures: ['count'] }, CALLER_A)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        status: 403,
      });
      expect(h.calls.slice(from)).toEqual([]);

      expect(h.svc.cubeRegistry.names()).toEqual(names);
      expect(h.svc.cubeRegistry.get(WALLED)).toBeUndefined();
      expect(await observe(h)).toEqual(before);
    });

    it('a REFUSED query naming a suffix measure on a configured cube answers 403 and leaves the cube as authored', async () => {
      const h = makeService(capabilities);
      const before = await observe(h);
      const from = h.calls.length;

      await expect(
        run(h.svc, { cube: 'walled_summary', measures: ['walled_total', 'amount_sum'] }, CALLER_A),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      expect(h.calls.slice(from)).toEqual([]);

      expect(h.svc.cubeRegistry.get('walled_summary')).toBe(WALLED_SUMMARY);
      expect(await observe(h)).toEqual(before);
    });

    it('an ADMITTED query naming a suffix measure on a configured cube is served with it, and the cube stays as authored', async () => {
      const h = makeService(capabilities);
      const before = await observe(h);
      const from = h.calls.length;

      const answer = await run(h.svc, { cube: 'open_summary', measures: ['authored_total', 'amount_sum'] }, CALLER_A);
      // Served, with the caller's own measure: `SUM(amount)` reached the
      // strategy — on `query` through the driver, on `generateSql` in the
      // statement it hands back.
      expect(JSON.stringify([answer, h.calls.slice(from)])).toContain('amount');

      expect(h.svc.cubeRegistry.get('open_summary')).toBe(OPEN_SUMMARY);
      expect(await observe(h)).toEqual(before);
    });

    it('an ADMITTED ad-hoc query over an object publishes its inferred cube only AFTER admission (source 3)', async () => {
      let registryAtAdmission: string[] | undefined;
      const holder: { svc?: AnalyticsService } = {};
      const h = makeService(capabilities, (object) => {
        if (object === OTHER) registryAtAdmission = holder.svc!.cubeRegistry.names();
      });
      holder.svc = h.svc;
      const before = await observe(h);

      await run(h.svc, { cube: OTHER, measures: ['count'] }, CALLER_A);

      // The order: when the admission was asked, nothing had been written.
      expect(registryAtAdmission).toEqual(['open_summary', 'walled_summary']);
      // The outcome: the admitted request's inferred cube is registered — the
      // documented source 3 — with exactly the members it named.
      expect(Object.keys(h.svc.cubeRegistry.get(OTHER)?.measures ?? {})).toEqual(['count']);

      const after = await observe(h);
      expect(after.driven).toEqual(before.driven);
      expect(after.meta).toEqual(expect.arrayContaining(before.meta));
    });

    it('a query that loses the admission race to a registration leaves that registration in place', async () => {
      // An embedder registers a cube under the name while the ad-hoc request is
      // being admitted: publishing the inferred cube must not replace it.
      const authored: Cube = { ...OPEN_SUMMARY, name: OTHER, title: 'Authored other', sql: OTHER };
      const holder: { svc?: AnalyticsService } = {};
      const h = makeService(capabilities, (object) => {
        if (object === OTHER) holder.svc!.cubeRegistry.register(authored);
      });
      holder.svc = h.svc;

      await run(h.svc, { cube: OTHER, measures: ['count'] }, CALLER_A);

      expect(h.svc.cubeRegistry.get(OTHER)).toBe(authored);
    });
  });

  it('CONTROL: an admitted scalar metric over an object still works on a second request, through the published cube', async () => {
    const h = makeService(capabilities);
    await h.svc.query({ cube: OTHER, measures: ['count'] }, CALLER_A);
    const published = h.svc.cubeRegistry.get(OTHER);
    expect(published).toBeDefined();

    const from = h.calls.length;
    const second = await h.svc.query({ cube: OTHER, measures: ['count', 'amount_sum'] }, CALLER_B);
    expect(second.rows).toHaveLength(1);
    const driven = h.calls.slice(from);
    expect(driven.map((c) => c.object)).toEqual([OTHER]);
    expect(JSON.stringify(driven[0].detail)).toContain('amount');

    // The second request's suffix measure was its own: the published cube is
    // the one the first request minted, untouched.
    expect(h.svc.cubeRegistry.get(OTHER)).toBe(published);
    expect(Object.keys(published!.measures)).toEqual(['count']);
  });
});
