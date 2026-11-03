// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Class head: fields, stored-row conversion, resolvers,
 * registration hooks, authoring gates, mutation pub/sub, overlay index" section
 * of `ObjectStackProtocolImplementation`: the bodies of
 * `resolveCascadeDeleteObjects`, `runUninstallCleanups`, `restoreWriteFor`,
 * `registerStoredObjectExtension`, `resyncStoredObjectExtensions`,
 * `onMetadataMutation`, `attachMetadataMutationPubSub`,
 * `detachMetadataMutationPubSub`, `applyRemoteMetadataMutation`,
 * `onMetaItemPublished`, `getOverlayRepo` moved out of `protocol.ts` whole by
 * `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as `packages/metadata-protocol/scripts/host-split.mjs` moves
 * one (ruling E, item E1): re-indented one level, with `this.<member>` read as
 * `host.<member>` and nothing else changed. Each method stays on the class
 * with its docblock and signature, which the published `.d.ts` prints, and
 * hands its body the host (`protocol-host.ts`); the docblock there is the
 * contract.
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
    UninstallCleanupOutcome,
    UninstallDeclared,
} from './protocol-package-lifecycle-types.js';
import { METADATA_MUTATION_CLUSTER_CHANNEL } from './protocol-mutation-events.js';
import type {
    ClusterMetadataMutationPayload,
    MetaItemPublishedEvent,
    MetadataMutationEvent,
} from './protocol-mutation-events.js';
import type { ProtocolHost } from './protocol-host.js';

/** The body of `ObjectStackProtocolImplementation#resolveCascadeDeleteObjects`; the method's docblock there is its contract. */
export function resolveCascadeDeleteObjects(host: Pick<ProtocolHost, 'getServicesRegistry'>, type: string, name: string): string[] | undefined {
    if (canonicalMetaType(type) !== 'object') return undefined;
    const engine = host.getServicesRegistry?.().get('objectql') as
        | Pick<IObjectQLEngine, 'getCascadeDeleteObjects'>
        | undefined;
    const read = engine?.getCascadeDeleteObjects;
    if (typeof read !== 'function') return undefined;
    const answer = read.call(engine, name);
    return Array.isArray(answer) ? [...answer] : undefined;
}

/** The body of `ObjectStackProtocolImplementation#runUninstallCleanups`; the method's docblock there is its contract. */
export async function runUninstallCleanups(host: Pick<ProtocolHost, 'uninstallCleanups'>, request: Pick<DeletePackageRequest, 'packageId' | 'actor'> & { declared?: UninstallDeclared },): Promise<UninstallCleanupOutcome[]> {
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

/** The body of `ObjectStackProtocolImplementation#restoreWriteFor`; the method's docblock there is its contract. */
export function restoreWriteFor(host: Pick<ProtocolHost, 'overrideWriteVerdict' | 'packagedArtifactOwner' | 'restoredBodyWriter'>, singularType: string,
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

/** The body of `ObjectStackProtocolImplementation#registerStoredObjectExtension`; the method's docblock there is its contract. */
export function registerStoredObjectExtension(host: Pick<ProtocolHost, 'engine'>, body: unknown, packageId: string | null | undefined): boolean {
    if (typeof packageId !== 'string' || packageId === '') return false;
    const registry = host.engine?.registry as ObjectExtensionRegistry | undefined;
    if (typeof registry?.registerObjectExtension !== 'function') return false;
    registry.registerObjectExtension(registrableObjectExtension(body), packageId);
    return true;
}

/** The body of `ObjectStackProtocolImplementation#resyncStoredObjectExtensions`; the method's docblock there is its contract. */
export async function resyncStoredObjectExtensions(host: Pick<ProtocolHost, 'convertStoredItem' | 'engine' | 'findEnvironmentRows' | 'registerStoredObjectExtension' | 'rethrowUnlessMetadataStoreUnprovisioned'>, name: string): Promise<void> {
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
export function onMetadataMutation(host: Pick<ProtocolHost, 'metadataMutationListeners'>, listener: (evt: MetadataMutationEvent) => void): () => void {
    host.metadataMutationListeners.push(listener);
    return () => {
        const i = host.metadataMutationListeners.indexOf(listener);
        if (i >= 0) host.metadataMutationListeners.splice(i, 1);
    };
}

/** The body of `ObjectStackProtocolImplementation#attachMetadataMutationPubSub`; the method's docblock there is its contract. */
export function attachMetadataMutationPubSub(host: Pick<ProtocolHost, 'applyRemoteMetadataMutation' | 'clusterNodeId' | 'clusterPubSub' | 'clusterUnsubscribe' | 'detachMetadataMutationPubSub'>, pubsub: IPubSub, nodeId: string): () => void {
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
export function detachMetadataMutationPubSub(host: Pick<ProtocolHost, 'clusterNodeId' | 'clusterPubSub' | 'clusterUnsubscribe'>): void {
    if (host.clusterUnsubscribe) {
        try { host.clusterUnsubscribe(); } catch { /* idempotent */ }
        host.clusterUnsubscribe = undefined;
    }
    host.clusterPubSub = undefined;
    host.clusterNodeId = undefined;
}

/** The body of `ObjectStackProtocolImplementation#applyRemoteMetadataMutation`; the method's docblock there is its contract. */
export async function applyRemoteMetadataMutation(host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'engine' | 'getOverlayRepo' | 'notifyMutationListenersLocal' | 'resolveOverlayPackageBinding' | 'restoreArtifactRegistryView'>, evt: MetadataMutationEvent): Promise<void> {
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
export function onMetaItemPublished(host: Pick<ProtocolHost, 'metaItemPublishedListeners'>, listener: (evt: MetaItemPublishedEvent) => void | Promise<void>): () => void {
    host.metaItemPublishedListeners.push(listener);
    return () => {
        const i = host.metaItemPublishedListeners.indexOf(listener);
        if (i >= 0) host.metaItemPublishedListeners.splice(i, 1);
    };
}

/** The body of `ObjectStackProtocolImplementation#getOverlayRepo`; the method's docblock there is its contract. */
export function getOverlayRepo(host: Pick<ProtocolHost, 'engine' | 'overlayRepos'>): SysMetadataRepository {
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
