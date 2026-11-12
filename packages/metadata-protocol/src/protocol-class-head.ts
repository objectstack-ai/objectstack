// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Class head: fields, stored-row conversion, resolvers,
 * registration hooks, authoring gates, mutation pub/sub, overlay index" facet
 * of `ObjectStackProtocolImplementation`: the bodies of
 * `resolveCascadeDeleteObjects`, `registerPublishMaterializer`,
 * `registerUninstallCleanup`, `runUninstallCleanups`,
 * `registerMutationProjector`, `registerAuthoringGate`,
 * `registerCredentialChannel`, `restoreWriteFor`, `objectExtensionItemRefusal`,
 * `registerStoredObjectExtension`, `resyncStoredObjectExtensions`,
 * `onMetadataMutation`, `emitMetadataMutation`, `attachMetadataMutationPubSub`,
 * `detachMetadataMutationPubSub`, `applyRemoteMetadataMutation`,
 * `resyncMetadataMutationPubSub` (#31722, written here beside its lane),
 * `onMetaItemPublished`, `getOverlayRepo` moved out of `protocol.ts` whole by
 * `scripts/codemod-split-protocol.mjs`; `registerUninstallGuard` (#31232) was
 * written here in the same shape, beside `registerUninstallCleanup`.
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
import { isPairOf } from '@objectstack/metadata-core';
import { installedManifestsOfEngine } from './installed-manifests.js';
import { overrideWriteRefusalError } from './protocol-packaged-base-refusal.js';
import { OBJECT_EXTENSION_TYPE, registrableObjectExtension } from './protocol-object-extension-item.js';
import type { ObjectExtensionRegistry } from './protocol-object-extension-item.js';
import { canonicalMetaType } from './protocol-meta-type-schema.js';
import { boundPackageOf } from './protocol-package-bindings.js';
import { HEAL_BINDING_UNKNOWN } from './protocol-heal-binding.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from '@objectstack/metadata';
import { activeRowBindings, inboundMutationPackage, unstampedSignalStoppedMessage } from './protocol-mutation-package.js';
import { memberOption } from './protocol-bundle-members.js';
import { clientFacingFailureText } from './protocol-client-failures.js';
import type {
    DeletePackageRequest,
    PublishMaterializer,
    UninstallCleanup,
    UninstallCleanupOutcome,
    UninstallDeclared,
    UninstallGuard,
} from './protocol-package-lifecycle-types.js';
import { METADATA_MUTATION_CLUSTER_CHANNEL } from './protocol-mutation-events.js';
import { MetadataMutationResyncLedger, RESYNC_ROW_FIELDS } from './protocol-mutation-resync.js';
import type { MetadataMutationResyncReport } from './protocol-mutation-resync.js';
import type {
    ClusterMetadataMutationPayload,
    MetaItemPublishedEvent,
    MetadataMutationEvent,
    MetadataMutationProjector,
} from './protocol-mutation-events.js';
import type { MetadataAuthoringGate, MetadataCredentialChannel } from './protocol-authoring-channel.js';
import { objectExtensionItemRefusal } from './protocol-object-extension-item.js';
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

    /** The body of `ObjectStackProtocolImplementation#registerUninstallGuard`; the method's docblock there is its contract. */
    static registerUninstallGuard(host: Pick<ProtocolHost, 'uninstallGuards'>, name: string, guard: UninstallGuard): void {
        host.uninstallGuards.set(name, guard);
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
                    // [ADR-0150 D8] The grants the cleanup revoked and reported,
                    // relayed onto the uninstall's receipt; absent when none.
                    ...(Array.isArray(r?.reportedGrants) && r.reportedGrants.length > 0
                        ? { reportedGrants: r.reportedGrants }
                        : {}),
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
    static restoreWriteFor(host: Pick<ProtocolHost, 'engine' | 'overrideWriteVerdict' | 'packagedArtifactOwner' | 'restoredBodyWriter'>, singularType: string,
            name: string,
            binding: string | null,
            artifactBacked: boolean,
            source: string,): { intent: 'override-artifact' | 'runtime-only'; deriveRestoredBody: (historyBody: unknown) => Promise<unknown> } {
        const owner = artifactBacked ? host.packagedArtifactOwner({ type: singularType, name }) : undefined;
        const pairRow = owner !== undefined && isPairOf(binding, owner, installedManifestsOfEngine(host.engine));
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
     * [#28574, ADR-0146 D10] The save, publish and restore doors' gate for an
     * `object_extension` body written into `binding` (the RESOLVED package of
     * the row): {@link objectExtensionItemRefusal}, asked with this engine's
     * registry and the package's dependency closure
     * ({@link resolveWritePackageScope}). Any other type answers `undefined`.
     */
    static objectExtensionItemRefusal(host: Pick<ProtocolHost, 'engine' | 'resolveWritePackageScope'>, type: string,
            item: unknown,
            name: string,
            binding: string | null | undefined,): Error | undefined {
        if ((PLURAL_TO_SINGULAR[type] ?? type) !== OBJECT_EXTENSION_TYPE) return undefined;
        return objectExtensionItemRefusal(OBJECT_EXTENSION_TYPE, {
            item,
            name,
            binding,
            registry: host.engine?.registry as ObjectExtensionRegistry | undefined,
            scope: host.resolveWritePackageScope(binding),
        });
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
    static emitMetadataMutation(host: Pick<ProtocolHost, 'clusterResync' | 'notifyMutationListenersLocal' | 'publishMetadataMutation'>, evt: MetadataMutationEvent): void {
        // [#31722] A local write moves what this replica's registry holds for
        // the item, so the lane's resync re-reads it rather than trust the
        // row's checksum (a later revert can bring an earlier one back).
        if (evt.state !== 'draft') host.clusterResync?.touch(evt);
        host.notifyMutationListenersLocal(evt);
        host.publishMetadataMutation(evt);
    }

    /** The body of `ObjectStackProtocolImplementation#attachMetadataMutationPubSub`; the method's docblock there is its contract. */
    static attachMetadataMutationPubSub(host: Pick<ProtocolHost, 'applyRemoteMetadataMutation' | 'clusterNodeId' | 'clusterPubSub' | 'clusterResync' | 'clusterUnsubscribe' | 'detachMetadataMutationPubSub' | 'findEnvironmentRows'>, pubsub: IPubSub, nodeId: string): () => void {
        if (host.clusterPubSub === pubsub && host.clusterNodeId === nodeId) {
            return () => host.detachMetadataMutationPubSub();
        }
        host.detachMetadataMutationPubSub();
        host.clusterPubSub = pubsub;
        host.clusterNodeId = nodeId;
        // [#31722] The resync baseline: which stored row each registry entry
        // was converged on, taken by one read now (see
        // `protocol-mutation-resync.ts`).
        const ledger = new MetadataMutationResyncLedger();
        host.clusterResync = ledger;
        ledger.seed(() => host.findEnvironmentRows('sys_metadata', {
            where: { state: 'active' },
            fields: [...RESYNC_ROW_FIELDS],
            // Platform plumbing: no caller to authorize, as the repository's own reads.
            context: { isSystem: true },
        }));
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
                host.clusterResync?.touch(p.event);
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
    static detachMetadataMutationPubSub(host: Pick<ProtocolHost, 'clusterNodeId' | 'clusterPubSub' | 'clusterResync' | 'clusterUnsubscribe'>): void {
        if (host.clusterUnsubscribe) {
            try { host.clusterUnsubscribe(); } catch { /* idempotent */ }
            host.clusterUnsubscribe = undefined;
        }
        host.clusterPubSub = undefined;
        host.clusterNodeId = undefined;
        host.clusterResync = undefined;
    }

    /** The body of `ObjectStackProtocolImplementation#resyncMetadataMutationPubSub`; the method's docblock there is its contract. */
    static async resyncMetadataMutationPubSub(host: Pick<ProtocolHost, 'applyRemoteMetadataMutation' | 'clusterPubSub' | 'clusterResync' | 'findEnvironmentRows'>): Promise<MetadataMutationResyncReport | undefined> {
        // No transport, no lane: a single node never missed a hint.
        const ledger = host.clusterResync;
        if (!host.clusterPubSub || !ledger) return undefined;
        return ledger.resync({
            readActiveRows: () => host.findEnvironmentRows('sys_metadata', {
                where: { state: 'active' },
                fields: [...RESYNC_ROW_FIELDS],
                context: { isSystem: true },
            }),
            converge: (evt) => host.applyRemoteMetadataMutation(evt),
        });
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
     * [#32451, ADR-0150 D4] For a type stored per `(package, name)`
     * (`PACKAGE_SLOTTED_STORE_TYPES`), the event's `packageId` is part of the
     * address: this replica reads THAT package's row (`null`: the row bound to
     * no package) and registers it with that binding, or, with no row there,
     * runs the writer's own heal for that package. A signal naming no package
     * (a writer that predates the field) converges by name where the stored
     * rows leave one binding, and is a logged stop that keeps the entry where
     * they leave several — never the first row the store returns. Every other
     * type converges by name, as it always has.
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
     * [#32145] …and prepares the object's storage the way the writer's save
     * did, through the SAME entry point ({@link ensureObjectStorage}, the
     * driver's schema sync for an `object` or the target of an
     * `object_extension`; every other type returns at its guard). The table
     * already exists in the shared database, but a driver builds its own
     * per-object registries there and nowhere else — the autonumber counter,
     * the organization column it stamps on insert and scopes reads on, the
     * table it knows it manages — so a peer that only registered the object
     * served it with no number and no organization stamp until a restart's
     * boot sync. Registry first, storage second, as on the writer; the
     * writer emits only after its own sync, so the peer's sync finds the
     * table and its columns in place. A refused sync is reported at `error`
     * by that entry point and never fails the convergence: the registry is
     * already healed, as on the writer, whose save answered success.
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
    static async applyRemoteMetadataMutation(host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'engine' | 'ensureObjectStorage' | 'getOverlayRepo' | 'notifyMutationListenersLocal' | 'resolveOverlayPackageBinding' | 'restoreArtifactRegistryView' | 'findEnvironmentRows'>, evt: MetadataMutationEvent): Promise<void> {
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
        // [#32451, ADR-0150 D4] For a type stored per `(package, name)`, the
        // package is part of the row's address, as the member is: the event
        // names it, and this replica reads THAT package's row. Every other
        // type converges by name, as before (the ruled control).
        const slotted = PACKAGE_SLOTTED_STORE_TYPES.has(type);
        const named = slotted ? inboundMutationPackage(evt) : undefined;
        if (slotted && named === undefined) {
            // [#32451, ruling Q2-A] An unstamped signal (a writer that predates
            // `packageId`) on a slotted type: never a guess. One binding among
            // the address's active rows converges on it, as before; several
            // are a logged stop that keeps the entry, which the lane's ledger
            // already holds marked for the next resync.
            const bindings = await activeRowBindings(host, type, evt.name, evt.member);
            if (bindings.length > 1) {
                console.error(unstampedSignalStoppedMessage(type, evt.name, evt.member, bindings));
                return;
            }
        }
        // `named` is a package id or `null` (the row bound to no package, read
        // as `package_id IS NULL`); when it is `undefined` the read names no
        // package — never an `undefined` key, which the repository would read
        // as `IS NULL` too.
        const current = await repo.get(ref, {
            state: 'active',
            ...(named !== undefined ? { packageId: named } : {}),
            ...memberOption(evt.member),
        });
        if (current) {
            // The binding of the row it read: the read above was scoped to
            // `named` when the event names it. Otherwise the row's OWN package
            // binding, read from this replica's DB the way the recovery callers
            // derive it (#4867 / #4636).
            const packageId = named !== undefined
                ? named
                : await host.resolveOverlayPackageBinding(type, evt.name, evt.member);
            await host.applyRegistryWriteThrough({
                type,
                name: evt.name,
                item: current.body,
                packageId,
                organizationId: null,
            });
            // [#32145] The writer's save ran this right after its own
            // write-through; see the docblock.
            await host.ensureObjectStorage(type, evt.name);
        } else {
            // No row at the address. With the package named: the writer's own
            // heal, for the package of the row it removed (`null` takes the
            // package-less path). [#32366] Without it the binding is UNKNOWN,
            // not package-less: the removed row's binding went with it. The
            // heal then reads with no package, and a refusal of that read is a
            // logged stop that keeps the entry, never the package-less row's
            // retirement (HEAL_BINDING_UNKNOWN).
            await host.restoreArtifactRegistryView(
                type, evt.name, null, named !== undefined ? named : HEAL_BINDING_UNKNOWN, evt.member,
            );
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
