/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  AnalyticsQuery as SpecAnalyticsQuery,
  AnalyticsResult as SpecAnalyticsResult,
  DatasetCompareTo as SpecDatasetCompareTo,
  DatasetSelection as SpecDatasetSelection,
} from '@objectstack/spec/contracts';
import type { PercentScale as SpecPercentScale } from '@objectstack/spec/data';
// The shared drill-filter builder + its range type (objectui#3813): the date
// sidecar's only consumer, imported rather than reproduced so the assertions
// below are about the SAME code the dashboard widget and report renderer run.
import { buildDatasetDrillFilter, type DatasetDrillRange } from '@object-ui/core';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  isAnalyticsNotInstalledError,
} from './index';

/** A fetch mock that answers discovery + records the dataset-query POST. */
function makeFetch(datasetResponse: { ok: boolean; status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: any }> = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/analytics/dataset/query')) {
      return {
        ok: datasetResponse.ok,
        status: datasetResponse.status ?? (datasetResponse.ok ? 200 : 400),
        statusText: datasetResponse.ok ? 'OK' : 'Bad Request',
        json: async () => datasetResponse.body,
      } as any;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as any;
  });
  return { fetchImpl, calls };
}

const inlineDataset = {
  name: 'sales', label: 'Sales', object: 'opportunity', include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['region'], measures: ['revenue'] };

describe('ObjectStackAdapter.queryDataset', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('POSTs the inline dataset + selection and returns rows/fields', async () => {
    const { fetchImpl, calls } = makeFetch({
      ok: true,
      body: { rows: [{ region: 'NA', revenue: 100 }], fields: [{ name: 'revenue', type: 'number' }] },
    });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', token: 'tok_123', autoReconnect: false, fetch: fetchImpl as any });

    const result = await adapter.queryDataset(inlineDataset as any, selection);

    expect(result.rows).toEqual([{ region: 'NA', revenue: 100 }]);
    expect(result.fields).toEqual([{ name: 'revenue', type: 'number' }]);

    const post = calls.find((c) => c.url.includes('/analytics/dataset/query'))!;
    expect(post.url).toBe('http://localhost:3000/api/v1/analytics/dataset/query');
    expect(post.init.method).toBe('POST');
    expect(post.init.headers.Authorization).toBe('Bearer tok_123');
    expect(JSON.parse(post.init.body)).toEqual({ dataset: inlineDataset, selection });
  });

  it('sends datasetName when given a string', async () => {
    const { fetchImpl, calls } = makeFetch({ ok: true, body: { rows: [], fields: [] } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    await adapter.queryDataset('sales', selection);
    const post = calls.find((c) => c.url.includes('/analytics/dataset/query'))!;
    expect(JSON.parse(post.init.body)).toEqual({ datasetName: 'sales', selection });
  });

  it('unwraps a { success, data } envelope', async () => {
    const { fetchImpl } = makeFetch({ ok: true, body: { success: true, data: { rows: [{ x: 1 }], fields: [] } } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    const result = await adapter.queryDataset(inlineDataset as any, selection);
    expect(result.rows).toEqual([{ x: 1 }]);
  });

  it('throws (no silent fallback) with the server message on a 4xx', async () => {
    const { fetchImpl } = makeFetch({ ok: false, status: 400, body: { code: 'DATASET_INVALID', message: 'relationship not declared' } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    await expect(adapter.queryDataset(inlineDataset as any, selection)).rejects.toThrow(/relationship not declared/);
  });

  // framework#3891 retired the degraded in-kernel analytics fallback, so a
  // deployment without @objectstack/service-analytics answers 501 (REST route
  // present, no service) or 404 (framework#4019 stopped mounting the routes).
  // Neither is an authoring mistake — the caller gets a typed, readable error
  // instead of `Dataset query failed: 501 Not Implemented — …`.
  describe('analytics capability absent', () => {
    it('maps 501 NOT_IMPLEMENTED to a readable ANALYTICS_NOT_INSTALLED error', async () => {
      const { fetchImpl } = makeFetch({
        ok: false,
        status: 501,
        body: {
          code: 'NOT_IMPLEMENTED',
          message: 'Analytics dataset query is not available on this deployment (no analytics service with queryDataset).',
        },
      });
      const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

      const err = await adapter.queryDataset(inlineDataset as any, selection).catch((e) => e);

      expect(isAnalyticsNotInstalledError(err)).toBe(true);
      expect(err.code).toBe('ANALYTICS_NOT_INSTALLED');
      expect(err.message).toContain('Analytics capability is not installed');
      expect(err.message).toContain('@objectstack/service-analytics');
    });

    it('maps a 404 (routes not mounted) the same way', async () => {
      const { fetchImpl } = makeFetch({ ok: false, status: 404, body: { error: 'Not found' } });
      const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

      const err = await adapter.queryDataset(inlineDataset as any, selection).catch((e) => e);

      expect(isAnalyticsNotInstalledError(err)).toBe(true);
    });

    it('leaves a real compile error alone (it is NOT a missing capability)', async () => {
      const { fetchImpl } = makeFetch({ ok: false, status: 400, body: { message: 'relationship not declared in include' } });
      const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

      const err = await adapter.queryDataset(inlineDataset as any, selection).catch((e) => e);

      expect(isAnalyticsNotInstalledError(err)).toBe(false);
      expect(String(err.message)).toContain('relationship not declared');
    });
  });
});

/* -------------------------------------------------------------------------- */
/* objectui#5663 — one branch per SERVER CONDITION, keyed on the ADR-0112       */
/* `code`, never on "the endpoint errored".                                     */
/*                                                                             */
/* Every body below is the wire answer its producer actually writes, copied     */
/* from the framework rather than imagined here — that is the whole point of    */
/* the fixtures, since the defect was a client that decided what the server had */
/* said without reading the field the server said it in:                        */
/*                                                                             */
/*   route absent      404 wrapped `ROUTE_NOT_FOUND`  @objectstack/runtime,     */
/*                                                    dispatcher-plugin.ts      */
/*   service absent    501 flat    `NOT_IMPLEMENTED`  @objectstack/rest,        */
/*                                                    registerAnalyticsEndpoints*/
/*   dataset unknown   404 flat    `NOT_FOUND`        same route, the           */
/*                                                    `datasetName` lookup miss */
/*   not signed in     401 flat    `UNAUTHENTICATED`  ANONYMOUS_DENY_BODY,      */
/*                                                    @objectstack/core         */
/*                                                                             */
/* The first two and the third SHARE HTTP 404. That collision is the defect,    */
/* so the pins below are written to fail if anyone reintroduces a status test.  */
/* -------------------------------------------------------------------------- */
describe('ObjectStackAdapter.queryDataset — error branch mapping (objectui#5663)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  const adapterFor = (fetchImpl: any) =>
    new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

  /** The dispatcher's 404 for a url no route is registered for. */
  const ROUTE_NOT_FOUND_BODY = {
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Not Found',
      httpStatus: 404,
      hint: 'No handler matched this request. Check the API discovery endpoint for available routes.',
    },
  };
  /** The REST route's 404 when `body.datasetName` matches no saved dataset. */
  const DATASET_NOT_FOUND_BODY = {
    code: 'NOT_FOUND',
    message: 'Dataset "opportunity_metrics" not found.',
  };
  /** `ANONYMOUS_DENY_BODY` — note `error` carries the CODE, not the message. */
  const UNAUTHENTICATED_BODY = {
    error: 'UNAUTHENTICATED',
    code: 'UNAUTHENTICATED',
    message: 'Authentication is required to access this endpoint.',
  };

  it('route absent (404 ROUTE_NOT_FOUND, wrapped envelope) → capability not installed', async () => {
    const { fetchImpl } = makeFetch({ ok: false, status: 404, body: ROUTE_NOT_FOUND_BODY });

    const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

    expect(err.code).toBe('ANALYTICS_NOT_INSTALLED');
    // Read out of the WRAPPED envelope — a reader that only knew the flat shape
    // would see no code here and reach the branch by luck of the status.
    expect(err.serverCode).toBe('ROUTE_NOT_FOUND');
    expect(err.message).toContain('@objectstack/service-analytics');
  });

  it('service absent (501 NOT_IMPLEMENTED) → capability not installed', async () => {
    const { fetchImpl } = makeFetch({
      ok: false,
      status: 501,
      body: {
        code: 'NOT_IMPLEMENTED',
        message: 'Analytics dataset query is not available on this deployment (no analytics service with queryDataset).',
      },
    });

    const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

    expect(err.code).toBe('ANALYTICS_NOT_INSTALLED');
    expect(err.serverCode).toBe('NOT_IMPLEMENTED');
  });

  it('dataset unknown (404 NOT_FOUND) → dataset-not-defined, NOT capability-missing', async () => {
    const { fetchImpl } = makeFetch({ ok: false, status: 404, body: DATASET_NOT_FOUND_BODY });

    const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

    expect(err.code).toBe('ANALYTICS_DATASET_NOT_FOUND');
    expect(err.serverCode).toBe('NOT_FOUND');
    expect(err.datasetName).toBe('opportunity_metrics');
    // The regression itself: SAME status as the branch above, different answer.
    expect(isAnalyticsNotInstalledError(err)).toBe(false);
  });

  it('not signed in (401 UNAUTHENTICATED) → its own branch, neither of the other two', async () => {
    const { fetchImpl } = makeFetch({ ok: false, status: 401, body: UNAUTHENTICATED_BODY });

    const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

    expect(err.code).toBe('ANALYTICS_UNAUTHENTICATED');
    expect(err.serverCode).toBe('UNAUTHENTICATED');
    expect(isAnalyticsNotInstalledError(err)).toBe(false);
    expect(err.message).toMatch(/not authenticated/i);
  });

  /* ------------------------------------------------------------------------ */
  /* The reported incident, replayed byte-for-byte.                            */
  /* ------------------------------------------------------------------------ */
  it('replays the reported prod banner: no install-a-plugin advice, and the app upgrade is named', async () => {
    const { fetchImpl } = makeFetch({ ok: false, status: 404, body: DATASET_NOT_FOUND_BODY });

    const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

    // What the operator on `os-2gv9x5.objectos.ai` was told to do, and must not
    // be told again: install a server plugin, for an installed-app version skew.
    expect(err.message).not.toContain('capability is not installed');
    expect(err.message).not.toContain('AnalyticsServicePlugin');
    expect(err.message).not.toContain('@objectstack/service-analytics');
    // What they should have been told.
    expect(err.message).toContain('Dataset "opportunity_metrics"');
    expect(err.message).toContain('not defined in this environment');
    expect(err.message).toContain('upgrade the installed app');
  });

  /* ------------------------------------------------------------------------ */
  /* The headline and the parenthetical cannot disagree.                       */
  /*                                                                           */
  /* The original banner quoted `Dataset "opportunity_metrics" not found.` in   */
  /* its own parenthetical while its headline said the capability was missing.  */
  /* A diagnostic that quotes its subject and then overrides its meaning is     */
  /* worse than one that says nothing, because it reads as authoritative. The   */
  /* structural fix is that the headline is now a pure function of `code` and   */
  /* the parenthetical a verbatim quote of `message` from the SAME response, so */
  /* the pins below walk every branch and assert both halves at once.          */
  /* ------------------------------------------------------------------------ */
  describe('headline and parenthetical are read off the same answer', () => {
    const branches = [
      { name: 'route absent', status: 404, body: ROUTE_NOT_FOUND_BODY, quoted: 'Not Found', headline: /capability is not installed/ },
      { name: 'dataset unknown', status: 404, body: DATASET_NOT_FOUND_BODY, quoted: 'Dataset "opportunity_metrics" not found.', headline: /is not defined in this environment/ },
      { name: 'not signed in', status: 401, body: UNAUTHENTICATED_BODY, quoted: 'Authentication is required to access this endpoint.', headline: /not authenticated/ },
    ] as const;

    for (const branch of branches) {
      it(`${branch.name}: quotes the server verbatim and says the same thing in the headline`, async () => {
        const { fetchImpl } = makeFetch({ ok: false, status: branch.status, body: branch.body });

        const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

        expect(err.message).toContain(`(server said: ${branch.quoted})`);
        expect(err.message).toMatch(branch.headline);
        // …and none of the OTHER branches' headlines. This is the assertion the
        // old mapping failed: it quoted this branch's message under a different
        // branch's headline.
        for (const other of branches) {
          if (other.name === branch.name) continue;
          expect(err.message).not.toMatch(other.headline);
        }
      });
    }
  });

  /* ------------------------------------------------------------------------ */
  /* The status is consulted ONLY when there is no code to read.               */
  /* ------------------------------------------------------------------------ */
  describe('no ADR-0112 code in the answer', () => {
    it('a bare 404 is still the capability-missing branch — no ObjectStack route wrote it', async () => {
      const { fetchImpl } = makeFetch({ ok: false, status: 404, body: { error: 'Not found' } });

      const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

      expect(err.code).toBe('ANALYTICS_NOT_INSTALLED');
      // Nothing named a code, so nothing is claimed about which producer spoke.
      expect(err.serverCode).toBeUndefined();
    });

    it('a bare 401 is the unauthenticated branch', async () => {
      const { fetchImpl } = makeFetch({ ok: false, status: 401, body: {} });

      const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

      expect(err.code).toBe('ANALYTICS_UNAUTHENTICATED');
      expect(err.serverCode).toBeUndefined();
    });

    it('a non-JSON error body does not throw the mapping itself', async () => {
      const fetchImpl = vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/api/v1/discovery')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
        }
        return {
          ok: false, status: 502, statusText: 'Bad Gateway',
          json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
        } as any;
      });

      const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

      expect(err.code).toBeUndefined();
      expect(String(err.message)).toContain('Dataset query failed: 502');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* A 404 this client does not recognise is NOT quietly relabelled.           */
  /* ------------------------------------------------------------------------ */
  it('a 404 with an unrecognised code keeps its server detail instead of claiming a capability is missing', async () => {
    // `CUBE_NOT_FOUND` (404) is a real analytics gate that reaches this route
    // through the ADR-0112 envelope passthrough. Under the old status test it
    // was ALSO reported as "install @objectstack/service-analytics"; the point
    // of branching on `code` is that an unknown condition now reads as unknown
    // rather than as the one condition the status happened to be tested for.
    const { fetchImpl } = makeFetch({
      ok: false, status: 404,
      body: { code: 'CUBE_NOT_FOUND', message: 'Cube "revenue" is not defined.' },
    });

    const err = await adapterFor(fetchImpl).queryDataset('opportunity_metrics', selection).catch((e) => e);

    expect(isAnalyticsNotInstalledError(err)).toBe(false);
    expect(err.code).toBeUndefined();
    expect(String(err.message)).toContain('Cube "revenue" is not defined.');
  });
});

/* -------------------------------------------------------------------------- */
/* objectui#3613 — the `selection` parameter IS the spec type, not a copy.      */
/*                                                                             */
/* Compile-time pins. A violation is a `tsc --noEmit` error, not a runtime      */
/* failure: this package's tsconfig.json includes its whole `src/**` (tests     */
/* included), so these are checked by `pnpm --filter @object-ui/data-objectstack*/
/* type-check` with no separate tsconfig.typetests.json — the same property     */
/* spec-symbol-batch6.test.ts documents and relies on.                          */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

/** The declared type of `queryDataset`'s second parameter, read off the method. */
type SelectionParam = Parameters<ObjectStackAdapter['queryDataset']>[1];

describe('queryDataset(selection) is @objectstack/spec DatasetSelection itself', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecDatasetSelection>, false>>;

    // THE pin. `Equal` rather than a two-way `extends` on purpose: a
    // restatement that merely *overlaps* the contract satisfies mutual
    // assignability in the drifted direction too (a required `dimension` is
    // still assignable TO an optional one). Structural identity is the only
    // assertion a hand copy cannot pass while drifting.
    type _IsTheSpecType = Assert<Equal<SelectionParam, SpecDatasetSelection>>;

    expect(true).toBe(true);
  });

  // The three drifts the deleted copy had accumulated, named individually so a
  // future reader learns what a restatement costs — not just that one existed.
  it('pins compareTo as the spec DatasetCompareTo, with dimension OPTIONAL', () => {
    type CompareTo = NonNullable<SelectionParam['compareTo']>;
    type _IsSpecCompareTo = Assert<Equal<CompareTo, SpecDatasetCompareTo>>;

    // objectstack#5011 made `dimension` optional BECAUSE the executor resolves
    // it (exactly one dated time dimension → that one; zero or several → a loud
    // error listing the candidates). The copy declared it required, so the
    // compiler demanded from every typed caller precisely the consumer-side
    // dimension guess that change forbids — turning a loud executor error into
    // a silently wrong comparison window.
    type _DimensionOptional = Assert<Equal<CompareTo['dimension'], string | undefined>>;
    type _DimensionWasNotRequired = Assert<Equal<Equal<CompareTo['dimension'], string>, false>>;
    // …and the shape with no `dimension` at all is a legal authoring surface.
    type _KindOnlyIsValid = Assert<
      { kind: 'previousPeriod' } extends CompareTo ? true : false
    >;

    expect(true).toBe(true);
  });

  it('pins timeDimensions at the spec shape, not `unknown[]`', () => {
    type _IsSpecTimeDimensions = Assert<
      Equal<SelectionParam['timeDimensions'], SpecAnalyticsQuery['timeDimensions']>
    >;
    type _NotUnknownArray = Assert<
      Equal<Equal<SelectionParam['timeDimensions'], unknown[] | undefined>, false>
    >;
    // The entry shape the executor's compareTo resolution reads (`dateRange`
    // present ⇒ shiftable) — invisible through `unknown[]`.
    type Entry = NonNullable<SelectionParam['timeDimensions']>[number];
    type _EntryHasDimension = Assert<Equal<Entry['dimension'], string>>;
    type _EntryHasDateRange = Assert<HasKey<Entry, 'dateRange'>>;

    expect(true).toBe(true);
  });

  it('pins runtimeFilter as a FilterCondition and carries dateGranularity', () => {
    // The copy widened `runtimeFilter` to `Record<string, unknown>`, which
    // erases the `$and`/`$or`/`$not` vocabulary the server parses.
    type _RuntimeFilterNarrowed = Assert<
      Equal<Equal<SelectionParam['runtimeFilter'], Record<string, unknown> | undefined>, false>
    >;
    type _RuntimeFilterKnowsLogicalOps = Assert<
      HasKey<NonNullable<SelectionParam['runtimeFilter']>, '$and'>
    >;

    // `dateGranularity` (framework#3588) is the drift nobody had noticed: the
    // copy never grew the key, so a typed caller could not bucket a trend by
    // month at all. A restatement does not only drift on the fields it has — it
    // also stops at whatever the contract looked like the day it was written.
    type _HasDateGranularity = Assert<HasKey<SelectionParam, 'dateGranularity'>>;
    type _DateGranularityEnum = Assert<
      Equal<
        SelectionParam['dateGranularity'],
        'day' | 'week' | 'month' | 'quarter' | 'year' | undefined
      >
    >;

    expect(true).toBe(true);
  });

  // The runtime half of the same fact: the adapter must forward `compareTo`
  // VERBATIM. If it ever "helpfully" filled a `dimension` in to satisfy its own
  // old declaration, the executor would stop resolving and every caller's
  // comparison window would depend on the adapter's guess.
  it('forwards a dimension-less compareTo to the server untouched', async () => {
    const { fetchImpl, calls } = makeFetch({ ok: true, body: { rows: [], fields: [] } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

    await adapter.queryDataset('sales', {
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [{ dimension: 'closedAt', granularity: 'month', dateRange: ['2026-01-01', '2026-03-31'] }],
      compareTo: { kind: 'previousPeriod' },
    });

    const post = calls.find((c) => c.url.includes('/analytics/dataset/query'))!;
    const sent = JSON.parse(post.init.body);
    expect(sent.selection.compareTo).toEqual({ kind: 'previousPeriod' });
    expect(sent.selection.compareTo).not.toHaveProperty('dimension');
  });
});

/* -------------------------------------------------------------------------- */
/* objectui#3752 — the RESULT's `fields` element is the spec type, not a copy.  */
/*                                                                             */
/* Same drift family as #3613 above, on the other side of the call: the return  */
/* type hand-listed five keys and had already stopped at the contract of the    */
/* day it was written — no `percentScale`. Compile-time pins, checked by        */
/* `pnpm --filter @object-ui/data-objectstack type-check` for the reason that   */
/* section documents (this package's tsconfig.json compiles its own tests).     */
/* -------------------------------------------------------------------------- */

/** What `queryDataset` RESOLVES to, read off the method. */
type DatasetEnvelope = Awaited<ReturnType<ObjectStackAdapter['queryDataset']>>;
/** …and the declared shape of one result column. */
type ResultField = DatasetEnvelope['fields'][number];

describe('queryDataset result fields ARE @objectstack/spec AnalyticsResult fields', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecAnalyticsResult>, false>>;

    // THE pin: structural identity with the spec's element, so the declaration
    // cannot lag the contract again. `Equal` rather than `extends` for the
    // #3613 reason — a narrower copy stays assignable while drifting.
    type _IsTheSpecField = Assert<Equal<ResultField, SpecAnalyticsResult['fields'][number]>>;

    // The single key the deleted copy was missing, named so a reader learns
    // WHICH omission cost something rather than merely that one existed.
    type _HasPercentScale = Assert<HasKey<ResultField, 'percentScale'>>;
    type _PercentScaleIsTheSpecUnion = Assert<
      Equal<ResultField['percentScale'], SpecPercentScale | undefined>
    >;
    // …and not a widened `string`: 'fraction' | 'whole' is the whole point —
    // a renderer branches on it instead of guessing from the value (#3136).
    type _PercentScaleIsNotString = Assert<
      Equal<Equal<ResultField['percentScale'], string | undefined>, false>
    >;

    // The exact shape this replaced, kept as a NEGATIVE pin: restoring the
    // hand-written five keys turns this red, so the sabotage direction is
    // recorded in the test rather than in a commit message.
    type _NotTheFiveKeyCopy = Assert<
      Equal<
        Equal<ResultField, { name: string; type: string; label?: string; format?: string; currency?: string }>,
        false
      >
    >;

    expect(true).toBe(true);
  });

  // Why only `fields` is spec-owned and the envelope is not (objectui#3752
  // direction B). The REST route answers `AnalyticsResult` PLUS ADR-0021 D2
  // drill sidecars, but this method rebuilds its own object from the payload
  // and never copies `sql` — so declaring the envelope as `AnalyticsResult &
  // {…}` would advertise a key the adapter structurally cannot return.
  it('pins the envelope as NOT an AnalyticsResult (no `sql`)', () => {
    type _NoSql = Assert<Equal<HasKey<DatasetEnvelope, 'sql'>, false>>;
    // The drill sidecars the spec type does not carry stay locally declared.
    type _HasDrillObject = Assert<HasKey<DatasetEnvelope, 'object'>>;
    type _HasDimensionFields = Assert<HasKey<DatasetEnvelope, 'dimensionFields'>>;
    type _HasDrillRawRows = Assert<HasKey<DatasetEnvelope, 'drillRawRows'>>;
    type _HasDrillRanges = Assert<HasKey<DatasetEnvelope, 'drillRanges'>>;

    expect(true).toBe(true);
  });

  // The runtime half: a column's `percentScale` must reach the caller verbatim.
  // The adapter passes `fields` through untouched, so this guards against a
  // future "normalisation" quietly dropping the key the declaration now shows.
  it('returns a percentage column with its percentScale untouched', async () => {
    const { fetchImpl } = makeFetch({
      ok: true,
      body: {
        rows: [{ region: 'NA', winRate: 1 }],
        fields: [
          { name: 'region', type: 'string', label: 'Region' },
          { name: 'winRate', type: 'number', label: 'Win rate', format: '0.0%', percentScale: 'fraction' },
        ],
      },
    });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

    const result = await adapter.queryDataset(inlineDataset as any, selection);

    // Read through the DECLARED type, not `as any`: this line is the reason the
    // issue was filed — before the fix it did not compile.
    const winRate = result.fields.find((f) => f.name === 'winRate')!;
    expect(winRate.percentScale).toBe('fraction');
    const region = result.fields.find((f) => f.name === 'region')!;
    expect(region.percentScale).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* objectui#3813 — the date-range drill sidecar reaches the caller.            */
/*                                                                             */
/* Third instance of the same family as #3613/#3752, this time on the RUNTIME   */
/* face: `queryDataset` rebuilds its result by hand-picking keys off the        */
/* payload, and `drillRanges` was never in the list — so the server's #1752     */
/* date-bucket drill scope was silently dropped by the only real adapter, and   */
/* a date-only dashboard/report lost its entire drill entry point (`canDrill`   */
/* can only be true via these ranges when no equality drill dim exists).        */
/*                                                                             */
/* The envelopes below are the SHAPES THE SERVER ACTUALLY SENDS, not idealised  */
/* ones — that distinction is why the existing consumer tests could not see the */
/* bug (they mock a data source and feed `drillRanges` in directly):            */
/*   - `POST /analytics/dataset/query` answers `res.json(result)` — a BARE      */
/*     result, no `{ success, data }` wrapper (objectstack `rest-server.ts`);    */
/*   - it carries `sql`, which this adapter deliberately does not return;       */
/*   - for a DATE-ONLY grouping the server sets `object` + `drillRanges` and    */
/*     NOTHING else drill-related: `service-analytics` excludes date dims from  */
/*     `drillDims`, so `dimensionFields` / `drillRawRows` are absent entirely.  */
/* -------------------------------------------------------------------------- */

/** Sales bucketed by month only — no non-date dimension, so no equality drill. */
const monthlyDataset = {
  name: 'sales_by_month', label: 'Sales by month', object: 'opportunity',
  dimensions: [{ name: 'closed_month', field: 'close_date', type: 'date', dateGranularity: 'month' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const monthlySelection = { dimensions: ['closed_month'], measures: ['revenue'] };

/**
 * `DatasetWidget`'s drill predicate, reproduced from the widget rather than
 * restated: `drillDims` is `dimensions.filter((d) => d in dimensionFields)` and
 * `canDrill = !!drillObject && (drillDims.length > 0 || !!drillRanges?.length)`
 * (`packages/plugin-dashboard/src/DatasetWidget.tsx:590-593`; the report
 * renderer's per-row `hasRange` gate at `DatasetReportRenderer.tsx:431` and its
 * pivot twin at `:855` are the same fact per row). Fed straight from the
 * adapter's return so the assertion is about what the ADAPTER produced.
 */
function consumerDrillView(
  result: Awaited<ReturnType<ObjectStackAdapter['queryDataset']>>,
  dimensions: string[],
) {
  const drillDims = result.dimensionFields ? dimensions.filter((d) => d in result.dimensionFields!) : [];
  return {
    drillDims,
    canDrill: !!result.object && (drillDims.length > 0 || !!result.drillRanges?.length),
  };
}

describe('queryDataset passes the server drillRanges sidecar through (#1752)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('keeps drillRanges verbatim for a DATE-ONLY grouping, so canDrill is true', async () => {
    const { fetchImpl } = makeFetch({
      ok: true,
      // The real envelope: bare (no success/data wrapper), with `sql`, with
      // `object` re-set by the range block, and WITHOUT dimensionFields /
      // drillRawRows — the server emits none of those for a date-only grouping.
      body: {
        rows: [
          { closed_month: '2026-05', revenue: 100 },
          { closed_month: '2026-06', revenue: 250 },
        ],
        fields: [
          { name: 'closed_month', type: 'date', label: 'Closed month' },
          { name: 'revenue', type: 'number', label: 'Revenue', format: '$0,0' },
        ],
        sql: 'SELECT date_trunc(...) AS closed_month, SUM(amount) AS revenue FROM opportunity GROUP BY 1',
        object: 'opportunity',
        drillRanges: [
          { closed_month: { field: 'close_date', gte: '2026-05-01', lt: '2026-06-01' } },
          { closed_month: { field: 'close_date', gte: '2026-06-01', lt: '2026-07-01' } },
        ],
      },
    });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

    const result = await adapter.queryDataset(monthlyDataset as any, monthlySelection);

    // (1) The key arrives at the caller, untouched and row-aligned. Read through
    // the DECLARED type, not `as any` — before the fix this line did not compile.
    expect(result.drillRanges).toEqual([
      { closed_month: { field: 'close_date', gte: '2026-05-01', lt: '2026-06-01' } },
      { closed_month: { field: 'close_date', gte: '2026-06-01', lt: '2026-07-01' } },
    ]);
    expect(result.drillRanges).toHaveLength(result.rows.length);

    // (2) The mock really is the server's date-only shape, not a convenient one:
    // if these ever become defined, the fixture stopped exercising the case
    // where `drillRanges` is the ONLY thing that can make a widget drillable.
    expect(result.dimensionFields).toBeUndefined();
    expect(result.drillRawRows).toBeUndefined();

    // (3) The issue's acceptance anchor, evaluated with the consumers' own
    // predicate: a date-only chart is drillable again.
    const { drillDims, canDrill } = consumerDrillView(result, monthlySelection.dimensions);
    expect(drillDims).toEqual([]);
    expect(canDrill).toBe(true);

    // (4) …and the drilled filter really scopes to the CLICKED bucket, built by
    // the shared `buildDatasetDrillFilter` the widget and the report both call.
    expect(buildDatasetDrillFilter(result.drillRawRows?.[1], drillDims, result.dimensionFields ?? {}, undefined, result.drillRanges?.[1]))
      .toEqual({ close_date: { $gte: '2026-06-01', $lt: '2026-07-01' } });
  });

  it('keeps BOTH sidecars for a mixed date + non-date grouping (no superset drill)', async () => {
    const { fetchImpl } = makeFetch({
      ok: true,
      body: {
        rows: [{ region: 'North America', closed_month: '2026-06', revenue: 250 }],
        fields: [
          { name: 'region', type: 'string', label: 'Region' },
          { name: 'closed_month', type: 'date', label: 'Closed month' },
          { name: 'revenue', type: 'number', label: 'Revenue' },
        ],
        object: 'opportunity',
        // Equality sidecars cover the non-date dim only (and carry the RAW value
        // `NA`, not the row's resolved label "North America"); the date dim gets
        // a range instead.
        dimensionFields: { region: 'account.region' },
        drillRawRows: [{ region: 'NA' }],
        drillRanges: [{ closed_month: { field: 'close_date', gte: '2026-06-01', lt: '2026-07-01' } }],
      },
    });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

    const result = await adapter.queryDataset(monthlyDataset as any, { dimensions: ['region', 'closed_month'], measures: ['revenue'] });

    const { drillDims, canDrill } = consumerDrillView(result, ['region', 'closed_month']);
    expect(canDrill).toBe(true);
    expect(drillDims).toEqual(['region']);

    // Both halves in one filter. Without the range the drill was a SUPERSET —
    // clicking June's bar opened every month for that region.
    expect(buildDatasetDrillFilter(result.drillRawRows?.[0], drillDims, result.dimensionFields ?? {}, { stage: 'won' }, result.drillRanges?.[0]))
      // objectui#9137 re-spelled the COMPOSITION: the runtime filter is now
      // conjoined through `composeDrillFilter` rather than spread into the
      // drill filter, and the half-open range arrives as two `$and` children
      // on one field (`convertFiltersToAST` emits a node per bound). Both
      // halves are still here, which is this test's claim — without the range
      // the drill was a superset.
      .toEqual({
        $and: [
          { stage: 'won' },
          {
            $and: [
              { 'account.region': 'NA' },
              { close_date: { $gte: '2026-06-01' } },
              { close_date: { $lt: '2026-07-01' } },
            ],
          },
        ],
      });
  });

  it('leaves drillRanges undefined when the server sends none (non-date grouping)', async () => {
    const { fetchImpl } = makeFetch({
      ok: true,
      body: {
        rows: [{ region: 'NA', revenue: 100 }],
        fields: [{ name: 'revenue', type: 'number' }],
        object: 'opportunity',
        dimensionFields: { region: 'account.region' },
        drillRawRows: [{ region: 'NA' }],
      },
    });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

    const result = await adapter.queryDataset(inlineDataset as any, selection);

    // Absent stays absent — the passthrough must not invent an empty array,
    // which would flip `canDrill`'s `!!drillRanges?.length` reasoning nowhere
    // but would make the two sidecars' index alignment meaningless.
    expect(result.drillRanges).toBeUndefined();
    expect(consumerDrillView(result, ['region']).canDrill).toBe(true);
  });

  it('is pinned at compile time as the SHARED DatasetDrillRange, not a restatement', () => {
    type DrillRanges = NonNullable<DatasetEnvelope['drillRanges']>;
    type RangeEntry = DrillRanges[number][string];

    // THE pin. `@object-ui/core`'s `DatasetDrillRange` is the single in-repo
    // declaration of this shape — it is what `buildDatasetDrillFilter` accepts
    // and what `DatasetWidget` / `DatasetReportRenderer` type their state with.
    // Nothing in `@objectstack/spec` owns it yet (the producer's own
    // `AnalyticsResultWithDrill` is local to `service-analytics`), so identity
    // with the shared interface is the strongest available contract pin: a local
    // `{ field: string; gte: string; lt: string }` copy — the shape a reader is
    // most tempted to write here — fails this line, per #3613's lesson that a
    // restatement stays assignable while it drifts.
    type _IsTheSharedType = Assert<Equal<RangeEntry, DatasetDrillRange>>;
    type _SharedTypeNotAny = Assert<Equal<IsAny<DatasetDrillRange>, false>>;

    // Row-aligned array of dimension NAME → range, mirroring `drillRawRows`.
    type _IsRowAlignedArray = Assert<Equal<DrillRanges, Array<Record<string, DatasetDrillRange>>>>;
    // Optional, because the server omits it whenever no date dim was bucketed.
    type _IsOptional = Assert<Equal<DatasetEnvelope['drillRanges'], DrillRanges | undefined>>;

    expect(true).toBe(true);
  });
});
