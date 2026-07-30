import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectKernel } from './kernel';
import { ServiceLifecycle, PluginMetadata } from './plugin-loader';
import type { Plugin } from './types';

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
