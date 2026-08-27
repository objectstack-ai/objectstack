import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Runtime } from './runtime';
import { IHttpServer, PluginContext } from '@objectstack/core';

// Mock ObjectKernel to isolate Runtime logic
vi.mock('@objectstack/core', async () => {
    const actual = await vi.importActual<any>('@objectstack/core');
    return {
        ...actual,
        ObjectKernel: class {
            use = vi.fn();
            registerService = vi.fn();
            bootstrap = vi.fn().mockResolvedValue(undefined);
            getServices = vi.fn().mockReturnValue(new Map());
        }
    };
});

describe('Runtime', () => {
    it('should initialize successfully', () => {
        const runtime = new Runtime();
        expect(runtime).toBeDefined();
        // Should create a kernel
        expect(runtime.getKernel()).toBeDefined();
    });

    it('auto-registers the cluster service plugin, metadata bridge and authz posture bridge', () => {
        const runtime = new Runtime();
        const kernel = runtime.getKernel();
        expect(kernel.use).toHaveBeenCalledTimes(3);
        const names = (kernel.use as any).mock.calls.map((c: any[]) => c[0].name);
        expect(names).toContain('com.objectstack.service.cluster');
        expect(names).toContain('com.objectstack.service.metadata-cluster-bridge');
        // [#11968] The third is the authorization-cache posture bridge. It is
        // inert on this default (OS_AUTHZ_GRANTS_CACHE_TTL_MS is 0, so it
        // attaches nothing and logs nothing above debug) — the count moves, the
        // observable behaviour does not.
        expect(names).toContain('com.objectstack.service.authz-cluster-bridge');
    });

    it('cluster:false skips the CLUSTER plugins — and deliberately keeps the authz posture bridge', () => {
        // [#11968] This assertion used to be `not.toHaveBeenCalled()`, and the
        // change of direction is the point rather than an accommodation. The
        // posture bridge exists to say out loud when a grants cache is enabled
        // with no invalidation bus, and `cluster: false` is not a reason to skip
        // that check — it is the LOUDEST case the check has. Dropping it here
        // would put the statement's absence exactly where the missing bus is,
        // which is #4785's shape (a security-relevant mechanism absent, with
        // nothing said). Still inert by default: the plugin reads the TTL at
        // `kernel:ready` and returns at `debug` when it is 0.
        const runtime = new Runtime({ cluster: false });
        const kernel = runtime.getKernel();
        expect(kernel.use).toHaveBeenCalledTimes(1);
        const names = (kernel.use as any).mock.calls.map((c: any[]) => c[0].name);
        expect(names).toEqual(['com.objectstack.service.authz-cluster-bridge']);
        expect(names).not.toContain('com.objectstack.service.cluster');
        expect(names).not.toContain('com.objectstack.service.metadata-cluster-bridge');
    });

    it('should register external http server if provided', () => {
        const mockServer: IHttpServer = {
            listen: vi.fn(),
            close: vi.fn(),
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
            patch: vi.fn(),
            use: vi.fn(),
        };
        
        const runtime = new Runtime({ server: mockServer });
        const kernel = runtime.getKernel();
        
        expect(kernel.registerService).toHaveBeenCalledWith('http.server', mockServer);
    });

    it('should delegate use() to kernel', () => {
        const runtime = new Runtime();
        const mockPlugin = { name: 'test', init: vi.fn() };
        
        runtime.use(mockPlugin);
        expect(runtime.getKernel().use).toHaveBeenCalledWith(mockPlugin);
    });

    it('should delegate start() to kernel.bootstrap()', async () => {
        const runtime = new Runtime();
        await runtime.start();
        expect(runtime.getKernel().bootstrap).toHaveBeenCalled();
    });
});
