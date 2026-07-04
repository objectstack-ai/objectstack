// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectKernel, Plugin, IHttpServer, ObjectKernelConfig } from '@objectstack/core';
import {
    ClusterServicePlugin,
    MetadataClusterBridgePlugin,
    type ClusterServicePluginOptions,
} from '@objectstack/service-cluster';
import type { ClusterCapabilityConfigInput } from '@objectstack/spec/kernel';

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
     * - `false`: skip auto-registration entirely. Register your own
     *   `ClusterServicePlugin` if you need it later.
     * - `ClusterCapabilityConfigInput`: forwarded to `defineCluster()`.
     * - `{ cluster: IClusterService }`: bring your own instance.
     *
     * See `content/docs/kernel/cluster.mdx` for driver options.
     */
    cluster?: false | ClusterCapabilityConfigInput | ClusterServicePluginOptions;
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
        // Otherwise treat as `ClusterCapabilityConfigInput`.
        return { config: raw as ClusterCapabilityConfigInput };
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
