// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19790] `GET /meta/app` prunes a `type: 'doc'` nav entry by the docs
 * audience (ADR-0046 §6.7) — the rule `DocNavItemSchema` declares: a `doc`
 * entry the member may not read is not rendered, and a `book` entry is not
 * rendered for a member with no readable page in it.
 *
 * Before this arm the server pruned such entries on `requiredPermissions`,
 * `requiresService` and object servability only, so every member of the app
 * received the entry — its label and the gated book / doc name — however the
 * book was gated, and only a renderer could hide it.
 *
 * Driven through the real list and by-name routes, over one fixture whose
 * audiences come from the spec's own resolver:
 *
 *   admin_guide  { permissionSet: crm_admin }  claims crm_admin_runbook (crm),
 *                                               ops_keys + ops_rotation (ops)
 *   help_center  'org'                          claims crm_intro
 *   implicit `crm` book → crm_intro (org) + crm_admin_runbook (gated): ONE readable page
 *   implicit `ops` book → ops_keys + ops_rotation, both gated: NO readable page
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
// Explicit `.js` extension: NodeNext resolution (see the sibling nav-gate tests).
import { RestServer } from './rest-server.js';

// This file spies on `console.warn` (the fail-closed diagnostic), so it
// declares the level it observes under — the SHIPPED default.
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

const ADMIN_GUIDE = {
    name: 'admin_guide',
    label: 'Admin Guide',
    audience: { permissionSet: 'crm_admin' },
    _packageId: 'crm',
    groups: [
        { key: 'admin', label: 'Admin', include: 'crm_admin_*' },
        { key: 'ops', label: 'Operations', include: 'ops_*', package: 'ops' },
    ],
};
const HELP_CENTER = {
    name: 'help_center',
    label: 'Help Centre',
    audience: 'org',
    _packageId: 'crm',
    groups: [{ key: 'start', label: 'Start', include: 'crm_intro' }],
};
const DOCS = [
    { name: 'crm_intro', label: 'Getting started', _packageId: 'crm' },
    { name: 'crm_admin_runbook', label: 'Admin runbook', _packageId: 'crm' },
    { name: 'ops_keys', label: 'Key handling', _packageId: 'ops' },
    { name: 'ops_rotation', label: 'Key rotation', _packageId: 'ops' },
];

const CRM_APP = {
    name: 'crm',
    label: 'CRM',
    navigation: [
        { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
        // Control: a `requiredPermissions`-only entry the caller satisfies.
        { id: 'nav_reports', type: 'page', label: 'Reports', pageName: 'crm_reports', requiredPermissions: ['crm.reports'] },
        { id: 'nav_admin_guide', type: 'doc', label: 'Admin Guide', book: 'admin_guide' },
        { id: 'nav_admin_runbook', type: 'doc', label: 'Admin Runbook', doc: 'crm_admin_runbook' },
        { id: 'nav_ops_book', type: 'doc', label: 'Ops Handbook', book: 'ops' },
        { id: 'nav_crm_book', type: 'doc', label: 'CRM Handbook', book: 'crm' },
        { id: 'nav_intro', type: 'doc', label: 'Getting started', doc: 'crm_intro' },
        // A readable page opened in a book the caller may not open.
        { id: 'nav_intro_in_admin_guide', type: 'doc', label: 'Intro, admin edition', book: 'admin_guide', doc: 'crm_intro' },
        // Control: a readable doc that `requiredPermissions` still narrows away.
        { id: 'nav_intro_locked', type: 'doc', label: 'Intro, locked', doc: 'crm_intro', requiredPermissions: ['crm.docs_admin'] },
        {
            id: 'grp_admin_docs', type: 'group', label: 'Admin docs',
            children: [{ id: 'nav_admin_runbook_nested', type: 'doc', doc: 'crm_admin_runbook' }],
        },
    ],
    areas: [{ id: 'area_ops', label: 'Operations', navigation: [{ id: 'nav_ops_book_area', type: 'doc', book: 'ops' }] }],
};

/** What a member who does NOT hold `crm_admin` is served. */
const NON_HOLDER_NAV = ['nav_leads', 'nav_reports', 'nav_crm_book', 'nav_intro'];
/** What a `crm_admin` holder is served — every doc entry but the permission-locked one. */
const HOLDER_NAV = [
    'nav_leads', 'nav_reports', 'nav_admin_guide', 'nav_admin_runbook', 'nav_ops_book',
    'nav_crm_book', 'nav_intro', 'nav_intro_in_admin_guide', 'grp_admin_docs',
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
    res.header = vi.fn(); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface SetupOpts {
    /** Permission sets the caller holds; `'unresolvable'` makes the security service throw. */
    holdings?: string[] | 'unresolvable';
    books?: any[];
    docs?: any[];
    apps?: any[];
    /** Metadata types whose LIST read throws. */
    failing?: string[];
    /** No resolved session at all. */
    anonymous?: boolean;
}

function setup(opts: SetupOpts = {}) {
    const { holdings = [], books = [ADMIN_GUIDE, HELP_CENTER], docs = DOCS, apps = [CRM_APP], failing = [] } = opts;
    const byType: Record<string, any[]> = { app: apps, book: books, doc: docs };
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => {
            const t = String(type ?? '').replace(/s$/, '');
            if (failing.includes(t)) throw new Error(`${t} store unavailable`);
            return clone(byType[t] ?? []);
        }),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const t = String(type ?? '').replace(/s$/, '');
            const found = (byType[t] ?? []).find((i: any) => i.name === name);
            return { type: t, name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, {} as any);
    const resolvePermissionSetNames = vi.fn(async () => {
        if (holdings === 'unresolvable') throw new Error('security service unavailable');
        return holdings;
    });
    if (!opts.anonymous) {
        rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['crm.reports'] });
        rest.securityServiceProvider = async () => ({ resolvePermissionSetNames });
    }
    rest.registerRoutes();
    return { rest, protocol, resolvePermissionSetNames };
}

async function call(rest: any, path: string, params: Record<string, string>) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `/api/v1/meta${path}`);
    if (!route) throw new Error(`GET /meta${path} not registered`);
    const res = makeRes();
    await route.handler({ method: 'GET', params, query: {}, body: {}, headers: {} }, res);
    return res;
}
const listApps = (rest: any) => call(rest, '/:type', { type: 'app' });
const getApp = (rest: any, name = 'crm') => call(rest, '/:type/:name', { type: 'app', name });
const bookTree = (rest: any, name: string) => call(rest, '/book/:name/tree', { name });

const appsOf = (body: any): any[] => (Array.isArray(body) ? body : (body?.items ?? []));
const navIds = (app: any): string[] => (app?.navigation ?? []).map((e: any) => e.id);
const areaIds = (app: any): string[] => (app?.areas ?? []).map((a: any) => a.id);
const listedApp = async (rest: any, name = 'crm') => appsOf((await listApps(rest)).body).find((a: any) => a?.name === name);
const namedApp = async (rest: any, name = 'crm') => (await getApp(rest, name)).body?.item;
const reads = (protocol: any, type: string): number =>
    protocol.getMetaItems.mock.calls.filter((c: any[]) => String(c[0]?.type ?? '').replace(/s$/, '') === type).length;
const treeDocs = (tree: any): string[] =>
    (tree?.groups ?? []).flatMap((g: any) => g.entries.map((e: any) => e.doc)).filter(Boolean).sort();

describe('[#19790] a member who may NOT read — the entries leave the server', () => {
    it('LIST: no `doc` entry for a gated doc, a gated book, or a book whose every page is gated', async () => {
        const { rest } = setup({ holdings: [] });
        const app = await listedApp(rest);

        expect(navIds(app)).toEqual(NON_HOLDER_NAV);
        // The gate reaches the area tree too, and an area it empties is dropped.
        expect(areaIds(app)).toEqual([]);
    });

    it('LIST: the wire carries none of the gated names or labels', async () => {
        const { rest } = setup({ holdings: [] });
        const wire = JSON.stringify((await listApps(rest)).body);

        for (const leaked of ['admin_guide', 'crm_admin_runbook', 'Admin Guide', 'Ops Handbook', '"book":"ops"']) {
            expect(wire).not.toContain(leaked);
        }
    });

    it('a `book` + `doc` entry is dropped when the BOOK is gated, although the doc alone is readable', async () => {
        // `crm_intro` is readable (help_center claims it, `org`) — `nav_intro`
        // survives. The same page opened in `admin_guide`'s context names a
        // book this member cannot open (its tree read answers 403), so it goes.
        const { rest } = setup({ holdings: [] });
        const ids = navIds(await listedApp(rest));

        expect(ids).toContain('nav_intro');
        expect(ids).not.toContain('nav_intro_in_admin_guide');
    });

    it('a group left empty by the arm collapses, like any other gate (#7380)', async () => {
        const { rest } = setup({ holdings: [] });
        expect(navIds(await listedApp(rest))).not.toContain('grp_admin_docs');
    });
});

describe('[#19790] a member who MAY read — the same entries are served', () => {
    it('LIST: every doc entry a `crm_admin` holder can read is present, area included', async () => {
        const { rest } = setup({ holdings: ['crm_admin'] });
        const app = await listedApp(rest);

        expect(navIds(app)).toEqual(HOLDER_NAV);
        expect(areaIds(app)).toEqual(['area_ops']);
        expect(app.navigation.find((e: any) => e.id === 'grp_admin_docs').children.map((c: any) => c.id))
            .toEqual(['nav_admin_runbook_nested']);
    });
});

describe('[#19790] a `book` entry is judged on its readable PAGES', () => {
    it('⭐ a book with exactly one readable page stays — and the tree read agrees on that page', async () => {
        const { rest } = setup({ holdings: [] });

        expect(navIds(await listedApp(rest))).toContain('nav_crm_book');
        // The implicit `crm` book holds crm_intro (readable) and
        // crm_admin_runbook (gated): the tree this member is served has one page.
        expect(treeDocs((await bookTree(rest, 'crm')).body)).toEqual(['crm_intro']);
    });

    it('a book whose OWN audience admits the member but whose every page is gated is dropped', async () => {
        const { rest } = setup({ holdings: [] });

        expect(navIds(await listedApp(rest))).not.toContain('nav_ops_book');
        // The implicit `ops` book is `org` — the tree read opens (200)…
        const tree = await bookTree(rest, 'ops');
        expect(tree.statusCode).toBe(200);
        // …and serves `crm_intro` in the synthetic Uncategorized group only. The
        // spec calls those orphans "not an authored membership claim", so they
        // are not the book's pages, and the entry is still dropped.
        expect(tree.body.groups.map((g: any) => g.key)).toEqual(['uncategorized']);
    });
});

describe('[#19790] the by-name route prunes exactly what the list route prunes', () => {
    for (const [who, holdings, expected] of [
        ['non-holder', [], NON_HOLDER_NAV],
        ['holder', ['crm_admin'], HOLDER_NAV],
    ] as const) {
        it(`${who}: GET /meta/app/crm serves the list route's navigation and areas`, async () => {
            const { rest } = setup({ holdings: [...holdings] });
            const listed = await listedApp(rest);
            const named = await namedApp(rest);

            expect(navIds(named)).toEqual(expected);
            expect(navIds(named)).toEqual(navIds(listed));
            expect(areaIds(named)).toEqual(areaIds(listed));
        });
    }
});

describe('[#19790] controls — the arm narrows `doc` entries and nothing else', () => {
    it('a `requiredPermissions` entry is judged as before, whatever the caller holds', async () => {
        for (const holdings of [[], ['crm_admin']]) {
            const ids = navIds(await listedApp(setup({ holdings }).rest));
            expect(ids).toContain('nav_reports');
            // Readable doc, missing system permission: `requiredPermissions`
            // still narrows further, exactly as the schema says.
            expect(ids).not.toContain('nav_intro_locked');
            expect(ids).toContain('nav_leads');
        }
    });
});

describe('[#19790] fails CLOSED', () => {
    const DOC_IDS = ['nav_admin_guide', 'nav_admin_runbook', 'nav_ops_book', 'nav_crm_book', 'nav_intro', 'nav_intro_in_admin_guide'];

    it('the books read throws: every `doc` entry is dropped, the rest is served, and the fault is logged', async () => {
        const { rest } = setup({ holdings: ['crm_admin'], failing: ['book'] });

        for (const app of [await listedApp(rest), await namedApp(rest)]) {
            expect(navIds(app)).toEqual(['nav_leads', 'nav_reports']);
        }
        const lines = (warn.mock.calls as unknown[][]).map((c) => String(c[0]));
        expect(lines.some((l) => l.includes('the book read failed') && l.includes('failing CLOSED'))).toBe(true);
    });

    it('the doc corpus read throws: every `doc` entry is dropped — never read as "unclaimed, so org"', async () => {
        const { rest } = setup({ holdings: ['crm_admin'], failing: ['doc'] });
        const ids = navIds(await listedApp(rest));

        for (const id of DOC_IDS) expect(ids).not.toContain(id);
        expect(ids).toEqual(['nav_leads', 'nav_reports']);
    });

    it('unresolvable permission-set holdings deny the set-gated entries and keep the `org` ones', async () => {
        const { rest } = setup({ holdings: 'unresolvable' });
        expect(navIds(await listedApp(rest))).toEqual(NON_HOLDER_NAV);
    });

    it('no gate handed to the filter at all: `doc` entries are dropped, not served', () => {
        const rest: any = new RestServer(createMockServer() as any, {} as any, {} as any);
        const out = rest.filterAppForUser(clone(CRM_APP), new Set(['crm.reports']));
        expect(navIds(out)).toEqual(['nav_leads', 'nav_reports']);
    });
});

describe('[#19790] the fast path and the existence question', () => {
    const FAST_APP = {
        name: 'crm',
        navigation: [
            { id: 'nav_intro', type: 'doc', doc: 'crm_intro' },
            { id: 'nav_help', type: 'doc', book: 'help_center' },
            // Existence is `docs/nav-target`'s question. The resolver's own
            // default for a doc it has no entry for is `org`: served.
            { id: 'nav_unwritten_doc', type: 'doc', doc: 'not_written_yet' },
            // A name no book or package carries: its implicit book has no page.
            { id: 'nav_no_such_book', type: 'doc', book: 'no_such_book' },
        ],
    };

    it('no set-gated book anywhere: readable entries stay, a book with no page goes, no holdings resolved', async () => {
        const { rest, protocol, resolvePermissionSetNames } = setup({ books: [HELP_CENTER], apps: [FAST_APP] });

        expect(navIds(await listedApp(rest))).toEqual(['nav_intro', 'nav_help', 'nav_unwritten_doc']);
        expect(resolvePermissionSetNames).not.toHaveBeenCalled();
        // The corpus is read once, and only because a `book` entry needs its pages.
        expect(reads(protocol, 'doc')).toBe(1);
    });

    it('no set-gated book and no `book` entry: no doc corpus read at all', async () => {
        const app = { name: 'crm', navigation: [{ id: 'nav_intro', type: 'doc', doc: 'crm_intro' }] };
        const { rest, protocol } = setup({ books: [HELP_CENTER], apps: [app] });

        expect(navIds(await listedApp(rest))).toEqual(['nav_intro']);
        expect(reads(protocol, 'book')).toBe(1);
        expect(reads(protocol, 'doc')).toBe(0);
    });
});

describe('[#19790] cost — resolved once per request, and not at all without a `doc` entry', () => {
    it('an app list with no `doc` entry reads no book, no doc and no holdings', async () => {
        const plain = { name: 'sales', navigation: [{ id: 'nav_leads', type: 'object', objectName: 'lead' }] };
        const { rest, protocol, resolvePermissionSetNames } = setup({ apps: [plain] });

        expect(navIds(await listedApp(rest, 'sales'))).toEqual(['nav_leads']);
        expect(reads(protocol, 'book')).toBe(0);
        expect(reads(protocol, 'doc')).toBe(0);
        expect(resolvePermissionSetNames).not.toHaveBeenCalled();
    });

    it('two apps with `doc` entries: one book read, one doc read, one holdings resolution for the whole list', async () => {
        const second = { ...clone(CRM_APP), name: 'support' };
        const { rest, protocol, resolvePermissionSetNames } = setup({ holdings: [], apps: [CRM_APP, second] });

        const apps = appsOf((await listApps(rest)).body);
        expect(apps.map((a: any) => navIds(a))).toEqual([NON_HOLDER_NAV, NON_HOLDER_NAV]);
        expect(reads(protocol, 'book')).toBe(1);
        expect(reads(protocol, 'doc')).toBe(1);
        expect(resolvePermissionSetNames).toHaveBeenCalledTimes(1);
    });
});

describe('[#19790] the anonymous path', () => {
    it('GET /meta/app is 401 before any read — there is no anonymous app nav for the arm to cover', async () => {
        const { rest, protocol } = setup({ anonymous: true });
        const res = await listApps(rest);

        expect(res.statusCode).toBe(401);
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });
});
