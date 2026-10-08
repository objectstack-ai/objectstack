// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22128] One head row per `/meta` write address: the save's expected-parent
 * read, the repository's optimistic lock and the item read's served `version`
 * resolve the same row.
 *
 * ADR-0008 makes the lock on `PUT /meta` opt-in: a save with no `If-Match` is
 * last-writer-wins. A package-less draft save of a package-owned item is stored
 * in the package (#11087: the repository inherits the active row's binding, so
 * the draft is not orphaned). The save door's head read used to look for the
 * draft at the package-UNBOUND row instead, found none, and handed the
 * repository a parent of `null`, which the repository's lock judged against
 * the inherited row. So the second unpinned draft save was refused 409
 * `METADATA_CONFLICT`, and the `?state=draft` read served `version: null`
 * while the draft existed.
 *
 * `?package=all` is the second member of that class. The save door folds it
 * to the env-local overlay; the read door forwarded the literal `all`, so its
 * `version` was resolved at a package address no save writes.
 *
 * Driven at the HTTP door on the real stack: a better-sqlite3 `:memory:`
 * engine, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes. The stub is the
 * auth boundary (`resolveExecCtx`).
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * **`dist/`** (`check-test-source-alias.mjs`, `KNOWN_UNALIASED_TEST_IMPORTS`):
 * rebuild it before reading a result here after touching `protocol.ts` or
 * `sys-metadata-repository.ts`.
 *
 * Every refusal pin asserts the ADR-0112 `code` and the HTTP status, and reads
 * the store to show the refused write did not land.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const META = '/api/v1/meta';
/** The keyed token shape the doors serve with no crypto provider registered (the process key). */
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;
/** A writable authoring package: no installed package carries this id. */
const PKG = 'com.probe.pkg';

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

/**
 * Boot the real stack with the cache off: the default cached arm of the plain
 * read publishes no OCC carriers, so the active-row pins read the uncached arm.
 */
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
    const config = { api: { requireAuth: false }, metadata: { enableCache: false } };
    const rest: any = new RestServer(createMockServer() as any, protocol as any, config as any);
    // An author: `manage_metadata` saves and reads drafts.
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

    /** `GET /meta/view/case_grid`. */
    const read = (query: Record<string, string> = {}) =>
        call('GET', `${META}/:type/:name`, { path, params: item, query });
    /** `PUT /meta/view/case_grid`. */
    const save = (body: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
        call('PUT', `${META}/:type/:name`, { path, params: item, query, headers, body });

    /** The stored rows of the item at one lifecycle, with their binding — the store, not the door's word for it. */
    const stored = async (state: 'active' | 'draft') => {
        const rows = await engine.find('sys_metadata', { where: { type: 'view', name: 'case_grid', state } });
        return (rows ?? []).map((r: any) => ({
            label: JSON.parse(String(r.metadata)).label as string,
            packageId: (r.package_id ?? null) as string | null,
        }));
    };

    return { read, save, stored };
}

const ok = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    return res.body;
};

/** A refusal: the ADR-0112 `code` and the status, both asserted. */
const refusedConflict = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('METADATA_CONFLICT');
    return res.body;
};

describe('[#22128] a package-less draft of a package-owned item: one head row for the save, the lock and the read', () => {
    it('the measured sequence: active save in a package, a package-less draft, the same draft again with no `If-Match` → 200, 200, 200', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));
        ok(await h.save(view('draft 1'), { mode: 'draft' }));
        // #11087's inheritance, kept: the package-less draft is stored in the package.
        expect(await h.stored('draft')).toEqual([{ label: 'draft 1', packageId: PKG }]);

        // The defect: this unpinned save was refused 409 METADATA_CONFLICT
        // ("Expected parent null but current is hmac-sha256:…").
        ok(await h.save(view('draft 2'), { mode: 'draft' }));
        // Last-writer-wins on the ONE draft row — updated in place, never forked.
        expect(await h.stored('draft')).toEqual([{ label: 'draft 2', packageId: PKG }]);
        expect(await h.stored('active')).toEqual([{ label: 'live', packageId: PKG }]);
    }, 60_000);

    it('`?state=draft` after the package-less draft serves that draft\'s `version` (the save receipt\'s), not `null`', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));
        const receipt = ok(await h.save(view('draft 1'), { mode: 'draft' }));
        expect(receipt.version).toMatch(KEYED);

        const body = ok(await h.read({ state: 'draft' }));
        expect(body.version).toBe(receipt.version);

        // And that token pins the next save at the same address.
        const next = ok(await h.save(view('draft 2'), { mode: 'draft' }, { 'if-match': body.version }));
        expect(ok(await h.read({ state: 'draft' })).version).toBe(next.version);
        expect(await h.stored('draft')).toEqual([{ label: 'draft 2', packageId: PKG }]);
    }, 60_000);

    it('control: a stale `If-Match` is still refused 409, with the inherited draft\'s token as `currentVersion`', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));
        const first = ok(await h.save(view('draft 1'), { mode: 'draft' }));
        const second = ok(await h.save(view('draft 2'), { mode: 'draft' }, { 'if-match': first.version }));

        const stale = refusedConflict(await h.save(view('stale edit'), { mode: 'draft' }, { 'if-match': first.version }));
        expect(stale.currentVersion).toBe(second.version);
        expect(ok(await h.read({ state: 'draft' })).version).toBe(stale.currentVersion);
        // The refused write did not land.
        expect(await h.stored('draft')).toEqual([{ label: 'draft 2', packageId: PKG }]);

        // `If-None-Match: *` asserts no draft: refused while the inherited one exists.
        refusedConflict(await h.save(view('as if first'), { mode: 'draft' }, { 'if-none-match': '*' }));
        expect(await h.stored('draft')).toEqual([{ label: 'draft 2', packageId: PKG }]);
    }, 60_000);

    it('control: an env-local item with no package is unchanged — unbound rows, unpinned saves accepted, the read serves the receipt\'s token', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const first = ok(await h.save(view('draft 1'), { mode: 'draft' }));
        ok(await h.save(view('draft 2'), { mode: 'draft' }));
        expect(await h.stored('draft')).toEqual([{ label: 'draft 2', packageId: null }]);
        expect(await h.stored('active')).toEqual([{ label: 'live', packageId: null }]);

        const held = ok(await h.read({ state: 'draft' })).version;
        expect(held).toMatch(KEYED);
        expect(held).not.toBe(first.version);
        refusedConflict(await h.save(view('stale'), { mode: 'draft' }, { 'if-match': first.version }));
        ok(await h.save(view('draft 3'), { mode: 'draft' }, { 'if-match': held }));
        expect(await h.stored('draft')).toEqual([{ label: 'draft 3', packageId: null }]);
    }, 60_000);
});

describe('[#22128] `?package=all`: the read resolves `all` the way the save does', () => {
    it('active: the read\'s `version` is the token the save compares against; `If-None-Match: *` is refused only because a row is there', async () => {
        const h = await boot();
        const created = ok(await h.save(view('live'), { package: 'all' }));
        // The save folds `all` to the env-local overlay.
        expect(await h.stored('active')).toEqual([{ label: 'live', packageId: null }]);

        const token = ok(await h.read({ package: 'all' })).version;
        expect(token).toBe(created.version);

        const refused = refusedConflict(await h.save(view('as if first'), { package: 'all' }, { 'if-none-match': '*' }));
        expect(refused.currentVersion).toBe(token);
        ok(await h.save(view('edited'), { package: 'all' }, { 'if-match': token }));
        expect(await h.stored('active')).toEqual([{ label: 'edited', packageId: null }]);
    }, 60_000);

    it('active, no row at the env-local address: the read serves `null`, and `If-None-Match: *` creates it', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));

        expect(ok(await h.read({ package: 'all' })).version).toBeNull();
        const created = ok(await h.save(view('env-local'), { package: 'all' }, { 'if-none-match': '*' }));
        expect(ok(await h.read({ package: 'all' })).version).toBe(created.version);
        expect(await h.stored('active')).toEqual(expect.arrayContaining([
            { label: 'live', packageId: PKG },
            { label: 'env-local', packageId: null },
        ]));
    }, 60_000);

    it('draft of a package-owned item: `?state=draft&package=all` serves the inherited draft and its token, and the save accepts it', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));
        const draft = ok(await h.save(view('draft 1'), { mode: 'draft', package: 'all' }));
        expect(await h.stored('draft')).toEqual([{ label: 'draft 1', packageId: PKG }]);

        const body = ok(await h.read({ state: 'draft', package: 'all' }));
        expect(body.item.label).toBe('draft 1');
        expect(body.version).toBe(draft.version);

        ok(await h.save(view('draft 2'), { mode: 'draft', package: 'all' }, { 'if-match': body.version }));
        expect(await h.stored('draft')).toEqual([{ label: 'draft 2', packageId: PKG }]);
    }, 60_000);
});
