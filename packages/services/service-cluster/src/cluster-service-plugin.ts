// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IClusterService } from '@objectstack/spec/contracts';
import type { ClusterCapabilityConfigInput } from '@objectstack/spec/kernel';
import { defineCluster } from './cluster.js';

/**
 * Options for `ClusterServicePlugin`.
 *
 * Pass either a pre-built `cluster` instance (advanced — for tests or
 * custom drivers), or a `config` object that will be passed to
 * `defineCluster()`. If both are omitted, a memory-driver cluster is
 * created with auto-generated nodeId.
 */
export interface ClusterServicePluginOptions {
    /** Pre-built cluster service. Wins over `config` when both provided. */
    cluster?: IClusterService;
    /** Config forwarded to `defineCluster()` when `cluster` is absent. */
    config?: ClusterCapabilityConfigInput;
}

/**
 * Registers an `IClusterService` under the well-known service name
 * `'cluster'`. Plugins consume it via:
 *
 * ```ts
 * import type { IClusterService } from '@objectstack/spec/contracts';
 * const cluster = ctx.getService<IClusterService>('cluster');
 * await cluster.pubsub.publish('metadata.changed', payload);
 * ```
 *
 * The plugin closes the cluster on kernel shutdown.
 *
 * @example default memory driver
 *   kernel.use(new ClusterServicePlugin());
 *
 * @example explicit config
 *   kernel.use(new ClusterServicePlugin({ config: { driver: 'memory', nodeId: 'web-1' } }));
 */
export class ClusterServicePlugin implements Plugin {
    name = 'com.objectstack.service.cluster';
    version = '1.0.0';
    type = 'standard';

    private readonly options: ClusterServicePluginOptions;
    private cluster?: IClusterService;
    private owned = false;

    constructor(options: ClusterServicePluginOptions = {}) {
        this.options = options;
    }

    async init(ctx: PluginContext): Promise<void> {
        if (this.options.cluster) {
            this.cluster = this.options.cluster;
            this.owned = false;
        } else {
            this.cluster = defineCluster(this.options.config ?? {});
            this.owned = true;
        }
        ctx.registerService('cluster', this.cluster);
        ctx.logger.info(
            `ClusterServicePlugin: registered "${this.cluster.driver}" driver (node=${this.cluster.nodeId})`,
        );

        ctx.hook('kernel:shutdown', async () => {
            if (this.owned && this.cluster) {
                try {
                    await this.cluster.close();
                } catch (err) {
                    ctx.logger.error('ClusterServicePlugin: close error', err as Error);
                }
            }
        });
    }
}
