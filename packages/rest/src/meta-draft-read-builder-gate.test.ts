// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20338] A PENDING draft — unpublished authoring work — is read only by a
 * caller with an authoring capability: the check `GET /meta/_drafts` has asked
 * since #6599 (`isObjectSchemaMaskExempt`: `studio.access`, `setup.access`,
 * `manage_metadata`, or a system caller).
 *
 * ## The defect
 *
 * Three texts declare that gate — the #9741 ruling (「declaration ≠
 * authorization … draft access stays admin-gated upstream」), ADR-0106 D4
 * (「draft/preview reads are admin-gated upstream already」) and ADR-0037's
 * Risks row (「confirm/add a builder/admin role gate on the dispatcher
 * reads」) — and only `/meta/_drafts` enforced it. Every other door that asks
 * the protocol for draft content served it to any member who may open the
 * item: the plain read's `?state=draft` and `?preview=draft`, the list's
 * `?preview=draft`, and the dataset preview's `previewDrafts`.
 *
 * ## What a caller without the capability is answered
 *
 * Not a refusal. The door answers what it answers WITHOUT the draft switch:
 * the published version, pruned for that caller exactly as the plain read
 * prunes it — and for a name with nothing published, that door's own absence.
 * The answer is byte-identical to a read that never named the switch, so it
 * tells a member nothing about whether a draft exists (not even `NO_DRAFT`).
 * `/meta/_drafts` keeps its 403: it lists drafts only, and has no published
 * answer to fall back to.
 *
 * ## Builders unchanged
 *
 * A caller with the capability reads exactly what they read before: the draft,
 * whole for whoever may save the app on `?state=draft` (#20290, pinned in
 * `meta-draft-read-author-exemption.test.ts`), pruned per caller otherwise.
 * Each door below carries that control.
 *
 * ## Why this file boots the real stack
 *
 * The draft rows, the overlay and `NO_DRAFT` are the protocol's. A mock could
 * only assert what REST handed it; here the answers are the real ones: a
 * better-sqlite3 `:memory:` engine, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes. The stubs are the
 * auth boundary (`resolveExecCtx`), the service probe that says `tenancy` is
 * off here, and the analytics service (a spy on what the dataset door hands
 * `queryDataset`). The census of every draft-reading door, so a new one cannot
 * arrive ungated, is `meta-draft-read-door-census.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
    SysMetadata,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
} from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';

const CALLERS = {
    /** Seeds the published items: no principal, the machine-write shape. */
    system: { isSystem: true },
    /** May open the app; holds no authoring capability. */
    member: { userId: 'u_member', systemPermissions: [] as string[] },
    /** The three authoring capabilities `/meta/_drafts` admits, one each. */
    studioBuilder: { userId: 'u_studio', systemPermissions: ['studio.access'] },
    setupAdmin: { userId: 'u_setup', systemPermissions: ['setup.access'] },
    author: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
} as const;
type CallerName = keyof typeof CALLERS;
const BUILDERS = ['studioBuilder', 'setupAdmin', 'author'] as const satisfies readonly CallerName[];

/** Published, with a pending draft that relabels it and adds an entry that exists ONLY in the draft. */
const ATLAS = {
    name: 'atlas',
    label: 'Atlas',
    navigation: [
        { id: 'nav_leads', type: 'page', label: 'Leads', pageName: 'leads_home' },
        { id: 'nav_finance_ledger', type: 'page', label: 'Ledger', pageName: 'ledger', requiredPermissions: ['finance.access'] },
    ],
};
const ATLAS_DRAFT = {
    ...ATLAS,
    label: 'Atlas (draft)',
    navigation: [...ATLAS.navigation, { id: 'nav_atlas_launch_plan', type: 'page', label: 'Launch plan', pageName: 'launch_plan' }],
};
/** Never published: a draft row and nothing else. */
const BEACON_DRAFT = {
    name: 'beacon',
    label: 'Beacon',
    navigation: [{ id: 'nav_beacon_home', type: 'page', label: 'Home', pageName: 'beacon_home' }],
};
/** Published, with no pending draft at all. */
const QUIET = {
    name: 'quiet',
    label: 'Quiet',
    navigation: [{ id: 'nav_quiet_home', type: 'page', label: 'Home', pageName: 'quiet_home' }],
};

const DATASET = {
    name: 'revenue',
    label: 'Revenue',
    object: 'opportunity',
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
};
const DATASET_DRAFT = { ...DATASET, label: 'Revenue (draft)' };
const DATASET_DRAFT_ONLY = { ...DATASET, name: 'pipeline', label: 'Pipeline' };

/** The strings that exist ONLY in pending drafts: a member must never receive one. */
const DRAFT_ONLY_TEXT = ['Atlas (draft)', 'nav_atlas_launch_plan', 'Beacon', 'nav_beacon_home'];

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

function createMockServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => {}, close: async () => {},
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {}; res.write = () => true;
    return res;
}

const META = '/api/v1/meta';

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    // The datasets' base object: a dataset naming an object this stack does not
    // define is refused at save time.
    engine.registry.registerObject({
        name: 'opportunity',
        label: 'Opportunity',
        fields: {
            region: { type: 'text', label: 'Region' },
            amount: { type: 'number', label: 'Amount' },
        },
    } as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest: any = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    let caller: CallerName = 'system';
    rest.resolveExecCtx = async () => ({ ...CALLERS[caller] });
    // ADR-0057 D10 — `tenancy` is an optional service this deployment lacks.
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
    // The dataset door's analytics service: a spy on what the door hands it.
    const queryDataset = vi.fn(async () => ({ rows: [], fields: [] }));
    rest.analyticsServiceProvider = async () => ({ queryDataset });
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`${method} ${path} is not registered`);
        return found;
    };
    const as = async (who: CallerName, method: string, routePath: string, req: Record<string, unknown>) => {
        caller = who;
        const res = makeRes();
        await route(method, routePath).handler({ method, headers: {}, query: {}, params: {}, ...req }, res);
        return res;
    };

    /** `GET /meta/:type/:name` — the plain read and its two draft switches. */
    const item = (who: CallerName, type: string, name: string, query: Record<string, string> = {}) =>
        as(who, 'GET', `${META}/:type/:name`, { path: `${META}/${type}/${name}`, params: { type, name }, query });
    /** `GET /meta/:type` — the list. */
    const list = (who: CallerName, type: string, query: Record<string, string> = {}) =>
        as(who, 'GET', `${META}/:type`, { path: `${META}/${type}`, params: { type }, query });
    /** `GET /meta/_drafts` — the door whose predicate every other draft door now asks. */
    const drafts = (who: CallerName) => as(who, 'GET', `${META}/_drafts`, { path: `${META}/_drafts` });
    /** `POST /analytics/dataset/query`. */
    const datasetQuery = (who: CallerName, body: Record<string, unknown>, query: Record<string, string> = {}) =>
        as(who, 'POST', '/api/v1/analytics/dataset/query', { path: '/api/v1/analytics/dataset/query', body, query });
    const save = async (type: string, item: { name: string }, query: Record<string, string>) => {
        const res = await as('system', 'PUT', `${META}/:type/:name`, {
            path: `${META}/${type}/${item.name}`, params: { type, name: item.name }, query, body: item,
        });
        if (res.statusCode !== 200) throw new Error(`seeding ${type}/${item.name} failed: ${JSON.stringify(res.body)}`);
    };

    await save('app', ATLAS, {});
    await save('app', ATLAS_DRAFT, { mode: 'draft' });
    await save('app', BEACON_DRAFT, { mode: 'draft' });
    await save('app', QUIET, {});
    await save('dataset', DATASET, {});
    await save('dataset', DATASET_DRAFT, { mode: 'draft' });
    await save('dataset', DATASET_DRAFT_ONLY, { mode: 'draft' });

    return { item, list, drafts, datasetQuery, queryDataset };
}

const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);
const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.error?.code ?? res.body?.code });
const text = (res: any): string => JSON.stringify(res.body ?? null);
const listed = (res: any): any[] => (Array.isArray(res.body) ? res.body : (res.body?.items ?? []));

/** The draft switches of the plain read, alone and together. */
const ITEM_SWITCHES: Record<string, Record<string, string>> = {
    '?state=draft': { state: 'draft' },
    '?preview=draft': { preview: 'draft' },
    '?state=draft&preview=draft': { state: 'draft', preview: 'draft' },
};

describe('[#20338] GET /meta/:type/:name — ?state=draft and ?preview=draft', () => {
    for (const [label, query] of Object.entries(ITEM_SWITCHES)) {
        it(`${label}: a member without an authoring capability reads the PUBLISHED app — the plain read's answer, byte for byte`, async () => {
            const { item } = await boot();
            const plain = await item('member', 'app', 'atlas');
            const res = await item('member', 'app', 'atlas', query);

            expect(plain.statusCode).toBe(200);
            expect(res.statusCode).toBe(200);
            expect(res.body?.item?.label).toBe('Atlas');
            expect(res.body).toEqual(plain.body);
            for (const s of DRAFT_ONLY_TEXT) expect(text(res)).not.toContain(s);
        }, 60_000);

        it(`${label}: a draft-only app answers the member the plain read's absence — 404, never the draft`, async () => {
            const { item } = await boot();
            const plain = await item('member', 'app', 'beacon');
            const res = await item('member', 'app', 'beacon', query);

            expect(envelope(plain)).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
            expect(envelope(res)).toEqual(envelope(plain));
            expect(res.body).toEqual(plain.body);
            for (const s of DRAFT_ONLY_TEXT) expect(text(res)).not.toContain(s);
        }, 60_000);

        it(`${label}: every builder reads the draft (the control) — Studio, Setup and a metadata author alike`, async () => {
            const { item } = await boot();
            for (const who of BUILDERS) {
                const res = await item(who, 'app', 'atlas', query);
                expect(res.statusCode, who).toBe(200);
                expect(res.body?.item?.label, who).toBe('Atlas (draft)');
                expect(navIds(res.body?.item), who).toContain('nav_atlas_launch_plan');

                const draftOnly = await item(who, 'app', 'beacon', query);
                expect(draftOnly.statusCode, who).toBe(200);
                expect(draftOnly.body?.item?.label, who).toBe('Beacon');
            }
        }, 60_000);
    }

    it('?state=draft tells a member nothing about whether a draft exists: an app with none answers the same published read, never NO_DRAFT', async () => {
        const { item } = await boot();
        const plain = await item('member', 'app', 'quiet');
        const res = await item('member', 'app', 'quiet', { state: 'draft' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(plain.body);
        // The control: a builder is still told there is no pending draft.
        const builder = await item('studioBuilder', 'app', 'quiet', { state: 'draft' });
        expect(envelope(builder)).toEqual({ status: 404, code: 'NO_DRAFT' });
    }, 60_000);
});

describe('[#20338] GET /meta/:type — ?preview=draft', () => {
    it('a member reads the published list — the plain list, byte for byte: no draft-only item, no draft label', async () => {
        const { list } = await boot();
        const plain = await list('member', 'app');
        const res = await list('member', 'app', { preview: 'draft' });

        expect(plain.statusCode).toBe(200);
        expect(res.statusCode).toBe(200);
        expect(listed(res).map((a: any) => a.name).sort()).toEqual(['atlas', 'quiet']);
        expect(res.body).toEqual(plain.body);
        for (const s of DRAFT_ONLY_TEXT) expect(text(res)).not.toContain(s);
    }, 60_000);

    it('every builder reads the draft overlay (the control): the pending draft wins, and the draft-only app is listed', async () => {
        const { list } = await boot();
        for (const who of BUILDERS) {
            const res = await list(who, 'app', { preview: 'draft' });
            expect(res.statusCode, who).toBe(200);
            const byName = new Map(listed(res).map((a: any) => [a.name, a]));
            expect(byName.get('atlas')?.label, who).toBe('Atlas (draft)');
            expect(byName.get('beacon')?.label, who).toBe('Beacon');
        }
    }, 60_000);
});

describe('[#20338] POST /analytics/dataset/query — previewDrafts', () => {
    const selection = { measures: ['total'] };
    const SWITCHES: Array<[string, Record<string, unknown>, Record<string, string>]> = [
        ['body previewDrafts: true', { previewDrafts: true }, {}],
        ['?preview=draft', {}, { preview: 'draft' }],
    ];

    for (const [label, bodyFlag, query] of SWITCHES) {
        it(`${label}: a member's query runs over the PUBLISHED dataset and never asks for draft rows`, async () => {
            const { datasetQuery, queryDataset } = await boot();
            const res = await datasetQuery('member', { datasetName: 'revenue', selection, ...bodyFlag }, query);

            expect(res.statusCode).toBe(200);
            expect(queryDataset).toHaveBeenCalledTimes(1);
            const [dataset, , , options] = queryDataset.mock.calls[0] as unknown as [any, unknown, unknown, unknown];
            expect(dataset.label).toBe('Revenue');
            expect(options).toBeUndefined();
        }, 60_000);

        it(`${label}: a draft-only dataset answers the member the door's own 404, and nothing is queried`, async () => {
            const { datasetQuery, queryDataset } = await boot();
            const res = await datasetQuery('member', { datasetName: 'pipeline', selection, ...bodyFlag }, query);

            expect(envelope(res)).toEqual({ status: 404, code: 'NOT_FOUND' });
            expect(queryDataset).not.toHaveBeenCalled();
        }, 60_000);

        it(`${label}: an INLINE dataset posted by a member runs over live data, never the pending seed draft's rows`, async () => {
            const { datasetQuery, queryDataset } = await boot();
            const res = await datasetQuery('member', { dataset: { ...DATASET }, selection, ...bodyFlag }, query);

            expect(res.statusCode).toBe(200);
            expect((queryDataset.mock.calls[0] as unknown as unknown[])[3]).toBeUndefined();
        }, 60_000);

        it(`${label}: every builder's query runs over the draft dataset, with the draft rows asked for (the control)`, async () => {
            const { datasetQuery, queryDataset } = await boot();
            for (const who of BUILDERS) {
                queryDataset.mockClear();
                const res = await datasetQuery(who, { datasetName: 'revenue', selection, ...bodyFlag }, query);
                expect(res.statusCode, who).toBe(200);
                const [dataset, , , options] = queryDataset.mock.calls[0] as unknown as [any, unknown, unknown, unknown];
                expect(dataset.label, who).toBe('Revenue (draft)');
                expect(options, who).toEqual({ previewDrafts: true });

                const draftOnly = await datasetQuery(who, { datasetName: 'pipeline', selection, ...bodyFlag }, query);
                expect(draftOnly.statusCode, who).toBe(200);
            }
        }, 60_000);
    }
});

describe('[#20338] one predicate: every draft door admits exactly the callers GET /meta/_drafts admits', () => {
    it('for each caller, /meta/_drafts refuses them 403 exactly when the item, list and dataset doors serve them the published version', async () => {
        const { item, list, drafts, datasetQuery, queryDataset } = await boot();
        for (const who of ['member', ...BUILDERS] as const) {
            const listing = await drafts(who);
            const admitted = listing.statusCode !== 403;
            if (!admitted) expect(envelope(listing), who).toEqual({ status: 403, code: 'FORBIDDEN' });
            else expect(listing.statusCode, who).toBe(200);

            const state = await item(who, 'app', 'atlas', { state: 'draft' });
            const preview = await item(who, 'app', 'atlas', { preview: 'draft' });
            const listPreview = await list(who, 'app', { preview: 'draft' });
            queryDataset.mockClear();
            await datasetQuery(who, { datasetName: 'revenue', selection: { measures: ['total'] }, previewDrafts: true });
            const dataset = (queryDataset.mock.calls[0] as unknown as [any])[0];

            const sawDraft = [
                state.body?.item?.label === 'Atlas (draft)',
                preview.body?.item?.label === 'Atlas (draft)',
                listed(listPreview).some((a: any) => a.name === 'beacon'),
                dataset?.label === 'Revenue (draft)',
            ];
            expect(sawDraft, who).toEqual([admitted, admitted, admitted, admitted]);
        }
        // The member is the one caller refused.
        expect(envelope(await drafts('member'))).toEqual({ status: 403, code: 'FORBIDDEN' });
    }, 60_000);
});
