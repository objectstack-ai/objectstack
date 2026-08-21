// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10772] `await kernel.shutdown()` must actually reach `MetadataPlugin`'s
 * teardown.
 *
 * THE DEFECT. `MetadataPlugin.start()` attaches a real `FileSystemRepository`
 * (an armed chokidar watcher plus a reconciliation sweep), hands it to the
 * `NodeMetadataManager`, and may attach an artifact file watcher on top. The
 * teardown that closed all three was spelled `stop = async (ctx) => …`.
 * `Plugin` (`@objectstack/core`'s `types.ts`) declares `init()`,
 * `start?(ctx)` and `destroy?()` — and NO `stop()` — so
 * `ObjectKernel.performShutdown()` and `LiteKernel.destroy()`, which walk the
 * plugins in reverse calling `plugin.destroy()`, walked straight past it.
 * Nothing in the repo ever called `stop()` on a plugin.
 *
 * WHY THE #10371 CENSUS MISSED IT. The alias is an arrow PROPERTY, not a
 * method, so a method-only reading of the class does not see it at all. That
 * is the whole reason this member — and `AppPlugin` and
 * `ExternalValidationPlugin` — were absent from an enumeration that was
 * otherwise careful.
 *
 * WHY THE ASSERTIONS ARE BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches — the hook merely
 * EXISTING is not the property that was missing, being CALLED BY THE KERNEL
 * is. So these drive a real `LiteKernel` through a real bootstrap and a real
 * shutdown, and read a real `FileSystemRepository` handle.
 *
 * EVERY PRE-SHUTDOWN LEG IS A POSITIVE CONTROL and load-bearing: without it a
 * plugin that never attached a repository would satisfy the post-shutdown
 * assertion vacuously.
 *
 * THE `stop()` LEG IS THE OTHER DIRECTION, and it is not decoration: the
 * repair keeps `stop()` as a delegating alias because it is public API of an
 * exported class and an embedder may have learned to call it directly
 * PRECISELY BECAUSE the kernel never did. Pinning only the shutdown direction
 * would go green on an implementation that simply deletes `stop()`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiteKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { MetadataPlugin } from './plugin.js';

const temps: string[] = [];

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'metadata-plugin-teardown-'));
    temps.push(dir);
    return dir;
}

/** Boot a real kernel carrying a real MetadataPlugin over a scratch root. */
async function boot() {
    const rootDir = tempRoot();
    const kernel = new LiteKernel();
    const plugin = new MetadataPlugin({ rootDir, watch: false });
    kernel.use(plugin);
    await kernel.bootstrap();

    const manager = kernel.getService<{
        getRepository(): { close(): Promise<void> } | undefined;
    }>('metadata');

    return { kernel, plugin, manager, rootDir };
}

/**
 * Count `close()` calls on the REAL repository handle the plugin attached —
 * the same object the plugin holds, since `start()` assigns one instance to
 * both itself and the manager. The real close still runs.
 */
function countCloses(repo: { close(): Promise<void> }): () => number {
    let closes = 0;
    const real = repo.close.bind(repo);
    repo.close = async () => { closes += 1; await real(); };
    return () => closes;
}

afterEach(() => {
    while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe('#10772 MetadataPlugin releases its repository on kernel shutdown', () => {
    it('closes the metadata repository once shutdown() has resolved', async () => {
        const { kernel, manager } = await boot();

        // POSITIVE CONTROL — a repository really was attached, so the
        // assertion below measures a release and not an absence.
        const repo = manager.getRepository();
        expect(repo).toBeDefined();
        const closes = countCloses(repo!);
        expect(closes()).toBe(0);

        await kernel.shutdown();

        // THE PIN. Before the fix this stayed 0: the kernel had no `destroy()`
        // to call, and `stop()` was never anybody's business.
        expect(closes()).toBe(1);
    });

    it('the kernel reaches destroy() during shutdown', async () => {
        const { kernel, plugin } = await boot();

        let reached = 0;
        const real = plugin.destroy;
        plugin.destroy = async () => { reached += 1; await real(); };

        // POSITIVE CONTROL — bootstrap alone must not tear the plugin down.
        expect(reached).toBe(0);

        await kernel.shutdown();

        expect(reached).toBe(1);
    });

    it('the retained stop() alias still tears down for an embedder that calls it directly', async () => {
        const { manager, plugin } = await boot();

        const repo = manager.getRepository();
        expect(repo).toBeDefined();
        const closes = countCloses(repo!);

        // No argument — the shape an embedder writes against a property whose
        // parameter the repair made optional.
        await plugin.stop();

        expect(closes()).toBe(1);
    });

    it('the stop() alias still accepts the PluginContext argument it used to require', async () => {
        const { manager, plugin } = await boot();

        const repo = manager.getRepository();
        const closes = countCloses(repo!);

        // The pre-repair signature was `stop(ctx: PluginContext)`, required.
        // An embedder holding that call shape must keep compiling AND keep
        // working — the entire reason the alias was retained.
        const ctx = {
            logger: { info() {}, warn() {}, error() {}, debug() {} },
        } as unknown as PluginContext;
        await plugin.stop(ctx);

        expect(closes()).toBe(1);
    });

    it('the alias survives being detached from the instance', async () => {
        // It is an arrow PROPERTY, not a method — `const { stop } = plugin`
        // is a call shape the pre-repair class supported, so the repair must
        // not quietly convert it into an unbound method.
        const { manager, plugin } = await boot();

        const repo = manager.getRepository();
        const closes = countCloses(repo!);

        const { stop } = plugin;
        await stop();

        expect(closes()).toBe(1);
    });

    it('a teardown on a plugin the kernel never started is a no-op rather than a throw', async () => {
        // Idempotence matters because `destroy()` clears the handles it
        // released; a teardown that only works once fails inside a suite, and
        // the kernel calls it on every plugin it walks.
        const plugin = new MetadataPlugin({ rootDir: tempRoot(), watch: false });
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.stop()).resolves.toBeUndefined();
    });
});
