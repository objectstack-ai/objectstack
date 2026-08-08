import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiteKernel } from './lite-kernel';
import type { Plugin, PluginContext } from './types';

// Unique per-process temp path — a shared hardcoded /tmp file can be owned by a
// different user (CI / multi-user hosts), causing EACCES under concurrent runs.
const TEST_LOG_FILE = join(tmpdir(), `objectstack-test-kernel-${process.pid}.log`);

describe('LiteKernel with Configurable Logger', () => {
    let kernel: LiteKernel;

    beforeEach(() => {
        kernel = new LiteKernel();
    });

    describe('Logger Configuration', () => {
        it('should create kernel with default logger', () => {
            expect(kernel).toBeDefined();
        });

        it('should create kernel with custom logger config', async () => {
            const customKernel = new LiteKernel({
                logger: {
                    level: 'debug',
                    format: 'pretty',
                    sourceLocation: true
                }
            });
            
            expect(customKernel).toBeDefined();
            
            // Cleanup
            await customKernel.bootstrap();
            await customKernel.shutdown();
        });

        it('should create kernel with file logging config', async () => {
            const fileKernel = new LiteKernel({
                logger: {
                    level: 'info',
                    format: 'json',
                    file: TEST_LOG_FILE
                }
            });
            
            expect(fileKernel).toBeDefined();
            
            // Cleanup
            await fileKernel.bootstrap();
            await fileKernel.shutdown();
        });
    });

    describe('Plugin Context Logger', () => {
        it('should provide logger to plugins', async () => {
            let loggerReceived = false;
            
            const testPlugin: Plugin = {
                name: 'test-plugin',
                init: async (ctx) => {
                    if (ctx.logger) {
                        loggerReceived = true;
                        ctx.logger.info('Plugin initialized', { plugin: 'test-plugin' });
                    }
                }
            };

            kernel.use(testPlugin);
            await kernel.bootstrap();

            expect(loggerReceived).toBe(true);
            
            await kernel.shutdown();
        });

        it('should allow plugins to use all log levels', async () => {
            const logCalls: string[] = [];
            
            const loggingPlugin: Plugin = {
                name: 'logging-plugin',
                init: async (ctx) => {
                    ctx.logger.debug('Debug message');
                    logCalls.push('debug');
                    
                    ctx.logger.info('Info message');
                    logCalls.push('info');
                    
                    ctx.logger.warn('Warning message');
                    logCalls.push('warn');
                    
                    ctx.logger.error('Error message');
                    logCalls.push('error');
                }
            };

            kernel.use(loggingPlugin);
            await kernel.bootstrap();

            expect(logCalls).toContain('debug');
            expect(logCalls).toContain('info');
            expect(logCalls).toContain('warn');
            expect(logCalls).toContain('error');
            
            await kernel.shutdown();
        });

        it('should support metadata in logs', async () => {
            const metadataPlugin: Plugin = {
                name: 'metadata-plugin',
                init: async (ctx) => {
                    ctx.logger.info('User action', {
                        userId: '123',
                        action: 'create',
                        resource: 'document'
                    });
                }
            };

            kernel.use(metadataPlugin);
            await kernel.bootstrap();
            
            await kernel.shutdown();
        });
    });

    describe('Kernel Lifecycle Logging', () => {
        it('should log bootstrap process', async () => {
            const plugin: Plugin = {
                name: 'lifecycle-test',
                init: async () => {
                    // Init logic
                },
                start: async () => {
                    // Start logic
                }
            };

            kernel.use(plugin);
            await kernel.bootstrap();
            
            expect(kernel.isRunning()).toBe(true);
            
            await kernel.shutdown();
        });

        it('should log shutdown process', async () => {
            const plugin: Plugin = {
                name: 'shutdown-test',
                init: async () => {},
                destroy: async () => {
                    // Cleanup
                }
            };

            kernel.use(plugin);
            await kernel.bootstrap();
            await kernel.shutdown();
            
            expect(kernel.getState()).toBe('stopped');
        });
    });

    describe('Environment Compatibility', () => {
        it('should work in Node.js environment', async () => {
            const nodeKernel = new LiteKernel({
                logger: {
                    level: 'info',
                    format: 'json'
                }
            });

            const plugin: Plugin = {
                name: 'node-test',
                init: async (ctx) => {
                    ctx.logger.info('Running in Node.js');
                }
            };

            nodeKernel.use(plugin);
            await nodeKernel.bootstrap();
            await nodeKernel.shutdown();
        });

        it('should support browser-friendly logging', async () => {
            const browserKernel = new LiteKernel({
                logger: {
                    level: 'info',
                    format: 'pretty'
                }
            });

            const plugin: Plugin = {
                name: 'browser-test',
                init: async (ctx) => {
                    ctx.logger.info('Browser-friendly format');
                }
            };

            browserKernel.use(plugin);
            await browserKernel.bootstrap();
            await browserKernel.shutdown();
        });
    });

    describe('Service Replacement', () => {
        it('should replace an existing service via replaceService', async () => {
            const originalService = { value: 'original' };
            const replacementService = { value: 'replaced' };

            const plugin: Plugin = {
                name: 'register-plugin',
                init: async (ctx) => {
                    ctx.registerService('metadata', originalService);
                },
            };

            const optimizationPlugin: Plugin = {
                name: 'optimization-plugin',
                dependencies: ['register-plugin'],
                init: async (ctx) => {
                    const existing = ctx.getService('metadata');
                    expect(existing).toBe(originalService);
                    ctx.replaceService('metadata', replacementService);
                },
            };

            kernel.use(plugin);
            kernel.use(optimizationPlugin);
            await kernel.bootstrap();

            const result = kernel.getService('metadata');
            expect(result).toBe(replacementService);

            await kernel.shutdown();
        });

        it('should throw when replacing a non-existent service', async () => {
            const plugin: Plugin = {
                name: 'bad-replace-plugin',
                init: async (ctx) => {
                    expect(() => {
                        ctx.replaceService('nonexistent', { value: 'test' });
                    }).toThrow("Service 'nonexistent' not found");
                },
            };

            kernel.use(plugin);
            await kernel.bootstrap();
            await kernel.shutdown();
        });
    });

    describe('Lifecycle event ordering', () => {
        it('fires kernel:ready → kernel:bootstrapped → kernel:listening in order', async () => {
            const order: string[] = [];
            const plugin: Plugin = {
                name: 'lifecycle-order-plugin',
                init: async (ctx) => {
                    ctx.hook('kernel:listening', async () => { order.push('kernel:listening'); });
                    ctx.hook('kernel:bootstrapped', async () => { order.push('kernel:bootstrapped'); });
                    ctx.hook('kernel:ready', async () => { order.push('kernel:ready'); });
                },
            };

            kernel.use(plugin);
            await kernel.bootstrap();
            await kernel.shutdown();

            expect(order).toEqual(['kernel:ready', 'kernel:bootstrapped', 'kernel:listening']);
        });

        // #5170 — the LiteKernel half of the cross-kernel pin. This is the
        // behaviour the issue changed: the throw used to be caught inside
        // `triggerHook`, logged as `Hook handler failed: kernel:ready`, and the
        // boot carried on to report "✅ Bootstrap complete". A vitest /
        // serverless / edge host therefore came up WITHOUT the guarantee its
        // ready handler had just refused to give it. Same hook, same plugin
        // code, same answer on both kernels now.
        it('fails the boot when a kernel:ready handler throws (#5170)', async () => {
            const reached: string[] = [];
            const plugin: Plugin = {
                name: 'ready-thrower-plugin',
                init: async (ctx) => {
                    ctx.hook('kernel:ready', async () => {
                        throw new Error('declared a durable queue, got none');
                    });
                    ctx.hook('kernel:ready', async () => { reached.push('later-ready'); });
                    ctx.hook('kernel:bootstrapped', async () => { reached.push('kernel:bootstrapped'); });
                    ctx.hook('kernel:listening', async () => { reached.push('kernel:listening'); });
                },
            };

            kernel.use(plugin);

            // The ORIGINAL error surfaces — not a wrapped "bootstrap failed".
            await expect(kernel.bootstrap()).rejects.toThrow('declared a durable queue, got none');

            // Boot stopped AT the failing handler: no later ready handler, and
            // neither of the anchors that promise "every ready handler settled".
            expect(reached).toEqual([]);
            expect(kernel.getState()).toBe('stopped');
        });

        // #5257 — the DELIBERATE FLIP of the pin #5170 left behind. That pin
        // read "keeps fail-soft dispatch for hooks other than kernel:ready",
        // covering `kernel:bootstrapped`, `kernel:listening` AND
        // `kernel:shutdown` in one assertion, because #5170's dispatch word
        // ruled `kernel:ready` alone. #5257 rules the other two boot-path
        // hooks: they propagate now, and only `kernel:shutdown` still holds
        // the fail-soft half (its own test below). The split is what the
        // three tests here record — per hook, on purpose.
        it('fails the boot when a kernel:bootstrapped handler throws (#5257)', async () => {
            const reached: string[] = [];
            const plugin: Plugin = {
                name: 'bootstrapped-thrower-plugin',
                init: async (ctx) => {
                    ctx.hook('kernel:bootstrapped', async () => {
                        throw new Error('node-type audit could not seal the vocabulary');
                    });
                    ctx.hook('kernel:bootstrapped', async () => { reached.push('later-bootstrapped'); });
                    ctx.hook('kernel:listening', async () => { reached.push('kernel:listening'); });
                },
            };

            kernel.use(plugin);

            // The ORIGINAL error surfaces — not a wrapped "bootstrap failed".
            await expect(kernel.bootstrap()).rejects.toThrow('node-type audit could not seal the vocabulary');

            // Boot stopped AT the failing handler: no later bootstrapped
            // handler, and no listening phase at all.
            expect(reached).toEqual([]);
            expect(kernel.getState()).toBe('stopped');
        });

        // The headline case of #5257. `kernel:listening` is where HTTP server
        // plugins open their socket — `HonoServerPlugin` awaits
        // `server.listen(port)` there with no try/catch of its own. Swallowing
        // that rejection (EACCES on a privileged port, a listen the edge /
        // serverless host cannot perform at all) used to leave a live process
        // that had printed "✅ Bootstrap complete" and was listening on
        // nothing. Hence the explicit assertion that the success line is NOT
        // logged: `bootstrap()` rejecting is only half the contract, the other
        // half is that nothing announced success on the way out.
        it('fails the boot — and never logs "Bootstrap complete" — when a kernel:listening handler throws (#5257)', async () => {
            const reached: string[] = [];
            const plugin: Plugin = {
                name: 'listening-thrower-plugin',
                init: async (ctx) => {
                    ctx.hook('kernel:listening', async () => {
                        throw new Error('listen EACCES: permission denied 0.0.0.0:80');
                    });
                    ctx.hook('kernel:listening', async () => { reached.push('later-listening'); });
                },
            };

            kernel.use(plugin);
            const infoSpy = vi.spyOn((kernel as unknown as { logger: { info: (...a: unknown[]) => void } }).logger, 'info');

            await expect(kernel.bootstrap()).rejects.toThrow('listen EACCES: permission denied 0.0.0.0:80');

            expect(reached).toEqual([]);
            expect(kernel.getState()).toBe('stopped');
            const logged = infoSpy.mock.calls.map((c) => String(c[0]));
            expect(logged.some((m) => m.includes('Bootstrap complete'))).toBe(false);
            infoSpy.mockRestore();
        });

        // The half of the old pin that SURVIVES #5257, kept as its own test so
        // the reason is attached to the one hook it applies to. `kernel:shutdown`
        // stays fail-soft: on the teardown path there is no "refuse to proceed"
        // left to buy, and the handlers queued behind a failing one are the
        // cleanup that flushes buffers and releases resources. Aborting the
        // sequence would turn one bad handler into leaked resources.
        it('keeps fail-soft dispatch for kernel:shutdown — a failing handler must not block the remaining cleanup (#5257)', async () => {
            const reached: string[] = [];
            const plugin: Plugin = {
                name: 'shutdown-thrower-plugin',
                init: async (ctx) => {
                    ctx.hook('kernel:shutdown', async () => { throw new Error('shutdown boom'); });
                    ctx.hook('kernel:shutdown', async () => { reached.push('later-shutdown'); });
                },
                destroy: async () => { reached.push('plugin-destroy'); },
            };

            kernel.use(plugin);

            await expect(kernel.bootstrap()).resolves.toBeUndefined();
            expect(kernel.getState()).toBe('running');

            await expect(kernel.shutdown()).resolves.toBeUndefined();
            // Both the later hook handler AND the plugin teardown behind it ran.
            expect(reached).toEqual(['later-shutdown', 'plugin-destroy']);
            expect(kernel.getState()).toBe('stopped');
        });

        // #5282. The behavioural half above says the cleanup continues; this
        // says the failure is REPORTED, naming the hook, in the exact wording
        // `ObjectKernel`'s teardown pin asserts on the other side
        // (`kernel.test.ts`, #5274). Until #5282 the two kernels printed that
        // line from two hand-written loops; they now print it from one shared
        // dispatcher, and this is the LiteKernel end of the pin that goes red
        // if that single implementation stops logging.
        it('logs `Hook handler failed: kernel:shutdown` for the handler that threw (#5282)', async () => {
            const errorSpy = vi.spyOn(
                (kernel as unknown as { logger: { error: (...a: unknown[]) => void } }).logger,
                'error',
            );

            const plugin: Plugin = {
                name: 'shutdown-thrower-logging',
                init: async (ctx: PluginContext) => {
                    ctx.hook('kernel:shutdown', async () => { throw new Error('shutdown boom'); });
                },
            };

            try {
                kernel.use(plugin);
                await kernel.bootstrap();
                await kernel.shutdown();

                expect(errorSpy.mock.calls.map((c) => String(c[0]))).toContain(
                    'Hook handler failed: kernel:shutdown',
                );
                expect(kernel.getState()).toBe('stopped');
            } finally {
                errorSpy.mockRestore();
            }
        });

        // #5282, the LiteKernel half of the dual-path pin (`kernel.test.ts`
        // carries the ObjectKernel half). `kernel:shutdown` has TWO dispatch
        // paths with different flavours on BOTH kernels, and the ruling that
        // shared the dispatch loops deliberately did NOT flip either:
        //
        //   - the kernel's own teardown dispatch isolates (`triggerHook`): a
        //     throwing handler is logged and the cleanup behind it still runs;
        //   - a plugin calling `ctx.trigger('kernel:shutdown')` by hand goes
        //     through `PluginContext.trigger`, which propagates.
        //
        // Nothing in the repo triggers `kernel:shutdown` by hand today, so this
        // is DORMANT rather than a live defect — pinned so the difference is a
        // documented fact instead of a surprise found at teardown.
        it('dispatches kernel:shutdown two ways: ctx.trigger propagates, the kernel teardown isolates (#5282)', async () => {
            const reached: string[] = [];
            let captured!: PluginContext;

            const plugin: Plugin = {
                name: 'dual-path-shutdown',
                init: async (ctx: PluginContext) => {
                    captured = ctx;
                    ctx.hook('kernel:shutdown', async () => { throw new Error('manual boom'); });
                    ctx.hook('kernel:shutdown', async () => { reached.push('later-shutdown'); });
                },
            };

            kernel.use(plugin);
            await kernel.bootstrap();

            // Path 1 — manual trigger: PROPAGATING. The error reaches the
            // caller unwrapped and the second handler never runs.
            await expect(captured.trigger('kernel:shutdown')).rejects.toThrow('manual boom');
            expect(reached).toEqual([]);

            // Path 2 — the kernel's own teardown: ISOLATING. Same handlers,
            // same hook name, opposite treatment of the same throw.
            await kernel.shutdown();
            expect(reached).toEqual(['later-shutdown']);
            expect(kernel.getState()).toBe('stopped');
        });
    });
});
