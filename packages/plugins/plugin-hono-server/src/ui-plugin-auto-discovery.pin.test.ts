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
 * WHAT MAKES IT END-TO-END. The fixture plugin is registered through a real
 * kernel's `use()` and the real `HonoServerPlugin.init()`/`start()` run against
 * the context that kernel hands its plugins. Nothing here stubs the kernel, the
 * plugin, or the branch under test.
 *
 * ⭐ WHICH KERNEL, AND WHY THAT IS HALF THE FILE (#16599, then #16721). This
 * repository publishes TWO kernels and `@objectstack/core` exports both. When
 * group F was written they did NOT agree about this block's inputs, and that
 * disagreement is the reason groups B, D and F exist in the shape they do:
 *
 *   - `ObjectKernel.use()` runs `PluginLoader.loadPlugin` ->
 *     `validatePluginContract` -> `PluginSchema.safeParse` on every plugin
 *     object (#16049, landed as #16363), and since #16334 that schema requires
 *     `staticPath` AND `slug` for `type: 'ui'`. A `ui` plugin missing either is
 *     a boot REFUSAL and never reaches `kernel.plugins` at all.
 *   - `LiteKernel.use()` — until #16721 — called `registerPluginByName`
 *     directly and never touched `PluginSchema`: the same object was stored
 *     verbatim, and `ObjectKernelBase.createContext()` handed plugins a context
 *     whose `getKernel()` returned that kernel, whose `plugins` map is exactly
 *     what this block iterates. Group F measured that, per branch.
 *   - Since #16721 (maintainer ruling, option A: the kernels converge)
 *     `LiteKernel.use()` runs the SAME check — `assertPluginContract` in
 *     `packages/core/src/plugin-contract.ts`, the one statement both kernels
 *     call — and refuses the same objects with the same envelope. Group F now
 *     pins THAT, with F0 still proving the harness mounts under this kernel.
 *
 * `AGENTS.md`'s Kernel table names `LiteKernel` for "Tests (vitest), serverless,
 * edge (Workers)", so this is not a curiosity — it is the second supported way
 * to run a UI plugin, and with zero in-repo `type: 'ui'` producers, externally
 * authored plugins are the block's only real callers on EITHER kernel. It is
 * also why the divergence bit in the direction that hurt: the lenient kernel
 * was the one authors test against, and the strict one was production.
 *
 * ⇒ "Reachable" is therefore not a property of a branch here, it is a property
 * of a branch PER KERNEL, and this file states both halves rather than one —
 * and now that both halves answer the same, it says so per kernel too.
 *
 * WHAT EACH GROUP ACTUALLY OBSERVES — stated because the difference is the whole
 * point of this file. A, B, D and F observe ROUTE REGISTRATION: they replace
 * `rawApp.get` with a recorder, so no handler is ever installed and nothing is
 * served. That is enough to pin WHICH routes exist and, for D and F2, that none
 * does —
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
 *
 * Group F carries its own copy of that discipline rather than borrowing D's,
 * because it runs on a different kernel: F0 is the firing control showing the
 * `LiteKernel` harness CAN mount, so F1/F2's refusals are caused by the
 * contract and not by a harness that never mounts under that kernel. ⛔ A
 * group that can only ever refuse measures nothing.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiteKernel, ObjectKernel } from '@objectstack/core';
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
 * (`packages/spec/src/kernel/plugin.zod.ts`) and, since #16334, inherited by
 * the `Plugin` interface through `PluginDefinition` — the change this alias
 * was written to notice, and it did: `Plugin` now carries `staticPath`, `slug`
 * and `default` itself, so the alias survives only as the fixture's name.
 */
type UiPluginFixture = Plugin;

/**
 * The refusal `promise` produced, or a loud failure if it produced none — the
 * shape core's `plugin-contract-enforcement.test.ts` uses, so a case whose
 * input STOPPED being refused reports "it loaded" instead of a property miss.
 */
async function refusal(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (e) {
        return e as Error;
    }
    throw new Error('expected kernel.use() to refuse the plugin, but it loaded');
}

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
    kernel: KernelUnderTest;
    honoPlugin: HonoServerPlugin;
    ctx: PluginContext;
    rawApp: RawApp;
}

/**
 * Either published kernel. Both are exported from `@objectstack/core`, both give
 * their plugins a context whose `getKernel()` returns the kernel itself, and both
 * keep the loaded plugins in a `plugins` map — the three properties the block
 * under test depends on. What they do NOT share is whether `use()` validates:
 * see the header. Groups A, B, D and E run on `ObjectKernel`; group F runs on
 * `LiteKernel`.
 */
type KernelUnderTest = ObjectKernel | LiteKernel;

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

    return attachHono(kernel);
}

/**
 * The `LiteKernel` counterpart of {@link boot} — the kernel `AGENTS.md` names for
 * tests, serverless and edge. `LiteKernel.use()` is synchronous; since #16721 it
 * runs the same `assertPluginContract` the loader runs for {@link boot} and then
 * stores the object through `registerPluginByName`, so a fixture {@link boot}
 * REFUSES is refused here too — synchronously, which the `async` wrapper turns
 * into the rejection {@link refusal} reads.
 *
 * ⚠️ Until #16721 nothing on this path called `PluginSchema` at all, so #16334's
 * `type: 'ui'` requirements and #16363's enforcement were both absent here — the
 * state group F was written to measure. Its header records both readings.
 *
 * No `gracefulShutdown` option exists on this kernel and it registers no signal
 * handlers of its own, so there is nothing to opt out of.
 */
async function bootLite(fixture: UiPluginFixture): Promise<Booted> {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });

    kernel.use(fixture as Plugin);

    return attachHono(kernel);
}

/**
 * The half both kernels share: construct the real Hono plugin, take the very
 * context object the kernel hands its plugins, and run the real `init()` —
 * stopping short of `start()` so each pin can decide whether to watch
 * registration or let it happen for real.
 */
async function attachHono(kernel: KernelUnderTest): Promise<Booted> {
    const honoPlugin = new HonoServerPlugin({ port: 0 });

    // The very object `bootstrap()` passes to every plugin: `initPluginWithTimeout`
    // calls `plugin.init(this.context)` with this context, and its `getKernel()`
    // returns this kernel — which is what the block under test reaches through.
    // `LiteKernel` builds the same object, in `ObjectKernelBase.createContext()`.
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
async function observe(
    fixture: UiPluginFixture,
    bootOn: (f: UiPluginFixture) => Promise<Booted> = boot,
): Promise<Observation> {
    const { kernel, honoPlugin, ctx, rawApp } = await bootOn(fixture);

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

        it('a `ui` plugin declaring no `slug` is refused at ObjectKernel.use() before the block can derive one (#16334)', async () => {
            // `plugin.slug || plugin.name.split('/').pop()` — the block's documented
            // `@org/console -> console` derivation — is unreachable ON THIS KERNEL
            // since #16334: `PluginSchema` requires `slug` for `type: 'ui'` and
            // `ObjectKernel.use()` runs the schema (#16049, landed as #16363), so
            // the object never reaches `kernel.plugins`. Pinned as the refusal,
            // with the spec's stable code surfacing inside the loader's envelope.
            //
            // The other kernel, and the history this comment carries. #16599
            // measured the expression LIVE on `LiteKernel`, which then never called
            // `PluginSchema` (ablating the `||` moved the mounted route from
            // `/console` to `/undefined`), and this comment said "⛔ NOT dead code"
            // on that basis. Since #16721 `LiteKernel.use()` runs the same contract,
            // so the same object is refused there too — pin F1 — and the derivation
            // is reachable through NEITHER published kernel's `use()`. Whether that
            // makes it removable is `hono-plugin.ts`'s question, noted on #16721 and
            // deliberately not pinned here: this file pins what each kernel's
            // `use()` lets through, not what the block should do with it.
            const err = await refusal(boot(makeFixture({ name: '@os-fixture/console' })));
            expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
            expect(err.message).toContain("at 'slug'");
            expect(err.message).toContain('PLUGIN_UI_REQUIRED_KEY_MISSING');
        });
    });

    /**
     * C — the legacy `ui-plugin` arm. DELIBERATELY NOT WRITTEN YET.
     *
     * `hono-plugin.ts` matches `plugin.type === 'ui' || plugin.type === 'ui-plugin'`,
     * and the second disjunct is the subject of #15638: `ui-plugin` is not a
     * member of `CORE_PLUGIN_TYPES`, so `PluginSchema` refuses the value.
     *
     * ⚠️ WHICH KERNEL (#16599). This narration used to say "the boot path — which
     * never calls `PluginSchema` — accepts it and mounts", naming no kernel. That
     * is true of exactly one of the two, and both were measured:
     *
     *   - `ObjectKernel.use()` REFUSES it since #16363, with
     *     `PLUGIN_CONTRACT_VIOLATION … at 'type'` naming the closed set.
     *   - `LiteKernel.use()` accepted it until #16721 and the block mounted
     *     `/slug` and `/slug/*`; since #16721 it runs the same contract and
     *     refuses it with the same envelope (core's enforcement test, group G).
     *
     * ⇒ #15638's arm was HALF dead when this note was first written — the same
     * shape as the two arms #16599 measured — and is now reachable through
     * NEITHER published kernel's `use()`. That is a reading about the tree, not
     * the ruling: #15638 still picks between two INCOMPATIBLE pins, so writing
     * either one now would pin a guess:
     *
     *   - if #15638 rules REMOVE, C becomes: a `ui-plugin` fixture is refused at
     *     `use()` on BOTH kernels (true since #16721) and the arm is deleted,
     *     so nothing can ever mount it;
     *   - if #15638 rules DECLARE/CONVERT (an ADR-0087 conversion entry), C
     *     becomes: a `ui-plugin` fixture is normalised to `ui` BEFORE the contract
     *     runs — on both kernels — mounts `/slug` and `/slug/*` exactly like pin
     *     B, and emits one deprecation warning.
     *
     * Whoever lands #15638 writes this case in that PR — the harness above takes
     * it unchanged; only the fixture's `type`, the kernel(s) it boots on and the
     * expectation differ. Until then the placeholder is the honest state:
     * refused on both kernels, unpinned here on purpose.
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

        it('a `ui` plugin declaring no `staticPath` is refused at ObjectKernel.use() before the block runs (#16334)', async () => {
            // The other conjunct of the same guard (`&& plugin.staticPath`) is
            // likewise unreachable ON THIS KERNEL: `staticPath` is required for
            // `type: 'ui'` since #16334, so a `ui` plugin without assets is a boot
            // refusal here, not a silent non-mount. The `NON_UI_TYPES` cases above
            // remain the proof that this harness CAN produce `[]`.
            //
            // The other kernel, with the same history as pin B's twin above. #16599
            // measured the conjunct LIVE on `LiteKernel`: the object reached the block
            // there and deleting `&& plugin.staticPath` turned a clean boot into a
            // `TypeError` naming `paths[1]`, thrown by
            // `path.resolve(process.cwd(), mount.root)` once `undefined` was pushed
            // as a mount root. Since #16721 `LiteKernel.use()` refuses the same
            // object — pin F2 — so the conjunct is reachable through neither
            // published kernel's `use()`. Removable or not is `hono-plugin.ts`'s
            // question, noted on #16721; this file pins the kernels' answers.
            const err = await refusal(boot(makeFixture({
                name: '@os-fixture/console-no-assets',
                staticPath: undefined,
                slug: 'console-fixture',
            })));
            expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
            expect(err.message).toContain("at 'staticPath'");
            expect(err.message).toContain('PLUGIN_UI_REQUIRED_KEY_MISSING');
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

    /**
     * F — the SAME two inputs on `LiteKernel`, where they are now refused too.
     *
     * WHY THIS GROUP EXISTS, and what it used to pin (#16599, then #16721). B
     * and D pin that `ObjectKernel.use()` REFUSES a `ui` plugin missing `slug`
     * or `staticPath`. Until #16721 this group pinned the OPPOSITE half:
     * `LiteKernel.use()` — which then never called `PluginSchema` — stored the
     * same two objects verbatim and the block ran against them, deriving a slug
     * from the package name (old F1: routes `/console`, `/console/*`) and
     * skipping the assetless plugin cleanly (old F2: `[]`, boot resolving).
     * Those two readings were what falsified #16599's "dead code" claim, and
     * they were ⛔ NOT fixture noise: they pinned the leniency itself. That is
     * why they could not be "fixed into passing" once the leniency went — the
     * step that measured the convergence's cost (#16721 step 1) found F0
     * passing and F1/F2 failing under the wiring, which is the signature of a
     * pin on the divergence rather than of a sloppy fixture.
     *
     * #16721 (maintainer ruling, option A, under #9864's precedent that the two
     * kernels converge) made `LiteKernel.use()` run the same
     * `assertPluginContract` the loader runs, so the subject of the old F1/F2
     * no longer exists on any published kernel. ⭐ REWRITTEN, not deleted, and
     * here is what each case now measures:
     *
     *   - F0 is UNCHANGED — the firing control. A fully declared `ui` plugin
     *     still mounts on this kernel, so F1/F2's refusals are caused by the
     *     contract and not by a harness that stopped mounting under
     *     `LiteKernel`. It also proves the convergence is on the SCHEMA: what
     *     the schema accepts, this kernel still accepts and the block still
     *     mounts, identically to pin B.
     *   - F1/F2 pin that the SAME input gets the SAME refusal from either
     *     kernel: the code, the key and the spec's
     *     `PLUGIN_UI_REQUIRED_KEY_MISSING` — and, sharper, that the
     *     `ObjectKernel` message is byte-for-byte the `LiteKernel` message
     *     behind the loader's existing `Failed to load plugin: <name> - `
     *     prefix. One statement, two kernels, one refusal.
     *
     * What this means for the two branches the old F1/F2 pinned as
     * load-bearing — `plugin.slug || plugin.name.split('/').pop()` and the
     * `&& plugin.staticPath` conjunct in `hono-plugin.ts`: neither is reachable
     * through either published kernel's `use()` any more. That is an
     * observation about `hono-plugin.ts`, recorded on #16721 and deliberately
     * not acted on here — this file pins the kernels' inputs, and whether the
     * block keeps its defensive spelling is that file's call, not this pin's.
     */
    describe('F — the same inputs on `LiteKernel`, refused since it runs the contract too (#16721)', () => {
        it('F0 — the firing control: a fully declared `ui` plugin mounts on this kernel too', async () => {
            const { routes } = await observe(
                makeFixture({ name: '@os-fixture/console', slug: 'console-fixture' }),
                bootLite,
            );

            // The calibration F1/F2 depend on, and the reason their refusals are
            // readings rather than a harness that never mounts under this kernel.
            // Identical to pin B's expectation, which is the point: the block
            // behaves the same on both kernels once the object gets through —
            // and, since #16721, the same objects get through on both.
            expect(routes).toEqual([
                '/console-fixture',
                '/console-fixture',
                '/console-fixture/*',
                '/console-fixture/*',
            ]);
        });

        it('F1 — with no `slug`, LiteKernel.use() refuses with the envelope ObjectKernel.use() gives the same input', async () => {
            const lite = await refusal(bootLite(makeFixture({ name: '@os-fixture/console' })));

            // The refusal pin B reads on the other kernel, now read here: the
            // object never reaches `kernel.plugins`, so the block never sees it
            // and the `||` derivation has nothing to run on.
            expect(lite.message).toContain('PLUGIN_CONTRACT_VIOLATION');
            expect(lite.message).toContain("at 'slug'");
            expect(lite.message).toContain('PLUGIN_UI_REQUIRED_KEY_MISSING');
            // `LiteKernel.use()` throws the error as-is, so the stable code is on
            // the PROPERTY here — the surface `ObjectKernel`'s re-wrap keeps only
            // at the head of the message.
            expect((lite as Error & { code?: string }).code).toBe('PLUGIN_CONTRACT_VIOLATION');

            // Parity, not resemblance: the same input through `boot` (pin B's
            // kernel) is the same text behind the loader's own load-failure prefix.
            const object = await refusal(boot(makeFixture({ name: '@os-fixture/console' })));
            expect(object.message).toBe(`Failed to load plugin: @os-fixture/console - ${lite.message}`);
        });

        it('F2 — with no `staticPath`, LiteKernel.use() refuses with the envelope ObjectKernel.use() gives the same input', async () => {
            const make = () => makeFixture({
                name: '@os-fixture/console-no-assets',
                slug: 'console-fixture',
                staticPath: undefined,
            });

            const lite = await refusal(bootLite(make()));

            // The refusal pin D reads on the other kernel. The `&& plugin.staticPath`
            // conjunct that used to keep this object off `mounts` is no longer what
            // stands between it and the `TypeError` further down `start()` — the
            // contract is, on both kernels, before `start()` can run at all.
            expect(lite.message).toContain('PLUGIN_CONTRACT_VIOLATION');
            expect(lite.message).toContain("at 'staticPath'");
            expect(lite.message).toContain('PLUGIN_UI_REQUIRED_KEY_MISSING');
            expect((lite as Error & { code?: string }).code).toBe('PLUGIN_CONTRACT_VIOLATION');

            const object = await refusal(boot(make()));
            expect(object.message).toBe(`Failed to load plugin: @os-fixture/console-no-assets - ${lite.message}`);
        });
    });
});
