// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20290] The plain read's `?state=draft` branch serves an app's pending
 * draft WHOLE to whoever may save the app, and pruned per caller to everyone
 * else.
 *
 * ## The defect
 *
 * Studio's two app editors build their edit baseline as
 * `{ ...layered.effective, ...draft }`, where the draft is
 * `GET /meta/app/:name?state=draft`, and save that baseline back as a draft.
 * The draft read ran the RENDERED policy (`{ arms: 'all', app: 'gate' }`), so
 * it pruned the navigation entries an author may not open — and, for every
 * caller, an entry whose service is merely off in this deployment. The pruned
 * `navigation` replaced the whole one in the merge, and the next draft save
 * deleted what was withheld. Ruling 5856774816 (letter B) says why that is
 * wrong: 「whoever can save it must see it whole, or a save drops entries
 * silently」. Triage (5859504238) decided the carrier is this door: a draft is
 * a stored version, not a rendered one, so it reads under the stored-version
 * doors' policy, the author exemption included.
 *
 * ## Why this file boots the real stack
 *
 * The draft row, the history row a draft save appends, and `NO_DRAFT` are the
 * protocol's, and the round trip this card is about ends in a PERSISTED row. A
 * mock protocol could only assert what REST handed it. So: a real
 * better-sqlite3 `:memory:` engine, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes. The one stub is
 * the auth boundary (`resolveExecCtx`), the seam every neighbouring `/meta`
 * test uses, plus the service probe that says `tenancy` is off here.
 *
 * The cells per door and caller live in the census,
 * `meta-alternate-door-read-gates.test.ts`, where this door sits beside the
 * other stored-version doors.
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
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { RestServer } from './rest-server.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';

const CALLERS = {
    /** Seeds the published app: no principal, the machine-write shape. */
    system: { isSystem: true },
    /** A co-author who holds every entry's permission: writes the pending draft. */
    financeAuthor: { userId: 'u_finance_author', systemPermissions: ['manage_metadata', 'finance.access'] },
    /** The card's author: may save the app, but holds no `finance.access`. */
    author: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
    /** May open the app, may not save it. */
    member: { userId: 'u_member', systemPermissions: [] },
} as const;
type CallerName = keyof typeof CALLERS;

const ACTIVE = {
    name: 'atlas',
    label: 'Atlas',
    navigation: [
        { id: 'nav_leads', type: 'page', label: 'Leads', pageName: 'leads_home' },
        { id: 'nav_finance_ledger', type: 'page', label: 'Ledger', pageName: 'ledger', requiredPermissions: ['finance.access'] },
        // Bound to an optional service this deployment does not register.
        { id: 'nav_org_directory', type: 'page', label: 'Organizations', pageName: 'orgs', requiresService: 'tenancy' },
    ],
};
/** The pending draft: relabelled, plus an entry that exists ONLY in the draft. */
const DRAFT = {
    ...ACTIVE,
    label: 'Atlas (draft)',
    navigation: [
        ...ACTIVE.navigation,
        { id: 'nav_finance_forecast', type: 'page', label: 'Forecast', pageName: 'forecast', requiredPermissions: ['finance.access'] },
    ],
};
const ALL_DRAFT_ENTRIES = ['nav_leads', 'nav_finance_ledger', 'nav_org_directory', 'nav_finance_forecast'];

/** An app the plain read refuses WHOLE to a caller without `payroll.access`. */
const PAYROLL = {
    name: 'payroll',
    label: 'Payroll',
    requiredPermissions: ['payroll.access'],
    navigation: [{ id: 'nav_payroll_runs', type: 'page', label: 'Runs', pageName: 'payroll_runs' }],
};

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
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {}; res.write = () => true; res.end = () => {};
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

    const call = async (
        who: CallerName, method: 'GET' | 'PUT', suffix: string, name: string,
        query: Record<string, string> = {}, body?: unknown,
    ) => {
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === `${META}/:type/:name${suffix}`);
        if (!route) throw new Error(`${method} ${META}/:type/:name${suffix} is not registered`);
        caller = who;
        const res = makeRes();
        await route.handler({ method, path: `${META}/app/${name}${suffix}`, params: { type: 'app', name }, query, headers: {}, body }, res);
        return res;
    };

    // The published app, then a pending draft written by a co-author.
    for (const [who, item, query] of [
        ['system', ACTIVE, {}],
        ['financeAuthor', DRAFT, { mode: 'draft' }],
        ['system', PAYROLL, {}],
        ['system', { ...PAYROLL, label: 'Payroll (draft)' }, { mode: 'draft' }],
    ] as const) {
        const res = await call(who, 'PUT', '', item.name, query, item);
        if (res.statusCode !== 200) throw new Error(`seeding ${item.name} failed: ${JSON.stringify(res.body)}`);
    }
    return { engine, call };
}

const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);
const errorCode = (res: any) => res.body?.error?.code ?? res.body?.code;

/** The persisted `sys_metadata` row of `name` in `state`. */
async function storedRow(engine: ObjectQL, name: string, state: 'active' | 'draft') {
    const rows = await (engine as any).find('sys_metadata', { where: { type: 'app', name, state }, context: { isSystem: true } });
    expect(rows, `${name} ${state} rows`).toHaveLength(1);
    const { metadata } = rows[0];
    return typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
}

describe('[#20290] the draft read serves an app author the stored draft whole', () => {
    it('an author holding manage_metadata but not finance.access reads the draft whole — the entries withheld from them, the draft-only one, and one whose service is off here', async () => {
        const { call } = await boot();
        const res = await call('author', 'GET', '', 'atlas', { state: 'draft' });

        expect(res.statusCode).toBe(200);
        // It IS the draft row, not the active one.
        expect(res.body?.item?.label).toBe('Atlas (draft)');
        expect(navIds(res.body?.item)).toEqual(ALL_DRAFT_ENTRIES);
    }, 60_000);

    it('a caller who may not save the app reads the draft pruned per caller (the control) — no per-deployment gate either, as on /layers', async () => {
        const { call } = await boot();
        const res = await call('member', 'GET', '', 'atlas', { state: 'draft' });

        expect(res.statusCode).toBe(200);
        expect(res.body?.item?.label).toBe('Atlas (draft)');
        expect(navIds(res.body?.item)).toEqual(['nav_leads', 'nav_org_directory']);
        expect(JSON.stringify(res.body)).not.toContain('nav_finance');
        // The same per-caller answer the stored-version doors give them.
        const layers = await call('member', 'GET', '/layers', 'atlas');
        expect(navIds(layers.body?.effective)).toEqual(['nav_leads', 'nav_org_directory']);
    }, 60_000);

    it('a draft save by that author keeps nav_finance_ledger: the editor round trip persists every entry', async () => {
        const { engine, call } = await boot();

        // The baseline Studio's editors build: the layered view's `effective`,
        // with the pending draft (decorations stripped) merged over it.
        const layers = await call('author', 'GET', '/layers', 'atlas');
        const draft = await call('author', 'GET', '', 'atlas', { state: 'draft' });
        expect(layers.statusCode).toBe(200);
        expect(draft.statusCode).toBe(200);
        const baseline = {
            ...(layers.body?.effective ?? {}),
            ...(stripReadDecorations(draft.body?.item) as Record<string, unknown>),
        };

        // One edit the author CAN see, saved back as a draft.
        const saved = await call('author', 'PUT', '', 'atlas', { mode: 'draft' }, { ...baseline, label: 'Atlas v2' });
        expect(saved.statusCode).toBe(200);

        const persisted = await storedRow(engine, 'atlas', 'draft');
        expect(persisted.label).toBe('Atlas v2');
        expect(navIds(persisted)).toEqual(ALL_DRAFT_ENTRIES);
        // The published row is untouched by a draft save.
        expect(navIds(await storedRow(engine, 'atlas', 'active'))).toEqual(navIds(ACTIVE));
    }, 60_000);

    it('it widens nothing: the author\'s draft answer is what /diff already serves them whole for the same stored version', async () => {
        const { engine, call } = await boot();
        const history = await (engine as any).find('sys_metadata_history', { where: { name: 'atlas' }, context: { isSystem: true } });
        const draftVersion = Math.max(...history.map((h: any) => Number(h.version)));

        const diff = await call('author', 'GET', '/diff', 'atlas', { from: '0', to: String(draftVersion) });
        const draft = await call('author', 'GET', '', 'atlas', { state: 'draft' });

        expect(diff.statusCode).toBe(200);
        const navigation = diff.body?.added?.find((e: any) => e.path === 'navigation')?.value;
        expect(navIds({ navigation })).toEqual(navIds(draft.body?.item));
    }, 60_000);

    it('the rendered doors still prune the author: the plain read and ?preview=draft', async () => {
        const { call } = await boot();
        const plain = await call('author', 'GET', '', 'atlas');
        const preview = await call('author', 'GET', '', 'atlas', { preview: 'draft' });

        expect(plain.statusCode).toBe(200);
        expect(navIds(plain.body?.item)).toEqual(['nav_leads']);
        expect(preview.statusCode).toBe(200);
        expect(preview.body?.item?.label).toBe('Atlas (draft)');
        expect(navIds(preview.body?.item)).toEqual(['nav_leads']);
    }, 60_000);

    it('an app the plain read refuses WHOLE is refused on the draft read to an author too', async () => {
        const { call } = await boot();
        const plain = await call('author', 'GET', '', 'payroll');
        const draft = await call('author', 'GET', '', 'payroll', { state: 'draft' });

        expect({ status: plain.statusCode, code: errorCode(plain) }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect({ status: draft.statusCode, code: errorCode(draft) }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(JSON.stringify(draft.body)).not.toContain('nav_payroll_runs');
    }, 60_000);
});
