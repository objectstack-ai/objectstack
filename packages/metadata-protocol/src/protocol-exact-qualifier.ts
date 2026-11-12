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
 * Scope: every type ADR-0150 addresses by `(package, name)` — core's static
 * `PACKAGE_SCOPED_TYPES`, never a list the registry supplies (epic #31527,
 * the fail-closed obligation of #32076). G1 judged only the types whose
 * by-name readers consult `(package, name)` (`registry.readsByPackage`, E8's
 * nine); a covered type the registry still reads through `getItem` (a flow, a
 * queue, …) kept the prefer-local read for a qualified address, which
 * served the first package that registered the name. Every type outside the
 * covered set keeps the prefer-local read.
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

import {
    appOf,
    isPairOf,
    packageResolutionClosure,
    pairOf,
    pairsOf,
    type InstalledManifestLookup,
    type PackageClosureRegistry,
} from '@objectstack/metadata-core';
import {
    isNamespaceScopedBareNameType,
    isPackageScopedType,
    PackageScopedNameRefusedError,
    isPlatformRequestedBareName,
    packageScopedRefusalMessage,
    resolvePackageScopedHolders,
    type PackageScopedHolder,
    type PackageScopedRefusalReason,
    type PackageScopedResolvableType,
} from '@objectstack/core';
import { ENVIRONMENT_ADDRESS_SEGMENT, readNamespacePositionSegment } from '@objectstack/spec/kernel';
import { installedManifestsOfEngine } from './installed-manifests.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import type { ProtocolHost } from './protocol-host.js';

/**
 * The registry reads the exact qualifier judges a qualified read with: who
 * holds the name, the environment's own item, and one package's item. They do
 * not depend on whether the registry's by-name readers consult `(package,
 * name)` for the type (`SchemaRegistry`'s answer for every type).
 */
interface ExactQualifierRegistry {
    /**
     * [#32310] `callerPackageId` counts the caller's own holding for the caller
     * arm's step 1 ({@link resolveCallerPackageAddress}), as objectql's
     * resolver reads it; the exact qualifier passes none.
     *
     * [#32183] The SERVED holders: a disabled package holds no name.
     * `options.includeDisabledPackages` reads every holder, the read the
     * exact qualifier's admission takes ({@link admitExactQualifier}).
     */
    packageScopedHoldersOf(
        type: string, name: string, callerPackageId?: string | null,
        options?: { includeDisabledPackages?: boolean },
    ): string[];
    getEnvironmentScopedItem(type: string, name: string, member?: string): unknown;
    getPackageScopedItem(type: string, name: string, packageId: string, member?: string): unknown;
    getPackage?(id: string): unknown;
}

/**
 * The registry reads a by-name read naming no package is judged with: how the
 * registry reads the type, and the package-scoped resolver it answers a caller
 * with no package through when it reads the type by package.
 */
interface PackagelessReadRegistry {
    readsByPackage(type: string): boolean;
    resolveItem(type: string, name: string, callerPackageId?: string | null, member?: string): unknown;
    /** [ADR-0150 child B, #31697] The bare `action` read's own holder judge, which `readMetaItem` asks. */
    refuseAmbiguousObjectLessAction?(name: string, readStoredRows?: () => Promise<readonly unknown[]>): Promise<void>;
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

/** The engine's registry, as the reads below probe it. */
function registryOf(host: Pick<ProtocolHost, 'engine'>): Partial<ExactQualifierRegistry & PackagelessReadRegistry> | undefined {
    return (host.engine as { registry?: Partial<ExactQualifierRegistry & PackagelessReadRegistry> } | undefined)?.registry;
}

/**
 * The engine registry's exact-qualifier reads ({@link ExactQualifierRegistry}).
 * `undefined` when the registry lacks any of them.
 */
function exactQualifierRegistry(host: Pick<ProtocolHost, 'engine'>): ExactQualifierRegistry | undefined {
    const registry = registryOf(host);
    if (typeof registry?.packageScopedHoldersOf !== 'function'
        || typeof registry.getEnvironmentScopedItem !== 'function'
        || typeof registry.getPackageScopedItem !== 'function') {
        return undefined;
    }
    return registry as ExactQualifierRegistry;
}

/** Whose read a `501` refusal of a read the registry cannot judge names ({@link unjudgeableRefusal}). */
export type UnjudgeableReadAddress =
    /** `?package=X`, or the qualified path the doors translate to it. */
    | { readonly kind: 'package'; readonly packageId: string }
    /** `/meta/:type/_env/:name`. */
    | { readonly kind: 'environment' }
    /** A read that names no package. */
    | { readonly kind: 'none' };

/**
 * Why the engine's registry cannot judge a read of `type` answered as a
 * caller with no package (a read naming no package, and `_env` once the
 * environment qualifier admits it) — `undefined` when it can, or when the type
 * is not one ADR-0150 addresses by `(package, name)` (core's static
 * `PACKAGE_SCOPED_TYPES`, never a list the registry would have to supply).
 * A read naming a package is the exact qualifier's ({@link admitExactQualifier}),
 * which refuses itself when the registry lacks the reads it needs. For a
 * covered type:
 *  - on a registry with no `readsByPackage`: `no-resolver`, since the registry
 *    cannot say how it reads the type;
 *  - on a registry that reads the type by package, it is answered through the
 *    package-scoped resolver (`resolveItem`); missing it: `no-resolver`;
 *  - on a registry that answers `false` (it reads the type through `getItem`,
 *    as `SchemaRegistry` reads a type no child of epic #31527 has wired), it
 *    keeps `getItem`'s read, as on `main` (seat ruling (a)): each such type
 *    narrows in its own reader card. A type whose names are scoped to the
 *    namespace (`NAMESPACE_SCOPED_BARE_NAME_TYPES`) can have two package
 *    holders of a name: `narrowed`, refused like a missing resolver (seat
 *    ruling (b)), unless the registry judges that read itself. `action` is
 *    such a type: `SchemaRegistry` counts an object-less action's holders
 *    for the bare read (`refuseAmbiguousObjectLessAction`, asked by
 *    `readMetaItem`, #31697), and `readMetaItem` counts the registry's
 *    package holders of the name on any object key besides
 *    (`refuseActionHeldByPackages`, #32244).
 */
function unjudgeableCause(
    host: Pick<ProtocolHost, 'engine'>,
    type: string,
): 'no-resolver' | 'narrowed' | undefined {
    if (!isPackageScopedType(type)) return undefined;
    const registry = registryOf(host);
    if (typeof registry?.readsByPackage !== 'function') return 'no-resolver';
    if (registry.readsByPackage(type)) return typeof registry.resolveItem === 'function' ? undefined : 'no-resolver';
    if (!isNamespaceScopedBareNameType(type)) return undefined;
    return type === 'action' && typeof registry.refuseAmbiguousObjectLessAction === 'function' ? undefined : 'narrowed';
}

/** The `501 NOT_IMPLEMENTED` refusal of a read {@link unjudgeableCause} names a cause for. */
function unjudgeableRefusal(
    request: { type: string; name: string },
    address: UnjudgeableReadAddress,
    cause: 'no-resolver' | 'narrowed',
): Error {
    const naming = address.kind === 'package'
        ? `naming package '${address.packageId}'`
        : address.kind === 'environment' ? 'naming the environment' : 'naming no package';
    const why = cause === 'narrowed'
        ? `this composition's metadata engine has no package-scoped resolver for '${request.type}' items `
            + '(its registry reads them through getItem), and their names are scoped to the namespace, so two '
            + 'packages may hold the name and the read could only be served by first match (ADR-0150 D2/D3)'
        : 'this composition\'s metadata engine has no package-scoped resolver, so the read could only be '
            + `served by first match, ${address.kind === 'package'
                ? 'which may be another package\'s item (ADR-0150 D5)'
                : 'and two packages may hold the name (ADR-0150 D3)'}`;
    const err = new Error(
        `A by-name read of the '${request.type}' item '${request.name}' ${naming} cannot be answered here: `
        + `${why}. Mount the metadata protocol on an ObjectQL engine, whose registry resolves package-scoped names.`,
    ) as Error & { status: number; code: string; refusal: boolean };
    err.status = 501;
    err.code = 'NOT_IMPLEMENTED';
    // A declared refusal, not a fault: the transport keeps the sentence above.
    err.refusal = true;
    return err;
}

/**
 * [ADR-0150 D3/D5, epic #31527] A by-name read the composition cannot judge
 * fails closed. A type ADR-0150 addresses by `(package, name)` is read by
 * package only through the registry's package-scoped reads
 * ({@link unjudgeableCause}). On an engine whose registry lacks them, the
 * only read left is `getItem`'s first match, which may be another package's
 * item; so such a read is refused here, before any layer is read, with
 * `501 NOT_IMPLEMENTED` naming the cause. Never a first match (red line 1),
 * never a guess (red line 2).
 *
 * For a read answered as a caller with no package: a read naming no package
 * (`address` `none`), and `_env` once {@link admitEnvironmentQualifier} admits
 * it (`environment`). A read naming a package is refused by
 * {@link admitExactQualifier} itself.
 *
 * Every production composition carries the reads (`ObjectQL`'s
 * `SchemaRegistry`); only an engine without them, such as a test double or an
 * embedder's own engine, reaches the refusal. A type outside the set is
 * unchanged.
 *
 * @throws a `501 NOT_IMPLEMENTED` refusal (`refusal: true`, so the 5xx keeps
 *   its sentence at the transport) when the read cannot be judged.
 */
export function refuseUnjudgeableByNameRead(
    host: Pick<ProtocolHost, 'engine'>,
    request: { type: string; name: string },
    address: Exclude<UnjudgeableReadAddress, { kind: 'package' }>,
): void {
    const cause = unjudgeableCause(host, request.type);
    if (cause !== undefined) throw unjudgeableRefusal(request, address, cause);
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
 *   ADR-0150 does not address by `(package, name)`), else the admitted address.
 * @throws {PackageScopedNameRefusedError} `not-held-by-qualifier`, naming
 *   every holder, when the package holds no item of the name and another
 *   holder does — the package holders, and the environment's own item.
 * @throws a `501 NOT_IMPLEMENTED` refusal (`refusal: true`) when the registry
 *   lacks the reads the judgment needs (`packageScopedHoldersOf`,
 *   `getEnvironmentScopedItem`, `getPackageScopedItem`).
 */
export async function admitExactQualifier(
    host: Pick<ProtocolHost, 'engine' | 'findServedOverlayRow'>,
    request: { type: string; name: string; packageId?: string; member?: string },
): Promise<ExactQualifierAddress | undefined> {
    const packageId = request.packageId;
    if (!packageId || !isPackageScopedType(request.type)) return undefined;
    const registry = exactQualifierRegistry(host);
    if (!registry) throw unjudgeableRefusal(request, { kind: 'package', packageId }, 'no-resolver');

    // X named is X's holding even when it is a bundle addition (R2 drops one
    // only for OTHER readers): the qualifier asks as the caller it names.
    // [#32183, ruling (c)] Admission asks every holder, a disabled package's
    // included: X named is X's holding, or a base X is a pair of, whether or
    // not that package is disabled. So `?package=DISABLED` and its pair are
    // admitted and the item face answers the disabled item's 404, never a
    // refusal naming the enabled holder; the qualifier never serves the
    // disabled body (the face withholds it).
    const every = registry.packageScopedHoldersOf(request.type, request.name, packageId, { includeDisabledPackages: true }) ?? [];
    if (every.includes(packageId)) return { packageId, registryHolders: [packageId] };

    // [#32183] The candidates a refusal names, and the bases a pair is read
    // at, are the served holders: a disabled package holds no name, so it is
    // never named beside an enabled one. A pair whose every base is disabled
    // is still admitted at those bases, and the item face withholds it
    // ({@link disabledExactAddressHolder}).
    const holders = registry.packageScopedHoldersOf(request.type, request.name) ?? [];
    const installed = installedManifestsOfEngine(host.engine);
    const servedBases = holders.filter((holder) => pairsOf(holder, installed).includes(packageId));
    if (servedBases.length > 0) return { packageId, registryHolders: servedBases };
    // Every base disabled: the address reads one of them, which the face
    // withholds, so no refusal names a disabled base.
    const pairedBases = every.filter((holder) => pairsOf(holder, installed).includes(packageId));
    if (pairedBases.length > 0) return { packageId, registryHolders: pairedBases.slice(0, 1) };

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
 * [#32183, ruling (c)] The disabled package an exact address reads, when every
 * package it reads is disabled: the package `packageId` names when it is
 * disabled ([#32354] whether it holds the name in the registry or only as a
 * stored row), else the bases it is a pair of when none of them is enabled (the
 * bases {@link admitExactQualifier} admits it at). `undefined` when the
 * address reads an enabled package, reads no holder, or the type is not
 * package-scoped. The item face answers such an address as that package's
 * withheld item, whichever package's envelope a layer of the read reached:
 * the disabled body is never served, and no enabled holder is named.
 * Optional-called: a registry without `isPackageDisabled` withholds nothing more.
 */
export function disabledExactAddressHolder(
    host: Pick<ProtocolHost, 'engine'>,
    request: { type: string; name: string; packageId: string },
): string | undefined {
    if (!isPackageScopedType(request.type)) return undefined;
    const registry = registryOf(host) as (Partial<ExactQualifierRegistry> & { isPackageDisabled?(id: string): boolean }) | undefined;
    if (typeof registry?.packageScopedHoldersOf !== 'function' || typeof registry.isPackageDisabled !== 'function') return undefined;
    const disabled = (id: string) => registry.isPackageDisabled!(id) === true;
    // [#32354] A disabled package named is its own withheld item whether it
    // holds the name in the registry or only as a stored row, which the
    // registry need not know (one bare slot per name): the read reached its
    // row, and served its body under the envelope of the package that ships
    // the name.
    if (disabled(request.packageId)) return request.packageId;
    const every = registry.packageScopedHoldersOf(request.type, request.name, request.packageId, { includeDisabledPackages: true }) ?? [];
    if (every.includes(request.packageId)) return undefined;
    const installed = installedManifestsOfEngine(host.engine);
    const bases = every.filter((holder) => pairsOf(holder, installed).includes(request.packageId));
    return bases.length > 0 && bases.every(disabled) ? bases[0] : undefined;
}

/**
 * The item an admitted exact read serves, when a layer below answered another
 * package's item: the registry's own item of the holder the address admitted.
 * Another package's item is never served for the address; two bases the
 * package is a pair of, both holding the name, are refused naming both. A
 * customization pair's item is its base's: the base's address serves the
 * pair's override and its added bundle member (ADR-0146 D2, #28802), so it is
 * kept, never replaced by the base's own member.
 *
 * A pair's row that two or more holders of the name could own is no one
 * package's (two packages of one App share the App's pair, ADR-0146 D3, and
 * the row declares no `overrides` naming one of them). It is refused on each
 * such holder's address, naming every one ({@link pairMemberOwners}, epic
 * ruling on #31699 F2). A row with one owner is kept on that owner's address
 * only, and a row that declares the base it customizes on that base's address
 * only. The App's own address keeps #28390 ruling A for a row that declares
 * nothing or declares the App.
 *
 * The owner check is one function, {@link pairRowOnAddress}, which the list
 * scoped to a package asks too ({@link pairMemberWithheldAt}); a row whose sole
 * owner is not one of the address's bases is that owner's, not this
 * address's (#32277 delta review S2).
 *
 * A package-less row (the environment's item, or a `sys_metadata` row bound to
 * no package) of a name two or more packages hold is no holder's own, for a
 * type whose by-name readers consult `(package, name)` ({@link
 * packageLessRowOwners}, epic ruling on #31699): refused naming every holder.
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
    // A row hydrated into the registry carries `''` or the provenance sentinel
    // `sys_metadata` where a stored row carries no package: both are no package.
    if (typeof served !== 'string' || served === '' || served === 'sys_metadata') {
        // [epic ruling 6761802819 on #31699] A package-less row of a name two
        // or more packages hold is no package's own (D4: it is the
        // customization of one holder and cannot say which), so no holder's
        // exact address serves it. The `_env` address never reaches here.
        const owners = packageLessRowOwners(registry, request.type, request.name);
        if (owners.length > 1) {
            throw refusal(request.type, request.name, address.packageId, 'ambiguous-in-closure',
                owners.map((owner) => ({ kind: 'package' as const, packageId: owner })));
        }
        return item;
    }
    if (served === address.packageId || address.registryHolders.includes(served)) return item;
    // [#32076] A pair of the package the address names, or of a base it admitted, serves on that base's address
    // when the row is that base's (epic ruling on #31699 F2; {@link pairRowOnAddress}, the one owner check).
    const installed = installedManifestsOfEngine(host.engine);
    const bases = [address.packageId, ...address.registryHolders];
    if (bases.some((base) => isPairOf(served, base, installed))) {
        const verdict = pairRowOnAddress(served, item, address.packageId, bases,
            registry.packageScopedHoldersOf(request.type, request.name) ?? [], installed);
        if (verdict === 'serve') return item;
        if (verdict !== 'not-member') {
            throw refusal(request.type, request.name, address.packageId, 'ambiguous-in-closure',
                verdict.refuse.map((owner) => ({ kind: 'package' as const, packageId: owner })));
        }
        // Another holder's row: not this address's item, so the admitted holder's is served below.
    } else if (typeof registry.getPackage === 'function' && registry.getPackage(served) === undefined) {
        // A provenance sentinel or a package this registry does not hold is not another package's item.
        return item;
    }
    if (address.registryHolders.length > 1) {
        throw refusal(request.type, request.name, address.packageId, 'ambiguous-in-closure',
            address.registryHolders.map((holder) => ({ kind: 'package' as const, packageId: holder })));
    }
    const [holder] = address.registryHolders;
    return holder === undefined ? undefined : registry.getPackageScopedItem(request.type, request.name, holder, member);
}

/**
 * Where a caller-arm read is read: the holder the caller resolves to, read at
 * its exact address (`?package=<holder>`), or the environment's own item for
 * a name the platform requests by spelling (ADR-0150 D3's exception), which
 * every caller reads environment-wide.
 */
export type CallerPackageAddress =
    | { readonly kind: 'package'; readonly packageId: string }
    | { readonly kind: 'environment' };

/** The registry reads the caller arm asks: the exact qualifier's, and the closure walk's. */
type CallerPackageRegistry = ExactQualifierRegistry & PackageClosureRegistry;

/**
 * [ADR-0150 D3, #32310] Resolve a by-name read made FROM package
 * `callerPackageId` (`?callerPackage=`): a dashboard, report or chart of
 * package P naming a dataset. Unlike `?package=`, the exact qualifier (D5),
 * this is the caller's resolution, by the ONE rule (`resolvePackageScopedHolders`,
 * `@objectstack/core`) over the holders the bare read resolves over
 * (`packageScopedHoldersOf`, as objectql's `resolvePackageScopedName` reads
 * them), with P's closure from the one walk (`packageResolutionClosure`):
 *
 *  1. P's own item;
 *  2. else the unique holder in P's declared dependency closure plus `sys`;
 *  3. else a refusal naming the candidates: `ambiguous-in-closure` for two
 *     holders in the closure, `outside-closure` for holders P cannot reach
 *     (`409 RESOURCE_CONFLICT`, thrown). ⛔ Never an environment-wide guess.
 *
 * The answer is an ADDRESS, not an item: the door reads the resolved holder
 * at its exact qualifier (`?package=<holder>`), so the holder's bound overlay,
 * drafts, lock, version and every read gate after it — admission included —
 * answer exactly as they answer that address. A name nothing holds is read at
 * P's own address, which answers its own miss (or a stored row bound to P).
 *
 * A caller package that is not installed is read at its own address too, so
 * it answers exactly what `?package=` naming it answers (`409` naming the
 * holders, or the read's miss) — ⛔ never the bare read.
 *
 * @throws {PackageScopedNameRefusedError} when the rule refuses.
 * @throws an error with `code: 'SERVICE_UNAVAILABLE'` (`503`) when the type
 *   is not one ADR-0150 addresses by package (core's `isPackageScopedType`),
 *   or the registry lacks the exact qualifier's reads: the arm fails closed.
 */
export function resolveCallerPackageAddress(
    host: Pick<ProtocolHost, 'engine'>,
    request: { type: string; name: string; callerPackageId: string; member?: string },
): CallerPackageAddress {
    request = canonicalizeMetaRequestType(request);
    const { type, name, callerPackageId, member } = request;
    // [#32277] Whether a type is addressed by package is core's static
    // `PACKAGE_SCOPED_TYPES` (`isPackageScopedType`), the one rule the exact
    // qualifier reads, never a list the registry supplies; and a registry
    // without the exact qualifier's reads cannot judge the name. Either way
    // the arm fails closed, never a first match.
    const registry = isPackageScopedType(type)
        ? exactQualifierRegistry(host) as CallerPackageRegistry | undefined
        : undefined;
    if (!registry) {
        throw Object.assign(
            new Error(`The ${type} "${name}" could not be resolved from package "${callerPackageId}": this deployment's `
                + `metadata registry does not resolve ${type} names by package. This is a server-side fault.`),
            { code: 'SERVICE_UNAVAILABLE', status: 503 },
        );
    }
    const installed = typeof registry.getPackage === 'function' && registry.getPackage(callerPackageId) !== undefined;
    if (!installed && registry.residualOwnerDependenciesOf?.(callerPackageId) === undefined) {
        return { kind: 'package', packageId: callerPackageId };
    }
    const resolution = resolvePackageScopedHolders(
        { type: type as PackageScopedResolvableType, name, callerPackageId },
        {
            // The caller's own holding counts for its step 1 even as a bundle addition.
            packageHolders: registry.packageScopedHoldersOf(type, name, callerPackageId) ?? [],
            packageItem: (packageId) => registry.getPackageScopedItem(type, name, packageId, member),
            environmentItem: () => registry.getEnvironmentScopedItem(type, name, member),
        },
        (caller) => packageResolutionClosure(registry, caller),
    );
    if (resolution.status === 'refused') throw new PackageScopedNameRefusedError(resolution);
    if (resolution.status === 'not-found') return { kind: 'package', packageId: callerPackageId };
    return resolution.holder.kind === 'package'
        ? { kind: 'package', packageId: resolution.holder.packageId }
        : { kind: 'environment' };
}


/**
 * [ADR-0150 D4, epic ruling 6761802819 on #31699] The packages a package-less
 * row of `(type, name)` could be the customization of: every package holding
 * the name, for a type whose readers consult `(package, name)`. Two or more
 * mean the row cannot say whose it is: each holder's exact read refuses it
 * naming every one, the list scoped to a holder leaves it out (so a send made
 * from a holder reads that holder's own), and `os migrate stored-references`
 * lists it, until it is saved under one package. With one holder it is that
 * holder's customization, as before. A name the platform requests by
 * spelling (the `auth.*` mails) resolves environment-wide, so its
 * package-less row stays the environment's: an empty answer. ⛔ Never a pick
 * between two.
 */
export function packageLessRowOwners(
    registry: {
        readsByPackage?(type: string): boolean;
        packageScopedHoldersOf(
            type: string, name: string, callerPackageId?: string | null,
            options?: { includeDisabledPackages?: boolean },
        ): readonly string[] | undefined;
    },
    type: string,
    name: string,
    options?: { includeDisabledPackages?: boolean },
): string[] {
    if (registry.readsByPackage?.(type) !== true || !isPackageScopedType(type)) return [];
    if (isPlatformRequestedBareName(type, name)) return [];
    // [#32183] The served holders: a read judges them, so a package-less row
    // of a name an enabled and a disabled package hold is the enabled one's.
    // A durable report (`os migrate stored-references`) asks every holder
    // (`includeDisabledPackages`), so its listing never moves with a
    // reversible disable.
    return [...((options === undefined
        ? registry.packageScopedHoldersOf(type, name)
        : registry.packageScopedHoldersOf(type, name, null, options)) ?? [])];
}

/**
 * Whether a list scoped to a package leaves out the package-less stand-in
 * row `name` ({@link packageLessRowOwners}: two or more holders could own it).
 */
export function packageLessRowWithheld(host: Pick<ProtocolHost, 'engine'>, type: string, name: unknown): boolean {
    if (typeof name !== 'string' || name === '') return false;
    const registry = exactQualifierRegistry(host);
    return registry !== undefined && packageLessRowOwners(registry, type, name).length > 1;
}

/** The base a member row's body declares it customizes (`overrides.package`, ADR-0146 D2), or `undefined`. */
function declaredOverrideBase(item: unknown): string | undefined {
    const declaration = (item as { overrides?: unknown } | null | undefined)?.overrides;
    if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) return undefined;
    const base = (declaration as { package?: unknown }).package;
    return typeof base === 'string' && base !== '' ? base : undefined;
}

/**
 * [#28390 ruling A] Whether `pairId` is the pair of the App `base` itself (not
 * the pair `base` shares as a member of an App): a member row there is the
 * App's own added member on the App's own address.
 */
function isAppPairOf(pairId: string, base: string, installed: InstalledManifestLookup): boolean {
    if (appOf(base, installed) !== base) return false;
    const pair = pairOf(base, installed);
    return pair.ok && pair.value === pairId;
}

/**
 * [ADR-0150 D3/D4, epic ruling on #31699 F2] The holders of a bundle's name
 * that a member row stored in the customization package `pairId` could be the
 * added member of: every holder `pairId` is a pair of (ADR-0146 D3: the App's
 * pair is shared by every package of the App), narrowed to the one the row's
 * body declares it customizes (`overrides.package`) when it declares one.
 *
 * Two or more answers mean the row cannot say whose member it is: each such
 * holder's exact read refuses it naming every one, the list scoped to a holder
 * leaves it out, and `os migrate stored-references` lists it, until the row
 * declares the base it customizes. One answer is that holder's member (#28390
 * ruling A). ⛔ Never a pick between two.
 */
export function pairMemberOwners(
    pairId: string,
    holders: readonly string[],
    installed: InstalledManifestLookup,
    row?: unknown,
): string[] {
    const owners = holders.filter((holder) => isPairOf(pairId, holder, installed));
    const declared = declaredOverrideBase(row);
    return declared === undefined ? owners : owners.filter((holder) => holder === declared);
}

/**
 * [Epic ruling on #31699 F2] Whether the list scoped to `base` leaves out the
 * member row `item` its pair `pairId` stores: the row could be the added
 * member of two or more holders of the name ({@link pairMemberOwners}) and
 * `base` is not the App whose own pair it is, or the row declares another
 * base. Only for a type whose readers consult `(package, name)`; every other
 * type keeps the list as it was.
 */
export function pairMemberWithheldAt(
    host: Pick<ProtocolHost, 'engine'>,
    type: string,
    name: string,
    base: string,
    pairId: string,
    item: unknown,
): boolean {
    const registry = exactQualifierRegistry(host);
    if (!registry || (registry as { readsByPackage?(type: string): boolean }).readsByPackage?.(type) !== true) return false;
    return pairRowOnAddress(pairId, item, base, [base], registry.packageScopedHoldersOf(type, name) ?? [],
        installedManifestsOfEngine(host.engine)) !== 'serve';
}

/**
 * [#31699 F2, contract review F-B, delta review S2] The one owner check for a
 * customization pair's member row `item` (stored under `pairId`) met on the
 * exact address of `addressPackageId`, whose admitted bases are `bases` (the
 * address's package and the holders it admitted), given every package
 * `holders` holding the name. Self-contained, so a generic pair line (#32277)
 * can hoist it to the top of {@link exactQualifierItem}; the scoped list asks
 * the same question ({@link pairMemberWithheldAt}).
 *
 * - A row that declares the base it customizes (`overrides.package`) is that
 *   base's member only, the App's own address included: read first (F-B).
 * - Else the App's own pair keeps its added member on the App's address
 *   (#28390 ruling A).
 * - Else two or more holders could own it: refuse, naming every one (F2).
 * - Else a sole owner that is not one of the address's bases owns it: not
 *   this address's member (S2).
 * - Else (the sole owner is a base, or no holder pairs it) it is served.
 */
export function pairRowOnAddress(
    pairId: string,
    item: unknown,
    addressPackageId: string,
    bases: readonly string[],
    holders: readonly string[],
    installed: InstalledManifestLookup,
): 'serve' | 'not-member' | { refuse: string[] } {
    const declared = declaredOverrideBase(item);
    if (declared !== undefined) return bases.includes(declared) ? 'serve' : 'not-member';
    if (isAppPairOf(pairId, addressPackageId, installed)) return 'serve';
    const owners = pairMemberOwners(pairId, holders, installed, item);
    if (owners.length > 1) return { refuse: owners };
    if (owners.length === 1 && !bases.includes(owners[0]!)) return 'not-member';
    return 'serve';
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
    packageScopedHoldersOf?(
        type: string, name: string, callerPackageId?: string | null,
        options?: { includeDisabledPackages?: boolean },
    ): string[];
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
    // [#32183] The served holders judge the namespace; a disabled package
    // holds no name, so a co-owner it shares the namespace with answers alone.
    const holding = owners.filter((owner) => holders.has(owner));
    // …and when no served owner holds the name, an owner that holds it while
    // disabled is still the address (its read answers the withheld 404, never
    // a refusal naming another package).
    const every = holding.length === 0 && typeof registry.packageScopedHoldersOf === 'function'
        ? new Set(registry.packageScopedHoldersOf(request.type, request.name, null, { includeDisabledPackages: true }) ?? [])
        : new Set<string>();
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
    const packageId = holding[0] ?? owners.find((owner) => every.has(owner)) ?? owners[0];
    return { kind: 'namespace', namespace: reading.namespace, packageId };
}

/**
 * [ADR-0150 D5, child G1] Judge a read addressed to the environment
 * (`/meta/:type/_env/:name`): the environment's own item, or a refusal naming
 * every holder. For a type ADR-0150 addresses by `(package, name)`, a name the
 * environment does not hold and a package does is refused
 * (`not-held-by-qualifier`, `callerPackageId: null`); otherwise the read is a
 * caller with no package, which E8's resolver answers environment-first.
 * Types outside the covered set keep the bare read, as `?package=` does for
 * them.
 *
 * @throws {PackageScopedNameRefusedError} when packages hold the name and the
 *   environment does not.
 * @throws a `501 NOT_IMPLEMENTED` refusal (`refusal: true`) when the registry
 *   lacks the reads the judgment needs (`packageScopedHoldersOf`,
 *   `getEnvironmentScopedItem`, `getPackageScopedItem`), or, for the read it
 *   admits as a caller with no package, the reads that read needs
 *   ({@link refuseUnjudgeableByNameRead}, naming the environment).
 */
export function admitEnvironmentQualifier(
    host: Pick<ProtocolHost, 'engine'>,
    request: { type: string; name: string; member?: string },
): void {
    request = canonicalizeMetaRequestType(request);
    if (!isPackageScopedType(request.type)) return;
    const registry = exactQualifierRegistry(host);
    if (!registry) throw unjudgeableRefusal(request, { kind: 'environment' }, 'no-resolver');
    // [#32076] Admitted, `_env` is read as a caller with no package: its refusal names the environment.
    if (registry.getEnvironmentScopedItem(request.type, request.name, request.member) !== undefined) {
        refuseUnjudgeableByNameRead(host, request, { kind: 'environment' });
        return;
    }
    // [#32183, epic ruling R4-B2] The served holders, or every holder when no
    // package serves the name: a name only disabled packages hold is refused
    // naming them, as before, never read as a caller with no package (that
    // read can reach a disabled holder's customization pair row).
    const served = registry.packageScopedHoldersOf(request.type, request.name) ?? [];
    const holders = served.length > 0
        ? served
        : registry.packageScopedHoldersOf(request.type, request.name, null, { includeDisabledPackages: true }) ?? [];
    if (holders.length === 0) {
        refuseUnjudgeableByNameRead(host, request, { kind: 'environment' });
        return;
    }
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
