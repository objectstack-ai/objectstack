// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectKernel } from './kernel';
import type { ObjectKernelConfig } from './kernel';
import type { Plugin } from './types';

/**
 * A boot that fails AFTER every plugin's `start()` has run — the readiness
 * check, or a `kernel:ready` / `kernel:bootstrapped` / `kernel:listening`
 * handler that throws — destroys the plugins that started, in reverse start
 * order, through the same rollback a failing `start()` runs.
 *
 * Before this file only the Phase 2 branch rolled back. A later failure fell
 * into the outer catch, which marks the kernel `stopped` for good; `shutdown()`
 * on a stopped kernel is a no-op, so no `destroy()` ever ran and a driver
 * connected in `start()` stayed connected. The composition that matters is the
 * one `DefaultDatasourcePlugin` is: one plugin connects in `start()` and
 * disconnects in `destroy()`, and a LATER plugin refuses the boot.
 *
 * The pins below split on purpose, so an ablation of the new rollback call
 * (delete it, rebuild, rerun) reads as a diagnosis and not as a wall of red:
 * the "tears down" pins go red; the "still the one contract" pins — the
 * Phase 2 control, `shutdown()` after the failure, the original rejection, a
 * disabled rollback — stay green, because each is a statement about what the
 * failed boot does NOT do twice, or at all.
 */

type BootHook = 'kernel:ready' | 'kernel:bootstrapped' | 'kernel:listening';

/**
 * Where the boot is refused. Three are handlers a plugin registers; the fourth
 * is the kernel's own readiness check, which runs after the last `start()` and
 * before the first hook and throws when the required `data` service is absent
 * (which `skipSystemValidation: false` makes it judge).
 */
interface RefusalSite {
    readonly site: string;
    readonly hook?: BootHook;
    readonly config: ObjectKernelConfig;
}

const HOOK_SITES: readonly RefusalSite[] = [
    { site: 'kernel:ready', hook: 'kernel:ready', config: {} },
    { site: 'kernel:bootstrapped', hook: 'kernel:bootstrapped', config: {} },
    { site: 'kernel:listening', hook: 'kernel:listening', config: {} },
];
const READINESS_SITE: RefusalSite = {
    site: 'the system requirement check',
    config: { skipSystemValidation: false },
};
const ALL_SITES: readonly RefusalSite[] = [...HOOK_SITES, READINESS_SITE];

function newKernel(extra: ObjectKernelConfig = {}): ObjectKernel {
    return new ObjectKernel({
        logger: { level: 'silent' },
        gracefulShutdown: false,
        skipSystemValidation: true,
        ...extra,
    });
}

/** The fake datasource driver: connected in `start()`, released in `destroy()`. */
interface FakeDriver {
    connected: boolean;
}

/**
 * Connects in `start()`, disconnects in `destroy()` — the shape of
 * `DefaultDatasourcePlugin`. Registered first, so it starts first and is
 * destroyed last.
 */
function driverHost(log: string[], driver: FakeDriver, onDestroy?: () => Promise<void>): Plugin {
    return {
        name: 'test.driver-host',
        version: '1.0.0',
        init: async () => {},
        start: async () => {
            log.push('connect');
            driver.connected = true;
        },
        destroy: async () => {
            log.push('disconnect');
            driver.connected = false;
            await onDestroy?.();
        },
    };
}

/**
 * The plugin that refuses the boot. It starts AFTER the driver host, so it is
 * a started plugin too — its own `destroy()` runs in the rollback, before the
 * driver's. `hook` is where it throws; without one it only records, and the
 * boot is refused by something else.
 */
function refuser(
    log: string[],
    hook: BootHook | undefined,
    boom: Error,
    onHook?: () => Promise<void>,
    destroy?: () => Promise<void>,
): Plugin {
    return {
        name: 'test.refuser',
        version: '1.0.0',
        dependencies: ['test.driver-host'],
        init: async (ctx) => {
            if (!hook) return;
            ctx.hook(hook, async () => {
                log.push(`refuser:${hook}`);
                await onHook?.();
                throw boom;
            });
        },
        start: async () => {
            log.push('refuser:start');
        },
        destroy:
            destroy
            ?? (async () => {
                log.push('refuser:destroy');
            }),
    };
}

/** What happened before the refusal: connect, the refuser's start, and its hook if it has one. */
function untilRefusal(site: RefusalSite): string[] {
    return ['connect', 'refuser:start', ...(site.hook ? [`refuser:${site.hook}`] : [])];
}

/** A booted-and-refused composition: the kernel, what it logged, the driver. */
async function refusedBoot(site: RefusalSite, boom = new Error(`refused at ${site.site}`)) {
    const log: string[] = [];
    const driver: FakeDriver = { connected: false };
    const kernel = newKernel(site.config);
    await kernel.use(driverHost(log, driver));
    await kernel.use(refuser(log, site.hook, boom));

    const rejection: unknown = await kernel.bootstrap().then(
        () => undefined,
        (e: unknown) => e,
    );
    return { kernel, log, driver, boom, rejection };
}

describe('ObjectKernel — a boot that fails after every plugin started rolls them back (#23644)', () => {
    describe('tears down', () => {
        it.each(ALL_SITES)(
            'a throw at $site destroys the plugins that started, in reverse start order, and disconnects the driver',
            async (site) => {
                const { log, driver, rejection } = await refusedBoot(site);

                expect(rejection).toBeInstanceOf(Error);
                // Connected in start(), released in destroy(): the pin the card is about.
                expect(driver.connected).toBe(false);
                // Each started plugin exactly once, the later-started one first. An exact
                // sequence, so a plugin destroyed twice reads as red, not as "was destroyed".
                expect(log).toEqual([...untilRefusal(site), 'refuser:destroy', 'disconnect']);
            },
        );

        it('a destroy() that throws during the rollback neither replaces the boot error nor stops the plugins started before it', async () => {
            const log: string[] = [];
            const driver: FakeDriver = { connected: false };
            const boom = new Error('refused at kernel:ready');
            const kernel = newKernel();
            await kernel.use(driverHost(log, driver));
            await kernel.use(
                refuser(log, 'kernel:ready', boom, undefined, async () => {
                    log.push('refuser:destroy');
                    throw new Error('refuser destroy failed');
                }),
            );

            const rejection = await kernel.bootstrap().then(
                () => undefined,
                (e: unknown) => e,
            );

            // The failed destroy is logged by the rollback, not surfaced: the caller still sees the boot error...
            expect(rejection).toBe(boom);
            // ...and the plugin started before the throwing one is still torn down.
            expect(log).toEqual(['connect', 'refuser:start', 'refuser:kernel:ready', 'refuser:destroy', 'disconnect']);
            expect(driver.connected).toBe(false);
        });

        it('the rollback runs with the kernel `stopping`, so a shutdown() issued from inside a destroy() is absorbed, not a second teardown', async () => {
            const log: string[] = [];
            const driver: FakeDriver = { connected: false };
            const statesSeenByDestroy: string[] = [];
            const kernel = newKernel();
            await kernel.use(
                driverHost(log, driver, async () => {
                    statesSeenByDestroy.push(kernel.getState());
                    await kernel.shutdown();
                }),
            );
            await kernel.use(refuser(log, 'kernel:ready', new Error('refused at kernel:ready')));

            await kernel.bootstrap().catch(() => undefined);

            expect(statesSeenByDestroy).toEqual(['stopping']);
            expect(log.filter((entry) => entry === 'disconnect')).toHaveLength(1);
            expect(kernel.getState()).toBe('stopped');
        });
    });

    describe('is still the one contract', () => {
        it('CONTROL: the Phase 2 rollback (a start() that throws) runs once per started plugin, not twice', async () => {
            const log: string[] = [];
            const driver: FakeDriver = { connected: false };
            const kernel = newKernel();
            await kernel.use(driverHost(log, driver));
            await kernel.use({
                name: 'test.middle',
                version: '1.0.0',
                dependencies: ['test.driver-host'],
                init: async () => {},
                start: async () => { log.push('middle:start'); },
                destroy: async () => { log.push('middle:destroy'); },
            });
            await kernel.use({
                name: 'test.starter-that-throws',
                version: '1.0.0',
                dependencies: ['test.middle'],
                init: async () => {},
                start: async () => {
                    log.push('thrower:start');
                    throw new Error('thrower exploded');
                },
                // Never started, so never rolled back — its destroy() must not run.
                destroy: async () => { log.push('thrower:destroy'); },
            });

            await expect(kernel.bootstrap()).rejects.toThrow('failed to start - rollback complete: thrower exploded');

            expect(log).toEqual(['connect', 'middle:start', 'thrower:start', 'middle:destroy', 'disconnect']);
            expect(driver.connected).toBe(false);
            expect(kernel.getState()).toBe('stopped');
        });

        it.each(ALL_SITES)('shutdown() after a failed boot at $site stays a no-op: no second destroy', async (site) => {
            const { kernel, log } = await refusedBoot(site);
            const before = [...log];

            await kernel.shutdown();

            expect(log).toEqual(before);
            expect(kernel.getState()).toBe('stopped');
        });

        it.each(HOOK_SITES)('the rejection at $site is the original boot error, not a wrapper', async (site) => {
            const { rejection, boom } = await refusedBoot(site);

            // Identity, not a message match: a rollback that rewrapped the error would still match a message.
            expect(rejection).toBe(boom);
        });

        it('the readiness check rejects with its own error', async () => {
            const { rejection } = await refusedBoot(READINESS_SITE);

            expect(rejection).toBeInstanceOf(Error);
            expect((rejection as Error).message).toContain('Missing critical services: data');
        });

        it.each(ALL_SITES)('rollbackOnFailure: false leaves the started plugins alone, as it does for a failing start(), at $site', async (site) => {
            const log: string[] = [];
            const driver: FakeDriver = { connected: false };
            const kernel = newKernel({ ...site.config, rollbackOnFailure: false });
            await kernel.use(driverHost(log, driver));
            await kernel.use(refuser(log, site.hook, new Error(`refused at ${site.site}`)));

            await expect(kernel.bootstrap()).rejects.toThrow();

            expect(log).toEqual(untilRefusal(site));
            expect(driver.connected).toBe(true);
            expect(kernel.getState()).toBe('stopped');
        });

        it('a shutdown() that began mid-boot owns the destroys: the failed boot does not destroy again', async () => {
            const log: string[] = [];
            const driver: FakeDriver = { connected: false };
            const boom = new Error('refused after a shutdown()');
            const kernel = newKernel();
            await kernel.use(driverHost(log, driver));
            await kernel.use(
                refuser(log, 'kernel:ready', boom, async () => {
                    // The host stops the kernel while the boot is still in a handler.
                    await kernel.shutdown();
                }),
            );

            const rejection = await kernel.bootstrap().then(
                () => undefined,
                (e: unknown) => e,
            );

            expect(rejection).toBe(boom);
            // shutdown() destroyed each plugin once; the failed boot added nothing.
            expect(log).toEqual(['connect', 'refuser:start', 'refuser:kernel:ready', 'refuser:destroy', 'disconnect']);
            expect(kernel.getState()).toBe('stopped');
        });

        it('a boot that fails in Phase 1 destroys nothing: no plugin has started', async () => {
            const log: string[] = [];
            const kernel = newKernel();
            await kernel.use({
                name: 'test.initialised-only',
                version: '1.0.0',
                init: async () => { log.push('first:init'); },
                start: async () => { log.push('first:start'); },
                destroy: async () => { log.push('first:destroy'); },
            });
            await kernel.use({
                name: 'test.init-thrower',
                version: '1.0.0',
                dependencies: ['test.initialised-only'],
                init: async () => {
                    log.push('thrower:init');
                    throw new Error('init refused');
                },
                destroy: async () => { log.push('thrower:destroy'); },
            });

            await expect(kernel.bootstrap()).rejects.toThrow('init refused');

            expect(log).toEqual(['first:init', 'thrower:init']);
            expect(kernel.getState()).toBe('stopped');
        });
    });
});
