import { describe, it, expect, beforeEach } from 'vitest';
import { PluginLoader, ServiceLifecycle, PluginMetadata } from './plugin-loader';
import { createLogger } from './logger';
import type { Plugin, PluginContext } from './types';

describe('PluginLoader', () => {
    let loader: PluginLoader;
    
    beforeEach(() => {
        const logger = createLogger({ level: 'error' }); // Suppress logs in tests
        loader = new PluginLoader(logger);
        loader.setContext({
            registerService: () => {},
            getService: () => { throw new Error('Mock service not found'); },
            hook: () => {},
            trigger: async () => {},
            getServices: () => new Map(),
            logger: logger,
            getKernel: () => ({}) as any
        } as PluginContext);
    });

    describe('Plugin Loading', () => {
        it('should load a valid plugin', async () => {
            const plugin: Plugin = {
                name: 'test-plugin',
                version: '1.0.0',
                init: async () => {},
            };

            const result = await loader.loadPlugin(plugin);

            expect(result.success).toBe(true);
            expect(result.plugin?.name).toBe('test-plugin');
            expect(result.plugin?.version).toBe('1.0.0');
            expect(result.loadTime).toBeGreaterThanOrEqual(0);
        });

        it('should reject plugin with invalid name', async () => {
            const plugin: Plugin = {
                name: '',
                init: async () => {},
            };

            const result = await loader.loadPlugin(plugin);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('name is required');
        });

        it('should reject plugin without init function', async () => {
            const plugin: any = {
                name: 'invalid-plugin',
            };

            const result = await loader.loadPlugin(plugin);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('init function is required');
        });

        it('should use default version 0.0.0 if not provided', async () => {
            const plugin: Plugin = {
                name: 'no-version',
                init: async () => {},
            };

            const result = await loader.loadPlugin(plugin);

            expect(result.success).toBe(true);
            expect(result.plugin?.version).toBe('0.0.0');
        });
    });

    describe('Version Compatibility', () => {
        it('should accept valid semantic versions', async () => {
            const validVersions = ['1.0.0', '2.3.4', '0.0.1', '10.20.30'];

            for (const version of validVersions) {
                const plugin: Plugin = {
                    name: `plugin-${version}`,
                    version,
                    init: async () => {},
                };

                const result = await loader.loadPlugin(plugin);
                expect(result.success).toBe(true);
            }
        });

        it('should accept versions with pre-release tags', async () => {
            const plugin: Plugin = {
                name: 'prerelease',
                version: '1.0.0-alpha.1',
                init: async () => {},
            };

            const result = await loader.loadPlugin(plugin);
            expect(result.success).toBe(true);
        });

        it('should accept versions with build metadata', async () => {
            const plugin: Plugin = {
                name: 'build-meta',
                version: '1.0.0+20230101',
                init: async () => {},
            };

            const result = await loader.loadPlugin(plugin);
            expect(result.success).toBe(true);
        });

        it('should reject invalid semantic versions', async () => {
            const invalidVersions = ['1.0', 'v1.0.0', '1', 'invalid'];

            for (const version of invalidVersions) {
                const plugin: Plugin = {
                    name: `invalid-${version}`,
                    version,
                    init: async () => {},
                };

                const result = await loader.loadPlugin(plugin);
                expect(result.success).toBe(false);
            }
        });

        /**
         * The eight strings SemVer 2.0.0 forbids that this loader used to LOAD,
         * all of them, pinned as REFUSED.
         *
         * ⭐ The predicate behind these is `isSemverVersion`. It was
         * `isValidSemanticVersion` over a wider grammar, renamed to
         * `isSemverShapedVersion` in #17070 because a predicate named for a
         * standard it does not implement gets misused by the next caller
         * whatever its docblock says; the maintainer's canon ruling then made
         * the grammar match the name instead, and this block flipped with it.
         *
         * ⭐ Why this does not reverse #16365. That ruling's subject is what
         * LOADS, and none of these eight is a valid prerelease: they are leading
         * zeroes in the numeric core (§2), empty and leading-zero prerelease
         * identifiers (§9), and empty build metadata (§10). No precedence order
         * exists for any of them — `dependency-resolver.ts` can place none in an
         * order — so a plugin versioned this way could load and never be
         * compared against its own successor. Every valid prerelease and build
         * form this loader accepts still loads, which the two cases above this
         * block assert directly.
         *
         * ⛔ Do not widen the check back to make one of these load. That is a
         * published behaviour change on this loader and on `PluginSchema`, and
         * it needs its own card.
         */
        it.each([
            // §2 — numeric identifiers MUST NOT include leading zeroes.
            '01.1.1', '1.01.1', '1.1.01',
            // §9 — prerelease identifiers MUST NOT be empty or carry leading zeroes.
            '1.0.0-0123', '1.0.0-alpha..1', '1.0.0-alpha..', '1.0.0-.',
            // §10 — build-metadata identifiers MUST NOT be empty.
            '1.0.0+.',
        ])('refuses a plugin versioned %s, which SemVer 2.0.0 forbids', async (version) => {
            const plugin: Plugin = {
                name: `semver-fringe-${version}`,
                version,
                init: async () => {},
            };

            const result = await loader.loadPlugin(plugin);
            expect(result.success).toBe(false);
        });

        /**
         * The other half of the bound, and the half that keeps #16365 honoured:
         * every valid prerelease and build form the wider grammar admitted is
         * still loaded. ⛔ A failure here is not a pin to update — it means the
         * narrowing overran its mandate.
         */
        it.each([
            '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-0A.is.legal',
            '1.0.0-alpha0.valid', '1.0.0-alpha.0valid', '1.2.3-beta',
            '1.1.2+meta', '1.0.0+0.build.1-rc.10000aaa-kk-0.1',
            '1.1.2-prerelease+meta', '1.0.0-rc.1+build.1', '2.0.0-rc.1+build.123',
            '0.0.0-fixture', '1.0.0-Beta.1', '1.0.0+Build.5', '17.0.0-rc.5',
        ])('still loads a plugin versioned %s', async (version) => {
            const plugin: Plugin = {
                name: `semver-valid-${version}`,
                version,
                init: async () => {},
            };

            const result = await loader.loadPlugin(plugin);
            expect(result.success).toBe(true);
        });

    });

    describe('Service Factory Registration', () => {
        it('should register a singleton service factory', () => {
            let callCount = 0;
            const factory = () => {
                callCount++;
                return { value: callCount };
            };

            loader.registerServiceFactory({
                name: 'singleton-service',
                factory,
                lifecycle: ServiceLifecycle.SINGLETON,
            });

            expect(() => {
                loader.registerServiceFactory({
                    name: 'singleton-service',
                    factory,
                    lifecycle: ServiceLifecycle.SINGLETON,
                });
            }).toThrow('already registered');
        });

        it('should register multiple service factories with different names', () => {
            loader.registerServiceFactory({
                name: 'service-1',
                factory: () => ({ id: 1 }),
                lifecycle: ServiceLifecycle.SINGLETON,
            });

            loader.registerServiceFactory({
                name: 'service-2',
                factory: () => ({ id: 2 }),
                lifecycle: ServiceLifecycle.TRANSIENT,
            });

            // Should not throw
            expect(true).toBe(true);
        });
    });

    describe('Service Retrieval with Lifecycle', () => {
        it('should create singleton service only once', async () => {
            let callCount = 0;
            loader.registerServiceFactory({
                name: 'counter',
                factory: () => {
                    callCount++;
                    return { count: callCount };
                },
                lifecycle: ServiceLifecycle.SINGLETON,
            });

            const service1 = await loader.getService('counter');
            const service2 = await loader.getService('counter');

            expect(callCount).toBe(1);
            expect(service1).toBe(service2);
        });

        it('should create new transient service on each request', async () => {
            let callCount = 0;
            loader.registerServiceFactory({
                name: 'transient',
                factory: () => {
                    callCount++;
                    return { count: callCount };
                },
                lifecycle: ServiceLifecycle.TRANSIENT,
            });

            const service1 = await loader.getService('transient');
            const service2 = await loader.getService('transient');

            expect(callCount).toBe(2);
            expect(service1).not.toBe(service2);
            expect((service1 as any).count).toBe(1);
            expect((service2 as any).count).toBe(2);
        });

        it('should create scoped service once per scope', async () => {
            let callCount = 0;
            loader.registerServiceFactory({
                name: 'scoped',
                factory: () => {
                    callCount++;
                    return { count: callCount };
                },
                lifecycle: ServiceLifecycle.SCOPED,
            });

            const scope1Service1 = await loader.getService('scoped', 'scope-1');
            const scope1Service2 = await loader.getService('scoped', 'scope-1');
            const scope2Service1 = await loader.getService('scoped', 'scope-2');

            expect(callCount).toBe(2); // Once per scope
            expect(scope1Service1).toBe(scope1Service2); // Same within scope
            expect(scope1Service1).not.toBe(scope2Service1); // Different across scopes
        });

        it('should throw error for scoped service without scope ID', async () => {
            loader.registerServiceFactory({
                name: 'scoped-no-id',
                factory: () => ({ value: 'test' }),
                lifecycle: ServiceLifecycle.SCOPED,
            });

            await expect(async () => {
                await loader.getService('scoped-no-id');
            }).rejects.toThrow('Scope ID required');
        });

        it('should throw error for non-existent service', async () => {
            await expect(async () => {
                await loader.getService('non-existent');
            }).rejects.toThrow('not found');
        });
    });

    describe('Circular Dependency Detection', () => {
        it('should detect simple circular dependency', () => {
            loader.registerServiceFactory({
                name: 'service-a',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
                dependencies: ['service-b'],
            });

            loader.registerServiceFactory({
                name: 'service-b',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
                dependencies: ['service-a'],
            });

            const cycles = loader.detectCircularDependencies();
            expect(cycles.length).toBeGreaterThan(0);
            expect(cycles[0]).toContain('service-a');
            expect(cycles[0]).toContain('service-b');
        });

        it('should detect complex circular dependency', () => {
            loader.registerServiceFactory({
                name: 'service-a',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
                dependencies: ['service-b'],
            });

            loader.registerServiceFactory({
                name: 'service-b',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
                dependencies: ['service-c'],
            });

            loader.registerServiceFactory({
                name: 'service-c',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
                dependencies: ['service-a'],
            });

            const cycles = loader.detectCircularDependencies();
            expect(cycles.length).toBeGreaterThan(0);
        });

        it('should not report false positives for valid dependency chains', () => {
            loader.registerServiceFactory({
                name: 'service-a',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
                dependencies: ['service-b'],
            });

            loader.registerServiceFactory({
                name: 'service-b',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
                dependencies: ['service-c'],
            });

            loader.registerServiceFactory({
                name: 'service-c',
                factory: () => ({}),
                lifecycle: ServiceLifecycle.SINGLETON,
            });

            const cycles = loader.detectCircularDependencies();
            expect(cycles.length).toBe(0);
        });
    });

    describe('Plugin Health Checks', () => {
        it('should return healthy for plugin without health check', async () => {
            const plugin: Plugin = {
                name: 'no-health-check',
                version: '1.0.0',
                init: async () => {},
            };

            await loader.loadPlugin(plugin);
            const health = await loader.checkPluginHealth('no-health-check');

            expect(health.healthy).toBe(true);
            expect(health.message).toContain('No health check');
        });

        it('should execute plugin health check', async () => {
            const plugin: PluginMetadata = {
                name: 'with-health-check',
                version: '1.0.0',
                init: async () => {},
                healthCheck: async () => ({
                    healthy: true,
                    message: 'All systems operational',
                }),
            };

            await loader.loadPlugin(plugin);
            const health = await loader.checkPluginHealth('with-health-check');

            expect(health.healthy).toBe(true);
            expect(health.message).toBe('All systems operational');
            expect(health.lastCheck).toBeInstanceOf(Date);
        });

        it('should handle failing health check', async () => {
            const plugin: PluginMetadata = {
                name: 'failing-health',
                version: '1.0.0',
                init: async () => {},
                healthCheck: async () => {
                    throw new Error('Service unavailable');
                },
            };

            await loader.loadPlugin(plugin);
            const health = await loader.checkPluginHealth('failing-health');

            expect(health.healthy).toBe(false);
            expect(health.message).toContain('Health check failed');
        });

        it('should return not found for unknown plugin', async () => {
            const health = await loader.checkPluginHealth('unknown-plugin');

            expect(health.healthy).toBe(false);
            expect(health.message).toContain('not found');
        });
    });

    describe('Scope Management', () => {
        it('should clear scoped services', async () => {
            let callCount = 0;
            loader.registerServiceFactory({
                name: 'scoped-clear',
                factory: () => {
                    callCount++;
                    return { count: callCount };
                },
                lifecycle: ServiceLifecycle.SCOPED,
            });

            const service1 = await loader.getService('scoped-clear', 'scope-1');
            expect((service1 as any).count).toBe(1);

            loader.clearScope('scope-1');

            const service2 = await loader.getService('scoped-clear', 'scope-1');
            expect((service2 as any).count).toBe(2); // New instance created
        });
    });

    describe('Static Service Registration', () => {
        it('should register static service instance', () => {
            const service = { value: 'test' };
            loader.registerService('static-service', service);

            expect(() => {
                loader.registerService('static-service', service);
            }).toThrow('already registered');
        });

        it('should retrieve static service', async () => {
            const service = { value: 'static' };
            loader.registerService('static', service);

            const retrieved = await loader.getService('static');
            expect(retrieved).toBe(service);
        });
    });
});
