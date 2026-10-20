// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `branding` reads the Branding settings, then the deployment's own (#24766,
 * the maintainer's ruling B′ and its amendment).
 *
 *   productName ← branding.workspace_name
 *   logoUrl     ← branding.logo_url
 *   brandColor  ← branding.accent_color
 *
 * A value somebody set wins; a key nobody set falls back to the deployment
 * (`OS_PRODUCT_NAME` / `OS_LOGO_URL` / `OS_BRAND_COLOR`); the read happens on
 * every request, so a save shows on the next load. Under a walled posture the
 * settings service does not list the namespace (`service-settings`' own pin,
 * `settings-branding-posture.pin.test.ts`), and then this anonymous door must
 * not read it at all.
 *
 * The `settings` service here is a stand-in with the real service's contract
 * for the two calls this door makes: `listManifests()` (a trusted in-process
 * caller sees every registered manifest) and `getMany()` answering
 * `{ value, source }` per key, `source: 'default'` for a key nobody set. Its
 * `getMany` ANSWERS even when the namespace is not listed — deliberately, so a
 * door that skipped the listing check would serve the saved values and the
 * walled-posture pin would go red. This package does not depend on
 * `@objectstack/service-settings`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';

const BRANDING_ENV = [
    'OS_PRODUCT_NAME', 'OS_PRODUCT_SHORT_NAME', 'OS_LOGO_URL', 'OS_BRAND_COLOR',
    'OS_PWA_DESCRIPTION', 'OS_PWA_THEME_COLOR',
] as const;

/** The manifest defaults the real Branding manifest declares (`accent_color` and `logo_url` declare none). */
const MANIFEST_DEFAULTS: Record<string, unknown> = { workspace_name: 'ObjectStack' };

interface Stub {
    /** Whether `listManifests()` lists `branding` — false is the walled posture. */
    offered: boolean;
    /** Values somebody set, by key, with the `source` the service would report. */
    saved: Record<string, { value: unknown; source: string }>;
    /** Make every `getMany` reject. */
    fail?: Error;
    /** Every `getMany` call, in order. */
    calls: Array<{ namespace: string; keys: readonly string[]; ctx: unknown }>;
}

function settingsService(stub: Stub) {
    return {
        listManifests: () => [
            { namespace: 'localization', specifiers: [{ key: 'timezone' }] },
            ...(stub.offered
                ? [{
                    namespace: 'branding',
                    specifiers: [
                        { type: 'group', id: 'identity' }, { key: 'workspace_name' },
                        { type: 'group', id: 'appearance' }, { key: 'accent_color' }, { key: 'logo_url' },
                    ],
                }]
                : []),
        ],
        getMany: async (namespace: string, keys: readonly string[], ctx?: unknown) => {
            stub.calls.push({ namespace, keys, ctx });
            if (stub.fail) throw stub.fail;
            return Object.fromEntries(keys.map((k) => [
                k,
                stub.saved[k] ?? { value: MANIFEST_DEFAULTS[k], source: 'default' },
            ]));
        },
    };
}

/**
 * Mount the plugin on a Hono-shaped raw app, the harness shape of
 * `runtime-config-stage.test.ts`, with a `settings` service when given one.
 * Returns a function serving one request per call, and the warnings.
 */
async function mount(opts: { pluginConfig?: RuntimeConfigPluginConfig; settings?: unknown } = {}) {
    let handler: ((c: any) => Promise<any>) | undefined;
    const rawApp = {
        routes: [] as Array<{ method: string; path: string }>,
        get(path: string, h: (c: any) => Promise<any>) {
            this.routes.push({ method: 'GET', path });
            if (path === '/api/v1/runtime/config') handler = h;
        },
    };
    const warnings: string[] = [];
    const ctx: any = {
        logger: { info() {}, warn: (m: string) => { warnings.push(String(m)); } },
        getService: (n: string) => {
            if (n === 'http-server') return { getRawApp: () => rawApp };
            if (n === 'settings' && opts.settings) return opts.settings;
            throw new Error(`no ${n}`);
        },
        hooks: [] as Array<() => Promise<void>>,
        hook(_e: string, cb: () => Promise<void>) { this.hooks.push(cb); },
    };
    const plugin = new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, ...opts.pluginConfig });
    await plugin.start(ctx);
    for (const cb of ctx.hooks) await cb();
    if (!handler) throw new Error('handler not mounted');
    const serve = async () => (await handler!({ req: { header: () => undefined }, json: (b: any) => b })).branding;
    return { serve, warnings };
}

const newStub = (over: Partial<Stub> = {}): Stub => ({ offered: true, saved: {}, calls: [], ...over });

describe('RuntimeConfigPlugin — branding from the Branding settings (#24766)', () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const k of BRANDING_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
        process.env.OS_PRODUCT_NAME = 'Env Product';
        process.env.OS_LOGO_URL = 'https://env.test/logo.svg';
        process.env.OS_BRAND_COLOR = '#111111';
    });
    afterEach(() => {
        for (const k of BRANDING_ENV) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    describe('under single (the namespace is offered)', () => {
        it('a saved logo URL is the one served', async () => {
            const stub = newStub({ saved: { logo_url: { value: 'https://acme.test/logo.svg', source: 'tenant' } } });
            const { serve } = await mount({ settings: settingsService(stub) });
            expect((await serve()).logoUrl).toBe('https://acme.test/logo.svg');
        });

        it('an unset logo URL falls back to OS_LOGO_URL', async () => {
            const { serve } = await mount({ settings: settingsService(newStub()) });
            expect((await serve()).logoUrl).toBe('https://env.test/logo.svg');
        });

        it('a saved name is the product name; an unset one falls back to OS_PRODUCT_NAME, never the manifest default', async () => {
            const set = await mount({
                settings: settingsService(newStub({ saved: { workspace_name: { value: 'Acme Ops', source: 'tenant' } } })),
            });
            expect((await set.serve()).productName).toBe('Acme Ops');

            // `workspace_name` declares the default 'ObjectStack'; nobody set it.
            const unset = await mount({ settings: settingsService(newStub()) });
            expect((await unset.serve()).productName).toBe('Env Product');
        });

        it('a saved colour is the brand colour; an unset one falls back to OS_BRAND_COLOR', async () => {
            const set = await mount({
                settings: settingsService(newStub({ saved: { accent_color: { value: '#e11d48', source: 'tenant' } } })),
            });
            expect((await set.serve()).brandColor).toBe('#e11d48');

            const unset = await mount({ settings: settingsService(newStub()) });
            expect((await unset.serve()).brandColor).toBe('#111111');
        });

        it('the derived fields follow the served name and colour unless configured themselves', async () => {
            const stub = newStub({
                saved: {
                    workspace_name: { value: 'Acme Ops', source: 'tenant' },
                    accent_color: { value: '#e11d48', source: 'tenant' },
                },
            });
            const derived = await mount({ settings: settingsService(stub) });
            expect(await derived.serve()).toMatchObject({
                productShortName: 'Acme Ops',
                pwaDescription: 'Acme Ops — runtime console',
                pwaThemeColor: '#e11d48',
            });

            process.env.OS_PRODUCT_SHORT_NAME = 'EP';
            process.env.OS_PWA_THEME_COLOR = '#222222';
            const configured = await mount({ settings: settingsService(stub) });
            expect(await configured.serve()).toMatchObject({ productShortName: 'EP', pwaThemeColor: '#222222' });
        });

        it('a saved value outranks the host option too: the option is the deployment default, like the env var', async () => {
            const stub = newStub({ saved: { logo_url: { value: 'https://acme.test/logo.svg', source: 'tenant' } } });
            const { serve } = await mount({
                pluginConfig: { logoUrl: '/host-logo.svg', productName: 'Host Product' },
                settings: settingsService(stub),
            });
            const branding = await serve();
            expect(branding.logoUrl).toBe('https://acme.test/logo.svg');
            // Nobody set a name: the host option stays the fallback, ahead of the env var.
            expect(branding.productName).toBe('Host Product');
        });

        it('reads per request, not once at construction: a save shows on the next load', async () => {
            const stub = newStub();
            const { serve } = await mount({ settings: settingsService(stub) });
            expect((await serve()).productName).toBe('Env Product');
            stub.saved.workspace_name = { value: 'Renamed', source: 'tenant' };
            expect((await serve()).productName).toBe('Renamed');
            // One batched read per request, of the three declared keys, naming no organization.
            expect(stub.calls).toHaveLength(2);
            expect(stub.calls[1]).toEqual({
                namespace: 'branding',
                keys: ['workspace_name', 'logo_url', 'accent_color'],
                ctx: {},
            });
        });

        it('the settings layer\'s own env override counts as set (source env)', async () => {
            const stub = newStub({ saved: { workspace_name: { value: 'Pinned', source: 'env' } } });
            const { serve } = await mount({ settings: settingsService(stub) });
            expect((await serve()).productName).toBe('Pinned');
        });

        it('a read that fails serves the deployment branding and warns once, never a 500', async () => {
            const stub = newStub({ fail: new Error('store down') });
            const { serve, warnings } = await mount({ settings: settingsService(stub) });
            expect(await serve()).toMatchObject({
                productName: 'Env Product', logoUrl: 'https://env.test/logo.svg', brandColor: '#111111',
            });
            await serve();
            const lines = warnings.filter((w) => w.includes('store down'));
            expect(lines).toHaveLength(1);
        });
    });

    describe('under group / isolated (the namespace is not offered)', () => {
        it('the setting is not served on the anonymous door, and the door never reads it', async () => {
            const stub = newStub({
                offered: false,
                saved: {
                    workspace_name: { value: 'Tenant Org', source: 'tenant' },
                    logo_url: { value: 'https://tenant.test/logo.svg', source: 'tenant' },
                    accent_color: { value: '#abcdef', source: 'tenant' },
                },
            });
            const { serve } = await mount({ settings: settingsService(stub) });
            expect(await serve()).toMatchObject({
                productName: 'Env Product', logoUrl: 'https://env.test/logo.svg', brandColor: '#111111',
            });
            expect(stub.calls).toEqual([]);
        });
    });

    it('with no settings service the deployment branding is served, as before', async () => {
        const { serve } = await mount();
        expect(await serve()).toMatchObject({
            productName: 'Env Product', logoUrl: 'https://env.test/logo.svg', brandColor: '#111111',
            productShortName: 'Env Product', pwaThemeColor: '#111111',
        });
    });
});
