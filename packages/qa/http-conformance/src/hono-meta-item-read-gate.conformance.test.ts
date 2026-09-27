// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20193] Through a REAL `createHonoApp` host, the dispatcher's `/meta` item
 * reads refuse and prune exactly as `RestServer` does — the composed-host pin.
 *
 * ## What this pins
 *
 * A host that mounts only `@objectstack/hono`'s `${prefix}/*` catch-all — the
 * documented edge / serverless embed shape — has no `RestServer` at all: every
 * `GET /meta/:type/:name` goes catch-all → `HttpDispatcher.dispatch()` → the
 * domain registry → `handleMetadataRequest`. That handler applied no per-caller
 * read gate, so a member who does not hold `crm_admin` read the
 * `{ permissionSet }`-gated doc body, its `/published` twin and the set-gated
 * book, and an app's `requiredPermissions`-gated nav entry reached every member.
 * It now asks the one gate `RestServer` asks (`createMetaItemReadGate`,
 * `@objectstack/rest`), and these rows hold the ANSWER ON THE WIRE — status,
 * `error.code`, and whether the withheld content is in the body — for a
 * non-holder, with a holder as the control that the same host still serves.
 *
 * The four rows are the card's: the doc, the doc's `/published`, the set-gated
 * book, and the `requiredPermissions`-gated app entry.
 *
 * ## ⚠️ Why this lives HERE and not in `packages/adapters/hono`
 *
 * `packages/adapters/hono/vitest.config.ts` aliases `@objectstack/runtime` to a
 * hand-written stub for its whole suite, and `createHonoApp` imports
 * `HttpDispatcher` from that specifier — so no test in that package can reach
 * the real dispatcher, and a "composed" host built there would compose the
 * stub. This package is where the repo already boots the two for real (see
 * `hono-dispatcher-result-response.conformance.test.ts`): `@objectstack/hono`
 * is aliased to this checkout's adapter SOURCE, and `@objectstack/runtime` is
 * the real package (through its `dist/`, a ledgered pair in
 * `scripts/check-test-source-alias.mjs`). So a runtime change reaches these
 * rows only once `@objectstack/runtime` is rebuilt — which is how CI builds
 * the closure before it tests.
 *
 * ## The one seam that is stubbed, and why
 *
 * WHO the caller is comes from the dispatcher's identity step
 * (`timedResolveExecutionContext`), whose real inputs are a better-auth session
 * and the authorization tables — neither of which this boot has. It is replaced
 * on the prototype (the instance `createHonoApp` constructs for itself is the
 * one that runs) by a lookup keyed on a request HEADER, read off the very Fetch
 * `Request` the catch-all hands to `dispatch()`. So the principal still arrives
 * on the wire, and everything after identity — the catch-all, the registry,
 * the handler, the gate, the adapter's rendering — is the real code.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { HttpDispatcher } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';

const PREFIX = '/api/v1';
const PRINCIPAL_HEADER = 'x-probe-principal';

// ── Fixtures (the #20156 door census's own, trimmed to the four rows) ─────────

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
    app: [{
        name: 'crm',
        label: 'CRM',
        navigation: [
            { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
            { id: 'nav_finance_ledger', type: 'page', label: 'Ledger', pageName: 'ledger', requiredPermissions: ['finance.access'] },
        ],
    }],
    object: [],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const find = (type: unknown, name: unknown): any =>
    (STORE[singular(type)] ?? []).find((i: any) => i.name === name);

// ── Principals ────────────────────────────────────────────────────────────────

interface Principal { ctx: Record<string, unknown>; holdings: string[] }
const PRINCIPALS: Record<'holder' | 'non-holder', Principal> = {
    holder: {
        ctx: { userId: 'u_holder', isSystem: false, systemPermissions: ['finance.access'] },
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
 * A real `LiteKernel` carrying the two services the `/meta` item read consults
 * (`protocol`, and `security` for permission-set holdings), and the REAL
 * `createHonoApp` over it.
 */
async function boot() {
    const getMetaItem = vi.fn(async ({ type, name }: any) => {
        const found = find(type, name);
        return { type: singular(type), name, item: found ? clone(found) : undefined };
    });
    const protocol = {
        getMetaItems: vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? [])),
        getMetaItem,
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            const layer = () => (found ? clone(found) : null);
            return { type: singular(type), name, code: layer(), overlay: layer(), effective: layer() };
        }),
    };
    const security = {
        // Holdings are answered for the context the gate hands in — the
        // principal the identity step resolved for THIS request.
        resolvePermissionSetNames: async (ctx: any) =>
            Object.values(PRINCIPALS).find((p) => p.ctx.userId === ctx?.userId)?.holdings ?? [],
    };

    const kernel = new LiteKernel();
    kernel.use({
        metadata: { name: 'test-meta-read-gate-services', version: '1.0.0' },
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
        return { status: res.status, text, body: JSON.parse(text) };
    };
    return { read, getMetaItem };
}

afterEach(() => { vi.restoreAllMocks(); });

const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);

// ── The four rows, non-holder ─────────────────────────────────────────────────

describe('[#20193] a real createHonoApp host refuses the non-holder what RestServer refuses — the four rows', () => {
    const REFUSED: Array<{ row: string; path: string; secret: string }> = [
        { row: 'the gated doc', path: '/meta/doc/crm_admin_runbook', secret: DOC_SECRET },
        { row: 'the gated doc, /published', path: '/meta/doc/crm_admin_runbook/published', secret: DOC_SECRET },
        { row: 'the set-gated book', path: '/meta/book/admin_guide', secret: BOOK_SECRET },
    ];

    for (const { row, path, secret } of REFUSED) {
        it(`${row}: 403 PERMISSION_DENIED, and none of it on the wire`, async () => {
            const { read } = await boot();
            const res = await read('non-holder', path);

            // The ADR-0112 envelope — both halves, never a bare status.
            expect(res.status).toBe(403);
            expect(res.body?.success).toBe(false);
            expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
            expect(res.text).not.toContain(secret);
        }, 30_000);
    }

    it('the requiredPermissions-gated app entry: 200, the app PRUNED of the entry', async () => {
        const { read, getMetaItem } = await boot();
        const res = await read('non-holder', '/meta/app/crm');

        expect(res.status).toBe(200);
        expect(res.body?.success).toBe(true);
        expect(navIds(res.body?.data?.item)).toEqual(['nav_leads']);
        expect(res.text).not.toContain('nav_finance_ledger');
        // Reached through the catch-all's `/meta` domain — the item read ran.
        expect(getMetaItem).toHaveBeenCalledTimes(1);
    }, 30_000);
});

// ── The control: the same host still serves a holder ──────────────────────────

describe('[#20193] control — the same host serves a holder every row in full', () => {
    it('the gated doc and its /published twin: 200, the body', async () => {
        const { read } = await boot();
        for (const path of ['/meta/doc/crm_admin_runbook', '/meta/doc/crm_admin_runbook/published']) {
            const res = await read('holder', path);
            expect(res.status, path).toBe(200);
            expect(res.text, path).toContain(DOC_SECRET);
        }
    }, 30_000);

    it('the set-gated book: 200, the book', async () => {
        const { read } = await boot();
        const res = await read('holder', '/meta/book/admin_guide');
        expect(res.status).toBe(200);
        expect(res.body?.data?.item?.description).toBe(BOOK_SECRET);
    }, 30_000);

    it('the app: 200, every entry', async () => {
        const { read } = await boot();
        const res = await read('holder', '/meta/app/crm');
        expect(res.status).toBe(200);
        expect(navIds(res.body?.data?.item)).toEqual(['nav_leads', 'nav_finance_ledger']);
    }, 30_000);
});
