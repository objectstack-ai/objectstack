// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Registry hydration, view expansion, write-through,
 * object storage" section of `ObjectStackProtocolImplementation`: the bodies of
 * `applyObjectRegistryMutation`, `hydrateOverlayIntoRegistry`,
 * `expandRuntimeViewContainer`, `shippedViewContainerOf`,
 * `runtimeViewContainerPackage`, `hydrateExpandedViewItems`,
 * `applyRegistryWriteThrough`, `restoreArtifactRegistryView`,
 * `ensureObjectStorage`, `dropObjectStorage` moved out of `protocol.ts` whole
 * by `scripts/codemod-split-protocol.mjs`.
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

import { overlayMemberWhere } from './migrations/overlay-index.js';
import { storedRowDocument } from './item-lock.js';
import { itemDiscriminator } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec/ui';
import { bindStoredRow } from './stored-row-binding.js';
import { incomingTakesStoredFlowSlot } from './stored-flow-slot.js';
import { OBJECT_EXTENSION_TYPE } from './protocol-object-extension-item.js';
import { canonicalMetaType } from './protocol-meta-type-schema.js';
import {
    boundPackageOf,
    bundleMemberOf,
    declinesBorrowedEnvelope,
    isShippedViewItem,
    mergeArtifactProtection,
    stateTenantAuthorship,
    withRowBinding,
} from './protocol-package-bindings.js';
import type { HydrationOptions } from './protocol-package-bindings.js';
import { bundleMemberDiscriminator } from './protocol-bundle-members.js';
import type { ProtocolHost } from './protocol-host.js';

/** The body of `ObjectStackProtocolImplementation#applyObjectRegistryMutation`; the method's docblock there is its contract. */
export async function applyObjectRegistryMutation(host: Pick<ProtocolHost, 'classifyObjectContribution' | 'engine' | 'overlayPackageMismatchError' | 'packagelessAddress'>, request: { type: string; name: string; item?: any; packageId?: string | null }): Promise<void> {
    // [#8862] The `&& request.type !== 'objects'` limb that stood here is
    // GONE. It did not merely admit a plural, it registered under one —
    // `registerItem` below mints the entry under the spelling that arrived
    // — which is the shape {@link canonicalMetaType}'s header blames for a
    // real prior bug (one plural read minted a plural entry and shadowed an
    // entire code-authored listing). It was measured DORMANT in #8862: the
    // sole caller {@link applyRegistryWriteThrough} has four, and every one
    // folds at its producer. Removing it makes a hypothetical fifth,
    // unfolded caller fail CLOSED — it does not register, and
    // `assertObjectRegistered` raises loudly — instead of silently minting
    // `registerItem('objects', …)`. What keeps a fifth caller from being
    // added unexamined is the call-site count pin in
    // `protocol.object-registry-write-through-spelling.test.ts`, not this
    // guard; the two are a pair.
    if (request.type !== 'object') return;
    // `request.type` is provably `'object'` on the line above, so this
    // mints the canonical key rather than whatever spelling arrived.
    host.engine.registry.registerItem(request.type, request.item, 'name');
    try {
        const layer = host.classifyObjectContribution(request.name, request.packageId);
        if (layer.kind === 'mismatch') {
            // Unreachable from `saveMetaItem`, which refuses this row at
            // the producer (D9.9) — but `applyRegistryWriteThrough` has
            // other callers (rollback, publish promotion), and registering
            // the layer anyway would put `sys_metadata` and the registry
            // back into the disagreement D9.9 exists to prevent.
            throw host.overlayPackageMismatchError(
                request.name, layer.packageId, layer.ownerPackageId,
                // [#23514] The row this registers is stored, and so is every
                // other package's row the way out deletes (the one read this
                // method awaits, on this refusal's branch only).
                {
                    at: 'registry',
                    storedPackages: layer.ownerPackageId === 'sys_metadata'
                        ? (await host.packagelessAddress('object', request.name)).candidates
                        : [],
                },
            );
        }
        host.engine.registry.registerObject(
            { ...(request.item as Record<string, unknown>), _provenance: 'org' } as any,
            layer.packageId,
            undefined,
            // [ADR-0029 D9.8] The KIND, chosen by asking the registry a
            // question it can answer: does a PACKAGED owner already hold
            // this name? Registering unconditionally as `'own'` is what
            // made this seam splice the packaged contributor out and
            // destroy the code definition at write time (#6853).
            layer.kind,
        );
    } catch (err: any) {
        console.warn(
            `[Protocol] registerObject failed for ${request.name}: ${err?.message ?? err}`,
        );
    }
}

/** The body of `ObjectStackProtocolImplementation#hydrateOverlayIntoRegistry`; the method's docblock there is its contract. */
export async function hydrateOverlayIntoRegistry(host: Pick<ProtocolHost, 'anotherPackageShips' | 'engine' | 'hydrateExpandedViewItems' | 'lookupArtifactItem' | 'packagedArtifactOwner' | 'registerStoredObjectExtension'>, type: string,
        data: unknown,
        options: HydrationOptions,): Promise<boolean> {
    // [#9111] See the header: the mint door asserts, the caller folds.
    // Placed FIRST, ahead of every no-op return below, so the contract is
    // judged on the spelling itself rather than on whether this particular
    // row happened to be registrable — a caller that stops folding must not
    // be able to hide behind an org-scoped or nameless body.
    const canonicalType = canonicalMetaType(type);
    if (canonicalType !== type) {
        const err: any = new Error(
            `Refusing to register a SchemaRegistry overlay entry under `
            + `the non-canonical metadata type '${type}' (canonical: '${canonicalType}'). The registry `
            + `holds exactly one plain key per (type, name) and every reader addresses it through the `
            + `'/meta' boundary, which folds — an entry minted under '${type}' is a second namespace no `
            + `canonical read, listing or declaration lookup can reach. Fold the type at the `
            + `producer (canonicalMetaType), not here; see this method's header for why the mint door `
            + `refuses instead of folding.`,
        );
        err.code = 'REGISTRY_TYPE_NOT_CANONICAL';
        err.status = 500;
        throw err;
    }
    // [#6602] ADR-0005 — a per-org overlay is served on demand, never
    // grafted into the registry every org in this process shares.
    if (options.organizationId !== null && options.organizationId !== undefined) return false;
    // [#28574] An `object_extension` row registers as its package's
    // `'extend'` contributor of the object it names, never as an item:
    // the body carries `extend`, not `name`. The boot hydration
    // ({@link loadMetaFromDb}) and the read-side hydration reach it here.
    // See {@link registerStoredObjectExtension}.
    if (canonicalType === OBJECT_EXTENSION_TYPE) {
        return host.registerStoredObjectExtension(data, options.packageId);
    }
    if (!data || typeof data !== 'object' || !('name' in data)) return false;
    const registry: any = (host.engine as any)?.registry;
    if (!registry || typeof registry.registerItem !== 'function') return false;
    // [#22057] See the header: a view row bound to one package is not
    // registered under a name another package ships. Its expansions are
    // judged by their own names. ⛔ View only.
    const bound = canonicalType === 'view' ? boundPackageOf(options.packageId) : undefined;
    if (bound !== undefined && host.anotherPackageShips(type, String((data as any).name), bound)) {
        await host.hydrateExpandedViewItems(type, data, options);
        return true;
    }
    // [#23074] The artifact of the row's OWN bundle member: an overlay of
    // a member the package does not ship has none, so it registers as the
    // tenant row it is ({@link mergeArtifactProtection}). It used to take
    // the bundle's artifact canonical-first, and a `zh-CN` overlay beside
    // a shipped `en-US` was registered wearing that envelope, which every
    // registry reader then took for the package's own `zh-CN` artifact.
    const artifact = host.lookupArtifactItem(
        type, (data as any).name, options.packageId ?? undefined, bundleMemberOf(type, data),
    );
    // [#29600] See the header: a dashboard, report or email-template row
    // bound to a package that ships no artifact of its name, under a name
    // another package ships, is not registered under the bare name, where
    // it would wear that other package's envelope. Its reads answer it from
    // its row. ⛔ Those three types, and [#29613] page, app, dataset, doc and book.
    if (declinesBorrowedEnvelope(canonicalType, options.packageId, artifact)) return true;
    // [#16702] Say what this row IS before the artifact envelope is grafted
    // on top of it. Every body reaching this hydrator came out of a
    // `sys_metadata` write and is therefore tenant-authored by definition
    // (ADR-0010 `_provenance: 'org'`) — the same sentence the `object`
    // branches of this class already write, said once here for every OTHER
    // type. It makes rows ALREADY poisoned at rest harmless without
    // rewriting them, and it covers the column path the write-door strip
    // cannot reach: `getMetaItems` re-stamps `_packageId` onto the body
    // from the row's `package_id` COLUMN a few frames up, before handing it
    // here. ⚠️ BEFORE the merge, never after — where a real artifact
    // exists its envelope must still win (ADR-0010 §3.3), and it does,
    // because {@link mergeArtifactProtection} overwrites `_provenance` last.
    //
    // [#20913, ADR-0126 §2] ⛔ Not for a FLOW. `flow` is Regime C: no
    // overlay read path, so a stored flow row is never the artifact's
    // overlay and the artifact's envelope is not its to wear. Grafted, a
    // stored row of a shipped flow name read as the package's own entry —
    // the boot pull's precedence could not tell the two contenders apart,
    // and its receipt rendered both as the package. Registered as the
    // tenant row it is, it is reported as one and never armed.
    const envelope = canonicalType === 'flow' ? undefined : artifact;
    const registered = mergeArtifactProtection(type, stateTenantAuthorship(withRowBinding(data, options.packageId)), envelope);
    // [#28412, ADR-0146 D9 item 1] …and a stored FLOW row's own binding,
    // the `package_id` column, travels with the body the boot pull reads
    // ({@link bindStoredRow}): the pull arms the shipping package's
    // declared override over the loader's body only when the column, not
    // a stamp in the body, binds the row to that package's `.custom` pair.
    if (canonicalType === 'flow') {
        bindStoredRow(registered, options.packageId ?? null);
        // [#28717] …and the shipping package's declared override keeps the
        // name's one bare slot over any other stored row of the name, in
        // whatever order the store reads them, so the boot pull arms it
        // from the first pull. The row that loses stays stored and is
        // carried on the override's body for the boot pull to name
        // ({@link incomingTakesStoredFlowSlot}).
        const held = typeof registry.getItem === 'function'
            ? registry.getItem(type, String((data as any).name))
            : undefined;
        const owner = host.packagedArtifactOwner({ type, name: String((data as any).name) });
        if (!incomingTakesStoredFlowSlot(held, registered, owner)) return true;
    }
    registry.registerItem(type, registered, 'name' as any);
    await host.hydrateExpandedViewItems(type, data, options);
    return true;
}

/** The body of `ObjectStackProtocolImplementation#expandRuntimeViewContainer`; the method's docblock there is its contract. */
export function expandRuntimeViewContainer(host: Pick<ProtocolHost, 'copiesOwnShippedViewContainer' | 'expandUnderOwnName' | 'isAnotherPackagesObject' | 'lookupArtifactItem' | 'runtimeViewContainerObject' | 'runtimeViewContainerPackage'>, type: string,
        data: unknown,
        options: {
            packageId?: string | null;
            /**
             * [#21511] State each expansion's authorship the way
             * {@link hydrateOverlayIntoRegistry} states its container's:
             * {@link stateTenantAuthorship} first, then the item's own
             * artifact envelope merged over it. Set only by the caller that
             * REGISTERS the expansions ({@link hydrateExpandedViewItems}); the
             * registry-free reads serve exactly what they served before.
             */
            tenantAuthored?: boolean;
        },): Record<string, unknown>[] {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'view') return [];
    if (!isAggregatedViewContainer(data)) return [];
    const container = data as Record<string, any>;
    const viewObject = host.runtimeViewContainerObject(container);
    if (!viewObject) return [];
    const ownPackageId = host.runtimeViewContainerPackage(type, container, options);
    const crossPackage = host.isAnotherPackagesObject(viewObject, ownPackageId);
    // [#21980] A copy of its own package's shipped container takes the
    // loaders' names, not the own-name arm.
    const underOwnName = crossPackage
        && !host.copiesOwnShippedViewContainer(type, viewObject, container, ownPackageId);
    const expanded: ReadonlyArray<Record<string, unknown>> = underOwnName
        ? host.expandUnderOwnName(type, viewObject, container, ownPackageId)
        : (expandViewContainer(viewObject, container) as unknown as Record<string, unknown>[]);
    const out: Record<string, unknown>[] = [];
    for (const vi of expanded) {
        // Carry the container's package provenance onto each expanded item
        // so the package-disable filter and ADR-0048 artifact scoping judge
        // them by the same owner the container has.
        const item: Record<string, unknown> = { ...vi };
        // [#21334] Not the object's default: its owning package's is.
        if (crossPackage) delete item.isDefault;
        if (ownPackageId !== undefined) item._packageId = ownPackageId;
        // [#21334] Only the container's own package's artifact lends its
        // envelope; another package's artifact of this name is not this
        // item's to wear.
        const viArtifact = ownPackageId === undefined
            ? undefined
            : host.lookupArtifactItem(type, String(item.name), ownPackageId);
        const ownArtifact = (viArtifact as { _packageId?: unknown } | undefined)?._packageId === ownPackageId
            ? viArtifact
            : undefined;
        // [#21511] The marker goes on BEFORE the envelope, never after:
        // where the item's own artifact exists, its `_provenance` still
        // wins (ADR-0010 §3.3), as it does on the container.
        const authored = options.tenantAuthored ? stateTenantAuthorship(item) : item;
        out.push(mergeArtifactProtection(type, authored, ownArtifact) as Record<string, unknown>);
    }
    return out;
}

/** The body of `ObjectStackProtocolImplementation#shippedViewContainerOf`; the method's docblock there is its contract. */
export function shippedViewContainerOf(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: string,
        name: unknown,
        packageId: string | undefined,): Record<string, unknown> | undefined {
    if (packageId === undefined || typeof name !== 'string' || name === '') return undefined;
    const shipped = host.lookupArtifactItem(type, name, packageId) as Record<string, unknown> | undefined;
    return isAggregatedViewContainer(shipped) && shipped?._packageId === packageId ? shipped : undefined;
}

/** The body of `ObjectStackProtocolImplementation#runtimeViewContainerPackage`; the method's docblock there is its contract. */
export function runtimeViewContainerPackage(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: string,
        container: Record<string, any>,
        options: { packageId?: string | null },): string | undefined {
    for (const bound of [container._packageId, options.packageId]) {
        if (typeof bound === 'string' && bound !== '' && bound !== 'sys_metadata') return bound;
    }
    if (typeof container.name !== 'string' || container.name === '') return undefined;
    const overlaid = host.lookupArtifactItem(type, container.name) as { _packageId?: unknown } | undefined;
    if (isShippedViewItem(overlaid)) return undefined;
    const overlaidPackage = overlaid?._packageId;
    return typeof overlaidPackage === 'string' && overlaidPackage !== '' ? overlaidPackage : undefined;
}

/** The body of `ObjectStackProtocolImplementation#hydrateExpandedViewItems`; the method's docblock there is its contract. */
export async function hydrateExpandedViewItems(host: Pick<ProtocolHost, 'expandRuntimeViewContainer' | 'reconcileViewExpansions'>, type: string,
        data: unknown,
        options: HydrationOptions,): Promise<void> {
    await host.reconcileViewExpansions(type, {
        container: String((data as { name?: unknown }).name),
        binding: boundPackageOf(options.packageId),
        // [#28673] The container under its column's binding
        // ({@link withRowBinding}), so no item it expands to is placed
        // in a package a stamp in its body names.
        expansion: host.expandRuntimeViewContainer(type, withRowBinding(data, options.packageId), { ...options, tenantAuthored: true }),
        ...(options.reboundFrom === undefined
            ? {}
            : { reboundFrom: { binding: boundPackageOf(options.reboundFrom.packageId) } }),
    }, options.organizationId);
}

/** The body of `ObjectStackProtocolImplementation#applyRegistryWriteThrough`; the method's docblock there is its contract. */
export async function applyRegistryWriteThrough(host: Pick<ProtocolHost, 'applyObjectRegistryMutation' | 'hydrateOverlayIntoRegistry' | 'registerStoredObjectExtension' | 'registryTakesStoredRows'>, request: {
        type: string;
        name: string;
        item?: any;
        packageId?: string | null;
        /** The row's org scope — `null` for an env-wide row. [#6602] */
        organizationId: string | null;
        /**
         * [#23198] The binding the write moved the row from, when it moved it
         * (an orphan adoption): `null` for the package-less row. See
         * {@link HydrationOptions}.
         */
        reboundFrom?: { readonly packageId: string | null };
    }): Promise<void> {
    // [#8862] The `|| request.type === 'objects'` limb is GONE — this
    // branch admitted the plural that {@link applyObjectRegistryMutation}
    // then consumed. All four call sites of this method fold at their
    // producer (traced in
    // `protocol.object-registry-write-through-spelling.test.ts`), so the
    // limb was dead.
    //
    // ⚠️ What removal does and does NOT buy, stated precisely because the
    // obvious reading overstates it. A hypothetical fifth, UNFOLDED caller
    // passing `'objects'` no longer takes this branch — so it no longer
    // reaches `registerObject`, and the object is simply not registered:
    // `assertObjectRegistered` fails CLOSED, a loud recoverable error in
    // place of a silent one. That is the win.
    //
    // [#9111] The rest of this paragraph is now HISTORY, and is kept in the
    // past tense because it is what the next card was filed about. It used
    // to read: "It does NOT mean nothing is registered at all — on an
    // unscoped kernel the value falls through to
    // {@link hydrateOverlayIntoRegistry}, which registers under the RAW
    // type like every other overlay kind." That was true, and it was the
    // last unfolded seam of this family. It no longer holds: the hydrator
    // now ASSERTS its type is canonical (`REGISTRY_TYPE_NOT_CANONICAL`),
    // so an unfolded plural arriving here is refused at the mint door
    // rather than minting a shadow entry under the raw spelling.
    //
    // ⛔ That is still not a second line of defence, and must not be
    // written as one: folding at the producer stays the rule, and the
    // assert exists to make a producer that stops folding FAIL LOUDLY
    // instead of silently — not to repair its key.
    if (request.type === 'object') {
        // NOT org-gated, deliberately: no overlay of a packaged `object`
        // exists at any scope (`allowEnvironmentOverlay: false`, ADR-0005),
        // and its physical TABLE is env-wide, so the
        // registry entry backing it is env-wide too — `assertObjectRegistered`
        // fails CLOSED on a missing entry, and refusing to register here
        // would make a runtime-created object unreachable for data CRUD
        // rather than merely un-listed. This branch has never carried the
        // kernel-scope gate below either, for the same reason.
        await host.applyObjectRegistryMutation(request);
        return;
    }
    // [#28574] An `object_extension` row is its package's `'extend'`
    // contributor of the object it names: not org-gated and not
    // kernel-scope-gated, for the `object` branch's own reason — it adds
    // columns to an env-wide table and fields to every read of it. Best-effort
    // like every branch here: the row is already persisted.
    if (request.type === OBJECT_EXTENSION_TYPE) {
        try {
            host.registerStoredObjectExtension(request.item, request.packageId);
        } catch (err: any) {
            console.warn(
                `[Protocol] registry write-through failed for ${request.type}/${request.name}: ${err?.message ?? err}`,
            );
        }
        return;
    }
    // [#23298] Whose registry this is — never `environmentId` alone.
    if (!host.registryTakesStoredRows()) return;
    try {
        await host.hydrateOverlayIntoRegistry(request.type, request.item, {
            packageId: request.packageId ?? undefined,
            organizationId: request.organizationId,
            ...(request.reboundFrom === undefined ? {} : { reboundFrom: request.reboundFrom }),
        });
    } catch (err: any) {
        // Best-effort, exactly like the object branch: the row is already
        // persisted, so a registry hiccup must not fail the write that
        // succeeded. It degrades to the pre-#4521 behaviour (the next
        // listing hydrates it), never to a lost write.
        console.warn(
            `[Protocol] registry write-through failed for ${request.type}/${request.name}: ${err?.message ?? err}`,
        );
    }
}

/** The body of `ObjectStackProtocolImplementation#restoreArtifactRegistryView`; the method's docblock there is its contract. */
export async function restoreArtifactRegistryView(host: Pick<ProtocolHost, 'anotherPackageShips' | 'applyRegistryWriteThrough' | 'convertStoredItem' | 'engine' | 'findEnvironmentRows' | 'isArtifactBacked' | 'isUnservedSealedOverlay' | 'readItemFromMetadataService' | 'reconcileViewExpansions' | 'registryTakesStoredRows' | 'resyncStoredObjectExtensions' | 'rethrowUnlessMetadataStoreUnprovisioned'>, type: string,
        name: string,
        /** The DELETE's own scope — `null` for an env-wide row. [#6780] */
        organizationId: string | null,
        /**
         * [#22877] The bundle member whose row was removed, as the door's
         * selector named it; omitted, the canonical member. For a type whose
         * identity is a pair every tier below addresses that member alone:
         * its shadow, its baseline and its overlay entry. The other members'
         * rows are still stored and served, so their registry entries stay.
         * No effect for a type with no members.
         */
        member?: string,): Promise<void> {
    // [#6780] ADR-0005 — the plain-key entry belongs to the env-wide row,
    // so only an env-wide removal may heal (or retire) it.
    if (organizationId !== null && organizationId !== undefined) return;
    // [#23149, #23198] The view container's expansions, through the one
    // reconcile, with the empty set a removed row implies; it heals each
    // by this same walk. See the header. Ahead of the container's own
    // walk, which returns early from three of its tiers.
    await host.reconcileViewExpansions(type, { container: name, removed: 'every-row' }, organizationId);
    // [#28574] An `object_extension` has no shadow, baseline or overlay
    // entry to heal: its rows are `'extend'` contributors. The stored rows
    // that remain say which stay. See {@link resyncStoredObjectExtensions}.
    if ((PLURAL_TO_SINGULAR[type] ?? type) === OBJECT_EXTENSION_TYPE) {
        await host.resyncStoredObjectExtensions(name);
        return;
    }
    try {
        const registry: any = host.engine.registry;
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        // The member's discriminator value (the canonical one when none was
        // named), or `undefined` for a type with no members — whose registry
        // calls below are then exactly the calls they always were.
        const memberKey = bundleMemberDiscriminator(singular, member);

        // ── [ADR-0029 D9.7] THE OBJECT HALF'S LAYER SUBTRACTION ──
        //
        // Runs AHEAD of the tier walk, not inside tier 3, and the reason is
        // the same asymmetry #6808 was filed for — one layer down. Tier 1
        // (`removeRuntimeShadow`) returns as soon as it heals the generic
        // `metadata` map, so an object whose plain-key shadow it can heal
        // would never reach a tier-3 limb, and its overlay LAYER would stay
        // registered in `objectContributors` — the deleted customization
        // still being served by `getObject`, which is what the data plane
        // dispatches on.
        //
        // Unconditionally correct for `object`, which is why it needs no
        // tier: the row is gone, so its layer goes with it, and whatever
        // was underneath — a packaged owner, or nothing — is what should be
        // served next. When a packaged owner IS underneath, this is the
        // whole restoration: it is already there, at its own priority, in
        // its own namespace, with its own definition, so nothing has to be
        // reconstructed from values that no longer exist (#6853's measured
        // wall).
        if (singular === 'object' && typeof registry.removeObjectOverlay === 'function') {
            registry.removeObjectOverlay(name);
        }

        let healed = false;
        if (typeof registry.removeRuntimeShadow === 'function') {
            healed = registry.removeRuntimeShadow(singular, name, memberKey);
            if (type !== singular) {
                healed = registry.removeRuntimeShadow(type, name, memberKey) || healed;
            }
        }

        // ── [#23297, ADR-0048] A ROW OF THE ITEM IS STILL STORED ──
        //
        // The tiers below conclude what is served next from the layers
        // UNDER the deleted row (a packaged artifact, a MetadataService
        // baseline, or nothing) and on "nothing" retire the entry. That
        // presumed the deleted row was the item's only row. A delete names
        // its package (#23165), so an item two packages hold keeps the
        // other package's row stored and served by the item read and the
        // list, while tier 3 retired the registry entry: the
        // registry-backed doors (`getObject`, which data CRUD dispatches
        // on, and the registry lookups) answered "not registered" until
        // the next boot or save. Measured on a booted showcase: after
        // `DELETE /api/v1/meta/object/x?package=P` with Q's row remaining,
        // `GET /api/v1/meta/object/x` served Q's row and
        // `GET /api/v1/data/x` answered 404 `OBJECT_NOT_FOUND`.
        //
        // So the store is asked first. A row still stored at the address
        // (the environment's active rows, the canonical type, this member,
        // every package) is what is served next: it is registered again
        // the way a write makes a row live ({@link applyRegistryWriteThrough}),
        // in the order the boot hydration ({@link loadMetaFromDb}) reads
        // and with its sealed-object skip, and nothing is retired. Tier 1
        // above has already lifted the deleted row's shadow off a packaged
        // artifact, so a remaining row the hydration declines (#22057)
        // leaves the artifact served, as a boot does.
        //
        // An `object` has ONE owner per name in the registry (ADR-0029
        // D3): a second package's runtime-authored row never registered
        // (its write-through was refused at save), so the owner can be the
        // deleted row's package. That owner is unregistered first, only
        // for a name no code package ships (the tier-3 limb's own guard),
        // so the remaining row can take the name. An extender keeps it
        // registered, said as tier 3 says it.
        //
        // An outage is not an absence: a failed read stops the walk with
        // nothing retired, as a degraded baseline read does below. An
        // unprovisioned store holds no row.
        // The canonical key the repository stores rows under, and the one
        // the write-through registers under (#8862, #9111).
        const canonical = canonicalMetaType(type);
        let storedRows: Array<Record<string, unknown>> | null | undefined;
        try {
            // [#21911] The explicit system opt-in — see findServedOverlayRow.
            storedRows = await host.findEnvironmentRows('sys_metadata', {
                where: { type: canonical, name, state: 'active', ...overlayMemberWhere(canonical, member) },
                context: { isSystem: true },
            });
        } catch (error) {
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
        const remainingRows = canonical === 'object' && host.isUnservedSealedOverlay(canonical, name)
            ? []
            : storedRows ?? [];
        if (remainingRows.length > 0) {
            if (canonical === 'object' && !host.isArtifactBacked(canonical, name)) {
                const bindings = new Set(remainingRows.map((row) => boundPackageOf(row.package_id) ?? 'sys_metadata'));
                const owner = typeof registry.getObjectOwner === 'function' ? registry.getObjectOwner(name) : undefined;
                if (owner && !bindings.has(owner.packageId) && typeof registry.unregisterObject === 'function') {
                    try {
                        registry.unregisterObject(name);
                    } catch (err: any) {
                        console.warn(
                            `[Protocol] object '${name}' was deleted from sys_metadata but stays registered: `
                            + `${err?.message ?? err}`,
                        );
                        return;
                    }
                }
            }
            for (const row of remainingRows) {
                await host.applyRegistryWriteThrough({
                    type: canonical,
                    name,
                    item: host.convertStoredItem(String(row.type ?? canonical), storedRowDocument(row)),
                    packageId: boundPackageOf(row.package_id) ?? null,
                    organizationId: null,
                });
            }
            return;
        }
        if (healed) return;

        const baseline = await host.readItemFromMetadataService(type, name);
        // [#22877] A baseline of ANOTHER member is no baseline of this one:
        // the service keys a type's items by name alone, so it can hold a
        // bundle's other member under the name.
        const baselineServesMember = memberKey === undefined
            || itemDiscriminator(singular, baseline.data) === memberKey;
        if (baseline.data !== undefined && baseline.data !== null && baselineServesMember) {
            // [#23298] The write-through's own kernel-scope gate.
            if (host.registryTakesStoredRows()) {
                // [#22057] See tier 2 in the header. ⛔ View only.
                const bound = canonicalMetaType(type) === 'view'
                    ? boundPackageOf((baseline.data as { _packageId?: unknown })._packageId)
                    : undefined;
                if (bound === undefined || !host.anotherPackageShips(type, name, bound)) {
                    host.engine.registry.registerItem(type, baseline.data, 'name');
                }
            }
            return;
        }
        // ADR-0110 D3 — an outage is not an absence. Leave the entry: it
        // is stale, which is exactly where this method already was, and a
        // later delete or reload heals it.
        if (baseline.degraded) return;

        // [#5079] No artifact, no baseline: the row WAS the item.
        if (typeof registry.removeOverlayEntry === 'function') {
            registry.removeOverlayEntry(singular, name, memberKey);
            if (type !== singular) registry.removeOverlayEntry(type, name, memberKey);
        }
        // [#6808] …and an `object` lives in a SECOND place, so tier 3 has a
        // second limb. `applyObjectRegistryMutation` writes both halves on
        // the way in — `registerItem` into the generic `metadata` map, and
        // `registerObject` into `objectContributors` — while every verb
        // this walk used above (`removeRuntimeShadow`, `registerItem`,
        // `removeOverlayEntry`) addresses only the first. So the walk
        // retired the listing copy and left the DISPATCH copy: measured
        // over the real `SysMetadataRepository`, after the delete
        // `metadata['object']` was empty while `registry.getObject(name)`
        // — and `getItem('object', name)`, which special-cases back to it —
        // still served the object, keeping the deleted row's schema
        // readable and WRITABLE for the life of the process.
        //
        // Same tier as `removeOverlayEntry`, and only that tier: tiers 1
        // and 2 both concluded that a lower layer still serves this name
        // (a packaged artifact, or a MetadataService baseline), and an
        // object that is still served must stay registered — retiring it
        // there would turn "reset to artifact default" into an outage,
        // because `assertObjectRegistered` fails CLOSED for the whole data
        // plane. Only "no layer serves it" licenses removal, which is the
        // verdict this branch already carries for the other half.
        //
        // The ADR-0029 extender guard lives in the registry verb (see
        // {@link SchemaRegistry.unregisterObject}) and it THROWS — which
        // this best-effort heal must not propagate: the repository delete
        // has already committed, and the operator's row is gone either
        // way. So the refusal is caught and stated, deliberately NOT left
        // to the silent outer `catch`: an extended object surviving a
        // delete is a real divergence between the store and the runtime,
        // and it must be visible in the log rather than inferred later
        // from a registry that disagrees with `sys_metadata`.
        //
        // ── AND IT NEVER RETIRES A CODE-SHIPPED OBJECT ──
        //
        // The same refusal `removeOverlayEntry` carries one line up, for
        // the same reason: unregistering shipped code that the overlay
        // delete never touched would be a worse bug than the one this
        // closes. It is asked through the protocol's OWN existing predicate
        // ({@link isArtifactBacked} → `SchemaRegistry.getArtifactItem`,
        // which for `object` reads the contributor definition and applies
        // exactly the artifact test the sibling verb applies to the plain
        // key), so this limb inherits that judgement instead of open-coding
        // a second one.
        //
        // Not theoretical, and NOT already covered by the gate at the top of
        // `deleteMetaItem`: that two-tier authorization — which refuses an
        // artifact-backed `object` outright with `not_overridable` — runs
        // only when `environmentId !== undefined`. On a CONTROL-PLANE
        // kernel it is skipped, and `revertCommit`'s soft-remove limb
        // reaches this walk without it either, so the delete can arrive
        // here for a name a code package still ships. Retiring it would
        // take that object off the whole data plane until restart, because
        // `assertObjectRegistered` fails closed.
        //
        // ── [ADR-0029 D9.7] THE LAYER-ADDRESSED VERB RUNS FIRST ──
        //
        // When a packaged owner survives underneath, the tenant's delete
        // removes ONE thing: its overlay LAYER. The packaged definition is
        // already there — its own priority, its own namespace, its own body
        // — so restoring the artifact view is a SUBTRACTION, not a
        // reconstruction. That is what dissolves #6853's measured wall
        // (the delete-time heal needed five values and three of them no
        // longer existed by the time it ran): the judgement moved to write
        // time, where the packaged owner is one lookup away.
        //
        // It also retires #7012's package-binding guard, deliberately and
        // measurably rather than by tidiness. That guard existed because
        // `isArtifactBacked` was FALSIFIED here — an overlay row bound to
        // the packaged owner's id destroyed the packaged contributor at
        // write time, so the predicate answered "not shipped" for an object
        // the package still ships. D9 removes the falsification at its
        // source: the packaged `own` contributor is never spliced out, so
        // the predicate is honest and the case the guard protected cannot
        // reach the retirement limb at all (`removeObjectOverlay` returns
        // first, and `isArtifactBacked` is true besides). What the guard
        // still reached after that was only its own ACCEPTED COST — a
        // package-bound RUNTIME-authored object (Studio's package
        // workspace, #4636), indistinguishable from a shipped one by
        // binding alone, kept listable-but-rowless until restart. With the
        // predicate honest that is no longer the cheap direction, it is
        // simply the wrong answer: nothing ships the name, the row WAS the
        // item, and the operator asked for it to be gone.
        if (
            singular === 'object'
            && !host.isArtifactBacked(singular, name)
            && typeof registry.unregisterObject === 'function'
        ) {
            try {
                registry.unregisterObject(name);
            } catch (err: any) {
                console.warn(
                    `[Protocol] object '${name}' was deleted from sys_metadata but stays registered: `
                    + `${err?.message ?? err}`,
                );
            }
        }
    } catch {
        // Best-effort registry refresh; next read fixes it anyway
    }
}

/** The body of `ObjectStackProtocolImplementation#ensureObjectStorage`; the method's docblock there is its contract. */
export async function ensureObjectStorage(host: Pick<ProtocolHost, 'engine' | 'ensureObjectStorage'>, type: string, name: string): Promise<void> {
    // [#8862] The `&& type !== 'objects'` limb is GONE. Both call sites
    // hand over a folded value — `saveMetaItem` after
    // `canonicalizeMetaRequestType`, and `runPublishSideEffects` as
    // `args.singularType`, which `promoteDraftForPublish` folds through
    // `PLURAL_TO_SINGULAR` for BOTH its callers (including
    // `publishPackageDrafts`, the one #8820 named as the structural
    // hazard because `listDrafts` returns the draft row's stored type
    // verbatim). Guard-only either way: `type` never reaches
    // `syncObjectSchema`, which takes `name` alone.
    //
    // [#28574] An `object_extension` row is named by its target, so the
    // same sync gives the target's table the columns the extension adds —
    // the DDL path a manifest extension takes at boot, unchanged.
    if (type === OBJECT_EXTENSION_TYPE) return host.ensureObjectStorage('object', name);
    if (type !== 'object') return;
    try {
        await host.engine.syncObjectSchema(name);
    } catch (err: any) {
        // [#22985] `error`, not `warn`, by the one question AGENTS.md
        // "Degradation log levels" turns this on: the publish still
        // answers success and the object is registered and served, while
        // the storage it was published for does not exist. Said once per
        // publish of the object, never per write; the publish is
        // deliberately NOT failed (see the docblock). The driver's refusal
        // is a separate argument, so a multi-line driver error cannot split
        // the line that carries the level.
        console.error(
            `[Protocol] object '${name}' was published but its storage was NOT created or altered — its schema `
            + 'sync was refused. The publish answered success and the object is registered and served, so it '
            + 'looks usable while its writes fail (or drop the columns this publish added) until the sync runs. '
            + "Fix: resolve the driver's refusal (logged after this line), then publish the object again, which "
            + 're-runs this sync, or restart, since the boot syncs every registered object\'s storage.',
            err?.message ?? err,
        );
    }
}

/** The body of `ObjectStackProtocolImplementation#dropObjectStorage`; the method's docblock there is its contract. */
export async function dropObjectStorage(host: Pick<ProtocolHost, 'engine'>, type: string, name: string): Promise<void> {
    // [#8862] The `&& type !== 'objects'` limb is GONE. Both call sites
    // are in `deleteMetaItem` and fold at the producer: one passes
    // `singularTypeForRepo` (`PLURAL_TO_SINGULAR[request.type] ??
    // request.type`), the other re-folds the same expression inline.
    // Guard-only: `type` never reaches `dropObjectSchema`, which takes
    // `name` alone. {@link shouldDropStorage} already folded before
    // deciding, so this guard was answering a question settled upstream.
    if (type !== 'object') return;
    try {
        await host.engine.dropObjectSchema(name);
    } catch (err: any) {
        console.warn(`[Protocol] table drop failed for object '${name}': ${err?.message ?? err}`);
    }
}
