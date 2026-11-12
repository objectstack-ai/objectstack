// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
// The server under test reaches `@objectstack/objectql` only through a dynamic
// import inside a handler (`meta-object-state-routes.ts`), so the first case to
// call one would pay that module graph's load inside its clocked window. This
// module-top import pays it during collection instead.
import '@objectstack/objectql';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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

// ── [#32292, ADR-0150 D3 after ADR-0149 D2] the refusal arm judges admission first ──
// When the by-name read REFUSES a name, the door asks which refused holders the
// caller is admitted to before it answers (epic ruling 6766102988; seat ruling
// 6817809380): none answers what a missing name answers, byte for byte; an
// ambiguity with exactly one admitted runs that one; otherwise the 409 names
// only the admitted holders; a holder whose admission cannot be judged, when it
// could move the answer, is a 503. A hidden holder is never named.
// ⛔ Only the refusal arm (Q1 = A): a name the read resolves keeps its answer
// (queryDataset's own gates, the 403), and the caller arm never falls through
// to another package's item (Q2 = A).
//
// BASE (blocker head 6655b742): every refusal below answered 409 naming every
// holder, whatever the caller was admitted to.
// Driven over the real `ObjectStackProtocolImplementation` and `SchemaRegistry`;
// the analytics service is a double whose admission admits by the dataset's
// object, the way the real one judges the object read grant.
describe('[#32292] POST /analytics/dataset/query — a refused name is judged over the holders the caller is admitted to', () => {
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

  /**
   * The analytics double: `admitted` and `unresolved` are the objects whose
   * datasets the caller is admitted to / whose admission cannot be judged.
   */
  const service = (opts: { admitted?: string[]; unresolved?: string[]; wired?: boolean } = {}) => {
    const queryDataset = vi.fn(async (dataset: any) => ({ rows: [], fields: [], object: dataset.object }));
    const admitDatasetCatalogEntry = vi.fn(async (dataset: any) => {
      if ((opts.unresolved ?? []).includes(dataset.object)) return { admitted: false, unresolved: true };
      if ((opts.admitted ?? []).includes(dataset.object)) {
        return { admitted: true, dimensions: new Set<string>(), measures: new Set<string>(), withheld: false, unresolved: false };
      }
      return { admitted: false, unresolved: false };
    });
    return { queryDataset, admitDatasetCatalogEntry, hasPluginWiredAdmission: () => opts.wired !== false };
  };
  const send = async (svc: ReturnType<typeof service>, query: Record<string, unknown> = {}, datasetName = 'sales') => {
    const { route } = buildServer(async () => svc, protocol);
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, query, headers: {}, body: { datasetName, selection: { measures: ['revenue'] } } } as any, res);
    const body = res.body;
    return {
      status: res.statusCode as number, body, text: JSON.stringify(body),
      code: body?.code ?? body?.error?.code, message: String(body?.message ?? body?.error?.message ?? ''),
    };
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

  it('admitted to neither holder: 404 NOT_FOUND, byte-equal to the answer for a name nothing holds; neither is named, nothing run', async () => {
    const missing = await send(service());
    expect([missing.status, missing.code]).toEqual([404, 'NOT_FOUND']);
    ship('sales', A);
    ship('sales', B);
    const svc = service();
    const hidden = await send(svc);
    expect(hidden.status).toBe(missing.status);
    expect(hidden.text).toBe(missing.text);
    expect(hidden.text).not.toContain(A);
    expect(hidden.text).not.toContain(B);
    expect(svc.admitDatasetCatalogEntry).toHaveBeenCalledTimes(2);
    expect(svc.queryDataset).not.toHaveBeenCalled();
  });

  it('admitted to exactly one of two holders: that one runs, in either order, and the hidden holder is never named', async () => {
    for (const order of [[A, B], [B, A]]) {
      registry = new SchemaRegistry({ multiTenant: false });
      for (const id of [A, B]) registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! } as never, 'code');
      protocol = new ObjectStackProtocolImplementation({ registry, find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), count: vi.fn(), aggregate: vi.fn() } as never);
      for (const id of order) ship('sales', id);
      const svc = service({ admitted: ['beta_item'] });
      const answer = await send(svc);
      expect(answer.status, answer.text).toBe(200);
      expect(answer.body.object).toBe('beta_item');
      expect(svc.queryDataset).toHaveBeenCalledTimes(1);
      expect(svc.queryDataset.mock.calls[0][0].label).toBe('beta sales');
      expect(answer.text).not.toContain(A);
    }
  });

  it('admitted to two of three holders: 409 naming only those two; the hidden third is never named, nothing run', async () => {
    ship('sales', A);
    ship('sales', B);
    ship('sales', C);
    const svc = service({ admitted: ['alpha_item', 'gamma_item'] });
    const answer = await send(svc);
    expect([answer.status, answer.code], answer.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(answer.message).toContain(`package "${A}"`);
    expect(answer.message).toContain(`package "${C}"`);
    expect(answer.text).not.toContain(B);
    expect(svc.queryDataset).not.toHaveBeenCalled();
  });

  it('CONTROL: admitted to both holders: 409 naming both, as before', async () => {
    ship('sales', A);
    ship('sales', B);
    const svc = service({ admitted: ['alpha_item', 'beta_item'] });
    const answer = await send(svc);
    expect([answer.status, answer.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(answer.message).toContain(`package "${A}"`);
    expect(answer.message).toContain(`package "${B}"`);
    expect(svc.queryDataset).not.toHaveBeenCalled();
  });

  it('the caller arm: two holders in P\'s closure are judged the same way (none → 404, one → runs, never the hidden one named)', async () => {
    ship('sales', A);
    ship('sales', B);
    const missing = await send(service(), { callerPackage: P }, 'nowhere');
    const none = await send(service(), { callerPackage: P });
    expect([none.status, none.code]).toEqual([404, 'NOT_FOUND']);
    expect(none.text).toBe(missing.text.replace('nowhere', 'sales'));
    expect(none.text).not.toContain(A);
    expect(none.text).not.toContain(B);
    const one = await send(service({ admitted: ['alpha_item'] }), { callerPackage: P });
    expect(one.status, one.text).toBe(200);
    expect(one.body.object).toBe('alpha_item');
    expect(one.text).not.toContain(B);
  });

  it('outside P\'s closure and `?package=` naming a non-holder are never picked: admitted → 409 naming only the admitted, none → 404', async () => {
    ship('sales', C);
    const outside = await send(service({ admitted: ['gamma_item'] }), { callerPackage: P });
    expect([outside.status, outside.code], outside.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(outside.message).toContain(`package "${C}"`);
    const outsideHidden = await send(service(), { callerPackage: P });
    expect([outsideHidden.status, outsideHidden.code]).toEqual([404, 'NOT_FOUND']);
    expect(outsideHidden.text).not.toContain(C);
    ship('sales', A);
    const svc = service({ admitted: ['alpha_item'] });
    const notHeld = await send(svc, { package: B });
    expect([notHeld.status, notHeld.code], notHeld.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(notHeld.message).toContain(`package "${A}"`);
    expect(notHeld.text).not.toContain(C);
    expect(svc.queryDataset).not.toHaveBeenCalled();
    const notHeldHidden = await send(service(), { package: B });
    expect([notHeldHidden.status, notHeldHidden.code]).toEqual([404, 'NOT_FOUND']);
    expect(notHeldHidden.text).not.toContain(A);
    expect(notHeldHidden.text).not.toContain(C);
  });

  it('a holder whose admission cannot be judged, where it could move the answer: 503, no holder named, nothing run', async () => {
    ship('sales', A);
    ship('sales', B);
    for (const svc of [service({ unresolved: ['alpha_item'] }), service({ unresolved: ['alpha_item'], admitted: ['beta_item'] })]) {
      const answer = await send(svc);
      expect([answer.status, answer.code], answer.text).toEqual([503, 'SERVICE_UNAVAILABLE']);
      expect(answer.text).not.toContain(A);
      expect(answer.text).not.toContain(B);
      expect(svc.queryDataset).not.toHaveBeenCalled();
    }
  });

  it('a name the read resolves keeps its answer: admission is not asked, and the one holder runs into queryDataset\'s own gates', async () => {
    ship('sales', A);
    const svc = service();
    const answer = await send(svc);
    expect(answer.status).toBe(200);
    expect(svc.admitDatasetCatalogEntry).not.toHaveBeenCalled();
    expect(svc.queryDataset.mock.calls[0][0].object).toBe('alpha_item');
  });

  it('the caller arm resolved to P\'s own item never falls through to a dependency\'s item of the name', async () => {
    ship('sales', A);
    ship('sales', P);
    const svc = service({ admitted: ['alpha_item'] });
    const answer = await send(svc, { callerPackage: P });
    expect(svc.admitDatasetCatalogEntry).not.toHaveBeenCalled();
    expect(svc.queryDataset).toHaveBeenCalledTimes(1);
    expect(svc.queryDataset.mock.calls[0][0].object).toBe('app_item');
    expect(answer.body.object).toBe('app_item');
  });

  // Q1 = A and Q2 = A, measured on the refusal the real service gives: its
  // query gates refuse a caller not admitted to the dataset's object with
  // `PERMISSION_DENIED` / 403, so the double throws exactly that envelope.
  const refusing = (svc: ReturnType<typeof service>, denied: string[]) => {
    svc.queryDataset.mockImplementation(async (dataset: any) => {
      if (denied.includes(dataset.object)) {
        throw Object.assign(new Error(`Permission denied: read on ${dataset.object}`), { code: 'PERMISSION_DENIED', status: 403 });
      }
      return { rows: [], fields: [], object: dataset.object };
    });
    return svc;
  };

  it('one holder the caller is not admitted to keeps queryDataset\'s 403, never moved to 404 (Q1 = A), and admission is not asked', async () => {
    ship('sales', A);
    const svc = refusing(service(), ['alpha_item']);
    const answer = await send(svc);
    expect([answer.status, answer.code], answer.text).toEqual([403, 'PERMISSION_DENIED']);
    expect(svc.admitDatasetCatalogEntry).not.toHaveBeenCalled();
    expect(svc.queryDataset).toHaveBeenCalledTimes(1);
  });

  it('the caller arm resolved to its one closure item keeps that item\'s 403 and never falls through to a holder outside the closure (Q2 = A)', async () => {
    ship('sales', A);
    ship('sales', C);
    const svc = refusing(service({ admitted: ['gamma_item'] }), ['alpha_item']);
    const answer = await send(svc, { callerPackage: P });
    expect([answer.status, answer.code], answer.text).toEqual([403, 'PERMISSION_DENIED']);
    expect(svc.admitDatasetCatalogEntry).not.toHaveBeenCalled();
    expect(svc.queryDataset).toHaveBeenCalledTimes(1);
    expect(svc.queryDataset.mock.calls[0][0].object).toBe('alpha_item');
    expect(answer.text).not.toContain(C);
  });

  it('the caller arm: three holders in the closure, two admitted: 409 naming only those two; the hidden one is never named, nothing run', async () => {
    const P3 = 'com.acme.suite';
    registry.installPackage({
      id: P3, name: P3, version: '1.0.0', type: 'app', namespace: 'suite', dependencies: { [A]: '^1.0.0', [B]: '^1.0.0', [C]: '^1.0.0' },
    } as never, 'code');
    ship('sales', A);
    ship('sales', B);
    ship('sales', C);
    const svc = service({ admitted: ['alpha_item', 'gamma_item'] });
    const answer = await send(svc, { callerPackage: P3 });
    expect([answer.status, answer.code], answer.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(answer.message).toContain(`package "${A}"`);
    expect(answer.message).toContain(`package "${C}"`);
    expect(answer.text).not.toContain(B);
    expect(svc.queryDataset).not.toHaveBeenCalled();
  });

  it('a holder whose own exact-qualifier read refuses is undetermined: 503 on every arm, for every caller, naming no holder and running nothing', async () => {
    ship('sales', A);
    ship('sales', B);
    // A row of the name in the bare slot, beside both package holders.
    registry.registerItem('dataset', {
      name: 'sales', label: 'bare sales', object: 'bare_item',
      dimensions: [{ name: 'region', field: 'region', type: 'string' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    }, 'name' as never);
    for (const admitted of [[], ['alpha_item'], ['alpha_item', 'beta_item']]) {
      for (const query of [{}, { callerPackage: P }, { package: C }]) {
        const svc = service({ admitted });
        const answer = await send(svc, query);
        const where = `${JSON.stringify(admitted)} ${JSON.stringify(query)}: ${answer.text}`;
        expect([answer.status, answer.code], where).toEqual([503, 'SERVICE_UNAVAILABLE']);
        expect(answer.text, where).not.toContain(A);
        expect(answer.text, where).not.toContain(B);
        expect(svc.queryDataset, where).not.toHaveBeenCalled();
      }
    }
  });

  it('a holder whose own address serves nothing is undetermined where it could move the answer: 503, nothing run', async () => {
    ship('sales', A);
    ship('sales', B);
    // The exact-qualifier read of alpha comes back without an item.
    const servesNothingFor = (hidden: string) => new Proxy(protocol, {
      get(target, prop) {
        if (prop === 'getMetaItem') {
          return async (req: any) => (req?.packageId === hidden ? { item: undefined } : target.getMetaItem(req));
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const svc = service({ admitted: ['beta_item'] });
    const { route } = buildServer(async () => svc, servesNothingFor(A));
    const res = mockRes();
    await route!.handler({ method: 'POST', params: {}, query: {}, headers: {}, body: { datasetName: 'sales', selection: { measures: ['revenue'] } } } as any, res);
    const text = JSON.stringify(res.body);
    expect([res.statusCode, res.body?.code ?? res.body?.error?.code], text).toEqual([503, 'SERVICE_UNAVAILABLE']);
    expect(text).not.toContain(A);
    expect(svc.queryDataset).not.toHaveBeenCalled();
  });

  it('a refusal one of whose candidates is the environment is answered as it is: admission is not asked', async () => {
    registry.registerItem('dataset', {
      name: 'sales', label: 'bare sales', object: 'bare_item',
      dimensions: [{ name: 'region', field: 'region', type: 'string' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    }, 'name' as never);
    const svc = service();
    const answer = await send(svc, { package: A });
    expect([answer.status, answer.code], answer.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(svc.admitDatasetCatalogEntry).not.toHaveBeenCalled();
    expect(svc.queryDataset).not.toHaveBeenCalled();
  });

  it('a holder whose saved dataset does not parse counts for no caller: admitted to both objects, the other holder runs', async () => {
    ship('sales', A);
    registry.registerItem('dataset', { name: 'sales', label: 'beta sales', object: 'beta_item', measures: 'not-a-list' } as never, 'name' as never, B);
    const svc = service({ admitted: ['alpha_item', 'beta_item'] });
    const answer = await send(svc);
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.object).toBe('alpha_item');
    expect(svc.queryDataset).toHaveBeenCalledTimes(1);
    expect(answer.text).not.toContain(B);
  });

  it('a service whose admission is not the plugin-wired set is not asked: the refusal names every holder, as before', async () => {
    ship('sales', A);
    ship('sales', B);
    const svc = service({ wired: false });
    const answer = await send(svc);
    expect([answer.status, answer.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(answer.message).toContain(`package "${A}"`);
    expect(answer.message).toContain(`package "${B}"`);
    expect(svc.admitDatasetCatalogEntry).not.toHaveBeenCalled();
  });

  it('the batch door judges each query the same way: a hidden name\'s entry is byte-equal to a missing name\'s', async () => {
    ship('sales', A);
    ship('sales', B);
    ship('orders', A);
    ship('orders', B);
    const svc = service({ admitted: ['beta_item'] });
    const { rest } = buildServer(async () => svc, protocol);
    const batch = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query/batch'));
    const res = mockRes();
    const queries = ['sales', 'nowhere'].map((datasetName) => ({ datasetName, selection: { measures: ['revenue'] } }));
    await batch!.handler({ method: 'POST', params: {}, query: {}, headers: {}, body: { queries } } as any, res);
    expect(res.statusCode).toBe(200);
    const [sales, nowhere] = res.body.data.results;
    expect(sales.data.object).toBe('beta_item');
    expect(nowhere.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(A);
    const hiddenSvc = service();
    const hidden = buildServer(async () => hiddenSvc, protocol);
    const hiddenBatch = hidden.rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query/batch'));
    const res2 = mockRes();
    await hiddenBatch!.handler({ method: 'POST', params: {}, query: {}, headers: {}, body: {
      queries: [{ datasetName: 'orders', selection: { measures: ['revenue'] } }, { datasetName: 'orders_missing', selection: { measures: ['revenue'] } }],
    } } as any, res2);
    const [hiddenEntry, missingEntry] = res2.body.data.results;
    expect(JSON.stringify(hiddenEntry)).toBe(JSON.stringify(missingEntry).replace('orders_missing', 'orders'));
    expect(JSON.stringify(res2.body)).not.toContain(A);
    expect(JSON.stringify(res2.body)).not.toContain(B);
  });
});
