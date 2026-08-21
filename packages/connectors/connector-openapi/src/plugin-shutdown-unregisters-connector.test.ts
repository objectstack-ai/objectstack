// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10371] `await kernel.shutdown()` must actually reach this plugin's teardown.
 *
 * THE DEFECT THIS PINS. The teardown that unregisters the hand-wired OpenAPI
 * connector was spelled `stop()`. `Plugin` (`@objectstack/core`'s `types.ts`)
 * declares `init()`, `start?(ctx)` and `destroy?()` — and NO `stop()` — so
 * `ObjectKernel.performShutdown()` and `LiteKernel.destroy()`, which walk the
 * plugins in reverse calling `plugin.destroy()`, walked straight past it.
 * Nothing in the repo ever called `stop()`.
 *
 * WHY THE ASSERTION IS BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches — the hook merely
 * EXISTING is not the property that was missing, being CALLED BY THE KERNEL is.
 *
 * THE PRE-SHUTDOWN LEG IS A POSITIVE CONTROL and load-bearing: without it, a
 * plugin that never registered anything would satisfy the post-shutdown
 * assertion vacuously.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorOpenApiPlugin } from './connector-openapi-plugin.js';
import type { OpenApiDocument } from './openapi-connector.js';

/** Smallest document that yields one named connector ('mini') with one action. */
const document: OpenApiDocument = {
    info: { title: 'Mini' },
    servers: [{ url: 'https://api.mini.example.com' }],
    paths: {
        '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } },
    },
};

describe('#10371 ConnectorOpenApiPlugin releases its connector on kernel shutdown', () => {
    it('unregisters the OpenAPI connector once shutdown() has resolved', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorOpenApiPlugin({ document }));
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');

        // POSITIVE CONTROL — the connector really is registered.
        expect(engine.getRegisteredConnectors()).toContain('mini');

        await kernel.shutdown();

        // THE PIN. Before the fix this still contained 'mini'.
        expect(engine.getRegisteredConnectors()).not.toContain('mini');
    });

    it('the retained stop() alias still tears down for an embedder that calls it directly', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        const plugin = new ConnectorOpenApiPlugin({ document });
        kernel.use(plugin);
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');
        expect(engine.getRegisteredConnectors()).toContain('mini');

        await plugin.stop();

        expect(engine.getRegisteredConnectors()).not.toContain('mini');
    });
});
