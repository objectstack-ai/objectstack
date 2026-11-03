// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E2 cut 1a] The metadata LIST reads of `ObjectStackProtocolImplementation`:
 * `getMetaItems`, its execution and per-package faces, and the flattened read
 * the three share (`readFlattenedMetaItems`).
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as it stood, re-indented one level, with `this.<member>`
 * read as `host.<member>` and nothing else changed
 * (`node scripts/host-split.mjs check <base> <member> protocol-meta-list-reads.ts`
 * proves it). Each method stays on the class with its docblock and signature,
 * which the published `.d.ts` prints, and hands its body the host
 * (`protocol-host.ts`).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { ITEM_KEY_DISCRIMINATORS, isTenantAuthored } from '@objectstack/metadata-core';
import { customizationPackageId } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { isAggregatedViewContainer } from '@objectstack/spec/ui';
import {
    type ItemAddress,
    type ItemLock,
    resolveItemLock,
    resolveOverlayLockLayer,
} from './item-lock.js';
import { decorateMetadataItems } from './metadata-diagnostics.js';
import {
    isActionWithheldByDisabledPackage,
    isItemOfDisabledPackage,
} from './protocol-authoring-refusals.js';
import { soleShippingPackage } from './protocol-environment-rows.js';
import type { ProtocolHost } from './protocol-host.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { mergePackageAwareOverlay, servedViewExpansion } from './protocol-overlay-merge.js';
import {
    type ShippingPackages,
    boundPackageOf,
    bundleMemberOf,
    envelopePackageId,
    mergeArtifactProtection,
    perPackageLayerEnvelope,
    withRowBinding,
} from './protocol-package-bindings.js';
import { storedEntryRow } from './protocol-stored-overlay-types.js';
import { viewIdentityPatch } from './protocol-view-normalization.js';
import { isServedOverrideRowOf } from './served-override.js';

/** The body of `ObjectStackProtocolImplementation#getMetaItems`; the method's docblock there is its contract. */
export async function getMetaItems(host: Pick<ProtocolHost, 'readFlattenedMetaItems'>, request: { type: string; packageId?: string; previewDrafts?: boolean }) {
    // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. This one
    // is load-bearing twice over: the SchemaRegistry indexes code-authored
    // items under the SINGULAR type, and the overlay-hydration branch below
    // registers overlay rows back into it under `request.type`. Called with
    // the plural spelling, that branch minted a PLURAL registry entry — and
    // once `listItems('actions')` was non-empty, the singular fallback that
    // had been supplying the 11 code-authored actions stopped running. One
    // overlay row shadowed the entire code-authored listing. Folded HERE, at
    // each face's boundary, so the shared body only ever sees the canonical
    // key.
    return host.readFlattenedMetaItems(canonicalizeMetaRequestType(request), 'served');
}

/** The body of `ObjectStackProtocolImplementation#getMetaItemsForExecution`; the method's docblock there is its contract. */
export async function getMetaItemsForExecution(host: Pick<ProtocolHost, 'readFlattenedMetaItems'>, request: { type: string; packageId?: string; previewDrafts?: boolean }) {
    // The same #4432 fold {@link getMetaItems} applies, for the same reason.
    return host.readFlattenedMetaItems(canonicalizeMetaRequestType(request), 'execution');
}

/** The body of `ObjectStackProtocolImplementation#getMetaItemsPerPackage`; the method's docblock there is its contract. */
export async function getMetaItemsPerPackage(host: Pick<ProtocolHost, 'readFlattenedMetaItems'>, request: { type: string; packageId?: string; previewDrafts?: boolean }) {
    // The same #4432 fold {@link getMetaItems} applies, for the same reason.
    return host.readFlattenedMetaItems(canonicalizeMetaRequestType(request), 'served', 'per-package');
}

/** The body of `ObjectStackProtocolImplementation#readFlattenedMetaItems`; the method's docblock there is its contract. */
export async function readFlattenedMetaItems(host: Pick<ProtocolHost, 'artifactLockLayerAt' | 'baseServesBundleMember' | 'convertStoredItem' | 'declinesStoredRow' | 'disabledActionsOf' | 'engine' | 'environmentId' | 'expandStoredViewContainers' | 'findEnvironmentRows' | 'flowRegistrationsOf' | 'foldObjectExtendersFromRegistry' | 'getServicesRegistry' | 'governServedObject' | 'hydrateOverlayIntoRegistry' | 'isStoredEntryOfDeclinedName' | 'isUnservedSealedOverlay' | 'isWritablePackage' | 'lookupArtifactItem' | 'namesWithOwnStoredRow' | 'readActiveOverlayRows' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'shippedArtifactsOf' | 'shippingPackagesOf' | 'shipsBundleName' | 'storedOverlayEntries'>, request: { type: string; packageId?: string; previewDrafts?: boolean },
        audience: 'served' | 'execution',
        layer: 'effective' | 'per-package' = 'effective',) {
    const { packageId } = request;
    const servedOverride = layer === 'effective';
    // [#29871] The per-package layer is each package's own address, and a
    // disable empties none: a disabled package's items stay stored and come
    // back on enable. So this layer keeps them (the package export reads it,
    // and exports every package, enabled or not); the effective and the
    // execution reads hide them, at the registry and after the merges below.
    const keepDisabledPackages = layer === 'per-package';
    // [#29903, ADR-0146 D8 item 3] …and it serves a package's objects as the
    // package declares them: its `.custom` pair's extension of one is the
    // pair's item, exported as the pair's `objectExtensions` entry, never
    // folded into the base's object for the base's export (a field and its
    // patches would travel twice, the second time as the base's). Every
    // other contributor folds as on the effective read, and the effective
    // and execution reads keep the pair's extension in the object they serve.
    const pairOfLayer = layer === 'per-package' && packageId ? customizationPackageId(packageId) : undefined;
    const withoutExtensionsOf = pairOfLayer?.ok ? pairOfLayer.value : undefined;
    const listRegistry = (type: string): unknown[] => (keepDisabledPackages
        ? host.engine.registry.listItems(type, packageId, {
            includeDisabledPackages: true,
            ...(withoutExtensionsOf !== undefined ? { withoutExtensionsOf } : {}),
        })
        : host.engine.registry.listItems(type, packageId));
    // ── [ADR-0131 D6] The environment → code read ──────────────────────
    //
    // The list serves the environment's stored rows over the code
    // packages' definitions, and no organization's: a legacy
    // organization-scoped row is refused at boot
    // (the v18 boot refusal, ADR-0131 D10 item 5) and never served — the
    // anonymous form doors included: their read of the Default
    // Organization's legacy `view` layer was deleted when the v18
    // migration ceremony (ADR-0131 C7) began carrying its withdrawals into
    // the environment, fail-closed.
    let items: unknown[] = [];

    // Unscoped kernels (control plane): read everything from SchemaRegistry.
    // Scoped (project) kernels: skip user-project entries in SchemaRegistry to
    // prevent cross-project leakage, but DO include scope:'system' packages
    // (plugin-auth, plugin-security, plugin-audit, …) — those are globally
    // shared and must be visible at every project's meta endpoint.
    if (host.environmentId === undefined) {
        items = [...listRegistry(request.type)];
        // Normalize singular/plural using explicit mapping
        if (items.length === 0) {
            const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
            if (alt) items = [...listRegistry(alt)];
        }
    } else {
        // For project kernels: the SchemaRegistry is owned by THIS
        // kernel's ObjectQL instance (not shared across projects in the
        // process), so we can safely include every package — system
        // plugins (auth/security/audit) and the project's own app
        // package alike. The `_packageId` tag added by `listItems`
        // (registry.ts) is preserved for the sidebar to compute the
        // correct navigation URL.
        items = [...listRegistry(request.type)];
        if (items.length === 0) {
            const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
            if (alt) items = [...listRegistry(alt)];
        }
    }

    // [#20913] A shipped flow name serves the loader's entries only — see
    // {@link isShippedFlowName}. This is the registry half: a stored row
    // the hydration registered under the bare key is not one of them.
    // [#21922] …and a code-defined datasource name serves the
    // MetadataService's code definition, merged in below. One predicate
    // for both: {@link declinesStoredRow}, whose registry half this is.
    items = items.filter((it) => !host.isStoredEntryOfDeclinedName(request.type, it));

    // Always consult the DB so metadata persisted by the seeder /
    // bulkRegister shows up even when the registry already has unrelated
    // entries (the previous fallback-only logic meant per-env metadata
    // was never surfaced whenever system-bridged items populated the
    // registry). Deduplicate against whatever the registry returned.
    //
    // [ADR-0131 D6/D7] The environment's rows: a legacy organization's are
    // left out at the read ({@link readActiveOverlayRows}).
    // [#21761] Every active row of the type in this caller's scopes,
    // whichever package each is bound to: what each listed item's lock is
    // selected from ({@link overlayLockLayerAt}'s selection, below). A list
    // scoped to a package reads its rows with that package only, so it
    // reads the package-agnostic set too (the overlay cache answers it).
    let lockRows: readonly any[] = [];
    // [#21817] A list scoped to a package serves, in each slot the package
    // seats, the row `getMetaItem` naming that package serves: the
    // package's own row, else the package-less row (ADR-0048), by the one
    // candidate order ({@link servedOverlayRowCandidates}). Its row read
    // names the package, so the package-less rows come from the
    // package-agnostic read above, filtered back to the package-less ones.
    // They enter each merge as stand-ins ({@link mergePackageAwareOverlay}):
    // a stand-in serves a slot the package seats and never seats one, so
    // the list's membership stays the items the package ships. A stand-in
    // no layer seated is recorded here and dropped after the last merge.
    const unseated = packageId ? new WeakSet<object>() : undefined;
    try {
        // [#21442] The row set this read consults — the overlay cache
        // included — is {@link readActiveOverlayRows}, and each row is
        // parsed by {@link storedOverlayEntries}. The by-name read selects
        // the view containers it expands through the same two calls, so
        // the two doors cannot disagree about which containers are in
        // scope for one caller.
        const records = await host.readActiveOverlayRows(request);
        lockRows = packageId ? await host.readActiveOverlayRows({ type: request.type }) : records;
        const standInRows = packageId ? lockRows.filter((row) => (row?.package_id ?? null) === null) : [];
        // [#28409, ADR-0146 D8 item 2] …and a list scoped to a package
        // serves, in each slot the package seats, the package's declared
        // override: a row of the package's pair (`<package>.custom`) that
        // declares it ({@link servedOverlayRowCandidates}' first
        // candidate). Its row read names the package, so the pair's rows
        // come from the package-agnostic read too. They stand in like the
        // package-less rows: a pair's item of a name the package does not
        // ship is the pair's own, and never listed in the package's list.
        const pairOfScope = servedOverride && packageId ? customizationPackageId(packageId) : undefined;
        const overrideRows = pairOfScope?.ok
            ? lockRows.filter((row) => row?.package_id === pairOfScope.value)
            : [];
        if ((records && records.length > 0) || standInRows.length > 0 || overrideRows.length > 0) {
            const isView = (PLURAL_TO_SINGULAR[request.type] ?? request.type) === 'view';
            const overlays = host.storedOverlayEntries(request, records);

            // ADR-0048 (#1828) — package-aware merge: a package-scoped row
            // overlays ONLY its own package's entry, so two installed
            // packages shipping the same `type/name` (e.g. `page/home`) are
            // not collapsed to one. #2555 — heal identity-less view overlays
            // from the entry they shadow (a raw-config row would otherwise
            // drop viewKind/object and vanish the view from switcher/list
            // consumers); the overlay's own fields still win. [#7774] The
            // merge slot carries the bundle discriminator, so an
            // `email_template` overlay lands on its own locale member
            // instead of flattening every member of the bundle onto it.
            // [#20913] …and the stored-row half: a row of a shipped flow name
            // is not merged into the package's slot. It is still hydrated
            // below, as the tenant row it is, so the boot pull reports it.
            // [#21922] The same for a row under a code-defined datasource
            // name ({@link declinesStoredRow}): the MetadataService's code
            // definition, merged in below, is the item the list serves.
            // [#28412, ADR-0146 D9 item 1] …except the shipping package's
            // declared override of a shipped flow name, judged on the row's
            // own binding (the entry's `packageId`, its `package_id`
            // column) and body: it is the packaged flow now, and the merge
            // serves it in the package's slot (`servedOverride`).
            const mergeable = overlays.filter(
                (entry) => !host.declinesStoredRow(request.type, (entry.data as { name?: unknown } | null)?.name, storedEntryRow(entry)),
            );
            // [#21804] Each row travels with its place (its stored
            // spelling), so the merge picks a package's slot by the
            // served-row resolution the by-name read takes
            // ({@link servedOverlayRowCandidates}), not by row order.
            const placed = mergeable.map(({ data, packageId: recPkg, type: recType }) => ({
                data, packageId: recPkg, stored: { type: recType },
            }));
            // [#21817] The package-less rows, placed the same way, as
            // stand-ins: the same parse and the same stored-row rule.
            const standIns = host.storedOverlayEntries(request, standInRows)
                .filter((entry) => !host.declinesStoredRow(request.type, (entry.data as { name?: unknown } | null)?.name, storedEntryRow(entry)))
                .map(({ data, type: recType }) => ({
                    data, packageId: undefined, stored: { type: recType }, standIn: true,
                }));
            // [#28409] The pair's rows, placed the same way and bound to
            // the pair, as stand-ins: the merge serves one only where it
            // declares the override of the slot's package.
            const overrideStandIns = host.storedOverlayEntries(request, overrideRows)
                .filter((entry) => !host.declinesStoredRow(request.type, (entry.data as { name?: unknown } | null)?.name, storedEntryRow(entry)))
                .map(({ data, packageId: recPkg, type: recType }) => ({
                    data, packageId: recPkg, stored: { type: recType }, standIn: true,
                }));
            items = mergePackageAwareOverlay(request.type, items, [...placed, ...standIns, ...overrideStandIns], (data, prev) => {
                if (isView && data && typeof data === 'object') {
                    const patch = viewIdentityPatch(data as Record<string, unknown>, prev);
                    if (patch) Object.assign(data as Record<string, unknown>, patch);
                }
                // [#8027] The list half of the same rule the by-name read
                // applies to its own overlay adoption. This merge REPLACES a
                // base item with the overlay body wholesale (it is a
                // per-slot layer pick, not a field merge), so for `object` —
                // whose resolved schema is D9.2's base-plus-extenders — the
                // winning row has to be resolved the same way `resolveObject`
                // resolves the base it displaced, or the two reads of one
                // object disagree the moment a row exists. Both routes were
                // wrong here together, which is why #7556's byName===listed
                // pin stayed green through this defect.
                // [#29903] …without the package's pair's extension on the
                // per-package layer, as its registry items are listed.
                return host.foldObjectExtendersFromRegistry(
                    request.type, (data as { name?: unknown } | null)?.name, data, withoutExtensionsOf,
                );
            }, unseated, { servedOverride });

            // [#13407] Expand any aggregated `defineView` container this
            // READ just merged in, INLINE into this response's own `items`
            // — never into the SchemaRegistry. This is what actually closes
            // the card: {@link hydrateExpandedViewItems} below is
            // registry-mutating and is therefore gated off for exactly the
            // rows the card's own repro used (an org-scoped write, on any
            // kernel; ANY write on a real environment-scoped kernel) — see
            // that method's "#13407 scope boundary" note for why widening
            // those gates was rejected rather than attempted. This pass
            // has no such gate to worry about: `overlays` is already this
            // request's own correctly org/environment-scoped read (the
            // `queryActive` read above), so expanding it into the RETURNED
            // list — and only the returned list — cannot leak one
            // org/environment's container into another's.
            //
            // Upserted by name (not appended) so this stays idempotent
            // against the registry-hydration path below: on an unscoped,
            // env-wide kernel that path may have ALREADY registered the
            // same expansion (from this or an earlier write's write-
            // through), and re-deriving here from the row this call just
            // read is a byte-identical, never-stale restatement of the
            // same items — not a duplicate.
            //
            // [#21334] An upsert by name replaces whatever the merge seated
            // under that name, so the name has to be one the container may
            // write. {@link expandRuntimeViewContainer} decides it: on
            // another package's object every name a container expands
            // derives from the container's own name, never one of that
            // package's `<object>.<key>` names.
            //
            // [#21510] …and it never replaces a STORED ROW of that name.
            // A row stored under exactly the name is the sanctioned
            // override for it (ADR-0005 keys an overlay by its own name);
            // an expansion fills only a name with no row of its own. The
            // test is {@link namesWithOwnStoredRow} over this caller's
            // `records` at the slot's package ([#21967]), the one the
            // by-name read asks, so the two doors answer the same row for
            // the name. An item the registry or a package supplies under the
            // name is still replaced, as before.
            //
            // [#21817] In a list scoped to a package, a package-less row
            // of the name stands in ahead of the expansion too: the by-name
            // read naming the package serves that row before it asks any
            // expansion. The expansion still seats the slot, so a stand-in
            // held back by the merge is served there, as the package's.
            //
            // [#21934] Only a name an expansion writes is upserted. Every
            // other name keeps what the package-aware merge seated for it:
            // one item per package that ships the name (ADR-0048), as the
            // list serves it when no row is stored. The env-wide list is the
            // layer the anonymous form doors judge a withdrawal against, so
            // it holds every package's body of a name.
            //
            // [#21967] …and a name an expansion writes is upserted per
            // package, never over every package's item of the name. Each
            // slot of the name (the package of an item listed under it, or
            // of a container row that expands it) serves
            // {@link servedViewExpansion} for that package: the expansion of
            // the package's own container row, else of a package-less one,
            // which stands in for every package with no container row of its
            // own (ADR-0048), as the by-name read naming the package serves
            // it. A slot neither reaches keeps its item. Before, the last
            // expansion of the name replaced every package's item of it, so
            // one package's stored copy of a container displaced another
            // package's item of each name the copy expands, and the
            // anonymous form doors could miss that package's withdrawal of a
            // form, shipped or saved. In a list scoped to a package the
            // package-less container rows stand in the same way, in the
            // slots the package seats only: a stand-in never seats a slot
            // ([#21817]).
            if (isView && (records.length > 0 || standInRows.length > 0)) {
                // [#21510, #21967] The names a stored row of its own holds
                // at a slot's package ({@link namesWithOwnStoredRow}, the
                // predicate the by-name read asks for the package it
                // names): an expansion never displaces such a row, and a
                // row of one package keeps no other package's slot.
                const ownRowNamesAt = new Map<string | undefined, ReadonlySet<string>>();
                const ownRowNames = (pkg: string | undefined): ReadonlySet<string> => {
                    let names = ownRowNamesAt.get(pkg);
                    if (names === undefined) {
                        names = host.namesWithOwnStoredRow(records, pkg);
                        // [#28409] …and a name the package's declared
                        // override holds ({@link isServedOverrideRowOf}):
                        // the by-name read naming the package serves that
                        // override before it asks any expansion.
                        if (servedOverride && pkg !== undefined) {
                            const overridden = [...records, ...overrideRows]
                                .filter((row) => typeof row?.name === 'string' && isServedOverrideRowOf(row, pkg))
                                .map((row) => row.name as string);
                            if (overridden.length > 0) names = new Set([...names, ...overridden]);
                        }
                        ownRowNamesAt.set(pkg, names);
                    }
                    return names;
                };
                const standInNames = host.namesWithOwnStoredRow(standInRows);
                const expansions = host.expandStoredViewContainers(
                    request.type,
                    packageId ? [...overlays, ...host.storedOverlayEntries(request, standInRows)] : overlays,
                );
                const written = new Set(expansions.map(({ item: vi }) => vi.name as string));
                const boundNames = new Set(expansions
                    .filter(({ container }) => container.packageId !== undefined)
                    .map(({ item: vi }) => vi.name as string));
                // The package of an item's slot, as the package-aware merge
                // keys it; a list scoped to a package seats every item in
                // that package's slot.
                const slotPackage = (it: Record<string, unknown>): string | undefined => packageId
                    ?? (typeof it._packageId === 'string' && it._packageId !== '' ? it._packageId : undefined);
                const slotKey = (name: string, pkg: string | undefined) => `${name}\u0000${pkg ?? ''}`;
                const filled = new Set<string>();
                const filledNames = new Set<string>();
                const serve = (
                    name: string,
                    pkg: string | undefined,
                    held: Record<string, unknown> | undefined,
                ): Record<string, unknown> | undefined => {
                    filled.add(slotKey(name, pkg));
                    filledNames.add(name);
                    const served = servedViewExpansion(expansions, name, pkg);
                    // [#21817] In a list scoped to a package, a package-less
                    // row of the name stands in ahead of the expansion too:
                    // the by-name read naming the package serves that row
                    // before it asks any expansion. The package's own
                    // expansion still seats the slot, so a stand-in held back
                    // by the merge is served there, as the package's: a copy
                    // the `unseated` record does not hold, stamped as the
                    // merge stamps a stand-in.
                    if (held !== undefined && standInNames.has(name)) {
                        if (unseated?.has(held) && served !== undefined && served.container.packageId !== undefined) {
                            return held._packageId === undefined ? { ...held, _packageId: pkg } : { ...held };
                        }
                        return held;
                    }
                    if (served === undefined || ownRowNames(pkg).has(name)) return held;
                    const own = served.container.packageId;
                    if (own !== undefined) filled.add(slotKey(name, own));
                    // A package-less container's expansion standing in for a
                    // package carries that package's provenance, as a
                    // package-less row standing in does
                    // ({@link mergePackageAwareOverlay}), so the last pass
                    // below grafts that package's artifact envelope on it, as
                    // the by-name read naming the package does.
                    return pkg !== undefined && own === undefined ? { ...served.item, _packageId: pkg } : served.item;
                };
                const merged: unknown[] = [];
                for (const it of items as any[]) {
                    if (!it || typeof it !== 'object' || typeof it.name !== 'string') continue;
                    if (!written.has(it.name)) {
                        merged.push(it);
                        continue;
                    }
                    const pkg = slotPackage(it);
                    if (filled.has(slotKey(it.name, pkg))) continue;
                    merged.push(serve(it.name, pkg, it));
                }
                // A slot no listed item holds. A package's own container
                // row's expansion seats that package's slot of the name. A
                // package-less container's expansion of a name nothing else
                // serves is listed on its own, in a list scoped to no package
                // only.
                for (const { item: vi, container } of expansions) {
                    const name = vi.name as string;
                    const own = container.packageId;
                    if (own !== undefined) {
                        if (filled.has(slotKey(name, own))) continue;
                    } else if (packageId !== undefined || filledNames.has(name) || boundNames.has(name)) {
                        continue;
                    }
                    const out = serve(name, own, undefined);
                    if (out !== undefined) merged.push(out);
                }
                items = merged;
            }

            // Only hydrate the global registry for unscoped (control-plane)
            // calls — scoped project entries must not leak process-wide.
            // #4521 — this loop is no longer the ONLY way an overlay reaches
            // the registry (the write writes through as well), so it is the
            // shared {@link hydrateOverlayIntoRegistry} that both callers
            // use: a read and a write that register differently would put
            // the registry in two different states for the same row.
            //
            // [#6602] The kernel gate below is only half the rule, and the
            // half that was missing is the ROW's: `overlays` is the MERGED
            // env-wide + org-scoped set, so this loop used to graft this
            // caller's org bodies into the registry every other org in the
            // process reads from — one listing call was enough, and it also
            // undid the write-side gate for anything already saved. The
            // per-row verdict now lives in the shared hydrator, which each
            // row's own `organizationId` answers to.
            //
            // [ADR-0131 D6] An `object` overlay of a sealed managed item is
            // not served ({@link isUnservedSealedOverlay}), so it is not
            // registered either: an object row registers as a LAYER the
            // engine resolves the object through, not as a bare copy the
            // reads decline, so the registry keeps the package's
            // definition. Every other type's row is hydrated as before
            // (#20913: the bare copy is the tenant row, which the reads
            // decline through {@link isStoredEntryOfDeclinedName}).
            if (host.environmentId === undefined) {
                for (const { name, data, packageId: recPkg, organizationId: recOrg } of overlays) {
                    if (request.type === 'object' && host.isUnservedSealedOverlay(request.type, name)) continue;
                    await host.hydrateOverlayIntoRegistry(request.type, data, {
                        packageId: recPkg,
                        organizationId: recOrg,
                    });
                }
            }
        }
    } catch (error) {
        // [#5532] Only "sys_metadata not provisioned yet" licenses us to
        // answer with whatever we already have. Any other read failure
        // means overlay rows may exist and were not seen — serving the
        // registry-only set would report them as never declared.
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }

    // ADR-0033 draft-overlay preview: when the caller opts in (admin-gated
    // upstream — see http-dispatcher), overlay `state='draft'` rows on top of
    // the active result so the rendered console can preview pending changes
    // BEFORE publish (instead of only reading them as a JSON diff). Draft rows
    // WIN over active on name collision, and draft-only items (e.g. a brand-new
    // AI-authored object) surface too. Each overlaid item is tagged `_draft:true`
    // so the UI can badge it and show the "PREVIEW — drafts" banner. We do NOT
    // hydrate the SchemaRegistry from drafts — drafts must never leak into the
    // process-wide registry or to non-preview reads.
    if (request.previewDrafts) {
        try {
            const queryDrafts = async (pkg: string | undefined): Promise<any[]> => {
                const whereClause: Record<string, unknown> = { type: request.type, state: 'draft' };
                if (pkg) whereClause.package_id = pkg;
                // [#21911] The explicit system opt-in — see findServedOverlayRow.
                // [ADR-0131 D6/D7] The environment's drafts only — see
                // {@link findEnvironmentRows}.
                let rs = await host.findEnvironmentRows('sys_metadata', { where: whereClause, context: { isSystem: true } });
                if (!rs || rs.length === 0) {
                    const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                    if (alt) {
                        const altWhere: Record<string, unknown> = { type: alt, state: 'draft' };
                        if (pkg) altWhere.package_id = pkg;
                        rs = await host.findEnvironmentRows('sys_metadata', { where: altWhere, context: { isSystem: true } });
                    }
                }
                return rs ?? [];
            };
            // [ADR-0131 D6] The environment's drafts, whoever asks.
            const draftRecords = await queryDrafts(packageId);
            // [#21817] A list scoped to a package previews the package-less
            // drafts as stand-ins, as its active arm does: the
            // package-agnostic draft read, filtered back to the
            // package-less rows. The by-name preview arm naming the
            // package serves that draft when the package has none.
            const packageAgnosticDrafts = packageId ? await queryDrafts(undefined) : [];
            const standInDraftRecords = packageAgnosticDrafts.filter((record) => (record?.package_id ?? null) === null);
            // [#28409] …and the pair's drafts, as stand-ins, as its active
            // arm previews the pair's rows: the pending edit of the
            // package's declared override previews over its slot.
            const pairOfDraftScope = servedOverride && packageId ? customizationPackageId(packageId) : undefined;
            const overrideDraftRecords = pairOfDraftScope?.ok
                ? packageAgnosticDrafts.filter((record) => record?.package_id === pairOfDraftScope.value)
                : [];
            if (draftRecords.length > 0 || standInDraftRecords.length > 0 || overrideDraftRecords.length > 0) {
                // ADR-0048 (#1828) — package-aware draft overlay (parity with
                // the active-overlay merge above): a package-scoped draft
                // previews only its own package's entry, so two packages'
                // same-name drafts stay distinct. Draft rows win over active.
                const placeDraft = (record: any) => {
                    const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
                    // [#28673] The draft's package is its column's ({@link withRowBinding}).
                    const data = withRowBinding(host.convertStoredItem(
                        String(record.type ?? request.type),
                        typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata,
                    ), recPkg) as any;
                    // [#21804] The draft's place, as for the active rows:
                    // a package's previewed slot is the draft the
                    // by-name read's preview arm serves, in any row order.
                    // [ADR-0131 D6/D7] Every row read here is the
                    // environment's (filtered at the read).
                    const stored = { type: String(record.type ?? request.type) };
                    return { data, packageId: recPkg, stored };
                };
                const drafts = [
                    ...draftRecords.map(placeDraft),
                    ...standInDraftRecords.map((record) => ({ ...placeDraft(record), standIn: true })),
                    ...overrideDraftRecords.map((record) => ({ ...placeDraft(record), standIn: true })),
                ];
                // [#7774] Same bundle slot as the active merge above — a
                // draft of one locale must preview over that locale, not
                // over the whole bundle.
                items = mergePackageAwareOverlay(request.type, items, drafts, (data) => {
                    if (data && typeof data === 'object') (data as any)._draft = true;
                    return data;
                }, unseated, { servedOverride });
            }
        } catch (error) {
            // [#5532] Same rule as the active-overlay read above. Serving
            // the active result "unchanged" is a lie to a caller that asked
            // for a draft preview: it renders the published world while the
            // pending edits it asked to see were never read.
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
    }

    // Merge with MetadataService (runtime-registered items: agents, tools, etc.)
    try {
        const services = host.getServicesRegistry?.();
        const metadataService = services?.get('metadata');
        if (metadataService && typeof metadataService.list === 'function') {
            let runtimeItems = await metadataService.list(request.type);
            // [#23645] The service's copy of a stored object row is not the
            // base this merge lays the stored rows over: the rows above
            // already serve every live one, and a copy of a deleted one
            // would list it until a restart. `object` only, as in
            // {@link readItemFromMetadataService}.
            if (request.type === 'object' && Array.isArray(runtimeItems)) {
                runtimeItems = runtimeItems.filter((item: unknown) => !isTenantAuthored(item));
            }
            // When filtering by packageId, only include runtime items that
            // belong to the requested package. MetadataService.list() returns
            // items from ALL packages, so we must filter here to respect the
            // package scope requested by the caller (e.g., Studio sidebar).
            if (packageId && runtimeItems && runtimeItems.length > 0) {
                runtimeItems = runtimeItems.filter((item: any) => item?._packageId === packageId);
            }
            if (runtimeItems && runtimeItems.length > 0) {
                // Merge, avoiding duplicates. ADR-0048 (#1828) — resolution
                // is per `(slot, package)` and never by bare `name`, so a
                // runtime item from one package does not collapse a
                // same-name item from another.
                //
                // [#7774] …and the slot carries the bundle discriminator
                // for a type whose identity the spec declares as a pair.
                // This merge is where the i18n bundle actually died:
                // `items` already held both members (the registry keeps
                // them since #7730), the second write overwrote the first,
                // and `GET /meta/email_template` served one locale. It only
                // ever runs with a `metadata` service installed AND
                // answering non-empty for the type — which is why that
                // regression was invisible to every suite that omits one.
                //
                // [#7654] THE RESOLUTION IS THE OVERLAY MERGE'S, and it is
                // now literally that function instead of a second
                // implementation of the same idea. As a hand-rolled `Map`
                // keyed on `(package, name)` with STRICT equality, this step
                // disagreed with {@link mergePackageAwareOverlay} — which
                // runs one layer above it on the very same list — about the
                // package-LESS row, and the disagreement reached the wire as
                // a duplicate. A package-less row does not merely occupy a
                // slot of its own: it STANDS IN for each package's row of
                // that name, which is how `getMetaItem(name, packageId=P)`
                // resolves and what the overlay merge already implements.
                //
                // A runtime `PUT /api/v1/meta/<type>/<name>` carries no
                // `?package=`, so `sys_metadata` takes a
                // `package_id IS NULL` row. For a type the SchemaRegistry
                // has nothing for — `skill`, `agent` and `tool` reach the
                // MetadataService through its own loaders, so the registry
                // listing is empty and this baseline is the only package row
                // there is — that overlay leaves the merge above UNSTAMPED
                // (it stamps `_packageId` from the base row it displaced,
                // and there was none). Its key then missed the
                // package-bearing baseline row here, the "already present"
                // guard below never fired, and `GET /api/v1/meta/skill`
                // listed the override row AND the package row after a 200
                // PUT. The mirrored attribution — a package-less runtime
                // baseline under a package-bearing higher row — duplicated
                // for the same reason and is closed by the same call.
                //
                // Layer order is the one the guard this replaces stated:
                // entries from `sys_metadata` (customization overlays) or
                // the SchemaRegistry WIN over the MetadataService's artifact
                // baseline — without that, saved per-org dashboard / view
                // overlays disappeared from list endpoints on refresh while
                // the detail endpoint kept showing them. So `items` is the
                // higher layer (`records`) and the runtime listing is the
                // base, and "latest contribution wins" reproduces the guard
                // rather than reversing it.
                items = mergePackageAwareOverlay(
                    request.type,
                    runtimeItems as unknown[],
                    (items as any[]).map((it) => ({
                        data: it,
                        packageId: ((it as any)?._packageId ?? undefined) as string | undefined,
                    })),
                );
                // [#21817] A stand-in still held back here takes the
                // package's runtime item of its slot as the item it serves
                // (the latest contribution, stamped as the package's): a
                // seated copy, which `unseated` does not hold.
            }
        }
    } catch {
        // MetadataService not available or doesn't support this type
    }

    // [#28802, #28390 ruling A] …except, for a bundle the package ships
    // (`ITEM_KEY_DISCRIMINATORS`), its pair's row at a member the package
    // does not ship: the pair's own added member, which the package's
    // address serves beside the package's members
    // ({@link baseServesBundleMember}), as the env-wide list below does.
    if (unseated && servedOverride && packageId && ITEM_KEY_DISCRIMINATORS[request.type] !== undefined) {
        const pairOfList = customizationPackageId(packageId);
        const typeShipping = host.shippingPackagesOf(request.type);
        for (const it of items as any[]) {
            if (!(it && typeof it === 'object' && unseated.has(it))) continue;
            if (!pairOfList.ok || boundPackageOf(it._packageId) !== pairOfList.value || typeof it.name !== 'string') continue;
            if (host.shipsBundleName(request.type, it.name, packageId, typeShipping)
                && host.baseServesBundleMember(request.type, it.name, packageId, it, typeShipping)) {
                unseated.delete(it);
            }
        }
    }

    // [#21817] A stand-in no layer seated is a package-less row of an item
    // the package does not ship: it is not in the package's list.
    if (unseated) {
        items = (items as any[]).filter((it) => !(it && typeof it === 'object' && unseated.has(it)));
    }

    // [#28409, ADR-0146 D8 items 1–2, #28238's list half] THE ENV-WIDE
    // LIST JOINS THE ONE EFFECTIVE READ. Naming no package, a name exactly
    // one code package ships is listed once, as that package's item
    // ({@link soleShippingPackage}): the item the by-name read naming no
    // package serves, which since #28238 takes its content from that
    // package's address ({@link packagelessContentPackage}) — its declared
    // override, else its own row, else the package-unbound row, which the
    // merges above have already served in its slot, else its code item.
    // An item bound to another package under that name is dropped here: a
    // dependent package's same-named row, a `.custom` item that does not
    // declare the override, the pair's row itself (its body is the slot's
    // when it declares). Each is still served under its own address — the
    // by-name read naming its package, and the list scoped to it.
    //
    // Before, the merge kept one item per package of the name (the
    // [#21934] rule), and a console keying items by name rendered the last
    // one, so the base app showed a dependent package's copy. That list is
    // still read where a narrower one is not allowed:
    // {@link getMetaItemsPerPackage}, the anonymous form doors' withdrawal
    // layer and the package export (`layer: 'per-package'`).
    //
    // An item bound to no package is kept (the merges seat a package-less
    // row in its package's slot, so none is left beside it), and so is
    // every item of a name no package or several packages ship (ADR-0048
    // §3.3). The `package` type is never narrowed: its items are the
    // packages themselves.
    //
    // [#28802, #28390 ruling A] A bundle's name (`ITEM_KEY_DISCRIMINATORS`)
    // is narrowed at MEMBER grain: the sole shipper's list also keeps its
    // pair's own added members, a member the base does not ship
    // ({@link baseServesBundleMember}), so a locale the customer adds in
    // `.custom` is listed and executed (the email loader reads this list).
    // A dependent's member under the name is still dropped here.
    if (servedOverride && !packageId && request.type !== 'package') {
        const typeShipping = host.shippingPackagesOf(request.type);
        const isBundle = ITEM_KEY_DISCRIMINATORS[request.type] !== undefined;
        const soleShipperOf = new Map<string, string | undefined>();
        items = (items as any[]).filter((it) => {
            const itemName = it?.name;
            const bound = boundPackageOf(it?._packageId);
            if (typeof itemName !== 'string' || bound === undefined) return true;
            if (!soleShipperOf.has(itemName)) {
                soleShipperOf.set(itemName, soleShippingPackage(host.shippedArtifactsOf(request.type, itemName, typeShipping)));
            }
            const soleShipper = soleShipperOf.get(itemName);
            if (soleShipper === undefined || soleShipper === bound) return true;
            return isBundle && host.baseServesBundleMember(request.type, itemName, soleShipper, it, typeShipping);
        });
    }

    // Hide metadata owned by a disabled package. `listItems` already drops
    // disabled-package items from the SchemaRegistry, but the DB overlay and
    // MetadataService merges above can re-introduce them (e.g. an app/view
    // persisted in sys_metadata). Re-apply the filter on the final merged
    // set so a disabled package's metadata stops surfacing in the console.
    //
    // Never filter `package`: the Packages page must list disabled packages
    // to re-enable them, so filtering it would make disable irreversible.
    //
    // [#7557] `object` USED to be exempt here too, on the reasoning that
    // "filtering objects would break data queries that depend on their
    // schema". That conflated two different readers. Data queries resolve
    // schema through `registry.getObject` / `listItems('object')` — the
    // registry primitives, which this filter does not touch and which
    // deliberately keep serving a disabled package's objects so migrations,
    // cross-package references and the runtime authoring gate (`protocol.ts`
    // resolution context) still see a complete object universe. NOTHING
    // resolves a query's schema through `getMetaItems`, which is the API
    // READ surface. So the exemption bought no safety and cost the
    // enforcement: `/meta/objects` kept listing a disabled package's objects
    // while its nav and views correctly vanished.
    //
    // The data plane is refused separately and loudly, in
    // `assertObjectRegistered` (`OBJECT_PACKAGE_DISABLED`) — absence here
    // and refusal there are the two halves of one answer, pinned together
    // by `protocol.package-disable-enforcement.test.ts`.
    //
    // [#24210] The predicate is {@link isItemOfDisabledPackage}, the one the
    // by-name read asks, so the list and the by-name read hide the same items.
    //
    // [#29871] …on the effective and execution reads. The per-package layer
    // keeps them (see `keepDisabledPackages` above): a package's export is
    // what the package holds, and an export that dropped a disabled
    // package's items installed elsewhere as an empty package.
    if (request.type !== 'package' && !keepDisabledPackages) {
        items = (items as any[]).filter((it) => !isItemOfDisabledPackage(host.engine.registry, it));
    }
    // [#28877] …and, on the effective served list, an action that launches
    // into a disabled package ({@link isActionWithheldByDisabledPackage}),
    // as the served object read withholds it from the object's actions.
    if (request.type === 'action' && audience === 'served' && servedOverride) {
        items = (items as any[]).filter((it) => !isActionWithheldByDisabledPackage(host.engine.registry, it));
    }

    // Canonical-shape exposure (ADR-0017, "Object has-many View"): a
    // `defineView` document is kept in the registry under the bare
    // `<object>` key for defensive single-item reads, but it is NOT a
    // first-class, independently addressable view — the registrar expands
    // it into independent ViewItems (each carrying `viewKind` + `config`).
    // Never surface the aggregated `{ list, form, listViews }` container
    // through enumeration so every list consumer (Studio metadata list,
    // REST `GET /meta/view`, AI schema retriever) sees exactly one
    // canonical entry per named view and never the legacy wrapper shape.
    if (request.type === 'view' || request.type === 'views') {
        items = (items as any[]).filter((it) => !isAggregatedViewContainer(it));
    }

    // Merge registered navigation contributions into each served app
    // (ADR-0029 D7). The setup app is a shell of empty group anchors;
    // platform-objects and capability plugins inject their menu entries as
    // contributions, merged lazily on read. REST app endpoints read through
    // this path (not registry.getAllApps), so the merge must happen here too
    // or every contributed group renders empty.
    if (request.type === 'app' || request.type === 'apps') {
        items = (items as any[]).map((app) => host.engine.registry.applyNavContributions(app));
    }

    // [#14375 / ADR-0130 Consequences row 6] A package row carries the
    // server's OWN writability verdict. The REST `GET /packages` door is
    // this producer with the durable rows spread over it, and Studio's
    // package switcher reads that list; it used to derive "writable"
    // client-side from `manifest.scope` alone, which is not this server's
    // rule — ADR-0070 D2 (`isWritablePackage`) reads `engine.manifests`
    // FIRST, so a scope-less BOOTED package — a marketplace install / offline
    // file import, which reaches the registry through `ql.registerApp` with no
    // `ManifestSchema` parse — is read-only while a scope-less Studio-created
    // base (`POST /api/v1/packages`) is writable, and only the server can tell
    // the two apart. ⛔ Neither is a module carried by a multi-package
    // artifact: `defineStack` parses every `packages[]` entry through
    // `ManifestSchema`, whose `scope` is `.default('project')`, so no package
    // of a compiled artifact is ever scope-less. Same predicate the authoring and
    // lifecycle gates use (#8146: one answer), computed on a spread COPY:
    // the registry record is never mutated and the verdict is never stored.
    // The runtime dispatcher door decorates its own read of the same
    // records the same way (`withWritableVerdict` in
    // `packages/runtime/src/domains/packages.ts`).
    if (request.type === 'package' || request.type === 'packages') {
        items = (items as any[]).map((pkg) => {
            const manifestId = pkg?.manifest?.id;
            const id = typeof manifestId === 'string' ? manifestId : (typeof pkg?.id === 'string' ? pkg.id : undefined);
            return { ...pkg, writable: host.isWritablePackage(id) };
        });
    }

    // [#21761] Each listed item's lock is selected from ITS address, by the
    // selection the by-name reads and the `_lock` gate make
    // ({@link overlayLockLayerAt}), over the rows read above: the strictest
    // lock among the item's rows in scope. The list still SERVES the body
    // its own merge chose; only the lock family on it follows the binding
    // layer, so the body and the directory tile ({@link getMetaDiagnostics}
    // counts these bodies) state the lock the item's envelope reports. A
    // previewed draft keeps its own family: it is the pending edit, not
    // the item the doors gate. [#21803] The artifact layer likewise: every
    // installed package that ships the item's name
    // ({@link artifactLockLayerAt}), the packages read once for the type.
    const otherType = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
    const lockRowsByName = new Map<string, any[]>();
    for (const row of lockRows) {
        const name = String(row?.name);
        const list = lockRowsByName.get(name);
        if (list) list.push(row);
        else lockRowsByName.set(name, [row]);
    }
    let shipping: ShippingPackages | undefined;
    const governed: any[] = [];
    for (const it of items as any[]) {
        const itemName = (it as any)?.name;
        // ADR-0048 — scope the artifact lookup to THIS item's owning
        // package so a same-name collision grafts each item's own
        // provenance envelope, not the first-registered package's.
        // (`requested` packageId, when the whole list is scoped,
        // takes priority; else the item's own `_packageId`.) [#22024]
        // The by-name read takes the same rule ({@link envelopePackageId}).
        const itemPackageId = envelopePackageId(packageId, it);
        // [#23074] …and to the item's own bundle member, whose artifact
        // alone may lend it an envelope ({@link mergeArtifactProtection}).
        let a = host.lookupArtifactItem(request.type, itemName, itemPackageId, bundleMemberOf(request.type, it));
        // [#28831] …and on the per-package layer, an item bound to a
        // package wears ITS OWN package's artifact envelope, or none
        // ({@link perPackageLayerEnvelope}): never another package's, which
        // the lookup falls back to when the item's package ships no
        // artifact of the name.
        if (layer === 'per-package') {
            a = perPackageLayerEnvelope(request.type, it, itemPackageId, a, lockRowsByName.get(String(itemName)) ?? []);
        }
        let itemLock: ItemLock | undefined;
        if (typeof itemName === 'string' && (it as any)?._draft !== true) {
            const address: ItemAddress = {
                type: request.type,
                name: itemName,
                packageId: itemPackageId,
            };
            shipping ??= host.shippingPackagesOf(request.type);
            itemLock = resolveItemLock({
                artifact: host.artifactLockLayerAt(address, shipping),
                overlay: await resolveOverlayLockLayer(address, (spelling) =>
                    // [ADR-0131 D6/D7] Every row is the environment's
                    // (filtered at the read), so only the spelling selects.
                    (lockRowsByName.get(itemName) ?? []).filter((row) =>
                        row.type === (spelling === 'canonical' ? request.type : otherType)), { otherSpelling: true }),
            });
        }
        // [#4513] Same governance as the single-item read — the list
        // is the other exit a client reads field metadata from, and
        // an overlay row wins over the (already-governed) registry
        // entry in the merge above, so it carries the same lie.
        governed.push(host.governServedObject(request.type, mergeArtifactProtection(request.type, it, a, itemLock)));
    }
    return {
        type: request.type,
        // [#20552] Served: diagnostics + per-type credential redaction.
        // Execution: the stored bodies — see `getMetaItemsForExecution`.
        items: audience === 'served' ? decorateMetadataItems(request.type, governed) : governed,
        // [#23316] Served only: the engine's verdict on each listed flow —
        // see {@link flowRegistrationsOf}. The execution face is the
        // engine's own read, so it carries none.
        ...(audience === 'served' ? host.flowRegistrationsOf(request.type, governed) : {}),
        // [#27842] Served only, likewise: the packaged actions the
        // activation ledger switches off, per listed object — see
        // {@link disabledActionsOf}.
        ...(audience === 'served' ? host.disabledActionsOf(request.type, governed) : {}),
    };
}
