// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20397] `GET /meta/:type/:name/diff` with no `from` / `to` compares an
 * earlier version with the CURRENT one, and labels each side with the version
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
 * it appends). With no active row the to side is absent and so is its label:
 * `null` on both sides, as `DiffMetaItemResponseSchema` declares. The from side
 * is the nearest earlier history row whose body differs from the to side's
 * (#20451, the second `describe` below).
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
    const publish = async (type: string, name: string) => {
        const res = await as('system', 'POST', `${META}/:type/:name/publish`, {
            path: `${META}/${type}/${name}/publish`,
            params: { type, name },
        });
        if (res.statusCode !== 200) throw new Error(`publishing ${type}/${name} failed: ${JSON.stringify(res.body)}`);
    };
    const remove = async (type: string, name: string) => {
        const res = await as('system', 'DELETE', `${META}/:type/:name`, {
            path: `${META}/${type}/${name}`,
            params: { type, name },
        });
        if (res.statusCode !== 200) throw new Error(`deleting ${type}/${name} failed: ${JSON.stringify(res.body)}`);
    };
    const diff = (type: string, name: string, query: Record<string, string> = {}) =>
        as('author', 'GET', `${META}/:type/:name/diff`, { path: `${META}/${type}/${name}/diff`, params: { type, name }, query });
    /** The stored rows, read past every door: the fixture proof each assertion leans on. */
    const storedRow = async (type: string, name: string, state: 'active' | 'draft') =>
        (await engine.find('sys_metadata', { where: { type, name, state } }))[0] as { version?: unknown; metadata?: unknown } | undefined;
    const historyVersions = async (type: string, name: string) =>
        ((await engine.find('sys_metadata_history', { where: { type, name } })) as Array<{ version: number }>)
            .map((r) => r.version)
            .sort((a, b) => a - b);
    /** Each history row's version, operation and label: which rows repeat a body, and which carry none. */
    const historyRows = async (type: string, name: string) =>
        ((await engine.find('sys_metadata_history', { where: { type, name } })) as Array<{
            version: number; operation_type: string; metadata: unknown;
        }>)
            .map((r) => {
                const body = r.metadata == null ? null : (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata);
                return { version: r.version, op: r.operation_type, label: body == null ? null : body.label };
            })
            .sort((a, b) => a.version - b.version);
    return { save, publish, remove, diff, storedRow, historyVersions, historyRows };
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

/**
 * [#20451] With no `from`, the from side is the nearest earlier history row
 * whose body DIFFERS from the to side's, by the diff's own equality: all three
 * buckets empty means equal, and a body-less row (a delete's) compares as `{}`.
 *
 * Every draft save appends a history row, and a publish appends the promoted
 * body again as the next one, so the row immediately before a published
 * version is usually the draft save it came from, carrying the same body. The
 * default range used to take that row and answered "no changes" right after
 * every publish. Measured on this stack before the change: v1 active, a v2 draft
 * save, a v3 publish answered `2 → 3` with empty buckets, and create, delete,
 * draft save, publish answered `3 → 4` with empty buckets.
 *
 * An explicit `?from=` / `?to=` still names exactly its versions.
 */
describe('[#20451] GET /meta/:type/:name/diff — the default from side is the nearest earlier version whose body differs', () => {
    /** The stored active body, parsed: the "everything added" arm's expected entries, in the diff's key order. */
    const allAdded = (row: { metadata?: unknown } | undefined) => {
        const body = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata;
        return Object.entries(body as Record<string, unknown>).map(([path, value]) => ({ path, value }));
    };

    it('view: v1 active, a v2 draft save and a v3 publish answer 1 → 3, the change the publish carried, and still do with a v4 draft pending', async () => {
        const b = await boot();
        await b.save('view', view('A'), 'active');
        await b.save('view', view('B', ['name', 'owner']), 'draft');
        await b.publish('view', 'lead_all');

        // Fixture proof: the publish repeated the draft save's body as the next row.
        expect(await b.historyRows('view', 'lead_all')).toEqual([
            { version: 1, op: 'create', label: 'A' },
            { version: 2, op: 'create', label: 'B' },
            { version: 3, op: 'publish', label: 'B' },
        ]);
        expect((await b.storedRow('view', 'lead_all', 'active'))?.version).toBe(3);

        const res = await b.diff('view', 'lead_all');
        const explicit = await b.diff('view', 'lead_all', { from: '1', to: '3' });

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body?.fromVersion).toBe(1);
        expect(res.body?.toVersion).toBe(3);
        expect(res.body?.changed).toEqual([
            { path: 'label', from: 'A', to: 'B' },
            { path: 'columns', from: ['name'], to: ['name', 'owner'] },
        ]);
        expect(res.body).toEqual(explicit.body);

        await b.save('view', view('C pending', ['name', 'owner', 'stage']), 'draft');
        expect(await b.historyVersions('view', 'lead_all')).toEqual([1, 2, 3, 4]);

        const pending = await b.diff('view', 'lead_all');

        expect(pending.statusCode, text(pending)).toBe(200);
        expect(pending.body).toEqual(explicit.body);
        expect(text(pending)).not.toContain('C pending');
    }, 60_000);

    it('view: an explicit range still names exactly its versions — ?from=2&to=3 answers the draft save against its publish, "no changes"', async () => {
        const b = await boot();
        await b.save('view', view('A'), 'active');
        await b.save('view', view('B', ['name', 'owner']), 'draft');
        await b.publish('view', 'lead_all');

        const res = await b.diff('view', 'lead_all', { from: '2', to: '3' });

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body).toEqual({
            type: 'view', name: 'lead_all', fromVersion: 2, toVersion: 3, added: [], removed: [], changed: [],
        });
    }, 60_000);

    it('view: create, delete, draft save and publish answer 2 → 4, everything added — the walk stops on the body-less delete row', async () => {
        const b = await boot();
        await b.save('view', view('A'), 'active');
        await b.remove('view', 'lead_all');
        await b.save('view', view('A2', ['name', 'owner']), 'draft');
        await b.publish('view', 'lead_all');

        expect(await b.historyRows('view', 'lead_all')).toEqual([
            { version: 1, op: 'create', label: 'A' },
            { version: 2, op: 'delete', label: null },
            { version: 3, op: 'create', label: 'A2' },
            { version: 4, op: 'publish', label: 'A2' },
        ]);
        const active = await b.storedRow('view', 'lead_all', 'active');
        expect(active?.version).toBe(4);

        const res = await b.diff('view', 'lead_all');
        const explicit = await b.diff('view', 'lead_all', { from: '2', to: '4' });

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body?.fromVersion).toBe(2);
        expect(res.body?.toVersion).toBe(4);
        expect(res.body?.removed).toEqual([]);
        expect(res.body?.changed).toEqual([]);
        expect(res.body?.added).toEqual(allAdded(active));
        expect(res.body?.added).toContainEqual({ path: 'label', value: 'A2' });
        expect(res.body).toEqual(explicit.body);
    }, 60_000);

    it('view: create, delete and an active recreate answer 2 → 3, everything added — the answer the rule before #20451 gave', async () => {
        const b = await boot();
        await b.save('view', view('A'), 'active');
        await b.remove('view', 'lead_all');
        await b.save('view', view('B', ['name', 'owner']), 'active');

        expect(await b.historyRows('view', 'lead_all')).toEqual([
            { version: 1, op: 'create', label: 'A' },
            { version: 2, op: 'delete', label: null },
            { version: 3, op: 'create', label: 'B' },
        ]);
        const active = await b.storedRow('view', 'lead_all', 'active');

        const res = await b.diff('view', 'lead_all');

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body).toEqual({
            type: 'view',
            name: 'lead_all',
            fromVersion: 2,
            toVersion: 3,
            added: allAdded(active),
            removed: [],
            changed: [],
        });
    }, 60_000);

    it('view: a brand-new item draft-saved and then published answers null → 2, everything added — no earlier row differs', async () => {
        const b = await boot();
        await b.save('view', view('New'), 'draft');
        await b.publish('view', 'lead_all');

        expect(await b.historyRows('view', 'lead_all')).toEqual([
            { version: 1, op: 'create', label: 'New' },
            { version: 2, op: 'publish', label: 'New' },
        ]);
        const active = await b.storedRow('view', 'lead_all', 'active');

        const res = await b.diff('view', 'lead_all');

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body).toEqual({
            type: 'view', name: 'lead_all', fromVersion: null, toVersion: 2, added: allAdded(active), removed: [], changed: [],
        });
    }, 60_000);

    it('view: a single version answers null → 1, everything added', async () => {
        const b = await boot();
        await b.save('view', view('Only'), 'active');
        const active = await b.storedRow('view', 'lead_all', 'active');

        const res = await b.diff('view', 'lead_all');

        expect(res.statusCode, text(res)).toBe(200);
        expect(res.body).toEqual({
            type: 'view', name: 'lead_all', fromVersion: null, toVersion: 1, added: allAdded(active), removed: [], changed: [],
        });
    }, 60_000);
});
