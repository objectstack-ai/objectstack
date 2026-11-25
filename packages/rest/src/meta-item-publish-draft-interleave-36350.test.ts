// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MEASUREMENT (objectstack#36350) — does anything on the publish door today
 * see a draft that moved between "Save to this view"'s draft write and its
 * publish? Driven at the HTTP door on the real stack, as the sibling
 * `meta-item-publish-version-pin.test.ts` is.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

const TEST_PACKAGE_ID = 'objectstack-test';
const META = '/api/v1/meta';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const view = (label: string, extra: Record<string, unknown> = {}) => ({
    name: 'case_grid',
    label,
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
    ...extra,
});

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

function createMockServer() {
    const noop = () => {};
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {};
    res.write = () => true;
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
    engine.registry.registerObject(TASK as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest: any = new RestServer(
        createMockServer() as any,
        protocol as any,
        { api: { requireAuth: false }, metadata: { enableCache: false } } as any,
    );
    rest.resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`${method} ${path} is not registered`);
        return found;
    };
    const call = async (method: string, routePath: string, req: Record<string, unknown>) => {
        const res = makeRes();
        await route(method, routePath).handler({ method, headers: {}, query: {}, params: {}, ...req }, res);
        return res;
    };
    const item = { type: 'view', name: 'case_grid' };
    const path = `${META}/view/case_grid`;
    const layers = () =>
        call('GET', `${META}/:type/:name/layers`, { path: `${path}/layers`, params: item });
    const readDraft = () => call('GET', `${META}/:type/:name`, { path, params: item, query: { state: 'draft' } });
    const save = (body: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
        call('PUT', `${META}/:type/:name`, { path, params: item, query, headers, body });
    const publish = (headers: Record<string, string> = {}) =>
        call('POST', `${META}/:type/:name/publish`, { path: `${path}/publish`, params: item, headers, body: {} });
    const stored = async (state: 'active' | 'draft') => {
        const rows = await engine.find('sys_metadata', { where: { type: 'view', name: 'case_grid', state } });
        return (rows ?? []).map((r: any) => JSON.parse(String(r.metadata)));
    };
    return { layers, readDraft, save, publish, stored };
}

const ok = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    return res.body;
};

describe('[#36350 measurement] a draft that moves inside "Save to this view"', () => {
    it('M0 the tokens: the draft receipt token, the draft read token and the active overlayVersion', async () => {
        const h = await boot();
        const live = ok(await h.save(view('live')));
        const loaded = ok(await h.layers()).overlayVersion;
        const saveDraft = ok(await h.save(view('save to this view'), { mode: 'draft' }, { 'if-none-match': '*' }));
        const draftRead = ok(await h.readDraft());
        // eslint-disable-next-line no-console
        console.log('M0', JSON.stringify({
            activeReceipt: live.version, overlayVersion: loaded,
            draftReceipt: saveDraft.version, draftReadVersion: draftRead.version,
            layersAfterDraft: ok(await h.layers()).overlayVersion,
        }));
        // A publish pinned with the DRAFT's token, under today's meaning of If-Match:
        const pinnedToDraft = await h.publish({ 'if-match': saveDraft.version });
        // eslint-disable-next-line no-console
        console.log('M0 publish If-Match=<draft token>', pinnedToDraft.statusCode, JSON.stringify(pinnedToDraft.body));
    }, 60_000);

    it('M1 acceptance shape on main: Save pins the publish with the strongest pin main offers (active If-Match) — an interleaved updateView draft write must be refused', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const loaded = ok(await h.layers()).overlayVersion;
        // "Save to this view": the draft over no draft.
        ok(await h.save(view('save to this view'), { mode: 'draft' }, { 'if-none-match': '*' }));
        // updateView's draft branch (rename / pin / set default): read the draft, merge, write back unpinned.
        const draft = ok(await h.layers()).draft;
        ok(await h.save({ ...draft, label: 'renamed, meant as a draft' }, { mode: 'draft' }));
        // "Save to this view"'s publish, pinned to the active row it loaded.
        const res = await h.publish({ 'if-match': loaded });
        // eslint-disable-next-line no-console
        console.log('M1 publish', res.statusCode, JSON.stringify(res.body).slice(0, 300));
        // eslint-disable-next-line no-console
        console.log('M1 active after', JSON.stringify((await h.stored('active')).map((r: any) => r.label)));
        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('METADATA_CONFLICT');
        expect((await h.stored('active')).map((r: any) => r.label)).toEqual(['live']);
    }, 60_000);

    it('M2 direction B extended: updateView pinned to the draft version it read inside the window — does the pin refuse it?', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        ok(await h.save(view('save to this view'), { mode: 'draft' }, { 'if-none-match': '*' }));
        // updateView reads INSIDE the window: the draft it reads is Save's own.
        const read = ok(await h.readDraft());
        const draft = ok(await h.layers()).draft;
        const write = await h.save({ ...draft, label: 'renamed, meant as a draft' }, { mode: 'draft' }, { 'if-match': read.version });
        const res = await h.publish();
        // eslint-disable-next-line no-console
        console.log('M2 pinned updateView write', write.statusCode, '· publish', res.statusCode,
            '· active after', JSON.stringify((await h.stored('active')).map((r: any) => r.label)));
    }, 60_000);

    it('M3 no draft window at all: an ACTIVE save pinned to the loaded active row, with and without a pending draft', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const loaded = ok(await h.layers()).overlayVersion;
        // Someone's unpublished draft is pending.
        ok(await h.save(view('someone else, unreviewed'), { mode: 'draft' }, { 'if-none-match': '*' }));
        const res = await h.save(view('save to this view, active'), {}, { 'if-match': loaded });
        // eslint-disable-next-line no-console
        console.log('M3 active PUT over pending draft', res.statusCode, JSON.stringify(res.body).slice(0, 300),
            '· active', JSON.stringify((await h.stored('active')).map((r: any) => r.label)),
            '· draft', JSON.stringify((await h.stored('draft')).map((r: any) => r.label)));
        // The other author's later publish, pinned to what THEY loaded.
        const theirs = await h.publish({ 'if-match': loaded });
        // eslint-disable-next-line no-console
        console.log('M3 their pinned publish afterwards', theirs.statusCode, JSON.stringify(theirs.body).slice(0, 200));
        const stale = await h.save(view('stale active'), {}, { 'if-match': loaded });
        // eslint-disable-next-line no-console
        console.log('M3 stale active PUT', stale.statusCode, JSON.stringify(stale.body).slice(0, 200));
    }, 60_000);
});
