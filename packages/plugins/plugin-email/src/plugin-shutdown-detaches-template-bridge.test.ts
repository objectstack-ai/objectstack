// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10772] `await kernel.shutdown()` must actually reach `EmailServicePlugin`'s
 * teardown.
 *
 * THE DEFECT. The plugin arms a live `email_template` bridge at
 * `kernel:ready`: a metadata subscription, a protocol mutation listener, a
 * provenance hook bound to the data engine, and (when SMTP is configured) an
 * open transport. The teardown that released all of them was spelled
 * `dispose()`. `Plugin` (`@objectstack/core`'s `types.ts`) declares `init()`,
 * `start?(ctx)` and `destroy?()` — and NO `dispose()` — and
 * `ObjectKernel.performShutdown()` / `LiteKernel.destroy()` walk the plugins
 * in reverse calling `plugin.destroy()`. Measured on the same revision:
 * `dispose()` had exactly ONE caller in the whole repo, a test in this
 * package. The kernel was never one of them, so after `await
 * kernel.shutdown()` had RESOLVED the bridge was still armed and still
 * writing.
 *
 * THE SPELLING. This member and `WebhookOutboxPlugin` are the `dispose()`
 * half of the family — the "seventh spelling" the #10619 gate's roster was
 * widened for BEFORE any instance of it was known, already present when the
 * roster was measured. A census that looked only for `stop()` misses them
 * entirely, which is the other half of why #10371's enumeration came out
 * short.
 *
 * WHY THE ASSERTIONS ARE BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches. These drive a real
 * `LiteKernel` through a real bootstrap and a real shutdown and then perform a
 * real runtime write, reading the rows that did or did not land.
 *
 * EVERY PRE-SHUTDOWN LEG IS A POSITIVE CONTROL: without it a bridge that never
 * armed would satisfy the post-shutdown assertion vacuously.
 *
 * THE `dispose()` LEG IS THE OTHER DIRECTION. The repair keeps `dispose()` as
 * a delegating alias because it is public API of an exported class and an
 * embedder — here, a test in this very package — calls it directly. Pinning
 * only the shutdown direction would go green on an implementation that simply
 * deletes `dispose()`.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { EmailServicePlugin } from './email-plugin.js';

const TABLE = 'sys_email_template';
type AnyRecord = Record<string, any>;

/**
 * The slice of ObjectQL the template bridge and the provenance stamp touch —
 * the same double `email-plugin.template-runtime-write.test.ts` uses, so this
 * file cannot accept a dispatch shape the real engine would refuse.
 */
function fakeEngine() {
    const rows: AnyRecord[] = [];
    const matches = (row: AnyRecord, cond?: AnyRecord) =>
        !cond ||
        Object.entries(cond).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return row[k] === v;
        });
    return {
        rows,
        _registry: { listItems: () => [] },
        async find(object: string, q?: AnyRecord) {
            if (object !== TABLE) return [];
            const out = rows.filter((r) => matches(r, q?.where ?? q?.filter));
            return typeof q?.limit === 'number' ? out.slice(0, q.limit) : out;
        },
        async insert(_object: string, row: AnyRecord) {
            rows.push({ ...row });
            return { id: row.id };
        },
        async update(_object: string, data: AnyRecord, options?: AnyRecord) {
            const dispatch = assertEngineUpdateDispatch(data, options);
            if (dispatch.kind !== 'by-id') throw new Error(`unexpected update dispatch: ${dispatch.kind}`);
            const target = rows.find((r) => r.id === dispatch.id);
            if (target) Object.assign(target, data);
            return { affected: target ? 1 : 0 };
        },
        registerHook() { /* provenance stamp */ },
        unregisterHooksByPackage() { return 0; },
    };
}

/** Mirrors `ObjectStackProtocolImplementation`'s two registration seams. */
function fakeProtocol() {
    const projectors = new Map<string, (evt: AnyRecord) => Promise<void>>();
    const listeners: Array<(evt: AnyRecord) => void> = [];
    const p: AnyRecord = {
        projectorFailures: [] as string[],
        registerMutationProjector: (type: string, fn: (evt: AnyRecord) => Promise<void>) => {
            projectors.set(type, fn);
        },
        onMetadataMutation: (fn: (evt: AnyRecord) => void) => {
            listeners.push(fn);
            return () => {
                const i = listeners.indexOf(fn);
                if (i >= 0) listeners.splice(i, 1);
            };
        },
        async announce(evt: AnyRecord) {
            const projector = projectors.get(evt.type);
            if (projector) {
                // Mirrors `runMutationProjector`: a throw is caught and
                // reported on the write's response, never propagated.
                try { await projector(evt); }
                catch (e: any) { p.projectorFailures.push(String(e?.message ?? e)); }
            }
            for (const l of [...listeners]) l(evt);
            await new Promise((r) => setTimeout(r, 0));
        },
        /** A `PUT /api/v1/meta/email_template/:name` that landed. */
        save: (name: string, body: unknown) =>
            p.announce({ type: 'email_template', name, state: 'active', body }),
    };
    return p;
}

const template = () => ({
    name: 'auth.password_reset',
    label: 'Password Reset',
    category: 'auth',
    locale: 'en-US',
    subject: 'Reset your password, {{user.name}}',
    bodyHtml: '<p>Click <a href="{{url}}">here</a></p>',
});

/** Registers the collaborators the email plugin resolves. Nothing under test. */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.engine.objectql';
    type = 'standard';
    version = '1.0.0';
    providesServices = ['objectql', 'manifest', 'metadata', 'protocol'];
    readonly engine = fakeEngine();
    readonly protocol = fakeProtocol();
    init(ctx: PluginContext): void {
        ctx.registerService('objectql', this.engine);
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('metadata', {
            list: () => [],
            get: async () => undefined,
            subscribe: () => () => {},
        });
        ctx.registerService('protocol', this.protocol);
    }
}

async function boot() {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    const fixture = new FixturePlugin();
    kernel.use(fixture);
    const plugin = new EmailServicePlugin({ seedTemplates: false });
    kernel.use(plugin);
    await kernel.bootstrap();
    return { kernel, plugin, fixture };
}

const rowsOf = (engine: AnyRecord) =>
    engine.rows.filter((r: AnyRecord) => r.name === 'auth.password_reset');

describe('#10772 EmailServicePlugin detaches its template bridge on kernel shutdown', () => {
    it('stops materializing runtime writes once shutdown() has resolved', async () => {
        const { kernel, fixture } = await boot();

        // POSITIVE CONTROL — the live bridge really is armed, so the assertion
        // below measures a detachment and not a bridge that never worked.
        await fixture.protocol.save('auth.password_reset', template());
        expect(fixture.protocol.projectorFailures).toEqual([]);
        expect(rowsOf(fixture.engine)).toHaveLength(1);
        fixture.engine.rows.length = 0;

        await kernel.shutdown();

        await fixture.protocol.save('auth.password_reset', template());

        // THE PIN. Before the fix this wrote another row: the kernel had no
        // `destroy()` to call, and `dispose()`'s only caller in the entire
        // repo was a test.
        expect(rowsOf(fixture.engine)).toHaveLength(0);
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

        await fixture.protocol.save('auth.password_reset', template());
        expect(rowsOf(fixture.engine)).toHaveLength(1);
        fixture.engine.rows.length = 0;

        await plugin.dispose();

        await fixture.protocol.save('auth.password_reset', template());

        expect(rowsOf(fixture.engine)).toHaveLength(0);
    });

    it('a teardown on a plugin the kernel never started is a no-op rather than a throw', async () => {
        // Idempotence matters because `destroy()` clears the handles it
        // released; the kernel calls it on every plugin it walks.
        const plugin = new EmailServicePlugin({ seedTemplates: false });
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.dispose()).resolves.toBeUndefined();
    });
});
