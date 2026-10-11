// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10772] `await kernel.shutdown()` must actually reach `EmailServicePlugin`'s
 * teardown.
 *
 * THE DEFECT. The plugin armed a live `email_template` bridge at
 * `kernel:ready` — a metadata subscription, a protocol mutation listener, a
 * provenance hook bound to the data engine — and (when SMTP is configured) an
 * open transport. The teardown that released them was spelled `dispose()`.
 * `Plugin` (`@objectstack/core`'s `types.ts`) declares `init()`,
 * `start?(ctx)` and `destroy?()` — and NO `dispose()` — and
 * `ObjectKernel.performShutdown()` / `LiteKernel.destroy()` walk the plugins
 * in reverse calling `plugin.destroy()`, so after `await kernel.shutdown()`
 * had RESOLVED the bridge was still armed and still writing.
 *
 * WHAT IS LEFT TO RELEASE. Templates now resolve from the registry at every
 * send (ADR-0131 D6/D10), so there is no bridge: no subscription, no listener,
 * no projector. What `kernel:ready` still binds to the data engine is the
 * closed `sys_email_template` organization door, and that binding is what
 * these pins drive through a real `LiteKernel` bootstrap and shutdown.
 *
 * EVERY PRE-SHUTDOWN LEG IS A POSITIVE CONTROL: without it a door that never
 * bound would satisfy the post-shutdown assertion vacuously.
 *
 * THE `dispose()` LEG IS THE OTHER DIRECTION. `dispose()` stays a delegating
 * alias because it is public API of an exported class; pinning only the
 * shutdown direction would go green on an implementation that deletes it.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { EmailServicePlugin } from './email-plugin.js';
import { EMAIL_TEMPLATE_DOOR_PACKAGE } from './email-template-door.js';

type AnyRecord = Record<string, any>;
type Hook = { event: string; handler: (ctx: AnyRecord) => unknown; packageId?: string };

/** The slice of ObjectQL the organization door binds to: its hook table. */
function fakeEngine() {
    const hooks: Hook[] = [];
    return {
        hooks,
        registry: { listItems: () => [] },
        async find() { return []; },
        registerHook(event: string, handler: Hook['handler'], options?: AnyRecord) {
            hooks.push({ event, handler, packageId: options?.packageId });
        },
        unregisterHooksByPackage(packageId: string) {
            const before = hooks.length;
            for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i].packageId === packageId) hooks.splice(i, 1);
            return before - hooks.length;
        },
        /** The door's own hooks — the plugin binds others (the outbox drain) that are not under test here. */
        doorHooks() { return hooks.filter((h) => h.packageId === EMAIL_TEMPLATE_DOOR_PACKAGE); },
        /** An organization's create, as the engine runs it: every `beforeInsert` hook first. */
        async organizationCreate() {
            for (const h of hooks.filter((x) => x.event === 'beforeInsert')) {
                await h.handler({ session: { userId: 'u1', organizationId: 'org_1' } });
            }
        },
    };
}

/** Registers the collaborators the email plugin resolves. Nothing under test. */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.engine.objectql';
    type = 'standard' as const;
    version = '1.0.0';
    providesServices = ['objectql', 'manifest', 'metadata', 'protocol'];
    readonly engine = fakeEngine();
    init(ctx: PluginContext): void {
        ctx.registerService('objectql', this.engine);
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('metadata', { list: () => [], get: async () => undefined, subscribe: () => () => {} });
        ctx.registerService('protocol', { getMetaItemsForExecution: async () => ({ items: [] }) });
    }
}

async function boot() {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    const fixture = new FixturePlugin();
    kernel.use(fixture);
    const plugin = new EmailServicePlugin();
    kernel.use(plugin);
    await kernel.bootstrap();
    return { kernel, plugin, fixture };
}

describe('#10772 EmailServicePlugin releases what it binds on kernel shutdown', () => {
    it('unbinds the sys_email_template organization door once shutdown() has resolved', async () => {
        const { kernel, fixture } = await boot();

        // POSITIVE CONTROL — the door really is bound, so the assertion below
        // measures a release and not a door that never closed.
        expect(fixture.engine.doorHooks()).toHaveLength(2);
        await expect(fixture.engine.organizationCreate()).rejects.toThrow(/^PERMISSION_DENIED/);

        await kernel.shutdown();

        // THE PIN. Before #10772 the kernel had no `destroy()` to call.
        expect(fixture.engine.doorHooks()).toEqual([]);
        await expect(fixture.engine.organizationCreate()).resolves.toBeUndefined();
    });

    it('the kernel reaches destroy() during shutdown', async () => {
        const { kernel, plugin } = await boot();

        let reached = 0;
        const real = plugin.destroy.bind(plugin);
        plugin.destroy = async () => { reached += 1; await real(); };

        expect(reached).toBe(0);

        await kernel.shutdown();

        expect(reached).toBe(1);
    });

    it('the retained dispose() alias still tears down for an embedder that calls it directly', async () => {
        const { plugin, fixture } = await boot();

        expect(fixture.engine.doorHooks()).toHaveLength(2);

        await plugin.dispose();

        expect(fixture.engine.doorHooks()).toEqual([]);
    });

    it('a teardown on a plugin the kernel never started is a no-op rather than a throw', async () => {
        // Idempotence matters because `destroy()` clears the handles it
        // released; the kernel calls it on every plugin it walks.
        const plugin = new EmailServicePlugin();
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.dispose()).resolves.toBeUndefined();
    });
});
