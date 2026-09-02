// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// ── helpers ──────────────────────────────────────────────────────────────────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }), getMetaTypes: vi.fn().mockResolvedValue([]), getMetaItems: vi.fn().mockResolvedValue([]) };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const inlineDataset = {
  name: 'sales', label: 'Sales', object: 'opportunity', include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['region'], measures: ['revenue'] };

/** Build a RestServer with an optional analytics provider (positional arg #15). */
function buildServer(analyticsProvider?: any, protocol: any = mockProtocol()) {
  const server = mockServer();
  const rest = new RestServer(
    server as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    analyticsProvider,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'));
  return { route, rest };
}

describe('POST /analytics/dataset/query', () => {
  it('registers the route', () => {
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }));
    expect(route).toBeTruthy();
    expect(route!.metadata?.tags).toContain('analytics');
  });

  it('runs an inline dataset through the analytics service and returns rows', async () => {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [{ region: 'NA', revenue: 100 }], fields: [] });
    const { route } = buildServer(async () => ({ queryDataset }));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ rows: [{ region: 'NA', revenue: 100 }], fields: [] });
    // dataset was schema-validated before reaching the service
    const passedDataset = queryDataset.mock.calls[0][0];
    expect(passedDataset.measures[0].name).toBe('revenue');
    expect(queryDataset.mock.calls[0][1]).toEqual(selection);
  });

  it('returns 501 when no analytics service is configured', async () => {
    const { route } = buildServer(undefined);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection } } as any, res);
    expect(res.statusCode).toBe(501);
    expect(res.body.code).toBe('NOT_IMPLEMENTED');
  });

  it('returns 400 when selection.measures is missing/empty', async () => {
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection: { dimensions: ['region'] } } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 for an invalid dataset definition', async () => {
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }));
    const res = mockRes();
    const bad = { ...inlineDataset, measures: [{ name: 'x', aggregate: 'not_a_real_agg' }] };
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: bad, selection } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  // ── saved datasets (`datasetName`) ─────────────────────────────────────────
  // Every case above passes the dataset INLINE, which is why the read path
  // below shipped broken: `getMetaItems` stamps the read-time `_diagnostics`
  // verdict onto every served item, and `DatasetSchema` is closed (#4001), so
  // the strict re-parse rejected our own decoration and answered 400 "Invalid
  // dataset definition." for every saved dataset — i.e. every dashboard widget.
  it('resolves a saved dataset by name and strips read decorations before parsing', async () => {
    const served = {
      ...inlineDataset,
      _packageId: 'com.example.showcase',
      _diagnostics: { valid: true },
    };
    const protocol = { ...mockProtocol(), getMetaItems: vi.fn().mockResolvedValue({ items: [served] }) };
    const queryDataset = vi.fn().mockResolvedValue({ rows: [{ region: 'NA', revenue: 100 }], fields: [] });
    const { route } = buildServer(async () => ({ queryDataset }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { datasetName: 'sales', selection } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ region: 'NA', revenue: 100 }]);
    const passed = queryDataset.mock.calls[0][0];
    expect(passed).not.toHaveProperty('_diagnostics');
    // The ADR-0010 provenance envelope is NOT a read decoration — it survives.
    expect(passed._packageId).toBe('com.example.showcase');
  });

  // The Studio dataset preview posts the draft INLINE — and that draft is the
  // document the designer GET-loaded, decorations included.
  it('strips read decorations from an INLINE dataset too', async () => {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    const { route } = buildServer(async () => ({ queryDataset }));
    const res = mockRes();
    const served = { ...inlineDataset, _diagnostics: { valid: true }, _provenance: 'package' };
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: served, selection } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(queryDataset.mock.calls[0][0]).not.toHaveProperty('_diagnostics');
  });

  // ── the localization door (#14253) ─────────────────────────────────────────
  //
  // A dataset's dimension and measure labels are drawn on the DASHBOARD, and
  // they reach it through THIS route, not through `/meta/datasets`:
  // `AnalyticsService` copies `dataset.measures[].label` onto
  // `AnalyticsResult.fields[].label` ("for legends/KPIs"). Translating only the
  // metadata read would have closed the door nobody draws through.
  //
  // The bundle is served through the SAME `II18nService` shape the `/meta`
  // routes read (`getLocales` + `getTranslations`), so this pins the wiring
  // rather than a second resolution path.
  const zhI18n = () => ({
    getLocales: () => ['zh-CN'],
    getTranslations: (locale: string) => (locale === 'zh-CN'
      ? {
        datasets: {
          sales: {
            label: '销售',
            dimensions: { region: { label: '区域' } },
            measures: { revenue: { label: '营业额' } },
          },
        },
      }
      : {}),
  });

  it('localizes a SAVED dataset before it is compiled, so measure labels reach the chart translated', async () => {
    const protocol = { ...mockProtocol(), getMetaItems: vi.fn().mockResolvedValue({ items: [{ ...inlineDataset }] }) };
    const queryDataset = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    const { route, rest } = buildServer(async () => ({ queryDataset }), protocol);
    (rest as any).resolveI18nService = async () => zhI18n();
    const res = mockRes();
    await route!.handler(
      { method: 'POST', params: {}, headers: { 'accept-language': 'zh-CN' }, body: { datasetName: 'sales', selection } } as any,
      res,
    );

    expect(res.statusCode).toBe(200);
    const passed = queryDataset.mock.calls[0][0];
    expect(passed.label).toBe('销售');
    expect(passed.measures.find((m: any) => m.name === 'revenue').label).toBe('营业额');
    expect(passed.dimensions.find((d: any) => d.name === 'region').label).toBe('区域');
    // The semantic contract is untouched — only the copy moved.
    expect(passed.object).toBe('opportunity');
    expect(passed.measures[0].aggregate).toBe('sum');
  });

  it('leaves a saved dataset alone when the request names no locale', async () => {
    const protocol = { ...mockProtocol(), getMetaItems: vi.fn().mockResolvedValue({ items: [{ ...inlineDataset }] }) };
    const queryDataset = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    const { route, rest } = buildServer(async () => ({ queryDataset }), protocol);
    (rest as any).resolveI18nService = async () => zhI18n();
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { datasetName: 'sales', selection } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(queryDataset.mock.calls[0][0].label).toBe('Sales');
  });

  // ⛔ The INLINE branch is the Studio preview posting the draft the designer
  // is editing: it carries no saved name to address a bundle entry with, and
  // overwriting its copy would misreport what is about to be saved.
  it('does NOT localize an INLINE draft, even when the bundle has an entry for that name', async () => {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    const { route, rest } = buildServer(async () => ({ queryDataset }));
    (rest as any).resolveI18nService = async () => zhI18n();
    const res = mockRes();
    await route!.handler(
      { method: 'POST', params: {}, headers: { 'accept-language': 'zh-CN' }, body: { dataset: { ...inlineDataset }, selection } } as any,
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(queryDataset.mock.calls[0][0].label).toBe('Sales');
  });

  it('returns 404 for an unknown datasetName', async () => {
    const protocol = { ...mockProtocol(), getMetaItems: vi.fn().mockResolvedValue({ items: [] }) };
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { datasetName: 'nope', selection } } as any, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('still rejects a saved dataset that is genuinely malformed', async () => {
    const served = { ...inlineDataset, measures: [{ name: 'x', aggregate: 'not_a_real_agg' }], _diagnostics: { valid: false } };
    const protocol = { ...mockProtocol(), getMetaItems: vi.fn().mockResolvedValue({ items: [served] }) };
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { datasetName: 'sales', selection } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('maps a dataset D-C compile error to 400 (undeclared relationship)', async () => {
    // [#5367] The refusal now arrives in the ADR-0112 envelope
    // (`dataset-compiler`'s `datasetInvalidError`) instead of as a bare `Error`
    // classified by the route's message list — that list's five dataset entries
    // were deleted once their producers carried the envelope. The outward answer
    // is unchanged; what changed is which branch produces it.
    const queryDataset = vi.fn().mockRejectedValue(
      Object.assign(
        new Error("dimension \"region\" references relationship \"account\" via \"account.region\", but \"account\" is not declared in the dataset's `include`."),
        { code: 'DATASET_INVALID', status: 400 },
      ),
    );
    const { route } = buildServer(async () => ({ queryDataset }));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('DATASET_INVALID');
  });
});
