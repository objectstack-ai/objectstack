import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';
import { PluginContext } from '@objectstack/core';
import { HonoHttpServer } from './adapter';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true)
    };
});

vi.mock('@hono/node-server/serve-static', () => ({
    serveStatic: vi.fn(() => (c: any, next: any) => next())
}));

vi.mock('./adapter', () => ({
    HonoHttpServer: vi.fn(function() {
        return {
            mount: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            getApp: vi.fn(),
            listen: vi.fn(),
            getPort: vi.fn().mockReturnValue(3000),
            close: vi.fn(),
            getRawApp: vi.fn().mockReturnValue({
                get: vi.fn(),
                use: vi.fn(),
            })
        };
    })
}));

// Capture the config passed to hono/cors so we can assert allowHeaders / exposeHeaders.
const corsConfigCapture: { last?: any } = {};
vi.mock('hono/cors', () => ({
    cors: vi.fn((config: any) => {
        corsConfigCapture.last = config;
        // Return a no-op middleware
        return async (_c: any, next: any) => next();
    }),
}));

describe('HonoServerPlugin', () => {
    let context: any;
    let logger: any;
    let kernel: any;

    beforeEach(() => {
        vi.clearAllMocks();

        logger = {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        };

        kernel = {
            getService: vi.fn(),
        };

        context = {
            logger,
            getKernel: vi.fn().mockReturnValue(kernel),
            registerService: vi.fn(),
            hook: vi.fn(),
            getService: vi.fn()
        };
    });

    it('should initialize and register server', async () => {
        const plugin = new HonoServerPlugin();
        await plugin.init(context as PluginContext);
        
        expect(context.registerService).toHaveBeenCalledWith('http-server', expect.any(Object));
        expect(HonoHttpServer).toHaveBeenCalled();
    });

    it('should register IHttpServer service on init', async () => {
        const plugin = new HonoServerPlugin();
        await plugin.init(context as PluginContext);
        
        expect(context.registerService).toHaveBeenCalledWith('http.server', expect.any(Object));
        expect(context.registerService).toHaveBeenCalledWith('http-server', expect.any(Object));
    });

    it('should start without errors', async () => {
        const plugin = new HonoServerPlugin();
        await plugin.init(context as PluginContext);
        await plugin.start(context as PluginContext);
        
        // Plugin should register kernel:ready hook to start listening
        expect(context.hook).toHaveBeenCalledWith('kernel:ready', expect.any(Function));
    });

    it('should handle errors gracefully on start', async () => {
        // Simulate a start that doesn't crash even without routes
        const plugin = new HonoServerPlugin();
        await plugin.init(context as PluginContext);
        await expect(plugin.start(context as PluginContext)).resolves.not.toThrow();
    });

    it('should configure static files and SPA fallback when enabled', async () => {
        const plugin = new HonoServerPlugin({
            staticRoot: './public',
            spaFallback: true
        });

        await plugin.init(context as PluginContext);
        await plugin.start(context as PluginContext);

        const serverInstance = (HonoHttpServer as any).mock.instances[0];
        const rawApp = serverInstance.getRawApp();
        
        expect(serverInstance.getRawApp).toHaveBeenCalled();
        // Should register static files middleware
        expect(rawApp.get).toHaveBeenCalledWith('/*', expect.anything());
        // Should register SPA fallback middleware
        expect(rawApp.get).toHaveBeenCalledWith('/*', expect.anything());
    });

    describe('CORS wildcard pattern matching', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should enable CORS middleware with wildcard subdomain patterns', async () => {
            const plugin = new HonoServerPlugin({
                cors: {
                    origins: ['https://*.objectui.org', 'https://*.objectstack.ai'],
                    credentials: true
                }
            });

            await plugin.init(context as PluginContext);

            const serverInstance = (HonoHttpServer as any).mock.instances[0];
            const rawApp = serverInstance.getRawApp();

            // CORS middleware should be registered
            expect(rawApp.use).toHaveBeenCalledWith('*', expect.any(Function));
        });

        it('should enable CORS middleware with port wildcard patterns', async () => {
            const plugin = new HonoServerPlugin({
                cors: {
                    origins: 'http://localhost:*',
                }
            });

            await plugin.init(context as PluginContext);

            const serverInstance = (HonoHttpServer as any).mock.instances[0];
            const rawApp = serverInstance.getRawApp();

            expect(rawApp.use).toHaveBeenCalledWith('*', expect.any(Function));
        });

        it('should support comma-separated wildcard patterns', async () => {
            const plugin = new HonoServerPlugin({
                cors: {
                    origins: 'https://*.objectui.org,https://*.objectstack.ai',
                }
            });

            await plugin.init(context as PluginContext);

            const serverInstance = (HonoHttpServer as any).mock.instances[0];
            const rawApp = serverInstance.getRawApp();

            expect(rawApp.use).toHaveBeenCalledWith('*', expect.any(Function));
        });

        it('should support exact origins without wildcards', async () => {
            const plugin = new HonoServerPlugin({
                cors: {
                    origins: ['https://app.example.com', 'https://api.example.com'],
                }
            });

            await plugin.init(context as PluginContext);

            const serverInstance = (HonoHttpServer as any).mock.instances[0];
            const rawApp = serverInstance.getRawApp();

            expect(rawApp.use).toHaveBeenCalledWith('*', expect.any(Function));
        });

        it('should support CORS_ORIGIN environment variable with wildcards', async () => {
            const originalEnv = process.env.OS_CORS_ORIGIN;
            process.env.OS_CORS_ORIGIN = 'https://*.objectui.org,https://*.objectstack.ai';

            const plugin = new HonoServerPlugin();
            await plugin.init(context as PluginContext);

            const serverInstance = (HonoHttpServer as any).mock.instances[0];
            const rawApp = serverInstance.getRawApp();

            expect(rawApp.use).toHaveBeenCalledWith('*', expect.any(Function));

            // Restore environment
            if (originalEnv !== undefined) {
                process.env.OS_CORS_ORIGIN = originalEnv;
            } else {
                delete process.env.OS_CORS_ORIGIN;
            }
        });

        it('should disable CORS when cors option is false', async () => {
            const plugin = new HonoServerPlugin({
                cors: false
            });

            await plugin.init(context as PluginContext);

            const serverInstance = (HonoHttpServer as any).mock.instances[0];
            const rawApp = serverInstance.getRawApp();

            // CORS middleware should NOT be registered
            expect(rawApp.use).not.toHaveBeenCalled();
        });

        it('should disable CORS when CORS_ENABLED env is false', async () => {
            const originalEnv = process.env.OS_CORS_ENABLED;
            process.env.OS_CORS_ENABLED = 'false';

            const plugin = new HonoServerPlugin();
            await plugin.init(context as PluginContext);

            const serverInstance = (HonoHttpServer as any).mock.instances[0];
            const rawApp = serverInstance.getRawApp();

            expect(rawApp.use).not.toHaveBeenCalled();

            // Restore environment
            if (originalEnv !== undefined) {
                process.env.OS_CORS_ENABLED = originalEnv;
            } else {
                delete process.env.OS_CORS_ENABLED;
            }
        });

        it('should always expose set-auth-token header (for better-auth bearer plugin)', async () => {
            corsConfigCapture.last = undefined;

            const plugin = new HonoServerPlugin();
            await plugin.init(context as PluginContext);

            expect(corsConfigCapture.last).toBeDefined();
            expect(corsConfigCapture.last.exposeHeaders).toContain('set-auth-token');
            // Default allowHeaders should include Authorization so Bearer tokens work
            expect(corsConfigCapture.last.allowHeaders).toContain('Authorization');
        });

        it('should merge user-supplied exposeHeaders with set-auth-token default', async () => {
            corsConfigCapture.last = undefined;

            const plugin = new HonoServerPlugin({
                cors: {
                    exposeHeaders: ['X-Request-Id', 'X-Rate-Limit'],
                },
            });
            await plugin.init(context as PluginContext);

            expect(corsConfigCapture.last.exposeHeaders).toEqual(
                expect.arrayContaining(['set-auth-token', 'X-Request-Id', 'X-Rate-Limit']),
            );
        });

        it('should honor custom allowHeaders while still allowing bearer auth header when explicitly provided', async () => {
            corsConfigCapture.last = undefined;

            const plugin = new HonoServerPlugin({
                cors: {
                    allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
                },
            });
            await plugin.init(context as PluginContext);

            expect(corsConfigCapture.last.allowHeaders).toEqual(
                ['Content-Type', 'Authorization', 'X-Tenant-Id'],
            );
        });
    });
});
