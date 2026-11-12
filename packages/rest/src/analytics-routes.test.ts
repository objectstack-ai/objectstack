// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
// The server under test reaches `@objectstack/objectql` only through a dynamic
// import inside a handler (`meta-object-state-routes.ts`), so the first case to
// call one would pay that module graph's load inside its clocked window. This
// module-top import pays it during collection instead.
import '@objectstack/objectql';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation, publishedItemReader } from '@objectstack/metadata-protocol';
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

  it('a refusal told apart by SHAPE (another copy of the class) is still 409, never the 503 of a failed read', async () => {
    // A plain object of the shape the `/meta` dispatcher also reads.
    const plain = { code: 'RESOURCE_CONFLICT', message: twoHolders().message, refusal: { ...twoHolders().refusal } };
    expect(plain).not.toBeInstanceOf(PackageScopedNameRefusedError);
    const protocol = { ...mockProtocol(), getMetaItem: vi.fn().mockRejectedValue(plain) };
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

// ── [#32310, ADR-0150 D3] the caller arm: `?callerPackage=` ─────────────────
// The dashboard, report or chart of package P names a saved dataset FROM P:
// P's own dataset, else the unique holder in P's declared closure plus `sys`,
// else `409 RESOURCE_CONFLICT` naming the candidates. Driven over the real
// `ObjectStackProtocolImplementation` and the real `SchemaRegistry` (no
// stubbed resolver); only the analytics service is a double, and it is handed
// the resolved dataset.
//
// BASE (main 351c22c9): the door had no closed query set, so
// `?callerPackage=` was dropped and the bare read answered (200), and
// `?package=P` for a dataset only P's dependency holds answered 409.
describe('[#32310] POST /analytics/dataset/query?callerPackage= — the dataset resolves from the reader\'s package', () => {
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  const C = 'com.acme.gamma';
  const P = 'com.acme.app';
  let registry: InstanceType<typeof SchemaRegistry>;
  let protocol: InstanceType<typeof ObjectStackProtocolImplementation>;

  const ship = (name: string, packageId: string) => registry.registerItem('dataset', {
    name, label: `${packageId.split('.').pop()} ${name}`, object: `${packageId.split('.').pop()}_item`,
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
  }, 'name' as never, packageId);
  const send = async (query: Record<string, unknown>, datasetName = 'sales') => {
    const queryDataset = vi.fn(async (dataset: any) => ({ rows: [], fields: [], object: dataset.object }));
    const { route } = buildServer(async () => ({ queryDataset }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, query, headers: {}, body: { datasetName, selection: { measures: ['revenue'] } } } as any, res);
    const body = res.body;
    return { status: res.statusCode as number, body, queryDataset, code: body?.code ?? body?.error?.code, message: String(body?.message ?? body?.error?.message ?? '') };
  };

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    for (const id of [A, B, C]) registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! } as never, 'code');
    registry.installPackage({
      id: P, name: P, version: '1.0.0', type: 'app', namespace: 'app', dependencies: { [A]: '^1.0.0', [B]: '^1.0.0' },
    } as never, 'code');
    const engine = {
      registry,
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue([]),
    };
    protocol = new ObjectStackProtocolImplementation(engine as never);
  });

  it('P\'s own dataset runs, though a dependency holds the name too', async () => {
    ship('sales', A);
    ship('sales', P);
    const answer = await send({ callerPackage: P });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.object).toBe('app_item');
  });

  it('a dataset only a dependency of P holds runs for P (`?package=P` refuses it)', async () => {
    ship('sales', A);
    const answer = await send({ callerPackage: P });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.object).toBe('alpha_item');
    expect(answer.queryDataset.mock.calls[0][0].label).toBe('alpha sales');
    const exact = await send({ package: P });
    expect([exact.status, exact.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(exact.queryDataset).not.toHaveBeenCalled();
  });

  it('two holders in P\'s closure: 409 naming both, nothing run', async () => {
    ship('sales', A);
    ship('sales', B);
    const answer = await send({ callerPackage: P });
    expect([answer.status, answer.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(answer.message).toContain(`package "${A}"`);
    expect(answer.message).toContain(`package "${B}"`);
    expect(answer.queryDataset).not.toHaveBeenCalled();
  });

  it('a holder outside P\'s closure: 409 naming it, nothing run', async () => {
    ship('sales', C);
    const answer = await send({ callerPackage: P });
    expect([answer.status, answer.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(answer.message).toContain(`held outside the declared dependency closure of package "${P}"`);
    expect(answer.message).toContain(`package "${C}"`);
    expect(answer.queryDataset).not.toHaveBeenCalled();
  });

  it('an uninstalled caller package answers what `?package=` naming it answers, never the bare read', async () => {
    ship('sales', A);
    const viaArm = await send({ callerPackage: 'com.acme.ghost' });
    const viaQualifier = await send({ package: 'com.acme.ghost' });
    expect([viaArm.status, viaArm.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(viaArm.body).toEqual(viaQualifier.body);
    expect(viaArm.queryDataset).not.toHaveBeenCalled();
    const missing = await send({ callerPackage: 'com.acme.ghost' }, 'nowhere');
    expect([missing.status, missing.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('refused 400 beside `?package=`, blank, and repeated; each sentence names both parameters, nothing run', async () => {
    ship('sales', A);
    for (const query of [
      { callerPackage: P, package: A }, { callerPackage: '' }, { callerPackage: [P, A] },
      // `all` names no package to `?package=`; read through, it was the bare read.
      { callerPackage: 'all' }, { callerPackage: { x: P } },
    ] as Record<string, unknown>[]) {
      const answer = await send(query);
      expect([answer.status, answer.code], JSON.stringify(query)).toEqual([400, 'VALIDATION_ERROR']);
      expect(answer.queryDataset).not.toHaveBeenCalled();
      if (typeof query.callerPackage === 'string') {
        expect(answer.message, JSON.stringify(query)).toContain('?callerPackage=');
        expect(answer.message, JSON.stringify(query)).toContain('?package=');
      }
    }
  });

  it('a protocol with no caller resolution fails closed: 503, nothing run', async () => {
    ship('sales', A);
    const bare = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const queryDataset = vi.fn();
    const { route } = buildServer(async () => ({ queryDataset }), bare);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, query: { callerPackage: P }, headers: {}, body: { datasetName: 'sales', selection } } as any, res);
    expect(res.statusCode).toBe(503);
    expect(bare.getMetaItem).not.toHaveBeenCalled();
    expect(queryDataset).not.toHaveBeenCalled();
  });

  // [#32310, seat ruling M2] The batch door reads the arm once, from its URL,
  // for every query: a malformed arm refuses the whole batch up front; the
  // name's resolution is each query's own entry.
  const sendBatch = async (query: Record<string, unknown>, names: string[]) => {
    const queryDataset = vi.fn(async (dataset: any) => ({ rows: [], fields: [], object: dataset.object }));
    const { rest } = buildServer(async () => ({ queryDataset }), protocol);
    const batch = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query/batch'));
    const res = mockRes();
    const queries = names.map((datasetName) => ({ datasetName, selection: { measures: ['revenue'] } }));
    await batch!.handler({ method: 'POST', params: {}, query, headers: {}, body: { queries } } as any, res);
    return { status: res.statusCode as number, body: res.body, queryDataset };
  };

  it('batch: each query resolves from the URL\'s caller package, and a name it cannot resolve is that query\'s 409 entry', async () => {
    ship('sales', A);
    ship('orders', A);
    ship('orders', B);
    ship('stock', C);
    const answer = await sendBatch({ callerPackage: P }, ['sales', 'orders', 'stock', 'nowhere']);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const [dependency, ambiguous, outside, missing] = answer.body.data.results;
    expect(dependency.data.object).toBe('alpha_item');
    expect([ambiguous.status, ambiguous.error.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(ambiguous.error.message).toContain(`package "${A}"`);
    expect(ambiguous.error.message).toContain(`package "${B}"`);
    expect([outside.status, outside.error.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(outside.error.message).toContain(`package "${C}"`);
    expect([missing.status, missing.error.code]).toEqual([404, 'NOT_FOUND']);
    expect(answer.queryDataset).toHaveBeenCalledTimes(1);
    // CONTROL: without the arm the batch's bare read of a dependency's name is unchanged.
    const bare = await sendBatch({}, ['sales']);
    expect(bare.body.data.results[0]).toEqual(dependency);
  });

  it('batch: an uninstalled caller package is each query\'s `?package=` answer, and a protocol with no caller resolution is each query\'s 503', async () => {
    ship('sales', A);
    const viaArm = await sendBatch({ callerPackage: 'com.acme.ghost' }, ['sales', 'nowhere']);
    const viaQualifier = await sendBatch({ package: 'com.acme.ghost' }, ['sales', 'nowhere']);
    expect(viaArm.status).toBe(200);
    expect(viaArm.body.data.results).toEqual(viaQualifier.body.data.results);
    expect(viaArm.body.data.results.map((r: any) => r.status)).toEqual([409, 404]);
    expect(viaArm.queryDataset).not.toHaveBeenCalled();
    const bare = { ...mockProtocol(), ...savedDatasets([{ ...inlineDataset }]) };
    const queryDataset = vi.fn();
    const { rest } = buildServer(async () => ({ queryDataset }), bare);
    const batch = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query/batch'));
    const res = mockRes();
    await batch!.handler({ method: 'POST', params: {}, query: { callerPackage: P }, headers: {}, body: { queries: [{ datasetName: 'sales', selection }] } } as any, res);
    expect(res.statusCode).toBe(200);
    expect([res.body.data.results[0].status, res.body.data.results[0].error.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    expect(bare.getMetaItem).not.toHaveBeenCalled();
    expect(queryDataset).not.toHaveBeenCalled();
  });

  it('batch: a malformed arm refuses the whole batch 400 before any query runs', async () => {
    ship('sales', A);
    for (const query of [
      { callerPackage: P, package: A }, { callerPackage: '' }, { callerPackage: 'all' },
      { callerPackage: [P, A] }, { callerPackage: { x: P } },
    ] as Record<string, unknown>[]) {
      const answer = await sendBatch(query, ['sales', 'sales']);
      expect([answer.status, answer.body?.success, answer.body?.error?.code], JSON.stringify(query))
        .toEqual([400, false, 'VALIDATION_ERROR']);
      expect(answer.queryDataset).not.toHaveBeenCalled();
    }
  });

  it('CONTROL: the bare read and `?package=` answer as before', async () => {
    ship('sales', A);
    const bare = await send({});
    const exact = await send({ package: A });
    expect(bare.status).toBe(200);
    expect(bare.body.object).toBe('alpha_item');
    expect(exact.body).toEqual(bare.body);
  });
});

// ── [#32501, ADR-0150 D5] the dataset doors at an exact pair address ────────
// The single door and the batch door read a saved dataset through the protocol's
// exact read (`?package=`, and `?callerPackage=` naming a package the registry
// does not hold, which reads as `?package=` naming it), so they move with it:
// the App pair two of whose modules hold the dataset is refused naming both,
// and a disabled holder registered first no longer hides the named address's
// own enabled dataset. The publish probes' dataset read (`publishedItemReader`)
// moves only for a publishing package the registry does not hold.
//
// BASE (main 2f80f2897, measured on this harness by the contract review of
// #32808 and again here):
//  - two enabled modules of the App the only shippers, `?package=` the App pair:
//    200, the first registered module's dataset was run; with another package
//    registered ahead of the modules, already 409;
//  - `?package=A.custom`, the other holder disabled and registered first: 404;
//  - `?package=` the App pair, one module disabled and registered first: 404;
//  - `?callerPackage=` the App pair with the pair installed: already 409.
describe('#32501 — the dataset doors at an exact pair address read the package it names', () => {
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  const P = 'com.acme.suite';
  const M1 = 'com.acme.one';
  const M2 = 'com.acme.two';
  let registry: InstanceType<typeof SchemaRegistry>;
  let protocol: InstanceType<typeof ObjectStackProtocolImplementation>;

  const boot = (order: readonly string[], pairInstalled = false) => {
    registry = new SchemaRegistry({ multiTenant: false });
    registry.installPackage({ id: P, name: P, version: '1.0.0', type: 'app', namespace: 'suite' } as never, 'code');
    for (const id of order) {
      const module = id === M1 || id === M2;
      registry.installPackage({
        id, name: id, version: '1.0.0', type: module ? 'module' : 'app', namespace: id.split('.').pop()!,
        ...(module ? { dependencies: { [P]: '^1.0.0' } } : {}),
      } as never, 'code');
    }
    if (pairInstalled) {
      registry.installPackage({
        id: `${P}.custom`, name: 'suite (custom)', version: '0.1.0', type: 'module', namespace: 'suite_custom', dependencies: { [P]: '^1' },
      } as never, 'authored');
    }
    const engine = {
      registry,
      find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue([]),
    };
    protocol = new ObjectStackProtocolImplementation(engine as never);
    for (const id of order) {
      registry.registerItem('dataset', {
        name: 'sales', label: `${id.split('.').pop()} sales`, object: `${id.split('.').pop()}_item`,
        dimensions: [{ name: 'region', field: 'region', type: 'string' }],
        measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
      }, 'name' as never, id);
    }
  };
  /** One dataset query on the single door and the same query as a one-entry batch: status, code, message, the dataset run. */
  const both = async (query: Record<string, unknown>) => {
    const queryDataset = vi.fn(async (dataset: any) => ({ rows: [], fields: [], object: dataset.object }));
    const { route, rest } = buildServer(async () => ({ queryDataset }), protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, query, headers: {}, body: { datasetName: 'sales', selection: { measures: ['revenue'] } } } as any, res);
    const single = {
      status: res.statusCode as number, code: res.body?.code ?? res.body?.error?.code ?? null,
      message: String(res.body?.message ?? res.body?.error?.message ?? ''),
      ran: queryDataset.mock.calls.map((call: any[]) => call[0]?.label),
    };
    queryDataset.mockClear();
    const batchRoute = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query/batch'));
    const batchRes = mockRes();
    await batchRoute!.handler({
      method: 'POST', params: {}, query, headers: {}, body: { queries: [{ datasetName: 'sales', selection: { measures: ['revenue'] } }] },
    } as any, batchRes);
    const entry = batchRes.body?.data?.results?.[0];
    const batch = {
      status: batchRes.statusCode as number, entry: entry?.status ?? 200, code: entry?.error?.code ?? null,
      message: String(entry?.error?.message ?? ''), ran: queryDataset.mock.calls.map((call: any[]) => call[0]?.label),
    };
    return { single, batch };
  };
  const refusedNamingModules = (answer: Awaited<ReturnType<typeof both>>, what: string) => {
    expect([answer.single.status, answer.single.code, answer.single.ran], what).toEqual([409, 'RESOURCE_CONFLICT', []]);
    expect([answer.batch.status, answer.batch.entry, answer.batch.code, answer.batch.ran], what).toEqual([200, 409, 'RESOURCE_CONFLICT', []]);
    for (const id of [M1, M2]) {
      expect(answer.single.message, what).toContain(`package "${id}"`);
      expect(answer.batch.message, what).toContain(`package "${id}"`);
    }
  };
  const ran = (answer: Awaited<ReturnType<typeof both>>, label: string, what: string) => {
    expect([answer.single.status, answer.single.ran], what).toEqual([200, [label]]);
    expect([answer.batch.status, answer.batch.entry, answer.batch.ran], what).toEqual([200, 200, [label]]);
  };

  for (const pairInstalled of [false, true]) {
    it.each([['one first', [M1, M2]], ['two first', [M2, M1]]] as const)(`two enabled modules of the App the only holders (%s, pair installed: ${pairInstalled}): the App pair is refused naming both, nothing run (BASE: the first registered module's dataset ran)`, async (_order, order) => {
      boot(order, pairInstalled);
      refusedNamingModules(await both({ package: `${P}.custom` }), '?package= the App pair');
      // `?callerPackage=` the App pair: installed, the caller arm already refused it; not installed, it reads as `?package=`.
      refusedNamingModules(await both({ callerPackage: `${P}.custom` }), '?callerPackage= the App pair');
      // CONTROL — a module's own address runs its own dataset.
      ran(await both({ package: M1 }), 'one sales', '?package= a module');
    });
  }

  it.each([['alpha, then one', [A, M1, M2]], ['alpha, then two', [A, M2, M1]]] as const)('CONTROL — another package registered ahead of the modules (%s): the App pair was already refused, and still is', async (_order, order) => {
    boot(order);
    refusedNamingModules(await both({ package: `${P}.custom` }), '?package= the App pair');
  });

  it.each([['disabled first', [B, A]], ['enabled first (order control)', [A, B]]] as const)('the other holder disabled (%s): `?package=A.custom` runs A\'s dataset (BASE, disabled first: 404)', async (_order, order) => {
    boot(order);
    registry.disablePackage(B);
    ran(await both({ package: `${A}.custom` }), 'alpha sales', '?package=A.custom');
    ran(await both({ callerPackage: `${A}.custom` }), 'alpha sales', '?callerPackage=A.custom, not installed');
  });

  it.each([['disabled first', [M2, M1]], ['disabled second (order control)', [M1, M2]]] as const)('one module of the App disabled (%s): the App pair runs the enabled module\'s dataset (BASE, disabled first: 404)', async (_order, order) => {
    boot(order);
    registry.disablePackage(M2);
    ran(await both({ package: `${P}.custom` }), 'one sales', '?package= the App pair');
  });

  it.each([['one first', [M1, M2]], ['two first', [M2, M1]]] as const)('the publish probes\' dataset read (%s): a publish of the App pair the registry does not hold is refused naming both modules (BASE: the first registered module\'s dataset); registered, it was already refused', async (_order, order) => {
    boot(order);
    await expect(publishedItemReader(protocol as never, `${P}.custom`)('dataset', 'sales')).rejects.toThrow(PackageScopedNameRefusedError);
    boot(order, true);
    await expect(publishedItemReader(protocol as never, `${P}.custom`)('dataset', 'sales')).rejects.toThrow(PackageScopedNameRefusedError);
    // CONTROL — a module's publish reads its own dataset.
    expect(await publishedItemReader(protocol as never, M1)('dataset', 'sales')).toMatchObject({ label: 'one sales', _packageId: M1 });
  });
});
