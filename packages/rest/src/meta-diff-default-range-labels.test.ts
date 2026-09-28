// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20397] `GET /meta/:type/:name/diff` with no `from` / `to` compares the
 * previous version with the CURRENT one, and labels each side with the version
 * whose body it is.
 *
 * ## The defect
 *
 * `diffMetaItem` read the to-side BODY from the active `sys_metadata` row but
 * took `toVersion` from the NEWEST `sys_metadata_history` row, which is a draft
 * save whenever a draft is pending: every draft save appends a history row too.
 * Measured on this stack before the change: an app with one active save and two
 * draft saves answered `2 → 3` over its version-1 body, and a view with one
 * active save and one draft save answered "no changes" labelled `1 → 2` while
 * version 2 differs.
 *
 * ## What the default range answers now
 *
 * The to side is the active row, labelled with that row's own `version` (the
 * column `SysMetadataRepository.put` stamps with the version of the history row
 * it appends), and the from side is the history row immediately preceding that
 * label. With no active row the to side is absent and so is its label: `null`
 * on both sides, as `DiffMetaItemResponseSchema` declares.
 *
 * ## Why this file boots the real stack
 *
 * The version numbers are the repository's: the draft saves, the active save
 * and the rows they append are real writes through the real routes, over a
 * better-sqlite3 `:memory:` engine with the real `sys_metadata*` objects and a
 * real `ObjectStackProtocolImplementation`. The stubs are the auth boundary
 * (`resolveExecCtx`) and the service probe that says `tenancy` is off here.
 *
 * The reader is an author (`manage_metadata`): the default range is a builder's
 * question, and who else may read `/diff` is not this file's subject.
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

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';

const CALLERS = {
    /** Writes the fixtures: no principal, the machine-write shape. */
    system: { isSystem: true },
    /** Reads the diff: holds the authoring capability. */
    author: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
} as const;
type CallerName = keyof typeof CALLERS;

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
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest: any = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    let caller: CallerName = 'system';
    rest.resolveExecCtx = async () => ({ ...CALLERS[caller] });
    // ADR-0057 D10 — `tenancy` is an optional service this deployment lacks.
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
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
    const save = async (type: string, body: { name: string }, mode: 'active' | 'draft') => {
        const res = await as('system', 'PUT', `${META}/:type/:name`, {
            path: `${META}/${type}/${body.name}`,
            params: { type, name: body.name },
            query: mode === 'draft' ? { mode: 'draft' } : {},
            body,
        });
        if (res.statusCode !== 200) throw new Error(`seeding ${type}/${body.name} failed: ${JSON.stringify(res.body)}`);
    };
    const diff = (type: string, name: string, query: Record<string, string> = {}) =>
        as('author', 'GET', `${META}/:type/:name/diff`, { path: `${META}/${type}/${name}/diff`, params: { type, name }, query });
    /** The stored rows, read past every door: the fixture proof each assertion leans on. */
    const storedRow = async (type: string, name: string, state: 'active' | 'draft') =>
        (await engine.find('sys_metadata', { where: { type, name, state } }))[0] as { version?: unknown } | undefined;
    const historyVersions = async (type: string, name: string) =>
        ((await engine.find('sys_metadata_history', { where: { type, name } })) as Array<{ version: number }>)
            .map((r) => r.version)
            .sort((a, b) => a - b);
    return { save, diff, storedRow, historyVersions };
}

const view = (label: string, columns: string[] = ['name']) =>
    ({ name: 'lead_all', object: 'lead', viewKind: 'list', label, type: 'grid', columns });
const app = (label: string, draftOnlyEntry = false) => ({
    name: 'atlas',
    label,
    navigation: [
        { id: 'nav_leads', type: 'page', label: 'Leads', pageName: 'leads_home' },
        ...(draftOnlyEntry ? [{ id: 'nav_launch_plan', type: 'page', label: 'Launch plan', pageName: 'launch_plan' }] : []),
    ],
});

const FIXTURES = {
    view: { type: 'view', name: 'lead_all', make: (label: string, pending: boolean) => view(label, pending ? ['name', 'owner'] : ['name']) },
    app: { type: 'app', name: 'atlas', make: (label: string, pending: boolean) => app(label, pending) },
} as const;

const text = (res: any): string => JSON.stringify(res.body ?? null);

describe('[#20397] GET /meta/:type/:name/diff — the default range labels the to side with the active row\'s own version', () => {
    for (const [kind, f] of Object.entries(FIXTURES)) {
        it(`${kind}: with a draft pending, toVersion is the active row's version and the to side is that row's body — the explicit range's answer, byte for byte`, async () => {
            const b = await boot();
            await b.save(f.type, f.make('Version one', false), 'active');
            await b.save(f.type, f.make('Version two', false), 'active');
            await b.save(f.type, f.make('Pending draft', true), 'draft');

            // Fixture proof: the draft save appended the newest history row, so
            // the newest history version is NOT the active row's.
            const active = await b.storedRow(f.type, f.name, 'active');
            expect(active?.version).toBe(2);
            expect(await b.historyVersions(f.type, f.name)).toEqual([1, 2, 3]);

            const res = await b.diff(f.type, f.name);
            const explicit = await b.diff(f.type, f.name, { from: '1', to: '2' });

            expect(res.statusCode, text(res)).toBe(200);
            expect(explicit.statusCode, text(explicit)).toBe(200);
            expect(res.body?.toVersion).toBe(active?.version);
            expect(res.body?.fromVersion).toBe(1);
            expect(res.body?.changed).toEqual([{ path: 'label', from: 'Version one', to: 'Version two' }]);
            expect(res.body).toEqual(explicit.body);
            expect(text(res)).not.toContain('Pending draft');
        }, 60_000);
    }

    it('app: the card\'s reading — one active save and two draft saves label the to side 1, never 3, over the version-1 body', async () => {
        const b = await boot();
        await b.save('app', app('Atlas v1'), 'active');
        await b.save('app', app('Atlas v2 draft', true), 'draft');
        await b.save('app', app('Atlas v3 draft', true), 'draft');
        expect(await b.historyVersions('app', 'atlas')).toEqual([1, 2, 3]);

        const res = await b.diff('app', 'atlas');

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body?.toVersion).toBe(1);
        // Nothing precedes version 1, so the from side is absent: the whole
        // version-1 body arrives as added, and no draft save is either side.
        expect(res.body?.fromVersion).toBeNull();
        expect(res.body?.removed).toEqual([]);
        expect(res.body?.changed).toEqual([]);
        expect(res.body?.added).toContainEqual({ path: 'label', value: 'Atlas v1' });
        for (const s of ['Atlas v2 draft', 'Atlas v3 draft', 'nav_launch_plan']) expect(text(res)).not.toContain(s);
    }, 60_000);

    it('view: the card\'s reading — one active save and one draft save no longer answer "no changes" labelled 1 → 2', async () => {
        const b = await boot();
        await b.save('view', view('A'), 'active');
        await b.save('view', view('B draft', ['name', 'owner']), 'draft');

        const res = await b.diff('view', 'lead_all');

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body?.toVersion).toBe(1);
        expect(res.body?.fromVersion).toBeNull();
        expect(res.body?.added).toContainEqual({ path: 'label', value: 'A' });
        expect(text(res)).not.toContain('B draft');
    }, 60_000);

    it('view: with no active row (draft saves only), the to side and its label are absent — null on both sides, and no draft content served', async () => {
        const b = await boot();
        await b.save('view', view('Only draft one'), 'draft');
        await b.save('view', view('Only draft two', ['name', 'owner']), 'draft');
        expect(await b.storedRow('view', 'lead_all', 'active')).toBeUndefined();
        expect(await b.historyVersions('view', 'lead_all')).toEqual([1, 2]);

        const res = await b.diff('view', 'lead_all');

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body).toEqual({
            type: 'view', name: 'lead_all', fromVersion: null, toVersion: null, added: [], removed: [], changed: [],
        });
    }, 60_000);

    it('control: with no draft pending the default range is unchanged — the last two active saves, labelled 1 → 2', async () => {
        const b = await boot();
        await b.save('view', view('A'), 'active');
        await b.save('view', view('B'), 'active');

        const res = await b.diff('view', 'lead_all');

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body?.fromVersion).toBe(1);
        expect(res.body?.toVersion).toBe(2);
        expect(res.body?.changed).toEqual([{ path: 'label', from: 'A', to: 'B' }]);
    }, 60_000);
});
