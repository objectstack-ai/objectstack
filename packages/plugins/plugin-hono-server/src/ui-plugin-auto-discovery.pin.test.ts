// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The UI auto-discovery block in `HonoServerPlugin.start()`, pinned end to end.
 *
 * WHY THIS FILE EXISTS (#16050). That block reads three keys off every plugin
 * the kernel has loaded — `type`, `staticPath`, `slug` — and mounts `/slug`
 * plus `/slug/*` for the ones that answer. Before this file, grepping
 * `staticPath` across every `.ts` outside `node_modules`/`dist` returned four
 * lines: the `PluginSchema` declaration and the three reads inside the block
 * itself. `slug` had the same shape. Zero producers, and no test — so the block
 * was exercised by no in-repo plugin, served only externally authored ones, and
 * nothing in the tree would have noticed if it stopped working.
 *
 * A block in that state is not merely untested, it is INDISTINGUISHABLE FROM
 * DEAD CODE to anyone reading this repository, and #15638 is what that costs:
 * a careful reader concluded the legacy arm was unreachable and the premise had
 * to be falsified by a purpose-built probe driving the real kernel. This file is
 * that probe, made permanent — the artifact in the tree that says the block is
 * live.
 *
 * WHAT MAKES IT END-TO-END. The fixture plugin is registered through the real
 * `ObjectKernel.use()` and the real `HonoServerPlugin.init()`/`start()` run
 * against the context the kernel hands its plugins, so the pin measures the
 * whole path a real UI plugin takes: loader validation, the verbatim store into
 * `kernel.plugins`, the read back out, and the routes handed to `rawApp.get`.
 * Nothing here stubs the kernel, the plugin, or the branch under test.
 *
 * WHY THE NEGATIVE CONTROL IS NOT OPTIONAL. A harness that mounts everything
 * would produce pin B's four route registrations whether or not the branch
 * works. Pin D is the calibration: the SAME fixture, the SAME on-disk static
 * root, one key different, must produce `[]`. Without D, B proves nothing.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from './hono-plugin';

/**
 * The auto-discovery block skips a mount whose root does not exist on disk
 * (`fs.existsSync(mountRoot)`), so the pin needs a real directory. It lives in
 * the OS temp dir rather than in the tree: an in-repo fixture root would need a
 * tracked ignore rule to keep `Lint & Repo Gates` green, and this needs no
 * repository state at all.
 */
let STATIC_ROOT: string;

beforeAll(() => {
    STATIC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'os-hono-ui-pin-'));
    fs.writeFileSync(path.join(STATIC_ROOT, 'index.html'), '<!doctype html>');
});

afterAll(() => {
    fs.rmSync(STATIC_ROOT, { recursive: true, force: true });
});

/**
 * The two keys the block reads are declared on `PluginSchema`
 * (`packages/spec/src/kernel/plugin.zod.ts`) but NOT on the `Plugin` interface
 * the kernel's `use()` accepts (`packages/core/src/types.ts`) — which is one
 * reason the repo contained no producer of either. The fixture states the extra
 * surface explicitly instead of casting it away, so a future change to `Plugin`
 * that adopts these keys does not silently pass this file by.
 */
type UiPluginFixture = Plugin & {
    staticPath?: string;
    slug?: string;
    default?: boolean;
};

function makeFixture(overrides: Partial<UiPluginFixture> & { name: string }): UiPluginFixture {
    return {
        version: '1.0.0',
        type: 'ui',
        staticPath: STATIC_ROOT,
        init: () => { /* a UI plugin contributes assets, not services */ },
        ...overrides,
    };
}

interface Observation {
    /** Every route argument handed to `rawApp.get`, in registration order. */
    routes: string[];
    /** The entry `kernel.use()` left in the kernel's own plugin map. */
    stored: Record<string, unknown> | undefined;
}

/**
 * Register `fixture` on a real kernel, run the real Hono plugin's `init()` and
 * `start()`, and report what the auto-discovery block did.
 */
async function observe(fixture: UiPluginFixture): Promise<Observation> {
    const kernel = new ObjectKernel({
        logger: { level: 'silent' },
        // No process signal handlers: this kernel is never bootstrapped or shut
        // down, and a listener per test case would leak across the file.
        gracefulShutdown: false,
    });

    await kernel.use(fixture as Plugin);

    const honoPlugin = new HonoServerPlugin({ port: 0 });

    // The very object `bootstrap()` passes to every plugin: `initPluginWithTimeout`
    // calls `plugin.init(this.context)` with this context, and its `getKernel()`
    // returns this kernel — which is what the block under test reaches through.
    const ctx = (kernel as unknown as { context: PluginContext }).context;

    await honoPlugin.init(ctx);

    // Observe AFTER init(): init() installs middleware and registers hooks, and
    // this pin is about the routes `start()` mounts. `getRawApp()` returns the
    // adapter's single stable Hono instance, so the spy set here is the one
    // `start()` will call.
    const rawApp = (
        honoPlugin as unknown as { server: { getRawApp(): { get: (...args: unknown[]) => unknown } } }
    ).server.getRawApp();

    const routes: string[] = [];
    const spy = vi.spyOn(rawApp, 'get').mockImplementation(((route: string) => {
        routes.push(route);
        return rawApp;
    }) as never);

    try {
        await honoPlugin.start(ctx);
    } finally {
        spy.mockRestore();
    }

    const stored = (kernel as unknown as { plugins: Map<string, Record<string, unknown>> })
        .plugins.get(fixture.name);

    return { routes, stored };
}

describe('UI plugin auto-discovery (#16050)', () => {
    describe('A — the kernel carries the keys the block reads', () => {
        it('kernel.use() accepts a `ui` plugin and stores `type`, `staticPath` and `slug` verbatim', async () => {
            const { stored } = await observe(
                makeFixture({ name: '@os-fixture/console', slug: 'console-fixture' }),
            );

            // `PluginLoader.toPluginMetadata` is a CAST, not a copy, so keys the
            // `Plugin` interface never declares survive into `kernel.plugins`.
            // That is precisely what makes the auto-discovery block reachable,
            // and it is a property of the loader, not an accident of this test.
            expect(stored).toBeDefined();
            expect(stored?.type).toBe('ui');
            expect(stored?.staticPath).toBe(STATIC_ROOT);
            expect(stored?.slug).toBe('console-fixture');
        });
    });

    describe('B — the modern `ui` arm mounts', () => {
        it('mounts `/slug` and `/slug/*` for an explicit slug', async () => {
            const { routes } = await observe(
                makeFixture({ name: '@os-fixture/console', slug: 'console-fixture' }),
            );

            // Two registrations per route, in this order: the static handler,
            // then the scoped SPA fallback (`spa: true` is hard-coded for an
            // auto-discovered UI plugin). Pinned as the exact sequence rather
            // than a de-duplicated set, because losing the SPA fallback is a
            // real regression that a set comparison would hide.
            expect(routes).toEqual([
                '/console-fixture',
                '/console-fixture',
                '/console-fixture/*',
                '/console-fixture/*',
            ]);
        });

        it('derives the slug from the last path segment of the plugin name when none is declared', async () => {
            const { routes } = await observe(makeFixture({ name: '@os-fixture/console' }));

            // `plugin.slug || plugin.name.split('/').pop()` — the documented
            // `@org/console -> console` derivation.
            expect(routes).toEqual(['/console', '/console', '/console/*', '/console/*']);
        });
    });

    /**
     * C — the legacy `ui-plugin` arm. DELIBERATELY NOT WRITTEN YET.
     *
     * `hono-plugin.ts` matches `plugin.type === 'ui' || plugin.type === 'ui-plugin'`,
     * and the second disjunct is the subject of #15638: `ui-plugin` is not a
     * member of `CORE_PLUGIN_TYPES`, so `PluginSchema` refuses the value while
     * the boot path — which never calls `PluginSchema` — accepts it and mounts.
     * That arm is live, and #15638 decides what it should be. The ruling picks
     * between two INCOMPATIBLE pins, so writing either one now would pin a guess:
     *
     *   - if #15638 rules REMOVE, C inverts: a `ui-plugin` fixture must mount
     *     NOTHING, i.e. `routes` equal to `[]`, exactly like pin D;
     *   - if #15638 rules DECLARE/CONVERT (an ADR-0087 conversion entry), C
     *     becomes: a `ui-plugin` fixture is normalised to `ui`, mounts `/slug`
     *     and `/slug/*` exactly like pin B, and emits one deprecation warning.
     *
     * Whoever lands #15638 writes this case in that PR — the harness above takes
     * it unchanged; only the fixture's `type` and the expectation differ. Until
     * then the placeholder is the honest state: measured as live on #15638,
     * unpinned here on purpose.
     */
    it.todo('C — the legacy `ui-plugin` arm behaves as #15638 rules that it should');

    describe('D — the negative control: the harness can produce an empty result', () => {
        it('a non-UI type mounts nothing', async () => {
            const { routes, stored } = await observe(
                makeFixture({
                    name: '@os-fixture/driver',
                    type: 'driver',
                    slug: 'driver-fixture',
                }),
            );

            // Same fixture builder, same EXISTING static root, same slug shape as
            // pin B — `type` is the only difference. So `[]` here is caused by the
            // type guard and not by a harness that never mounts, and pin B's four
            // registrations are caused by the branch and not by a harness that
            // mounts everything.
            expect(stored?.staticPath).toBe(STATIC_ROOT);
            expect(routes).toEqual([]);
        });

        it('a `ui` type with no staticPath mounts nothing', async () => {
            const { routes } = await observe(
                makeFixture({
                    name: '@os-fixture/console-no-assets',
                    staticPath: undefined,
                    slug: 'console-fixture',
                }),
            );

            // The other conjunct of the same guard (`&& plugin.staticPath`), so a
            // change that keeps the type check but drops the assets check cannot
            // sit green.
            expect(routes).toEqual([]);
        });
    });
});
