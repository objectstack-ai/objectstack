// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0046 §6.7] A `{ systemPermission }` book audience, on every docs door.
 *
 * The Setup app opens for whoever holds `setup.access` — through
 * `organization_admin`, `admin_full_access`, or any delegated-admin set an
 * application authors — so Setup's own manual is gated on that capability, not
 * on one set's name. The gate reads the caller's own `systemPermissions`, the
 * list every `requiredPermissions` arm of the `/meta` read gate reads, so the
 * manual opens for exactly the callers the app opens for.
 *
 * Pinned on the three doors the card names — the list (with and without
 * `?include=content`, whose answer carries the body the docs search reads),
 * the single read — plus the book's own tree and the book list:
 *
 *   setup_manual  { systemPermission: setup.access }  claims setup_overview
 *   help_center   'org'                              claims crm_intro
 *
 * The holders are told apart by capability alone: the security service
 * resolves the SAME permission sets for both, so a pass can only come from
 * `systemPermissions`.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid at collection, not inside a case's clock: `RestServer` reaches
// `@objectstack/objectql` only through dynamic imports (check:test-source-alias).
import '@objectstack/objectql';
// Explicit `.js` extension: NodeNext resolution (see the sibling nav-gate tests).
import { RestServer } from './rest-server.js';

const SETUP_MANUAL = {
    name: 'setup_manual',
    label: 'Setup',
    audience: { systemPermission: 'setup.access' },
    _packageId: 'com.objectstack.setup',
    groups: [{ key: 'all', label: 'Documentation', include: '*' }],
};
const HELP_CENTER = {
    name: 'help_center',
    label: 'Help Centre',
    audience: 'org',
    _packageId: 'crm',
    groups: [{ key: 'start', label: 'Start', include: 'crm_intro' }],
};
/** The body a member without `setup.access` must never receive. */
const SETUP_BODY = 'Access is additive: a user holds the union of every permission set granted to them.';
const DOCS = [
    { name: 'crm_intro', label: 'Getting started', content: 'Welcome aboard.', _packageId: 'crm' },
    { name: 'setup_overview', label: 'Setup overview', content: SETUP_BODY, _packageId: 'com.objectstack.setup' },
];

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.send = vi.fn(() => res);
    res.header = vi.fn(); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface SetupOpts {
    /** The caller's `systemPermissions`; `undefined` leaves the key off the context. */
    systemPermissions?: unknown;
    /** No resolved session at all. */
    anonymous?: boolean;
    books?: any[];
}

function setup(opts: SetupOpts = {}) {
    const byType: Record<string, any[]> = { book: opts.books ?? [SETUP_MANUAL, HELP_CENTER], doc: DOCS };
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => clone(byType[String(type ?? '').replace(/s$/, '')] ?? [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const t = String(type ?? '').replace(/s$/, '');
            const found = (byType[t] ?? []).find((i: any) => i.name === name);
            return { type: t, name, item: found ? clone(found) : undefined };
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    // Both callers resolve the same sets: only the capability tells them apart.
    const resolvePermissionSetNames = vi.fn(async () => ['member_default']);
    const rest: any = new RestServer(createMockServer() as any, protocol, {} as any);
    if (!opts.anonymous) {
        rest.resolveExecCtx = async () => ({
            userId: 'u1',
            ...('systemPermissions' in opts ? { systemPermissions: opts.systemPermissions } : {}),
        });
        rest.securityServiceProvider = async () => ({ resolvePermissionSetNames });
    }
    rest.registerRoutes();
    return { rest, resolvePermissionSetNames };
}

async function call(rest: any, path: string, params: Record<string, string>, query: Record<string, string> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `/api/v1/meta${path}`);
    if (!route) throw new Error(`GET /meta${path} not registered`);
    const res = makeRes();
    await route.handler({ method: 'GET', params, query, body: {}, headers: {} }, res);
    return res;
}
const readDoc = (rest: any, name: string) => call(rest, '/:type/:name', { type: 'doc', name });
const listDocs = (rest: any, query: Record<string, string> = {}) => call(rest, '/:type', { type: 'doc' }, query);
const listBooks = (rest: any) => call(rest, '/:type', { type: 'book' });
const bookTree = (rest: any, name: string) => call(rest, '/book/:name/tree', { name });

const items = (body: any): any[] => (Array.isArray(body) ? body : (body?.items ?? []));
const listed = (body: any): string[] => items(body).map((d: any) => d?.name);
/** The ADR-0112 minimum: the status and the machine code, never the prose. */
const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });
const treeDocs = (body: any): string[] =>
    (body?.groups ?? []).flatMap((g: any) => (g.entries ?? []).map((e: any) => e.doc)).filter(Boolean);

describe('a member WITHOUT setup.access — the Setup manual is neither listed nor read', () => {
    const member = () => setup({ systemPermissions: ['api.read'] });

    it('GET /meta/doc lists only the org doc', async () => {
        expect(listed((await listDocs(member().rest)).body)).toEqual(['crm_intro']);
    });

    it('GET /meta/doc?include=content lists only the org doc, and the Setup body is nowhere in the answer', async () => {
        const res = await listDocs(member().rest, { include: 'content' });
        expect(listed(res.body)).toEqual(['crm_intro']);
        // The positive control: content IS carried on this door.
        expect(items(res.body)[0]?.content).toBe('Welcome aboard.');
        expect(JSON.stringify(res.body)).not.toContain(SETUP_BODY);
    });

    it('GET /meta/doc/setup_overview is 403 PERMISSION_DENIED, with no body', async () => {
        const res = await readDoc(member().rest, 'setup_overview');
        expect(envelope(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(JSON.stringify(res.body)).not.toContain(SETUP_BODY);
    });

    it('the book itself: absent from GET /meta/book, and its tree is 403', async () => {
        const { rest } = member();
        expect(listed((await listBooks(rest)).body)).toEqual(['help_center']);
        expect(envelope(await bookTree(rest, 'setup_manual'))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });

    it('the package\'s implicit book serves no Setup page either (the claim is the doc\'s, whichever book is asked)', async () => {
        const res = await bookTree(member().rest, 'com.objectstack.setup');
        expect(treeDocs(res.body)).not.toContain('setup_overview');
    });
});

describe('a holder of setup.access — reads the manual as an admin always has', () => {
    const holder = () => setup({ systemPermissions: ['api.read', 'setup.access'] });

    it('GET /meta/doc lists it; ?include=content carries its body', async () => {
        const { rest } = holder();
        expect(listed((await listDocs(rest)).body)).toEqual(['crm_intro', 'setup_overview']);
        const withContent = await listDocs(rest, { include: 'content' });
        expect(items(withContent.body).find((d: any) => d.name === 'setup_overview')?.content).toBe(SETUP_BODY);
    });

    it('GET /meta/doc/setup_overview is 200 with its body', async () => {
        const res = await readDoc(holder().rest, 'setup_overview');
        expect(res.statusCode).toBe(200);
        expect(res.body?.item?.content).toBe(SETUP_BODY);
    });

    it('the book is listed and its tree carries the page', async () => {
        const { rest } = holder();
        expect(listed((await listBooks(rest)).body)).toEqual(['setup_manual', 'help_center']);
        const tree = await bookTree(rest, 'setup_manual');
        expect(tree.statusCode).toBe(200);
        expect(treeDocs(tree.body)).toEqual(['setup_overview']);
    });
});

describe('fail closed, and no wider than it needs', () => {
    it('a context with no systemPermissions list reads as unresolved: the Setup page is refused', async () => {
        for (const systemPermissions of [undefined, 'setup.access', null]) {
            const { rest } = setup(systemPermissions === undefined ? {} : { systemPermissions });
            expect(envelope(await readDoc(rest, 'setup_overview'))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
            expect(listed((await listDocs(rest)).body)).toEqual(['crm_intro']);
        }
    });

    it('anonymous: the doc takes its 401 UNAUTHENTICATED path', async () => {
        const res = await readDoc(setup({ anonymous: true }).rest, 'setup_overview');
        expect(envelope(res)).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
        expect(JSON.stringify(res.body)).not.toContain(SETUP_BODY);
    });

    it('a capability gate alone never asks the security service for permission sets', async () => {
        const { rest, resolvePermissionSetNames } = setup({ systemPermissions: ['setup.access'] });
        await readDoc(rest, 'setup_overview');
        await listDocs(rest, { include: 'content' });
        expect(resolvePermissionSetNames).not.toHaveBeenCalled();
    });

    it('control: with no gated book anywhere, every authenticated caller reads every doc (the fast path)', async () => {
        const { rest } = setup({ systemPermissions: [], books: [HELP_CENTER] });
        expect(listed((await listDocs(rest)).body)).toEqual(['crm_intro', 'setup_overview']);
    });
});
