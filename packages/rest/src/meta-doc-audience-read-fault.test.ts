// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20129] The docs reads fail CLOSED when a gate input cannot be read
 * (ADR-0046 §6.7; fail closed per ADR-0049).
 *
 * `GET /meta/doc/:name` and `GET /meta/doc` decide "may this caller read the
 * doc" from two reads besides the doc itself: the environment's BOOKS and, on
 * the single read, the doc CORPUS the books claim over. Both used to map a
 * thrown read to `[]`, and `[]` is not "unknown" to the resolver:
 *
 *  - no books ⇒ no `{ permissionSet }` book anywhere ⇒ an authenticated caller
 *    takes the fast path, where every doc is readable;
 *  - no corpus ⇒ the doc is claimed by no book ⇒ its audience is `org`.
 *
 * So a store fault on either read served a set-gated doc — body included — to
 * an authenticated member who does not hold the set, and listed it for them.
 *
 * The fault now reaches the route's error door, the answer the sibling
 * `GET /meta/book/:name/tree` has always given for its own book read (a bare
 * `await`): one fault, one answer across the docs doors — never a 200, never
 * an empty list standing in for "this environment has no docs", and never a
 * 403 telling a holder they hold nothing.
 *
 * The fixture's audiences come from the spec's own resolver:
 *
 *   admin_guide  { permissionSet: crm_admin }  claims crm_admin_runbook
 *   help_center  'org'                          claims crm_intro
 */

import { describe, it, expect, vi } from 'vitest';
// Explicit `.js` extension: NodeNext resolution (see the sibling nav-gate tests).
import { RestServer } from './rest-server.js';

const ADMIN_GUIDE = {
    name: 'admin_guide',
    label: 'Admin Guide',
    audience: { permissionSet: 'crm_admin' },
    _packageId: 'crm',
    groups: [{ key: 'admin', label: 'Admin', include: 'crm_admin_*' }],
};
const HELP_CENTER = {
    name: 'help_center',
    label: 'Help Centre',
    audience: 'org',
    _packageId: 'crm',
    groups: [{ key: 'start', label: 'Start', include: 'crm_intro' }],
};
/** The body a non-holder must never receive. */
const GATED_BODY = 'Rotate the tenant signing keys before every release.';
const DOCS = [
    { name: 'crm_intro', label: 'Getting started', content: 'Welcome aboard.', _packageId: 'crm' },
    { name: 'crm_admin_runbook', label: 'Admin runbook', content: GATED_BODY, _packageId: 'crm' },
];

/**
 * The fault the shipped `metadata-protocol` raises for a `sys_metadata` read
 * that failed for any reason but "unprovisioned" (`metadataStoreUnavailableError`,
 * pinned in its `protocol.metadata-store-outage.test.ts`), and an untyped one
 * for a protocol that raises no classification at all.
 */
const FAULTS = {
    'store outage (503 SERVICE_UNAVAILABLE)': () =>
        Object.assign(new Error('The metadata store could not be read.'), {
            code: 'SERVICE_UNAVAILABLE',
            status: 503,
        }),
    'untyped throw': () => new Error('book store unavailable'),
} as const;
type FaultKind = keyof typeof FAULTS;

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
    /** Permission sets the caller holds. */
    holdings?: string[];
    /** Metadata types whose LIST read (`getMetaItems`) rejects. */
    failing?: string[];
    fault?: FaultKind;
    /** No resolved session at all. */
    anonymous?: boolean;
}

function setup(opts: SetupOpts = {}) {
    const { holdings = [], failing = [], fault = 'store outage (503 SERVICE_UNAVAILABLE)' } = opts;
    const byType: Record<string, any[]> = { book: [ADMIN_GUIDE, HELP_CENTER], doc: DOCS };
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => {
            const t = String(type ?? '').replace(/s$/, '');
            if (failing.includes(t)) throw FAULTS[fault]();
            return clone(byType[t] ?? []);
        }),
        // The single read's own document read stays healthy: the fault under
        // test is on the GATE's inputs, after the doc itself was read.
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const t = String(type ?? '').replace(/s$/, '');
            const found = (byType[t] ?? []).find((i: any) => i.name === name);
            return { type: t, name, item: found ? clone(found) : undefined };
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, {} as any);
    if (!opts.anonymous) {
        rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
        rest.securityServiceProvider = async () => ({ resolvePermissionSetNames: async () => holdings });
    }
    rest.registerRoutes();
    return { rest, protocol };
}

async function call(rest: any, path: string, params: Record<string, string>) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `/api/v1/meta${path}`);
    if (!route) throw new Error(`GET /meta${path} not registered`);
    const res = makeRes();
    await route.handler({ method: 'GET', params, query: {}, body: {}, headers: {} }, res);
    return res;
}
const readDoc = (rest: any, name: string) => call(rest, '/:type/:name', { type: 'doc', name });
const listDocs = (rest: any) => call(rest, '/:type', { type: 'doc' });
const bookTree = (rest: any, name: string) => call(rest, '/book/:name/tree', { name });

const listed = (body: any): string[] =>
    (Array.isArray(body) ? body : (body?.items ?? [])).map((d: any) => d?.name);
/** The ADR-0112 minimum: the status and the machine code, never the prose. */
const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });
const listReads = (protocol: any, type: string): number =>
    protocol.getMetaItems.mock.calls.filter((c: any[]) => String(c[0]?.type ?? '').replace(/s$/, '') === type).length;

describe('[#20129] controls — healthy reads, the gate as it always answered', () => {
    it('non-holder: the set-gated doc is 403 PERMISSION_DENIED and absent from the list', async () => {
        const { rest } = setup({ holdings: [] });
        const single = await readDoc(rest, 'crm_admin_runbook');

        expect(envelope(single)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(JSON.stringify(single.body)).not.toContain(GATED_BODY);
        expect(listed((await listDocs(rest)).body)).toEqual(['crm_intro']);
    });

    it('holder: the same doc is 200 with its body, and listed', async () => {
        const { rest } = setup({ holdings: ['crm_admin'] });
        const single = await readDoc(rest, 'crm_admin_runbook');

        expect(single.statusCode).toBe(200);
        expect(single.body?.item?.content).toBe(GATED_BODY);
        expect(listed((await listDocs(rest)).body)).toEqual(['crm_intro', 'crm_admin_runbook']);
    });

    it('anonymous: the doc takes its 401 UNAUTHENTICATED path', async () => {
        const { rest } = setup({ anonymous: true });
        const single = await readDoc(rest, 'crm_admin_runbook');

        expect(envelope(single)).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
        expect(JSON.stringify(single.body)).not.toContain(GATED_BODY);
    });
});

describe('[#20129] a rejecting BOOK read — the doc reads fail closed', () => {
    for (const fault of Object.keys(FAULTS) as FaultKind[]) {
        describe(fault, () => {
            it('GET /meta/doc/:name does not serve the set-gated doc to a non-holder', async () => {
                const { rest, protocol } = setup({ holdings: [], failing: ['book'], fault });
                const single = await readDoc(rest, 'crm_admin_runbook');

                // The book read really was attempted, and really did reject.
                expect(listReads(protocol, 'book')).toBe(1);
                expect(single.statusCode).not.toBe(200);
                expect(single.body?.item).toBeUndefined();
                expect(JSON.stringify(single.body)).not.toContain(GATED_BODY);
                expect(envelope(single)).toEqual(envelope(await bookTree(setup({ failing: ['book'], fault }).rest, 'admin_guide')));
            });

            it('GET /meta/doc does not list it — and does not answer an invented empty list either', async () => {
                const { rest } = setup({ holdings: [], failing: ['book'], fault });
                const list = await listDocs(rest);

                expect(list.statusCode).not.toBe(200);
                expect(listed(list.body)).not.toContain('crm_admin_runbook');
                expect(JSON.stringify(list.body)).not.toContain(GATED_BODY);
                expect(envelope(list)).toEqual(envelope(await bookTree(setup({ failing: ['book'], fault }).rest, 'admin_guide')));
            });
        });
    }

    it('⭐ the three docs doors answer ONE book-read fault ONE way: the store\'s own 503', async () => {
        const doors = [
            await readDoc(setup({ failing: ['book'] }).rest, 'crm_admin_runbook'),
            await listDocs(setup({ failing: ['book'] }).rest),
            await bookTree(setup({ failing: ['book'] }).rest, 'admin_guide'),
        ];
        for (const res of doors) expect(envelope(res)).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    });

    it('no doc is cleared without the books — an `org` doc, and a holder, are not served either', async () => {
        // Without the book list the gate cannot tell which docs a set-gated
        // book claims, so it clears none: the fault is not a verdict about
        // THIS doc or THIS caller, and it is answered as the fault it is.
        const intro = await readDoc(setup({ holdings: [], failing: ['book'] }).rest, 'crm_intro');
        const holder = await readDoc(setup({ holdings: ['crm_admin'], failing: ['book'] }).rest, 'crm_admin_runbook');

        for (const res of [intro, holder]) {
            expect(envelope(res)).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
            expect(res.body?.item).toBeUndefined();
        }
    });
});

describe('[#20129] a rejecting CORPUS read on the single read — never "unclaimed, so org"', () => {
    for (const fault of Object.keys(FAULTS) as FaultKind[]) {
        it(`${fault}: GET /meta/doc/:name does not serve the set-gated doc to a non-holder`, async () => {
            // `failing: ['doc']` rejects the doc LIST read only — the corpus
            // the gate resolves claims over. The doc itself is read by name.
            const { rest, protocol } = setup({ holdings: [], failing: ['doc'], fault });
            const single = await readDoc(rest, 'crm_admin_runbook');

            // The gate did reach the corpus read: the books were healthy and
            // set-gated, so the fast path could not decide.
            expect(listReads(protocol, 'book')).toBe(1);
            expect(listReads(protocol, 'doc')).toBe(1);
            expect(single.statusCode).not.toBe(200);
            expect(single.body?.item).toBeUndefined();
            expect(JSON.stringify(single.body)).not.toContain(GATED_BODY);
            expect(envelope(single)).toEqual(envelope(await bookTree(setup({ failing: ['doc'], fault }).rest, 'crm')));
        });
    }

    it('the store outage answers the store\'s own 503 SERVICE_UNAVAILABLE', async () => {
        const single = await readDoc(setup({ holdings: [], failing: ['doc'] }).rest, 'crm_admin_runbook');
        expect(envelope(single)).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    });
});
