// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29814] The layered view serves the pending draft as a layer —
 * `GetMetaItemLayeredResponseSchema.draft` — on BOTH transports and both
 * spellings: the draft row exactly as stored, untranslated, ungoverned, with no
 * injected columns, so an edit buffer built from `draft ?? overlay ?? code` and
 * saved back writes what the author wrote.
 *
 * ## What the doors answered before
 *
 * The layers carried no draft, and the one read of a pending draft,
 * `GET /meta/:type/:name?state=draft`, serves it translated for the caller's
 * locale and governed (the platform's injected columns added). Studio and Setup
 * built their edit buffer from that body and saved it back.
 *
 * ## The admission
 *
 * The draft layer is pending authoring work, so it is read only for a caller
 * the draft-read admission admits (`mayReadPendingDrafts`, the one predicate
 * every draft switch asks). Any other caller is answered the layers with NO
 * `draft` key — "not served", which says nothing about whether a draft exists —
 * and a never-published name stays that caller's absence.
 *
 * ## The rig
 *
 * `meta-layers-ambiguous-package.test.ts`'s: each door its own REAL store
 * (better-sqlite3 `:memory:`, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation`) seeded through the protocol and, for a
 * legacy row no save door accepts, straight into `sys_metadata`;
 * `RestServer`'s registered handlers, and the catch-all's four statements into
 * the real `HttpDispatcher.dispatch()`. Both serve the same i18n service, so a
 * `zh-CN` read is really translated where the doors translate.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const META = `${PREFIX}/meta`;
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const CRM = 'com.acme.crm';
const PKG_A = 'com.alpha.pkg';
const PKG_B = 'com.beta.pkg';

const CALLERS = {
    /** Seeds through the doors' own protocol: the machine-write shape. */
    system: { isSystem: true },
    /** May open the item; holds no authoring capability, so the draft admission does not admit it. */
    member: { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] },
    /** `manage_metadata`: admitted to pending drafts, and may write the item. */
    author: { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] },
    /** Admitted to pending drafts (`studio.access`); holds no `finance.access`. */
    studioBuilder: { userId: 'u_studio', isSystem: false, systemPermissions: ['studio.access'] },
    /** An author who may also read datasource metadata (`manage_platform_settings`). */
    platformAdmin: { userId: 'u_platform', isSystem: false, systemPermissions: ['manage_metadata', 'manage_platform_settings'] },
} as const;
type CallerName = keyof typeof CALLERS;

/** The published object: its label and its field's label are what the zh-CN catalog translates. */
const TASK = {
    name: 'crm_task',
    label: 'Task',
    sharingModel: 'private',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
};
/** The author's pending edit: the same labels, in the source language, plus a field of their own. */
const TASK_DRAFT = {
    name: 'crm_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        due_on: { name: 'due_on', type: 'date', label: 'Due on' },
    },
};
/** Published, with no pending draft. */
const NOTE = { name: 'crm_note', label: 'Note', sharingModel: 'private', fields: { body: { name: 'body', type: 'text', label: 'Body' } } };
/** Never published: a draft row and nothing else. */
const BEACON_DRAFT = { name: 'beacon_dash', label: 'Beacon draft', widgets: [] };
/** An app draft with an entry only `finance.access` holders are shown. */
const LEDGER_APP_DRAFT = {
    name: 'ledger_app',
    label: 'Ledger',
    navigation: [
        { id: 'nav_home', type: 'page', label: 'Home', pageName: 'ledger_home' },
        { id: 'nav_finance_close', type: 'page', label: 'Close', pageName: 'ledger_close', requiredPermissions: ['finance.access'] },
    ],
};
/** A legacy datasource draft whose config still holds a cleartext credential. */
const WAREHOUSE_DRAFT = {
    name: 'warehouse',
    label: 'Warehouse',
    driver: 'postgres',
    config: { host: 'db.internal', database: 'wh', password: 'hunter2-draft' },
};

const BUNDLE: Record<string, any> = {
    en: { objects: { crm_task: { label: 'Task', fields: { title: { label: 'Title' } } }, crm_note: { label: 'Note' } } },
    'zh-CN': {
        objects: {
            crm_task: { label: '任务', fields: { title: { label: '标题' }, due_on: { label: '截止日期' } } },
            crm_note: { label: '备注' },
        },
    },
};
const i18n = {
    getLocales: () => Object.keys(BUNDLE),
    getTranslations: (locale: string) => BUNDLE[locale] ?? {},
    getDefaultLocale: () => 'en',
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterAll(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** One real store, seeded; `storedDraft` reads a draft row's body back from the table itself. */
async function bootStore() {
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
    for (const id of [CRM, PKG_A, PKG_B]) {
        engine.registry.installPackage({ id, name: id, version: '1.0.0' } as any, 'authored');
    }
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const save = (mode: 'draft' | 'publish', type: string, item: { name: string; [key: string]: unknown }, packageId?: string) =>
        protocol.saveMetaItem({ type, name: item.name, item: clone(item), mode, ...(packageId ? { packageId } : {}) } as any);
    const draft = (type: string, item: { name: string; [key: string]: unknown }, packageId?: string) => save('draft', type, item, packageId);
    // Tenant-authored objects, as Studio edits them: published, then edited.
    await save('publish', 'object', TASK, CRM);
    await save('publish', 'object', NOTE, CRM);
    await draft('object', TASK_DRAFT, CRM);
    await draft('dashboard', { name: 'twin_dash', label: 'alpha draft', widgets: [] }, PKG_A);
    await draft('dashboard', { name: 'twin_dash', label: 'beta draft', widgets: [] }, PKG_B);
    await draft('dashboard', BEACON_DRAFT);
    await draft('app', LEDGER_APP_DRAFT);
    // No save door accepts a cleartext credential: a row written before that
    // refusal existed is stored as it was, which is what this seeds.
    await engine.insert('sys_metadata', {
        type: 'datasource', name: WAREHOUSE_DRAFT.name, state: 'draft', package_id: null,
        metadata: JSON.stringify(WAREHOUSE_DRAFT),
    });

    const storedDraft = async (type: string, name: string, packageId: string | null = null): Promise<unknown> => {
        const rows = await engine.find('sys_metadata', { where: { type, name, state: 'draft' } });
        const row = (rows ?? []).find((r: any) => (r.package_id ?? null) === packageId);
        if (!row) throw new Error(`no stored ${type}/${name} draft in ${packageId}`);
        return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    };
    return { protocol, storedDraft };
}

interface Answer { status: number; body: any }
interface Door {
    get(who: CallerName, path: string, query?: Record<string, string>, locale?: string): Promise<Answer>;
    storedDraft(type: string, name: string, packageId?: string | null): Promise<unknown>;
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

async function bootRestServer(): Promise<Door> {
    const { protocol, storedDraft } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    let caller: CallerName = 'system';
    rest.resolveExecCtx = async () => clone(CALLERS[caller]);
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
    rest.i18nServiceProvider = async () => i18n;
    rest.registerRoutes();
    return {
        storedDraft,
        get: async (who, path, query = {}, locale = 'zh-CN') => {
            caller = who;
            const s = path.replace(/^\/meta\//, '').split('/');
            const layered = s.length === 3 && s[2] === 'layers';
            const route = layered ? `${META}/:type/:name/layers` : `${META}/:type/:name`;
            const entry = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === route);
            if (!entry) throw new Error(`GET ${route} is not registered`);
            const res = makeRes();
            await entry.handler({
                method: 'GET', path: `${PREFIX}${path}`, params: { type: s[0], name: s[1] }, query: { ...query },
                headers: { 'accept-language': locale }, body: {},
            }, res);
            return { status: res.statusCode, body: res.body };
        },
    };
}

/** The catch-all's four statements (see `meta-package-all-fold.test.ts`). */
async function catchAll(dispatcher: HttpDispatcher, raw: Request) {
    const subPath = new URL(raw.url).pathname.substring(PREFIX.length);
    const queryParams: Record<string, any> = {};
    new URL(raw.url).searchParams.forEach((val, key) => { queryParams[key] = val; });
    return dispatcher.dispatch(raw.method, subPath, undefined, queryParams, { request: raw }, PREFIX);
}

async function bootCatchAll(): Promise<Door> {
    const { protocol, storedDraft } = await bootStore();
    const services: Record<string, unknown> = { protocol, i18n };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    let caller: CallerName = 'system';
    (dispatcher as any).timedResolveExecutionContext = async () => clone(CALLERS[caller]);
    return {
        storedDraft,
        get: async (who, path, query = {}, locale = 'zh-CN') => {
            caller = who;
            const url = new URL(`http://localhost${PREFIX}${path}`);
            for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
            const res = await catchAll(dispatcher, new Request(url, { method: 'GET', headers: { 'accept-language': locale } }));
            return { status: res.response?.status ?? 0, body: res.response?.body };
        },
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

/** The served body: `RestServer` answers bare, the dispatcher under `data`. */
const bodyOf = (a: Answer) => {
    expect(a.status, JSON.stringify(a.body).slice(0, 400)).toBe(200);
    return a.body?.data ?? a.body;
};
/** The two spellings of the layered view. */
const SPELLINGS: ReadonlyArray<readonly [string, (type: string, name: string) => [string, Record<string, string>]]> = [
    ['/layers', (type, name) => [`/meta/${type}/${name}/layers`, {}]],
    ['?layers=true', (type, name) => [`/meta/${type}/${name}`, { layers: 'true' }]],
];

for (const [doorName, boot] of DOORS) {
    describe(`[#29814] ${doorName}: the layered view's draft layer`, () => {
        let door: Door;
        beforeAll(async () => {
            door = await boot();
        }, 60_000);

        it('a zh-CN read serves the pending draft byte for byte as stored: source labels, no injected column', async () => {
            const stored = await door.storedDraft('object', 'crm_task', CRM);
            for (const [spelling, at] of SPELLINGS) {
                const [path, query] = at('object', 'crm_task');
                const layers = bodyOf(await door.get('author', path, { ...query, package: CRM }));
                expect(JSON.stringify(layers.draft), spelling).toBe(JSON.stringify(stored));
                expect(layers.draft.label, spelling).toBe('Task');
                expect(Object.keys(layers.draft.fields).sort(), spelling).toEqual(['due_on', 'title']);
                // The published layers are what they were.
                expect(layers.overlay, spelling).toMatchObject({ name: 'crm_task', label: 'Task' });
            }
        }, 60_000);

        it('the ?state=draft item read is unchanged: the same draft, translated and governed', async () => {
            const stored: any = await door.storedDraft('object', 'crm_task', CRM);
            const item = bodyOf(await door.get('author', '/meta/object/crm_task', { state: 'draft', package: CRM })).item;
            expect(item.label).toBe('任务');
            expect(item.fields.title.label).toBe('标题');
            // Governed: the platform's injected columns sit beside the author's fields.
            const injected = Object.keys(item.fields).filter((f) => !(f in stored.fields));
            expect(injected.length, Object.keys(item.fields).join(',')).toBeGreaterThan(0);
            // …none of which is on the draft layer.
            const [path] = SPELLINGS[0][1]('object', 'crm_task');
            const layers = bodyOf(await door.get('author', path, { package: CRM }));
            for (const f of injected) expect(f in layers.draft.fields, f).toBe(false);
        }, 60_000);

        it('an item with no pending draft answers `draft: null`', async () => {
            for (const [spelling, at] of SPELLINGS) {
                const [path, query] = at('object', 'crm_note');
                const layers = bodyOf(await door.get('author', path, { ...query, package: CRM }));
                expect('draft' in layers, spelling).toBe(true);
                expect(layers.draft, spelling).toBeNull();
                expect(layers.overlay, spelling).toMatchObject({ name: 'crm_note' });
            }
        }, 60_000);

        it('?package= picks that package\'s draft', async () => {
            for (const [spelling, at] of SPELLINGS) {
                const [path, query] = at('dashboard', 'twin_dash');
                for (const [pkg, label] of [[PKG_A, 'alpha draft'], [PKG_B, 'beta draft']] as const) {
                    const layers = bodyOf(await door.get('author', path, { ...query, package: pkg }));
                    expect(JSON.stringify(layers.draft), `${spelling} ${pkg}`)
                        .toBe(JSON.stringify(await door.storedDraft('dashboard', 'twin_dash', pkg)));
                    expect(layers.draft.label, `${spelling} ${pkg}`).toBe(label);
                }
            }
        }, 60_000);

        it('a never-published name is served to an author as its draft layer', async () => {
            const stored = await door.storedDraft('dashboard', 'beacon_dash');
            for (const [spelling, at] of SPELLINGS) {
                const [path, query] = at('dashboard', 'beacon_dash');
                const layers = bodyOf(await door.get('author', path, query));
                expect(JSON.stringify(layers.draft), spelling).toBe(JSON.stringify(stored));
                expect([layers.code, layers.overlay, layers.effective], spelling).toEqual([null, null, null]);
            }
        }, 60_000);

        it('a credential in the stored draft is redacted, and the rest is served as stored', async () => {
            const stored: any = await door.storedDraft('datasource', 'warehouse');
            expect(stored.config.password).toBe('hunter2-draft');
            for (const [spelling, at] of SPELLINGS) {
                const [path, query] = at('datasource', 'warehouse');
                const answer = await door.get('platformAdmin', path, query);
                const layers = bodyOf(answer);
                expect(JSON.stringify(answer.body), spelling).not.toContain('hunter2-draft');
                expect(layers.draft.config.password, spelling).toBeUndefined();
                const { password: _withheld, ...rest } = stored.config;
                expect(layers.draft.config, spelling).toMatchObject(rest);
                expect(layers.draft.name, spelling).toBe('warehouse');
            }
        }, 60_000);

        it('the draft layer is gated per caller as the ?state=draft read gates it: whole for an author, pruned otherwise', async () => {
            const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);
            for (const [spelling, at] of SPELLINGS) {
                const [path, query] = at('app', 'ledger_app');
                for (const [who, expected] of [
                    ['author', ['nav_home', 'nav_finance_close']],
                    ['studioBuilder', ['nav_home']],
                ] as const) {
                    const layers = bodyOf(await door.get(who, path, query));
                    const item = bodyOf(await door.get(who, '/meta/app/ledger_app', { state: 'draft' })).item;
                    expect(navIds(layers.draft), `${spelling} ${who}`).toEqual(expected);
                    expect(navIds(layers.draft), `${spelling} ${who}`).toEqual(navIds(item));
                }
            }
        }, 60_000);

        it('a caller the draft admission does not admit gets no `draft` key, and a draft-only name stays absent', async () => {
            for (const [spelling, at] of SPELLINGS) {
                const [taskPath, taskQuery] = at('object', 'crm_task');
                const task = await door.get('member', taskPath, { ...taskQuery, package: CRM });
                const layers = bodyOf(task);
                expect('draft' in layers, spelling).toBe(false);
                expect(JSON.stringify(task.body), spelling).not.toContain('due_on');
                // The control: the same read for the author carries the draft.
                expect('draft' in bodyOf(await door.get('author', taskPath, { ...taskQuery, package: CRM })), spelling).toBe(true);

                const [notePath, noteQuery] = at('object', 'crm_note');
                expect('draft' in bodyOf(await door.get('member', notePath, { ...noteQuery, package: CRM })), spelling).toBe(false);

                const [beaconPath, beaconQuery] = at('dashboard', 'beacon_dash');
                const beacon = await door.get('member', beaconPath, beaconQuery);
                expect(beacon.status, spelling).toBe(404);
                expect(JSON.stringify(beacon.body), spelling).not.toContain('Beacon draft');
            }
        }, 60_000);
    });
}
