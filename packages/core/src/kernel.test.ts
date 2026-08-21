import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel } from './kernel';
import { ServiceLifecycle, PluginMetadata } from './plugin-loader';
import type { Plugin, PluginContext } from './types';

describe('ObjectKernel', () => {
    let kernel: ObjectKernel;

    beforeEach(() => {
        kernel = new ObjectKernel({
            logger: { level: 'error' }, // Suppress logs in tests
            gracefulShutdown: false, // Disable for tests
            skipSystemValidation: true,
        });
    });

    describe('Plugin Registration and Loading', () => {
        it('should register a plugin with version', async () => {
            const plugin: Plugin = {
                name: 'versioned-plugin',
                version: '1.2.3',
                init: async () => {},
            };

            await kernel.use(plugin);
            await kernel.bootstrap();

            expect(kernel.isRunning()).toBe(true);

            await kernel.shutdown();
        });

        it('should validate plugin during registration', async () => {
            const invalidPlugin: any = {
                name: '',
                init: async () => {},
            };

            await expect(async () => {
                await kernel.use(invalidPlugin);
            }).rejects.toThrow();
        });

        it('should reject plugin registration after bootstrap', async () => {
            await kernel.bootstrap();

            const plugin: Plugin = {
                name: 'late-plugin',
                init: async () => {},
            };

            await expect(async () => {
                await kernel.use(plugin);
            }).rejects.toThrow('Cannot register plugins after bootstrap');

            await kernel.shutdown();
        });
    });

    describe('Service Factory Registration', () => {
        it('should register singleton service factory', async () => {
            let callCount = 0;
            
            kernel.registerServiceFactory(
                'counter',
                () => {
                    callCount++;
                    return { count: callCount };
                },
                ServiceLifecycle.SINGLETON
            );

            await kernel.bootstrap();

            const service1 = await kernel.getServiceAsync('counter');
            const service2 = await kernel.getServiceAsync('counter');

            expect(callCount).toBe(1);
            expect(service1).toBe(service2);

            await kernel.shutdown();
        });

        it('should register transient service factory', async () => {
            let callCount = 0;
            
            kernel.registerServiceFactory(
                'transient',
                () => {
                    callCount++;
                    return { count: callCount };
                },
                ServiceLifecycle.TRANSIENT
            );

            await kernel.bootstrap();

            const service1 = await kernel.getServiceAsync('transient');
            const service2 = await kernel.getServiceAsync('transient');

            expect(callCount).toBe(2);
            expect(service1).not.toBe(service2);

            await kernel.shutdown();
        });

        it('should register scoped service factory', async () => {
            let callCount = 0;
            
            kernel.registerServiceFactory(
                'scoped',
                () => {
                    callCount++;
                    return { count: callCount };
                },
                ServiceLifecycle.SCOPED
            );

            await kernel.bootstrap();

            const service1 = await kernel.getServiceAsync('scoped', 'request-1');
            const service2 = await kernel.getServiceAsync('scoped', 'request-1');
            const service3 = await kernel.getServiceAsync('scoped', 'request-2');

            expect(callCount).toBe(2); // Once per scope
            expect(service1).toBe(service2); // Same within scope
            expect(service1).not.toBe(service3); // Different across scopes

            await kernel.shutdown();
        });
    });

    // #4085 — `ctx.getService()` has to name the fault it actually hit. Both
    // cases below land in the same branch (neither sync map has the name), and
    // reading the answer off `pluginLoader.getService()` — an `async` method,
    // so ALWAYS a Promise — reported both as "is async - use await". That sent
    // every ordering bug ("this plugin ran before the one that registers the
    // service") looking for an await that does not exist: the crash that kept
    // `os serve` from booting without a compiled artifact read as a kernel
    // fault, and the real cause (plugin order) was invisible.
    describe('Service resolution diagnostics', () => {
        it('reports a never-registered service as not found', async () => {
            expect(() => kernel.getService('nothing-registered-this-name'))
                .toThrow("[Kernel] Service 'nothing-registered-this-name' not found");
        });

        it('reports a registered-but-uninstantiated factory as async', async () => {
            kernel.registerServiceFactory(
                'lazy-thing',
                () => ({ ok: true }),
                ServiceLifecycle.SINGLETON,
            );

            // Sync accessor cannot run an async factory — the caller needs
            // `getServiceAsync`, and the message has to say so.
            expect(() => kernel.getService('lazy-thing'))
                .toThrow("Service 'lazy-thing' is async - use await");

            // …and the async accessor resolves it, after which the sync
            // accessor finds the cached instance.
            await expect(kernel.getServiceAsync('lazy-thing')).resolves.toEqual({ ok: true });
            expect(kernel.getService('lazy-thing')).toEqual({ ok: true });
        });

        it('does not mask a factory that throws as a missing service', async () => {
            kernel.registerServiceFactory(
                'exploding',
                () => { throw new Error('driver connect failed'); },
                ServiceLifecycle.SINGLETON,
            );

            await expect(kernel.getServiceAsync('exploding')).rejects.toThrow('driver connect failed');
        });
    });

    describe('Plugin Lifecycle with Timeout', () => {
        it('should timeout plugin init if it takes too long', async () => {
            const plugin: PluginMetadata = {
                name: 'slow-init',
                version: '1.0.0',
                init: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
                },
                startupTimeout: 100, // 100ms timeout
            };

            await kernel.use(plugin);

            await expect(async () => {
                await kernel.bootstrap();
            }).rejects.toThrow('timeout');
        }, 1000); // Test should complete in 1 second

        it('should timeout plugin start if it takes too long', async () => {
            const plugin: PluginMetadata = {
                name: 'slow-start',
                version: '1.0.0',
                init: async () => {},
                start: async () => {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
                },
                startupTimeout: 100, // 100ms timeout
            };

            await kernel.use(plugin);

            await expect(async () => {
                await kernel.bootstrap();
            }).rejects.toThrow();
        }, 1000); // Test should complete in 1 second

        it('should complete plugin startup within timeout', async () => {
            const plugin: PluginMetadata = {
                name: 'fast-plugin',
                version: '1.0.0',
                init: async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                },
                start: async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                },
                startupTimeout: 1000,
            };

            await kernel.use(plugin);
            await kernel.bootstrap();

            expect(kernel.isRunning()).toBe(true);

            await kernel.shutdown();
        });
    });

    // #4813 — the guard timer must not outlive the race it guards.
    //
    // These tests are about the *process*, not about the source: asserting
    // "kernel.ts calls clearTimeout" would be a tautology that any refactor
    // could satisfy while still pinning the event loop. What is asserted here
    // is the observable consequence — after the work is done, nothing the
    // guards armed is still holding the loop open.
    describe('Startup timeout guards do not outlive the race (#4813)', () => {
        /**
         * Ref'd `Timeout` handles — `getActiveResourcesInfo()` reports only
         * resources that are *currently keeping the event loop alive*, which
         * is precisely the property that made `os migrate` hang ~120s after
         * printing `✅ Graceful shutdown complete`.
         */
        const refdTimers = () =>
            process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

        it('leaves no ref\'d timer behind after the plugin wins the race', async () => {
            const plugin: PluginMetadata = {
                name: 'fast-plugin-long-guard',
                version: '1.0.0',
                init: async () => {},
                start: async () => {},
                // The real value that hung one-shot CLI processes: ObjectQLPlugin.
                startupTimeout: 120_000,
            };

            await kernel.use(plugin);

            const before = refdTimers();
            await kernel.bootstrap();
            const after = refdTimers();

            // Two guards were armed (init + start) and both lost their race.
            // While either is still ref'd the process cannot exit for up to
            // `startupTimeout` — 120s of idling after a 3s job.
            expect(after).toBe(before);

            await kernel.shutdown();
        });

        it('reclaims one guard per lifecycle hook, for every plugin', async () => {
            const makePlugin = (n: number): PluginMetadata => ({
                name: `guarded-plugin-${n}`,
                version: '1.0.0',
                init: async () => {},
                start: async () => {},
                startupTimeout: 120_000,
            });

            for (let n = 0; n < 4; n++) {
                await kernel.use(makePlugin(n));
            }

            const before = refdTimers();
            await kernel.bootstrap();

            // The issue's probe caught exactly this shape: 8 ref'd Timeouts
            // for 4 plugins (4 init + 4 start). The count must not scale with
            // the plugin list — it must not grow at all.
            expect(refdTimers()).toBe(before);

            await kernel.shutdown();
        });

        it('still fires the guard when the plugin loses the race', async () => {
            // The companion assertion to the two above: reclaiming the guard
            // must not disarm it. `unref()` would satisfy "no ref'd timer" by
            // detaching the guard from the loop — and a process with nothing
            // else to run then exits *silently* instead of reporting the
            // timeout. Clearing on settle keeps the guard armed exactly while
            // the race is undecided.
            const plugin: PluginMetadata = {
                name: 'hanging-plugin',
                version: '1.0.0',
                init: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                },
                startupTimeout: 50,
            };

            await kernel.use(plugin);

            await expect(kernel.bootstrap()).rejects.toThrow(
                'Plugin hanging-plugin init timeout after 50ms'
            );
        }, 1000);
    });

    describe('Startup timeout guards under fake timers (#4813)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('schedules no pending timer once bootstrap has settled', async () => {
            const kernelWithFakeTimers = new ObjectKernel({
                logger: { level: 'error' },
                gracefulShutdown: false,
                skipSystemValidation: true,
            });

            const plugin: PluginMetadata = {
                name: 'fake-timer-plugin',
                version: '1.0.0',
                init: async () => {},
                start: async () => {},
                startupTimeout: 120_000,
            };

            await kernelWithFakeTimers.use(plugin);

            const before = vi.getTimerCount();
            await kernelWithFakeTimers.bootstrap();

            // Unlike `getActiveResourcesInfo()`, the fake-timer count includes
            // unref'd timers — so this one distinguishes "the guard was
            // reclaimed" from "the guard was merely detached from the loop".
            expect(vi.getTimerCount()).toBe(before);

            await kernelWithFakeTimers.shutdown();
        });
    });

    describe('The shutdown guard is reclaimed on the same terms (#10604)', () => {
        // The startup site cleared its timer and never unref'd; this one
        // unref'd and never cleared. Two hand-rolled copies of one race, each
        // doing the opposite half, and neither settling the promise the race
        // still held a reaction on — four leaking promises per showcase run.
        // Both sites now go through `TimeoutGuard`, so this pins the wiring.
        //
        // The companion assertion — that reclaiming the guard did not DISARM
        // it — is 'still logs the timeout and still forces exit(1) when
        // shutdown genuinely times out (#5274)' below, which hangs teardown
        // past `shutdownTimeout` and is unchanged by this fix.

        it('leaves no timer armed once shutdown has settled', async () => {
            vi.useFakeTimers();
            try {
                const k = new ObjectKernel({
                    logger: { level: 'error' },
                    gracefulShutdown: false,
                    skipSystemValidation: true,
                    shutdownTimeout: 60_000,
                });

                await k.use({
                    name: 'reclaimed-shutdown-guard',
                    version: '1.0.0',
                    init: async () => {},
                    start: async () => {},
                    destroy: async () => {},
                } as PluginMetadata);

                const before = vi.getTimerCount();
                await k.bootstrap();
                await k.shutdown();

                // Before the fix this was `before + 1`: `performShutdown()` won
                // the race and the 60s guard stayed armed, to fire later against
                // a kernel already 'stopped'. `unref()` hid it from the event
                // loop but not from here — which is the distinction this
                // assertion exists to keep.
                expect(vi.getTimerCount()).toBe(before);
            } finally {
                vi.useRealTimers();
            }
        });

    });


    describe('Startup Failure Rollback', () => {
        it('should rollback started plugins on failure', async () => {
            let plugin1Destroyed = false;

            const plugin1: Plugin = {
                name: 'plugin-1',
                version: '1.0.0',
                init: async () => {},
                start: async () => {},
                destroy: async () => {
                    plugin1Destroyed = true;
                },
            };

            const plugin2: Plugin = {
                name: 'plugin-2',
                version: '1.0.0',
                init: async () => {},
                start: async () => {
                    throw new Error('Startup failed');
                },
            };

            await kernel.use(plugin1);
            await kernel.use(plugin2);

            await expect(async () => {
                await kernel.bootstrap();
            }).rejects.toThrow('failed to start');

            // Plugin 1 should be rolled back
            expect(plugin1Destroyed).toBe(true);
        });

        it('should not rollback if disabled', async () => {
            const noRollbackKernel = new ObjectKernel({
                logger: { level: 'error' },
                rollbackOnFailure: false,
                gracefulShutdown: false,
                skipSystemValidation: true,
            });

            let plugin1Destroyed = false;

            const plugin1: Plugin = {
                name: 'plugin-1',
                version: '1.0.0',
                init: async () => {},
                start: async () => {},
                destroy: async () => {
                    plugin1Destroyed = true;
                },
            };

            const plugin2: Plugin = {
                name: 'plugin-2',
                version: '1.0.0',
                init: async () => {},
                start: async () => {
                    throw new Error('Startup failed');
                },
            };

            await noRollbackKernel.use(plugin1);
            await noRollbackKernel.use(plugin2);

            // Should not throw since rollback is disabled
            await noRollbackKernel.bootstrap();

            // Plugin 1 should NOT be destroyed
            expect(plugin1Destroyed).toBe(false);
        });
    });

    describe('Plugin Health Checks', () => {
        it('should check individual plugin health', async () => {
            const plugin: Plugin = {
                name: 'healthy-plugin',
                version: '1.0.0',
                init: async () => {},
            };

            await kernel.use(plugin);
            await kernel.bootstrap();

            const health = await kernel.checkPluginHealth('healthy-plugin');

            expect(health.healthy).toBe(true);
            expect(health.lastCheck).toBeInstanceOf(Date);

            await kernel.shutdown();
        });

        it('should check all plugins health', async () => {
            const plugin1: Plugin = {
                name: 'plugin-1',
                version: '1.0.0',
                init: async () => {},
            };

            const plugin2: Plugin = {
                name: 'plugin-2',
                version: '1.0.0',
                init: async () => {},
            };

            await kernel.use(plugin1);
            await kernel.use(plugin2);
            await kernel.bootstrap();

            const allHealth = await kernel.checkAllPluginsHealth();

            expect(allHealth.size).toBe(2);
            expect(allHealth.get('plugin-1').healthy).toBe(true);
            expect(allHealth.get('plugin-2').healthy).toBe(true);

            await kernel.shutdown();
        });
    });

    describe('Plugin Metrics', () => {
        it('should track plugin startup times', async () => {
            const plugin1: Plugin = {
                name: 'plugin-1',
                version: '1.0.0',
                init: async () => {},
                start: async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                },
            };

            const plugin2: Plugin = {
                name: 'plugin-2',
                version: '1.0.0',
                init: async () => {},
                start: async () => {
                    await new Promise(resolve => setTimeout(resolve, 30));
                },
            };

            await kernel.use(plugin1);
            await kernel.use(plugin2);
            await kernel.bootstrap();

            const metrics = kernel.getPluginMetrics();

            expect(metrics.size).toBe(2);
            expect(metrics.get('plugin-1')).toBeGreaterThan(0);
            expect(metrics.get('plugin-2')).toBeGreaterThan(0);

            await kernel.shutdown();
        });

        it('should not track metrics for plugins without start', async () => {
            const plugin: Plugin = {
                name: 'no-start',
                version: '1.0.0',
                init: async () => {},
            };

            await kernel.use(plugin);
            await kernel.bootstrap();

            const metrics = kernel.getPluginMetrics();

            expect(metrics.has('no-start')).toBe(false);

            await kernel.shutdown();
        });
    });

    describe('Graceful Shutdown', () => {
        it('should call destroy on all plugins', async () => {
            let plugin1Destroyed = false;
            let plugin2Destroyed = false;

            const plugin1: Plugin = {
                name: 'plugin-1',
                version: '1.0.0',
                init: async () => {},
                destroy: async () => {
                    plugin1Destroyed = true;
                },
            };

            const plugin2: Plugin = {
                name: 'plugin-2',
                version: '1.0.0',
                init: async () => {},
                destroy: async () => {
                    plugin2Destroyed = true;
                },
            };

            await kernel.use(plugin1);
            await kernel.use(plugin2);
            await kernel.bootstrap();
            await kernel.shutdown();

            expect(plugin1Destroyed).toBe(true);
            expect(plugin2Destroyed).toBe(true);
        });

        it('should handle plugin destroy errors gracefully', async () => {
            const plugin1: Plugin = {
                name: 'error-destroy',
                version: '1.0.0',
                init: async () => {},
                destroy: async () => {
                    throw new Error('Destroy failed');
                },
            };

            const plugin2: Plugin = {
                name: 'normal-plugin',
                version: '1.0.0',
                init: async () => {},
            };

            await kernel.use(plugin1);
            await kernel.use(plugin2);
            await kernel.bootstrap();

            // Should not throw even if one plugin fails to destroy
            await kernel.shutdown();

            expect(kernel.getState()).toBe('stopped');
        });

        it('fires kernel:ready → kernel:bootstrapped → kernel:listening in order', async () => {
            const order: string[] = [];
            const plugin: Plugin = {
                name: 'lifecycle-order-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:listening', async () => { order.push('kernel:listening'); });
                    ctx.hook('kernel:bootstrapped', async () => { order.push('kernel:bootstrapped'); });
                    ctx.hook('kernel:ready', async () => { order.push('kernel:ready'); });
                },
            };

            await kernel.use(plugin);
            await kernel.bootstrap();

            expect(order).toEqual(['kernel:ready', 'kernel:bootstrapped', 'kernel:listening']);
        });

        // #5170 — the ObjectKernel HALF of the cross-kernel pin. `kernel:ready`
        // is where plugins assert that what they declared is actually
        // deliverable, so a throw there must fail the boot. LiteKernel has the
        // twin of this test (lite-kernel.test.ts); the pair is what keeps one
        // hook name from meaning two opposite things again.
        it('fails the boot when a kernel:ready handler throws (#5170)', async () => {
            const reached: string[] = [];
            const plugin: Plugin = {
                name: 'ready-thrower-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:ready', async () => {
                        throw new Error('declared a durable queue, got none');
                    });
                    ctx.hook('kernel:ready', async () => { reached.push('later-ready'); });
                    ctx.hook('kernel:bootstrapped', async () => { reached.push('kernel:bootstrapped'); });
                    ctx.hook('kernel:listening', async () => { reached.push('kernel:listening'); });
                },
            };

            await kernel.use(plugin);

            // The ORIGINAL error surfaces — not a wrapped "bootstrap failed".
            await expect(kernel.bootstrap()).rejects.toThrow('declared a durable queue, got none');

            // Boot stopped AT the failing handler: no later ready handler, and
            // neither of the anchors that promise "every ready handler settled".
            expect(reached).toEqual([]);
            expect(kernel.getState()).toBe('stopped');
        });

        // #5257 — the ObjectKernel HALVES of the two pins this issue adds.
        // ObjectKernel already behaved this way (`context.trigger` never
        // catches); the tests exist so the pair is symmetric with
        // lite-kernel.test.ts and a regression on EITHER kernel is caught by a
        // named test rather than inferred from the other one still passing.
        // That symmetry is the whole point: the bug #5170 and #5257 closed was
        // one hook name meaning two opposite things depending on the kernel,
        // and only a matched pair of tests can hold that shut.
        it('fails the boot when a kernel:bootstrapped handler throws (#5257)', async () => {
            const reached: string[] = [];
            const plugin: Plugin = {
                name: 'bootstrapped-thrower-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:bootstrapped', async () => {
                        throw new Error('node-type audit could not seal the vocabulary');
                    });
                    ctx.hook('kernel:bootstrapped', async () => { reached.push('later-bootstrapped'); });
                    ctx.hook('kernel:listening', async () => { reached.push('kernel:listening'); });
                },
            };

            await kernel.use(plugin);

            await expect(kernel.bootstrap()).rejects.toThrow('node-type audit could not seal the vocabulary');

            expect(reached).toEqual([]);
            expect(kernel.getState()).toBe('stopped');
        });

        // The headline case of #5257, from the kernel that always got it
        // right: `HonoServerPlugin` awaits `server.listen(port)` inside a
        // `kernel:listening` handler with no try/catch of its own, so a listen
        // that rejects must fail the boot rather than resolve into a process
        // announcing "✅ Bootstrap complete" with nothing listening.
        it('fails the boot — and never logs "Bootstrap complete" — when a kernel:listening handler throws (#5257)', async () => {
            const reached: string[] = [];
            const plugin: Plugin = {
                name: 'listening-thrower-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:listening', async () => {
                        throw new Error('listen EACCES: permission denied 0.0.0.0:80');
                    });
                    ctx.hook('kernel:listening', async () => { reached.push('later-listening'); });
                },
            };

            await kernel.use(plugin);
            const infoSpy = vi.spyOn((kernel as unknown as { logger: { info: (...a: unknown[]) => void } }).logger, 'info');

            await expect(kernel.bootstrap()).rejects.toThrow('listen EACCES: permission denied 0.0.0.0:80');

            expect(reached).toEqual([]);
            expect(kernel.getState()).toBe('stopped');
            const logged = infoSpy.mock.calls.map((c) => String(c[0]));
            expect(logged.some((m) => m.includes('Bootstrap complete'))).toBe(false);
            infoSpy.mockRestore();
        });

        it('should trigger shutdown hook', async () => {
            let hookCalled = false;

            const plugin: Plugin = {
                name: 'hook-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:shutdown', async () => {
                        hookCalled = true;
                    });
                },
            };

            await kernel.use(plugin);
            await kernel.bootstrap();
            await kernel.shutdown();

            expect(hookCalled).toBe(true);
        });

        it('should execute custom shutdown handlers', async () => {
            let handlerCalled = false;

            kernel.onShutdown(async () => {
                handlerCalled = true;
            });

            await kernel.bootstrap();
            await kernel.shutdown();

            expect(handlerCalled).toBe(true);
        });

        // #5274. `process.exit` is intercepted in all three tests below — the
        // behaviour under test is precisely whether the kernel kills the host
        // process, and an unintercepted `exit(1)` takes the vitest worker with
        // it (which is why this pin could not land in #5257).
        const spyOnExit = () =>
            vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

        const spyOnLog = (k: ObjectKernel, level: 'error' | 'info') =>
            vi.spyOn(
                (k as unknown as { logger: Record<'error' | 'info', (...a: unknown[]) => void> }).logger,
                level,
            );

        // The issue's reproduction, inverted into a pin. Before this, the first
        // throwing `kernel:shutdown` handler ended the entire teardown: the
        // probe recorded `reached=["process.exit(1)"]` — neither the second
        // handler nor the plugin's destroy() ever ran. What is queued behind a
        // failing shutdown handler is the rest of the cleanup (flush buffers,
        // close connections, release locks), so one bad handler must not
        // amplify into leaks and unflushed writes.
        it('runs the remaining kernel:shutdown handlers, every destroy() and every onShutdown handler when one handler throws (#5274)', async () => {
            const reached: string[] = [];
            const exitSpy = spyOnExit();

            const plugin: Plugin = {
                name: 'shutdown-thrower',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:shutdown', async () => {
                        throw new Error('shutdown boom');
                    });
                    ctx.hook('kernel:shutdown', async () => { reached.push('later-shutdown'); });
                },
                destroy: async () => { reached.push('plugin-destroy'); },
            };

            try {
                await kernel.use(plugin);
                kernel.onShutdown(async () => { reached.push('shutdown-handler'); });
                await kernel.bootstrap();
                await kernel.shutdown();

                // Every teardown step behind the failing handler still ran, in
                // order: remaining subscribers → reverse-order destroy() →
                // custom shutdown handlers.
                expect(reached).toEqual(['later-shutdown', 'plugin-destroy', 'shutdown-handler']);
                // …and the host process was left alone.
                expect(exitSpy).not.toHaveBeenCalled();
                expect(kernel.getState()).toBe('stopped');
            } finally {
                exitSpy.mockRestore();
            }
        });

        // The second half of the same defect, pinned separately because it can
        // regress on its own: the outer catch was written only for the timeout
        // race, so a handler throw was reported as `Shutdown timed out —
        // forcing exit` when nothing had timed out — sending whoever read that
        // line straight to the `shutdownTimeout` config.
        it('names the failing handler and never reports a timeout that did not happen (#5274)', async () => {
            const exitSpy = spyOnExit();
            const errorSpy = spyOnLog(kernel, 'error');
            const infoSpy = spyOnLog(kernel, 'info');

            const plugin: Plugin = {
                name: 'shutdown-thrower-logs',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.hook('kernel:shutdown', async () => {
                        throw new Error('shutdown boom');
                    });
                },
            };

            try {
                await kernel.use(plugin);
                await kernel.bootstrap();
                await kernel.shutdown();

                const errors = errorSpy.mock.calls.map((c) => String(c[0]));
                // The failure is reported where it happened, naming the hook —
                // same line LiteKernel's isolating dispatcher logs.
                expect(errors).toContain('Hook handler failed: kernel:shutdown');
                // …and NOT as a timeout.
                expect(errors.some((m) => m.includes('Shutdown timed out'))).toBe(false);
                expect(exitSpy).not.toHaveBeenCalled();

                // Teardown really did complete, so it says so.
                const infos = infoSpy.mock.calls.map((c) => String(c[0]));
                expect(infos.some((m) => m.includes('Graceful shutdown complete'))).toBe(true);
            } finally {
                exitSpy.mockRestore();
                errorSpy.mockRestore();
                infoSpy.mockRestore();
            }
        });

        // The other side of the discrimination, and the reason it is drawn by
        // identity on the timer's own rejection: a GENUINE timeout keeps the
        // hard exit. `performShutdown()` is still running and has stopped
        // making progress, so the process would hang holding whatever it failed
        // to release. This behaviour is unchanged by #5274 — pinned so the
        // narrowing of the catch cannot quietly take it along.
        it('still logs the timeout and still forces exit(1) when shutdown genuinely times out (#5274)', async () => {
            const slowKernel = new ObjectKernel({
                logger: { level: 'error' },
                gracefulShutdown: false,
                skipSystemValidation: true,
                shutdownTimeout: 20,
            });

            const exitSpy = spyOnExit();
            const errorSpy = spyOnLog(slowKernel, 'error');

            const plugin: Plugin = {
                name: 'hanging-shutdown-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    // Never settles — the actual shape of a hung teardown.
                    // Deliberately left pending: resolving it later would let
                    // the teardown resume after the test had finished.
                    ctx.hook('kernel:shutdown', () => new Promise<void>(() => {}));
                },
            };

            try {
                await slowKernel.use(plugin);
                await slowKernel.bootstrap();
                await slowKernel.shutdown();

                const errors = errorSpy.mock.calls.map((c) => String(c[0]));
                expect(errors).toContain('Shutdown timed out — forcing exit');
                expect(exitSpy).toHaveBeenCalledWith(1);
                expect(slowKernel.getState()).toBe('stopped');
            } finally {
                exitSpy.mockRestore();
                errorSpy.mockRestore();
            }
        }, 5000);

        // #5282, the ObjectKernel half. `kernel:shutdown` has TWO dispatch
        // paths with different flavours, and this pins the difference AS IT IS
        // — the ruling that shared the dispatch loops (option B) explicitly did
        // NOT flip either path:
        //
        //   - the kernel's own teardown dispatch (`performShutdown`) isolates:
        //     a throwing handler is logged and everything queued behind it
        //     still runs (#5274);
        //   - a plugin calling `ctx.trigger('kernel:shutdown')` by hand goes
        //     through `PluginContext.trigger`, which propagates — the throw
        //     reaches that caller and the handlers behind it are skipped.
        //
        // Nothing in the repo triggers `kernel:shutdown` by hand today, so this
        // is DORMANT, not a live defect. It is pinned so that if someone does
        // reach for the manual trigger, the difference is a documented fact
        // with a test naming it rather than a surprise found at teardown.
        it('dispatches kernel:shutdown two ways: ctx.trigger propagates, the kernel teardown isolates (#5282)', async () => {
            const exitSpy = spyOnExit();
            const errorSpy = spyOnLog(kernel, 'error');
            const reached: string[] = [];
            let captured!: PluginContext;

            const plugin: Plugin = {
                name: 'dual-path-shutdown',
                version: '1.0.0',
                init: async (ctx: PluginContext) => {
                    captured = ctx;
                    ctx.hook('kernel:shutdown', async () => { throw new Error('manual boom'); });
                    ctx.hook('kernel:shutdown', async () => { reached.push('later-shutdown'); });
                },
            };

            try {
                await kernel.use(plugin);
                await kernel.bootstrap();

                // Path 1 — manual trigger: PROPAGATING. The error reaches the
                // caller unwrapped and the second handler never runs.
                await expect(captured.trigger('kernel:shutdown')).rejects.toThrow('manual boom');
                expect(reached).toEqual([]);
                // …and this path logs nothing itself: reporting a propagated
                // failure is the caller's job.
                expect(errorSpy.mock.calls.map((c) => String(c[0]))).not.toContain(
                    'Hook handler failed: kernel:shutdown',
                );

                // Path 2 — the kernel's own teardown: ISOLATING. Same handlers,
                // same hook name, opposite treatment of the same throw.
                await kernel.shutdown();
                expect(reached).toEqual(['later-shutdown']);
                expect(errorSpy.mock.calls.map((c) => String(c[0]))).toContain(
                    'Hook handler failed: kernel:shutdown',
                );
                expect(exitSpy).not.toHaveBeenCalled();
            } finally {
                exitSpy.mockRestore();
                errorSpy.mockRestore();
            }
        });
    });

    describe('Dependency Resolution', () => {
        it('should resolve plugin dependencies in correct order', async () => {
            const initOrder: string[] = [];

            const pluginA: Plugin = {
                name: 'plugin-a',
                version: '1.0.0',
                dependencies: ['plugin-b'],
                init: async () => {
                    initOrder.push('plugin-a');
                },
            };

            const pluginB: Plugin = {
                name: 'plugin-b',
                version: '1.0.0',
                init: async () => {
                    initOrder.push('plugin-b');
                },
            };

            await kernel.use(pluginA);
            await kernel.use(pluginB);
            await kernel.bootstrap();

            expect(initOrder).toEqual(['plugin-b', 'plugin-a']);

            await kernel.shutdown();
        });

        it('should detect circular plugin dependencies', async () => {
            const pluginA: Plugin = {
                name: 'plugin-a',
                version: '1.0.0',
                dependencies: ['plugin-b'],
                init: async () => {},
            };

            const pluginB: Plugin = {
                name: 'plugin-b',
                version: '1.0.0',
                dependencies: ['plugin-a'],
                init: async () => {},
            };

            await kernel.use(pluginA);
            await kernel.use(pluginB);

            await expect(async () => {
                await kernel.bootstrap();
            }).rejects.toThrow('Circular dependency');
        });
    });

    describe('State Management', () => {
        it('should track kernel state correctly', async () => {
            expect(kernel.getState()).toBe('idle');

            await kernel.bootstrap();
            expect(kernel.getState()).toBe('running');
            expect(kernel.isRunning()).toBe(true);

            await kernel.shutdown();
            expect(kernel.getState()).toBe('stopped');
            expect(kernel.isRunning()).toBe(false);
        });

        it('should not allow double bootstrap', async () => {
            await kernel.bootstrap();

            await expect(async () => {
                await kernel.bootstrap();
            }).rejects.toThrow('already bootstrapped');

            await kernel.shutdown();
        });

        it('should not allow shutdown before bootstrap', async () => {
            await expect(async () => {
                await kernel.shutdown();
            }).rejects.toThrow('not running');
        });
    });

    describe('Service Replacement', () => {
        it('should replace an existing service via replaceService', async () => {
            const originalService = { value: 'original' };
            const replacementService = { value: 'replaced' };

            const plugin: Plugin = {
                name: 'register-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.registerService('metadata', originalService);
                },
            };

            const optimizationPlugin: Plugin = {
                name: 'optimization-plugin',
                version: '1.0.0',
                dependencies: ['register-plugin'],
                init: async (ctx) => {
                    const existing = ctx.getService('metadata');
                    expect(existing).toBe(originalService);
                    ctx.replaceService('metadata', replacementService);
                },
            };

            await kernel.use(plugin);
            await kernel.use(optimizationPlugin);
            await kernel.bootstrap();

            const result = kernel.getService('metadata');
            expect(result).toBe(replacementService);

            await kernel.shutdown();
        });

        it('should throw when replacing a non-existent service', async () => {
            const plugin: Plugin = {
                name: 'bad-replace-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    expect(() => {
                        ctx.replaceService('nonexistent', { value: 'test' });
                    }).toThrow("Service 'nonexistent' not found");
                },
            };

            await kernel.use(plugin);
            await kernel.bootstrap();
            await kernel.shutdown();
        });

        it('should allow decorator pattern via replaceService', async () => {
            const original = {
                getData: () => 'raw-data',
            };

            const plugin: Plugin = {
                name: 'data-plugin',
                version: '1.0.0',
                init: async (ctx) => {
                    ctx.registerService('data', original);
                },
            };

            const wrapperPlugin: Plugin = {
                name: 'wrapper-plugin',
                version: '1.0.0',
                dependencies: ['data-plugin'],
                init: async (ctx) => {
                    const existing = ctx.getService<typeof original>('data');
                    const decorated = {
                        getData: () => `cached(${existing.getData()})`,
                    };
                    ctx.replaceService('data', decorated);
                },
            };

            await kernel.use(plugin);
            await kernel.use(wrapperPlugin);
            await kernel.bootstrap();

            const result = kernel.getService<typeof original>('data');
            expect(result.getData()).toBe('cached(raw-data)');

            await kernel.shutdown();
        });
    });
});
