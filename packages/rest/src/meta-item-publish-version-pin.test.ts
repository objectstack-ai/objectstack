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
    /** `GET /meta/view/case_grid?state=draft` — the strict draft read. */
    const readDraft = () => call('GET', `${META}/:type/:name`, { path, params: item, query: { state: 'draft' } });
    /** `POST /meta/view/case_grid/publish`, with the body given (`{}` when none). */
    const publish = (headers: Record<string, string> = {}, body: Record<string, unknown> = {}) =>
        call('POST', `${META}/:type/:name/publish`, { path: `${path}/publish`, params: item, headers, body });
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

    return { protocol, layers, read, readDraft, save, publish, studioSave, stored };
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

    it('a publish landing inside the `/layers` read never pairs the old body with the new token (contract review S1)', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        // Another editor's Save lands right AFTER this read has taken the
        // overlay body, and before it answers. Read after the body, the token
        // would be the new row's: a buffer of the old body pinned to the
        // current version, whose Save then overwrites without a prompt.
        const proto: any = h.protocol;
        const original = proto.findServedOverlayRow.bind(proto);
        let landed = false;
        proto.findServedOverlayRow = async (...args: unknown[]) => {
            const served = await original(...args);
            if (!landed) {
                landed = true;
                ok(await h.studioSave('by the other editor'));
            }
            return served;
        };
        const lay = ok(await h.layers());
        proto.findServedOverlayRow = original;
        expect(landed).toBe(true);
        expect(lay.overlay.label).toBe('live');

        // The token is the body's own row's (or older), never the newer one:
        // the Save built on this read is refused and asked about.
        const current = ok(await h.layers()).overlayVersion;
        expect(lay.overlayVersion).toMatch(KEYED);
        expect(lay.overlayVersion).not.toBe(current);
        const refused = refusedConflict(await h.studioSave('built on the old body', { 'if-match': lay.overlayVersion }));
        expect(refused.currentVersion).toBe(current);
        expect(await h.stored('active')).toEqual(['by the other editor']);
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


/**
 * [#36350, ruling 7168616260] The per-item publish takes a pin on the DRAFT
 * it promotes: `draftVersion` in the publish body, beside `message`. "Save to
 * this view" writes a draft and then publishes it; a draft write by someone
 * else landing in between (the view's rename / pin / set-default, which is
 * `ObjectStackAdapter.updateView`'s draft branch) is refused at the publish
 * instead of going live under Save's name: an unpublished draft is never
 * published on someone else's behalf (ruling 7058616478). `If-Match` keeps its
 * shipped meaning, the active row's token, and the two are sent together.
 */
describe('[#36350] the publish door\'s draft pin (`draftVersion`)', () => {
    /** "Save to this view" up to its publish: the draft over "no draft", and the active token it loaded. */
    const saveToThisViewDraft = async (h: Awaited<ReturnType<typeof boot>>, label: string) => {
        const loaded = ok(await h.layers()).overlayVersion as string;
        const receipt = ok(await h.save(view(label), { mode: 'draft' }, { 'if-none-match': '*' }));
        return { loaded, draftVersion: receipt.version as string };
    };

    it('acceptance: an updateView draft write inside the window is refused at Save\'s publish — 409, nothing unreviewed is published', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const saved = await saveToThisViewDraft(h, 'save to this view');
        expect(saved.draftVersion).toMatch(KEYED);

        // updateView's draft branch, inside the window: it reads the pending
        // draft (Save's own), merges, and writes it back pinned to what it read.
        const read = ok(await h.readDraft());
        expect(read.version).toBe(saved.draftVersion);
        const renamed = ok(await h.save(
            { ...view('save to this view'), label: 'renamed, meant as a draft' },
            { mode: 'draft' },
            { 'if-match': read.version },
        ));

        // Save's publish, pinned to both rows it knows.
        const refused = refusedConflict(await h.publish({ 'if-match': saved.loaded }, { draftVersion: saved.draftVersion }));
        // The refusal names the DRAFT's current token, which the draft read serves.
        expect(refused.currentVersion).toBe(renamed.version);
        expect(ok(await h.readDraft()).version).toBe(refused.currentVersion);
        expect(MetadataConflictErrorSchema.parse(refused).currentVersion).toBe(renamed.version);
        // Nothing promoted: the live row is untouched and the rename stays a pending draft.
        expect(await h.stored('active')).toEqual(['live']);
        expect(await h.stored('draft')).toEqual(['renamed, meant as a draft']);
    }, 60_000);

    it('acceptance: an UNPINNED updateView draft write inside the window is refused the same way', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const saved = await saveToThisViewDraft(h, 'save to this view');
        ok(await h.save({ ...view('save to this view'), label: 'renamed, meant as a draft' }, { mode: 'draft' }));

        refusedConflict(await h.publish({ 'if-match': saved.loaded }, { draftVersion: saved.draftVersion }));
        expect(await h.stored('active')).toEqual(['live']);
        expect(await h.stored('draft')).toEqual(['renamed, meant as a draft']);
    }, 60_000);

    it('control: with no write in the window the pinned publish promotes Save\'s draft', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const saved = await saveToThisViewDraft(h, 'save to this view');
        const published = ok(await h.publish({ 'if-match': saved.loaded }, { draftVersion: saved.draftVersion }));
        expect(await h.stored('active')).toEqual(['save to this view']);
        expect(await h.stored('draft')).toEqual([]);
        expect(ok(await h.layers()).overlayVersion).toBe(published.version);
    }, 60_000);

    it('absent `draftVersion` is unpinned, as before: the publish promotes whichever draft is pending', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const saved = await saveToThisViewDraft(h, 'save to this view');
        ok(await h.save({ ...view('save to this view'), label: 'renamed, meant as a draft' }, { mode: 'draft' }));
        ok(await h.publish({ 'if-match': saved.loaded }));
        expect(await h.stored('active')).toEqual(['renamed, meant as a draft']);
    }, 60_000);

    it('a pinned draft no longer pending is refused 409 with `currentVersion: null`, promoting nothing', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const saved = await saveToThisViewDraft(h, 'save to this view');
        // Someone else publishes the draft first; it is no longer pending.
        const theirs = ok(await h.publish());
        const refused = refusedConflict(await h.publish({}, { draftVersion: saved.draftVersion }));
        expect(refused.currentVersion).toBeNull();
        expect(ok(await h.layers()).overlayVersion).toBe(theirs.version);
    }, 60_000);

    it('the draft pin and the active pin judge different rows: a draft token sent as `If-Match` still answers the active row\'s refusal', async () => {
        const h = await boot();
        ok(await h.save(view('live')));
        const saved = await saveToThisViewDraft(h, 'save to this view');
        // If-Match keeps its shipped meaning (ruling 7168616260, item 2).
        const refused = refusedConflict(await h.publish({ 'if-match': saved.draftVersion }, { draftVersion: saved.draftVersion }));
        expect(refused.currentVersion).toBe(saved.loaded);
        expect(await h.stored('active')).toEqual(['live']);
        expect(await h.stored('draft')).toEqual(['save to this view']);
    }, 60_000);

    for (const [label, draftVersion] of Object.entries({ 'a number': 42, 'null': null, 'an object': { v: 'x' } })) {
        it(`a \`draftVersion\` that is ${label} is refused 400 VALIDATION_ERROR, never read as unpinned`, async () => {
            const h = await boot();
            ok(await h.save(view('live')));
            ok(await h.save(view('pending'), { mode: 'draft' }));
            const res = await h.publish({}, { draftVersion });
            expect(res.statusCode, JSON.stringify(res.body)).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(await h.stored('active')).toEqual(['live']);
            expect(await h.stored('draft')).toEqual(['pending']);
        }, 60_000);
    }
});
