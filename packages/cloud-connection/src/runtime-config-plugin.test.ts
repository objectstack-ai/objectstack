// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RuntimeConfigPlugin feature seam (open-core boundary, cloud ADR-0012).
 *
 * The framework owns the mechanism (serve a per-request `features` map) but not
 * the catalog: a host's `resolveFeatures` hook may return ANY boolean keys and
 * they pass through verbatim. The deprecated `resolvePlanFeatures` alias still
 * works.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';

async function getConfig(opts: {
    pluginConfig?: RuntimeConfigPluginConfig;
    resolveByHostname?: (host: string) => Promise<any>;
    host?: string;
}): Promise<any> {
    let handler: ((c: any) => Promise<any>) | undefined;
    // Hono-shaped: a real `routes` ledger, empty because this suite mounts no
    // marketplace surface — so `features.marketplace` derives to false here.
    // The derivation itself is pinned in runtime-config-marketplace-derivation.test.ts.
    const rawApp = {
        routes: [] as Array<{ method: string; path: string }>,
        get(path: string, h: (c: any) => Promise<any>) {
            this.routes.push({ method: 'GET', path });
            if (path === '/api/v1/runtime/config') handler = h;
        },
    };
    const services: Record<string, any> = { 'http-server': { getRawApp: () => rawApp } };
    if (opts.resolveByHostname) services['env-registry'] = { resolveByHostname: opts.resolveByHostname };
    const ctx: any = {
        logger: { info() {}, warn() {} },
        getService: (n: string) => { const s = services[n]; if (!s) throw new Error(`no ${n}`); return s; },
        hooks: [] as Array<() => Promise<void>>,
        hook(_e: string, cb: () => Promise<void>) { this.hooks.push(cb); },
    };
    const plugin = new RuntimeConfigPlugin(opts.pluginConfig ?? {});
    await plugin.start(ctx);
    for (const cb of ctx.hooks) await cb();
    if (!handler) throw new Error('handler not mounted');
    return handler({ req: { header: (n: string) => (n.toLowerCase() === 'host' ? (opts.host ?? '') : undefined) }, json: (b: any) => b });
}

describe('RuntimeConfigPlugin feature seam', () => {
    it('always ships the base mechanism flags', async () => {
        const body = await getConfig({});
        expect(body.features.installLocal).toBe(false);
        // Derived, not declared (#8356): no browse surface is mounted on this
        // app, so the mechanism must not claim one.
        expect(body.features.marketplace).toBe(false);
        expect(body.features.aiStudio).toBe(true);
        expect(body.features.autoPublishAiBuilds).toBe(false);
    });

    it('passes ARBITRARY distribution keys through verbatim (open-ended)', async () => {
        const body = await getConfig({
            pluginConfig: {
                controlPlaneUrl: '',
                resolveFeatures: (token) => token === 'team'
                    ? { customDomain: true, sso: false, aiStudio: true }
                    : { customDomain: false, sso: false },
            },
            resolveByHostname: async () => ({ environmentId: 'e1', organizationId: 'o1', plan: 'team' }),
            host: 'tenant.example.com',
        });
        // Framework never names customDomain/sso — they still reach the SPA.
        expect(body.features.customDomain).toBe(true);
        expect(body.features.sso).toBe(false);
        expect(body.features.aiStudio).toBe(true);
        // base flags survive the merge — including the derived one, which this
        // host's hook does not name (nothing browse-shaped is mounted here).
        expect(body.features.marketplace).toBe(false);
    });

    it('honours the deprecated resolvePlanFeatures alias', async () => {
        const body = await getConfig({
            pluginConfig: {
                controlPlaneUrl: '',
                resolvePlanFeatures: () => ({ aiStudio: false, legacyFlag: true }),
            },
            resolveByHostname: async () => ({ environmentId: 'e1', plan: 'free' }),
            host: 'tenant.example.com',
        });
        expect(body.features.aiStudio).toBe(false);
        expect(body.features.legacyFlag).toBe(true);
    });

    it('static default (no env resolved) is config-driven', async () => {
        const body = await getConfig({ pluginConfig: { controlPlaneUrl: '', aiStudio: false } });
        expect(body.features.aiStudio).toBe(false);
    });
});
