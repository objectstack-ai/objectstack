// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
// The server under test reaches `@objectstack/objectql` only through a dynamic
// import inside a handler (`meta-object-state-routes.ts`), so the first case to
// call one would pay that module graph's load inside its clocked window. This
// module-top import pays it during collection instead.
import '@objectstack/objectql';
import { PackageScopedNameRefusedError } from '@objectstack/core';

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
/**
 * [#32072] A protocol double's saved datasets, read the way the door reads a
 * `datasetName`: BY NAME (`getMetaItem`, the package-scoped resolver's read on
 * the real protocol), answering the `{ type, name, item }` envelope.
 */
function savedDatasets(items: any[]) {
  return {
    getMetaItem: vi.fn(async ({ name }: { name: string }) => ({ type: 'dataset', name, item: items.find((d) => d?.name === name) })),
  };
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

  // #14492 — `fields[].builtinAggregate` is relayed verbatim: the handler ends
  // in `res.json(result)` with no reshaping, so the discriminator the service
  // set is exactly what the renderer reads.
  it('relays fields[].builtinAggregate unchanged (#14492)', async () => {
    const fields = [
      { name: 'status', type: 'string', label: 'Status' },
      { name: 'count', type: 'number', builtinAggregate: 'count' },
    ];
    const queryDataset = vi.fn().mockResolvedValue({ rows: [{ status: 'active', count: 3 }], fields });
    const { route } = buildServer(async () => ({ queryDataset }));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { dataset: inlineDataset, selection } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.fields).toEqual(fields);
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
    const protocol = { ...mockProtocol(), ...savedDatasets([served]) };
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
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
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
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
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
    const protocol = { ...mockProtocol(), ...savedDatasets([]) };
    const { route } = buildServer(async () => ({ queryDataset: vi.fn() }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { datasetName: 'nope', selection } } as any, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('still rejects a saved dataset that is genuinely malformed', async () => {
    const served = { ...inlineDataset, measures: [{ name: 'x', aggregate: 'not_a_real_agg' }], _diagnostics: { valid: false } };
    const protocol = { ...mockProtocol(), ...savedDatasets([served]) };
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

// ── a FAILED saved-dataset read is not an absent dataset ─────────────────────
// The `datasetName` lookup used to swallow a throwing `getMetaItems` into an
// empty list, so a metadata-store outage answered `404 NOT_FOUND "Dataset …
// not found."`: a dashboard told its user the dataset was gone, and the
// operator read a 404 instead of an outage. The AI tool `query_dataset` answers
// the same failed read `503 SERVICE_UNAVAILABLE`; this door now agrees.
describe('POST /analytics/dataset/query — a failed saved-dataset read', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // The harness silences this package's fault log; the outage must reach it.
    vi.stubEnv('OS_REST_LOG', 'info');
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
    vi.unstubAllEnvs();
  });

  const send = async (protocol: any, datasetName = 'sales') => {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [{ region: 'NA', revenue: 100 }], fields: [] });
    const { route } = buildServer(async () => ({ queryDataset }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, headers: {}, body: { datasetName, selection } } as any, res);
    return { res, queryDataset };
  };

  it('answers 503 SERVICE_UNAVAILABLE, not 404, when the by-name read throws', async () => {
    const outage = new Error('connect ECONNREFUSED 10.0.0.7:5432');
    const protocol = { ...mockProtocol(), getMetaItem: vi.fn().mockRejectedValue(outage) };
    const { res, queryDataset } = await send(protocol);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    // The answer names the dataset and says the READ failed, never "not found".
    expect(res.body.error).toMatch(/^The dataset "sales" could not be resolved: the dataset read failed\./);
    expect(JSON.stringify(res.body)).not.toMatch(/not found/i);
    // The store's own text is withheld from the client and kept for the operator.
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    const logged = consoleError.mock.calls.flat();
    expect(logged.some((a: any) => a?.cause === outage)).toBe(true);
    expect(queryDataset).not.toHaveBeenCalled();
  });

  it('CONTROL: a read that succeeds without the name still answers 404, byte-identical', async () => {
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const { res, queryDataset } = await send(protocol, 'nope');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Dataset "nope" not found.' });
    expect(queryDataset).not.toHaveBeenCalled();
  });

  it('CONTROL: a read that finds the name is served', async () => {
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const { res, queryDataset } = await send(protocol);
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ region: 'NA', revenue: 100 }]);
    expect(queryDataset.mock.calls[0][0].name).toBe('sales');
  });

  // [#32072] Was "a protocol with no getMetaItems keeps its answer, 404". The
  // door now reads the dataset BY NAME through the package-scoped resolver; a
  // protocol with no by-name read has no resolver to ask, so it fails CLOSED
  // (503, the operator's fault), never a first match and never "not found".
  it('a protocol with no by-name read fails closed: 503 SERVICE_UNAVAILABLE, nothing run', async () => {
    const { res, queryDataset } = await send({ ...mockProtocol(), getMetaItems: vi.fn().mockResolvedValue({ items: [{ ...inlineDataset }] }) });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error).toMatch(/^The dataset "sales" could not be resolved: this deployment's metadata protocol has no by-name read\./);
    expect(queryDataset).not.toHaveBeenCalled();
  });
});

// ── [#32072, ADR-0150 D3/D5] the saved dataset is resolved by package ────────
// The door reads `datasetName` BY NAME through the protocol (on the real one,
// the package-scoped resolver's read, since `dataset` joined
// `PACKAGE_SCOPED_READ_TYPES`), never by taking the first listed item. A bare
// name is a caller with no package; `?package=X` is `/meta`'s exact qualifier,
// read through the same `metaItemPackageBinding`. The resolver itself is
// pinned in objectql (`package-scoped-e8-readers.test.ts`) and the booted
// two-package answers in dogfood (`dataset-package-scoped-readers.dogfood.test.ts`);
// this pins what the door hands the read and how it answers the refusal.
describe('[#32072] POST /analytics/dataset/query — the saved dataset is read by name, by package', () => {
  const twoHolders = () => new PackageScopedNameRefusedError({
    status: 'refused',
    reason: 'ambiguous-in-environment',
    type: 'dataset',
    name: 'sales',
    callerPackageId: null,
    candidates: [{ kind: 'package', packageId: 'com.acme.alpha' }, { kind: 'package', packageId: 'com.acme.beta' }],
    message: 'The dataset "sales" is held by 2 packages in this environment and the caller names no package: '
      + 'package "com.acme.alpha"; package "com.acme.beta". Nothing picks one of them: address it by its package.',
  });
  const send = async (protocol: any, query: Record<string, unknown> = {}) => {
    const queryDataset = vi.fn().mockResolvedValue({ rows: [{ region: 'NA', revenue: 100 }], fields: [] });
    const { route } = buildServer(async () => ({ queryDataset }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, query, headers: {}, body: { datasetName: 'sales', selection } } as any, res);
    return { res, queryDataset };
  };

  it('a bare name is read with no package: the read carries no packageId, and no list is read', async () => {
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const { res } = await send(protocol);
    expect(res.statusCode).toBe(200);
    expect(protocol.getMetaItem).toHaveBeenCalledTimes(1);
    expect(protocol.getMetaItem.mock.calls[0][0]).toEqual({ type: 'dataset', name: 'sales' });
    expect(protocol.getMetaItems).not.toHaveBeenCalled();
  });

  it('`?package=X` is handed to the read as its exact qualifier', async () => {
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const { res } = await send(protocol, { package: 'com.acme.beta' });
    expect(res.statusCode).toBe(200);
    expect(protocol.getMetaItem.mock.calls[0][0]).toEqual({ type: 'dataset', name: 'sales', packageId: 'com.acme.beta' });
  });

  it('`?package=` empty or `all` names no package, as on `/meta`', async () => {
    for (const value of ['', 'all']) {
      const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
      const { res } = await send(protocol, { package: value });
      expect(res.statusCode, value).toBe(200);
      expect(protocol.getMetaItem.mock.calls[0][0], value).toEqual({ type: 'dataset', name: 'sales' });
    }
  });

  it('a draft preview is forwarded beside the name and the qualifier', async () => {
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const queryDataset = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    const { route, rest } = buildServer(async () => ({ queryDataset }), protocol);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user', isSystem: true });
    const res = mockRes();
    await route!.handler({
      method: 'POST', params: {}, query: { package: 'com.acme.beta' }, headers: {},
      body: { datasetName: 'sales', selection, previewDrafts: true },
    } as any, res);
    expect(res.statusCode).toBe(200);
    expect(protocol.getMetaItem.mock.calls[0][0]).toEqual({
      type: 'dataset', name: 'sales', packageId: 'com.acme.beta', previewDrafts: true,
    });
  });

  it('the resolver\'s refusal answers 409 RESOURCE_CONFLICT with its sentence naming both holders; nothing is run', async () => {
    const protocol = { ...mockProtocol(), getMetaItem: vi.fn().mockRejectedValue(twoHolders()) };
    const { res, queryDataset } = await send(protocol);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('RESOURCE_CONFLICT');
    expect(res.body.message).toContain('com.acme.alpha');
    expect(res.body.message).toContain('com.acme.beta');
    expect(queryDataset).not.toHaveBeenCalled();
  });

  it('a repeated `?package=` is refused 400, naming no one package; nothing is read', async () => {
    const protocol = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const { res, queryDataset } = await send(protocol, { package: ['com.acme.alpha', 'com.acme.beta'] });
    expect(res.statusCode).toBe(400);
    expect(protocol.getMetaItem).not.toHaveBeenCalled();
    expect(queryDataset).not.toHaveBeenCalled();
  });
});
