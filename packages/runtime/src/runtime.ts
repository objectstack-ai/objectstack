// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectKernel, Plugin, IHttpServer, ObjectKernelConfig } from '@objectstack/core';
import {
    AuthzClusterBridgePlugin,
    ClusterServicePlugin,
    MetadataClusterBridgePlugin,
    type ClusterServicePluginOptions,
} from '@objectstack/service-cluster';
import type { ClusterCapabilityConfig } from '@objectstack/spec/kernel';

export interface RuntimeConfig {
    /**
     * Optional existing server instance (e.g. Hono, Express app)
     * If provided, Runtime will use it as the 'http.server' service.
     * If not provided, Runtime expects a server plugin (like HonoServerPlugin) to be registered manually.
     */
    server?: IHttpServer;

    /**
     * Kernel Configuration
     */
    kernel?: ObjectKernelConfig;

    /**
     * Cluster service configuration.
     *
     * - Omit (default): a single-node `memory` cluster is auto-registered.
     * - `false`: skip auto-registration of the two CLUSTER plugins
     *   (`ClusterServicePlugin` and `MetadataClusterBridgePlugin`). Register
     *   your own `ClusterServicePlugin` if you need it later.
     * - `ClusterCapabilityConfig`: forwarded to `defineCluster()`.
     * - `{ cluster: IClusterService }`: bring your own instance.
     *
     * ## `cluster: false` does NOT mean "service-cluster contributes nothing"
     *
     * One plugin from `@objectstack/service-cluster` is registered
     * **unconditionally**, `false` included: `AuthzClusterBridgePlugin`, the
     * authorization-cache posture bridge. It announces, at boot, a grants
     * cache running with no invalidation bus — and "no cluster service at
     * all" is the loudest case that check has, not a reason for it to go
     * quiet. Opting out of the cluster is precisely when you most want to
     * hear it.
     *
     * It stays inert on the shipped default: with
     * `OS_AUTHZ_GRANTS_CACHE_TTL_MS` at `0` nothing caches authorization
     * answers, so the plugin attaches nothing, publishes nothing and logs
     * nothing above `debug`. `cluster: false` therefore still costs you no
     * behaviour — only the accurate reading of what it turns off.
     *
     * Ruled shape (#12679, option A): the statement stays in
     * `service-cluster` rather than moving to `core`.
     *
     * See `content/docs/kernel/cluster.mdx` §8 for driver options and for the
     * same statement author-facing.
     */
    cluster?: false | ClusterCapabilityConfig | ClusterServicePluginOptions;
}

/**
 * ObjectStack Runtime
 * 
 * High-level entry point for bootstrapping an ObjectStack application.
 * Wraps ObjectKernel and provides standard orchestration for:
 * - HTTP Server binding
 * - Plugin Management
 * 
 * REST API is opt-in — register it explicitly:
 * ```ts
 * import { createRestApiPlugin } from '@objectstack/rest';
 * runtime.use(createRestApiPlugin());
 * ```
 */
export class Runtime {
    readonly kernel: ObjectKernel;
    
    constructor(config: RuntimeConfig = {}) {
        this.kernel = new ObjectKernel(config.kernel);
        
        // If external server provided, register it immediately
        if (config.server) {
             this.kernel.registerService('http.server', config.server);
        }

        // Auto-register cluster service (memory driver by default) unless
        // explicitly opted out. Plugins resolve it via
        // `ctx.getService<IClusterService>('cluster')`.
        if (config.cluster !== false) {
            const opts = this.normalizeClusterOptions(config.cluster);
            this.kernel.use(new ClusterServicePlugin(opts));
            // Bridge metadata cache invalidation across nodes. Late-binds
            // via kernel:ready so it picks up a metadata service whether
            // it's registered by a plugin or directly.
            this.kernel.use(new MetadataClusterBridgePlugin());
        }

        // ── DELIBERATELY OUTSIDE the `cluster !== false` branch above ───────
        // [#11968; shape ruled at #12679, option A] The authorization-cache
        // substrate's bridge and its boot-time posture statement, registered
        // UNCONDITIONALLY — `cluster: false` included.
        //
        // WHAT this does to the flag, stated because it is surprising:
        // `cluster: false` does NOT mean "`@objectstack/service-cluster`
        // contributes nothing". It means the two CLUSTER plugins above are
        // skipped; this one is not. Someone reading `cluster: false` in a
        // config reasonably concludes the opposite, so the same statement is
        // carried author-facing on the `cluster` option's docblock and in
        // `content/docs/kernel/cluster.mdx` §8. Change the placement here and
        // those two go stale.
        //
        // WHY it is unconditional: the plugin exists to say out loud when a
        // grants cache is running with no invalidation bus, and "no cluster
        // service at all" is the LOUDEST case it has — not an exemption from
        // it. Moving this line inside the branch would put the statement's
        // absence exactly where the missing bus is, which is #4785's shape: a
        // security-relevant mechanism absent with nothing said. That is the
        // one refactor this comment exists to stop. Relocating the statement
        // to `core`/kernel instead was weighed at #12679 and ruled against;
        // it re-opens only if `cluster` becomes a customer-facing public
        // config option.
        //
        // Inert on the shipped default: with OS_AUTHZ_GRANTS_CACHE_TTL_MS at 0
        // it attaches nothing, publishes nothing and logs nothing above debug.
        //
        // Pinned BY NAME, not by count, in `runtime.test.ts` — see
        // "cluster:false skips the CLUSTER plugins": dropping this line reds
        // that test with the bridge's plugin id in the failure message.
        this.kernel.use(new AuthzClusterBridgePlugin());
    }

    private normalizeClusterOptions(
        raw: RuntimeConfig['cluster'],
    ): ClusterServicePluginOptions {
        if (!raw) return {};
        // Discriminate by shape: presence of `cluster` (instance) or
        // explicit `config` key means it's already an options bag.
        if (
            typeof raw === 'object' &&
            ('cluster' in raw || 'config' in raw) &&
            !('driver' in raw)
        ) {
            return raw as ClusterServicePluginOptions;
        }
        // Otherwise treat as `ClusterCapabilityConfig`.
        return { config: raw as ClusterCapabilityConfig };
    }
    
    /**
     * Register a plugin
     */
    use(plugin: Plugin) {
        this.kernel.use(plugin);
        return this;
    }
    
    /**
     * Start the runtime
     * 1. Initializes all plugins (init phase)
     * 2. Starts all plugins (start phase)
     */
    async start() {
        await this.kernel.bootstrap();
        return this;
    }
    
    /**
     * Get the kernel instance
     */
    getKernel() {
        return this.kernel;
    }
}
