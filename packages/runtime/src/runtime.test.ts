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

/**
 * Plugin ids, named once so the pins below can assert IDENTITY rather than
 * arithmetic. A count assertion that reds at `expected 1, received 0` tells the
 * next engineer a number moved; it does not tell them *which* registration went
 * missing, and it passes just as happily if the right plugin is swapped for the
 * wrong one.
 */
const AUTHZ_POSTURE_BRIDGE = 'com.objectstack.service.authz-cluster-bridge';
const CLUSTER_SERVICE = 'com.objectstack.service.cluster';
const METADATA_CLUSTER_BRIDGE = 'com.objectstack.service.metadata-cluster-bridge';

/** The plugin ids `Runtime` handed to `kernel.use()`, in registration order. */
function registeredPluginNames(runtime: Runtime): string[] {
    const kernel = runtime.getKernel();
    return ((kernel.use as any).mock.calls as any[][]).map((c) => c[0].name);
}

describe('Runtime', () => {
    it('should initialize successfully', () => {
        const runtime = new Runtime();
        expect(runtime).toBeDefined();
        // Should create a kernel
        expect(runtime.getKernel()).toBeDefined();
    });

    it('auto-registers the cluster service plugin, metadata bridge and authz posture bridge', () => {
        const runtime = new Runtime();
        const names = registeredPluginNames(runtime);
        // Identities first, cardinality last: whichever registration is
        // dropped, the failure names it instead of reporting `3 -> 2`.
        expect(names).toContain(CLUSTER_SERVICE);
        expect(names).toContain(METADATA_CLUSTER_BRIDGE);
        // [#11968] The third is the authorization-cache posture bridge. It is
        // inert on this default (OS_AUTHZ_GRANTS_CACHE_TTL_MS is 0, so it
        // attaches nothing and logs nothing above debug) — the count moves, the
        // observable behaviour does not.
        expect(names).toContain(AUTHZ_POSTURE_BRIDGE);
        expect(runtime.getKernel().use).toHaveBeenCalledTimes(3);
    });

    it('cluster:false registers exactly one plugin, the authz posture bridge, and skips the CLUSTER plugins', () => {
        // [#11968; assertion shape ruled at #12679, option A] This pin used to
        // read `not.toHaveBeenCalled()`, and the change of direction is the
        // point rather than an accommodation. The posture bridge exists to say
        // out loud when a grants cache is enabled with no invalidation bus, and
        // `cluster: false` is not a reason to skip that check — it is the
        // LOUDEST case the check has. Dropping the registration would put the
        // statement's absence exactly where the missing bus is, which is
        // #4785's shape (a security-relevant mechanism absent, with nothing
        // said). Still inert by default: the plugin reads the TTL at
        // `kernel:ready` and returns at `debug` when it is 0.
        //
        // ⚠️ ASSERTION ORDER IS LOAD-BEARING — do not "tidy" the count back to
        // the front. #12679 ruled that this pin must red BY NAME: a refactor
        // that silently drops the unconditional registration in `runtime.ts`
        // should read "expected [] to include
        // 'com.objectstack.service.authz-cluster-bridge'", not "expected 1,
        // received 0". A count that fails first aborts the test before the
        // naming assertion ever runs, which is how a pin ends up reporting
        // arithmetic about a security-relevant statement.
        const runtime = new Runtime({ cluster: false });
        const names = registeredPluginNames(runtime);

        expect(
            names,
            '`cluster: false` must STILL register the authz posture bridge ' +
                `(${AUTHZ_POSTURE_BRIDGE}). It is registered unconditionally in ` +
                'Runtime, outside the `cluster !== false` branch, because a ' +
                'grants cache with no invalidation bus at all is the loudest ' +
                'case the posture check has (#12679 option A). If you removed ' +
                'that registration, restore it; the flag skips the CLUSTER ' +
                'plugins only.',
        ).toContain(AUTHZ_POSTURE_BRIDGE);

        // What `cluster: false` actually turns off.
        expect(names).not.toContain(CLUSTER_SERVICE);
        expect(names).not.toContain(METADATA_CLUSTER_BRIDGE);

        // Cardinality last, and as an exact set so "exactly one plugin, the
        // authz posture bridge" is pinned in full rather than as a number.
        expect(names).toEqual([AUTHZ_POSTURE_BRIDGE]);
        expect(runtime.getKernel().use).toHaveBeenCalledTimes(1);
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
