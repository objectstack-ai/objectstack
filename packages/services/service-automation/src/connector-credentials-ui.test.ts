// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27238] The Setup entry for the connector credential door (ruling A on
 * #27230) ships with the door: `CONNECTOR_CREDENTIALS_UI_BUNDLE`, registered
 * through the `manifest` service at `kernel:ready` (cloud ADR-0009 shape).
 *
 *   • the bundle is a valid manifest whose one contribution puts a component
 *     item in Setup's Integrations group, naming the console component
 *     `automation:connector-credentials` and asking `manage_metadata` — the
 *     capability every verb of the door asks;
 *   • ADR-0143 D5: a second item names `automation:connector-connections`, the
 *     Console page of the connector connection door, and asks that door's own
 *     organization-scoped `manage_connector_connections`, so an organization
 *     administrator (who holds it, not `manage_metadata`) sees it;
 *   • a booted kernel registers it once, after `kernel:ready`;
 *   • an inert boot (`armRuntime: false`, a one-shot tool) serves no console
 *     and registers no entry; neither does a kernel with no manifest service,
 *     and that boot does not fail.
 */
import { describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';

import { AutomationServicePlugin } from './plugin.js';
import {
    CONNECTOR_CREDENTIALS_COMPONENT_REF,
    CONNECTOR_CREDENTIALS_NAV_CAPABILITY,
    CONNECTOR_CREDENTIALS_UI_BUNDLE,
    CONNECTOR_CONNECTIONS_COMPONENT_REF,
    CONNECTOR_CONNECTIONS_NAV_CAPABILITY,
} from './connector-credentials-ui.js';


describe('[#27238] the connector credentials UI bundle', () => {
    it('is a valid manifest', () => {
        expect(() => ManifestSchema.parse(CONNECTOR_CREDENTIALS_UI_BUNDLE)).not.toThrow();
    });

    it('contributes two Setup → Integrations component items, each gated on its own door\'s capability', () => {
        expect(CONNECTOR_CREDENTIALS_COMPONENT_REF).toBe('automation:connector-credentials');
        expect(CONNECTOR_CREDENTIALS_NAV_CAPABILITY).toBe('manage_metadata');
        expect(CONNECTOR_CREDENTIALS_UI_BUNDLE.navigationContributions).toEqual([
            {
                app: 'setup',
                group: 'group_integrations',
                priority: 120,
                items: [
                    {
                        id: 'nav_connector_credentials',
                        type: 'component',
                        label: 'Connector Credentials',
                        componentRef: 'automation:connector-credentials',
                        icon: 'key-round',
                        requiredPermissions: ['manage_metadata'],
                    },
                    {
                        id: 'nav_connector_connections',
                        type: 'component',
                        label: 'Connector Connections',
                        componentRef: 'automation:connector-connections',
                        icon: 'plug',
                        requiredPermissions: ['manage_connector_connections'],
                    },
                ],
            },
        ]);
    });

    it('the connections item asks the declared organization-scoped capability the connection door enforces', () => {
        expect(CONNECTOR_CONNECTIONS_COMPONENT_REF).toBe('automation:connector-connections');
        expect(CONNECTOR_CONNECTIONS_NAV_CAPABILITY).toBe('manage_connector_connections');
        const declared = PLATFORM_CAPABILITIES.find((c) => c.name === CONNECTOR_CONNECTIONS_NAV_CAPABILITY);
        expect(declared?.scope).toBe('org');
    });
});

/** Boot a kernel whose `manifest` service (when given) records every registration. */
async function boot(opts: { withManifest: boolean; armRuntime?: boolean }) {
    const registered: Array<{ id?: string }> = [];
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    // Registered FIRST, so the manifest service exists before the automation
    // plugin's init() — the order a real composition gives it.
    kernel.use({
        name: 'test.manifest',
        type: 'standard',
        version: '1.0.0',
        dependencies: [] as string[],
        async init(ctx: any) {
            if (opts.withManifest) ctx.registerService('manifest', { register: (m: { id?: string }) => { registered.push(m); } });
        },
        async start() {},
    } as never);
    kernel.use(new AutomationServicePlugin(opts.armRuntime === false ? { armRuntime: false } : {}));
    await kernel.bootstrap();
    return { kernel, ids: () => registered.map((m) => m.id) };
}

describe('[#27238] the automation plugin registers the bundle at kernel:ready', () => {
    it('a booted kernel registers it exactly once', async () => {
        const { kernel, ids } = await boot({ withManifest: true });
        try {
            expect(ids().filter((id) => id === CONNECTOR_CREDENTIALS_UI_BUNDLE.id)).toHaveLength(1);
        } finally {
            await kernel.shutdown();
        }
    });

    it('an inert boot registers no entry', async () => {
        const { kernel, ids } = await boot({ withManifest: true, armRuntime: false });
        try {
            expect(ids()).not.toContain(CONNECTOR_CREDENTIALS_UI_BUNDLE.id);
        } finally {
            await kernel.shutdown();
        }
    });

    it('a kernel with no manifest service boots, with no entry to carry', async () => {
        const { kernel, ids } = await boot({ withManifest: false });
        try {
            expect(ids()).toEqual([]);
        } finally {
            await kernel.shutdown();
        }
    });
});
