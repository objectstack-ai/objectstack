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

// PARTIAL mock: only `HonoHttpServer` is replaced. The CORS default constants
// are deliberately kept REAL via `importOriginal` — they are the single source
// this plugin and the `@objectstack/hono` adapter both read (#3786), and the
// assertions below check exact header lists, so stubbing them would make this
// file agree with itself instead of with the shipped defaults.
vi.mock('./adapter', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./adapter')>()),
    HonoHttpServer: vi.fn(function() {
        return {
            mount: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            getApp: vi.fn(),
            listen: vi.fn(),
            getPort: vi.fn().mockReturnValue(3000),
            close: vi.fn(),
            // [#4910] The plugin places the IHttpServer middleware seam at the
            // end of init(). Real behaviour is covered against the REAL adapter
            // in `middleware-seam.test.ts`; here it only has to exist.
            installMiddlewareSeam: vi.fn(),
            // [#9835] init() mounts the `afterResponse` delivery seam
            // unconditionally (observers may register at any later moment)
            // and arms the counter only when a registry resolved. Real
            // behaviour is covered against the REAL adapter in
            // `response-observation-seam.test.ts` and cross-adapter in
            // `@objectstack/http-conformance`; here they only have to exist.
            installResponseObservationSeam: vi.fn(),
            installHttpMetricsSeam: vi.fn(),
            afterResponse: vi.fn(),
            // [#5090] Same deal for the unmatched-request seam: `start()` mounts
            // it through the adapter now (one owner for `app.notFound`, which is
            // last-call-wins). The real 404/405/fallback composition is covered
            // against the REAL adapter in `notfound-405.test.ts` and
            // `fallback-seam.test.ts`; here it only has to exist.
            installNotFoundSeam: vi.fn(),
            // [#5848] init() hands the adapter `ctx.logger` so a throw escaping
            // a route handler lands in the HOST's log pipeline. What the
            // adapter then does with it is covered against the REAL adapter in
            // `handler-throw-logging.test.ts`; here only the wiring is pinned.
            setLogger: vi.fn(),
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

    it('hands the adapter the host logger on init (#5848)', async () => {
        // Without this wiring the adapter falls back to its own default
        // logger, and an escaped handler throw is reported outside whatever
        // pipeline the host actually reads.
        const plugin = new HonoServerPlugin();
        await plugin.init(context as PluginContext);

        const server = (HonoHttpServer as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
        expect(server.setLogger).toHaveBeenCalledWith(logger);
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
            corsConfigCapture.last = undefined;

            const plugin = new HonoServerPlugin({
                cors: false
            });

            await plugin.init(context as PluginContext);

            // CORS middleware must NOT be configured. (Assert on the CORS config,
            // not the raw `use` count: the perf-timing middleware registers its
            // own `use('*')` by default to catch the `X-OS-Debug-Timing` header.)
            expect(corsConfigCapture.last).toBeUndefined();
        });

        it('should disable CORS when CORS_ENABLED env is false', async () => {
            const originalEnv = process.env.OS_CORS_ENABLED;
            process.env.OS_CORS_ENABLED = 'false';
            corsConfigCapture.last = undefined;

            try {
                const plugin = new HonoServerPlugin();
                await plugin.init(context as PluginContext);

                // CORS not configured — see the note above re: the perf-timing
                // middleware's own `use('*')`.
                expect(corsConfigCapture.last).toBeUndefined();
            } finally {
                // Restore environment even if the assertion fails, so a leaked
                // `OS_CORS_ENABLED=false` can't disable CORS in later tests.
                if (originalEnv !== undefined) {
                    process.env.OS_CORS_ENABLED = originalEnv;
                } else {
                    delete process.env.OS_CORS_ENABLED;
                }
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

        it('should allow If-Match by default (OCC token on cross-origin record PATCHes)', async () => {
            corsConfigCapture.last = undefined;

            const plugin = new HonoServerPlugin();
            await plugin.init(context as PluginContext);

            // objectui#2572 dogfood find: the record-level inline edit sends the
            // OCC token as an `If-Match` header; a preflight that doesn't allow
            // it makes every split-origin save fail with "Failed to fetch".
            expect(corsConfigCapture.last.allowHeaders).toContain('If-Match');
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
