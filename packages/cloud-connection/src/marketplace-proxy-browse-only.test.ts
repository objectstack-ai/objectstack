// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MarketplaceProxyPlugin is a BROWSE-ONLY mechanism (ADR §5.2): it forwards
 * GET/HEAD marketplace reads and must NOT own install *policy*. Non-GET
 * requests pass through (`next()`) so a host-supplied install route (mounted
 * via the createObjectOSStack `extraPlugins` seam) can claim them — instead of
 * the old 405 "install via cloud" dead-end (framework#1548).
 */

import { describe, it, expect } from 'vitest';
import { MarketplaceProxyPlugin } from './marketplace-proxy-plugin.js';

/** Drive the plugin's kernel:ready wiring and capture the registered handler. */
async function captureHandler(plugin: MarketplaceProxyPlugin) {
    let handler: any;
    let readyFn: any;
    const rawApp = {
        all: (_path: string, h: any) => { handler = h; },
        get: () => {}, post: () => {}, head: () => {},
    };
    const ctx: any = {
        hook: (ev: string, fn: any) => { if (ev === 'kernel:ready') readyFn = fn; },
        getService: (name: string) => (name === 'http-server' ? { getRawApp: () => rawApp } : undefined),
        logger: { info() {}, warn() {}, error() {} },
    };
    await plugin.start(ctx);
    await readyFn();
    return handler;
}

function fakeCtx(method: string, path: string) {
    return {
        req: {
            url: `http://env.test${path}`,
            method,
            header: () => undefined,
            raw: {},
        },
        json: (body: any, status: number) => ({ __status: status, __body: body }),
    };
}

describe('MarketplaceProxyPlugin — browse-only (no install dead-end)', () => {
    it('passes through a non-GET marketplace request (next()) instead of 405', async () => {
        const plugin = new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true });
        const handler = await captureHandler(plugin);
        expect(typeof handler).toBe('function');

        let nextCalled = false;
        const result = await handler(
            fakeCtx('POST', '/api/v1/marketplace/packages/pkg_1/install'),
            async () => { nextCalled = true; return 'PASSED_THROUGH'; },
        );

        // The handler delegates to the next route rather than emitting a 405.
        expect(nextCalled).toBe(true);
        expect(result).toBe('PASSED_THROUGH');
    });

    it('still passes install-local through (owned by the local install plugin)', async () => {
        const plugin = new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true });
        const handler = await captureHandler(plugin);

        let nextCalled = false;
        await handler(
            fakeCtx('POST', '/api/v1/marketplace/install-local'),
            async () => { nextCalled = true; return 'LOCAL'; },
        );
        expect(nextCalled).toBe(true);
    });

    it('503s when no control plane is configured (unchanged behaviour)', async () => {
        const plugin = new MarketplaceProxyPlugin({ controlPlaneUrl: 'off', cacheDisabled: true });
        const handler = await captureHandler(plugin);
        const result: any = await handler(fakeCtx('GET', '/api/v1/marketplace/packages'), async () => 'NEXT');
        expect(result.__status).toBe(503);
        expect(result.__body?.error?.code).toBe('MARKETPLACE_UNAVAILABLE');
    });
});
