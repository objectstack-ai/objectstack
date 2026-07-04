// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IClusterService } from '@objectstack/spec/contracts';

/**
 * Bridges the cluster pub/sub bus to the metadata service so that
 * metadata mutations on one node invalidate registry caches on peer
 * nodes. Implements the "first real consumer" of the cluster API.
 *
 * Implementation detail: this plugin lives in `@objectstack/service-cluster`
 * (not in `@objectstack/metadata`) to avoid forcing every metadata
 * consumer to pull the cluster service. The metadata package only needs
 * the `IPubSub` interface, which lives in `@objectstack/spec/contracts`.
 *
 * Activates only when both services are present and the metadata service
 * exposes `attachClusterPubSub()`. Late binding is achieved via the
 * `kernel:ready` lifecycle hook.
 *
 * Channel: `metadata.changed` — payload shape defined by
 * `ClusterMetadataChangedPayload` in `@objectstack/metadata`.
 *
 * See `content/docs/kernel/cluster.mdx` §5.
 */
export class MetadataClusterBridgePlugin implements Plugin {
    name = 'com.objectstack.service.metadata-cluster-bridge';
    version = '1.0.0';
    type = 'standard';

    private detach?: () => void;

    async init(ctx: PluginContext): Promise<void> {
        ctx.hook('kernel:ready', async () => {
            let cluster: IClusterService | undefined;
            let md: unknown;
            try {
                cluster = ctx.getService<IClusterService>('cluster');
            } catch {
                ctx.logger.debug(
                    'MetadataClusterBridgePlugin: no "cluster" service registered, skipping',
                );
                return;
            }
            try {
                md = ctx.getService<unknown>('metadata');
            } catch {
                ctx.logger.debug(
                    'MetadataClusterBridgePlugin: no "metadata" service registered, skipping',
                );
                return;
            }

            const attach = (md as { attachClusterPubSub?: unknown })
                .attachClusterPubSub;
            if (typeof attach !== 'function') {
                ctx.logger.warn(
                    'MetadataClusterBridgePlugin: metadata service does not expose attachClusterPubSub(); cross-node cache invalidation disabled',
                );
                return;
            }

            try {
                this.detach = (attach as (
                    pubsub: IClusterService['pubsub'],
                    nodeId: string,
                ) => () => void).call(md, cluster.pubsub, cluster.nodeId);
                ctx.logger.info(
                    `MetadataClusterBridgePlugin: bridged metadata.changed → cluster.pubsub (node=${cluster.nodeId})`,
                );
            } catch (err) {
                ctx.logger.error(
                    'MetadataClusterBridgePlugin: attach failed',
                    err as Error,
                );
            }
        });

        ctx.hook('kernel:shutdown', async () => {
            try {
                this.detach?.();
            } catch (err) {
                ctx.logger.error(
                    'MetadataClusterBridgePlugin: detach error',
                    err as Error,
                );
            }
            this.detach = undefined;
        });
    }
}
