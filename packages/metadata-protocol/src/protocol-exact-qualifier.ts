// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic #31527 child G1] The exact qualifier of the by-name
 * metadata read: `GET /meta/:type/:name?package=X`, and the qualified path
 * `GET /meta/:type/:ns/:name` the doors translate to it, answer X's item with
 * its bound overlay, or a refusal naming the holders. They never answer
 * another package's item.
 *
 * Before G1 the read that named a package was the registry's prefer-local
 * read (`getItem`: the bare slot, then X's composite, then the FIRST
 * composite of any package), so `?package=X` for a name X does not hold
 * served whichever package registered it first.
 *
 * Scope: the types whose by-name readers consult `(package, name)`
 * (`registry.readsByPackage`, E8's nine). Every other type keeps the
 * prefer-local read, as the packageless arm E8 wired does.
 *
 * What X holds (the census of ui carry-in 1, comment 6727995849 on #31691):
 *  - X's own item: a registry holder of the name (its composite, or a bare-slot
 *    row bound to it). A bundle ADDITION is X's own item too: a dependent's
 *    member its base does not ship holds no name for a bare read (R2), but X
 *    named is X's holding, as the resolver keeps a caller's own addition
 *    (#31699, the first bundled type the exact qualifier reads);
 *  - an item of a package X is a customization pair of (ADR-0146): the base's
 *    item, which X's declared override customizes. Studio reads a base-held
 *    item's override and draft at the pair (`?package=PAIR`), before and after
 *    the pair writes a row;
 *  - an item a stored row bound to X carries, active or draft: the pair's added
 *    member, an item authored into X.
 */

import { isPairOf, pairsOf } from '@objectstack/metadata-core';
import {
    PackageScopedNameRefusedError,
    packageScopedRefusalMessage,
    type PackageScopedHolder,
    type PackageScopedRefusalReason,
    type PackageScopedResolvableType,
} from '@objectstack/core';
import { ENVIRONMENT_ADDRESS_SEGMENT, readNamespacePositionSegment } from '@objectstack/spec/kernel';
import { installedManifestsOfEngine } from './installed-manifests.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import type { ProtocolHost } from './protocol-host.js';

/** The registry reads the exact qualifier asks. */
interface ExactQualifierRegistry {
    readsByPackage(type: string): boolean;
    packageScopedHoldersOf(type: string, name: string, callerPackageId?: string | null): string[];
    getEnvironmentScopedItem(type: string, name: string, member?: string): unknown;
    getPackageScopedItem(type: string, name: string, packageId: string, member?: string): unknown;
    getPackage?(id: string): unknown;
}

/** A read the exact qualifier admitted: the package named, and the registry holder its item is. */
export interface ExactQualifierAddress {
    /** The package the read names. */
    readonly packageId: string;
    /**
     * The registry holders whose item the read serves: the package itself when
     * it holds the name, else the bases it is a pair of that hold it. Empty
     * when only a stored row bound to the package carries it.
     */
    readonly registryHolders: readonly string[];
}

function exactQualifierRegistry(host: Pick<ProtocolHost, 'engine'>): ExactQualifierRegistry | undefined {
    const registry = (host.engine as { registry?: Partial<ExactQualifierRegistry> } | undefined)?.registry;
    if (typeof registry?.readsByPackage !== 'function'
        || typeof registry.packageScopedHoldersOf !== 'function'
        || typeof registry.getEnvironmentScopedItem !== 'function'
        || typeof registry.getPackageScopedItem !== 'function') {
        return undefined;
    }
    return registry as ExactQualifierRegistry;
}

function refusal(
    type: string,
    name: string,
    packageId: string,
    reason: PackageScopedRefusalReason,
    candidates: readonly PackageScopedHolder[],
): PackageScopedNameRefusedError {
    const base = {
        status: 'refused' as const,
        reason,
        type: type as PackageScopedResolvableType,
        name,
        callerPackageId: packageId,
        candidates,
    };
    return new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
}

/**
 * Judge a by-name read that names package `packageId` as its exact qualifier.
 *
 * @returns `undefined` when the rule does not apply (no package named, a type
 *   whose readers do not consult `(package, name)`, a registry that cannot
 *   say), else the admitted address.
 * @throws {PackageScopedNameRefusedError} `not-held-by-qualifier`, naming
 *   every holder, when the package holds no item of the name and another
 *   holder does — the package holders, and the environment's own item.
 */
export async function admitExactQualifier(
    host: Pick<ProtocolHost, 'engine' | 'findServedOverlayRow'>,
    request: { type: string; name: string; packageId?: string; member?: string },
): Promise<ExactQualifierAddress | undefined> {
    const packageId = request.packageId;
    if (!packageId) return undefined;
    const registry = exactQualifierRegistry(host);
    if (!registry || !registry.readsByPackage(request.type)) return undefined;

    // X named is X's holding even when it is a bundle addition (R2 drops one
    // only for OTHER readers): the qualifier asks as the caller it names.
    const holders = registry.packageScopedHoldersOf(request.type, request.name, packageId) ?? [];
    if (holders.includes(packageId)) return { packageId, registryHolders: [packageId] };

    const installed = installedManifestsOfEngine(host.engine);
    const pairedBases = holders.filter((holder) => pairsOf(holder, installed).includes(packageId));
    if (pairedBases.length > 0) return { packageId, registryHolders: pairedBases };

    for (const state of ['active', 'draft'] as const) {
        const served = await host.findServedOverlayRow({
            type: request.type, name: request.name, state, packageId,
            ...(request.member !== undefined ? { member: request.member } : {}),
        });
        if ((served?.row as { package_id?: unknown } | undefined)?.package_id === packageId) {
            return { packageId, registryHolders: [] };
        }
    }

    const candidates: PackageScopedHolder[] = holders.map((holder) => ({ kind: 'package' as const, packageId: holder }));
    if (registry.getEnvironmentScopedItem(request.type, request.name, request.member) !== undefined) {
        candidates.push({ kind: 'environment' });
    }
    // No holder anywhere: nothing to name, and the read answers its own miss.
    if (candidates.length === 0) return { packageId, registryHolders: [] };
    throw refusal(request.type, request.name, packageId, 'not-held-by-qualifier', candidates);
}

/**
 * The item an admitted exact read serves, when a layer below answered another
 * package's item: the registry's own item of the holder the address admitted.
 * Another package's item is never served for the address; two bases the
 * package is a pair of, both holding the name, are refused naming both.
 *
 * An item of a customization pair of the address's package, or of a holder it
 * admitted, is that package's own (ADR-0146; #28802, #28390 ruling A: the
 * pair's added member is served on the base's address). It is served as the
 * layers below reached it, never replaced by the registry's item, whose bare
 * slot a dependent's same member can hold (#31699).
 *
 * @returns the item to serve (unchanged when it is the address's).
 */
export function exactQualifierItem(
    host: Pick<ProtocolHost, 'engine'>,
    request: { type: string; name: string },
    address: ExactQualifierAddress,
    item: unknown,
    member: string | undefined,
): unknown {
    if (item === undefined || item === null || typeof item !== 'object') return item;
    const registry = exactQualifierRegistry(host);
    if (!registry) return item;
    const served = (item as { _packageId?: unknown })._packageId;
    if (typeof served !== 'string' || served === address.packageId || address.registryHolders.includes(served)) return item;
    // A provenance sentinel or a package this registry does not hold is not another package's item.
    if (typeof registry.getPackage === 'function' && registry.getPackage(served) === undefined) return item;
    const installed = installedManifestsOfEngine(host.engine);
    if ([address.packageId, ...address.registryHolders].some((base) => isPairOf(served, base, installed))) return item;
    if (address.registryHolders.length > 1) {
        throw refusal(request.type, request.name, address.packageId, 'ambiguous-in-closure',
            address.registryHolders.map((holder) => ({ kind: 'package' as const, packageId: holder })));
    }
    const [holder] = address.registryHolders;
    return holder === undefined ? undefined : registry.getPackageScopedItem(request.type, request.name, holder, member);
}


/**
 * [ADR-0150 D5, child G1] The literal segments a by-name metadata read serves
 * AFTER the item's name — `GET /meta/:type/:name/<segment>` on either
 * transport (the REST route manager and the runtime dispatcher's `/meta`
 * domain). The qualified read `GET /meta/:type/:ns/:name` has the same shape,
 * so a path whose last segment is one of these keeps the meaning it has today:
 * `/meta/app/crm/history` is the history of the app `crm`, never the item
 * `history` of namespace `crm` (seat ruling Q1 = A on #31691). An item named
 * one of these is reached qualified by `?package=`. This is the runtime's
 * reading of D5's precedence ("a literal first"), carried to the ADR-0150
 * amendment card so D5 can state it; no spec constant spells it.
 */
export const META_ITEM_SUBRESOURCE_SEGMENTS: readonly string[] = Object.freeze([
    'audit', 'diff', 'history', 'layers', 'publish', 'published', 'references', 'rollback', 'tree',
]);

/** How the qualified metadata path `/meta/:type/:segment/:name` reads its middle segment. */
export type MetaItemAddress =
    /** `_env`: the environment's own item, exactly ({@link admitEnvironmentQualifier}). */
    | { readonly kind: 'environment' }
    /** An installed namespace: the read is `?package=<packageId>`, the exact qualifier. */
    | { readonly kind: 'namespace'; readonly namespace: string; readonly packageId: string };

/** The registry's namespace catalogue, as the qualified path reads it. */
interface NamespaceCatalogue {
    getNamespaceOwners(namespace: string): string[];
    packageScopedHoldersOf?(type: string, name: string): string[];
}

/**
 * Read the middle segment of `GET /meta/:type/:segment/:name` in D5's order:
 * a sub-resource literal in the last position keeps its route
 * ({@link META_ITEM_SUBRESOURCE_SEGMENTS}: no address); then `_env`; then an
 * installed namespace; else `undefined` — no qualified address, and the path
 * answers what it answers today.
 *
 * A namespace two packages co-own (ADR-0130 D1, ADR-0141 D5) names, for one
 * `(type, name)`, at most one package holder in a judged namespace (ADR-0150
 * D2, child N's install rule): that holder. A shareable namespace (`base`,
 * `system`, `sys`) is exempt from that rule, so two of its owners can hold the
 * name: the address is then refused naming each (`ambiguous-in-namespace`,
 * `409 RESOURCE_CONFLICT`), never picked. When none of the owners holds the
 * name, the first owner is named, and the exact read answers its own refusal
 * or miss.
 *
 * @throws {PackageScopedNameRefusedError} two or more owners hold the name.
 */
export function resolveMetaItemAddress(
    host: Pick<ProtocolHost, 'engine'>,
    request: { type: string; segment: string; name: string },
): MetaItemAddress | undefined {
    // The door hands the type it was asked; fold it once, here.
    request = canonicalizeMetaRequestType(request);
    // A sub-resource literal last keeps its route (ruling Q1): never an address.
    if (META_ITEM_SUBRESOURCE_SEGMENTS.includes(request.name)) return undefined;
    if (request.segment === ENVIRONMENT_ADDRESS_SEGMENT) return { kind: 'environment' };
    const registry = (host.engine as { registry?: Partial<NamespaceCatalogue> } | undefined)?.registry;
    if (typeof registry?.getNamespaceOwners !== 'function') return undefined;
    const reading = readNamespacePositionSegment('meta', request.segment, (ns) => registry.getNamespaceOwners!(ns).length > 0);
    if (reading.reading !== 'namespace') return undefined;
    const owners = registry.getNamespaceOwners(reading.namespace);
    const holders = typeof registry.packageScopedHoldersOf === 'function'
        ? new Set(registry.packageScopedHoldersOf(request.type, request.name) ?? [])
        : new Set<string>();
    const holding = owners.filter((owner) => holders.has(owner));
    // A shareable namespace (`base`, `system`, `sys`) can have several owners
    // holding one name: the address names no one item, so it is refused naming
    // each, never picked (ADR-0150 D2) — as the bare read of the name is.
    if (holding.length > 1) {
        const base = {
            status: 'refused' as const,
            reason: 'ambiguous-in-namespace' as const,
            type: request.type as PackageScopedResolvableType,
            name: request.name,
            callerPackageId: null,
            candidates: holding.map((packageId) => ({ kind: 'package' as const, packageId })),
        };
        throw new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
    }
    const packageId = holding[0] ?? owners[0];
    return { kind: 'namespace', namespace: reading.namespace, packageId };
}

/**
 * [ADR-0150 D5, child G1] Judge a read addressed to the environment
 * (`/meta/:type/_env/:name`): the environment's own item, or a refusal naming
 * every holder. For a type whose readers consult `(package, name)`, a name the
 * environment does not hold and a package does is refused
 * (`not-held-by-qualifier`, `callerPackageId: null`); otherwise the read is a
 * caller with no package, which E8's resolver answers environment-first.
 * Types outside the nine keep the bare read, as `?package=` does for them.
 *
 * @throws {PackageScopedNameRefusedError} when packages hold the name and the
 *   environment does not.
 */
export function admitEnvironmentQualifier(
    host: Pick<ProtocolHost, 'engine'>,
    request: { type: string; name: string; member?: string },
): void {
    request = canonicalizeMetaRequestType(request);
    const registry = exactQualifierRegistry(host);
    if (!registry || !registry.readsByPackage(request.type)) return;
    if (registry.getEnvironmentScopedItem(request.type, request.name, request.member) !== undefined) return;
    const holders = registry.packageScopedHoldersOf(request.type, request.name) ?? [];
    if (holders.length === 0) return;
    const candidates: PackageScopedHolder[] = holders.map((holder) => ({ kind: 'package' as const, packageId: holder }));
    const base = {
        status: 'refused' as const,
        reason: 'not-held-by-qualifier' as const,
        type: request.type as PackageScopedResolvableType,
        name: request.name,
        callerPackageId: null,
        candidates,
    };
    throw new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
}
