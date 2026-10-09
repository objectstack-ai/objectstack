// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { ObjectKernel } from './kernel';
import type { ObjectKernelConfig } from './kernel';
import type { Plugin } from './types';

/**
 * `ObjectKernelConfig.bootPhaseHooks` — a kernel bootstrapped WITHOUT the three
 * boot-phase hooks, for a host that needs the registered definitions and the
 * started services and nothing the boot phase does (a repair kernel for an
 * environment whose normal boot cannot finish).
 *
 * Both halves of the option's docblock are pinned here, against one
 * composition:
 *
 *   - what it GUARANTEES: a definition a plugin registers in `init()` or
 *     `start()` is present, and the kernel is running;
 *   - what it does NOT: a definition a plugin registers in a `kernel:ready`
 *     handler is absent under the option and present without it. "No ready
 *     handler registers a definition" is a reading of one set of plugins,
 *     never a property of the option, so the absent half is a pin, not a
 *     footnote.
 *
 * The controls run the same composition with the option absent, `true` and
 * `undefined`: today's boot, unchanged.
 */

const BOOT_PHASE_HOOKS = ['kernel:ready', 'kernel:bootstrapped', 'kernel:listening'] as const;
type BootPhaseHook = (typeof BOOT_PHASE_HOOKS)[number];

/** The "definition registry" the composition's plugins write to. */
type Definitions = Map<string, { registeredIn: string }>;

const REGISTRY = 'test.definition-registry';

function newKernel(extra: ObjectKernelConfig = {}): ObjectKernel {
    return new ObjectKernel({
        logger: { level: 'error' },
        gracefulShutdown: false,
        skipSystemValidation: true,
        ...extra,
    });
}

/**
 * A registry plugin plus a declarer that registers one definition per place a
 * plugin can register one — `init()`, `start()`, a `kernel:ready` handler —
 * and a spy on each of the three boot-phase hooks.
 */
function composition() {
    const spies: Record<BootPhaseHook, Mock<() => void>> = {
        'kernel:ready': vi.fn<() => void>(),
        'kernel:bootstrapped': vi.fn<() => void>(),
        'kernel:listening': vi.fn<() => void>(),
    };
    const order: string[] = [];

    const registry: Plugin = {
        name: REGISTRY,
        version: '1.0.0',
        init: async (ctx) => {
            ctx.registerService('definitions', new Map() as Definitions);
        },
    };

    const declarer: Plugin = {
        name: 'test.declarer',
        version: '1.0.0',
        dependencies: [REGISTRY],
        init: async (ctx) => {
            const definitions = ctx.getService<Definitions>('definitions');
            definitions.set('obj_from_init', { registeredIn: 'init' });
            ctx.hook('kernel:ready', async () => {
                definitions.set('obj_from_ready', { registeredIn: 'kernel:ready' });
            });
            for (const hook of BOOT_PHASE_HOOKS) {
                ctx.hook(hook, async () => {
                    order.push(hook);
                    spies[hook]();
                });
            }
        },
        start: async (ctx) => {
            ctx.getService<Definitions>('definitions').set('obj_from_start', { registeredIn: 'start' });
        },
    };

    return { plugins: [registry, declarer], spies, order };
}

async function boot(kernel: ObjectKernel, plugins: Plugin[]): Promise<Definitions> {
    for (const plugin of plugins) await kernel.use(plugin);
    await kernel.bootstrap();
    return kernel.getService<Definitions>('definitions');
}

const spyOnLog = (k: ObjectKernel, level: 'warn' | 'info') =>
    vi.spyOn((k as unknown as { logger: Record<'warn' | 'info', (...a: unknown[]) => void> }).logger, level);

/** The `withheldHandlers` meta of every `warn` the withholding boot emitted. */
function withheldReports(warnSpy: ReturnType<typeof spyOnLog>): unknown[] {
    return warnSpy.mock.calls
        .map((call) => (call[1] as { withheldHandlers?: unknown } | undefined)?.withheldHandlers)
        .filter((meta) => meta !== undefined);
}

describe('ObjectKernel bootPhaseHooks', () => {
    const kernels: ObjectKernel[] = [];
    const track = (k: ObjectKernel) => { kernels.push(k); return k; };

    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            if (k.isRunning()) await k.shutdown();
        }
        vi.restoreAllMocks();
    });

    describe('bootPhaseHooks: false', () => {
        it('keeps every definition registered in init() and start(), and the kernel runs', async () => {
            const { plugins } = composition();
            const kernel = track(newKernel({ bootPhaseHooks: false }));

            const definitions = await boot(kernel, plugins);

            expect(definitions.get('obj_from_init')).toEqual({ registeredIn: 'init' });
            expect(definitions.get('obj_from_start')).toEqual({ registeredIn: 'start' });
            expect(kernel.isRunning()).toBe(true);
            expect(kernel.getState()).toBe('running');
        });

        it('leaves a definition registered in a kernel:ready handler absent', async () => {
            const { plugins } = composition();
            const kernel = track(newKernel({ bootPhaseHooks: false }));

            const definitions = await boot(kernel, plugins);

            expect(definitions.has('obj_from_ready')).toBe(false);
            expect([...definitions.keys()].sort()).toEqual(['obj_from_init', 'obj_from_start']);
        });

        it('dispatches none of kernel:ready, kernel:bootstrapped, kernel:listening', async () => {
            const { plugins, spies, order } = composition();
            const kernel = track(newKernel({ bootPhaseHooks: false }));

            await boot(kernel, plugins);

            for (const hook of BOOT_PHASE_HOOKS) {
                expect(spies[hook], hook).not.toHaveBeenCalled();
            }
            expect(order).toEqual([]);
        });

        // The case the option exists for: a boot-phase handler that throws, or
        // never settles, no longer decides whether the definitions are reachable.
        it('completes the boot when a kernel:ready handler would throw or never settle', async () => {
            const kernel = track(newKernel({ bootPhaseHooks: false }));
            const stuck: Plugin = {
                name: 'test.stuck-boot-phase',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:ready', async () => { throw new Error('seed heal failed'); });
                    ctx.hook('kernel:bootstrapped', () => new Promise<void>(() => { /* never settles */ }));
                },
            };

            await kernel.use(stuck);
            await expect(kernel.bootstrap()).resolves.toBeUndefined();
            expect(kernel.getState()).toBe('running');
        });

        it('reports the withheld handlers once, per hook', async () => {
            const { plugins } = composition();
            const kernel = track(newKernel({ bootPhaseHooks: false }));
            const warnSpy = spyOnLog(kernel, 'warn');

            await boot(kernel, plugins);

            // The declarer registers two kernel:ready handlers (the definition
            // and the spy) and one each on the other two.
            expect(withheldReports(warnSpy)).toEqual([
                { 'kernel:ready': 2, 'kernel:bootstrapped': 1, 'kernel:listening': 1 },
            ]);
        });

        it('shuts down cleanly: kernel:shutdown, destroy() and onShutdown run, nothing waits on a withheld hook', async () => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
            const { plugins, spies } = composition();
            const reached: string[] = [];
            const teardown: Plugin = {
                name: 'test.teardown',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:shutdown', async () => { reached.push('kernel:shutdown'); });
                },
                destroy: async () => { reached.push('destroy'); },
            };
            // A short guard: a teardown that waited on something a withheld
            // hook would have resolved trips it and calls process.exit(1).
            const kernel = newKernel({ bootPhaseHooks: false, shutdownTimeout: 2_000 });
            kernel.onShutdown(async () => { reached.push('onShutdown'); });

            await boot(kernel, [...plugins, teardown]);
            await kernel.shutdown();

            expect(reached).toEqual(['kernel:shutdown', 'destroy', 'onShutdown']);
            expect(kernel.getState()).toBe('stopped');
            expect(exitSpy).not.toHaveBeenCalled();
            for (const hook of BOOT_PHASE_HOOKS) {
                expect(spies[hook], hook).not.toHaveBeenCalled();
            }
        });
    });

    // Controls: the same composition on today's boot. Only an explicit `false`
    // withholds; an absent option and an explicit `undefined` (a host
    // forwarding an unset value) are the default.
    describe.each([
        ['absent', {}],
        ['true', { bootPhaseHooks: true }],
        ['undefined', { bootPhaseHooks: undefined }],
    ] as Array<[string, ObjectKernelConfig]>)('bootPhaseHooks %s (control)', (_label, extra) => {
        it('fires all three hooks in order and keeps every definition, the kernel:ready one included', async () => {
            const { plugins, spies, order } = composition();
            const kernel = track(newKernel(extra));
            const warnSpy = spyOnLog(kernel, 'warn');

            const definitions = await boot(kernel, plugins);

            expect(order).toEqual([...BOOT_PHASE_HOOKS]);
            for (const hook of BOOT_PHASE_HOOKS) {
                expect(spies[hook], hook).toHaveBeenCalledTimes(1);
            }
            expect([...definitions.keys()].sort()).toEqual(['obj_from_init', 'obj_from_ready', 'obj_from_start']);
            expect(withheldReports(warnSpy)).toEqual([]);
            expect(kernel.isRunning()).toBe(true);
        });
    });
});
