// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20237] Through a REAL `createHonoApp` host, the dispatcher's `/meta/:type`
 * LIST prunes exactly as `RestServer`'s does — the composed-host pin.
 *
 * ## What this pins
 *
 * A host that mounts only `@objectstack/hono`'s `${prefix}/*` catch-all — the
 * documented edge / serverless embed shape — has no `RestServer` at all: every
 * `GET /meta/:type` goes catch-all → `HttpDispatcher.dispatch()` → the domain
 * registry → `handleMetadataRequest`'s list branch. That branch applied no
 * per-caller gate, so a member who does not hold `crm_admin` listed the
 * `{ permissionSet }`-gated doc WITH its body (`?include=content`), the
 * set-gated book, an app whose `requiredPermissions` they lack, and an ungated
 * app with its `requiredPermissions`-gated nav entry. It now asks the one list
 * gate `RestServer`'s `GET /meta/:type` asks (`createMetaListReadGate`,
 * `@objectstack/rest`), and these rows hold the ANSWER ON THE WIRE — status,
 * the listed names, and whether the withheld content is in the body — for a
 * non-holder, with a holder as the control that the same host still serves.
 *
 * The three rows are the card's: the doc list with bodies, the book list, and
 * the app list. What `RestServer` answers the same caller is pinned beside the
 * dispatcher's in `meta-list-read-gate-parity.test.ts` (`@objectstack/runtime`).
 *
 * ## Where this lives, and the one stubbed seam
 *
 * Beside `hono-meta-item-read-gate.conformance.test.ts`, for its reasons:
 * `packages/adapters/hono/vitest.config.ts` aliases `@objectstack/runtime` to a
 * stub for its whole suite, so no test there can compose the real dispatcher;
 * here `@objectstack/hono` is this checkout's adapter SOURCE and
 * `@objectstack/runtime` is the real package through its `dist/` (a ledgered
 * pair in `scripts/check-test-source-alias.mjs`) — a runtime change reaches
 * these rows only once `@objectstack/runtime` is rebuilt. WHO the caller is
 * comes from the dispatcher's identity step (`timedResolveExecutionContext`),
 * replaced on the prototype by a lookup keyed on a request HEADER read off the
 * very Fetch `Request` the catch-all hands to `dispatch()`; everything after
 * identity — the catch-all, the registry, the handler, the gate, the adapter's
 * rendering — is the real code.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { HttpDispatcher } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';

const PREFIX = '/api/v1';
const PRINCIPAL_HEADER = 'x-probe-principal';

// ── Fixtures (the item pin's, as lists) ───────────────────────────────────────

const DOC_SECRET = 'Rotate the tenant signing keys before every release.';
const BOOK_SECRET = 'Restricted spine: the incident playbooks.';

const STORE: Record<string, any[]> = {
    book: [
        {
            name: 'admin_guide', label: 'Admin Guide', description: BOOK_SECRET,
            audience: { permissionSet: 'crm_admin' }, _packageId: 'crm',
            groups: [{ key: 'admin', label: 'Admin', include: 'crm_admin_*' }],
        },
        {
            name: 'help_center', label: 'Help Centre', audience: 'org', _packageId: 'crm',
            groups: [{ key: 'start', label: 'Start', include: 'crm_intro' }],
        },
    ],
    doc: [
        { name: 'crm_intro', label: 'Getting started', content: 'Welcome aboard.', _packageId: 'crm' },
        { name: 'crm_admin_runbook', label: 'Admin runbook', content: DOC_SECRET, _packageId: 'crm' },
    ],
    app: [
        {
            name: 'crm',
            label: 'CRM',
            navigation: [
                { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
                { id: 'nav_finance_ledger', type: 'page', label: 'Ledger', pageName: 'ledger', requiredPermissions: ['finance.access'] },
            ],
        },
        {
            name: 'payroll',
            label: 'Payroll',
            requiredPermissions: ['payroll.access'],
            navigation: [{ id: 'nav_payroll_runs', type: 'page', label: 'Runs', pageName: 'payroll_runs' }],
        },
    ],
    object: [],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

// ── Principals ────────────────────────────────────────────────────────────────

interface Principal { ctx: Record<string, unknown>; holdings: string[] }
const PRINCIPALS: Record<'holder' | 'non-holder', Principal> = {
    holder: {
        ctx: { userId: 'u_holder', isSystem: false, systemPermissions: ['finance.access', 'payroll.access'] },
        holdings: ['crm_admin'],
    },
    'non-holder': {
        ctx: { userId: 'u_member', isSystem: false, systemPermissions: [] },
        holdings: [],
    },
};
type PrincipalName = keyof typeof PRINCIPALS;
const principalOf = (request: any): Principal | undefined => {
    const name = request?.headers?.get?.(PRINCIPAL_HEADER) as PrincipalName | null;
    return name ? PRINCIPALS[name] : undefined;
};

// ── The composed host ─────────────────────────────────────────────────────────

/**
 * A real `LiteKernel` carrying the two services the `/meta` list consults
 * (`protocol`, and `security` for permission-set holdings), and the REAL
 * `createHonoApp` over it.
 */
async function boot() {
    const getMetaItems = vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? []));
    const protocol = { getMetaItems };
    const security = {
        // Holdings are answered for the context the gate hands in — the
        // principal the identity step resolved for THIS request.
        resolvePermissionSetNames: async (ctx: any) =>
            Object.values(PRINCIPALS).find((p) => p.ctx.userId === ctx?.userId)?.holdings ?? [],
    };

    const kernel = new LiteKernel();
    kernel.use({
        metadata: { name: 'test-meta-list-read-gate-services', version: '1.0.0' },
        init: (c: any) => {
            c.registerService('protocol', protocol);
            c.registerService('security', security);
        },
    } as any);
    await kernel.bootstrap();

    vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext')
        .mockImplementation(async (opts: any) => clone(principalOf(opts?.request)?.ctx ?? { isSystem: false }));

    const app = createHonoApp({ kernel: kernel as any, prefix: PREFIX, cors: false });
    const read = async (as: PrincipalName, path: string) => {
        const res = await app.request(`http://localhost${PREFIX}${path}`, { headers: { [PRINCIPAL_HEADER]: as } });
        const text = await res.text();
        const body = JSON.parse(text);
        const data = body?.data;
        const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        return { status: res.status, text, body, items };
    };
    return { read, getMetaItems };
}

afterEach(() => { vi.restoreAllMocks(); });

const names = (items: any[]): string[] => items.map((i: any) => i?.name);
const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);

// ── The three rows, non-holder ────────────────────────────────────────────────

describe('[#20237] a real createHonoApp host lists the non-holder what RestServer lists — the three rows', () => {
    it('the doc list with bodies: 200, the gated doc left out, and its body nowhere on the wire', async () => {
        const { read, getMetaItems } = await boot();
        const res = await read('non-holder', '/meta/doc?include=content');

        expect(res.status).toBe(200);
        expect(res.body?.success).toBe(true);
        expect(names(res.items)).toEqual(['crm_intro']);
        // The opt-in still serves the bodies the caller may read.
        expect(res.items[0]?.content).toBe('Welcome aboard.');
        expect(res.text).not.toContain('crm_admin_runbook');
        expect(res.text).not.toContain(DOC_SECRET);
        // Reached through the catch-all's `/meta` domain — the list read ran.
        expect(getMetaItems).toHaveBeenCalledWith(expect.objectContaining({ type: 'doc' }));
    }, 30_000);

    it('the book list: 200, the set-gated book left out', async () => {
        const { read } = await boot();
        const res = await read('non-holder', '/meta/book');

        expect(res.status).toBe(200);
        expect(names(res.items)).toEqual(['help_center']);
        expect(res.text).not.toContain('admin_guide');
        expect(res.text).not.toContain(BOOK_SECRET);
    }, 30_000);

    it('the app list: 200, the requiredPermissions-gated app left out and the ungated app PRUNED of its gated entry', async () => {
        const { read } = await boot();
        const res = await read('non-holder', '/meta/app');

        expect(res.status).toBe(200);
        expect(names(res.items)).toEqual(['crm']);
        expect(navIds(res.items[0])).toEqual(['nav_leads']);
        expect(res.text).not.toContain('payroll');
        expect(res.text).not.toContain('nav_finance_ledger');
    }, 30_000);
});

// ── The control: the same host still serves a holder ──────────────────────────

describe('[#20237] control — the same host lists a holder every row in full', () => {
    it('the doc list with bodies: both docs, the gated body included', async () => {
        const { read } = await boot();
        const res = await read('holder', '/meta/doc?include=content');
        expect(res.status).toBe(200);
        expect(names(res.items)).toEqual(['crm_intro', 'crm_admin_runbook']);
        expect(res.text).toContain(DOC_SECRET);
    }, 30_000);

    it('the book list: both books', async () => {
        const { read } = await boot();
        const res = await read('holder', '/meta/book');
        expect(res.status).toBe(200);
        expect(names(res.items)).toEqual(['admin_guide', 'help_center']);
        expect(res.text).toContain(BOOK_SECRET);
    }, 30_000);

    it('the app list: both apps, every entry', async () => {
        const { read } = await boot();
        const res = await read('holder', '/meta/app');
        expect(res.status).toBe(200);
        expect(names(res.items)).toEqual(['crm', 'payroll']);
        expect(navIds(res.items[0])).toEqual(['nav_leads', 'nav_finance_ledger']);
    }, 30_000);
});
