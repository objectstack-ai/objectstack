// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10371] `await kernel.shutdown()` must actually reach this plugin's teardown.
 *
 * THE DEFECT THIS PINS. The teardown that unregisters the REST connector was
 * spelled `stop()`. `Plugin` (`@objectstack/core`'s `types.ts`) declares
 * `init()`, `start?(ctx)` and `destroy?()` — and NO `stop()` — so
 * `ObjectKernel.performShutdown()` and `LiteKernel.destroy()`, which walk the
 * plugins in reverse calling `plugin.destroy()`, walked straight past it.
 * Nothing in the repo ever called `stop()`.
 *
 * WHY THE ASSERTION IS BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches — the hook merely
 * EXISTING is not the property that was missing, being CALLED BY THE KERNEL is.
 * So this drives a real kernel through a real shutdown and reads the automation
 * engine's own connector registry.
 *
 * THE PRE-SHUTDOWN LEG IS A POSITIVE CONTROL and load-bearing: without it, a
 * plugin that never registered anything would satisfy the post-shutdown
 * assertion vacuously.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorRestPlugin } from './connector-rest-plugin.js';

const options = { baseUrl: 'https://api.example.com' };

describe('#10371 ConnectorRestPlugin releases its connector on kernel shutdown', () => {
    it('unregisters the REST connector once shutdown() has resolved', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorRestPlugin(options));
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');

        // POSITIVE CONTROL — the connector really is registered, so the
        // assertion below measures removal and not absence.
        expect(engine.getRegisteredConnectors()).toContain('rest');

        await kernel.shutdown();

        // THE PIN. Before the fix this still contained 'rest': the kernel had
        // no `destroy()` to call and `stop()` was never anybody's business.
        expect(engine.getRegisteredConnectors()).not.toContain('rest');
    });

    it('the retained stop() alias still tears down for an embedder that calls it directly', async () => {
        // The alias exists precisely because an embedder may have learned to
        // call it BECAUSE the kernel never did. Removing it would break them,
        // so its behaviour is pinned rather than left to the fix's discretion.
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        const plugin = new ConnectorRestPlugin(options);
        kernel.use(plugin);
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');
        expect(engine.getRegisteredConnectors()).toContain('rest');

        await plugin.stop();

        expect(engine.getRegisteredConnectors()).not.toContain('rest');
    });
});
