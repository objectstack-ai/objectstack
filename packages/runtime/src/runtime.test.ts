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

    it('auto-registers the cluster service plugin', () => {
        const runtime = new Runtime();
        const kernel = runtime.getKernel();
        expect(kernel.use).toHaveBeenCalledTimes(1);
        const plugin = (kernel.use as any).mock.calls[0][0];
        expect(plugin.name).toBe('com.objectstack.service.cluster');
    });

    it('skips cluster auto-registration when cluster:false', () => {
        const runtime = new Runtime({ cluster: false });
        const kernel = runtime.getKernel();
        expect(kernel.use).not.toHaveBeenCalled();
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
