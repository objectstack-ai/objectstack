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
        expect(result.response?.body?.data?.locales).toEqual(['en', 'zh-CN']);
    });

    it('/analytics bridges to the analytics service exactly as the legacy branch did', async () => {
        const analytics = {
            query: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }),
            analyticsQuery: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }),
        };
        const result = await makeDispatcher({ analytics }).dispatch(
            'POST', '/analytics/query', { metric: 'count' }, {}, {} as any,
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
