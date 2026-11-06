// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Registry hydration, view expansion, write-through,
 * object storage" facet of `ObjectStackProtocolImplementation`: the bodies of
 * `applyObjectRegistryMutation`, `overlayPackageMismatchError`,
 * `hydrateOverlayIntoRegistry`, `expandRuntimeViewContainer`,
 * `shippedViewContainerOf`, `runtimeViewContainerPackage`,
 * `isShippedByAnotherPackage`, `hydrateExpandedViewItems`,
 * `reconcileViewExpansions`, `anotherPackageShips`,
 * `applyRegistryWriteThrough`, `restoreArtifactRegistryView`,
 * `ensureObjectStorage`, `dropObjectStorage`, `unboundOwnerPackageRefusal`,
 * `dropStorageRemainingRowsRefusal` moved out of `protocol.ts` whole by
 * `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolRegistryHydrationFacet` is a stateless facet over the host
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

import { overlayMemberWhere } from './migrations/overlay-index.js';
import { storedRowDocument } from './item-lock.js';
import { itemDiscriminator } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec/ui';
import { bindStoredRow } from './stored-row-binding.js';
import { incomingTakesStoredFlowSlot } from './stored-flow-slot.js';
import { OBJECT_EXTENSION_TYPE } from './protocol-object-extension-item.js';
import { canonicalMetaType } from './protocol-meta-type-schema.js';
import { remainingRowsPhrase } from './protocol-authoring-refusals.js';
import {
    boundPackageOf,
    bundleMemberOf,
    declinesBorrowedEnvelope,
    isShippedViewItem,
    mergeArtifactProtection,
    stateTenantAuthorship,
    withRowBinding,
} from './protocol-package-bindings.js';
import type { HydrationOptions, ShippingPackages, UnboundOwnerRefusalState } from './protocol-package-bindings.js';
import { bundleMemberDiscriminator } from './protocol-bundle-members.js';
import type { ViewContainerWrite } from './protocol-package-bindings.js';
import type { ProtocolHost } from './protocol-host.js';
import type { RuntimeAuthoringIssue } from './runtime-authoring-gate.js';
import { clientFacingFailureText } from './protocol-client-failures.js';
// [#29985 codemod] `ObjectStackProtocolImplementation` here is `ObjectStackProtocolImplementationStatics` (imported AS the class): forwarders to its statics (#30147).
import { ObjectStackProtocolImplementationStatics as ObjectStackProtocolImplementation } from './protocol.js';

export class ProtocolRegistryHydrationFacet {
    /**
     * Mirror an object-type overlay write into the in-memory engine
     * registry so subsequent CRUD finds the new schema. Idempotent and
     * safe to call after a successful persistence call. For the legacy
     * write path this is invoked BEFORE persistence (historical behavior
     * preserved); for the PR-10d.3 repository path it is invoked only
     * AFTER `put()` resolves successfully, so a failed write — DB error,
     * optimistic-lock conflict, validation failure — never leaks a
     * stale schema into the registry.
     *
     * ── OWNERSHIP KEY (#4636, maintainer ruling 2026-08-07, option B) ──
     *
     * The contributor is keyed by the row's REAL `package_id`, not by the
     * `'sys_metadata'` sentinel this used to hard-write. The sentinel
     * survives for exactly one case — a package-less write, which has no
     * real id to use.
     *
     * Why the key had to move (and not the other side): the ownership key
     * IS the package-filter key. `SchemaRegistry.getAllObjects(packageId)`
     * matches `contributor.packageId`, so an object created through
     * Studio's package workspace was invisible to its own package's filter
     * until something re-registered it. The written contract in
     * `objectql/src/registry.ts` (the `isTenantAuthored` header) already
     * said the real id is the key and the sentinel is a save-path-only
     * artefact; this makes the save path say the same thing.
     *
     * ── `_provenance: 'org'` IS STAMPED HERE, SERVER-SIDE ──
     *
     * On a COPY of the body, unconditionally — the request's own
     * `_provenance` is never consulted, and never wins.
     *
     * That is load-bearing, not defensive coding. `applyProtection` (spec)
     * stamps `_provenance: 'package'` whenever it is handed a package id
     * and the body has not already answered, and the registry's artifact
     * lookup reads exactly that key: a row registered under `app.<slug>`
     * with package provenance IS a code artifact as far as
     * `getArtifactItem` is concerned, so `isArtifactBacked` turns true and
     * `saveMetaItem`'s overlay gate refuses the NEXT write to it with
     * `not_overridable` — `object` declares `allowEnvironmentOverlay: false`.
     * Moving the key without the stamp therefore re-creates cloud#970 (an
     * app the user just built becomes silently un-editable) on the write
     * path, one save later instead of one restart later. Measured, not
     * assumed: see the reverse-verification limb in
     * `objectql/src/protocol-writepath-object-ownership.test.ts`.
     *
     * Client-supplied provenance cannot be trusted here:
     * `metadata-read-decorations.ts` deliberately does NOT strip
     * `_provenance`, so a Studio GET → PUT round-trip echoes whatever the
     * served document carried. Every row this method sees came out of a
     * `sys_metadata` write, which is tenant-authored by definition
     * (ADR-0010 `_provenance: 'org'`) — so the server states that fact
     * rather than reading it back from the caller. Same sentence the boot
     * re-hydration already writes for the same rows.
     */
    static async applyObjectRegistryMutation(host: Pick<ProtocolHost, 'classifyObjectContribution' | 'engine' | 'overlayPackageMismatchError' | 'packagelessAddress'>, request: { type: string; name: string; item?: any; packageId?: string | null }): Promise<void> {
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

    /**
     * [ADR-0029 D9.9] The mis-bound overlay refusal.
     *
     * The overlay-uniqueness index keys on
     * `(type, name, organization_id, COALESCE(package_id, ''))` (ADR-0005
     * amendment, #6825), so `sys_metadata` can legitimately hold two active
     * rows for one `(type, name)` bound to two packages. For every other type
     * that is fine — two packages really can ship `page/home`. For `object` it
     * is not representable: `computeFQN` is identity, so the registry holds
     * exactly one entry per object name and could never serve two. Refusing
     * the mis-bound row is what keeps the two stores in agreement instead of
     * letting `sys_metadata` describe a shape the registry cannot hold.
     */
    static overlayPackageMismatchError(name: string, rowPackageId: string, ownerPackageId: string,
        /** [#23514] The state the refusal answers, for a `'sys_metadata'` sentinel owner only. */
        unboundOwnerState: UnboundOwnerRefusalState = {},): Error {
        // [#23514] An owner keyed by the sentinel is owned by no package, so
        // this prescription's "bind it to the owner" has nothing to name.
        if (ownerPackageId === 'sys_metadata') {
            return ObjectStackProtocolImplementation.unboundOwnerPackageRefusal(name, rowPackageId, unboundOwnerState);
        }
        const err: any = new Error(
            `Cannot layer object '${name}': the overlay is bound to package `
            + `'${rowPackageId}', but the object is owned by package '${ownerPackageId}'. `
            + `An object has exactly one registry entry, so it can carry exactly one overlay layer — bind the `
            + `customization to '${ownerPackageId}', or have '${rowPackageId}' extend the object instead. `
            + `See docs/adr/0029-kernel-object-ownership-and-platform-objects-decomposition.md.`,
        );
        err.code = 'OBJECT_OVERLAY_PACKAGE_MISMATCH';
        err.status = 422;
        err.packageId = rowPackageId;
        err.ownerPackageId = ownerPackageId;
        err.docs = 'docs/adr/0029-kernel-object-ownership-and-platform-objects-decomposition.md';
        return err;
    }

    /**
     * Register ONE active overlay body into the engine's SchemaRegistry.
     *
     * The single implementation shared by the READ-side hydration
     * (`getMetaItems`) and the WRITE-side write-through
     * ({@link applyRegistryWriteThrough}) — #4521. Two copies of this rule
     * would let a read and a write leave the registry in two different
     * states for the same row, which is the class of bug the write-through
     * exists to close.
     *
     * Graft the artifact's protection envelope onto the overlay body BEFORE
     * registering: the plain-key entry written here shadows the packaged
     * artifact on `registry.getItem`, and a bare overlay body would strip
     * `_lock`/`_packageId`/`_provenance` from every registry-direct reader
     * (ADR-0010 §3.3 — an overlay must never loosen a packaged lock).
     * ADR-0048 (#1828) — scope the artifact lookup to the row's OWN package
     * so a colliding overlay no longer grafts the first-registered package's
     * provenance/lock onto another package's row.
     *
     * ── [#6602] THE ROW-SCOPE GATE LIVES HERE, AND ITS ARGUMENT IS REQUIRED ──
     *
     * ADR-0005 (revised 2026-05): **only env-wide rows enter the process-wide
     * SchemaRegistry** (ADR-0131 D7: a legacy organization's row is left out
     * at the read, {@link findEnvironmentRows}).
     * Per-org overlays are served on demand by `getMetaItem` /
     * `getMetaItems` and never grafted into the shared registry, because that
     * registry has exactly one plain key per `(type, name)` and no org
     * dimension to hold them apart.
     *
     * Boot already obeyed this — `loadMetaFromDb` filters
     * `organization_id: null` and states the rule in its own comment — but
     * the two RUNTIME seams did not: {@link applyRegistryWriteThrough} gated
     * on `environmentId` alone (its TSDoc claimed the rule and the code said
     * nothing about org), and the `getMetaItems` hydration loop walked the
     * merged env-wide + org record set. Measured on an unscoped kernel, an
     * org-scoped `view` write landed in the registry under the plain key, and
     * one org-scoped listing call did the same — so org B's next listing
     * started from org A's body (#6602).
     *
     * `organizationId` is therefore a REQUIRED parameter and not an optional
     * one: an omitted org would default to "env-wide" and reinstate the exact
     * hole, whereas a required one makes every caller state the row's scope.
     * Declared = enforced, at the ONE choke point all three hydration callers
     * (boot, read-side, write-through) already share — a fourth caller cannot
     * forget a gate it has to answer to compile.
     *
     * The KERNEL-scope gate (`environmentId === undefined`) deliberately
     * stays with the callers: that is a fact about the kernel this protocol
     * instance serves, not about the row in hand.
     *
     * Resolves to whether the row is live in this registry's view: registered,
     * or answered from its row as the section below states. Org-scoped rows,
     * bodies without a `name`, and registry doubles without `registerItem`
     * are no-ops and resolve to `false`. The boot's page report reads it.
     *
     * [#23198] Asynchronous because a view container's expansion ends in
     * {@link reconcileViewExpansions}, which heals each name the row no longer
     * expands to through the delete's walk, and that walk reads the
     * MetadataService. Everything up to that point still runs before the
     * first `await`, the type assert below included, and every caller awaits
     * it, so a refusal reaches the same `catch` it reached before.
     *
     * ## [#22057] A VIEW row bound to one package, never under a name another ships
     *
     * The registry keeps one bare slot per name, and `SchemaRegistry.getItem`
     * answers it ahead of every package's own entry, whichever package the read
     * names. ADR-0005 gives that slot to a package-less row, which overlays the
     * item of the name in every package. A view row bound to a package
     * (ADR-0048) overlays that package's view alone, and under the bare name it
     * answered every package's read of the name. Where another package also
     * ships the name, the by-name read naming that package found no row of its
     * own, expanded nothing, and served this row's body at the registry step,
     * under the other package's envelope, while the list served that package's
     * own view. Measured on an unscoped kernel after a save, and on either
     * kernel after a cold boot (`loadMetaFromDb` hydrates through this method on
     * every kernel).
     *
     * Such a view row is not registered, which is #21980's shape for an
     * expansion ({@link hydrateExpandedViewItems}), and for the same reason it
     * is safe there: no reader outside this class reads a view's bare entry.
     * The reads answer the row from its row on every kernel
     * ({@link findServedOverlayRow}): for its own package, and for a read naming
     * no package. The list merges it into its package's slot. An aggregated
     * container row still has its expansions judged one by one. The
     * environment-scoped kernel's running answer was already this one, because
     * it registered nothing on a save then ([#23298]: a kernel that hydrates
     * its own store now registers a save as its boot does, by this rule).
     *
     * ⛔ This rule is `view` only, judged on the canonical type. Every other type
     * registers as before, save the borrowed-envelope rule below: a row bound
     * to one package, of a name two packages ship, holds the bare entry with
     * its own body and its own package's envelope (#4624, ADR-0048, pinned in
     * `objectql`'s `protocol-boot-hydration-scoped.test.ts`).
     * Registry readers that name no package read those entries (the declared
     * security-metadata bootstraps, the action router, the picklist read), and
     * which body they should see for such a name is not ruled here. A
     * package-less view row, and a view row of a name only its own package
     * ships or no package ships, register as before too.
     *
     * ## [#29600] …and a dashboard, report or email-template row never wears another package's envelope
     *
     * A row of these three types bound to a package that ships no artifact of
     * its name (or bundle member), under a name another package ships, is not
     * registered either ({@link declinesBorrowedEnvelope}). The artifact lookup
     * falls back to the package that ships the name, so the bare entry wore
     * THAT package's envelope (`_packageId`, `_provenance: 'package'`) and the
     * per-package layer listed it as that package's own item: after a `.custom`
     * pair published its declared override of a base's dashboard, the base's
     * layer (and with it the base's export) carried two items of the name.
     * Every protocol read of these types answers such a row from the row
     * itself — the by-name read, the effective list, the layered read and the
     * pair's per-package layer — so they served the same body before and
     * after, measured for each reader. What changes is the registry-direct
     * read of the name, which answers the shipping package's own item.
     *
     * ⛔ Those three types, and [#29613] `page`, `app`, `dataset`, `doc`,
     * `book` and [#30062] `mapping`, whose reads serve a pair's declared override from its row since
     * {@link declinesStoredRow} admits it. A row of a package that ships its own
     * artifact of the name keeps its bare entry (#4624). `flow` registers with
     * no artifact envelope (below).
     *
     * ## [#23233] The entry carries the row's package binding
     *
     * The registered body is stamped with the row's package binding as
     * `_packageId` ({@link withRowBinding}), as `getMetaItems` stamps it from
     * the row's `package_id` before it hydrates. This hydrator is the one the
     * boot and the write-through share, so every registration of a stored row
     * now names the package the row is bound to, not only the one a list read
     * makes. Before this, the write-through and the boot registered a runtime
     * package's body with no `_packageId`, and every registry reader that takes
     * the owner from it (the security catalog, and through it the `everyone`
     * suggestion of an `isDefault` set) saw the item as unowned: on a host
     * kernel until the next list read, and on an environment kernel that
     * hydrates its own store until never. ⛔ No owner is derived: the binding is
     * only read, and since #28673 the column wins over the body — a body that
     * names a different `_packageId` has it replaced by the row's binding, and
     * a row with no binding has a body stamp dropped, so it stays unowned. An
     * artifact's envelope still wins over the stamp
     * ({@link mergeArtifactProtection}). The expansions of a view container are
     * registered from the stamped row too ({@link hydrateExpandedViewItems}).
     *
     * ## [#9111] `type` is an ASSERTED input, not a silently-trusted one
     *
     * The spelling handed in is the spelling the registry entry is minted
     * under — `registerItem(type, …)` below, and the same `type` again in
     * {@link hydrateExpandedViewItems}. Until this assert the parameter was a
     * bare `type: string` with a load-bearing "callers must fold" contract
     * that lived in no type, no signature and no check. That family has cost
     * four cards (#8820, #8862, #9009, #9111); this is the fifth rediscovery
     * not happening.
     *
     * **Measured across every producer before asserting** (the card's phase 1
     * — six routes, and the read side FIRST, because #9157 had just falsified
     * "every `/meta` entry point folds" one function over):
     *
     *  1. `getMetaItems` (read-side hydration)   — `canonicalizeMetaRequestType`
     *  2. `saveMetaItem` → write-through         — `canonicalizeMetaRequestType`
     *  3. `rollbackMetaItem` → write-through     — `canonicalizeMetaRequestType`
     *  4. `promoteDraftForPublish` → write-through — `PLURAL_TO_SINGULAR`, but
     *     both its callers are covered: `publishMetaItem` folds at the
     *     boundary, and `publishPackageDrafts` is pre-empted by #8908's
     *     `STORED_TYPE_NOT_CANONICAL` pre-flight ({@link isNonCanonicalStoredType}).
     *  5. `revertCommit` → write-through         — `PLURAL_TO_SINGULAR[it.type]`
     *     over a STORED commit-item type. Was **unguarded**; since #9174 the
     *     restore limb carries its own `STORED_TYPE_NOT_CANONICAL` pre-flight,
     *     so this producer no longer reaches the assert for that class.
     *  6. `loadMetaFromDb` (boot)                — `PLURAL_TO_SINGULAR[record.type]`
     *     over a STORED row type. **Unguarded.**
     *
     * Routes 5 and 6 fold through the MANIFEST-COLLECTION map, which is
     * TOLERANT AND INCOMPLETE in exactly the way #9161 named one seam over: it
     * resolves the plurals that were never the hazard and passes through the
     * six spellings whose types are not stack collections (`fields`, `seeds`,
     * `external_catalogs`, `externalCatalogs`, `translations`,
     * `email_templates`). For those the fold is a NO-OP and the raw spelling
     * reaches `registerItem` — a second registry namespace for an item that has
     * a canonical home, invisible to every canonical read.
     *
     * DORMANT for live traffic, and that is a measurement, not an assumption:
     * the only `sys_metadata` writer that stamps a caller-chosen `type`
     * (`saveMetaItem`'s `repo.put`) folds at the boundary, so no live write can
     * mint such a row. The population that reaches routes 5 and 6 is pre-#7894
     * AT-REST residue, which is real and which nothing rewrites on upgrade.
     *
     * ⛔ The refusal is an ASSERT and deliberately NOT a fold. Folding here
     * would be the tolerant lookup below a folding boundary that
     * {@link canonicalMetaType}'s header has rejected since #4432 — and it
     * would do something worse than dilute a contract: a pre-#7894 row exists
     * BECAUSE `PUT /meta/fields/…` slipped past the lock that answers
     * `PUT /meta/field/…` with 403 NOT_OVERRIDABLE. Quietly folding it into the
     * canonical key at boot would honour, process-wide, precisely the override
     * #7894 closed the door on. Refusing leaves the row exactly as unreachable
     * as it is today and says so out loud instead.
     *
     * Loudness per route, since neither is a `/meta` request with a caller to
     * answer to: at boot the throw is caught by `loadMetaFromDb`'s per-record
     * handler, so the row is counted in `errors` and named in a warning
     * (registering nothing was already the honest outcome — a `'fields'` entry
     * serves no reader); on the write-through it degrades to
     * {@link applyRegistryWriteThrough}'s best-effort `console.warn`, which is
     * correct there and not a softened assert — the row is already persisted,
     * and #4521's contract is that a registry hiccup must never fail a
     * committed write. [#9174] Correct, and still less informative than the two
     * at-rest doors that name this class on the wire — which is why
     * {@link revertCommit}, the one producer that could reach this seam with the
     * class, now refuses it up front instead of arriving here.
     *
     * ⚠️ This assert touches NO audit row, NO commit record and NO repository
     * key. It is scoped to the registry mint door, and no producer's spelling
     * is changed by it — so #8908's `AUDIT_TYPE_NOT_CANONICAL` ruling (which
     * requires the caller's spelling to reach the audit writer unfolded, and to
     * fail loudly at 500 when it is wrong) is untouched in both directions.
     *
     * What it cannot refuse, by construction: a canonical type (no canonical
     * spelling folds elsewhere), and a plugin-registered or otherwise
     * unrecognised kind — {@link canonicalMetaType} is the identity for
     * anything the static map does not carry, so a runtime kind the platform
     * has never heard of can never trip this gate.
     */
    static async hydrateOverlayIntoRegistry(host: Pick<ProtocolHost, 'anotherPackageShips' | 'engine' | 'hydrateExpandedViewItems' | 'lookupArtifactItem' | 'packagedArtifactOwner' | 'registerStoredObjectExtension'>, type: string,
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
        // its row. ⛔ Those three types, and [#29613] page, app, dataset, doc, book and [#30062] mapping.
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

    /**
     * [#7736, #13407] Expand an aggregated `defineView` container that arrived
     * through the RUNTIME door into the same independent, fully-enriched
     * ViewItems the two SOURCE registrars produce — object binding, artifact-
     * protection merge and package provenance all applied, but nothing
     * REGISTERED. Returns `[]` (never throws) for a non-view type, a body that
     * is not a container, or a container with no derivable object binding —
     * exactly the "no expansion" outcomes the two callers below already
     * decide on independently.
     *
     * Pure and side-effect-free on purpose: it is shared by two callers with
     * DIFFERENT scope rules for what may be registered where —
     * {@link hydrateExpandedViewItems} (registry-mutating, org/environment-
     * gated) and `getMetaItems`' inline per-request expansion (registry-free,
     * ungated) — see the #13407 note on {@link hydrateExpandedViewItems} for
     * why the registry path could not simply be widened instead.
     *
     * ## Object-name derivation (#13407 fix)
     *
     * The container's OWN top-level `object` field — `ViewSchema.object`,
     * documented there as "how a stack-level `views: [...]` entry says which
     * object its views belong to; read by `getViewsByObject()` /
     * `GET /meta/view?object=`" — is the authorial, explicit signal and is
     * consulted FIRST. Before #13407 this walked only `list.data.object` →
     * `form.data.object` → the row's own name (mirroring `plugin.ts`) and
     * never read `container.object` at all, so a container that set the
     * top-level field but not `list.data.object` (or whose save `name` is not
     * the object it binds — the two are the same value only by convention)
     * expanded under the WRONG key or not at all. The three-deep fallback is
     * kept, unchanged, for every container written before this field was
     * consulted here.
     *
     * ## A container on ANOTHER package's object (#21334)
     *
     * The spec names every expanded view `<object>.<key>`: a bare `list` (one
     * that names no key) takes `<object>.default`, a `form` `<object>.form`,
     * and each named member its own key. For a container of the object's own
     * package those are that package's names, and it still expands there. For
     * a container saved under any other name, in another package or in none,
     * on an object a code package owns, they are the OTHER package's names:
     * ADR-0005 keys an overlay by its own name, and ADR-0126 rules out a silent
     * override, so a row named `x` may not replace an item named
     * `<object>.<key>`. Both callers set each expansion by name — the list's
     * inline pass over the merged items, the registry's bare key — so the
     * expansion used to replace the packaged view on the object door (and, on
     * an unscoped kernel, on the by-name read too), wearing the shadowed
     * artifact's `_packageId` and protection.
     *
     * So, on another package's object, every name the container expands
     * derives from its own name (triage's ruling, and the seat's answer that
     * extends it to the keyed members): the bare `list` is
     * `<object>.<container name>`, and every other member is
     * `<object>.<container name>.<key>` — the spec's own key rule and its
     * in-container de-duplication, run under the container's name (see
     * {@link expandUnderOwnName}). The qualified forms are the ones the spec
     * accepts for a ViewItem (`ViewItemNameSchema`); the flat container name on
     * an expanded item is refused there, so the list door would serve it
     * badged invalid. The view container contract (`view.zod.ts`, ADR-0017
     * §3.2) names the container after its object and states no arm for a name
     * another package owns, which is why the arm taken is the container's own
     * name rather than a refusal at save.
     *
     * Such a container adds views to the object; it never declares the
     * object's default, so none of its views carries `isDefault` — the
     * switcher's default stays the owning package's (the by-name override and
     * a user's own saved default are the routes that change it).
     *
     * ## …except a stored copy of a container its own package ships (#21980)
     *
     * The source loaders register a container a package ships under the
     * object's name, whichever package owns the object: every member is
     * `<object>.<key>`, registered for the shipping package
     * (`objectql`'s boot loop and `metadata`'s artifact loader, both through
     * the spec's `expandViewContainer`). Those names are that package's,
     * already published, and an overlay is keyed by its own name (ADR-0005),
     * so the package's stored copy of that container overlays them: it
     * expands as the loaders expand the container, and each name lands in
     * the copying package's own slot, which the list and the by-name read
     * select per package ({@link servedViewExpansion}). Under its own name,
     * the copy overlaid none of them, so a form withdrawn in the copy stayed
     * open in the package's shipped form, at the anonymous doors too.
     *
     * The copy is the container the package ships under the copy's name,
     * bound to the same object ({@link copiesOwnShippedViewContainer}). Every
     * other container on another package's object keeps the own-name arm,
     * and a copy, like any container on another package's object, still
     * declares no default. No expansion writes a name another package
     * ships: the copy's names are its own package's, and the save door
     * refuses a member whose name only another package ships
     * ({@link viewContainerNameCollisionRefusal}).
     *
     * Every expanded item carries the container's OWN package and, where that
     * package ships an artifact of the same name, that artifact's envelope —
     * never the envelope of an artifact another package ships.
     */
    static expandRuntimeViewContainer(host: Pick<ProtocolHost, 'copiesOwnShippedViewContainer' | 'expandUnderOwnName' | 'isAnotherPackagesObject' | 'lookupArtifactItem' | 'runtimeViewContainerObject' | 'runtimeViewContainerPackage'>, type: string,
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

    /**
     * [#21639, #21980] The view container `packageId` ships under `name`: the
     * registry's artifact read ({@link lookupArtifactItem}) in that package,
     * kept only when it is a container and that package's own, since the read
     * falls back to another package's artifact of the name. `undefined` for
     * no package, and where the package ships no container of the name.
     */
    static shippedViewContainerOf(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: string,
            name: unknown,
            packageId: string | undefined,): Record<string, unknown> | undefined {
        if (packageId === undefined || typeof name !== 'string' || name === '') return undefined;
        const shipped = host.lookupArtifactItem(type, name, packageId) as Record<string, unknown> | undefined;
        return isAggregatedViewContainer(shipped) && shipped?._packageId === packageId ? shipped : undefined;
    }

    /**
     * [#21334] The package a runtime view container row belongs to: the
     * package its row is bound to, else — for a package-less row that is the
     * name-keyed overlay of a packaged container (ADR-0005), such as a
     * tenant's overlay of a package's `<object>` container — the package of
     * the container it overlays, which is the slot the package-aware merge
     * seats it in. `undefined` for a package-less row that overlays nothing.
     *
     * [#21638] A container row is not the overlay of a view ITEM. A
     * package-less container row stored under the name of a view item a
     * package ships (`viewKind` set, {@link isShippedViewItem}) is not that
     * item's overlay — a container is not a view — so it belongs to no
     * package, and its expansion is placed as any package-less container's
     * is. The overlay of a shipped container keeps its package, as before. Read through the shipped item instead,
     * such a row was judged a container of the shipping package: on that
     * package's object its bare `list` took `<object>.default` and replaced
     * the packaged default on both doors, wearing the package's `_packageId`,
     * the override #21334's arm exists to rule out. The save door refuses the
     * shape now ({@link viewContainerNameCollisionRefusal}); a row stored
     * before that is read this way, with no re-save.
     */
    static runtimeViewContainerPackage(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: string,
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

    /**
     * [#21334] True when a code package other than `ownPackageId` ships an
     * artifact named `name` — the one case where the bare list's own name is
     * not free to take.
     */
    static isShippedByAnotherPackage(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: string, name: string, ownPackageId: string | undefined): boolean {
        const shipped = (host.lookupArtifactItem(type, name) as { _packageId?: unknown } | undefined)?._packageId;
        return typeof shipped === 'string' && shipped !== '' && shipped !== ownPackageId;
    }

    /**
     * [#7736] Register an aggregated `defineView` container's expansion
     * ({@link expandRuntimeViewContainer}) into the SchemaRegistry — at the
     * one hydration choke point all three runtime callers already share.
     *
     * "Object has-many View" (ADR-0017 §2, §3.2) makes container ingestion
     * DUAL-READ: register the container under the bare `<object>` key for
     * back-compatible single-item reads, AND register every expanded ViewItem
     * under `<object>.<viewKey>`, because only the expanded items carry the
     * `viewKind` + `object` pair that every object-bound read path filters on
     * (`GET /meta/view?object=` in `rest-server.ts`, `getViewsByObject()` in
     * `metadata-manager.ts`). Both source registrars do exactly this — the
     * ObjectQL boot loop (`engine.ts`, `key === 'views'`) and the metadata
     * artifact/HMR loader (`plugin.ts`, `isAggregatedViewContainer`) — and the
     * runtime door did not, so a container authored against a writable runtime
     * package was stored, badged `_diagnostics.valid: true`, and then served by
     * nothing: `getMetaItems` DROPS containers from enumeration (the
     * canonical-shape filter below) on the stated assumption that "the
     * registrar expands it", and for a runtime-written row no registrar ever
     * had. Measured before the fix: the stored container expands cleanly to two
     * items that WOULD match the switcher, and both object-bound exits answered
     * zero.
     *
     * The canonical-shape filter in `getMetaItems` is deliberately left alone:
     * its invariant ("a container's expanded items are also present") is what
     * was false here, and this restores it rather than loosening the filter —
     * which would surface the legacy wrapper shape to every list consumer and
     * still show the switcher nothing, since a container carries no `viewKind`.
     *
     * ## [#13407] This function's OWN scope boundary — the reason it is not
     * ## the whole fix
     *
     * This is registry-MUTATING, and both its callers gate it off exactly
     * where {@link hydrateOverlayIntoRegistry}'s own comments say why:
     * write-through (`applyRegistryWriteThrough`) never calls it where the
     * registry does not take this kernel's stored rows
     * ({@link registryTakesStoredRows}: an environment kernel whose own store
     * was never hydrated into it — `assembleMetadataProtocol`'s own comment:
     * "per-project (cloud) kernels source metadata from the control plane";
     * [#23298] it read `this.environmentId !== undefined` until then), and
     * `hydrateOverlayIntoRegistry`
     * itself refuses ANY org-scoped row before ever reaching this function
     * ("[#6602] a per-org overlay is served on demand, never grafted into the
     * registry every org in this process shares") — REGARDLESS of
     * `environmentId`. Both gates are deliberate isolation boundaries (ADR-0005
     * per-org isolation; the registry is shared by every org/request a given
     * kernel serves) and #13407 does not touch either one.
     *
     * That is precisely why #7736's fix — this function, reached only through
     * the registry-hydration callers — never helped the card's own repro ("a
     * signed-in user with an ACTIVE ORG" on "a live multi-node EE deployment"):
     * an org-scoped write NEVER reaches this function, on ANY kernel, container
     * shape or object-derivation notwithstanding. #13407's actual fix is
     * `getMetaItems`' separate, registry-free call to
     * {@link expandRuntimeViewContainer} (below, in the overlay-merge section)
     * — safe for org/environment isolation because it operates only on rows
     * `getMetaItems` already read for THIS request's own scope, and never
     * writes them anywhere shared. This function keeps serving the case it
     * always did (env-wide rows on an unscoped/control-plane kernel — the ONLY
     * combination #7736's own pin ever exercised — and, at boot and since
     * #23298 on a save, on an environment kernel that hydrates its own store),
     * now with the corrected derivation chain.
     *
     * ## [#21511] An expansion inherits its container's authorship
     *
     * Every expansion registered here is derived from a stored row, so it is
     * tenant-authored exactly as its container is, and it carries the same
     * marker {@link hydrateOverlayIntoRegistry} stamps on the container
     * ({@link stateTenantAuthorship}, applied before the item's own artifact
     * envelope). Without it, an expansion of a package-bound container sat
     * under its bare name wearing that package's `_packageId` and no tenant
     * marker, so `SchemaRegistry.getArtifactItem`'s bare-key fallback took it
     * for a code artifact: on an unscoped kernel the by-name read reported
     * the expanded view `resettable` and the layers read reported it as its
     * own `code` layer (for a package-less container too, through the
     * runtime-only `getItem` arm), where `env_local`, which then registered
     * nothing on a save,
     * reported neither. With the marker both kernels give one answer.
     *
     * ## [#21980] Never under a name another package ships
     *
     * The registry keeps one bare slot per name, and `SchemaRegistry.getItem`
     * answers it before any package's own entry, whichever package the read
     * names. So an expansion registered there under a name another package
     * also ships answered THAT package's by-name read on an unscoped kernel:
     * `getMetaItem` naming the other package fell through to the registry and
     * served this container's view, while the list served the other package's
     * own item in its slot ({@link servedViewExpansion}). Such an expansion is
     * not registered. Every kernel's by-name read already answers it from its
     * stored row, ahead of the registry ({@link resolveRowlessExpandedView}),
     * for its own package and for a read that names none, and the list expands
     * the row itself. A name that only the container's own package ships, or
     * that no package ships, is registered as before. [#22057] The question is
     * {@link anotherPackageShips}, the one the container row's own
     * registration asks too.
     *
     * ## [#23149, #23198] The registration is the reconcile's
     *
     * This expands the row and hands the result to
     * {@link reconcileViewExpansions}, which registers it (skipping a name
     * another package ships, as above), records it against the row, and heals
     * every name the row registered before and does not expand to now. A
     * republish that dropped a member used to register the new set and retire
     * nothing, so the dropped member was served until a restart.
     */
    static async hydrateExpandedViewItems(host: Pick<ProtocolHost, 'expandRuntimeViewContainer' | 'reconcileViewExpansions'>, type: string,
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

    /**
     * [#23198] THE reconcile of a view container's expansions: after any write
     * that changes a container's stored row (a publish, a republish, a reset, a
     * delete), the registry holds exactly the expansion set the stored row now
     * implies. Both sides call it: the registration
     * ({@link hydrateExpandedViewItems}, for every hydration of a row) and the
     * delete's heal ({@link restoreArtifactRegistryView}, whose set is
     * empty). No other code registers an expansion, reads the record, or
     * writes it (`protocol.view-expansion-reconcile-call-sites.test.ts`).
     *
     * In order:
     *
     * 1. Register each expanded view, unless another package ships its name
     *    ([#21980, #22057], {@link anotherPackageShips}). Such a name is never
     *    recorded, so no heal ever touches it.
     * 2. Replace the record of the rows the write addresses with the names
     *    registered in step 1. The old names come out of the record before any
     *    heal runs, so a write that lands meanwhile reconciles against the new
     *    set. A rebind (an orphan adoption, {@link reassignOrphanedMetadata})
     *    addresses the row under both bindings: the record of the binding it
     *    left is removed, and its names count as the row's old names.
     * 3. Heal each old name the new set lacks through the delete's per-name
     *    walk ({@link restoreArtifactRegistryView}): a packaged view of that
     *    name is un-shadowed, a MetadataService baseline is re-registered, and
     *    a name no layer serves is retired.
     *
     * Every gate the walk carries applies here too. An organization-scoped
     * write registers nothing and heals nothing (#6602 / #6780: the bare
     * entries belong to the environment-wide row). Only a kernel whose registry
     * takes its stored rows ({@link registryTakesStoredRows}) re-registers a
     * baseline. A walk that stops on a degraded baseline read
     * retires nothing, and that name stays registered, unrecorded, until a
     * restart: there is no retry ([#23149]'s residual, now reached from a
     * republish as well as a reset).
     *
     * Views only, judged on the canonical type: no other type expands, and a
     * row of another type stored under a container's name must not heal the
     * container's expansions.
     */
    static async reconcileViewExpansions(this: Pick<ProtocolHost, 'anotherPackageShips' | 'engine' | 'restoreArtifactRegistryView' | 'shippingPackagesOf'>, type: string,
        write: ViewContainerWrite,
        /** The write's own scope: `null` for an env-wide row. [#6780] */
        organizationId: string | null,): Promise<void> {
        if (canonicalMetaType(type) !== 'view') return;
        if (organizationId !== null && organizationId !== undefined) return;
        const registry: any = (this.engine as any)?.registry;
        if (!registry || typeof registry !== 'object') return;

        // 1. The set the stored row implies now. A non-empty expansion comes
        // only from the hydrator, past its `registerItem` capability probe.
        const registered = new Set<string>();
        let shipping: ShippingPackages | undefined;
        for (const item of 'expansion' in write ? write.expansion : []) {
            shipping ??= this.shippingPackagesOf(type);
            if (this.anotherPackageShips(type, String(item.name), item._packageId, shipping)) continue;
            registry.registerItem(type, item, 'name' as any);
            registered.add(String(item.name));
        }

        // 2. The record: the addressed rows' old names out, the new set in.
        const record = ObjectStackProtocolImplementation.registeredViewExpansions;
        let containers = record.get(registry);
        if (containers === undefined) record.set(registry, (containers = new Map()));
        const rows = containers.get(write.container) ?? new Map<string, ReadonlySet<string>>();
        const previous = new Set<string>();
        if ('removed' in write) {
            for (const names of rows.values()) for (const name of names) previous.add(name);
            rows.clear();
        } else {
            const row = write.binding ?? '';
            for (const name of rows.get(row) ?? []) previous.add(name);
            // A rebind: what the row registered under the binding it left is
            // its own too, and that record row is gone with the binding.
            if (write.reboundFrom !== undefined) {
                const left = write.reboundFrom.binding ?? '';
                for (const name of rows.get(left) ?? []) previous.add(name);
                rows.delete(left);
            }
            if (registered.size > 0) rows.set(row, registered);
            else rows.delete(row);
        }
        if (rows.size > 0) containers.set(write.container, rows);
        else containers.delete(write.container);

        // 3. Heal what the rows registered before and do not now.
        for (const name of previous) {
            if (registered.has(name)) continue;
            await this.restoreArtifactRegistryView(type, name, organizationId);
        }
    }

    /**
     * [#21980, #22057] True when a code package other than `own` ships an
     * artifact named `name`: some artifact in {@link shippedArtifactsOf}, the
     * one every package that can ship the name answers, has another
     * `_packageId`. With `own` undefined, any shipped artifact is another
     * package's.
     *
     * The registry's bare slot answers every package's read of the name, so
     * each VIEW registration under a bare name asks this first:
     * {@link hydrateExpandedViewItems} for an expansion,
     * {@link hydrateOverlayIntoRegistry} for a view row bound to a package,
     * and the delete's heal ({@link restoreArtifactRegistryView}) for a
     * package's view it would re-register. ⛔ Only views ask it: see the
     * hydrator's header for why every other type does not.
     */
    static anotherPackageShips(host: Pick<ProtocolHost, 'shippedArtifactsOf'>, type: string, name: string, own: unknown, shipping?: ShippingPackages): boolean {
        return host.shippedArtifactsOf(type, name, shipping)
            .some((artifact) => (artifact as { _packageId?: unknown })._packageId !== own);
    }

    /**
     * [#4521] Write-through the SchemaRegistry after a mutation goes LIVE, so
     * a just-saved item is dispatchable — not merely listable.
     *
     * `resolveRouteActionDeclaration` (and every other runtime consumer that
     * reads `engine.registry` directly) treats the registry as the live view
     * of metadata. Before this method the write only wrote through it for
     * `object` ({@link applyObjectRegistryMutation} returns early otherwise);
     * every other overlay type arrived in the registry solely via the
     * READ-side hydration in `getMetaItems` / `loadMetaFromDb`. That made a
     * *read* the thing that repaired the registry: a `PUT /meta/action/x`
     * followed immediately by `POST /actions/<object>/x` answered the
     * ADR-0110 "has no declaration" 404, and the very next listing call made
     * the same POST succeed (#4432 F1, split out as #4521). Read-your-writes
     * between the meta list and the dispatch path was decided by whether
     * anyone had listed yet.
     *
     * The fix is at the producer, not the consumer: no retry, no sleep and no
     * tolerance was added at the dispatch site, and ADR-0110's 404 for a
     * genuinely absent declaration is untouched — an item nobody wrote still
     * has nothing in the registry to find.
     *
     * Call ONLY after the write has landed and is live:
     *  • `saveMetaItem` repo path — post-`put()`, `mode === 'publish'` only
     *    (drafts are a staging buffer and must never leak into the runtime);
     *  • `runPublishSideEffects` — the draft→active promotion;
     *  • `rollbackMetaItem` — the restored body is the live one.
     *
     * The non-object branch registers only where the registry takes this
     * kernel's stored rows ({@link registryTakesStoredRows}): a project-scoped
     * row must not be registered into a registry that unscoped (control-plane)
     * callers share. The write must not be more permissive about that than the
     * read is.
     *
     * [#23298] …nor less permissive than the BOOT read. The gate used to be
     * `environmentId === undefined`, so an environment kernel that hydrates its
     * own store ({@link loadMetaFromDb}) registered every stored body at boot
     * and none that a write made live after it: the registry, and the security
     * catalog that reads it first, kept the boot-time body until a rebuild, and
     * a narrowed permission set kept granting its wider one. The gate now asks
     * whose registry this is, not whether the kernel has an environment.
     *
     * [#6602] That reason was true of the ENVIRONMENT dimension and false
     * of the ORGANIZATION one: the gate above says nothing about
     * `organization_id`, so on an unscoped kernel a per-org overlay write
     * hydrated straight into the process-wide registry under the plain key —
     * the designed per-org overlay leaking out of its org. `organizationId`
     * is now part of this request and is handed to
     * {@link hydrateOverlayIntoRegistry}, which owns the row-scope verdict
     * for all three hydration paths. Callers pass the SAME organization they
     * wrote the row with (`null`: since ADR-0131 D6 every row is the
     * environment's), so the registry's view cannot disagree with the row's
     * scope.
     *
     * [#23198] Every caller awaits it: a republish of a view container heals
     * the members it dropped ({@link reconcileViewExpansions}) before the
     * write answers, so the reads that follow it serve the published set.
     * The orphan adoption ({@link reassignOrphanedMetadata}) calls it for each
     * view row it rebinds, with `reboundFrom`, and [#23646] for each object
     * row, once {@link releaseAdoptedObjectOwner} has handed it the name.
     */
    static async applyRegistryWriteThrough(host: Pick<ProtocolHost, 'applyObjectRegistryMutation' | 'hydrateOverlayIntoRegistry' | 'registerStoredObjectExtension' | 'registryTakesStoredRows'>, request: {
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

    /**
     * Heal the in-memory registry after a metadata reset (overlay-row
     * delete). Walks the layers UNDER the deleted overlay, in order, and
     * stops at the first one that can serve the name:
     *
     *  1. Drop the plain-key runtime shadow so the packaged artifact
     *     (registered under `<packageId>:<name>`) becomes the visible
     *     value again. The shadow is written by the overlay-hydration
     *     paths (`getMetaItems` / `loadMetaFromDb`) and — pre-fix —
     *     survived the reset until restart, leaving stale overlay
     *     content (and a stripped `_lock` envelope) in every
     *     registry-direct read (ADR-0010 §3.3).
     *  2. When no composite-key artifact exists, fall back to the
     *     MetadataService baseline (FilesystemLoader-sourced types) and
     *     re-register it, preserving the historical refresh behaviour
     *     for items the SchemaRegistry never held as artifacts.
     *     [#23645] A tenant-authored object body is no baseline: on a kernel
     *     with no `environmentId` the service holds a copy of every object
     *     hydrated at boot, which is the deleted row itself. The read
     *     answers it as a miss ({@link readItemFromMetadataService}), so the
     *     walk reaches step 3 for a runtime object, as for one saved in the
     *     same process.
     *     [#22057] Tier 1 also declines when there is no plain-key entry,
     *     which is what a VIEW row bound to one package leaves under a name
     *     another package ships ({@link hydrateOverlayIntoRegistry}). So a
     *     view baseline bound to one package, under a name another package
     *     ships, is not re-registered here: under the bare name it would
     *     answer every package's read of the name. The walk stops there, as
     *     for any baseline found. ⛔ View only, as at the hydration: every
     *     other type re-registers as before. [#29600] The hydration's
     *     borrowed-envelope rule has no twin here: this limb registers the
     *     baseline's own body and grafts no artifact envelope onto it.
     *  3. [#5079] When NEITHER layer has anything, the deleted row was the
     *     whole item — so the plain-key entry is retired too
     *     ({@link SchemaRegistry.removeOverlayEntry}).
     *
     * ## Why step 3 exists (#5079, the #4432 residual)
     *
     * Step 1 declines for a runtime-CREATED item: `removeRuntimeShadow` only
     * un-shadows a packaged artifact, and there is none. Step 2 then found
     * nothing either — and the method returned, leaving the plain-key entry
     * that #4521's write-through had put there. Nothing else ever removed it,
     * so for the life of the process `GET /meta/<type>` kept enumerating a
     * deleted item, `GET /meta/<type>/<name>` kept serving its body, and the
     * ADR-0110 D3 declaration gate kept resolving it — while the row was gone
     * from `sys_metadata` and the handler registry had already dropped it.
     * The measured symptom: after `DELETE /meta/action/x`, `POST
     * /actions/<obj>/x` 404s with the *handler-miss* wording ("not found")
     * instead of ADR-0110's "has no declaration", because the declaration was
     * still resolvable from this stale entry. The delete's own receipt already
     * tells the truth here — #5927 splits it into "reset to artifact default"
     * (artifact-backed) vs "it no longer exists" (runtime-only); step 3 is the
     * registry making the same distinction the receipt makes.
     *
     * ## Why the layer-2 read is now diagnosed, and runs on every kernel
     *
     * [#5840] left this read on plain `get` because it "decides nothing" —
     * true then, false now: its `undefined` is what licenses step 3 to retire
     * an entry. So it goes through {@link readItemFromMetadataService}, which
     * carries the ADR-0110 D3 verdict, and a DEGRADED read stops the walk
     * without retiring anything. Retiring on an outage would answer "this
     * item exists in no layer" from a read that never reached one — the exact
     * miss-vs-outage confusion #5532/#5840 closed on the sibling paths. The
     * same helper also folds in the singular/plural retry, so a baseline
     * stored under the twin spelling is found rather than retired.
     *
     * RE-REGISTRATION runs only where the registry takes this kernel's stored
     * rows ({@link registryTakesStoredRows}) — the kernels the write-through
     * registers on. Only the READ is unconditional, because a project kernel
     * needs the same evidence before retiring an entry. [#23298] It used to be
     * control-plane-only (`environmentId === undefined`), the gate the
     * write-through had: once a save on an environment kernel that hydrates its
     * own store registers its body, a reset that found a baseline and did not
     * re-register it would leave the deleted body in the registry.
     *
     * ## Why `organizationId` is a REQUIRED parameter (#6780)
     *
     * Every tier above is `(type, name)`-addressed: `removeRuntimeShadow`
     * drops the PLAIN key, the layer-2 re-register writes the PLAIN key, and
     * `removeOverlayEntry` retires the PLAIN key. There is exactly one
     * plain-key entry per (type, name) in a process, and per ADR-0005 it
     * belongs to the ENV-WIDE row — an org-scoped overlay never enters the
     * registry at all (the rule {@link hydrateOverlayIntoRegistry} owns since
     * #6602). So a heal run on behalf of an ORG-scoped delete cannot address
     * anything of its own: it can only un-shadow or retire the entry every
     * other org and the control plane read.
     *
     * Measured on `origin/main` before this gate existed: env-wide
     * `view/shared_grid` in the registry → org A saves its own overlay (the
     * entry correctly stays `Env grid`, #6602 holding) → org A DELETEs ITS
     * OWN overlay → `registry.getItem('view','shared_grid')` is `undefined`
     * while the env-wide row still sits in `sys_metadata`. While the entry is
     * gone, direct registry readers answer as if the item does not exist
     * (ADR-0110 D3's declaration gate, `resolveRouteActionDeclaration`,
     * fail-closed `assertObjectRegistered` → 404) — one tenant's "reset my
     * customization" degrading every other tenant's runtime on the unscoped
     * kernels #5086 measured the flagship showcase booting with.
     *
     * The verdict lives HERE rather than at the call sites for the reason
     * {@link hydrateOverlayIntoRegistry} states on the register side (#6602 /
     * PR #6779): this is the ONE choke point all four heal callers already
     * route through, and a REQUIRED (never optional) `organizationId` makes a
     * fifth caller answer the question at compile time. An optional parameter
     * would default an omission to "env-wide" and reinstate the exact hole.
     *
     * REGISTER WIDE, RETIRE NARROW — the asymmetry is deliberate. The
     * write-through's `object` branch is NOT org-gated ({@link
     * applyRegistryWriteThrough}), and that carve-out does not transfer to
     * removal: it is argued from `assertObjectRegistered` failing CLOSED, so
     * a surplus entry degrades to "listable but rowless" and the next reload
     * heals it, while a wrongly retired entry 404s data CRUD for every tenant.
     * The two costs are not symmetric, so the two gates are not either.
     *
     * The KERNEL-scope gate stays where it was: it guards re-registration
     * only, because whose registry this is ({@link registryTakesStoredRows})
     * is a fact about the kernel this protocol instance serves, not about the
     * row in hand.
     *
     * ## [#23149] A view container's expansions are healed too
     *
     * A view container row registers more than its plain key: every view it
     * expands to is registered under its own name `<object>.<viewKey>`
     * ({@link hydrateExpandedViewItems}). The tiers above healed the container's
     * plain key alone, so after a reset of a packaged view container that
     * answered `reset: true`, the list doors kept serving the overlay's
     * expanded views until a restart. Measured on a real `SchemaRegistry`: the
     * packaged expansions sit under `<packageId>:<object>.<viewKey>`, untouched
     * by the publish, and the overlay's under the bare names, where the reset
     * left them.
     *
     * So each name the container's rows registered is healed by this same
     * walk, as a `(type, name)` of its own: a packaged view of that name is
     * un-shadowed, a baseline is re-registered, and a name no layer serves is
     * retired. Each name inherits every gate above: an organization-scoped
     * heal touches none of them, and only a control-plane kernel
     * re-registers. A name the hydration skipped because another package
     * ships it was never recorded, so it is never touched.
     *
     * [#23198] The heal does this through {@link reconcileViewExpansions},
     * the one function a republish reconciles through too, with the empty set
     * a removed row implies. The names leave the record before the walk, so
     * each registration is healed once. A walk that stops on a degraded
     * baseline read leaves that name registered until a restart.
     *
     * Best-effort: a failure must never block the delete that already
     * succeeded; the next full reload fixes the registry anyway.
     */
    static async restoreArtifactRegistryView(host: Pick<ProtocolHost, 'anotherPackageShips' | 'applyRegistryWriteThrough' | 'convertStoredItem' | 'engine' | 'findEnvironmentRows' | 'isArtifactBacked' | 'isUnservedSealedOverlay' | 'readItemFromMetadataService' | 'reconcileViewExpansions' | 'registryTakesStoredRows' | 'resyncStoredObjectExtensions' | 'rethrowUnlessMetadataStoreUnprovisioned'>, type: string,
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

    /**
     * Ensure a just-PUBLISHED object's physical table exists so it is usable
     * for data CRUD immediately — without a server restart. Registering the
     * object (above) only updates the in-memory registry; the table is created
     * by the driver's schema sync, which otherwise only runs at boot. Without
     * this, inserting into a freshly-published object fails with "no such
     * table" (surfaced as `object_not_found`) until the next restart.
     * Best-effort + non-fatal: drivers without DDL (or read-only datasources)
     * simply no-op, and a sync failure must not abort the publish. Non-fatal is
     * not quiet: a refused sync is reported at `error` with its consequence
     * and fix (#22985), because the publish it follows has already answered
     * success.
     *
     * [#30635] …and to the CALLER: a refused sync returns one `warning`
     * advisory ({@link objectStorageSyncRefusedNotice}) that every door running
     * this sync puts on the 2xx it answers (`saveMetaItem` in publish mode, and
     * through `runPublishSideEffects` `publishMetaItem` and, on the object's
     * `published[]` element, [#30693] `publishPackageDrafts`). A sync that ran, or
     * a type with no storage, returns `undefined`, so a clean answer is
     * unchanged.
     */
    static async ensureObjectStorage(host: Pick<ProtocolHost, 'engine' | 'ensureObjectStorage'>, type: string, name: string): Promise<RuntimeAuthoringIssue | undefined> {
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
            return undefined;
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
            return objectStorageSyncRefusedNotice(name, err);
        }
    }

    /**
     * Inverse of {@link ensureObjectStorage}: drop an object's physical table.
     * DESTRUCTIVE — deletes the table and all its rows. Only invoked when a
     * delete explicitly opts into storage teardown (see {@link deleteMetaItem}'s
     * `dropStorage`), so publishing an object solely to preview it can be undone
     * without leaving an orphan table. Best-effort: a failure is logged, not
     * thrown — the metadata delete already succeeded, and a stray table is
     * reclaimed by the next sync/drop rather than blocking the delete.
     */
    static async dropObjectStorage(host: Pick<ProtocolHost, 'engine'>, type: string, name: string): Promise<void> {
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

    /**
     * [#23514, ADR-0029 D9.9, ADR-0070 TL;DR 1] The D9.9 refusal for an object
     * whose owner is its package-less definition (the `'sys_metadata'`
     * sentinel), so no package owns it: a definition bound to package `Q`
     * beside it is one the one registry entry never serves.
     *
     * Its prescription names the way out that is true in the state it
     * answers, each measured on a real kernel across a boot, with no table
     * dropped and every record kept:
     *
     * | state | the way out |
     * |:--|:--|
     * | a publish save naming `Q`, no package's row stored | delete the package-less definition WITHOUT `dropStorage` (the delete door's default, which keeps the table), then send the save again: `Q`'s row is the owner at once and at every boot |
     * | a DRAFT save naming `Q`, no package's row stored | the same delete, then a PUBLISH-mode save naming `Q` (it serves the object at once), then draft as before. A draft save registers nothing, so a draft sent right after the delete leaves the object unserved until it is published |
     * | rows bound to packages (`Q` or any other) are already stored beside the package-less one (the rows the save door wrote before this refusal existed) | delete each of them by naming its package, then the package-less definition, then a publish-mode save naming `Q`. Each row is named because a delete naming no package resolves to the one binding present, or is refused `409` over two ({@link packagelessAddress}), never to the package-less definition |
     * | one such row, a publish save naming NO package | it is addressed to that row ({@link packagelessAddress}); delete the row, then the same save edits the package-less definition. Over two bindings the save is refused `409` before this refusal |
     * | [#23712] a DRAFT save naming NO package, whose draft address ({@link packagelessDraftAddress}) is a package `Q`'s: one row bound to `Q`, or no such row and a lone draft bound to `Q` | delete the row by naming its package, and with no package-unbound draft stored, discard each package's draft by naming its package (`?state=draft&package=`), then the same save writes the package-less draft. Deleting the row alone leaves `Q`'s draft, which the address then still names |
     * | a promotion of `Q`'s draft (the per-item publish, `publish-drafts`), a draft stored before the package-less row or by a draft save the door addressed to `Q` | the deletes above for the state, then the same publish: the draft stays stored, and its promotion registers it |
     * | a publish naming no package of a draft bound to NO package, which the address adopts into the one stored binding `P` | no publish moves that draft into `P` (measured: with `P`'s row gone it promotes into the package-less definition; one naming `P` answers `NO_DRAFT`). Delete `P`'s row, publish again (it updates the package-less definition), then the package-less DELETE and a publish-mode save naming `P` move the object |
     *
     * The boot (`loadMetaFromDb`) and the write-through
     * ({@link applyObjectRegistryMutation}) meet the third state: the row
     * they register is stored, and each names every package's row.
     *
     * ADR-0070 D5's `POST /api/v1/packages/:id/adopt-orphans` also hands an
     * adopted object's registry owner to `Q` in the same request, but it
     * rebinds EVERY package-less row of the environment, not only this
     * object, so no prescription names it: each names the narrowest way out.
     *
     * The code is D9.9's, not a new one: the ledger's meaning (a row bound to a
     * package that does not own the object) holds, and the caller's branch is
     * the same one; only the way out differs, and the message carries it. The
     * prescription first: a 4xx message crosses the REST boundary bounded at
     * 500 characters with its tail truncated.
     */
    static unboundOwnerPackageRefusal(name: string, rowPackageId: string, state: UnboundOwnerRefusalState = {},): Error {
        const q = rowPackageId;
        const path = `/api/v1/meta/object/${name}`;
        const tail = state.at === 'registry'
            ? ` The row bound to '${q}' is not registered.`
            : ' Nothing was written.';
        let message: string;
        // [#23514] Every row bound to a package stored beside the package-less
        // one is named by its own `?package=` delete, before the delete naming
        // no package: over such a row that request removes it (one binding) or
        // is refused 409 (two), never the package-less definition.
        const rows = [...new Set(state.storedPackages ?? [])].sort();
        const rowDeletes = rows.map((pkg, i) => (i === 0 ? `DELETE ${path}?package=${pkg}` : `?package=${pkg}`))
            .join(', then ');
        const rowsServed = rows.length === 1
            ? `its definition bound to '${rows[0]}' is never served`
            : `its definitions bound to ${rows.map((pkg) => `'${pkg}'`).join(', ')} are never served`;
        if (rows.length > 0 && state.at === 'promote' && state.adoptedDraft) {
            // Measured: the publish then lands the draft package-less, so the
            // text says so, and names the move into the package as the next step.
            message = `This draft of object '${name}' is bound to no package; a publish naming no package is `
                + `addressed into '${q}', whose row is never served. DELETE ${path}?package=${q}, then publish again: `
                + `the draft lands in the package-less definition. To move it into '${q}' then: the same DELETE with no `
                + `package and no dropStorage (records stay), then save it naming '${q}' in publish mode.` + tail;
        } else if (state.mode === 'draft' && state.namedNoPackage && state.at !== 'promote') {
            // [#23712] A draft save naming no package writes the package's
            // draft the address names. Each step names its package: a delete
            // or discard naming none resolves by the rows the earlier steps
            // leave. With the rows and the package drafts gone, the address is
            // the package-unbound draft (`packagelessDraftAddress`).
            // Every step is a request, in order, spelled as the row deletes
            // above are, so one row and two drafts fit the REST message bound.
            const drafts = [...new Set(state.strandedDrafts ?? [])].sort();
            const steps = [
                ...rows.map((pkg) => `?package=${pkg}`),
                ...drafts.map((pkg, i) => `?state=draft&package=${pkg}${i === 0 ? ' (the draft discard)' : ''}`),
            ];
            message = `A draft save naming no package of object '${name}' writes a draft bound to '${q}', which no `
                + 'publish can serve: the object is served by its package-less definition. First '
                + `DELETE ${path}${steps.join(', then ')}, then send this save again: it writes the package-less `
                + 'draft.' + tail;
        } else if (rows.length > 0 && state.namedNoPackage) {
            // A save naming no package is addressed to the one binding present.
            message = `A save naming no package of object '${name}' is addressed to its stored definition bound to `
                + `'${q}', which is never served: the object is served by its definition bound to no package. `
                + `Delete the '${q}' row first (REST: DELETE ${path}?package=${q}), then send this save again: it `
                + 'then saves the package-less definition.' + tail;
        } else if (rows.length > 0) {
            // [#23514] A promotion's last step NAMES the draft's package: a
            // publish naming none resolves by the rows the deletes leave, and
            // can then address another draft (`packagelessDraftAddress`).
            const finish = state.at === 'promote'
                ? `POST ${path}/publish?package=${q}`
                : `save it naming '${q}' in publish mode`;
            // Every step is a request, in order, so the whole way out fits the
            // REST message bound with two packages' rows and long names.
            message = `Object '${name}' is served by its package-less definition; ${rowsServed}. To move it into `
                + `'${q}': ${rowDeletes}, then the same DELETE with no package and no dropStorage (the table and `
                + `records stay), then ${finish}.` + tail;
        } else if (state.at === 'promote') {
            // The draft is stored and stays stored: after the delete, its
            // promotion is the save that moves the object (it registers).
            message = `Move object '${name}' into package '${q}' first: delete its package-less definition without `
                + `dropStorage, which keeps its table and records (REST: DELETE ${path} with no package `
                + `parameter), then POST ${path}/publish?package=${q}: the draft then serves the object at once.` + tail;
        } else if (state.mode === 'draft') {
            message = `Move object '${name}' into package '${q}' first: delete its package-less definition without `
                + `dropStorage, which keeps its table and records (REST: DELETE ${path} with no package parameter), `
                + `then save it naming '${q}' in publish mode, which serves it at once, and draft after that. A draft `
                + 'save registers nothing, so a draft sent first leaves the object unserved until it is published.'
                + tail;
        } else {
            message = `Move object '${name}' into package '${q}' first: delete its package-less definition `
                + 'without dropStorage, which keeps its table and records (REST: DELETE '
                + `${path} with no package parameter; in process: deleteMetaItem without `
                + 'packageId), then send this save again. Nothing was written: the object is held by a definition '
                + `bound to no package, and an object has one registry entry, so a definition bound to `
                + `'${q}' would never be served.`;
        }
        const err: any = new Error(message);
        err.code = 'OBJECT_OVERLAY_PACKAGE_MISMATCH';
        err.status = 422;
        err.packageId = rowPackageId;
        err.ownerPackageId = null;
        err.docs = 'docs/adr/0029-kernel-object-ownership-and-platform-objects-decomposition.md';
        return err;
    }

    /**
     * [#23415, ADR-0048] The refusal of a delete that asks to drop an object's
     * table ({@link shouldDropStorage} says yes) while another stored row of
     * the object stays after it. A `sys_metadata` row is keyed by its package,
     * so one object can hold one row per package (and a package-less row), and
     * every such row serves the object over the ONE table its name maps to.
     * Dropping the table with one of them left the others' object served
     * with its records gone: measured at `DELETE
     * /api/v1/meta/object/NAME?package=P&dropStorage=true` on a booted
     * showcase, `200` with a receipt naming Q's remaining row, then `500` on
     * the object's next data read.
     *
     * Refused, not skipped: an explicit `dropStorage` that drops nothing would
     * be an opt-in the runtime does not honour while the receipt answers
     * success. Refused before any write, so nothing is deleted and the request
     * succeeds once the remedy is applied: without `dropStorage` (this row
     * goes, the table stays), or with the object's last row.
     *
     * The rows that count are the ones the delete's own address read
     * ({@link packagelessAddress}) holds: the environment's ACTIVE rows of the
     * object. A draft row is not one: a draft is never materialised and never
     * served, so it holds no records, and the last active row's delete still
     * drops the table it was the last to serve.
     *
     * `RESOURCE_CONFLICT` / 409, no code minted: the standard catalog's member
     * for a refusal that comes from environment state rather than the request
     * (the same request is accepted once the other rows are gone), as
     * {@link packagelessAddressAmbiguityRefusal} answers for the same rows.
     * The prescription first, because a 4xx message crosses the REST boundary
     * bounded at 500 characters with its tail truncated.
     */
    static dropStorageRemainingRowsRefusal(type: string,
            name: string,
            deletedPackage: string | null,
            remainingPackages: readonly string[],
            unboundRemains: boolean,): Error & { code: 'RESOURCE_CONFLICT'; status: 409 } {
        const which = deletedPackage !== null ? ` (package=${deletedPackage})` : '';
        const err = new Error(
            'Send the delete again without dropStorage to remove this row and keep the table, or delete the '
            + "object's other rows first and drop the table with the last one. Nothing was deleted. "
            + `After this delete${which}, ${type} '${name}' is still served: `
            + `${remainingRowsPhrase(remainingPackages, unboundRemains, 'row')}, and the object's records are in its table. `
            + "dropStorage drops an object's table only with the object's last row.",
        ) as Error & { code: 'RESOURCE_CONFLICT'; status: 409 };
        err.code = 'RESOURCE_CONFLICT';
        err.status = 409;
        return err;
    }
}

/**
 * [#30635] The rule id of the advisory a save or publish answers with when the
 * object's storage sync was refused. Stable across releases: the key a client
 * groups or suppresses the notice by.
 */
export const OBJECT_STORAGE_SYNC_REFUSED = 'object-storage-sync-refused';

/**
 * [#30635] The caller's half of a refused object-storage sync: one `warning`
 * on the answer's `advisories`, beside the #22985 `error` line the operator
 * reads. The answer stays the success it already was (the item is published,
 * registered and served); this says its storage did not follow, so the
 * author does not find out only when reads and writes against it fail.
 *
 * `path` is empty: the finding is about the object as a whole. The driver's
 * text is quoted only when the driver declared it a client refusal (a 4xx
 * `status`), the rule every report riding a 2xx on these doors follows
 * ({@link clientFacingFailureText}); any other failure is named as being in
 * the server log, where the `error` line carries it whole.
 */
export function objectStorageSyncRefusedNotice(name: string, err: unknown): RuntimeAuthoringIssue {
    const reason = clientFacingFailureText(err, 'the reason is in the server log');
    return {
        rule: OBJECT_STORAGE_SYNC_REFUSED,
        severity: 'warning',
        where: `object "${name}"`,
        path: '',
        message:
            `object '${name}' was saved and is served, but its storage was NOT created or altered: `
            + `the datasource refused its schema sync (${reason}). Until the sync runs, reads and writes `
            + 'against it fail, or miss the columns this save added.',
        hint:
            "Resolve the datasource's refusal, then publish the object again (which re-runs the sync), "
            + 'or restart the server, which syncs the storage of every registered object.',
    };
}
