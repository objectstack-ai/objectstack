import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiteKernel } from './lite-kernel';
import type { Plugin } from './types';

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
});
