// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20338] The dispatcher's `/meta` draft doors admit exactly the callers its
 * own `GET /meta/_drafts` admits — the authoring capability
 * (`isObjectSchemaMaskExempt`: `studio.access`, `setup.access`,
 * `manage_metadata`, or a system caller) — and answer everyone else the
 * published version.
 *
 * ## The defect
 *
 * `handleMetadataRequest` reads `?preview=draft` on two doors — the item read
 * (the protocol prefers a pending draft) and the list (pending drafts overlaid,
 * draft-only items added) — and handed the switch to the protocol for any
 * caller, under a comment promising 「Admin gating is layered on top in a
 * follow-up」 that never came. On a host that mounts only the `${prefix}/*`
 * catch-all this dispatcher is the only `/meta` answer, so a member who may
 * open an app read its pending draft here exactly as on `RestServer`.
 *
 * ## What a caller without the capability is answered
 *
 * What the door answers without the switch — byte for byte the plain read —
 * so a draft-only item is this door's own 404 and a list omits it. The same
 * answer `RestServer` gives (the parity block below drives both transports),
 * whose real-stack pins are `packages/rest/src/meta-draft-read-builder-gate.test.ts`.
 * The protocol here is a double that mirrors the protocol's overlay rules
 * (draft wins, falls back to active, draft-only items surface) because the
 * dispatcher's whole contribution is WHETHER it hands the switch on; the
 * double records every request so that is asserted directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isObjectSchemaMaskExempt } from '@objectstack/metadata-core';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ATLAS = {
    name: 'atlas',
    label: 'Atlas',
    navigation: [{ id: 'nav_leads', type: 'page', label: 'Leads', pageName: 'leads_home' }],
};
const ATLAS_DRAFT = {
    ...ATLAS,
    label: 'Atlas (draft)',
    navigation: [...ATLAS.navigation, { id: 'nav_atlas_launch_plan', type: 'page', label: 'Launch plan', pageName: 'launch_plan' }],
};
/** Never published. */
const BEACON_DRAFT = {
    name: 'beacon',
    label: 'Beacon',
    navigation: [{ id: 'nav_beacon_home', type: 'page', label: 'Home', pageName: 'beacon_home' }],
};
const PUBLISHED: Record<string, any[]> = { app: [ATLAS] };
const DRAFTS: Record<string, any[]> = { app: [ATLAS_DRAFT, BEACON_DRAFT] };
const DRAFT_ONLY_TEXT = ['Atlas (draft)', 'nav_atlas_launch_plan', 'Beacon', 'nav_beacon_home'];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

// ── Callers ───────────────────────────────────────────────────────────────────

const CALLERS = {
    /** May open the app; holds no authoring capability. */
    member: { userId: 'u_member', isSystem: false, systemPermissions: [] as string[] },
    /** One per authoring capability `_drafts` admits. */
    studioBuilder: { userId: 'u_studio', isSystem: false, systemPermissions: ['studio.access'] },
    setupAdmin: { userId: 'u_setup', isSystem: false, systemPermissions: ['setup.access'] },
    author: { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] },
    /** Writes org-scoped presentation overlays, but holds no authoring capability. */
    presenter: { userId: 'u_presenter', isSystem: false, systemPermissions: ['manage_org_presentation'] },
} as const;
type CallerName = keyof typeof CALLERS;
const BUILDERS = ['studioBuilder', 'setupAdmin', 'author'] as const satisfies readonly CallerName[];

// ── The protocol double ───────────────────────────────────────────────────────

/** The protocol's overlay rules: a pending draft wins, else the active item; draft-only items surface. */
function protocolDouble() {
    return {
        getMetaTypes: vi.fn(async () => ({ types: ['app'] })),
        getMetaItems: vi.fn(async ({ type, previewDrafts }: any) => {
            const t = singular(type);
            const items = new Map<string, any>((PUBLISHED[t] ?? []).map((i) => [i.name, clone(i)]));
            if (previewDrafts) for (const d of DRAFTS[t] ?? []) items.set(d.name, { ...clone(d), _draft: true });
            return [...items.values()];
        }),
        getMetaItem: vi.fn(async ({ type, name, previewDrafts }: any) => {
            const t = singular(type);
            const draft = previewDrafts ? (DRAFTS[t] ?? []).find((i) => i.name === name) : undefined;
            const active = (PUBLISHED[t] ?? []).find((i) => i.name === name);
            const item = draft ? { ...clone(draft), _draft: true } : (active ? clone(active) : undefined);
            return { type: t, name, item, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        listDrafts: vi.fn(async () => ({ items: [] })),
    };
}
type ProtocolDouble = ReturnType<typeof protocolDouble>;

/** Every draft switch the protocol was handed, on either read. */
const draftRequests = (protocol: ProtocolDouble): unknown[] => [
    ...protocol.getMetaItem.mock.calls.map(([r]: any[]) => r).filter((r: any) => r?.previewDrafts === true || r?.state === 'draft'),
    ...protocol.getMetaItems.mock.calls.map(([r]: any[]) => r).filter((r: any) => r?.previewDrafts === true),
];

const securityDouble = {
    resolvePermissionSetNames: async () => [],
    getMetadataReadableFields: async () => undefined,
};

// ── The two transports ────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; body: any }

/** The dispatcher, exactly as `createHonoApp` builds it: `new HttpDispatcher(kernel)`. */
function bootDispatcher(who: CallerName) {
    const protocol = protocolDouble();
    const services: Record<string, unknown> = { protocol, security: securityDouble };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (as the sibling dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(CALLERS[who]);
    const read = async (path: string, query: Record<string, string> = {}): Promise<Answer> => {
        const res = await dispatcher.dispatch('GET', path, undefined, query, { request: { headers: {} } } as any);
        const body = res.response?.body;
        return { status: res.response?.status ?? 0, code: body?.error?.code, body };
    };
    return { read, protocol };
}

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.send = vi.fn(() => res);
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

/** `RestServer` over the same double and the same caller — the reference answer. */
function bootRest(who: CallerName) {
    const protocol = protocolDouble();
    const rest: any = new RestServer(createMockServer() as any, protocol as any, {} as any);
    rest.resolveExecCtx = async () => clone(CALLERS[who]);
    rest.securityServiceProvider = async () => securityDouble;
    rest.registerRoutes();
    const META = '/api/v1/meta';
    const item = async (type: string, name: string, query: Record<string, string> = {}) => {
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}/:type/:name`);
        const res = makeRes();
        await route.handler({ method: 'GET', path: `${META}/${type}/${name}`, params: { type, name }, query, body: {}, headers: {} }, res);
        return res;
    };
    return { item, protocol };
}

const text = (a: Answer): string => JSON.stringify(a.body ?? null);
const servedItem = (a: Answer) => a.body?.data?.item;
const listedNames = (a: Answer): string[] => {
    const data = a.body?.data;
    const items = Array.isArray(data) ? data : (data?.items ?? []);
    return items.map((i: any) => i?.name).sort();
};

// ── The item read ─────────────────────────────────────────────────────────────

describe('[#20338] dispatcher GET /meta/:type/:name?preview=draft', () => {
    it('a member reads the PUBLISHED app — the dispatcher\'s plain read, byte for byte — and the protocol is never handed the switch', async () => {
        const { read, protocol } = bootDispatcher('member');
        const plain = await read('/meta/app/atlas');
        const res = await read('/meta/app/atlas', { preview: 'draft' });

        expect(plain.status).toBe(200);
        expect(res.status).toBe(200);
        expect(servedItem(res)?.label).toBe('Atlas');
        expect(res.body).toEqual(plain.body);
        for (const s of DRAFT_ONLY_TEXT) expect(text(res)).not.toContain(s);
        expect(draftRequests(protocol)).toEqual([]);
    });

    it('a draft-only app answers the member the plain read\'s 404, never the draft', async () => {
        const { read, protocol } = bootDispatcher('member');
        const plain = await read('/meta/app/beacon');
        const res = await read('/meta/app/beacon', { preview: 'draft' });

        expect(plain.status).toBe(404);
        expect({ status: res.status, code: res.code }).toEqual({ status: plain.status, code: plain.code });
        expect(res.body).toEqual(plain.body);
        for (const s of DRAFT_ONLY_TEXT) expect(text(res)).not.toContain(s);
        expect(draftRequests(protocol)).toEqual([]);
    });

    it('every builder reads the draft (the control): the pending draft wins, and a draft-only app is served', async () => {
        for (const who of BUILDERS) {
            const { read } = bootDispatcher(who);
            const res = await read('/meta/app/atlas', { preview: 'draft' });
            expect(res.status, who).toBe(200);
            expect(servedItem(res)?.label, who).toBe('Atlas (draft)');
            const draftOnly = await read('/meta/app/beacon', { preview: 'draft' });
            expect(draftOnly.status, who).toBe(200);
            expect(servedItem(draftOnly)?.label, who).toBe('Beacon');
        }
    });
});

// ── The list ──────────────────────────────────────────────────────────────────

describe('[#20338] dispatcher GET /meta/:type?preview=draft', () => {
    it('a member reads the published list — the plain list, byte for byte — and the protocol is never handed the switch', async () => {
        const { read, protocol } = bootDispatcher('member');
        const plain = await read('/meta/app');
        const res = await read('/meta/app', { preview: 'draft' });

        expect(res.status).toBe(200);
        expect(listedNames(res)).toEqual(['atlas']);
        expect(res.body).toEqual(plain.body);
        for (const s of DRAFT_ONLY_TEXT) expect(text(res)).not.toContain(s);
        expect(draftRequests(protocol)).toEqual([]);
    });

    it('every builder reads the draft overlay (the control)', async () => {
        for (const who of BUILDERS) {
            const { read } = bootDispatcher(who);
            const res = await read('/meta/app', { preview: 'draft' });
            expect(res.status, who).toBe(200);
            expect(listedNames(res), who).toEqual(['atlas', 'beacon']);
            expect(text(res), who).toContain('Atlas (draft)');
        }
    });
});

// ── One predicate, both transports ────────────────────────────────────────────

describe('[#20338] one predicate: the draft doors admit exactly who GET /meta/_drafts admits, on both transports', () => {
    for (const who of Object.keys(CALLERS) as CallerName[]) {
        it(who, async () => {
            const admitted = isObjectSchemaMaskExempt(CALLERS[who]);
            const { read } = bootDispatcher(who);

            // The dispatcher's own `_drafts` door is the reference.
            const listing = await read('/meta/_drafts');
            expect(listing.status !== 403, '_drafts admission').toBe(admitted);

            const item = await read('/meta/app/atlas', { preview: 'draft' });
            const list = await read('/meta/app', { preview: 'draft' });
            expect(servedItem(item)?.label === 'Atlas (draft)', 'dispatcher item').toBe(admitted);
            expect(listedNames(list).includes('beacon'), 'dispatcher list').toBe(admitted);

            // RestServer answers the same caller the same item.
            const rest = await bootRest(who).item('app', 'atlas', { preview: 'draft' });
            expect(rest.statusCode).toBe(200);
            expect(rest.body?.item?.label, 'RestServer item').toBe(servedItem(item)?.label);
        });
    }
});

// ── The census of this file's draft doors ─────────────────────────────────────

/**
 * Every draft switch `meta.ts` reads, found by walking its AST: a comparison
 * against the literal `'draft'`, a `.previewDrafts` read, and a `.listDrafts`
 * reference. Each must be LEDGERED below, and each `read` row must be admitted
 * by `mayReadPendingDrafts` — either inside the switch's own declaration
 * (`const previewDrafts = … && mayReadPendingDrafts(ec)`), or behind an earlier
 * `if (!mayReadPendingDrafts(…))` refusal in an enclosing block (the `_drafts`
 * listing, which has no published answer to fall back to). A door added later
 * that reads a draft is a new site: it reddens this block until it is gated
 * and ledgered. The helper itself must stay a bare delegation to the ONE
 * predicate `_drafts` has always asked — never a second rule.
 */
describe('[#20338] census: every draft switch in domains/meta.ts is ledgered, and every read asks mayReadPendingDrafts', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const FILE = 'meta.ts';
    const sf = ts.createSourceFile(FILE, readFileSync(resolve(HERE, FILE), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

    const LEDGER: ReadonlyArray<{ site: string; count: number; disposition: 'read' | 'listing' }> = [
        // The item read's and the list's `?preview=draft` — the switch declared with its admission,
        // [#20408] parsed case-insensitively as `RestServer` parses it.
        { site: "query.preview.toLowerCase() === 'draft'", count: 2, disposition: 'read' },
        // [#20320] The item read's `?state=draft` — the pending draft row, declared with its admission.
        { site: "query.state.toLowerCase() === 'draft'", count: 1, disposition: 'read' },
        // `GET /meta/_drafts` — the probe and the call, behind the 403.
        { site: 'protocol.listDrafts', count: 2, disposition: 'listing' },
    ];

    const isAdmission = (n: ts.Node): boolean =>
        ts.isCallExpression(n) && n.expression.getText(sf) === 'mayReadPendingDrafts';
    const contains = (root: ts.Node, pred: (n: ts.Node) => boolean): boolean => {
        let hit = false;
        const walk = (n: ts.Node): void => { if (hit) return; if (pred(n)) { hit = true; return; } ts.forEachChild(n, walk); };
        walk(root);
        return hit;
    };
    const isDraftSite = (n: ts.Node): boolean =>
        (ts.isBinaryExpression(n)
            && (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
            && [n.left, n.right].some((side) => ts.isStringLiteral(side) && side.text === 'draft'))
        || (ts.isPropertyAccessExpression(n) && ['previewDrafts', 'listDrafts'].includes(n.name.text));

    const sites: ts.Node[] = [];
    const visit = (n: ts.Node): void => { if (isDraftSite(n)) sites.push(n); ts.forEachChild(n, visit); };
    visit(sf);

    /** Admitted in its own declaration. */
    const admittedInDeclaration = (site: ts.Node): boolean => {
        for (let at: ts.Node | undefined = site.parent; at; at = at.parent) {
            if (ts.isVariableDeclaration(at)) return at.initializer ? contains(at.initializer, isAdmission) : false;
            if (ts.isStatement(at)) return false;
        }
        return false;
    };
    /** Behind an earlier `if (!mayReadPendingDrafts(…))` in an enclosing block. */
    const behindRefusal = (site: ts.Node): boolean => {
        for (let child: ts.Node = site, at = site.parent; at; child = at, at = at.parent) {
            if (!ts.isBlock(at)) continue;
            const before = at.statements.filter((s) => s.end <= child.getStart(sf));
            if (before.some((s) => ts.isIfStatement(s)
                && ts.isPrefixUnaryExpression(s.expression) && s.expression.operator === ts.SyntaxKind.ExclamationToken
                && isAdmission(s.expression.operand))) return true;
        }
        return false;
    };

    it('the sites found are exactly the ledgered ones', () => {
        const found = new Map<string, number>();
        for (const s of sites) found.set(collapse(s.getText(sf)), (found.get(collapse(s.getText(sf))) ?? 0) + 1);
        const declared = new Map(LEDGER.map((row) => [row.site, row.count]));
        expect(
            Object.fromEntries([...found].sort()),
            'a draft switch this ledger does not name: a door that reads a pending draft asks mayReadPendingDrafts first, '
            + 'answers a caller it does not admit the published version, is pinned above, and is ledgered here',
        ).toEqual(Object.fromEntries([...declared].sort()));
    });

    it('every read switch carries its admission, and the listing sits behind its refusal', () => {
        for (const s of sites) {
            const row = LEDGER.find((r) => r.site === collapse(s.getText(sf)));
            const line = sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1;
            if (row?.disposition === 'read') expect(admittedInDeclaration(s), `${FILE}:${line} ${row.site}`).toBe(true);
            if (row?.disposition === 'listing') expect(behindRefusal(s), `${FILE}:${line} ${row.site}`).toBe(true);
        }
    });

    it('mayReadPendingDrafts is a bare delegation to isObjectSchemaMaskExempt — the one predicate, never a second rule', () => {
        const fns = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'mayReadPendingDrafts');
        expect(fns).toHaveLength(1);
        const [param] = fns[0].parameters;
        expect(collapse(fns[0].body?.statements.map((s) => s.getText(sf)).join(' ') ?? ''))
            .toBe(`return isObjectSchemaMaskExempt(${param.name.getText(sf)});`);
    });
});
