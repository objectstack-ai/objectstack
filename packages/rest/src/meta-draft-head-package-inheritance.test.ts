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
 * `version` was resolved at a package address no save writes. The credential
 * carry-forward (#8154) is the third: it compared the served body against the
 * row at the named key, not the row the draft save overwrites.
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
import { hashSpec } from '@objectstack/metadata-core';
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
 * `item` names the one item the helpers address; `permissions` the caller's
 * system capabilities (a `datasource` is read and written under
 * `manage_platform_settings`).
 */
async function boot(opts: { item?: { type: string; name: string }; permissions?: string[] } = {}) {
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
    // [#26708] The packages the saves below name are installed, as authored
    // bases that bind this file's `task` object: a save naming a package no
    // installed package has is refused, and an installed package's write is
    // judged against its declared closure.
    for (const id of [PKG, 'com.probe.other', 'com.probe.q', 'com.probe.r']) {
        engine.registry.installPackage({
            id, name: id, version: '1.0.0', dependencies: { [TEST_PACKAGE_ID]: '*' },
        } as any, 'authored');
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const config = { api: { requireAuth: false }, metadata: { enableCache: false } };
    const rest: any = new RestServer(createMockServer() as any, protocol as any, config as any);
    // An author: `manage_metadata` saves and reads drafts.
    const systemPermissions = opts.permissions ?? ['manage_metadata'];
    rest.resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions });
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
    const item = opts.item ?? { type: 'view', name: 'case_grid' };
    const path = `${META}/${item.type}/${item.name}`;

    /** `GET /meta/view/case_grid`. */
    const read = (query: Record<string, string> = {}) =>
        call('GET', `${META}/:type/:name`, { path, params: item, query });
    /** `PUT /meta/view/case_grid`. */
    const save = (body: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
        call('PUT', `${META}/:type/:name`, { path, params: item, query, headers, body });

    /** The stored rows of the item at one lifecycle, with their binding — the store, not the door's word for it. */
    const storedBodies = async (state: 'active' | 'draft') => {
        const rows = await engine.find('sys_metadata', { where: { type: item.type, name: item.name, state } });
        return (rows ?? []).map((r: any) => ({
            body: JSON.parse(String(r.metadata)) as Record<string, any>,
            packageId: (r.package_id ?? null) as string | null,
        }));
    };
    const stored = async (state: 'active' | 'draft') =>
        (await storedBodies(state)).map(({ body, packageId }) => ({ label: body.label as string, packageId }));

    /**
     * A row as it exists at rest from before the write gates — the only way a
     * stored credential is still at rest today, since the save door refuses
     * one — written straight to the store, stamped as `put` stamps a row.
     */
    const seed = async (state: 'active' | 'draft', packageId: string | null, body: Record<string, unknown>) => {
        const now = new Date().toISOString();
        await engine.insert('sys_metadata', {
            id: `seed_${state}_${packageId ?? 'unbound'}`, type: item.type, name: item.name,
            package_id: packageId, state, metadata: JSON.stringify(body), checksum: hashSpec(body, item.type),
            version: 1, created_at: now, updated_at: now,
        }, { context: { isSystem: true } } as any);
    };

    /** `DELETE /meta/view/case_grid` (the reset). */
    const remove = (query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
        call('DELETE', `${META}/:type/:name`, { path, params: item, query, headers });

    /** `POST /meta/view/case_grid/publish` (the per-item draft promotion). */
    const publish = (query: Record<string, string> = {}) =>
        call('POST', `${META}/:type/:name/publish`, { path: `${path}/publish`, params: item, query, body: {} });

    return { read, save, remove, publish, stored, storedBodies, seed };
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

    // [#23165] Replaced, not respelled: this case pinned the read serving
    // `null` and `If-None-Match: *` minting an env-local row BESIDE the
    // package's row, which is the defect #23165 removes (a package-less save
    // of an item a package owns writes that package's row). The invariant the
    // rider asked for still holds and is what is pinned: `all` names no
    // package on both doors, so the read's token is the one the save compares
    // against, and the save writes the row the read serves.
    it('active, an item a package owns: the read serves that package row\'s `version`, and the save naming no package addresses the same row', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));

        const token = ok(await h.read({ package: 'all' })).version;
        expect(token).toMatch(KEYED);
        const refused = refusedConflict(await h.save(view('as if first'), { package: 'all' }, { 'if-none-match': '*' }));
        expect(refused.currentVersion).toBe(token);
        ok(await h.save(view('edited'), { package: 'all' }, { 'if-match': token }));
        expect(await h.stored('active')).toEqual([{ label: 'edited', packageId: PKG }]);
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

/**
 * [#22128] The credential carry-forward (#8154) compares the served body
 * against the row the save OVERWRITES. It read at the key the caller named, so
 * a package-less draft save of a package-owned item found neither the
 * inherited draft nor the package-bound active row, compared against the code
 * layer, and persisted the stored credential away. Measured on the real route
 * before the fix: the stored draft's `config.url` no longer held it.
 */
describe('[#22128] the credential carry-forward reads the row the draft save overwrites', () => {
    /** A fixture value standing in for the userinfo password a legacy row holds. */
    const URL_CREDENTIAL = 'fixture-not-a-credential';
    const DATASOURCE = { type: 'datasource', name: 'warehouse' };
    const legacyDatasource = (label: string) => ({
        name: 'warehouse',
        label,
        driver: 'postgres',
        config: {
            host: 'db.internal',
            port: 5432,
            database: 'warehouse',
            username: 'reporting',
            url: `postgresql://reporting:${URL_CREDENTIAL}@db.internal:5432/warehouse`,
        },
    });
    const holdsCredential = (body: Record<string, any>) => String(body?.config?.url ?? '').includes(URL_CREDENTIAL);
    const bootDatasource = () => boot({ item: DATASOURCE, permissions: ['manage_metadata', 'manage_platform_settings'] });

    it('package-owned: the redacted read saved back as a package-less draft, twice, keeps the stored credential', async () => {
        const h = await bootDatasource();
        await h.seed('active', PKG, legacyDatasource('live'));

        const served = ok(await h.read()).item;
        expect(holdsCredential(served)).toBe(false);
        ok(await h.save({ ...served, label: 'draft 1' }, { mode: 'draft' }));
        const first = await h.storedBodies('draft');
        expect(first.map((r) => r.packageId)).toEqual([PKG]);
        expect(first.map((r) => holdsCredential(r.body))).toEqual([true]);

        const servedDraft = ok(await h.read({ state: 'draft' })).item;
        expect(holdsCredential(servedDraft)).toBe(false);
        ok(await h.save({ ...servedDraft, label: 'draft 2' }, { mode: 'draft' }));
        const second = await h.storedBodies('draft');
        expect(second.map((r) => [r.body.label, r.packageId, holdsCredential(r.body)])).toEqual([['draft 2', PKG, true]]);
        // The active row is untouched.
        expect((await h.storedBodies('active')).map((r) => holdsCredential(r.body))).toEqual([true]);
    }, 60_000);

    it('control: env-local, the same round trip keeps the stored credential, as before', async () => {
        const h = await bootDatasource();
        await h.seed('active', null, legacyDatasource('live'));

        const served = ok(await h.read()).item;
        ok(await h.save({ ...served, label: 'draft 1' }, { mode: 'draft' }));
        const servedDraft = ok(await h.read({ state: 'draft' })).item;
        ok(await h.save({ ...servedDraft, label: 'draft 2' }, { mode: 'draft' }));
        const drafts = await h.storedBodies('draft');
        expect(drafts.map((r) => [r.body.label, r.packageId, holdsCredential(r.body)])).toEqual([['draft 2', null, true]]);
    }, 60_000);
});

/**
 * [#23165, ADR-0048] The direct save and the delete that name no package, on
 * the real routes: they address the row of the one package the item belongs
 * to, a name two packages hold is refused, and `?package=` on the delete door
 * removes that package's row. The protocol suite
 * (`protocol.packageless-save-address.test.ts` in metadata-protocol) holds the
 * rest of the matrix over a stub engine; these drive the HTTP doors over
 * better-sqlite3.
 */
describe('[#23165] a save or a delete naming no package addresses the one package\'s row, on the real routes', () => {
    const OTHER_PKG = 'com.probe.other';

    /** A refusal of a write naming no package, of a name two packages hold. */
    const refusedAmbiguous = (res: any) => {
        expect(res.statusCode, JSON.stringify(res.body)).toBe(409);
        expect(res.body.code).toBe('RESOURCE_CONFLICT');
        return res.body;
    };

    it('the card\'s probe: the package-less save writes the package\'s row and the read serves it; the package-less delete removes that row', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));

        const saved = ok(await h.save(view('disabled')));
        expect(saved.message).toContain(`package=${PKG}`);
        expect(await h.stored('active')).toEqual([{ label: 'disabled', packageId: PKG }]);
        expect(ok(await h.read()).item.label).toBe('disabled');

        const deleted = ok(await h.remove());
        expect(deleted.reset).toBe(true);
        expect(await h.stored('active')).toEqual([]);
    }, 60_000);

    it('two packages: the package-less save and delete are refused 409 and change nothing; `?package=` on the delete removes that row only', async () => {
        const h = await boot();
        ok(await h.save(view('A'), { package: PKG }));
        ok(await h.save(view('B'), { package: OTHER_PKG }));
        const both = [{ label: 'A', packageId: PKG }, { label: 'B', packageId: OTHER_PKG }];

        expect(refusedAmbiguous(await h.save(view('neither'))).error).toContain(OTHER_PKG);
        expect(refusedAmbiguous(await h.remove()).error).toContain(OTHER_PKG);
        expect(await h.stored('active')).toEqual(expect.arrayContaining(both));
        expect(await h.stored('active')).toHaveLength(2);

        const deleted = ok(await h.remove({ package: PKG }));
        expect(deleted.reset).toBe(true);
        expect(deleted.message).toContain(OTHER_PKG);
        expect(await h.stored('active')).toEqual([{ label: 'B', packageId: OTHER_PKG }]);
        expect(ok(await h.read()).item.label).toBe('B');
    }, 60_000);

    it('control: an item with no package binding is saved and deleted at the package-unbound row, as before', async () => {
        const h = await boot();
        ok(await h.save(view('plain')));
        expect(await h.stored('active')).toEqual([{ label: 'plain', packageId: null }]);
        expect(ok(await h.remove()).reset).toBe(true);
        expect(await h.stored('active')).toEqual([]);
    }, 60_000);
});

/**
 * [#23495, ADR-0048] The draft doors that name no package, on the real routes:
 * the per-item publish (`POST …/publish`) and the draft discard
 * (`DELETE …?state=draft`) act on the draft the draft save naming no package
 * writes (`PUT …?mode=draft`), which the strict draft read serves. Measured on
 * these routes before the fix: over an item bound to a package, the publish
 * promoted the package-unbound draft beside the package's (the store returns
 * it first) into a package-less active row, and with the only draft bound to
 * another package the publish promoted it into a second package's active row
 * and the discard removed it, while the read answered `404 NO_DRAFT`. The
 * protocol suite (`protocol.packageless-save-address.test.ts` in
 * metadata-protocol) holds the rest of the matrix, both storage orders
 * included, over a stub engine.
 */
describe('[#23495] the draft doors naming no package act on the draft the draft save writes, on the real routes', () => {
    const OTHER_PKG = 'com.probe.other';

    /** Drafts `[package-unbound, PKG]` over an active row bound to `PKG`. */
    const stateOne = async () => {
        const h = await boot();
        ok(await h.save(view('stale'), { mode: 'draft' }));
        ok(await h.save(view('live'), { package: PKG }));
        ok(await h.save(view('pending'), { mode: 'draft', package: PKG }));
        return h;
    };
    /** The active row bound to `PKG`, the only draft bound to `OTHER_PKG`. */
    const stateTwo = async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));
        ok(await h.save(view('other'), { mode: 'draft', package: OTHER_PKG }));
        return h;
    };

    it('drafts [package-unbound, P] over P: the save, the read, the publish and the discard all address P\'s draft', async () => {
        const s = await stateOne();
        const saved = ok(await s.save(view('saved'), { mode: 'draft' }));
        expect(saved.message).toContain(`package=${PKG}`);
        expect(await s.stored('draft')).toEqual(expect.arrayContaining([{ label: 'saved', packageId: PKG }, { label: 'stale', packageId: null }]));

        const r = await stateOne();
        expect(ok(await r.read({ state: 'draft' })).item.label).toBe('pending');

        const p = await stateOne();
        ok(await p.publish());
        expect(await p.stored('active')).toEqual([{ label: 'pending', packageId: PKG }]);
        expect(await p.stored('draft')).toEqual([{ label: 'stale', packageId: null }]);
        expect(ok(await p.read()).item.label).toBe('pending');

        const d = await stateOne();
        expect(ok(await d.remove({ state: 'draft' })).reset).toBe(true);
        expect(await d.stored('draft')).toEqual([{ label: 'stale', packageId: null }]);
    }, 60_000);

    it('the only draft bound to another package: the publish answers 404 NO_DRAFT as the read does, the discard removes nothing, and ?package= reaches it', async () => {
        const r = await stateTwo();
        const read = await r.read({ state: 'draft' });
        expect(read.statusCode).toBe(404);
        expect(read.body.code).toBe('NO_DRAFT');

        const p = await stateTwo();
        const published = await p.publish();
        expect(published.statusCode, JSON.stringify(published.body)).toBe(404);
        expect(published.body.code).toBe('NO_DRAFT');
        expect(published.body.error).toContain(OTHER_PKG);
        expect(await p.stored('active')).toEqual([{ label: 'live', packageId: PKG }]);
        expect(await p.stored('draft')).toEqual([{ label: 'other', packageId: OTHER_PKG }]);

        const d = await stateTwo();
        const discarded = ok(await d.remove({ state: 'draft' }));
        expect(discarded.reset).toBe(false);
        expect(discarded.message).toContain(OTHER_PKG);
        expect(await d.stored('draft')).toEqual([{ label: 'other', packageId: OTHER_PKG }]);

        const named = await stateTwo();
        ok(await named.publish({ package: OTHER_PKG }));
        expect(await named.stored('draft')).toEqual([]);
        expect(await named.stored('active')).toEqual(expect.arrayContaining([{ label: 'other', packageId: OTHER_PKG }]));
    }, 60_000);

    it('active rows bound to two packages: the publish and the discard naming none are refused 409 RESOURCE_CONFLICT, as the draft save is', async () => {
        const build = async () => {
            const h = await boot();
            ok(await h.save(view('A'), { package: PKG }));
            ok(await h.save(view('B'), { package: OTHER_PKG }));
            ok(await h.save(view('pending'), { mode: 'draft', package: PKG }));
            return h;
        };
        for (const door of ['save', 'publish', 'discard'] as const) {
            const h = await build();
            const res = door === 'save'
                ? await h.save(view('saved'), { mode: 'draft' })
                : door === 'publish' ? await h.publish() : await h.remove({ state: 'draft' });
            expect(res.statusCode, `${door}: ${JSON.stringify(res.body)}`).toBe(409);
            expect(res.body.code, door).toBe('RESOURCE_CONFLICT');
            expect(await h.stored('draft'), door).toEqual([{ label: 'pending', packageId: PKG }]);
            expect(await h.stored('active'), door).toHaveLength(2);
        }
    }, 60_000);
});

/**
 * [#23657, ADR-0048, ADR-0070 TL;DR 1] An item never published into a package
 * (no active row bound to one), whose drafts are bound to packages: the draft
 * save naming no package takes the address the publish and the discard naming
 * none take (#23495). With no package-unbound draft and exactly one package's
 * draft, that draft is the address, so the save updates it instead of minting a
 * package-unbound draft beside it; with two or more packages' drafts the save
 * is refused `409 RESOURCE_CONFLICT` with the `?package=` remedy, as the
 * publish and the discard are. Measured on these routes before the fix: the
 * save answered `200` and the drafts became `[package-unbound, Q]`, after
 * which the publish and the discard acted on the package-unbound one.
 */
describe('[#23657] an item never published into a package: the draft save naming no package takes the draft doors\' address', () => {
    const Q = 'com.probe.q';
    const R = 'com.probe.r';

    /** No active row; the only draft bound to `Q`. */
    const corner = async () => {
        const h = await boot();
        ok(await h.save(view('pending'), { mode: 'draft', package: Q }));
        return h;
    };

    it('the only draft bound to Q: the save updates Q\'s draft, and the read, the publish and the discard naming none act on it', async () => {
        const s = await corner();
        const saved = ok(await s.save(view('saved'), { mode: 'draft' }));
        expect(saved.message).toContain(`package=${Q}`);
        expect(await s.stored('draft')).toEqual([{ label: 'saved', packageId: Q }]);
        // The strict draft read serves that draft, with the version the save
        // answered, which a second save pinned to it is accepted against.
        const read = ok(await s.read({ state: 'draft' }));
        expect(read.item.label).toBe('saved');
        expect(read.version).toMatch(KEYED);
        expect(read.version).toBe(saved.version);
        ok(await s.save(view('saved again'), { mode: 'draft' }, { 'if-match': read.version }));
        expect(await s.stored('draft')).toEqual([{ label: 'saved again', packageId: Q }]);

        ok(await s.publish());
        expect(await s.stored('active')).toEqual([{ label: 'saved again', packageId: Q }]);
        expect(await s.stored('draft')).toEqual([]);

        const d = await corner();
        ok(await d.save(view('saved'), { mode: 'draft' }));
        const discarded = ok(await d.remove({ state: 'draft' }));
        expect(discarded.reset).toBe(true);
        expect(await d.stored('draft')).toEqual([]);
    }, 60_000);

    it('the only draft bound to Q: a first-write pin (`If-None-Match: *`) is refused 409 METADATA_CONFLICT, because Q\'s draft is the row it writes', async () => {
        const s = await corner();
        refusedConflict(await s.save(view('first?'), { mode: 'draft' }, { 'if-none-match': '*' }));
        expect(await s.stored('draft')).toEqual([{ label: 'pending', packageId: Q }]);
    }, 60_000);

    it('the discard receipt names the package of the draft it removed; a package-unbound draft\'s receipt reads as before', async () => {
        const d = await corner();
        const bound = ok(await d.remove({ state: 'draft' }));
        expect(bound.message).toContain(`(package=${Q})`);

        const u = await boot();
        ok(await u.save(view('plain'), { mode: 'draft' }));
        const unbound = ok(await u.remove({ state: 'draft' }));
        expect(unbound.message).toBe(`Draft discarded — view/case_grid. [seq=${unbound.seq}]`);
    }, 60_000);

    it('drafts bound to two packages and no package-unbound draft: the save naming none is refused 409 RESOURCE_CONFLICT, as the publish and the discard are, and writes nothing', async () => {
        const build = async () => {
            const h = await boot();
            ok(await h.save(view('q'), { mode: 'draft', package: Q }));
            ok(await h.save(view('r'), { mode: 'draft', package: R }));
            return h;
        };
        const both = [{ label: 'q', packageId: Q }, { label: 'r', packageId: R }];
        for (const door of ['save', 'publish', 'discard'] as const) {
            const h = await build();
            const res = door === 'save'
                ? await h.save(view('saved'), { mode: 'draft' })
                : door === 'publish' ? await h.publish() : await h.remove({ state: 'draft' });
            expect(res.statusCode, `${door}: ${JSON.stringify(res.body)}`).toBe(409);
            expect(res.body.code, door).toBe('RESOURCE_CONFLICT');
            expect(res.body.error, door).toContain('?package=');
            expect(res.body.error, door).toContain(R);
            expect(await h.stored('draft'), door).toEqual(expect.arrayContaining(both));
            expect(await h.stored('draft'), door).toHaveLength(2);
            expect(await h.stored('active'), door).toEqual([]);
        }
        // The remedy: naming the package saves that package's draft.
        const named = await build();
        ok(await named.save(view('saved'), { mode: 'draft', package: R }));
        expect(await named.stored('draft')).toEqual(expect.arrayContaining([{ label: 'q', packageId: Q }, { label: 'saved', packageId: R }]));
    }, 60_000);

    it('control: an item with an active binding inherits the active row\'s package, whatever package another draft is bound to', async () => {
        const h = await boot();
        ok(await h.save(view('live'), { package: PKG }));
        ok(await h.save(view('pending'), { mode: 'draft', package: Q }));
        const saved = ok(await h.save(view('saved'), { mode: 'draft' }));
        expect(saved.message).toContain(`package=${PKG}`);
        expect(await h.stored('draft')).toEqual(expect.arrayContaining([{ label: 'pending', packageId: Q }, { label: 'saved', packageId: PKG }]));
        expect(await h.stored('draft')).toHaveLength(2);
    }, 60_000);

    it('control: a package-unbound draft is the address whatever packages\' drafts sit beside it, as for the publish and the discard', async () => {
        const only = await boot();
        ok(await only.save(view('plain'), { mode: 'draft' }));
        const saved = ok(await only.save(view('plain 2'), { mode: 'draft' }));
        expect(saved.message).not.toContain('package=');
        expect(await only.stored('draft')).toEqual([{ label: 'plain 2', packageId: null }]);

        const beside = await boot();
        ok(await beside.save(view('plain'), { mode: 'draft' }));
        ok(await beside.save(view('q'), { mode: 'draft', package: Q }));
        ok(await beside.save(view('r'), { mode: 'draft', package: R }));
        ok(await beside.save(view('plain 2'), { mode: 'draft' }));
        expect(await beside.stored('draft')).toEqual(expect.arrayContaining([
            { label: 'plain 2', packageId: null }, { label: 'q', packageId: Q }, { label: 'r', packageId: R },
        ]));
        expect(await beside.stored('draft')).toHaveLength(3);
    }, 60_000);
});

describe('[#23715] the strict draft read naming no package serves its content from the draft its version names, on the real routes', () => {
    const Q = 'com.probe.q';

    /**
     * No active row; drafts `[package-unbound, Q]` in either storage order.
     * Stored second, the package-unbound draft is seeded, as an older build
     * left it (#23657: a draft save naming no package now updates Q's only
     * draft).
     */
    const ORDERS = {
        'the package-unbound draft saved first': async () => {
            const h = await boot();
            ok(await h.save(view('unbound'), { mode: 'draft' }));
            ok(await h.save(view('q'), { mode: 'draft', package: Q }));
            return h;
        },
        'Q\'s draft saved first': async () => {
            const h = await boot();
            ok(await h.save(view('q'), { mode: 'draft', package: Q }));
            await h.seed('draft', null, view('unbound'));
            return h;
        },
        // Both seeded, Q's first, in insertion order and in id order
        // (`seed_draft_com.probe.q` < `seed_draft_unbound`). Measured: this
        // store still answers a package-agnostic lookup with the
        // package-unbound row, whose NULL `package_id` sorts first in
        // `sys_metadata`'s `(type, name, package_id, bundle_member)` index, so
        // here content and version agreed before the fix too, by index order
        // alone; the protocol suite's in-memory double is the order that
        // diverged.
        'both seeded, Q\'s first': async () => {
            const h = await boot();
            await h.seed('draft', Q, view('q'));
            await h.seed('draft', null, view('unbound'));
            return h;
        },
    } as const;

    for (const [order, build] of Object.entries(ORDERS)) {
        it(`drafts [package-unbound, Q] (${order}): content and version are the package-unbound draft's, and an If-Match save edits the row read`, async () => {
            const h = await build();
            const read = ok(await h.read({ state: 'draft' }));
            expect(read.item.label).toBe('unbound');
            expect(read.version).toMatch(KEYED);
            const q = ok(await h.read({ state: 'draft', package: Q }));
            expect(q.item.label).toBe('q');
            expect(q.version).not.toBe(read.version);

            ok(await h.save(view('edited'), { mode: 'draft' }, { 'if-match': read.version }));
            expect(await h.stored('draft')).toEqual(expect.arrayContaining([
                { label: 'edited', packageId: null }, { label: 'q', packageId: Q },
            ]));
            expect(await h.stored('draft')).toHaveLength(2);
            expect(ok(await h.read({ state: 'draft' })).item.label).toBe('edited');
        }, 60_000);
    }

    it('control: a single draft is served with the version its save answered', async () => {
        const h = await boot();
        const saved = ok(await h.save(view('only'), { mode: 'draft', package: Q }));
        const read = ok(await h.read({ state: 'draft' }));
        expect(read.item.label).toBe('only');
        expect(read.version).toBe(saved.version);
    }, 60_000);
});
