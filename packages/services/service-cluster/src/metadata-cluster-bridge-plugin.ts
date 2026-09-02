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
 * THREE lanes, late-bound independently at `kernel:ready`, because the state
 * that goes stale lives in three different owners (#13331, #13805):
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
 *  3. **Datasource admin service** (`attachDatasourceMutationPubSub()` —
 *     `datasource.mutated`): fans a datasource create / update / delete out
 *     to peers, which converge their ObjectQL DRIVER registry from their OWN
 *     read of the shared datasource record. Lane 2's family, adopted by the
 *     driver registry (#13805, ruled 2026-09-01 — the same bridge shape, a
 *     symmetric signal, no second propagation mechanism): without it a
 *     `DELETE /api/v1/datasources/:name` recovered `/api/v1/ready` on the
 *     one replica that served it, and every other replica kept the stuck
 *     driver until restart.
 *
 * Activates each lane only when the cluster service and that lane's state
 * owner are present and expose the seam. Late binding is achieved via the
 * `kernel:ready` lifecycle hook.
 *
 * Channels: `metadata.changed` — payload shape defined by
 * `ClusterMetadataChangedPayload` in `@objectstack/metadata`;
 * `metadata.mutated` — payload shape defined by
 * `ClusterMetadataMutationPayload` in `@objectstack/metadata-protocol`;
 * `datasource.mutated` — payload shape defined by
 * `ClusterDatasourceMutationPayload` in `@objectstack/service-datasource`.
 *
 * See `content/docs/kernel/cluster.mdx` §5.
 */
export class MetadataClusterBridgePlugin implements Plugin {
    name = 'com.objectstack.service.metadata-cluster-bridge';
    version = '1.0.0';
    type = 'standard';

    private detach?: () => void;
    private detachMutation?: () => void;
    private detachDatasource?: () => void;

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
            this.attachDatasourceLane(ctx, cluster);
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
            try {
                this.detachDatasource?.();
            } catch (err) {
                ctx.logger.error(
                    'MetadataClusterBridgePlugin: datasource-lane detach error',
                    err as Error,
                );
            }
            this.detachDatasource = undefined;
        });
    }

    /**
     * Lane 1 — the metadata SERVICE's `metadata.changed` bridge.
     *
     * The warn below is a measured fact other cards lean on: it is #13331's
     * original boot symptom and it remains TRUE and VERBATIM on the
     * host-config boot, where the fallback metadata slot has no cluster
     * seam, so metadata-SERVICE cache invalidation stays off there. The
     * data-plane registry gap that warn used to imply is what lane 2 closes.
     *
     * [#14021] Guarded on {@link isInProcessClusterDriver} — the shape
     * `AuthzClusterBridgePlugin` uses and the one lane 2 was born with. A
     * cluster service IS registered — `Runtime` registers the memory driver
     * by default — but it fans out to nobody. Reporting this as "bridged" is
     * the exact misreading the posture statement exists to prevent.
     *
     * The authz bridge's header exempts THIS bridge from having to speak
     * when a cluster service is ABSENT, because a missed `metadata.changed`
     * costs a stale schema and loses no data. That exemption is about
     * SILENCE; it does not licence asserting "bridged" over a bus that
     * crosses no process boundary, which is a false positive rather than a
     * quiet negative. So the in-process arm is stated at `debug`, matching
     * lane 2 — the deliberate level difference between the two bridges
     * (#11968) is not what this card touches.
     *
     * Skipping the attach — rather than attaching and softening the log — is
     * what both in-tree exemplars do, and here it reaches nothing: the only
     * subscriber of `metadata.changed` in the tree is the same
     * `MetadataManager` that publishes it, and its loopback guard drops
     * every message whose `originNode` equals its own node id. On an
     * in-process bus that is every message.
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

        if (isInProcessClusterDriver(cluster.driver)) {
            ctx.logger.debug(
                `MetadataClusterBridgePlugin: cluster driver "${cluster.driver}" is in-process; metadata.changed fan-out has no peers to reach, skipping`,
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

    /**
     * Lane 3 — the datasource ADMIN SERVICE's `datasource.mutated` fan-out
     * (#13805): the driver registry adopting the family lane 2 established.
     *
     * Duck-typed exactly like lanes 1 and 2 feature-detect their seams: this
     * package must not depend on `@objectstack/service-datasource`, and
     * `@objectstack/objectql` — the driver registry's owner — is handed no
     * bus at all; the admin service publishes on the write doors it already
     * owns and converges its pools through the seams it already injects.
     *
     * Guarded on {@link isInProcessClusterDriver} from birth, like lane 2: the
     * in-process memory driver fans out to nobody, and on that driver a single
     * replica's behaviour stays byte-identical to the pre-bridge one.
     */
    private attachDatasourceLane(ctx: PluginContext, cluster: IClusterService): void {
        let admin: unknown;
        try {
            admin = ctx.getService<unknown>('datasource-admin');
        } catch {
            ctx.logger.debug(
                'MetadataClusterBridgePlugin: no "datasource-admin" service registered, skipping datasource fan-out',
            );
            return;
        }

        const attach = (admin as { attachDatasourceMutationPubSub?: unknown })
            .attachDatasourceMutationPubSub;
        if (typeof attach !== 'function') {
            ctx.logger.debug(
                'MetadataClusterBridgePlugin: datasource-admin service does not expose attachDatasourceMutationPubSub(), skipping datasource fan-out',
            );
            return;
        }

        if (isInProcessClusterDriver(cluster.driver)) {
            ctx.logger.debug(
                `MetadataClusterBridgePlugin: cluster driver "${cluster.driver}" is in-process; datasource fan-out has no peers to reach, skipping`,
            );
            return;
        }

        try {
            this.detachDatasource = (attach as (
                pubsub: IClusterService['pubsub'],
                nodeId: string,
            ) => () => void).call(admin, cluster.pubsub, cluster.nodeId);
            ctx.logger.info(
                `MetadataClusterBridgePlugin: bridged datasource.mutated → cluster.pubsub (node=${cluster.nodeId})`,
            );
        } catch (err) {
            ctx.logger.error(
                'MetadataClusterBridgePlugin: datasource-lane attach failed',
                err as Error,
            );
        }
    }
}
