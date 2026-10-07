// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22114] The `/meta` item read serves the ADR-0008 version token, a save can
 * pin "no row here", and the 409 carries the current version as data.
 *
 * ADR-0008 says a client passes `If-Match: <hash>`, and a client can only send
 * a token it was served. Before this, only a save receipt served one: the read
 * a client edits from (`GET /meta/:type/:name?state=draft`, Studio's designers)
 * served no `version` and no token-bearing `ETag`, so the first save after a
 * load could not be pinned and two editors who each loaded and saved once were
 * last-writer-wins. With no draft row, every `If-Match` was refused and
 * omitting it was unguarded, so a create or the first draft after a publish
 * could not be pinned either. And the 409 named the current version only
 * inside its sentence.
 *
 * Driven at the HTTP door on the real stack — a better-sqlite3 `:memory:`
 * engine, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes — because the claim
 * is about what each request DID to the store, which a protocol double could
 * only echo. The stub is the auth boundary (`resolveExecCtx`).
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * **`dist/`** (`check-test-source-alias.mjs`, `KNOWN_UNALIASED_TEST_IMPORTS`):
 * rebuild it before reading a result here after touching `protocol.ts`.
 *
 * Every refusal pin asserts the ADR-0112 `code` and the HTTP status, and reads
 * the store to show the refused write did not land.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { GetMetaItemResponseSchema, MetadataConflictErrorSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const META = '/api/v1/meta';
/** The keyed token shape the doors serve with no crypto provider registered (the process key). */
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;
/** The save door's own first sentence, unchanged by the structured field. */
const SAVE_CONFLICT_SENTENCE = 'view/case_grid has been modified since you loaded it.';

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
 * Boot the real stack. `enableCache` is the deployment switch the plain read's
 * arm turns on: the default cached arm publishes no OCC carriers, so the
 * active-row pins boot with it off.
 */
async function boot(opts: { enableCache?: boolean } = {}) {
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
    const config = opts.enableCache === false
        ? { api: { requireAuth: false }, metadata: { enableCache: false } }
        : { api: { requireAuth: false } };
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
    const read = (query: Record<string, string> = {}, type = item.type, name = item.name) =>
        call('GET', `${META}/:type/:name`, { path: `${META}/${type}/${name}`, params: { type, name }, query });
    /** `PUT /meta/view/case_grid`. */
    const save = (body: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
        call('PUT', `${META}/:type/:name`, { path, params: item, query, headers, body });
    /** `POST /meta/view/case_grid/publish`. */
    const publish = () =>
        call('POST', `${META}/:type/:name/publish`, { path: `${path}/publish`, params: item, body: {} });
    /** `DELETE /meta/view/case_grid`. */
    const reset = (headers: Record<string, string> = {}) =>
        call('DELETE', `${META}/:type/:name`, { path, params: item, headers });

    /** The stored rows of the item, by lifecycle — the store, not the door's word for it. */
    const stored = async (state: 'active' | 'draft') => {
        const rows = await engine.find('sys_metadata', { where: { type: 'view', name: 'case_grid', state } });
        return (rows ?? []).map((r: any) => JSON.parse(String(r.metadata)).label as string);
    };

    return { read, save, publish, reset, stored };
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

describe('[#22114] the item read serves the version token the save door pins with', () => {
    it('draft: `?state=draft` serves the draft save receipt\'s `version`, byte for byte, as a declared member', async () => {
        const h = await boot();
        const receipt = ok(await h.save(view('v1'), { mode: 'draft' }));
        expect(receipt.version).toMatch(KEYED);

        const body = ok(await h.read({ state: 'draft' }));
        expect(body.version).toBe(receipt.version);

        // Declared: the spec's response schema keeps it through a parse.
        const parsed = GetMetaItemResponseSchema.parse(body);
        expect(parsed.version).toBe(receipt.version);
    }, 60_000);

    it('read, then save with the read\'s token: 200, and the next read serves the new receipt\'s token', async () => {
        const h = await boot();
        ok(await h.save(view('v1'), { mode: 'draft' }));
        const token = ok(await h.read({ state: 'draft' })).version;

        const receipt = ok(await h.save(view('v2'), { mode: 'draft' }, { 'if-match': token }));
        expect(receipt.version).not.toBe(token);
        expect(ok(await h.read({ state: 'draft' })).version).toBe(receipt.version);
        expect(await h.stored('draft')).toEqual(['v2']);
    }, 60_000);

    it('two readers save in turn: the second is refused 409, and its `currentVersion` is the next read\'s token', async () => {
        const h = await boot();
        ok(await h.save(view('v1'), { mode: 'draft' }));
        const readerA = ok(await h.read({ state: 'draft' })).version;
        const readerB = ok(await h.read({ state: 'draft' })).version;
        expect(readerB).toBe(readerA);

        const won = ok(await h.save(view('by A'), { mode: 'draft' }, { 'if-match': readerA }));
        const lost = refusedConflict(await h.save(view('by B'), { mode: 'draft' }, { 'if-match': readerB }));

        // B's edit did not land over A's.
        expect(await h.stored('draft')).toEqual(['by A']);
        // The structured field: the token A's save left, which is what the next read serves.
        expect(lost.currentVersion).toBe(won.version);
        expect(ok(await h.read({ state: 'draft' })).version).toBe(lost.currentVersion);
        // Today's sentence, unchanged beside it — it still names the same token.
        expect(lost.error.startsWith(SAVE_CONFLICT_SENTENCE)).toBe(true);
        expect(lost.error).toContain(`(current is ${won.version})`);
        // Declared: the conflict body parses under its schema, field intact.
        expect(MetadataConflictErrorSchema.parse(lost).currentVersion).toBe(won.version);

        // B re-pins from the refusal and is accepted.
        ok(await h.save(view('by B, merged'), { mode: 'draft' }, { 'if-match': lost.currentVersion }));
        expect(await h.stored('draft')).toEqual(['by B, merged']);
    }, 60_000);

    it('`If-None-Match: *` writes a first draft, and once a draft exists it is refused 409 with that draft\'s token', async () => {
        const h = await boot();
        const first = ok(await h.save(view('first'), { mode: 'draft' }, { 'if-none-match': '*' }));
        expect(await h.stored('draft')).toEqual(['first']);

        const refused = refusedConflict(await h.save(view('second'), { mode: 'draft' }, { 'if-none-match': '*' }));
        expect(refused.currentVersion).toBe(first.version);
        expect(ok(await h.read({ state: 'draft' })).version).toBe(refused.currentVersion);
        expect(await h.stored('draft')).toEqual(['first']);
    }, 60_000);

    it('after a publish (no draft row): a held `If-Match` is refused 409 with `currentVersion: null`; `If-None-Match: *` writes the next draft', async () => {
        const h = await boot();
        const draft = ok(await h.save(view('d1'), { mode: 'draft' }));
        ok(await h.publish());
        expect(await h.stored('draft')).toEqual([]);

        const stale = refusedConflict(await h.save(view('d2 pinned'), { mode: 'draft' }, { 'if-match': draft.version }));
        expect(stale.currentVersion).toBeNull();
        expect(MetadataConflictErrorSchema.parse(stale).currentVersion).toBeNull();
        expect(await h.stored('draft')).toEqual([]);

        ok(await h.save(view('d2'), { mode: 'draft' }, { 'if-none-match': '*' }));
        expect(await h.stored('draft')).toEqual(['d2']);
    }, 60_000);

    it('control: a save with neither header is last-writer-wins, as before', async () => {
        const h = await boot();
        ok(await h.save(view('v1'), { mode: 'draft' }));
        const held = ok(await h.read({ state: 'draft' })).version;

        ok(await h.save(view('by A'), { mode: 'draft' }));
        ok(await h.save(view('by B'), { mode: 'draft' }));
        expect(await h.stored('draft')).toEqual(['by B']);
        expect(ok(await h.read({ state: 'draft' })).version).not.toBe(held);
    }, 60_000);
});

describe('[#22114] the active row, on the uncached plain read', () => {
    it('serves the active receipt\'s token; `If-None-Match: *` pins the create; an item with no stored row serves `null`', async () => {
        const h = await boot({ enableCache: false });
        const created = ok(await h.save(view('live'), {}, { 'if-none-match': '*' }));
        expect(ok(await h.read()).version).toBe(created.version);

        const again = refusedConflict(await h.save(view('second create'), {}, { 'if-none-match': '*' }));
        expect(again.currentVersion).toBe(created.version);
        expect(await h.stored('active')).toEqual(['live']);

        // `task` is registered in code: no stored row, so the next save is a create.
        const codeOnly = ok(await h.read({}, 'object', 'task'));
        expect(codeOnly.item).toBeDefined();
        expect(codeOnly.version).toBeNull();
        expect(GetMetaItemResponseSchema.parse(codeOnly).version).toBeNull();
    }, 60_000);

    it('the reset door\'s refusal carries `currentVersion` too — one conflict builder for the item doors', async () => {
        const h = await boot({ enableCache: false });
        const v1 = ok(await h.save(view('v1')));
        const v2 = ok(await h.save(view('v2'), {}, { 'if-match': v1.version }));

        const refused = refusedConflict(await h.reset({ 'if-match': v1.version }));
        expect(refused.currentVersion).toBe(v2.version);
        expect(ok(await h.read()).version).toBe(v2.version);
        expect(await h.stored('active')).toEqual(['v2']);
    }, 60_000);

    it('the cached arm (the default) publishes no `version`: its ETag stays the cache validator', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const res = await h.read();
        const body = ok(res);
        expect(body).not.toHaveProperty('version');
        expect(res.headers.ETag).toBeDefined();
        expect(String(res.headers.ETag)).not.toMatch(/hmac-sha256:/);
    }, 60_000);
});

describe('[#22114] `If-None-Match` on the save door takes `*` alone', () => {
    const REFUSED_PINS: Record<string, Record<string, string>> = {
        'beside If-Match': { 'if-match': 'hmac-sha256:anything', 'if-none-match': '*' },
        'an entity-tag': { 'if-none-match': '"abc"' },
        'a weak wildcard': { 'if-none-match': 'W/"*"' },
        'a list': { 'if-none-match': '*, "abc"' },
        'empty': { 'if-none-match': '' },
    };
    for (const [label, headers] of Object.entries(REFUSED_PINS)) {
        it(`${label}: refused 400 VALIDATION_ERROR, nothing written`, async () => {
            const h = await boot();
            const res = await h.save(view('never'), { mode: 'draft' }, headers);
            expect(res.statusCode, JSON.stringify(res.body)).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(await h.stored('draft')).toEqual([]);
        }, 60_000);
    }

    it('` * ` (whitespace around the wildcard) is the wildcard', async () => {
        const h = await boot();
        ok(await h.save(view('first'), { mode: 'draft' }, { 'if-none-match': ' * ' }));
        expect(await h.stored('draft')).toEqual(['first']);
    }, 60_000);
});
