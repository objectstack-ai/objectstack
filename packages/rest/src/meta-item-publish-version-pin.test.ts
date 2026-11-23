// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36601] The published layer serves a version a Studio Save can pin, and
 * the per-item publish refuses a stale one.
 *
 * Studio's Save is a draft save followed by that one item's publish
 * (`PUT ?mode=draft`, then `POST /publish`), so it leaves no draft behind. The
 * draft guard pins drafts only: two editors who opened one object with no
 * pending draft each asserted "no draft" (`If-None-Match: *`), and the later
 * Save published over the earlier one in silence. Here:
 *
 *  - the `/layers` read Studio loads from answers `overlayVersion`, the keyed
 *    token of the active stored row at its address (`null` when none);
 *  - `POST /publish` takes that token as `If-Match` (or `If-None-Match: *`,
 *    "no active row here") and refuses a stale one `409 METADATA_CONFLICT`,
 *    with the current token as `currentVersion`, promoting nothing;
 *  - a publish that names no version is unpinned, as before.
 *
 * Driven at the HTTP door on the real stack — a better-sqlite3 `:memory:`
 * engine, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes — because the claim
 * is about what each request did to the store. The stub is the auth boundary.
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * `dist/`: rebuild it before reading a result here after touching it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { GetMetaItemLayeredResponseSchema, MetadataConflictErrorSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server.js';

const TEST_PACKAGE_ID = 'objectstack-test';
const META = '/api/v1/meta';
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const view = (label: string) => ({
    name: 'case_grid',
    label,
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
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

    /** `GET /meta/view/case_grid/layers` — the read Studio's designers load from. */
    const layers = (type = item.type, name = item.name) =>
        call('GET', `${META}/:type/:name/layers`, { path: `${META}/${type}/${name}/layers`, params: { type, name } });
    /** `GET /meta/view/case_grid` — the plain read. */
    const read = () => call('GET', `${META}/:type/:name`, { path, params: item });
    /** `PUT /meta/view/case_grid` — active unless `mode: 'draft'`. */
    const save = (body: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
        call('PUT', `${META}/:type/:name`, { path, params: item, query, headers, body });
    /** `POST /meta/view/case_grid/publish`. */
    const publish = (headers: Record<string, string> = {}) =>
        call('POST', `${META}/:type/:name/publish`, { path: `${path}/publish`, params: item, headers, body: {} });
    /** One Studio Save: the draft over "no draft", then that item's publish, pinned as given. */
    const studioSave = async (label: string, publishHeaders: Record<string, string> = {}) => {
        ok(await save(view(label), { mode: 'draft' }, { 'if-none-match': '*' }));
        return publish(publishHeaders);
    };

    /** The stored rows of the item, by lifecycle — the store, not the door's word for it. */
    const stored = async (state: 'active' | 'draft') => {
        const rows = await engine.find('sys_metadata', { where: { type: 'view', name: 'case_grid', state } });
        return (rows ?? []).map((r: any) => JSON.parse(String(r.metadata)).label as string);
    };

    return { layers, read, save, publish, studioSave, stored };
}

const ok = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    return res.body;
};

const refusedConflict = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('METADATA_CONFLICT');
    return res.body;
};

describe('[#36601] two Studio Saves over one published item', () => {
    it('control: unpinned, the later Save publishes over the earlier one (last writer wins, as before)', async () => {
        const h = await boot();
        ok(await h.save(view('live')));

        // A and B open the item; neither has a draft.
        ok(await h.studioSave('by A'));
        ok(await h.studioSave('by B'));

        expect(await h.stored('active')).toEqual(['by B']);
        expect(await h.stored('draft')).toEqual([]);
    }, 60_000);

    it('pinned to what each loaded: the second Save is refused 409, A\'s change stays live, nothing of B\'s is promoted', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const loadedA = ok(await h.layers()).overlayVersion;
        const loadedB = ok(await h.layers()).overlayVersion;
        expect(loadedA).toMatch(KEYED);
        expect(loadedB).toBe(loadedA);

        const won = ok(await h.studioSave('by A', { 'if-match': loadedA }));
        const lost = refusedConflict(await h.studioSave('by B', { 'if-match': loadedB }));

        expect(await h.stored('active')).toEqual(['by A']);
        // B's draft stays a draft: Studio takes it back (reload) or re-sends (overwrite).
        expect(await h.stored('draft')).toEqual(['by B']);
        // The refusal names the token A's publish left, which the next read serves.
        expect(lost.currentVersion).toBe(won.version);
        expect(ok(await h.layers()).overlayVersion).toBe(lost.currentVersion);
        expect(MetadataConflictErrorSchema.parse(lost).currentVersion).toBe(won.version);

        // "Overwrite": B re-sends pinned to the refusal's version and is accepted.
        const overwritten = ok(await h.publish({ 'if-match': lost.currentVersion }));
        expect(await h.stored('active')).toEqual(['by B']);
        expect(await h.stored('draft')).toEqual([]);
        expect(ok(await h.layers()).overlayVersion).toBe(overwritten.version);
    }, 60_000);

    it('the token is one token: `/layers`, the plain read and the publish receipt agree', async () => {
        const h = await boot();
        const created = ok(await h.save(view('live')));
        const lay = ok(await h.layers());
        expect(lay.overlayVersion).toBe(created.version);
        expect(ok(await h.read()).version).toBe(created.version);
        // Declared: the spec's layered schema keeps it through a parse.
        expect(GetMetaItemLayeredResponseSchema.parse(lay).overlayVersion).toBe(created.version);

        const published = ok(await h.studioSave('next', { 'if-match': lay.overlayVersion }));
        expect(ok(await h.layers()).overlayVersion).toBe(published.version);
    }, 60_000);

    it('no active row: `/layers` serves `null`, `If-None-Match: *` pins the first publish, and a second such publish is refused', async () => {
        const h = await boot();
        // A never-published item: its draft is the one layer behind the name.
        ok(await h.save(view('first'), { mode: 'draft' }, { 'if-none-match': '*' }));
        const lay = ok(await h.layers());
        expect(lay.overlayVersion).toBeNull();
        expect(GetMetaItemLayeredResponseSchema.parse(lay).overlayVersion).toBeNull();

        const first = ok(await h.publish({ 'if-none-match': '*' }));
        const again = refusedConflict(await h.studioSave('second', { 'if-none-match': '*' }));
        expect(again.currentVersion).toBe(first.version);
        expect(MetadataConflictErrorSchema.parse(again).currentVersion).toBe(first.version);
        expect(await h.stored('active')).toEqual(['first']);
        expect(await h.stored('draft')).toEqual(['second']);
    }, 60_000);

    it('a token that names no current version (a raw guess) is refused 409 and promotes nothing', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const refused = refusedConflict(await h.studioSave('guess', { 'if-match': 'hmac-sha256:' + '0'.repeat(64) }));
        expect(refused.currentVersion).toBe(ok(await h.layers()).overlayVersion);
        expect(await h.stored('active')).toEqual(['live']);
    }, 60_000);
});

describe('[#36601] the publish door\'s precondition headers, as the save door reads them', () => {
    const REFUSED_PINS: Record<string, Record<string, string>> = {
        'beside If-Match': { 'if-match': 'hmac-sha256:anything', 'if-none-match': '*' },
        'an entity-tag': { 'if-none-match': '"abc"' },
    };
    for (const [label, headers] of Object.entries(REFUSED_PINS)) {
        it(`${label}: refused 400 VALIDATION_ERROR, nothing promoted`, async () => {
            const h = await boot();
            ok(await h.save(view('live')));
            ok(await h.save(view('pending'), { mode: 'draft' }));
            const res = await h.publish(headers);
            expect(res.statusCode, JSON.stringify(res.body)).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(await h.stored('active')).toEqual(['live']);
            expect(await h.stored('draft')).toEqual(['pending']);
        }, 60_000);
    }
});

