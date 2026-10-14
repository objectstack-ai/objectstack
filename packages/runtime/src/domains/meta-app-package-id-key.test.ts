// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23183, ADR-0048 §3.1] The app access verdict is answerable by PACKAGE ID,
 * on both hosts: `RestServer`'s `GET /meta/:type/:name` and the runtime
 * dispatcher's `/meta` item read (the only answer on a host that mounts just
 * `@objectstack/hono`'s `${prefix}/*` catch-all).
 *
 * ## What was missing
 *
 * ADR-0048 §3.1 makes the package id the app's route key, so the console opens
 * an app at `/apps/<packageId>`, and when that app is not in the caller's list
 * it must tell a withheld app (403) from a missing one (404). By name the read
 * already answers that (`/meta/app/payroll` → `403 PERMISSION_DENIED`). By
 * package id nothing did: `/meta/app/com.acme.payroll` asked for an app NAMED
 * `com.acme.payroll` and answered 404 whatever the package held, and the list
 * read (`?package=`) drops a withheld app, so it reads as a missing one.
 *
 * ## The fix, and why neither door carries it
 *
 * `GetMetaItemRequestSchema.name` declares the arm (`type: 'app'`, a key in
 * the package-id grammar, `isAppPackageIdKey`), and its producer resolves it:
 * `getMetaItem` in `@objectstack/metadata-protocol` reads the package's one
 * app by its own name. Both doors hand the protocol the key they were asked
 * for, so each gets the arm with no code of its own, and the per-caller read
 * gate judges the resolved app exactly as it judges the by-name read. These
 * rows drive both doors over one real store each and hold the two equal, and
 * equal to the by-name read.
 *
 * ## The rig
 *
 * `meta-package-all-fold.test.ts`'s: per door, a REAL store (better-sqlite3
 * `:memory:`, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation`), with the apps registered the way a
 * code package registers them (`registry.registerApp(app, packageId)`), and
 * the caller supplied at each door's identity seam.
 *
 * `RestServer` also serves three doors the dispatcher does not, `/history`,
 * `/audit` and `/diff`, which judge "the item the plain read would judge" but
 * read their own data by the literal `:name`. The arm is the plain read's, not
 * theirs: the last rows pin them by name, as before the arm.
 */

import { describe, it, expect, afterEach } from 'vitest';
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

/** A package whose app the member does not hold (`requiredPermissions`). */
const PAYROLL_PKG = 'com.acme.payroll';
const PAYROLL_APP = {
    name: 'payroll',
    label: 'Payroll',
    requiredPermissions: ['payroll.access'],
    navigation: [{ id: 'nav_payroll_runs', type: 'page', label: 'Runs', pageName: 'payroll_runs' }],
};
/** A package whose app is mid-build (ADR-0045 §3: externally unobservable). */
const BUILD_PKG = 'com.acme.build';
const BUILD_APP = {
    name: 'production_management',
    label: 'Production',
    _unpublished: true,
    navigation: [{ id: 'nav_lines', type: 'page', label: 'Lines', pageName: 'lines' }],
};
/** No package of this id is installed. */
const MISSING_PKG = 'com.acme.missing';
/**
 * A `view` whose name is in the package-id grammar (`<object>.<viewKey>`), and
 * a package of that very id shipping an app: were the arm to fire on `view`,
 * the read would resolve that package and miss the view.
 */
const VIEW_KEY = 'task.grid';
const SHADOW_APP = { name: 'grid_app', label: 'Grid app', navigation: [] };

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const CALLERS = {
    member: { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] },
    holder: { userId: 'u_holder', isSystem: false, systemPermissions: ['payroll.access'] },
    /**
     * `/history`, `/audit` and `/diff` admit an authoring capability first, so
     * their rows need callers past that door: one who does not hold the app…
     */
    builder: { userId: 'u_builder', isSystem: false, systemPermissions: ['studio.access'] },
    /** …and one who does. */
    builderHolder: { userId: 'u_builder_holder', isSystem: false, systemPermissions: ['studio.access', 'payroll.access'] },
} as const;
type CallerName = keyof typeof CALLERS;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** One real store: the apps registered as their code packages register them, and one stored view. */
async function bootStore() {
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
    engine.registry.registerApp(clone(PAYROLL_APP), PAYROLL_PKG);
    engine.registry.registerApp(clone(BUILD_APP), BUILD_PKG);
    engine.registry.registerApp(clone(SHADOW_APP), VIEW_KEY);
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    await protocol.saveMetaItem({
        type: 'view',
        name: VIEW_KEY,
        item: { name: VIEW_KEY, label: 'Grid', object: 'task', viewKind: 'list', columns: [{ field: 'name', label: 'Name' }] },
    } as any);
    return { protocol };
}

// ── The two doors ─────────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; body: any; envelope?: any }
interface Door { read(who: CallerName, path: string): Promise<Answer> }

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.code : body?.code;

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

/** `RestServer`'s route for a path below `/meta`, and the params the adapter would hand it. */
function restRouteOf(path: string): { route: string; params: Record<string, string> } {
    const s = path.replace(/^\/meta\//, '').split('/');
    if (s.length === 3) return { route: `${META}/:type/:name/${s[2]}`, params: { type: s[0], name: s[1] } };
    if (s.length === 2) return { route: `${META}/:type/:name`, params: { type: s[0], name: s[1] } };
    throw new Error(`no RestServer route for ${path}`);
}

async function bootRestServer(): Promise<Door> {
    const { protocol } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    let caller: CallerName = 'member';
    rest.resolveExecCtx = async () => clone(CALLERS[caller]);
    rest.registerRoutes();
    return {
        read: async (who, path) => {
            const { route, params } = restRouteOf(path);
            const entry = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === route);
            if (!entry) throw new Error(`GET ${route} is not registered`);
            caller = who;
            const res = makeRes();
            await entry.handler({ method: 'GET', path: `${PREFIX}${path}`, params, query: {}, headers: {}, body: undefined }, res);
            return {
                status: res.statusCode,
                code: codeOf(res.body),
                body: res.body,
                envelope: res.statusCode === 200 ? res.body : undefined,
            };
        },
    };
}

async function bootCatchAll(): Promise<Door> {
    const { protocol } = await bootStore();
    const get = (n: string) => (n === 'protocol' ? protocol : null);
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    let caller: CallerName = 'member';
    // The seam `dispatch()` resolves identity through (the sibling
    // dispatch-level pins supply the principal the same way).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(CALLERS[caller]);
    return {
        read: async (who, path) => {
            caller = who;
            // What `createHonoApp`'s catch-all hands `dispatch()`: the path below
            // the prefix, the query, and the raw Fetch `Request`.
            const raw = new Request(new URL(`http://localhost${PREFIX}${path}`), { method: 'GET' });
            const res = await dispatcher.dispatch('GET', path, undefined, {}, { request: raw } as any, PREFIX);
            const status = res.response?.status ?? 0;
            const body = res.response?.body;
            return { status, code: codeOf(body), body, envelope: status === 200 ? body?.data : undefined };
        },
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

const text = (a: Answer): string => JSON.stringify(a.body ?? null);

describe.each(DOORS)('[#23183] %s: the app item read answers by package id', (_door, boot) => {
    it('a member on a withheld app\'s package id: 403 PERMISSION_DENIED, the by-name read\'s verdict', async () => {
        const door = await boot();
        const byPackage = await door.read('member', `/meta/app/${PAYROLL_PKG}`);
        const byName = await door.read('member', '/meta/app/payroll');

        expect(byName.status, text(byName)).toBe(403);
        expect(byName.code).toBe('PERMISSION_DENIED');
        expect(byPackage.status, text(byPackage)).toBe(403);
        expect(byPackage.code).toBe('PERMISSION_DENIED');
        // A refusal, never the document.
        expect(text(byPackage)).not.toContain('nav_payroll_runs');
    }, 60_000);

    it('a holder is served the app, under its own name — the item the by-name read serves', async () => {
        const door = await boot();
        const byPackage = await door.read('holder', `/meta/app/${PAYROLL_PKG}`);
        const byName = await door.read('holder', '/meta/app/payroll');

        expect(byName.status, text(byName)).toBe(200);
        expect(byPackage.status, text(byPackage)).toBe(200);
        expect(byPackage.envelope?.name).toBe('payroll');
        expect(byPackage.envelope?.item?.name).toBe('payroll');
        expect(byPackage.envelope?.item).toEqual(byName.envelope?.item);
    }, 60_000);

    it('an unknown package id: 404, the door\'s own answer for an app that is not there', async () => {
        const door = await boot();
        const byPackage = await door.read('holder', `/meta/app/${MISSING_PKG}`);
        const byName = await door.read('holder', '/meta/app/no_such_app');

        expect(byPackage.status, text(byPackage)).toBe(404);
        expect(byName.status, text(byName)).toBe(404);
        expect(text(byPackage)).toBe(text(byName));
    }, 60_000);

    it('a non-holder learns nothing more than by name: a package whose app is unpublished answers exactly as an unknown package', async () => {
        const door = await boot();
        const unpublished = await door.read('member', `/meta/app/${BUILD_PKG}`);
        const unknown = await door.read('member', `/meta/app/${MISSING_PKG}`);

        expect(unpublished.status, text(unpublished)).toBe(404);
        expect(text(unpublished)).toBe(text(unknown));
    }, 60_000);

    it('a key in the package-id grammar on another type is read by name, even where a package of that id ships an app', async () => {
        const door = await boot();
        const answer = await door.read('holder', `/meta/view/${VIEW_KEY}`);

        expect(answer.status, text(answer)).toBe(200);
        expect(answer.envelope?.item?.name).toBe(VIEW_KEY);
    }, 60_000);
});

describe('[#23183] RestServer: /history, /audit and /diff stay by name — the arm is the plain read\'s', () => {
    it('a builder who does not hold the app reads a package id\'s history and audit as an unknown key\'s, never the plain read\'s 403', async () => {
        const door = await bootRestServer();
        // The control: the plain read refuses this caller the app by package id.
        const plain = await door.read('builder', `/meta/app/${PAYROLL_PKG}`);
        expect(plain.status, text(plain)).toBe(403);
        for (const sub of ['history', 'audit']) {
            const byPackage = await door.read('builder', `/meta/app/${PAYROLL_PKG}/${sub}`);
            const unknown = await door.read('builder', `/meta/app/${MISSING_PKG}/${sub}`);
            expect(unknown.status, `${sub} ${text(unknown)}`).toBe(200);
            expect(byPackage.status, `${sub} ${text(byPackage)}`).toBe(200);
            // The same answer, but for the key each echoes.
            expect(text(byPackage).split(PAYROLL_PKG).join('KEY'), sub)
                .toBe(text(unknown).split(MISSING_PKG).join('KEY'));
        }
    }, 60_000);

    it('a holder\'s /diff of a package id is the absence answer, as for an unknown key — never an empty diff of the app', async () => {
        const door = await bootRestServer();
        const byPackage = await door.read('builderHolder', `/meta/app/${PAYROLL_PKG}/diff`);
        const unknown = await door.read('builderHolder', `/meta/app/${MISSING_PKG}/diff`);

        expect(byPackage.status, text(byPackage)).toBe(404);
        expect(byPackage.code).toBe('RESOURCE_NOT_FOUND');
        expect(text(byPackage)).toBe(text(unknown));
    }, 60_000);
});
