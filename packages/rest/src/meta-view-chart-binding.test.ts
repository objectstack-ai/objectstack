// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22491 — `PUT /api/v1/meta/view/:name`, the door a Studio tenant or an MCP/AI
 * author writes through, refuses a `type: 'chart'` list view whose effective
 * binding names no dataset, on the real composition: the real `RestServer`
 * route over the real `saveMetaItem`, backed by a real `ObjectQL` + SQLite
 * `sys_metadata`.
 *
 * Before the change (measured on `origin/main` @ `e148ca98`): the flattened
 * list overlay member accepted `type: 'chart'` with no `chart` block, and an
 * `options.chart` bag holding only `chartType`.
 *
 * Refusal cases assert the ADR-0112 envelope — `code` AND `status` — and that
 * no row reached `sys_metadata`. The last case measures the READ side of the
 * narrowing on a row stored before it: served as stored, flagged in its
 * `_diagnostics`, and refused on its next save.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
    SysMetadata,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
} from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

const META_ITEM = '/api/v1/meta/:type/:name';

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
    const res: any = {
        _status: 200,
        write: () => true, end: () => {}, send: () => res, setHeader: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registerApp({
        id: 'com.objectstack.metadata-objects',
        name: 'Metadata Platform Objects',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject],
    });
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    // The route demands `manage_metadata`; the caller holds it, so a refusal
    // here is the spec door's and nothing else's.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const routeFor = (method: string) => {
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === META_ITEM);
        if (!route) throw new Error(`${method} ${META_ITEM} is not registered`);
        return route;
    };
    const call = async (method: string, name: string, body?: unknown) => {
        const res = makeRes();
        await routeFor(method).handler({ params: { type: 'view', name }, query: {}, headers: {}, body } as any, res);
        return res;
    };
    const storedRows = async (name: string) => engine.find('sys_metadata', { where: { type: 'view', name } });
    return { engine, put: (name: string, body: unknown) => call('PUT', name, body), get: (name: string) => call('GET', name), storedRows };
}

const BINDING = { chartType: 'bar', dataset: 'lead_metrics', dimensions: ['stage'], values: ['amount_sum'] };
const chartView = (name: string, extra: Record<string, unknown>) => ({
    name,
    object: 'crm_lead',
    viewKind: 'list',
    label: 'Pipeline by stage',
    type: 'chart',
    columns: ['stage', 'amount'],
    ...extra,
});

type Issue = { path?: string; code?: string; message?: string };
const issuesOf = (res: any): Issue[] => (res._json?.issues ?? []) as Issue[];

const NO_BLOCK_VERDICT =
    "This list view is `type: 'chart'` but declares no `chart` block, so it binds no dataset and there is nothing to plot.";

describe("#22491 PUT /api/v1/meta/view refuses a `type: 'chart'` list view that binds no dataset", () => {
    it('a chart view with no `chart` block: 422 INVALID_METADATA at `chart`, and nothing is stored', async () => {
        const { put, storedRows } = await boot();
        const res = await put('crm_lead.pipeline_chart', chartView('crm_lead.pipeline_chart', {}));

        expect(res._status, JSON.stringify(res._json)).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect(await storedRows('crm_lead.pipeline_chart')).toEqual([]);
        const hit = issuesOf(res).find((i) => i.path === 'chart');
        expect(hit, JSON.stringify(res._json)).toBeDefined();
        expect(hit!.message!.startsWith(NO_BLOCK_VERDICT)).toBe(true);
    });

    it('an `options.chart` bag holding only `chartType`: 422 INVALID_METADATA at the bag\'s missing keys, and nothing is stored', async () => {
        const { put, storedRows } = await boot();
        const res = await put(
            'crm_lead.pipeline_chart',
            chartView('crm_lead.pipeline_chart', { options: { chart: { chartType: 'bar' } } }),
        );

        expect(res._status, JSON.stringify(res._json)).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect(await storedRows('crm_lead.pipeline_chart')).toEqual([]);
        const paths = issuesOf(res).map((i) => i.path);
        expect(paths, JSON.stringify(res._json)).toContain('options.chart.dataset');
        expect(paths).toContain('options.chart.values');
    });

    it('the control: a chart view that binds a dataset and a measure answers 200 and is stored with its binding', async () => {
        const { put, storedRows } = await boot();
        const res = await put('crm_lead.pipeline_chart', chartView('crm_lead.pipeline_chart', { chart: BINDING }));

        expect(res._status, JSON.stringify(res._json)).toBe(200);
        const rows = await storedRows('crm_lead.pipeline_chart');
        expect(rows).toHaveLength(1);
        const stored = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
        expect(stored.chart).toEqual(BINDING);
    });

    it('a row stored before the narrowing is served as stored, flagged in `_diagnostics`, and refused on its next save', async () => {
        const { engine, put, get, storedRows } = await boot();
        // Store a valid chart view through the door, then plant a copy of its
        // row whose body lost the binding — the shape a row saved before this
        // change can carry. The door can no longer write it, so the store is
        // written directly.
        expect((await put('crm_lead.pipeline_chart', chartView('crm_lead.pipeline_chart', { chart: BINDING })))._status).toBe(200);
        const [row] = await storedRows('crm_lead.pipeline_chart');
        const body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        const { chart: _dropped, ...unbound } = { ...body, name: 'crm_lead.legacy_chart' };
        const { id: _id, ...rowData } = row;
        await engine.insert('sys_metadata', { ...rowData, name: 'crm_lead.legacy_chart', metadata: JSON.stringify(unbound) });

        const read = await get('crm_lead.legacy_chart');
        expect(read._status, JSON.stringify(read._json)).toBe(200);
        const served = read._json?.item ?? read._json?.data ?? read._json;
        expect(served.type).toBe('chart');
        expect(served).not.toHaveProperty('chart');
        expect(served._diagnostics?.valid, JSON.stringify(served._diagnostics)).toBe(false);
        expect(
            (served._diagnostics?.errors ?? []).some((e: Issue) => e.path === 'chart' && e.message?.startsWith(NO_BLOCK_VERDICT)),
            JSON.stringify(served._diagnostics),
        ).toBe(true);

        // Re-saving what was read is refused at the same path.
        const { _diagnostics: _d, ...resave } = served;
        const again = await put('crm_lead.legacy_chart', resave);
        expect(again._status, JSON.stringify(again._json)).toBe(422);
        expect(again._json?.code).toBe('INVALID_METADATA');
        expect(issuesOf(again).some((i) => i.path === 'chart')).toBe(true);
    });
});
