// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34908] The console's save door keeps a list view's audience gate
 * (`requiredPermissions`, ruling 6095014058, letter A) — the premise the
 * administrator-facing "who sees this view" control stands on (ruling
 * 7103739693, letter B: author the existing gate, add no second one).
 *
 * The bodies are the ones the console writes, byte for byte in shape: a new
 * shared view goes out as the `viewEnvelope` the add-view door builds (the
 * gate under `config`, beside the object binding), saved as a draft over "no
 * draft" (`PUT ?mode=draft`, `If-None-Match: *`) and published
 * (`POST /publish`); an edit of an existing view goes out as the same envelope.
 * Pinned through the real routes, the real `saveMetaItem` and a real
 * better-sqlite3 `sys_metadata`:
 *
 *  - the draft read, the stored active row and the served item each carry the
 *    gate as written;
 *  - the published view is then served to a holder of the capability and
 *    refused by name to a caller who holds none (`403 PERMISSION_DENIED`) —
 *    the gate the save kept is the gate the read applies;
 *  - an edit that clears the gate (the control's "everyone") stores no key,
 *    and the non-holder is served again;
 *  - CONTROL: a view saved with no gate is served to everyone.
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * `dist/`: rebuild it before reading a result here after touching it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

const TEST_PACKAGE_ID = 'objectstack-test';
const META = '/api/v1/meta';
const LEGAL_CAP = 'task_legal.view';
const VIEW_NAME = 'task.legal_queue';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

/** The callers: the writer holds the route's `manage_metadata` and the capability. */
const CALLERS = {
    author: { userId: 'u_author', systemPermissions: ['manage_metadata', LEGAL_CAP] },
    holder: { userId: 'u_legal', systemPermissions: [LEGAL_CAP] },
    'non-holder': { userId: 'u_member', systemPermissions: [] as string[] },
} as const;
type CallerName = keyof typeof CALLERS;

/** What the console's add-view door writes (`viewEnvelope(object, spec, { name, label })`). */
const consoleEnvelope = (gate: string[] | undefined) => ({
    name: VIEW_NAME,
    object: 'task',
    viewKind: 'list',
    label: 'Legal queue',
    config: {
        type: 'grid',
        columns: ['name'],
        ...(gate ? { requiredPermissions: gate } : {}),
        data: { provider: 'object', object: 'task' },
    },
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
    let caller: CallerName = 'author';
    rest.resolveExecCtx = async () => ({ ...CALLERS[caller], systemPermissions: [...CALLERS[caller].systemPermissions] });
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`${method} ${path} is not registered`);
        return found;
    };
    const call = async (who: CallerName, method: string, routePath: string, req: Record<string, unknown>) => {
        caller = who;
        const res = makeRes();
        await route(method, routePath).handler({ method, headers: {}, query: {}, params: {}, ...req }, res);
        return res;
    };
    const item = { type: 'view', name: VIEW_NAME };
    const path = `${META}/view/${VIEW_NAME}`;

    return {
        /** `PUT /meta/view/task.legal_queue` — active unless `mode: 'draft'`. */
        save: (body: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
            call('author', 'PUT', `${META}/:type/:name`, { path, params: item, query, headers, body }),
        /** `GET /meta/view/task.legal_queue?state=draft` — the strict draft read. */
        readDraft: () => call('author', 'GET', `${META}/:type/:name`, { path, params: item, query: { state: 'draft' } }),
        /** `POST /meta/view/task.legal_queue/publish`. */
        publish: () => call('author', 'POST', `${META}/:type/:name/publish`, { path: `${path}/publish`, params: item, body: {} }),
        /** `GET /meta/view/task.legal_queue` — the by-name read, as the caller named. */
        read: (who: CallerName) => call(who, 'GET', `${META}/:type/:name`, { path, params: item }),
        /** The stored active row's body — the store, not the door's word for it. */
        storedActive: async () => {
            const rows = (await engine.find('sys_metadata', { where: { type: 'view', name: VIEW_NAME, state: 'active' } })) ?? [];
            return rows.map((r: any) => (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata));
        },
    };
}

const ok = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    return res.body;
};
/** The ADR-0112 minimum: the status and the machine code. */
const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });
/** A list view's gate wherever the served body carries it: under `config`, or on the flattened arm. */
const gateOf = (body: any): unknown => body?.config?.requiredPermissions ?? body?.requiredPermissions;
const servedItem = (body: any): any => body?.item ?? body?.data ?? body;

describe('[#34908] the console save door keeps a list view\'s requiredPermissions', () => {
    it('a new shared view, drafted and published: the draft, the stored row and the served item carry the gate; the read applies it', async () => {
        const h = await boot();
        ok(await h.save(consoleEnvelope([LEGAL_CAP]), { mode: 'draft' }, { 'if-none-match': '*' }));
        expect(gateOf(servedItem(ok(await h.readDraft())))).toEqual([LEGAL_CAP]);

        ok(await h.publish());
        const [stored, ...more] = await h.storedActive();
        expect(more).toEqual([]);
        expect(gateOf(stored)).toEqual([LEGAL_CAP]);

        expect(gateOf(servedItem(ok(await h.read('holder'))))).toEqual([LEGAL_CAP]);
        expect(envelope(await h.read('non-holder'))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    }, 60_000);

    it('an edit that clears the gate stores no key, and the non-holder is served again', async () => {
        const h = await boot();
        ok(await h.save(consoleEnvelope([LEGAL_CAP])));
        expect(envelope(await h.read('non-holder'))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });

        ok(await h.save(consoleEnvelope(undefined)));
        const [stored] = await h.storedActive();
        expect(gateOf(stored)).toBeUndefined();
        expect(gateOf(servedItem(ok(await h.read('non-holder'))))).toBeUndefined();
    }, 60_000);

    it('control: a view saved with no gate is served to everyone', async () => {
        const h = await boot();
        ok(await h.save(consoleEnvelope(undefined)));
        ok(await h.read('non-holder'));
        ok(await h.read('holder'));
    }, 60_000);
});
