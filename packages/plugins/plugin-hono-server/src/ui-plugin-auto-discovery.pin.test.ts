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
 * against the context the kernel hands its plugins. Nothing here stubs the
 * kernel, the plugin, or the branch under test.
 *
 * WHAT EACH GROUP ACTUALLY OBSERVES — stated because the difference is the whole
 * point of this file. A, B and D observe ROUTE REGISTRATION: they replace
 * `rawApp.get` with a recorder, so no handler is ever installed and nothing is
 * served. That is enough to pin WHICH routes exist and, for D, that none does —
 * and it is blind to everything downstream of the route string. E closes that:
 * it leaves `rawApp.get` alone, so the real handlers install on the real Hono
 * app, and drives `rawApp.request(...)` to pin what actually comes BACK. E is
 * what makes the three properties the block hard-codes per mount load-bearing:
 * `root: plugin.staticPath` (the bytes served come from that directory),
 * `rewrite: true` (the prefix really is stripped before the file is looked up)
 * and `spa: true` (a path matching no file still answers with the index). Every
 * registration-only assertion in this file passes through all three untouched,
 * and each has its own case and its own named falsifier in E.
 *
 * STILL UNPINNED, deliberately, and named here so the next reader does not
 * over-trust this file: the `default`/`isDefault` redirect that mounts `/` at
 * the plugin's base route. The fixture does not set it, and pinning it is a
 * wider change than this card carries.
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
import { CORE_PLUGIN_TYPES } from '@objectstack/spec/kernel';
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

/** Served verbatim by pin E, so its exact bytes are part of the assertion. */
const INDEX_HTML = '<!doctype html>';
const ASSET_CSS = '.os-pin{color:#123456}';

beforeAll(() => {
    STATIC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'os-hono-ui-pin-'));
    fs.writeFileSync(path.join(STATIC_ROOT, 'index.html'), INDEX_HTML);
    fs.mkdirSync(path.join(STATIC_ROOT, 'assets'));
    fs.writeFileSync(path.join(STATIC_ROOT, 'assets', 'app.css'), ASSET_CSS);
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
interface Booted {
    kernel: ObjectKernel;
    honoPlugin: HonoServerPlugin;
    ctx: PluginContext;
    rawApp: RawApp;
}

/** The subset of the raw Hono app these pins touch. */
interface RawApp {
    get: (...args: unknown[]) => unknown;
    request: (input: string) => Promise<Response>;
}

/**
 * Register `fixture` on a real kernel and run the real plugin's `init()`, stopping
 * short of `start()` so each pin can decide whether to watch registration or let
 * it happen for real.
 */
async function boot(fixture: UiPluginFixture): Promise<Booted> {
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

    // `getRawApp()` returns the adapter's single stable Hono instance, so what is
    // taken here is the object `start()` will register on.
    const rawApp = (
        honoPlugin as unknown as { server: { getRawApp(): RawApp } }
    ).server.getRawApp();

    return { kernel, honoPlugin, ctx, rawApp };
}

/**
 * Run `start()` with `rawApp.get` replaced by a recorder, and report the route
 * strings the auto-discovery block handed it.
 *
 * ⚠️ Nothing is installed and nothing is served under this helper — that is the
 * point of pin E, which does not use it.
 */
async function observe(fixture: UiPluginFixture): Promise<Observation> {
    const { kernel, honoPlugin, ctx, rawApp } = await boot(fixture);

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

/**
 * Run `start()` for real — `rawApp.get` untouched, so the static and SPA handlers
 * actually install — and hand back the app to issue requests against.
 */
async function serve(fixture: UiPluginFixture): Promise<RawApp> {
    const { honoPlugin, ctx, rawApp } = await boot(fixture);
    await honoPlugin.start(ctx);
    return rawApp;
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
        // Every declared plugin type EXCEPT `ui`, read off the spec's own closed set
        // rather than listed here — so a type added to `CORE_PLUGIN_TYPES` tomorrow
        // is covered without anyone remembering to come back. Enumerating the whole
        // complement is what makes the guard's SPECIFICITY pinned: a single `driver`
        // control would sit green while the guard was widened to `type !== 'driver'`.
        const NON_UI_TYPES = ['standard', ...CORE_PLUGIN_TYPES].filter((t) => t !== 'ui');

        it.each(NON_UI_TYPES)('a `%s` plugin mounts nothing', async (type) => {
            const { routes, stored } = await observe(
                makeFixture({
                    name: `@os-fixture/${type}`,
                    type: type as UiPluginFixture['type'],
                    slug: 'not-ui-fixture',
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

    /**
     * E — served, not merely registered.
     *
     * A, B and D replace `rawApp.get`, so they observe route STRINGS and nothing
     * downstream of them. Measured, not assumed: with `root` swapped to
     * `process.cwd()`, with `rewrite` flipped to `false`, and with the SPA
     * fallback retargeted at a file that does not exist, all of A, B and D stay
     * green through every one of those.
     *
     * So this group installs the real handlers and asks the real Hono app for a
     * response. The auto-discovery block hard-codes three properties per mount —
     * `root: plugin.staticPath`, `rewrite: true`, `spa: true` — and ⭐ EACH GETS
     * ITS OWN CASE WITH ITS OWN NAMED FALSIFIER, because a coverage claim per
     * property is only worth what its falsifier is:
     *
     *   root    — the base route, reddened by pointing `root` elsewhere;
     *   rewrite — the asset request, reddened by `rewrite: false`;
     *   spa     — the deep client route, reddened by retargeting the fallback.
     *
     * ⚠️ The three are NOT interchangeable, and the trap is specific: the base
     * route is rewritten to `/`, which resolves to the mount directory, so the
     * STATIC handler serves `index.html` itself and the SPA fallback is never
     * reached. A base-route case therefore says nothing whatsoever about the SPA
     * fallback — it passes with the fallback completely broken. Only a path that
     * matches no file on disk reaches it.
     */
    describe('E — the mounted routes actually serve from staticPath', () => {
        it('serves the index for the base route, from the mounted directory', async () => {
            const rawApp = await serve(
                makeFixture({ name: '@os-fixture/console', slug: 'console-fixture' }),
            );

            const res = await rawApp.request('/console-fixture/');
            const body = await res.text();

            // Served by the STATIC handler, not the SPA fallback: `rewrite` turns
            // the path into `/`, which resolves to the mount root, and serveStatic
            // appends `index.html` for a directory. The bytes come out of the
            // fixture's own temp directory, so a mount pointed anywhere else cannot
            // answer this — that is the property this case owns.
            expect(res.status).toBe(200);
            expect(body).toBe(INDEX_HTML);
        });

        it('strips the route prefix before looking the asset up', async () => {
            const rawApp = await serve(
                makeFixture({ name: '@os-fixture/console', slug: 'console-fixture' }),
            );

            const res = await rawApp.request('/console-fixture/assets/app.css');
            const body = await res.text();

            // `rewrite: true` turns /console-fixture/assets/app.css into
            // /assets/app.css before the lookup. Without the strip the file is
            // missed and the SPA fallback answers with index.html INSTEAD — a 200
            // either way, which is exactly why the assertion is on the body and
            // names the wrong answer explicitly rather than checking the status.
            expect(res.status).toBe(200);
            expect(body.trim()).toBe(ASSET_CSS);
            expect(body).not.toContain(INDEX_HTML);
        });

        it('falls back to the index for a deep client-side route', async () => {
            const rawApp = await serve(
                makeFixture({ name: '@os-fixture/console', slug: 'console-fixture' }),
            );

            const res = await rawApp.request('/console-fixture/deep/client/route');
            const body = await res.text();

            // This path matches NO file under the mount root, so the static handler
            // calls next() and the scoped SPA fallback is the only thing that can
            // answer. That makes this the one case in the file that actually
            // exercises `spa: true`: with the fallback retargeted at a file that
            // does not exist the request 404s here, while every other case in this
            // file stays green.
            expect(res.status).toBe(200);
            expect(body).toBe(INDEX_HTML);
        });
    });
});
