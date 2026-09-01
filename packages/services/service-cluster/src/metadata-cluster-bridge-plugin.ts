// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IClusterService } from '@objectstack/spec/contracts';
import { isInProcessClusterDriver } from './split-brain-guard.js';

/**
 * Bridges the cluster pub/sub bus to the metadata state owners so that
 * metadata mutations on one node invalidate registry caches on peer
 * nodes. Implements the "first real consumer" of the cluster API.
 *
 * Implementation detail: this plugin lives in `@objectstack/service-cluster`
 * (not in `@objectstack/metadata` / `@objectstack/metadata-protocol`) to
 * avoid forcing every metadata consumer to pull the cluster service. The
 * state-owner packages only need the `IPubSub` interface, which lives in
 * `@objectstack/spec/contracts`.
 *
 * TWO lanes, late-bound independently at `kernel:ready`, because the state
 * that goes stale lives in two different owners (#13331):
 *
 *  1. **Metadata service** (`attachClusterPubSub()` — `metadata.changed`):
 *     replays watch events into peer `MetadataManager` caches
 *     (registry/list-cache invalidation, #5109). Only a real manager exposes
 *     the seam; the host-config boot's in-memory core fallback does not, and
 *     the warn below says so.
 *  2. **Metadata protocol** (`attachMetadataMutationPubSub()` —
 *     `metadata.mutated`): fans the protocol's post-persistence mutation
 *     signal out to peers, which re-run the ObjectQL registry write-through
 *     from their OWN `sys_metadata` read. This is the lane behind the data
 *     plane: without it, an object authored at runtime through
 *     `PUT /api/v1/meta/*` answers OBJECT_NOT_FOUND on every replica that
 *     did not perform the write, until restart (#13331 — measured on a
 *     3-replica EE deployment: 200 concurrent creates through the LB gave
 *     67×201 / 133×404). The lanes are independent on purpose: the boot
 *     shape that lacks lane 1 (host-config, fallback metadata slot) is
 *     exactly the shipped EE shape that needs lane 2.
 *
 * Activates each lane only when the cluster service and that lane's state
 * owner are present and expose the seam. Late binding is achieved via the
 * `kernel:ready` lifecycle hook.
 *
 * Channels: `metadata.changed` — payload shape defined by
 * `ClusterMetadataChangedPayload` in `@objectstack/metadata`;
 * `metadata.mutated` — payload shape defined by
 * `ClusterMetadataMutationPayload` in `@objectstack/metadata-protocol`.
 *
 * See `content/docs/kernel/cluster.mdx` §5.
 */
export class MetadataClusterBridgePlugin implements Plugin {
    name = 'com.objectstack.service.metadata-cluster-bridge';
    version = '1.0.0';
    type = 'standard';

    private detach?: () => void;
    private detachMutation?: () => void;

    async init(ctx: PluginContext): Promise<void> {
        ctx.hook('kernel:ready', async () => {
            let cluster: IClusterService | undefined;
            try {
                cluster = ctx.getService<IClusterService>('cluster');
            } catch {
                ctx.logger.debug(
                    'MetadataClusterBridgePlugin: no "cluster" service registered, skipping',
                );
                return;
            }
            this.attachMetadataServiceLane(ctx, cluster);
            this.attachProtocolLane(ctx, cluster);
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
            try {
                this.detachMutation?.();
            } catch (err) {
                ctx.logger.error(
                    'MetadataClusterBridgePlugin: mutation-lane detach error',
                    err as Error,
                );
            }
            this.detachMutation = undefined;
        });
    }

    /**
     * Lane 1 — the metadata SERVICE's `metadata.changed` bridge, exactly as
     * it has always behaved (its log lines are measured facts other cards
     * lean on — the warn below is #13331's original boot symptom, and it
     * remains TRUE on the host-config boot: the fallback metadata slot has
     * no cluster seam, so metadata-SERVICE cache invalidation stays off
     * there. The data-plane registry gap that warn used to imply is what
     * lane 2 closes.)
     */
    private attachMetadataServiceLane(ctx: PluginContext, cluster: IClusterService): void {
        let md: unknown;
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
    }

    /**
     * Lane 2 — the metadata PROTOCOL's `metadata.mutated` fan-out (#13331).
     *
     * Duck-typed exactly like lane 1 feature-detects `attachClusterPubSub()`:
     * this package must not depend on `@objectstack/metadata-protocol`.
     *
     * Guarded on {@link isInProcessClusterDriver} from birth (the shape
     * `AuthzClusterBridgePlugin` uses): the in-process memory driver fans out
     * to nobody, so "attached" there would be the misreading #14021 records
     * for lane 1's info line — a new lane does not inherit a known defect.
     */
    private attachProtocolLane(ctx: PluginContext, cluster: IClusterService): void {
        let protocol: unknown;
        try {
            protocol = ctx.getService<unknown>('protocol');
        } catch {
            ctx.logger.debug(
                'MetadataClusterBridgePlugin: no "protocol" service registered, skipping mutation fan-out',
            );
            return;
        }

        const attach = (protocol as { attachMetadataMutationPubSub?: unknown })
            .attachMetadataMutationPubSub;
        if (typeof attach !== 'function') {
            ctx.logger.debug(
                'MetadataClusterBridgePlugin: protocol service does not expose attachMetadataMutationPubSub(), skipping mutation fan-out',
            );
            return;
        }

        if (isInProcessClusterDriver(cluster.driver)) {
            ctx.logger.debug(
                `MetadataClusterBridgePlugin: cluster driver "${cluster.driver}" is in-process; mutation fan-out has no peers to reach, skipping`,
            );
            return;
        }

        try {
            this.detachMutation = (attach as (
                pubsub: IClusterService['pubsub'],
                nodeId: string,
            ) => () => void).call(protocol, cluster.pubsub, cluster.nodeId);
            ctx.logger.info(
                `MetadataClusterBridgePlugin: bridged metadata.mutated → cluster.pubsub (node=${cluster.nodeId})`,
            );
        } catch (err) {
            ctx.logger.error(
                'MetadataClusterBridgePlugin: mutation-lane attach failed',
                err as Error,
            );
        }
    }
}
