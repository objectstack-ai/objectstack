// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Class head: fields, stored-row conversion, resolvers,
 * registration hooks, authoring gates, mutation pub/sub, overlay index" facet
 * of `ObjectStackProtocolImplementation`: the bodies of
 * `resolveCascadeDeleteObjects`, `registerPublishMaterializer`,
 * `registerUninstallCleanup`, `runUninstallCleanups`,
 * `registerMutationProjector`, `registerAuthoringGate`,
 * `registerCredentialChannel`, `restoreWriteFor`,
 * `registerStoredObjectExtension`, `resyncStoredObjectExtensions`,
 * `onMetadataMutation`, `emitMetadataMutation`, `attachMetadataMutationPubSub`,
 * `detachMetadataMutationPubSub`, `applyRemoteMetadataMutation`,
 * `onMetaItemPublished`, `getOverlayRepo` moved out of `protocol.ts` whole by
 * `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolClassHeadFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { declaredUserMessage } from '@objectstack/types';
import { SysMetadataRepository } from './sys-metadata-repository.js';
import type { SysMetadataEngine } from './sys-metadata-repository.js';
import { storedRowDocument } from './item-lock.js';
import { bumpWriteEpoch } from './meta-overlay-cache.js';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { IObjectQLEngine, IPubSub } from '@objectstack/spec/contracts';
import { isCustomizationPairOf } from '@objectstack/spec/kernel';
import { overrideWriteRefusalError } from './protocol-packaged-base-refusal.js';
import { OBJECT_EXTENSION_TYPE, registrableObjectExtension } from './protocol-object-extension-item.js';
import type { ObjectExtensionRegistry } from './protocol-object-extension-item.js';
import { canonicalMetaType } from './protocol-meta-type-schema.js';
import { boundPackageOf } from './protocol-package-bindings.js';
import { memberOption } from './protocol-bundle-members.js';
import { clientFacingFailureText } from './protocol-client-failures.js';
import type {
    DeletePackageRequest,
    PublishMaterializer,
    UninstallCleanup,
    UninstallCleanupOutcome,
    UninstallDeclared,
} from './protocol-package-lifecycle-types.js';
import { METADATA_MUTATION_CLUSTER_CHANNEL } from './protocol-mutation-events.js';
import type {
    ClusterMetadataMutationPayload,
    MetaItemPublishedEvent,
    MetadataMutationEvent,
    MetadataMutationProjector,
} from './protocol-mutation-events.js';
import type { MetadataAuthoringGate, MetadataCredentialChannel } from './protocol-authoring-channel.js';
import type { ProtocolHost } from './protocol-host.js';

export class ProtocolClassHeadFacet {
    /**
     * [#28001] The `cascadeDeleteObjects` beside an `object` item read's
     * envelope (`GetMetaItemResponseSchema` in `@objectstack/spec`): the
     * objects a delete of one of `name`'s records can cascade into, as the data
     * engine answers it from the rule its delete walk runs
     * (`IObjectQLEngine.getCascadeDeleteObjects`).
     *
     * The seam {@link resolveDisabledActionsReader} uses, for its reasons: the
     * kernel's service table, read by name per call (`objectql`), for an
     * optional member the engine declares on its contract. This package never
     * imports the engine, and it holds no copy of which relations cascade.
     *
     * `undefined` — so the read serves NO key — for every other type, where no
     * reachable engine declares the member, and where the engine does not
     * hold the object. ⛔ Never `[]` in those cases: `[]` is the engine's own
     * "nothing cascades".
     */
    static resolveCascadeDeleteObjects(host: Pick<ProtocolHost, 'getServicesRegistry'>, type: string, name: string): string[] | undefined {
        if (canonicalMetaType(type) !== 'object') return undefined;
        const engine = host.getServicesRegistry?.().get('objectql') as
            | Pick<IObjectQLEngine, 'getCascadeDeleteObjects'>
            | undefined;
        const read = engine?.getCascadeDeleteObjects;
        if (typeof read !== 'function') return undefined;
        const answer = read.call(engine, name);
        return Array.isArray(answer) ? [...answer] : undefined;
    }

    /** The body of `ObjectStackProtocolImplementation#registerPublishMaterializer`; the method's docblock there is its contract. */
    static registerPublishMaterializer(host: Pick<ProtocolHost, 'publishMaterializers'>, type: string, materializer: PublishMaterializer): void {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        host.publishMaterializers.set(singular, materializer);
    }

    /** The body of `ObjectStackProtocolImplementation#registerUninstallCleanup`; the method's docblock there is its contract. */
    static registerUninstallCleanup(host: Pick<ProtocolHost, 'uninstallCleanups'>, name: string, cleanup: UninstallCleanup): void {
        host.uninstallCleanups.set(name, cleanup);
    }

    /** The body of `ObjectStackProtocolImplementation#runUninstallCleanups`; the method's docblock there is its contract. */
    static async runUninstallCleanups(host: Pick<ProtocolHost, 'uninstallCleanups'>, request: Pick<DeletePackageRequest, 'packageId' | 'actor'> & { declared?: UninstallDeclared },): Promise<UninstallCleanupOutcome[]> {
        const cleanups: UninstallCleanupOutcome[] = [];
        for (const [name, cleanup] of host.uninstallCleanups) {
            try {
                const r = await cleanup({
                    packageId: request.packageId,
                    ...(request.actor ? { actor: request.actor } : {}),
                    ...(request.declared ? { declared: request.declared } : {}),
                });
                cleanups.push({
                    name,
                    success: r?.success !== false,
                    removed: typeof r?.removed === 'number' ? r.removed : 0,
                    ...(r?.error ? { error: r.error } : {}),
                });
            } catch (e: any) {
                // [#8136] A cleanup is arbitrary plugin code that goes straight
                // at the engine (plugin-security deletes the grant rows that
                // name the package's sets), so a driver failure lands here
                // verbatim — and this outcome rides on the RESPONSE by design,
                // inside `details`, where no boundary's message withhold can
                // reach it. Quoted only when the cleanup declared a refusal.
                // [#12536] The mark travels beside the withheld sentence, not
                // instead of it: `error` stays whatever #8136's rule licenses,
                // and a cleanup that refused in the author's own words is still
                // reported as a refusal rather than as one that merely
                // "failed".
                const cleanupUserMessage = declaredUserMessage(e);
                cleanups.push({
                    name,
                    success: false,
                    removed: 0,
                    error: clientFacingFailureText(e, 'cleanup failed'),
                    ...(cleanupUserMessage !== undefined ? { userMessage: cleanupUserMessage } : {}),
                });
                console.warn(
                    `[protocol.runUninstallCleanups] uninstall cleanup '${name}' failed for '${request.packageId}': ${e?.message}`,
                );
            }
        }
        return cleanups;
    }

    /** The body of `ObjectStackProtocolImplementation#registerMutationProjector`; the method's docblock there is its contract. */
    static registerMutationProjector(host: Pick<ProtocolHost, 'mutationProjectors'>, type: string, projector: MetadataMutationProjector): void {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        host.mutationProjectors.set(singular, projector);
    }

    /** The body of `ObjectStackProtocolImplementation#registerAuthoringGate`; the method's docblock there is its contract. */
    static registerAuthoringGate(host: Pick<ProtocolHost, 'authoringGates'>, type: string, gate: MetadataAuthoringGate): void {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        host.authoringGates.set(singular, gate);
    }

    /** The body of `ObjectStackProtocolImplementation#registerCredentialChannel`; the method's docblock there is its contract. */
    static registerCredentialChannel(host: Pick<ProtocolHost, 'credentialChannels'>, type: string, channel: MetadataCredentialChannel): void {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        host.credentialChannels.set(singular, channel);
    }

    /**
     * [ADR-0146 D2] The write intent and the body writer of a restore into
     * the row `binding` names — the per-item rollback's ({@link rollbackMetaItem})
     * and [#29414] a commit revert's restore limb ({@link revertCommit}), one
     * derivation for both.
     *
     * A restore into the base's paired `.custom` row is the pair's declared
     * override, as its save is: it edits no managed item, so the store is told
     * a runtime-only write, and the restored body is judged by the override
     * write gate into the pair ({@link overrideWriteVerdict}). A version that
     * declares no override (a body the base row stored, which a commit plan
     * recorded before #29414 can name) is refused as the save is
     * (`overrideWriteRefusalError`, `403 NOT_OVERRIDABLE`), thrown from inside
     * `deriveRestoredBody`, so nothing is written. Any other binding: the
     * caller's `artifactBacked` decides the intent, and the body writer is
     * {@link restoredBodyWriter}'s alone.
     */
    static restoreWriteFor(host: Pick<ProtocolHost, 'overrideWriteVerdict' | 'packagedArtifactOwner' | 'restoredBodyWriter'>, singularType: string,
            name: string,
            binding: string | null,
            artifactBacked: boolean,
            source: string,): { intent: 'override-artifact' | 'runtime-only'; deriveRestoredBody: (historyBody: unknown) => Promise<unknown> } {
        const owner = artifactBacked ? host.packagedArtifactOwner({ type: singularType, name }) : undefined;
        const pairRow = owner !== undefined && isCustomizationPairOf(binding, owner);
        const intent: 'override-artifact' | 'runtime-only' = artifactBacked && !pairRow ? 'override-artifact' : 'runtime-only';
        const writeRestored = host.restoredBodyWriter(singularType, name, binding, source);
        const deriveRestoredBody = pairRow
            ? async (historyBody: unknown): Promise<unknown> => {
                const body = await writeRestored(historyBody);
                const verdict = host.overrideWriteVerdict({ type: singularType, name, packageId: binding, item: body });
                if (verdict.verdict === 'refuse') throw overrideWriteRefusalError(verdict);
                return body;
            }
            : writeRestored;
        return { intent, deriveRestoredBody };
    }

    /**
     * [#28574, ADR-0146 D10] Register a stored `object_extension` row as its
     * package's `'extend'` contributor of the object it names — the WHOLE
     * parsed body ({@link registrableObjectExtension}), through the registry's
     * own verb (`SchemaRegistry.registerObjectExtension`). The one call every
     * sync makes: the write-through ({@link applyRegistryWriteThrough}), the
     * boot hydration ({@link loadMetaFromDb}) and the read-side and heal
     * hydrations ({@link hydrateOverlayIntoRegistry}). A row bound to no
     * package is never registered: the doors refuse to write one, and an
     * extension needs a contributor id.
     *
     * Throws what the parse or the registry refuses, so each caller's own
     * per-row handling names the row.
     *
     * @returns whether the row was registered.
     */
    static registerStoredObjectExtension(host: Pick<ProtocolHost, 'engine'>, body: unknown, packageId: string | null | undefined): boolean {
        if (typeof packageId !== 'string' || packageId === '') return false;
        const registry = host.engine?.registry as ObjectExtensionRegistry | undefined;
        if (typeof registry?.registerObjectExtension !== 'function') return false;
        registry.registerObjectExtension(registrableObjectExtension(body), packageId);
        return true;
    }

    /**
     * [#28574] After an `object_extension` row of `name` is deleted: withdraw
     * every stored-row extension of the object whose row is no longer stored
     * (`SchemaRegistry.withdrawObjectExtension`), and re-register the ones that
     * are. A stored row's contribution is the tenant-authored one
     * (`_provenance: 'org'`, {@link registrableObjectExtension}); a code
     * package's manifest extension of the same object is never touched.
     *
     * An outage is not an absence: a failed read withdraws nothing.
     */
    static async resyncStoredObjectExtensions(host: Pick<ProtocolHost, 'convertStoredItem' | 'engine' | 'findEnvironmentRows' | 'registerStoredObjectExtension' | 'rethrowUnlessMetadataStoreUnprovisioned'>, name: string): Promise<void> {
        const registry = host.engine?.registry as ObjectExtensionRegistry | undefined;
        if (typeof registry?.getObjectContributors !== 'function' || typeof registry.withdrawObjectExtension !== 'function') return;
        let rows: Array<Record<string, unknown>> | null | undefined;
        try {
            rows = await host.findEnvironmentRows('sys_metadata', {
                where: { type: OBJECT_EXTENSION_TYPE, name, state: 'active' },
                context: { isSystem: true },
            });
        } catch (error) {
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
        const stored = new Map<string, Record<string, unknown>>();
        for (const row of rows ?? []) {
            const pkg = boundPackageOf(row.package_id);
            if (pkg) stored.set(pkg, row);
        }
        for (const contributor of registry.getObjectContributors(name)) {
            if (contributor.ownership !== 'extend') continue;
            if ((contributor.definition as { _provenance?: unknown } | undefined)?._provenance !== 'org') continue;
            if (!stored.has(contributor.packageId)) registry.withdrawObjectExtension(name, contributor.packageId);
        }
        for (const [pkg, row] of stored) {
            try {
                host.registerStoredObjectExtension(
                    host.convertStoredItem(String(row.type ?? OBJECT_EXTENSION_TYPE), storedRowDocument(row)),
                    pkg,
                );
            } catch (err: any) {
                console.warn(
                    `[Protocol] object extension '${name}' of package '${pkg}' could not be re-registered: ${err?.message ?? err}`,
                );
            }
        }
    }

    /** The body of `ObjectStackProtocolImplementation#onMetadataMutation`; the method's docblock there is its contract. */
    static onMetadataMutation(host: Pick<ProtocolHost, 'metadataMutationListeners'>, listener: (evt: MetadataMutationEvent) => void): () => void {
        host.metadataMutationListeners.push(listener);
        return () => {
            const i = host.metadataMutationListeners.indexOf(listener);
            if (i >= 0) host.metadataMutationListeners.splice(i, 1);
        };
    }

    /**
     * Notify mutation listeners (best-effort, synchronous fan-out). A
     * listener failure must never fail the write it observes — the row is
     * already persisted — so each listener is isolated in its own try/catch.
     *
     * [#13331] Also the cluster publish point: this method is called at
     * exactly the post-persistence sites (`saveMetaItem`,
     * `runPublishSideEffects`, `deleteMetaItem`) — the ONE choke point the
     * listener bus above documents — so publishing here is what makes every
     * authoring transport inherit the cross-node signal instead of each HTTP
     * surface hand-announcing. Local listeners first, then the bus, matching
     * `MetadataManager.notifyWatchers`' order.
     */
    static emitMetadataMutation(host: Pick<ProtocolHost, 'notifyMutationListenersLocal' | 'publishMetadataMutation'>, evt: MetadataMutationEvent): void {
        host.notifyMutationListenersLocal(evt);
        host.publishMetadataMutation(evt);
    }

    /** The body of `ObjectStackProtocolImplementation#attachMetadataMutationPubSub`; the method's docblock there is its contract. */
    static attachMetadataMutationPubSub(host: Pick<ProtocolHost, 'applyRemoteMetadataMutation' | 'clusterNodeId' | 'clusterPubSub' | 'clusterUnsubscribe' | 'detachMetadataMutationPubSub'>, pubsub: IPubSub, nodeId: string): () => void {
        if (host.clusterPubSub === pubsub && host.clusterNodeId === nodeId) {
            return () => host.detachMetadataMutationPubSub();
        }
        host.detachMetadataMutationPubSub();
        host.clusterPubSub = pubsub;
        host.clusterNodeId = nodeId;
        host.clusterUnsubscribe = pubsub.subscribe<ClusterMetadataMutationPayload>(
            METADATA_MUTATION_CLUSTER_CHANNEL,
            (msg) => {
                const p = msg.payload;
                // Loopback guard — never re-apply what this node just wrote:
                // the write-through already ran here, synchronously, at the
                // door that persisted the row.
                if (p?.originNode && p.originNode === host.clusterNodeId) return;
                if (!p?.event?.type || !p.event.name) return;
                // Drafts are a staging buffer and never hydrate into any
                // registry — the publisher skips them (matching
                // `applyRegistryWriteThrough`'s `mode === 'publish'` gate),
                // and this guard keeps a peer honest about the same rule.
                if (p.event.state === 'draft') return;
                void host.applyRemoteMetadataMutation(p.event).catch((err) => {
                    console.warn(
                        `[Protocol] cluster metadata-mutation apply failed for `
                        + `${p.event.type}/${p.event.name}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                });
            },
        );
        console.info(
            `[Protocol] attached to the ${METADATA_MUTATION_CLUSTER_CHANNEL} cluster channel (node=${nodeId})`,
        );
        return () => host.detachMetadataMutationPubSub();
    }

    /** The body of `ObjectStackProtocolImplementation#detachMetadataMutationPubSub`; the method's docblock there is its contract. */
    static detachMetadataMutationPubSub(host: Pick<ProtocolHost, 'clusterNodeId' | 'clusterPubSub' | 'clusterUnsubscribe'>): void {
        if (host.clusterUnsubscribe) {
            try { host.clusterUnsubscribe(); } catch { /* idempotent */ }
            host.clusterUnsubscribe = undefined;
        }
        host.clusterPubSub = undefined;
        host.clusterNodeId = undefined;
    }

    /**
     * [#13331] Converge this replica's registry after a PEER's metadata
     * mutation — the ruled receipt semantics: re-run the registry
     * write-through from THIS replica's own `sys_metadata` read, never from
     * the payload.
     *
     * One applier for both `active` and `deleted` signals, because the DB
     * read decides, not the event name: an active row present means the
     * registry must serve it (a save/publish — or a draft DISCARD whose
     * active overlay survives, which re-registers the same body and is
     * idempotent); no active row means the heal walk must run
     * ({@link restoreArtifactRegistryView}, the same walk the local delete
     * runs). That makes out-of-order and duplicate delivery converge to the
     * row's current state by construction.
     *
     * The write-through call makes this the FIFTH caller of
     * `applyRegistryWriteThrough` — traced, with the fold discipline the
     * other four follow, in
     * `protocol.object-registry-write-through-spelling.test.ts`. The fold
     * here mirrors `revertCommit`'s call-site fold: the event crossed a
     * process boundary, so this caller folds rather than trusting the wire —
     * through {@link canonicalMetaType} (the complete map, #9161), not the
     * manifest map.
     *
     * Scope parity is INHERITED, not re-decided: `applyRegistryWriteThrough`
     * carries the org/environment gates (#6602: an org-scoped overlay never
     * enters the shared registry; the non-object branch registers only where
     * the registry takes this kernel's stored rows, #23298) and
     * `restoreArtifactRegistryView` refuses org
     * scopes on its own — so a peer applies exactly what the writer's own
     * kernel shape would have applied locally.
     *
     * After convergence the event replays into this replica's LOCAL mutation
     * listeners (never re-published — see
     * {@link notifyMutationListenersLocal}), so boot-cached consumers wired
     * to `onMetadataMutation` (authored hook/action re-bind) re-sync from
     * their own reads exactly as they would after a local write. Registry
     * first, listeners second — the #5109 invalidate-before-notify rule: a
     * listener that re-reads must not observe the event and the pre-event
     * registry at the same time.
     *
     * [#13609] The convergence above heals THIS replica's registry, but on its
     * own leaves this replica's `meta-overlay-cache` row set stamped at the
     * PRE-mutation write epoch — nothing above performs a local engine write,
     * so nothing retires it. A read of `getMetaItems` landing before that
     * cache's TTL lapses then re-hydrates the very row this method just healed
     * the registry of (measured: `protocol.datasource-delete-prolongation.test.ts`).
     * `bumpWriteEpoch` closes that gap the same way
     * `authz-invalidation-bridge.ts` already closes it for the authorization
     * cache on the identical substrate (#11968) — called here, AFTER
     * convergence and BEFORE {@link notifyMutationListenersLocal}, so a
     * listener that re-reads through `getMetaItems` sees a cold cache too, not
     * only a healed registry.
     */
    static async applyRemoteMetadataMutation(host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'engine' | 'getOverlayRepo' | 'notifyMutationListenersLocal' | 'resolveOverlayPackageBinding' | 'restoreArtifactRegistryView'>, evt: MetadataMutationEvent): Promise<void> {
        const type = canonicalMetaType(evt.type);
        // [ADR-0131 D6] The registry reflects the ENVIRONMENT row, whatever
        // organization the event names: no write lands organization-scoped
        // any more, and an organization-scoped row never entered the shared
        // registry (#6602). So an event a peer stamped with an organization
        // converges on the environment row — the state the registry holds.
        const repo = host.getOverlayRepo();
        const ref = {
            type,
            name: evt.name,
            org: 'env',
        } as Parameters<typeof repo.get>[0];
        // [#22877] The member the event addresses: a peer's save of a second
        // locale converges on THAT locale's row. Re-reading the canonical one,
        // as this did, re-registered the canonical body and left the peer's
        // registry without the member that changed (and a reset of it
        // unhealed). A member the event names but this type does not have is
        // read as the canonical one, as every repository read reads it.
        const current = await repo.get(ref, { state: 'active', ...memberOption(evt.member) });
        if (current) {
            // The row's OWN package binding, read from this replica's DB the
            // way the recovery callers derive it (#4867 / #4636) — the wire
            // carries no binding, and must not.
            const packageId = await host.resolveOverlayPackageBinding(type, evt.name, evt.member);
            await host.applyRegistryWriteThrough({
                type,
                name: evt.name,
                item: current.body,
                packageId,
                organizationId: null,
            });
        } else {
            await host.restoreArtifactRegistryView(type, evt.name, null, evt.member);
        }
        // [#13609] Retire this replica's overlay-row cache at the moment of
        // convergence — never a direct `@objectstack/objectql` import, see
        // `bumpWriteEpoch`'s header in `meta-overlay-cache.ts`.
        bumpWriteEpoch(host.engine, 'remote');
        host.notifyMutationListenersLocal({ ...evt, type });
    }

    /** The body of `ObjectStackProtocolImplementation#onMetaItemPublished`; the method's docblock there is its contract. */
    static onMetaItemPublished(host: Pick<ProtocolHost, 'metaItemPublishedListeners'>, listener: (evt: MetaItemPublishedEvent) => void | Promise<void>): () => void {
        host.metaItemPublishedListeners.push(listener);
        return () => {
            const i = host.metaItemPublishedListeners.indexOf(listener);
            if (i >= 0) host.metaItemPublishedListeners.splice(i, 1);
        };
    }

    /**
     * [ADR-0131 D6] THE repository every metadata read and write goes
     * through: the environment's — since C7b the only scope `sys_metadata`
     * has. One lazily built singleton under the `__env__` key.
     */
    static getOverlayRepo(host: Pick<ProtocolHost, 'engine' | 'overlayRepos'>): SysMetadataRepository {
        const key = '__env__';
        let repo = host.overlayRepos.get(key);
        if (!repo) {
            repo = new SysMetadataRepository({
                engine: host.engine as unknown as SysMetadataEngine,
                orgLabel: 'env',
            });
            host.overlayRepos.set(key, repo);
        }
        return repo;
    }
}
