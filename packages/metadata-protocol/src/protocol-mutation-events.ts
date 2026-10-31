// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the metadata
// mutation and publish event contracts, the cluster channel, and the mutation projector.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.

/**
 * Post-persistence metadata-mutation notification (#2588). Emitted by
 * `saveMetaItem` / `publishMetaItem` / `deleteMetaItem` AFTER the write
 * landed. `type` is the singular metadata type name. Subscribe via
 * {@link ObjectStackProtocolImplementation.onMetadataMutation}.
 */
export interface MetadataMutationEvent {
    type: string;
    name: string;
    /** Resulting lifecycle state of the row the mutation produced. */
    state: 'active' | 'draft' | 'deleted';
    organizationId?: string | null;
    /**
     * [#22877] The bundle member the mutated row belongs to, for a type whose
     * identity is a pair (`'zh-CN'` of an `email_template`) — part of the
     * row's ADDRESS, so a peer converging on this signal re-reads that
     * member's row, not the canonical one. Absent for the canonical member and
     * for every type with no members, as on every by-name door.
     */
    member?: string;
}

/**
 * [#13331] Cluster channel for post-persistence metadata mutations — the
 * cross-node half of {@link MetadataMutationEvent}.
 *
 * Published by the protocol that performed the write (see
 * `attachMetadataMutationPubSub`) and consumed by every peer replica to
 * CONVERGE its in-memory registry from its OWN `sys_metadata` read. Distinct
 * from `MetadataManager`'s `metadata.changed` channel on purpose: that one
 * replays watch events into the metadata SERVICE's caches, while this one
 * repairs the ObjectQL engine registry behind the data plane — the state the
 * runtime authoring path (`saveMetaItem` → `applyRegistryWriteThrough`)
 * mutates without ever touching the metadata service.
 */
export const METADATA_MUTATION_CLUSTER_CHANNEL = 'metadata.mutated';

/**
 * [#13331] Payload for {@link METADATA_MUTATION_CLUSTER_CHANNEL}.
 *
 * ⭐ A SIGNAL, never trusted content (ruled 2026-09-01): the receiving replica
 * re-reads the row from its own `sys_metadata` and re-runs the registry
 * write-through from that read, so the shared database stays the single
 * source of truth. `event` carries only the row's ADDRESS (type/name/state/
 * org scope); no body ever rides this channel, which is also what makes
 * at-least-once delivery and duplicates harmless by construction — replaying
 * the same address converges to the same registry state.
 */
export interface ClusterMetadataMutationPayload {
    /** Origin nodeId — used for loopback suppression. */
    originNode?: string;
    /** The post-persistence mutation notification, address-only. */
    event: MetadataMutationEvent;
}

/**
 * [#10219] A single item reached `active` through the per-item publish door
 * (`publishMetaItem`, i.e. `POST /api/v1/meta/:type/:name/publish`). `type` is
 * the CANONICAL singular metadata type name — the same spelling the promoted
 * row carries — so a subscriber can build the `'{type}/{name}'` entry the
 * `metadata:reloaded` payload's `changed` list is made of.
 *
 * Subscribe via {@link ObjectStackProtocolImplementation.onMetaItemPublished}.
 *
 * ## Why this is NOT the existing {@link MetadataMutationEvent}
 *
 * The per-item publish emits BOTH. The mutation event says "a row changed" and
 * is emitted from `runPublishSideEffects`, the phase-2 helper the BATCH door
 * (`publishPackageDrafts`) runs once per promoted draft as well — so a
 * subscriber that announced a full metadata reload on it would fire N times for
 * one "publish whole app", each announce driving a complete re-sync (schema DDL,
 * connector re-materialization, flow re-bind) for every other item in the same
 * batch. This event is emitted ONLY by the single-item door, which is the one
 * the batch route's own announce does not cover.
 */
export interface MetaItemPublishedEvent {
    /** Canonical singular metadata type of the promoted item. */
    type: string;
    name: string;
    /** Scope the promotion landed in — `null` is env-wide. */
    organizationId: string | null;
}

/**
 * Awaited per-type mutation projector (ADR-0094). Invoked AFTER a metadata
 * mutation persists — `saveMetaItem` (draft AND active saves),
 * `publishMetaItem`, `deleteMetaItem` — and AWAITED before the write returns,
 * so a data-plane read-model derived from the metadata (e.g. the
 * `datasource` projector's) is already consistent when the caller's next read
 * lands. This is what makes such a read-model a PURE projection: the
 * projector is its only writer, and it runs in the same awaited operation as
 * every metadata write, instead of a fire-and-forget subscriber a new write
 * path might race or forget.
 *
 * Complements (does not replace) {@link MetadataMutationEvent} listeners,
 * which stay fire-and-forget for cache-invalidation consumers.
 *
 * Best-effort: a projector failure is surfaced on the write's response
 * (`projectionApplied: { success:false, error }`) and logged, never thrown —
 * the metadata write itself already succeeded, and boot reconciliation heals
 * the projection on next start.
 *
 * `body` carries the just-persisted item when the mutation has one in hand
 * (save/publish); projectors that need the EFFECTIVE (layered) body should
 * re-read it — a delete, for instance, may reveal the artifact baseline.
 */
export type MetadataMutationProjector = (
    evt: MetadataMutationEvent & { body?: unknown },
) => Promise<void>;

/** Per-write outcome of the awaited mutation projector (ADR-0094). */
export interface MutationProjectionOutcome {
    success: boolean;
    error?: string;
}
