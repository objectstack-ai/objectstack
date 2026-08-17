// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0076 D11 step ③ (#2462) — the thin domain-handler registry seam.
 *
 * Two layers under test:
 *  1. `DomainHandlerRegistry` matching semantics (first-match, exact vs
 *     prefix, method restriction) — deliberately faithful to the legacy
 *     if-chain, rough edges included.
 *  2. `HttpDispatcher` integration: the four seeded builtin domains
 *     (/health /ready /analytics /i18n) behave exactly as their legacy
 *     if-chain branches did, and `registerDomainHandler` is the public
 *     seam follow-up domain PRs will use.
 */

import { describe, it, expect, vi } from 'vitest';
import { envelopeViolations } from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';
import { DomainHandlerRegistry } from './domain-handler-registry.js';
import type { DomainHandler } from './domain-handler-registry.js';

const okHandler = (tag: string): DomainHandler =>
    async () => ({ handled: true, response: { status: 200, body: { tag } } });

/** Minimal kernel: objectql + optional extra services. */
function makeKernel(services: Record<string, any> = {}, state = 'running') {
    const objectql = {
        find: vi.fn().mockResolvedValue([]),
        getObjects: vi.fn().mockReturnValue({}),
        registry: { getObject: vi.fn().mockReturnValue(null), getRegisteredTypes: vi.fn().mockReturnValue([]) },
    };
    const all: Record<string, any> = { objectql, ...services };
    const kernel: any = {
        getState: () => state,
        getService: (name: string) => all[name] ?? null,
        getServiceAsync: async (name: string) => all[name] ?? null,
        context: { getService: (name: string) => all[name] ?? null },
    };
    return kernel;
}

function makeDispatcherWithKernelExtras(services: Record<string, any>, extras: Record<string, any>) {
    const kernel = makeKernel(services, 'running');
    Object.assign(kernel, extras);
    return new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
}

function makeDispatcher(services: Record<string, any> = {}, state = 'running') {
    return new HttpDispatcher(makeKernel(services, state), undefined, {
        enforceProjectMembership: false,
    });
}

// ---------------------------------------------------------------------------
// DomainHandlerRegistry matching semantics
// ---------------------------------------------------------------------------

describe('DomainHandlerRegistry', () => {
    it('resolves in registration order, first match wins', () => {
        const registry = new DomainHandlerRegistry();
        const first = okHandler('first');
        const second = okHandler('second');
        registry.register({ prefix: '/a', handler: first });
        registry.register({ prefix: '/a', handler: second });
        expect(registry.resolve('/a/x', 'GET')?.handler).toBe(first);
    });

    it("match: 'exact' does not claim sub-paths; default prefix match does (legacy startsWith, rough edges included)", () => {
        const registry = new DomainHandlerRegistry();
        registry.register({ prefix: '/health', match: 'exact', handler: okHandler('h') });
        registry.register({ prefix: '/i18n', handler: okHandler('i') });
        expect(registry.resolve('/health', 'GET')).toBeDefined();
        expect(registry.resolve('/health/deep', 'GET')).toBeUndefined();
        expect(registry.resolve('/i18n/locales', 'GET')).toBeDefined();
        // Faithful legacy semantics: bare startsWith also matches '/i18nxx'.
        expect(registry.resolve('/i18nxx', 'GET')).toBeDefined();
    });

    it('restricts by method when `methods` is set (case-insensitive on input)', () => {
        const registry = new DomainHandlerRegistry();
        registry.register({ prefix: '/health', match: 'exact', methods: ['GET'], handler: okHandler('h') });
        expect(registry.resolve('/health', 'get')).toBeDefined();
        expect(registry.resolve('/health', 'POST')).toBeUndefined();
    });

    it('rejects a prefix that does not start with a slash', () => {
        const registry = new DomainHandlerRegistry();
        expect(() => registry.register({ prefix: 'health', handler: okHandler('h') })).toThrow(/prefix/);
    });
});

// ---------------------------------------------------------------------------
// Dispatcher integration — seeded builtin domains keep legacy behavior
// ---------------------------------------------------------------------------

describe('HttpDispatcher domain registry (D11 step ③)', () => {
    it('GET /health serves the liveness payload', async () => {
        const result = await makeDispatcher().dispatch('GET', '/health', undefined, {}, {} as any);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.status).toBe('ok');
    });

    it('GET /ready reflects kernel state: running → 200, booting → 503', async () => {
        const ready = await makeDispatcher({}, 'running').dispatch('GET', '/ready', undefined, {}, {} as any);
        expect(ready.response?.status).toBe(200);
        expect(ready.response?.body?.data?.state).toBe('running');

        const booting = await makeDispatcher({}, 'initializing').dispatch('GET', '/ready', undefined, {}, {} as any);
        expect(booting.response?.status).toBe(503);
        expect(booting.response?.body?.error?.details?.state).toBe('initializing');
    });

    it('non-GET /health is NOT claimed by the health domain (falls through the legacy chain)', async () => {
        const result = await makeDispatcher().dispatch('POST', '/health', undefined, {}, {} as any);
        // Same as before the registry: no branch claims POST /health.
        expect(result.response?.status ?? 404).not.toBe(200);
    });

    it('/i18n keeps its in-handler 501 when the i18n service is absent', async () => {
        const result = await makeDispatcher().dispatch('GET', '/i18n/locales', undefined, {}, {} as any);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(501);
    });

    it('/i18n/locales serves from the i18n service when present', async () => {
        const i18n = { getLocales: vi.fn().mockReturnValue(['en', 'zh-CN']), getTranslations: vi.fn().mockReturnValue({}) };
        const result = await makeDispatcher({ i18n }).dispatch('GET', '/i18n/locales', undefined, {}, {} as any);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.locales.map((l: any) => l.code)).toEqual(['en', 'zh-CN']);
    });

    it('/analytics bridges to the analytics service exactly as the legacy branch did', async () => {
        const analytics = {
            query: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }),
            analyticsQuery: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }),
        };
        const result = await makeDispatcher({ analytics }).dispatch(
            'POST', '/analytics/query', { cube: 'orders', measures: ['count'] }, {}, {} as any,
        );
        expect(result.handled).toBe(true);
        // The bridge consulted the service (whichever entry point it uses).
        expect(
            analytics.query.mock.calls.length + analytics.analyticsQuery.mock.calls.length,
        ).toBeGreaterThan(0);
    });

    it('registerDomainHandler is the public seam: a service-owned domain resolves before the legacy chain', async () => {
        const dispatcher = makeDispatcher();
        const handler = vi.fn(async (req: any) => ({
            handled: true as const,
            response: { status: 200, body: { echo: req.path } },
        }));
        dispatcher.registerDomainHandler({ prefix: '/custom-domain', handler });

        const result = await dispatcher.dispatch('GET', '/custom-domain/thing', undefined, { q: '1' }, {} as any);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toMatchObject({ path: '/custom-domain/thing', method: 'GET' });
        expect(result.response?.body?.echo).toBe('/custom-domain/thing');
    });
});

// ---------------------------------------------------------------------------
// PR-2 — segment matching + extracted notification/security domains
// ---------------------------------------------------------------------------

describe('DomainHandlerRegistry segment matching (PR-2)', () => {
    it("match: 'segment' claims the prefix and slash-separated sub-paths, but not lexical extensions", () => {
        const registry = new DomainHandlerRegistry();
        registry.register({ prefix: '/security', match: 'segment', handler: okHandler('s') });
        expect(registry.resolve('/security', 'GET')).toBeDefined();
        expect(registry.resolve('/security/suggested-bindings', 'GET')).toBeDefined();
        // The legacy `=== p || startsWith(p + '/')` shape: '/securityfoo' is NOT claimed.
        expect(registry.resolve('/securityfoo', 'GET')).toBeUndefined();
    });
});

describe('HttpDispatcher extracted domains (PR-2)', () => {
    it('/notifications requires an authenticated user (401) when the service is wired', async () => {
        const notification = { listInbox: vi.fn().mockResolvedValue([]), markRead: vi.fn(), markAllRead: vi.fn() };
        const result = await makeDispatcher({ notification }).dispatch('GET', '/notifications', undefined, {}, {} as any);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(401);
    });

    it('/notifications lists the inbox for an authenticated user (thin delegate carries the extracted body)', async () => {
        const notification = { listInbox: vi.fn().mockResolvedValue([{ id: 'n1' }]), markRead: vi.fn(), markAllRead: vi.fn() };
        // Call the public delegate directly: dispatch() re-resolves identity
        // from the (mock, auth-less) kernel and would overwrite the seeded
        // executionContext with an anonymous one.
        const context: any = { executionContext: { userId: 'u1' } };
        const result = await makeDispatcher({ notification }).handleNotification('', 'GET', undefined, { limit: '5' }, context);
        expect(result.response?.status).toBe(200);
        expect(notification.listInbox).toHaveBeenCalledWith('u1', expect.objectContaining({ limit: 5 }));
    });

    it('/notifications tolerates redundant slashes in the sub-path (split+filter, CodeQL redos fix)', async () => {
        const notification = { listInbox: vi.fn(), markRead: vi.fn().mockResolvedValue({ updated: 1 }), markAllRead: vi.fn() };
        const context: any = { executionContext: { userId: 'u1' } };
        const result = await makeDispatcher({ notification }).handleNotification('//read//', 'POST', { ids: ['n1'] }, {}, context);
        expect(result.response?.status).toBe(200);
        expect(notification.markRead).toHaveBeenCalledWith('u1', ['n1']);
    });

    it('/security still answers 503 from inside the handler when no service is wired, for an authenticated caller (#7911: the anonymous-deny gate now runs BEFORE this, not after)', async () => {
        // Direct delegate call for the same reason as the notifications case
        // above: dispatch() re-resolves identity from the (mock, auth-less)
        // kernel and would overwrite the seeded executionContext with an
        // anonymous one, and an anonymous caller no longer reaches this probe
        // at all post-#7911 (see the anonymous-denial test right below). This
        // test's job is narrower than that: prove the in-handler 503 path
        // (`!service || typeof service.listAudienceBindingSuggestions !==
        // 'function'`) still exists once an authenticated caller has cleared
        // the gate -- the negative pin proving #7911 was a hoist, not a
        // deletion. Before #7911 the 503 sat AHEAD of the gate and this test
        // reached it anonymously by accident of the harness ("legacy
        // in-handler semantics"); now it sits after the gate, so the test
        // authenticates deliberately instead of relying on that accident.
        const context: any = { executionContext: { userId: 'admin-1' } };
        const result = await makeDispatcher().handleSecurity('/suggested-bindings', 'GET', undefined, {}, context);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(503);
    });

    it('/security denies anonymous callers unconditionally when the service is wired', async () => {
        const security = {
            listAudienceBindingSuggestions: vi.fn().mockResolvedValue([]),
            confirmAudienceBindingSuggestion: vi.fn(),
            dismissAudienceBindingSuggestion: vi.fn(),
        };
        const result = await makeDispatcher({ security }).dispatch('GET', '/security/suggested-bindings', undefined, {}, {} as any);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(401);
        expect(security.listAudienceBindingSuggestions).not.toHaveBeenCalled();
    });

    it('/security lists suggestions for an authenticated caller (thin delegate carries the extracted body)', async () => {
        const security = {
            listAudienceBindingSuggestions: vi.fn().mockResolvedValue([{ id: 's1' }]),
            confirmAudienceBindingSuggestion: vi.fn(),
            dismissAudienceBindingSuggestion: vi.fn(),
        };
        // Direct delegate call for the same reason as the notifications case.
        //
        // [#4127 batch 3] This asserted `status: 'open'` — not one of the three
        // values `AudienceBindingSuggestionFilter` declares. The test pinned the
        // unvalidated pass-through as EXPECTED, so it proved the delegate
        // carried a filter through and nothing about that filter being a status.
        // Same shape as the `auth.handler` mock in batch 1: coverage in
        // appearance, a wrong contract in substance. Now a real status.
        const context: any = { executionContext: { userId: 'admin-1' } };
        const result = await makeDispatcher({ security }).handleSecurity('/suggested-bindings', 'GET', undefined, { status: 'pending' }, context);
        expect(result.response?.status).toBe(200);
        expect(security.listAudienceBindingSuggestions).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'admin-1' }),
            expect.objectContaining({ status: 'pending' }),
        );
    });

    it('/security rejects a status filter that is not a declared status, without calling the service', async () => {
        const security = {
            listAudienceBindingSuggestions: vi.fn().mockResolvedValue([{ id: 's1' }]),
            confirmAudienceBindingSuggestion: vi.fn(),
            dismissAudienceBindingSuggestion: vi.fn(),
        };
        const context: any = { executionContext: { userId: 'admin-1' } };
        const result = await makeDispatcher({ security }).handleSecurity('/suggested-bindings', 'GET', undefined, { status: 'open' }, context);
        // Previously this reached the service and became `where.status = 'open'`,
        // which matched no row — an empty list that reads as "no suggestions"
        // rather than "that is not a status".
        expect(result.response?.status).toBe(400);
        expect(security.listAudienceBindingSuggestions).not.toHaveBeenCalled();
    });

    it('/security omits the status filter entirely when the query has none', async () => {
        const security = {
            listAudienceBindingSuggestions: vi.fn().mockResolvedValue([]),
            confirmAudienceBindingSuggestion: vi.fn(),
            dismissAudienceBindingSuggestion: vi.fn(),
        };
        const context: any = { executionContext: { userId: 'admin-1' } };
        const result = await makeDispatcher({ security }).handleSecurity('/suggested-bindings', 'GET', undefined, {}, context);
        expect(result.response?.status).toBe(200);
        expect(security.listAudienceBindingSuggestions).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'admin-1' }),
            expect.objectContaining({ status: undefined }),
        );
    });

    it('/securityfoo is NOT claimed by the security domain (segment semantics preserved from the if-chain)', async () => {
        const security = { listAudienceBindingSuggestions: vi.fn() };
        const result = await makeDispatcher({ security }).dispatch('GET', '/securityfoo', undefined, {}, {} as any);
        expect(security.listAudienceBindingSuggestions).not.toHaveBeenCalled();
        expect(result.response?.status ?? 404).not.toBe(200);
    });
});

// ---------------------------------------------------------------------------
// PR-3 — keys / storage / ui extraction (storage since retired, #4087)
// ---------------------------------------------------------------------------

describe('HttpDispatcher extracted domains (PR-3: keys/storage/ui)', () => {
    it('POST /keys rejects anonymous callers with 401 (identity gate inside the extracted body)', async () => {
        const result = await makeDispatcher().dispatch('POST', '/keys', { name: 'k' }, {}, {} as any);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(401);
    });

    it('GET /keys answers 405 (mint is POST-only), and /keysfoo is NOT claimed (segment semantics)', async () => {
        const dispatcher = makeDispatcher();
        const wrongMethod = await dispatcher.dispatch('GET', '/keys', undefined, {}, {} as any);
        expect(wrongMethod.response?.status).toBe(405);
        const lexical = await dispatcher.dispatch('POST', '/keysfoo', { name: 'k' }, {}, {} as any);
        expect(lexical.response?.status ?? 404).not.toBe(405);
    });

    it('POST /keys mints a key pinned to the caller (thin delegate carries the extracted body)', async () => {
        const insert = vi.fn().mockResolvedValue({ id: 'key-row-1' });
        const objectql = {
            insert,
            find: vi.fn().mockResolvedValue([]),
            getObjects: vi.fn().mockReturnValue({}),
            registry: { getObject: vi.fn().mockReturnValue(null), getRegisteredTypes: vi.fn().mockReturnValue([]) },
        };
        const context: any = { executionContext: { userId: 'caller-1' } };
        // Direct delegate call — dispatch() would re-resolve identity off the
        // auth-less mock kernel and overwrite the seeded executionContext.
        const result = await makeDispatcher({ objectql }).handleKeys('POST', { name: 'CI Key', user_id: 'attacker' }, context);
        expect(result.response?.status).toBe(201);
        const row = insert.mock.calls[0][1];
        expect(insert.mock.calls[0][0]).toBe('sys_api_key');
        // user_id pinned to caller; body's user_id ignored; only the hash stored.
        expect(row.user_id).toBe('caller-1');
        expect(row.key).not.toBe(result.response?.body?.data?.key);
        expect(result.response?.body?.data?.key).toBeTruthy();
    });

    /**
     * [#4087] `/storage` is no longer a dispatcher domain. The registry must
     * not claim the prefix in either direction — with the `file-storage` slot
     * empty AND with it filled, since the retired bridge's whole reason for
     * existing was "a service is registered, so route to it". It called that
     * service off-contract (`upload(key, data, options?)` invoked as
     * `upload(file, { request })`), and `@objectstack/service-storage` — which
     * mounts the real protocol on the http-server — never went through here.
     */
    it('/storage is not claimed by the registry, filled slot or not', async () => {
        // No domain matches, so dispatch's terminal exit answers — the same
        // ROUTE_NOT_FOUND every unregistered path gets, not a 501/500 from a
        // half-present bridge.
        const empty = await makeDispatcher().dispatch('POST', '/storage/upload', { blob: 1 }, {}, {} as any);
        expect(empty.response?.status).toBe(404);
        expect(empty.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');

        const upload = vi.fn();
        const download = vi.fn();
        const filled = await makeDispatcher({ 'file-storage': { upload, download } })
            .dispatch('POST', '/storage/upload', { some: 'file' }, {}, {} as any);
        expect(filled.response?.status).toBe(404);
        expect(upload).not.toHaveBeenCalled();

        const get = await makeDispatcher({ 'file-storage': { upload, download } })
            .dispatch('GET', '/storage/file/abc', undefined, {}, {} as any);
        expect(get.response?.status).toBe(404);
        expect(download).not.toHaveBeenCalled();
    });

    it('/ui/view/:object serves the protocol getUiView result; 501 without a protocol service', async () => {
        const getUiView = vi.fn().mockResolvedValue({ view: 'list-def' });
        const ok = await makeDispatcher({ protocol: { getUiView } }).dispatch('GET', '/ui/view/account/list', undefined, {}, {} as any);
        expect(ok.response?.status).toBe(200);
        expect(getUiView).toHaveBeenCalledWith({ object: 'account', type: 'list' });

        // [#4093 follow-up] Was 503. The route is mounted and the
        // implementation is absent — 501. 503 claimed the condition was
        // temporary; an uninstalled MetadataPlugin does not install itself.
        const missing = await makeDispatcher().dispatch('GET', '/ui/view/account', undefined, {}, {} as any);
        expect(missing.response?.status).toBe(501);
        expect(missing.response?.body?.error?.message ?? '').toContain('MetadataPlugin');
    });
});

// ---------------------------------------------------------------------------
// PR-4 — share-links extraction
// ---------------------------------------------------------------------------

describe('HttpDispatcher extracted domains (PR-4: share-links)', () => {
    it('/share-links responds 501 when the shareLinks service is absent', async () => {
        const result = await makeDispatcher().dispatch('GET', '/share-links', undefined, {}, {} as any);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(501);
    });

    it('/share-linksfoo is NOT claimed (segment semantics)', async () => {
        const shareLinks = { resolveToken: vi.fn(), createLink: vi.fn(), listLinks: vi.fn(), revokeLink: vi.fn() };
        const result = await makeDispatcher({ shareLinks }).dispatch('GET', '/share-linksfoo', undefined, {}, {} as any);
        expect(shareLinks.listLinks).not.toHaveBeenCalled();
        expect(result.response?.status ?? 404).not.toBe(501);
    });

    it('management routes reject anonymous callers with UNAUTHENTICATED', async () => {
        const shareLinks = { resolveToken: vi.fn(), createLink: vi.fn(), listLinks: vi.fn(), revokeLink: vi.fn() };
        const result = await makeDispatcher({ shareLinks })
            .handleShareLinks('', 'POST', { object: 'account', recordId: 'r1' }, {}, {} as any);
        expect(result.response?.status).toBe(401);
        // [#3842] Was `details.code`, parked there because `error.code` held 401.
        expect(result.response?.body?.error?.code).toBe('UNAUTHENTICATED');
    });

    it('public resolve route serves the record through the request-kernel engine with redaction', async () => {
        const resolveToken = vi.fn().mockResolvedValue({
            link: { id: 'l1', token: 't1', object_name: 'account', record_id: 'r1', permission: 'view', audience: 'anyone' },
            redactFields: ['secret'],
        });
        const find = vi.fn().mockResolvedValue([{ id: 'r1', name: 'Acme', secret: 'hide-me' }]);
        const dispatcher = makeDispatcher({
            shareLinks: { resolveToken },
            objectql: {
                find,
                getObjects: vi.fn().mockReturnValue({}),
                registry: { getObject: vi.fn().mockReturnValue(null), getRegisteredTypes: vi.fn().mockReturnValue([]) },
            },
        });
        const result = await dispatcher.handleShareLinks('/t1/resolve', 'GET', undefined, {}, {} as any);
        expect(result.response?.status).toBe(200);
        const record = result.response?.body?.data?.record;
        expect(record?.name).toBe('Acme');
        // redactFields stripped before the record leaves the server.
        expect(record?.secret).toBeUndefined();
    });

    // ── #4038: one shape, no duplicate keys ──────────────────────────────
    //
    // Create and list used to answer `{ success: true, data: link, link }` /
    // `{ …, data: links, links }` — the payload under BOTH the envelope's `data`
    // and a legacy top-level key. That shim existed because the sharing plugin's
    // routes (the other surface for these same paths) answered bare, so every
    // consumer had to read `body.links ?? body.data`. #3983 moved that surface
    // onto this shape and left the duplicate with no reader anywhere — framework,
    // objectui, or cloud — so it is gone. These pin that: a body that grows a
    // second spelling of its payload fails here.
    const authed: any = { executionContext: { userId: 'u1' } };
    const LINK = { id: 'l1', token: 't1', object_name: 'account', record_id: 'r1' };

    it('POST /share-links answers 201 { success, data } — data IS the link, no top-level `link`', async () => {
        const shareLinks = { createLink: vi.fn().mockResolvedValue(LINK) };
        const result = await makeDispatcher({ shareLinks })
            .handleShareLinks('', 'POST', { object: 'account', recordId: 'r1' }, {}, authed);
        expect(result.response?.status).toBe(201);
        expect(result.response?.body?.success).toBe(true);
        expect(result.response?.body?.data).toMatchObject({ id: 'l1', token: 't1' });
        expect(result.response?.body?.link).toBeUndefined();
    });

    it('GET /share-links answers { success, data } — data IS the array, no top-level `links`', async () => {
        const shareLinks = { listLinks: vi.fn().mockResolvedValue([LINK]) };
        const result = await makeDispatcher({ shareLinks }).handleShareLinks('', 'GET', undefined, {}, authed);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.success).toBe(true);
        expect(Array.isArray(result.response?.body?.data)).toBe(true);
        expect(result.response?.body?.data?.[0]).toMatchObject({ id: 'l1' });
        expect(result.response?.body?.links).toBeUndefined();
    });

    it('every success body carries its payload under `data` and nowhere else', async () => {
        // The general form of the two assertions above, over all the success
        // routes — and `envelopeViolations` (#4090) is now where that general form
        // lives. This test hand-rolled it first, for #4038; extracting it into the
        // spec meant the same rule stopped having two definitions that could drift
        // apart, which is the failure this whole line has been closing.
        //
        // The shared one is also stricter than what stood here: the local set
        // allowed any body whose keys were `success`/`data`/`meta`, so it passed a
        // success body with no `data` at all and one carrying an `error`.
        const shareLinks = {
            createLink: vi.fn().mockResolvedValue(LINK),
            listLinks: vi.fn().mockResolvedValue([LINK]),
            revokeLink: vi.fn().mockResolvedValue(undefined),
        };
        const d = makeDispatcher({ shareLinks });
        const bodies = [
            (await d.handleShareLinks('', 'POST', { object: 'account', recordId: 'r1' }, {}, authed)).response?.body,
            (await d.handleShareLinks('', 'GET', undefined, {}, authed)).response?.body,
            (await d.handleShareLinks('/l1', 'DELETE', undefined, {}, authed)).response?.body,
        ];
        for (const body of bodies) {
            expect(body?.success).toBe(true);
            expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
        }
    });

    it('unmatched sub-path returns the standard ROUTE_NOT_FOUND envelope', async () => {
        const shareLinks = { resolveToken: vi.fn(), createLink: vi.fn(), listLinks: vi.fn(), revokeLink: vi.fn() };
        const context: any = { executionContext: { userId: 'u1' } };
        const result = await makeDispatcher({ shareLinks }).handleShareLinks('/a/b/c', 'GET', undefined, {}, context);
        expect(result.response?.status).toBe(404);
        // [#3842] Was `error.type` — a third spelling, sibling to a numeric
        // `error.code`. Now the declared field.
        expect(result.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');
    });
});

// ---------------------------------------------------------------------------
// PR-5 — packages extraction
// ---------------------------------------------------------------------------

describe('HttpDispatcher extracted domains (PR-5: packages)', () => {
    function qlWithRegistry(extra: Partial<Record<string, any>> = {}) {
        return {
            find: vi.fn().mockResolvedValue([]),
            getObjects: vi.fn().mockReturnValue({}),
            registry: {
                getObject: vi.fn().mockReturnValue(null),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
                getAllPackages: vi.fn().mockReturnValue([{ id: 'pkg-a', status: 'active' }]),
                getPackage: vi.fn().mockReturnValue(undefined),
                installPackage: vi.fn().mockImplementation((m: any) => ({ id: m.id, manifest: m })),
                ...extra,
            },
        };
    }

    // [#7033 / #7023] `/packages` now carries an anonymous-deny floor plus
    // per-route capability predicates. These cases are about ROUTING and the
    // registry pre-check (which status a duplicate / missing-id / no-registry
    // answer returns), so the caller must clear the gate; `dispatch()` re-resolves
    // identity off the mock kernel, which has no capability source, so it is
    // stubbed to a caller holding both the read and write capability. (The 503
    // pre-check runs before the capability gates, so it needs only a session —
    // this caller provides that too.)
    const withPkgCaller = (d: HttpDispatcher) => {
        (d as any).timedResolveExecutionContext = async () => ({
            userId: 'u_pkg', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
        });
        return d;
    };

    it('GET /packages lists packages from the ObjectQL registry', async () => {
        const objectql = qlWithRegistry();
        const result = await withPkgCaller(makeDispatcher({ objectql })).dispatch('GET', '/packages', undefined, {}, {} as any);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.total).toBe(1);
    });

    it('responds 503 when no ObjectQL registry is available', async () => {
        const objectql = { find: vi.fn(), getObjects: vi.fn() }; // no .registry → getObjectQL returns null
        const result = await withPkgCaller(makeDispatcher({ objectql })).dispatch('GET', '/packages', undefined, {}, {} as any);
        expect(result.response?.status).toBe(503);
    });

    it('POST /packages rejects a duplicate id with 409 unless ?overwrite=true (data-loss footgun guard)', async () => {
        const objectql = qlWithRegistry({ getPackage: vi.fn().mockReturnValue({ id: 'pkg-a' }) });
        const dispatcher = withPkgCaller(makeDispatcher({ objectql }));
        const dup = await dispatcher.dispatch('POST', '/packages', { id: 'pkg-a', name: 'A' }, {}, {} as any);
        expect(dup.response?.status).toBe(409);
        const forced = await dispatcher.dispatch('POST', '/packages', { id: 'pkg-a', name: 'A' }, { overwrite: 'true' }, {} as any);
        expect(forced.response?.status).toBe(201);
    });

    it('POST /packages without an id is rejected with 400', async () => {
        const objectql = qlWithRegistry();
        const result = await withPkgCaller(makeDispatcher({ objectql })).dispatch('POST', '/packages', { name: 'no-id' }, {}, {} as any);
        expect(result.response?.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// PR-6 — automation extraction
// ---------------------------------------------------------------------------

describe('HttpDispatcher extracted domains (PR-6: automation)', () => {
    /**
     * [#5519] `/automation` stands on the platform anonymous-deny baseline now.
     * The cases below go through the REAL `dispatch()`, which re-resolves
     * identity off the mock kernel, so an `auth` slot that answers with a
     * session is what keeps each of them testing ROUTING (which service method
     * a path reaches) instead of quietly re-testing the auth floor. Anonymity
     * itself is pinned in `domains/anonymous-gate-actions-automation.test.ts`.
     */
    const auth = { api: { getSession: async () => ({ user: { id: 'u_test' } }) } };

    it('GET /automation lists flows via the automation service', async () => {
        const automation = { listFlows: vi.fn().mockResolvedValue(['flow-a', 'flow-b']) };
        const result = await makeDispatcher({ automation, auth }).dispatch('GET', '/automation', undefined, {}, {} as any);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.total).toBe(2);
    });

    it('GET /automation/actions keeps its guard position before the /:name catch-all and applies filters', async () => {
        const automation = {
            listFlows: vi.fn(),
            getFlow: vi.fn(),
            getActionDescriptors: vi.fn().mockReturnValue([
                { name: 'a1', source: 'builtin', paradigms: ['flow'] },
                { name: 'a2', source: 'plugin', paradigms: ['workflow'] },
            ]),
        };
        const result = await makeDispatcher({ automation, auth }).dispatch('GET', '/automation/actions', undefined, { source: 'plugin' }, {} as any);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.actions).toHaveLength(1);
        // The /:name→getFlow catch-all must NOT have shadowed the guard route.
        expect(automation.getFlow).not.toHaveBeenCalled();
    });

    it('falls through unhandled when no automation service is registered', async () => {
        const result = await makeDispatcher().dispatch('GET', '/automation', undefined, {}, {} as any);
        expect(result.response?.status ?? 404).not.toBe(200);
    });

    /**
     * [#4127] Both trigger routes build the SAME AutomationContext.
     *
     * `POST /trigger/:name` — the legacy shape, and the one
     * `client.automation.trigger()` calls — used to pass the raw HTTP body to
     * `execute(name, body)`: no `{recordId, objectName, params}` translation
     * and, worse, no caller identity. A flow's default `runAs` is `'user'`, and
     * a `runAs:'user'` run whose trigger resolved no user has its data ops
     * REFUSED (#3760), so the SDK method could not run a data-touching flow at
     * all while `POST /:name/trigger` could.
     */
    it('both trigger routes translate the body and forward the caller identity', async () => {
        const execute = vi.fn().mockResolvedValue({ success: true });
        // [#9378] `getFlow` resolves the flow rather than `undefined`: both
        // trigger doors now answer 404 through the same shared existence probe
        // `POST /:name/toggle` and `GET /:name` use, so a fixture whose
        // registry claims the flow does not exist never reaches `execute` —
        // which is this test's subject.
        const automation = { execute, listFlows: vi.fn(), getFlow: vi.fn().mockResolvedValue({ name: 'nurture' }) };
        const ctx: any = {
            executionContext: {
                userId: 'u-1',
                positions: ['sales_rep'],
                permissions: ['lead.read'],
                tenantId: 't-1',
            },
        };
        const body = { recordId: 'lead-9', objectName: 'sales_lead', extra: 'kept' };

        // Direct delegate calls — `dispatch()` would re-resolve identity off
        // the auth-less mock kernel and overwrite the seeded executionContext,
        // the same reason the `/keys` test above bypasses it.
        const dispatcher = makeDispatcher({ automation });
        await dispatcher.handleAutomation('/trigger/nurture', 'POST', body, ctx);
        await dispatcher.handleAutomation('/nurture/trigger', 'POST', body, ctx);

        expect(execute).toHaveBeenCalledTimes(2);
        const [legacyName, legacyCtx] = execute.mock.calls[0];
        const [modernName, modernCtx] = execute.mock.calls[1];
        expect(legacyName).toBe('nurture');
        expect(modernName).toBe('nurture');
        // Same context out of both routes — that is the whole point.
        expect(legacyCtx).toEqual(modernCtx);
        // Body translation: recordId reaches params, aliased by object name,
        // and an unwrapped top-level key survives.
        expect(legacyCtx.object).toBe('sales_lead');
        expect(legacyCtx.params.recordId).toBe('lead-9');
        expect(legacyCtx.params.salesLeadId).toBe('lead-9');
        expect(legacyCtx.params.extra).toBe('kept');
        // Identity envelope (#1888): not just the user id.
        expect(legacyCtx.userId).toBe('u-1');
        expect(legacyCtx.positions).toEqual(['sales_rep']);
        expect(legacyCtx.permissions).toEqual(['lead.read']);
        expect(legacyCtx.tenantId).toBe('t-1');
    });

    /**
     * [#4127] `trigger` is not a method of the automation slot — nothing in
     * the repo implements it and `IAutomationService` never declared it, so
     * the probe that used to precede the `execute` fallback was dead on every
     * deployment. A service that grows one must not be preferred over the
     * contract method.
     */
    it('never calls a non-contract `trigger` method, even when one exists', async () => {
        const trigger = vi.fn().mockResolvedValue({ success: true });
        const execute = vi.fn().mockResolvedValue({ success: true });
        // [#9378] See the note on the fixture above: the trigger door consults
        // the shared existence probe before dispatching.
        const automation = { trigger, execute, listFlows: vi.fn(), getFlow: vi.fn().mockResolvedValue({ name: 'nurture' }) };

        const result = await makeDispatcher({ automation, auth })
            .dispatch('POST', '/automation/trigger/nurture', {}, {}, {} as any);

        expect(result.response?.status).toBe(200);
        expect(trigger).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledTimes(1);
    });

    /**
     * [#4127] `getFlowRuntimeStates` is declared on `IAutomationService` now,
     * and `/automation/_status` reads it through the contract type instead of
     * an inline cast that omitted `status` / `triggerType` / `object` — the
     * three fields that say WHY a flow is unbound.
     */
    it('/automation/_status passes through the full FlowRuntimeState shape', async () => {
        const automation = {
            listFlows: vi.fn(),
            getFlow: vi.fn(),
            getFlowRuntimeStates: vi.fn().mockReturnValue([
                { name: 'nurture', enabled: true, bound: false, status: 'active', triggerType: 'on_create', object: 'sales_lead' },
            ]),
        };
        const result = await makeDispatcher({ automation, auth }).dispatch('GET', '/automation/_status', undefined, {}, {} as any);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.flows?.[0]).toEqual({
            name: 'nurture', enabled: true, bound: false,
            status: 'active', triggerType: 'on_create', object: 'sales_lead',
        });
    });
});

// ---------------------------------------------------------------------------
// PR-7 — auth + ai extraction
// ---------------------------------------------------------------------------

describe('HttpDispatcher extracted domains (PR-7: auth/ai)', () => {
    // [#4127] Third copy of the fabricated `handler` mock (with
    // http-dispatcher.test.ts's two). Three tests across two files all agreed
    // the auth domain calls `handler`; no auth service has one, and
    // `IAuthService` declares `handleRequest`. That is how a dead branch stays
    // green — every test was written from the handler, not from the contract.
    it('/auth delegates to the auth service via the contract handleRequest when registered', async () => {
        const handleRequest = vi.fn().mockResolvedValue({ ok: true });
        const result = await makeDispatcher({ auth: { handleRequest } }).dispatch('POST', '/auth/sign-in/email', { email: 'x@y.z' }, {}, {} as any);
        expect(result.handled).toBe(true);
        expect(handleRequest).toHaveBeenCalledTimes(1);
    });

    // [#4113] Was: "mock fallback serves sign-up when no auth service is
    // registered" — asserting a 200 whose `session.token` matched
    // /^mock_token_/. That mock is retired; an empty slot now answers 501 and
    // mints nothing. Routed through `dispatch` (not the domain body directly)
    // so the whole registry path is covered.
    it('/auth answers 501 — and no session — when no auth service is registered', async () => {
        const result = await makeDispatcher().dispatch('POST', '/auth/sign-up/email', { email: 'a@b.c', name: 'A' }, {}, {} as any);
        expect(result.response?.status).toBe(501);
        expect(result.response?.body?.user).toBeUndefined();
        expect(result.response?.body?.session).toBeUndefined();
        expect(JSON.stringify(result.response?.body ?? {})).not.toMatch(/mock_token_/);
    });

    // [#7653] The caller has to be AUTHENTICATED for this case to mean what it
    // says. The courtesy is owed to the console — an authenticated surface —
    // not to the wire: the anonymous gate is consulted BEFORE `/ai/**`'s
    // capability answers now, so an unauthenticated caller is denied 401 ahead
    // of it. This used to run through `dispatch()`, which re-resolves identity
    // off the auth-less mock kernel and therefore measured the courtesy as an
    // anonymous caller — i.e. through the hole #7653 closed. Split in two so
    // neither half is lost: the delegate call carries a seeded principal (the
    // same bypass the `/keys` and `/automation` cases above use, and for the
    // same reason), and the registry path keeps its own assertion below.
    it('/ai/agents returns an empty list (not 404) when no AI service is configured', async () => {
        const context: any = { request: {}, executionContext: { userId: 'usr_1' } };
        const result = await makeDispatcher().handleAI('/ai/agents', 'GET', undefined, {}, context);
        expect(result.response?.status).toBe(200);
        // #4053: in the declared envelope now, with `AiAgentsResponseSchema`'s
        // `{ agents }` RELOCATED under `data` rather than flattened to the bare
        // array. `unwrapResponse` returns `data`, so `client.ai.agents.list()`
        // reads `.agents` off it — which is what let this surface convert on its
        // own and cloud's `service-ai`, the route's other producer, follow
        // independently instead of in lockstep. Both answer this now (cloud#929).
        expect(envelopeViolations(result.response?.body), JSON.stringify(result.response?.body)).toEqual([]);
        expect(result.response?.body?.data?.agents).toEqual([]);
        expect(result.response?.body?.agents).toBeUndefined();
    });

    // [#4093 follow-up] Was 404. `/ai/*` is mounted unconditionally, so a
    // request with no AI service reached a handler that had nothing to
    // delegate to — 501. (`GET /ai/agents` keeps its deliberate empty-list
    // 200, asserted separately: the console polls it on every navigation.)
    // [#7653] Authenticated, for the same reason as the case above: the 501 is
    // what a legitimate caller is told, while an anonymous one is denied 401
    // before ever reaching it.
    it('/ai routes 501 (service missing) for non-agents paths', async () => {
        const context: any = { request: {}, executionContext: { userId: 'usr_1' } };
        const result = await makeDispatcher().handleAI('/ai/chat', 'POST', { q: 'hi' }, {}, context);
        expect(result.response?.status).toBe(501);
    });

    /**
     * [#7653] The registry path itself, which the two cases above used to cover
     * incidentally. `dispatch()` re-resolves identity off the auth-less mock
     * kernel, so the caller it produces is ANONYMOUS — and an anonymous caller
     * is exactly what must not receive either capability answer. So this keeps
     * the end-to-end registry coverage and pins the fix at the same time: the
     * `/ai` prefix is still claimed and routed (`handled: true`), and what comes
     * back is the ADR-0112 refusal envelope rather than the 200 courtesy or the
     * 501 remedy sentence.
     */
    it('/ai/** denies an anonymous caller through the full registry path', async () => {
        for (const [method, path] of [['GET', '/ai/agents'], ['POST', '/ai/chat']] as const) {
            const result = await makeDispatcher().dispatch(method, path, undefined, {}, {} as any);
            expect(result.handled, path).toBe(true);
            expect(result.response?.status, path).toBe(401);
            expect(result.response?.body?.error?.code, path).toBe('UNAUTHENTICATED');
        }
    });

    it('/ai dispatches to a matching cached kernel route with params + user threading', async () => {
        const routeHandler = vi.fn().mockResolvedValue({ status: 200, body: { answer: 42 } });
        const kernelExtras = { __aiRoutes: [{ method: 'GET', path: '/api/v1/ai/conversations/:id', handler: routeHandler, auth: false }] };
        const dispatcher = makeDispatcherWithKernelExtras({ ai: { name: 'ai' } }, kernelExtras);
        const result = await dispatcher.dispatch('GET', '/ai/conversations/c-1', undefined, {}, {} as any);
        expect(result.response?.status).toBe(200);
        expect(routeHandler.mock.calls[0][0].params).toMatchObject({ id: 'c-1' });
    });
});
