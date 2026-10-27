// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 25] The post-persistence mutation fan-out of
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole: the
 * four members that tell the rest of the process — and, through the cluster
 * transport, the rest of the fleet — that a metadata write has landed.
 *
 *  - `runMutationProjector` — the registered projector for a just-persisted
 *    mutation (ADR-0094), awaited, never throwing.
 *  - `notifyMutationListenersLocal` — the LOCAL half of
 *    `emitMetadataMutation` (#2588, #13331): each listener isolated.
 *  - `publishMetadataMutation` — the cluster half of `emitMetadataMutation`
 *    (#13331): the mutation's address to peers, fire-and-forget, drafts
 *    skipped.
 *  - `emitMetaItemPublished` — the per-item publish listeners (#10219),
 *    awaited and isolated.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same order, the same
 * isolation, the same log lines.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link MutationFanOutHost} members it reads, plus a `.call`. Every
 * member read is a field, so each is handed over as a getter: the body reads
 * the protocol's own listener arrays, projector map and cluster wiring at
 * call time — `attachMetadataMutationPubSub` and
 * `detachMetadataMutationPubSub` reassign `clusterPubSub` and
 * `clusterNodeId`, and the getters see the current values, as the bodies did.
 *
 * The callers stay in the class and keep calling the class methods:
 * `emitMetadataMutation` (local, then cluster), `applyRemoteMetadataMutation`
 * (local only), the seven projecting doors and the per-item publish door. So
 * the call-site counts that `protocol.recovery-doors-emit-mutation.test.ts`
 * and `protocol.recovery-doors-mutation-projector.test.ts` take over
 * `protocol.ts` do not move.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * declares it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type {
    ClusterMetadataMutationPayload,
    MetadataMutationEvent,
    MetaItemPublishedEvent,
    MutationProjectionOutcome,
    ObjectStackProtocolImplementation,
} from './protocol.js';
import { METADATA_MUTATION_CLUSTER_CHANNEL } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's type on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface MutationFanOutHost {
    readonly mutationProjectors: ObjectStackProtocolImplementation['mutationProjectors'];
    readonly metadataMutationListeners: ObjectStackProtocolImplementation['metadataMutationListeners'];
    readonly clusterPubSub: ObjectStackProtocolImplementation['clusterPubSub'];
    readonly clusterNodeId: ObjectStackProtocolImplementation['clusterNodeId'];
    readonly metaItemPublishedListeners: ObjectStackProtocolImplementation['metaItemPublishedListeners'];
}

/** The body of `ObjectStackProtocolImplementation#runMutationProjector`; the method's docblock there is its contract. */
export async function runMutationProjector(
    this: Pick<MutationFanOutHost, 'mutationProjectors'>,
    evt: MetadataMutationEvent & { body?: unknown },
): Promise<MutationProjectionOutcome | undefined> {
    const projector = this.mutationProjectors.get(evt.type);
    if (!projector) return undefined;
    try {
        await projector(evt);
        return { success: true };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.warn(
            `[Protocol] mutation projector failed for ${evt.type}/${evt.name} (state=${evt.state}): ${error}`,
        );
        return { success: false, error };
    }
}

/** The body of `ObjectStackProtocolImplementation#notifyMutationListenersLocal`; the method's docblock there is its contract. */
export function notifyMutationListenersLocal(
    this: Pick<MutationFanOutHost, 'metadataMutationListeners'>,
    evt: MetadataMutationEvent,
): void {
    for (const listener of this.metadataMutationListeners) {
        try {
            listener(evt);
        } catch (e) {
            console.warn(
                `[Protocol] metadata-mutation listener failed for ${evt.type}/${evt.name}: `
                + `${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }
}

/** The body of `ObjectStackProtocolImplementation#publishMetadataMutation`; the method's docblock there is its contract. */
export function publishMetadataMutation(
    this: Pick<MutationFanOutHost, 'clusterPubSub' | 'clusterNodeId'>,
    evt: MetadataMutationEvent,
): void {
    if (!this.clusterPubSub) return;
    if (evt.state === 'draft') return;
    const payload: ClusterMetadataMutationPayload = {
        originNode: this.clusterNodeId,
        event: evt,
    };
    void this.clusterPubSub
        .publish(METADATA_MUTATION_CLUSTER_CHANNEL, payload, {
            partitionKey: `${evt.type}:${evt.name}`,
        })
        .catch((err) => {
            console.warn(
                `[Protocol] cluster metadata-mutation publish failed for `
                + `${evt.type}/${evt.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
}

/** The body of `ObjectStackProtocolImplementation#emitMetaItemPublished`; the method's docblock there is its contract. */
export async function emitMetaItemPublished(
    this: Pick<MutationFanOutHost, 'metaItemPublishedListeners'>,
    evt: MetaItemPublishedEvent,
): Promise<void> {
    for (const listener of this.metaItemPublishedListeners) {
        try {
            await listener(evt);
        } catch (e) {
            console.warn(
                `[Protocol] the post-publish re-bind announce FAILED for ${evt.type}/${evt.name} — the item IS `
                + `published and stored, but boot-cached consumers keep the PRE-publish view until this process `
                + `restarts: a newly published record-triggered flow does not bind its trigger (it will not fire), `
                + `an edited schedule-triggered flow keeps running its old definition, and authored hooks, actions `
                + `and translations are not re-synced. Nothing retries this announce. Re-publish the item once the `
                + `cause below is resolved (it is idempotent), or restart the process to rebuild every subscriber `
                + `from storage. Cause: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }
}
