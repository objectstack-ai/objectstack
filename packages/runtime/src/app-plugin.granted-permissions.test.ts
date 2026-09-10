// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13457 — `AppPlugin.init()` is the ONE production caller of the artifact→
// enforcer seam, and this file pins that it is: the wiring, not the seam's own
// logic (that is `security/artifact-granted-permissions.test.ts`).
//
// The site matters as much as the behaviour. `AppPlugin` is the single point
// where an environment artifact becomes a kernel plugin on BOTH paths — the
// self-hosted `createStandaloneStack` and the cloud control plane's
// `ArtifactKernelFactory`, which constructs the same object — so a consent
// record reaches the enforcer without either caller changing a line. Before
// this, `PluginPermissionEnforcer` had zero production callers (#7500,
// re-measured on this branch).

import { describe, it, expect, vi } from 'vitest';
import { AppPlugin } from './app-plugin.js';
import type { PluginContext } from '@objectstack/core';

const bootCtx = () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    return {
        logger,
        registerService: vi.fn(),
        registerServiceFactory: vi.fn(),
        replaceService: vi.fn(),
        getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
        getServices: vi.fn(() => new Map()),
        getServiceScoped: vi.fn(),
        hook: vi.fn(),
        trigger: vi.fn(),
        getKernel: vi.fn(),
    } as unknown as PluginContext & { logger: typeof logger };
};

const bundle = (extra: Record<string, unknown> = {}) => ({
    manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app' },
    packages: [
        { manifest: { id: 'com.acme.crm', name: 'crm', version: '1.0.0', type: 'app' } },
        { manifest: { id: 'com.acme.reports', name: 'reports', version: '1.0.0', type: 'module' } },
    ],
    ...extra,
});

describe('#13457 — AppPlugin.init binds the artifact\'s granted permissions', () => {
    it('an artifact with NO grantedPermissions key allocates no enforcer at all', async () => {
        const ctx = bootCtx();
        const plugin = new AppPlugin(bundle());
        await plugin.init(ctx);

        // ⭐ Not "an enforcer that denies nothing" — no enforcer. This is every
        // artifact that ships today, and the boot has to be byte-for-byte what
        // it was: absent is no consent record, never a deny.
        expect(plugin.permissionEnforcer).toBeUndefined();
        expect(plugin.grantBinding).toBeUndefined();
    });

    it('a consent-bearing artifact registers each entry under its manifest id', async () => {
        const ctx = bootCtx();
        const plugin = new AppPlugin(bundle({
            grantedPermissions: { 'com.acme.crm': { services: ['object'], hooks: [] } },
        }));
        await plugin.init(ctx);

        const e = plugin.permissionEnforcer;
        expect(e).toBeDefined();
        // Keyed by the plugin manifest `id` — ⛔ never the kernel plugin name
        // (`plugin.app.com.acme.crm`), which is what `AppPlugin` registers
        // ITSELF under and is not the key the artifact contract writes.
        expect(plugin.name).toBe('plugin.app.com.acme.crm');
        expect(e!.getPluginPermissions('com.acme.crm')!.canAccessService('object')).toBe(true);
        expect(e!.getPluginPermissions('com.acme.crm')!.canAccessService('storage')).toBe(false);
        // The sibling package carries no consent record — nothing registered for it.
        expect(e!.getPluginPermissions('com.acme.reports')).toBeUndefined();
        expect(plugin.grantBinding).toMatchObject({
            declared: true,
            registered: ['com.acme.crm'],
            unregistered: ['com.acme.reports'],
            unbound: [],
        });
    });

    it('binds on an EMPTY environment too, so a grant that binds to nothing is still heard', async () => {
        // An empty env has no app payload and `init()` returns early — but the
        // binding runs BEFORE that return, because an artifact carrying grants
        // for packages it does not ship is exactly the fault that shows up here.
        const ctx = bootCtx();
        const plugin = new AppPlugin({
            manifest: { plugins: [], drivers: [] },
            grantedPermissions: { 'com.acme.ghost': { services: ['object'] } },
        });
        await plugin.init(ctx);

        expect(plugin.grantBinding).toMatchObject({ declared: true, registered: [], unbound: ['com.acme.ghost'] });
        expect(
            ctx.logger.warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('bound to NO package')),
        ).toBe(true);
    });
});
