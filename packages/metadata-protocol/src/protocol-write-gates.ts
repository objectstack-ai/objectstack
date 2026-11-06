// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Write gates: overlay, code-only, organization, sealed
 * and packaged-base refusals, locks, version tokens, conflict audit" facet of
 * `ObjectStackProtocolImplementation`: the bodies of `mergesOverlayAtRead`,
 * `registryAllowsOverlay`, `isOverlayAllowed`, `isRuntimeCreateAllowed`,
 * `codeOnlySourceHint`, `codeOnlyCreateError`, `codeOnlyOverrideError`,
 * `refuseOrganizationScopedWrite`, `isArtifactBacked`, `isSealedManagedItem`,
 * `overlayBaseShippers`, `isNestedArtifactField`, `packagedBaseRefusal`,
 * `packagedArtifactOwner`, `storedFlowBindingAgrees`,
 * `packagelessOverlayWriteRefusal`, `namedBaseOverlayWriteRefusal`,
 * `refusePackagedBaseRemoval`, `shipsBundleName`, `baseServesBundleMember`,
 * `pairOfAddedMember`, `findPairAddedMemberRow`, `registryMemberServedAt`,
 * `recordOptimisticConflictAudit`, `envWritableTypes`,
 * `organizationScopedWriteRefusal`, `requestedOrganization`,
 * `isPackagedBaseRefusal`, `optimisticConflictAuditEntry` moved out of
 * `protocol.ts` whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolWriteGatesFacet` is a stateless facet over the host
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

import { resolveTenancyPosture } from '@objectstack/types';
import { envWritableMetadataTypes } from './sys-metadata-repository.js';
import { managedItemSealedSentence } from './packaged-base-regime.js';
import type { StoredOverlayRow } from './item-lock.js';
import { itemDiscriminator, pairOf } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { baseAddressServesMember, readOnlyShippingPackages, shippingPackageIds } from './protocol-environment-rows.js';
import { canonicalMetaType, canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { boundPackageOf } from './protocol-package-bindings.js';
import type { ShippingPackages } from './protocol-package-bindings.js';
import { memberOption } from './protocol-bundle-members.js';
import type { MetadataAuditEntry } from './protocol-audit-entry.js';
import { packagedBaseRegimeRow, packagedBaseRegimeSentence } from './packaged-base-regime.js';
import { packagelessCloseSubject } from './protocol-packageless-overlay-migration.js';
import type { PackagelessWriteSubject } from './protocol-packageless-overlay-migration.js';
import {
    namedBaseCloseSubject,
    namedBaseOverlayWriteRefusal,
    packagelessOverlayWriteRefusal,
} from './protocol-packaged-base-refusal.js';
import type {
    NamedBaseWriteOperation,
    NamedBaseWriteSubject,
    PackagelessWriteOperation,
} from './protocol-packaged-base-refusal.js';
import type { ProtocolHost } from './protocol-host.js';
// [#29985 codemod] `ObjectStackProtocolImplementation` here is `ObjectStackProtocolImplementationStatics` (imported AS the class): forwarders to its statics (#30147).
import { ObjectStackProtocolImplementationStatics as ObjectStackProtocolImplementation } from './protocol.js';
import type { ObjectStackProtocolImplementationStaticsHost } from './protocol.js';

export class ProtocolWriteGatesFacet {
    /**
     * [#6960] Does this type's registry entry carry the removal carve-out
     * (`supportsOverlay`)? The name predates ADR-0131 D6's seal and no read
     * consults it: a stored overlay row of a managed item is served or
     * withheld by {@link declinesStoredRow}, which keys on
     * `allowEnvironmentOverlay`. Normalizes plural→singular, like every other
     * predicate here.
     *
     * Read ONLY by `deleteMetaItem`'s two-tier authorization (and mirrored by
     * `SysMetadataRepository`'s delete gate); it never widens a create or an
     * update. See the call site for the ruling that licenses the asymmetry.
     */
    static mergesOverlayAtRead(this: Pick<ObjectStackProtocolImplementationStaticsHost, 'OVERLAY_CAPABLE_TYPES'>, type: string): boolean {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        return this.OVERLAY_CAPABLE_TYPES.has(singular)
            || this.OVERLAY_CAPABLE_TYPES.has(type);
    }

    /**
     * Does the type's REGISTRY entry open an overlay channel (`allowEnvironmentOverlay`)?
     * The registry arm of {@link isOverlayAllowed}, without the hatch.
     * Normalizes plural→singular before consulting the allow-list.
     *
     * [ADR-0131 D6] Read alone by {@link isSealedManagedItem}: whether an item a
     * managed package ships may be overlaid is the registry's answer, and the
     * `OS_METADATA_WRITABLE` hatch has no say in it.
     */
    static registryAllowsOverlay(this: Pick<ObjectStackProtocolImplementationStaticsHost, 'OVERLAY_ALLOWED_TYPES'>, type: string): boolean {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        return this.OVERLAY_ALLOWED_TYPES.has(singular)
            || this.OVERLAY_ALLOWED_TYPES.has(type);
    }

    /**
     * The TYPE-level write channel: the registry's overlay opt-in, or the
     * `OS_METADATA_WRITABLE` hatch naming the type. Normalize plural→singular
     * before consulting the allow-list.
     *
     * [ADR-0131 D6] A type-level answer, so ⛔ never the answer for an item a
     * managed package ships — that one is {@link isSealedManagedItem}'s, and the
     * hatch does not reach it. What the hatch still opens through this predicate
     * is the type's writes of items no managed package ships.
     */
    static isOverlayAllowed(this: Pick<ObjectStackProtocolImplementationStaticsHost, 'envWritableTypes' | 'registryAllowsOverlay'>, type: string): boolean {
        if (this.registryAllowsOverlay(type)) return true;
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        const env = this.envWritableTypes();
        return env.has(singular) || env.has(type);
    }

    /**
     * Does this type permit creating brand-new (artifact-free) items?
     *
     * ## [#8421] What the second arm means now, and why it did NOT narrow
     *
     * The fall-through below used to be the write-side twin of a read-side
     * rule: "no static registry entry ⇒ plugin-registered ⇒ writable", mirrored
     * verbatim by `getMetaTypes()`'s synthesised `allowRuntimeCreate: true`.
     * The maintainer ruling of 2026-08-15 retired that rule's premise —
     * verbatim, untranslated:
     *
     *     暂时不考虑让插件申明新的元数据类型
     *
     * ⚠️ `暂时` is load-bearing: a CURRENT posture, deliberately not a
     * permanent architectural closure (the full record, and what a future
     * author reintroducing plugin-declared kinds must revisit, is in
     * {@link getMetaTypes}'s synthesis comment — read that one first).
     *
     * The narrowing that ruling bought is enforced ONE layer up, at
     * {@link refuseUnmintableMetaType}, which runs before this predicate on
     * every `saveMetaItem` and refuses an out-of-contract type outright. This
     * arm is therefore no longer an ADVERTISEMENT and must not be narrowed to
     * match one: by the time it is consulted for such a type, the caller is in
     * one of the residue paths the refusal deliberately exempts or does not
     * guard at all —
     *
     *  - `deleteMetaItem` / {@link historyMetaItem} / `rollbackMetaItem` /
     *    `promoteDraftForPublish`: rows minted under an unrecognised type
     *    BEFORE the refusal shipped are real, and nothing rewrites them on
     *    upgrade. Returning `false` here would route them off the repository
     *    path and strand them — turning the accumulation this card was filed
     *    about into an accumulation nobody can clear, which is the exact
     *    reasoning that kept `deleteMetaItem` open in the first place;
     *  - `saveMetaItem` behind the mint door's two exemptions (the compound
     *    arity, and a namespace the store says already exists).
     *
     * So the doors agree where agreement is a claim about creating a NEW
     * namespace — the listing and the mint door read one predicate for that —
     * and this arm keeps the clearance path open underneath. Narrowing it would
     * not close anything; it would only make residue unclearable.
     */
    static isRuntimeCreateAllowed(this: Pick<ObjectStackProtocolImplementationStaticsHost, 'RUNTIME_CREATE_ALLOWED_TYPES' | 'STATIC_REGISTRY_TYPES'>, type: string): boolean {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        if (this.RUNTIME_CREATE_ALLOWED_TYPES.has(singular)
            || this.RUNTIME_CREATE_ALLOWED_TYPES.has(type)) {
            return true;
        }
        // No static registry entry ⇒ no declared flags to consult. See the doc
        // above: this is the residue/clearance arm, NOT the read door's twin.
        if (!this.STATIC_REGISTRY_TYPES.has(singular)
            && !this.STATIC_REGISTRY_TYPES.has(type)) {
            return true;
        }
        return false;
    }

    /**
     * The prescription half of a code-only refusal (#5086): where the author
     * is supposed to declare this item instead. Read from the type's own
     * registry entry (`filePatterns`), so a newly-flagged type carries an
     * accurate hint the day it is flagged — nothing here to keep in sync,
     * except the types {@link CODE_ONLY_TYPE_REMEDY} names explicitly.
     */
    static codeOnlySourceHint(type: string): string {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        const named = ObjectStackProtocolImplementation.CODE_ONLY_TYPE_REMEDY[singular];
        if (named) return named;
        const entry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === singular);
        const pattern = entry?.filePatterns?.[0];
        return pattern ? ` Declare it in source (${pattern}) and redeploy.` : '';
    }

    /**
     * #5086 — a brand-new item of a type the registry declares code-only
     * (`allowRuntimeCreate: false` AND `allowEnvironmentOverlay: false`).
     *
     * Names the type, the flags that produced the verdict, the prescription
     * and the escape hatch — the same shape the retired-key refusals in this
     * wave carry, because a refusal an author cannot act on just moves the
     * confusion one layer down. `NOT_CREATABLE` is the catalogued code
     * (`packages/spec/src/api/error-code-ledger.zod.ts`).
     */
    static codeOnlyCreateError(type: string): Error {
        const err = new Error(
            `Metadata type '${type}' is code-only: the metadata-type registry declares `
            + `allowRuntimeCreate=false and allowEnvironmentOverlay=false, so it cannot be created through the `
            + `runtime metadata API (PUT /api/v1/meta/${type}/:name) on any kernel.`
            + ObjectStackProtocolImplementation.codeOnlySourceHint(type)
            // [ADR-0131 D6] A Regime C type's refusal names its sanctioned paths and
            // never the hatch, as its regime sentence does (`packaged-base-regime.ts`):
            // the hatch would re-open the very source the regime closes. It still
            // opens the type for an operator — the residue repair the delete door
            // keeps — it is only not prescribed. Under the REST door's 500-character
            // bound either way (`sharing_rule`: 473).
            + (packagedBaseRegimeRow(type)?.regime === 'C'
                ? ''
                : ` An operator may set OS_METADATA_WRITABLE=${PLURAL_TO_SINGULAR[type] ?? type} to grant a runtime escape hatch. `
                    + `See docs/adr/0005-metadata-customization-overlay.md.`)
        );
        (err as any).code = 'NOT_CREATABLE';
        (err as any).status = 403;
        return err;
    }

    /**
     * #5086 — the artifact-backed half of the same refusal: the name IS
     * shipped by a code package, so the honest verdict is "you may not
     * overlay it" rather than "you may not create it".
     *
     * [ADR-0131 D6] The package is a managed one and its item is sealed, so the
     * sentence names the managed package and says the hatch does not open it —
     * the prescription this sentence used to end with ("an operator may set
     * OS_METADATA_WRITABLE") would send the operator to a door that no longer
     * opens. The source remedy stays: it is where a code-only item is declared.
     */
    static codeOnlyOverrideError(type: string, name: string): Error {
        // [ADR-0131 D6, ADR-0126 §2] A Regime C type's declared item reads its
        // regime sentence — the one the package door and the repository speak for
        // the same item — so the refusal names the clone and the switch.
        const err = new Error(
            (packagedBaseRegimeRow(type)?.regime === 'C' ? packagedBaseRegimeSentence(type, name, 'save') : undefined) ??
            `Metadata item '${type}/${name}' is provided by a managed package and its type is `
            + `code-only (allowRuntimeCreate=false, allowEnvironmentOverlay=false), so it is sealed against `
            + `runtime edits on any kernel, and OS_METADATA_WRITABLE does not open a managed item.`
            + ObjectStackProtocolImplementation.codeOnlySourceHint(type)
            + ` See docs/adr/0131-total-organization-ownership-no-null-organization-id.md.`
        );
        (err as any).code = 'NOT_OVERRIDABLE';
        (err as any).status = 403;
        return err;
    }

    /** Throw {@link organizationScopedWriteRefusal} for an organization-scoped write request. */
    static refuseOrganizationScopedWrite(this: Pick<ObjectStackProtocolImplementationStaticsHost, 'organizationScopedWriteRefusal' | 'requestedOrganization'>, subject: string, request: unknown): void {
        const refusal = this.organizationScopedWriteRefusal(subject, this.requestedOrganization(request));
        if (refusal) throw refusal;
    }

    /**
     * Does an artifact (npm-package-loaded) item exist at `(type, name)`?
     *
     * The schema registry's `_packageId` tag is set only when
     * `registerItem(..., packageId)` is called with a truthy packageId
     * — and only artifact loaders do that. DB-rehydrated items
     * (sys_metadata rows registered back into the registry by
     * `getMetaItems` / `loadMetaFromDb`) call `registerItem` without a
     * packageId, so they carry no `_packageId` and are correctly
     * excluded here.
     *
     * Used by the two-tier authorization model to distinguish
     * "overlaying a packaged item" (requires `allowEnvironmentOverlay`) from
     * "authoring a DB-only item" (requires only `allowRuntimeCreate`).
     *
     * [#7743] …and it must answer that question about the artifact as SHIPPED,
     * not about how the registry happens to key it. See
     * {@link isNestedArtifactField} and [#21899] {@link isDeclaredCodeDatasource}
     * for the two declared types whose artifacts are not standalone registry
     * items at all.
     */
    static isArtifactBacked(host: Pick<ProtocolHost, 'isDeclaredCodeDatasource' | 'isNestedArtifactField' | 'lookupArtifactItem'>, type: string, name: string): boolean {
        // `lookupArtifactItem` only returns items whose `_packageId` marks a
        // genuine code package (the `'sys_metadata'` rehydration sentinel is
        // excluded), and — via `SchemaRegistry.getArtifactItem` — is immune
        // to plain-key shadows hydrated from overlay rows.
        if (host.lookupArtifactItem(type, name) !== undefined) return true;
        return host.isNestedArtifactField(type, name) || host.isDeclaredCodeDatasource(type, name);
    }

    /**
     * [ADR-0131 D6] Is `(type, name)` MANAGED CONTENT — sealed against every
     * write onto it and every removal of it? THE predicate both package doors
     * ask ({@link refusePackagedBaseOverride} and {@link refusePackagedBaseRemoval},
     * and through them {@link packagedBaseRefusal} for the `/automation` doors
     * and the read envelope), and the one `saveMetaItem` / `deleteMetaItem` ask
     * where the `OS_METADATA_WRITABLE` hatch would otherwise decide an item's
     * fate. `SysMetadataRepository.assertAllowed` states the same rule at the
     * store, where it is told the item is artifact-backed by the write intent.
     *
     * True when an item a managed package ships ({@link isArtifactBacked} — the
     * registry's artifact-only lookup, never the body a caller sends) is of a
     * type whose registry entry opens no overlay channel
     * ({@link registryAllowsOverlay}). The install mode is not modelled yet, so
     * every package the artifact loader registered items for is managed.
     *
     * What it deliberately leaves open:
     *  - the regime-O overlay: a type whose registry entry allows an
     *    environment overlay (`view`, `dashboard`, `report`, `translation`,
     *    `email_template`) keeps it — an overlay replaces the managed item
     *    beside it, it does not edit it;
     *  - an item no managed package ships: creating, editing and removing it is
     *    environment authoring, governed by `allowRuntimeCreate` and the hatch as
     *    before;
     *  - the removal of a stored overlay row that merges at read (#6960) — the
     *    removal door's own carve-out, which removes no managed definition
     *    (and changes what is served for `permission` alone).
     *
     * ⛔ The hatch is not consulted: `OS_METADATA_WRITABLE` unlocks a TYPE, and a
     * type-level unlock says nothing about an item a managed package ships.
     */
    static isSealedManagedItem(host: Pick<ProtocolHost, 'isArtifactBacked' | 'registryAllowsOverlay'>, type: string, name: string): boolean {
        return host.isArtifactBacked(type, name)
            && !host.registryAllowsOverlay(type);
    }

    /**
     * [ADR-0146 D11] The bases of an item of one of the five overlay types
     * ({@link registryAllowsOverlay}: the `allowEnvironmentOverlay` types): the
     * READ-ONLY code packages that ship the name ({@link shippedArtifactsOf}
     * less {@link isWritablePackage}), sorted — `[]` for every other type, and
     * for a name no read-only package ships. The reading
     * `os migrate packageless-overlays` classifies a package-less row by
     * (`readOnlyShippingPackages`), so the close
     * ({@link packagelessOverlayWriteRefusal}) and the ceremony agree on what
     * is a packaged item. The flag no longer opens a package-less write onto
     * one; it stays the predicate the migration reads and the read of a row not
     * migrated yet honours.
     */
    static overlayBaseShippers(host: Pick<ProtocolHost, 'isWritablePackage' | 'registryAllowsOverlay' | 'shippedArtifactsOf'>, type: string, name: string): string[] {
        if (!host.registryAllowsOverlay(type)) return [];
        return readOnlyShippingPackages(host.shippedArtifactsOf(type, name), (id) => host.isWritablePackage(id));
    }

    /**
     * [#7743] Is `(field, '<object>.<field>')` a field a code package ships?
     *
     * ## Why this predicate needs a second resolver at all
     *
     * `field` is the ONE type in `DEFAULT_METADATA_TYPE_REGISTRY` whose
     * artifacts are not standalone registry items. Its `filePatterns`
     * (`**\/*.field.ts`) match nothing in any app — fields are authored INSIDE
     * the object (`ObjectSchema.fields`, a `z.record(name, FieldSchema)`), so
     * the object's loader registers one `object` item and no `field` items at
     * all. `getArtifactItem('field', 'showcase_task.title')` therefore misses
     * on a field the package unambiguously ships.
     *
     * That miss is not cosmetic — it is a load-bearing authorization input.
     * `isArtifactBacked` is what picks the write INTENT for
     * `SysMetadataRepository.assertAllowed` (`override-artifact` vs
     * `runtime-only`) and what arms `saveMetaItem`'s own `NOT_OVERRIDABLE`
     * gate. With the lookup empty, an override of a packaged field was
     * classified as a runtime-only CREATE, and `field` carries
     * `allowRuntimeCreate: true` — so `allowEnvironmentOverlay: false` was never
     * consulted, and `PUT /api/v1/meta/field/showcase_task.title` answered
     * **200** on a write the registry forbids. Measured on the showcase before
     * this fix: 200 `state:'active'`, the row reading back with
     * `_diagnostics.valid=true`.
     *
     * ## Why this is `field`-only and not a general nesting rule
     *
     * Measured across the whole registry on a booted showcase (#7743): every
     * other declared type either registers its artifacts standalone with a
     * `_packageId` — `action` (70), `page` (33), `permission` (16), `dataset`
     * (9), `doc` (9), `hook` (4), `report` (4), `mapping`/`book`/
     * `email_template` (1 each) — or genuinely ships no artifacts at all
     * (`position`, `tool`, `skill`, `seed`, `translation`,
     * `external_catalog`), where "not artifact-backed" is the TRUE answer and
     * the runtime-create tier is the right one. `action` is the instructive
     * one: it is also nested inside the object document, yet it IS registered
     * standalone, so it was already refused correctly (403) in the same run.
     * `field` is the only name where the registry's answer and the shipped
     * artifact disagree, so widening this to a class would be widening it past
     * what was measured.
     *
     * [#21899] The census missed one type, and it is a SECOND non-standalone
     * shape rather than a second nesting: `datasource`. A code-defined
     * datasource is registered neither standalone nor nested in the
     * SchemaRegistry — the runtime registers it in the MetadataService, in
     * memory only — so `getArtifactItem('datasource', 'showcase_external')`
     * missed on the showcase's own `*.datasource.ts` (measured on a booted
     * showcase) and `PUT /api/v1/meta/datasource/showcase_external` answered
     * 200 on the `runtime-only` intent. Its resolver is
     * {@link isDeclaredCodeDatasource}, beside this one and in this shape:
     * a containment boolean, read from what the installed code packages
     * ship. Two resolvers, each for the one type it measured — still not a
     * nesting rule.
     *
     * ## Shape decisions
     *
     *  - **Containment, not a synthetic envelope.** This returns a boolean
     *    rather than routing through {@link lookupArtifactItem}, because a
     *    field sub-document is a bare `{ name, label, type, … }` with no
     *    `_packageId` / `_lock` envelope. The other `lookupArtifactItem`
     *    callers (lock resolution, `mergeArtifactProtection`, the layered
     *    read) consume that envelope, and handing them a field body would make
     *    them assert provenance nobody stamped. The authorization question —
     *    "does a package ship this?" — is answerable without one.
     *  - **The OBJECT is resolved through the artifact-only lookup**, so an
     *    overlay row hydrated under the plain key cannot manufacture *or* mask
     *    an artifact field (ADR-0010 §3.3, the same shadow-immunity the
     *    standalone path relies on).
     *  - **`fields` is read in its one canonical form** — a record keyed by
     *    field name (`object.zod.ts`, `z.record(...)`). No array fallback:
     *    Prime Directive #12 keeps one contract rather than two dialects.
     *  - **A brand-new field stays creatable.** A name the object's artifact
     *    does not carry answers `false` here, keeps the `runtime-only` intent,
     *    and is still accepted under `allowRuntimeCreate: true` — the
     *    declaration has two tiers and this closes only the overlay one.
     */
    static isNestedArtifactField(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: string, name: string): boolean {
        if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'field') return false;
        // `<object>.<field>` — both halves are snake_case and carry no dot of
        // their own, so the FIRST separator is the only one.
        const sep = name.indexOf('.');
        if (sep <= 0 || sep === name.length - 1) return false;
        const objectArtifact = host.lookupArtifactItem('object', name.slice(0, sep)) as
            { fields?: Record<string, unknown> } | undefined;
        const fields = objectArtifact?.fields;
        if (!fields || typeof fields !== 'object') return false;
        return Object.prototype.hasOwnProperty.call(fields, name.slice(sep + 1));
    }

    /** The body of `ObjectStackProtocolImplementation#packagedBaseRefusal`; the method's docblock there is its contract. */
    static packagedBaseRefusal(host: Pick<ProtocolHost, 'isPackagedBaseRefusal' | 'refusePackagedBaseOverride' | 'refusePackagedBaseRemoval'>, request: { type: string; name: string; operation: 'save' | 'delete'; packageId?: string | null }): Error | null {
        // [#9009] Folded HERE, at the producer of the verdict, so a caller that
        // arrives with a plural spelling cannot address around the lock.
        const folded = canonicalizeMetaRequestType(request);
        try {
            if (folded.operation === 'delete') host.refusePackagedBaseRemoval(folded);
            else {
                host.refusePackagedBaseOverride({
                    type: folded.type,
                    name: folded.name,
                    ...(folded.packageId ? { packageId: folded.packageId } : {}),
                });
            }
        } catch (err) {
            if (host.isPackagedBaseRefusal(err)) return err;
            throw err;
        }
        return null;
    }

    /** The body of `ObjectStackProtocolImplementation#packagedArtifactOwner`; the method's docblock there is its contract. */
    static packagedArtifactOwner(host: Pick<ProtocolHost, 'lookupArtifactItem'>, request: { type: string; name: string }): string | undefined {
        const folded = canonicalizeMetaRequestType(request);
        const artifact = host.lookupArtifactItem(folded.type, folded.name) as { _packageId?: unknown } | undefined;
        const packageId = artifact?._packageId;
        return typeof packageId === 'string' && packageId !== '' ? packageId : undefined;
    }

    /**
     * [#20761] Does a stored flow row named `name` bind to `packageId` — the
     * server's own fact behind a `_packageId` stamp a tenant row's served body
     * echoes (see rule 3 of {@link tenantAuthoredWriteRefusal})?
     *
     * Asked only on the rare path — a body whose stamps would classify it as
     * code-shipped, for a name the loader's set does not hold — so an
     * ordinary write pays no read. Any state and any scope count: a draft
     * bound to the package is as much the server's fact as the live row.
     *
     * An UNPROVISIONED store answers "no", and the refusal stands: a store with
     * no `sys_metadata` table holds no row the stamps could agree with. Any
     * OTHER read failure propagates ({@link rethrowUnlessMetadataStoreUnprovisioned}),
     * never an invented "no" — refusing a legitimate round trip because the
     * store was unreachable would state a disagreement nobody measured.
     */
    static async storedFlowBindingAgrees(host: Pick<ProtocolHost, 'findEnvironmentRow' | 'rethrowUnlessMetadataStoreUnprovisioned'>, name: string, packageId: string): Promise<boolean> {
        try {
            // [#21911] The explicit system opt-in — see findServedOverlayRow.
            const row = await host.findEnvironmentRow('sys_metadata', {
                where: { type: 'flow', name, package_id: packageId },
                context: { isSystem: true },
            });
            return row != null;
        } catch (error) {
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
            return false;
        }
    }

    /**
     * [ADR-0146 D11, #28576 ruling 2] The package-less write onto a packaged
     * item, closed where `os migrate packageless-overlays` would move it: the
     * refusal of a save, a publish, a delete or a rollback that names no
     * package, of an item of one of the five overlay types that ONE read-only
     * code package ships ({@link overlayBaseShippers}), whose row the
     * ceremony's census classifies `movable` and whose move can succeed
     * (`packagelessCloseSubject` in `protocol-packageless-overlay-migration.ts`,
     * the census's own classification and the ceremony's own steps).
     *
     * `null` — the write stays open, as on `main` — when it names a package
     * (`?package=<base>.custom` stays open, as does every other package's own
     * door; [#28905] the write naming the read-only base itself is closed by
     * {@link namedBaseOverlayWriteRefusal}, not here); when no read-only
     * package ships the name (environment metadata);
     * and for every row the ceremony lists and does not move: a name several
     * packages ship (`multi_shipped`), a base with no pair id (`no_pair`), a
     * stored row whose `overrides` names another package
     * (`foreign_declaration`) or whose pair already holds the item
     * (`shadowed`), and a move that would fail (the ensure door would refuse
     * the pair, the base records no version, or the override write gate
     * refuses the declared body — an `email_template` locale the base does not
     * ship). Each such row keeps a write door after the upgrade: its own.
     *
     * The refusal names the base's paired `.custom` and the ceremony; a row
     * stored before the close stays served until the ceremony moves it, and
     * its package-less write is refused by the same sentence. Registry reads
     * first; the one store read (the item's rows) only when the registry has
     * not left the write open.
     *
     * Asked by {@link saveMetaItem} and {@link publishMetaItem} (authoring
     * writes only: the server-stated rewrites name the row they rewrite),
     * {@link deleteMetaItem}, and {@link rollbackMetaItem} (whose address is the
     * restored row's own binding: package-less when that row is). The
     * sentence is `packagelessOverlayWriteRefusal` in
     * `protocol-packaged-base-refusal.ts`.
     *
     * Not the read envelope's `editable` / `deletable` ({@link packagedBaseRefusal}
     * keeps its answer): those describe the item, which the pair's write still
     * changes.
     */
    static async packagelessOverlayWriteRefusal(this: Pick<ProtocolHost, 'engine' | 'findEnvironmentRows' | 'overlayBaseShippers' | 'overrideWriteVerdict' | 'rethrowUnlessMetadataStoreUnprovisioned'>, request: PackagelessWriteSubject,
        operation: PackagelessWriteOperation,): Promise<Error | null> {
        const host: ThisParameterType<typeof packagelessCloseSubject> = {
            engine: this.engine,
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
            overlayBaseShippers: (...a) => this.overlayBaseShippers(...a),
            overrideWriteVerdict: (...a) => this.overrideWriteVerdict(...a),
        };
        const closed = await packagelessCloseSubject.call(host, request);
        return closed ? packagelessOverlayWriteRefusal(request, closed, operation) : null;
    }

    /**
     * [#28905, ADR-0146 D1, D11] The write NAMING the read-only base itself
     * (`?package=<base>`) onto an item of one of the five overlay types that
     * base ships: the refusal of a save (draft or active), a publish (both
     * {@link publishMetaItem} and {@link publishPackageDrafts}, through
     * {@link promoteDraftForPublish}) or a rollback that would land a row bound
     * to the base. D1 puts a read-only package's customizations in its paired
     * `<base>.custom`; such a row is served at the base's address with no
     * declaration, outside the pair, until [#29392] `os migrate
     * packageless-overlays` moves it into the pair. Refused with
     * the fix the package-less close names ({@link packagelessOverlayWriteRefusal},
     * one spelling): write it into the pair, declaring the override.
     *
     * Closed on the package-less close's reading of "packaged" — a READ-ONLY
     * code package among {@link overlayBaseShippers} — and only where that fix
     * can be taken (a pair id, the ensure door, a base version, the override
     * write gate admitting the declared body): `namedBaseCloseSubject` in
     * `protocol-packaged-base-refusal.ts`. `null` — the write stays open, as on
     * `main` — for a writable package, a package that does not ship the name,
     * a body carrying `overrides` (the D2 gate's), any other type, and a fix
     * that could not be taken.
     *
     * ⛔ Not a delete: removing a row bound to the base writes nothing, and it
     * is one way to clear such a row stored before the close; the ceremony is
     * the other, moving it into the pair with its declaration. A row stored
     * before it stays served until one of those, or the pair's declared
     * override, which is served over it; the sentence names all three.
     *
     * Authoring writes only: the server-stated rewrites (`source` set, the
     * `package-duplicate` write face) name the row they rewrite. Registry
     * reads only.
     */
    static namedBaseOverlayWriteRefusal(this: Pick<ProtocolHost, 'engine' | 'overlayBaseShippers' | 'overrideWriteVerdict'>, request: NamedBaseWriteSubject,
        operation: NamedBaseWriteOperation,): Error | null {
        const host: ThisParameterType<typeof namedBaseCloseSubject> = {
            engine: this.engine,
            overlayBaseShippers: (...a) => this.overlayBaseShippers(...a),
            overrideWriteVerdict: (...a) => this.overrideWriteVerdict(...a),
        };
        const closed = namedBaseCloseSubject.call(host, request);
        return closed ? namedBaseOverlayWriteRefusal(request, closed, operation) : null;
    }

    /**
     * `deleteMetaItem`'s refusal of a removal of an item a code package ships,
     * on a type with no per-org overlay channel — EXCEPT a type whose loader
     * merges an overlay at read time, where removing the row is repair (the
     * #6960 ruling; the call site in {@link deleteMetaItem} carries the record
     * and the tier boundary, which is `supportsOverlay`, never
     * `allowEnvironmentOverlay`). Throws the refusal; returns when the removal is not
     * refused on that ground.
     *
     * [#20679] Lifted out of `deleteMetaItem` UNCHANGED, for the reason {@link
     * refusePackagedBaseOverride} was lifted out of `saveMetaItem`: from
     * `legacyOverlayRemoval` to the closing brace these are that method's
     * lines, byte for byte apart from indentation. The two added lines compute
     * `overlayAllowed` and `artifactBacked` the way `deleteMetaItem` computes
     * them, where both still stand for its `NOT_CREATABLE` check.
     *
     * [#20819] Since lifted, the SENTENCE is chosen per ADR-0126 regime
     * ({@link packagedBaseRegimeSentence}); the predicate, the code and the
     * status are unchanged.
     *
     * [ADR-0131 D6] Managed content is sealed against removal as against edits:
     * the predicate is {@link isSealedManagedItem}, the save door's, so the
     * `OS_METADATA_WRITABLE` hatch no longer opens the removal either. The
     * #6960 carve-out stands — removing a row of a type that merges at read
     * removes no managed definition. Only for `permission`, whose stored fork
     * is still served ({@link isUnservedSealedOverlay}), does it change what is
     * served; every other such row is served by no read already
     * ({@link declinesStoredRow}). The sentence names the managed
     * package ({@link managedItemSealedSentence}).
     */
    static refusePackagedBaseRemoval(host: Pick<ProtocolHost, 'isSealedManagedItem' | 'mergesOverlayAtRead'>, request: { type: string; name: string }): void {
        const legacyOverlayRemoval = host
            .mergesOverlayAtRead(request.type);
        if (host.isSealedManagedItem(request.type, request.name) && !legacyOverlayRemoval) {
            // [#20819, ADR-0131 D6] Sentence per ADR-0126 regime, as in the save door.
            const err = new Error(managedItemSealedSentence(request.type, request.name, 'delete'));
            (err as any).code = 'NOT_OVERRIDABLE';
            (err as any).status = 403;
            throw err;
        }
    }

    /** [#28802] Whether `base` is a code package that ships the bundle's name `name`, any member. */
    static shipsBundleName(host: Pick<ProtocolHost, 'shippedArtifactsOf'>, type: string, name: string, base: string, shipping: ShippingPackages): boolean {
        return shippingPackageIds(host.shippedArtifactsOf(type, name, shipping)).has(base);
    }

    /**
     * [#28802, ADR-0146 D2, #28390 ruling A] Whether the address of `base`, a
     * code package that ships the bundle's name `name` (a type in
     * `ITEM_KEY_DISCRIMINATORS`), serves `item`, a member of that name: by
     * {@link baseAddressServesMember}, given whether `base` ships the member
     * `item` is. The one member-grain answer the env-wide list, the list
     * scoped to `base` and the by-name reads give.
     */
    static baseServesBundleMember(host: Pick<ProtocolHost, 'shippedArtifactsOf'>, type: string, name: string, base: string, item: unknown, shipping: ShippingPackages): boolean {
        const member = itemDiscriminator(canonicalMetaType(type), item);
        const baseShipsMember = shippingPackageIds(host.shippedArtifactsOf(type, name, shipping, member)).has(base);
        return baseAddressServesMember(base, boundPackageOf((item as { _packageId?: unknown } | null | undefined)?._packageId), baseShipsMember);
    }

    /**
     * [#28802, #28390 ruling A] The pair of `base` when the bundle member
     * `member` (its discriminator value) of the name `name` is one only the
     * pair can add on `base`'s address: `base` ships the name and not that
     * member. Else `undefined`, and the by-name read serves as before.
     */
    static pairOfAddedMember(host: Pick<ProtocolHost, 'shippedArtifactsOf' | 'shippingPackagesOf' | 'shipsBundleName'>, type: string, name: string, base: string, member: string): string | undefined {
        const shipping = host.shippingPackagesOf(type);
        if (!host.shipsBundleName(type, name, base, shipping)) return undefined;
        if (shippingPackageIds(host.shippedArtifactsOf(type, name, shipping, member)).has(base)) return undefined;
        const pair = pairOf(base);
        return pair.ok ? pair.value : undefined;
    }

    /**
     * [#28802, #28830] The pair's own stored row at the bundle member `member`
     * (`wantedMember` its discriminator value) of the name `name`, when only
     * the pair can add that member on `base`'s address
     * ({@link pairOfAddedMember}); else `undefined`. The one read of it the
     * by-name read and the layered read share.
     */
    static async findPairAddedMemberRow(host: Pick<ProtocolHost, 'findServedOverlayRow' | 'pairOfAddedMember'>, type: string, name: string, base: string, member: string | undefined, wantedMember: string,
            activeRows?: readonly StoredOverlayRow[],): Promise<any> {
        const pairOfAddition = host.pairOfAddedMember(type, name, base, wantedMember);
        if (pairOfAddition === undefined) return undefined;
        return (await host.findServedOverlayRow({
            type, name, state: 'active', packageId: pairOfAddition, ...memberOption(member),
        }, activeRows))?.row;
    }

    /**
     * [#28802] The registry's answer `item` for a bundle member read on the
     * address of `base`, when that address serves it
     * ({@link baseServesBundleMember}); else, for a read that named no
     * member, the base's own member its artifact answers canonical-first,
     * and otherwise nothing. An address that ships no member of the name is
     * no base of it: `item` as before.
     */
    static registryMemberServedAt(host: Pick<ProtocolHost, 'baseServesBundleMember' | 'engine' | 'shippedArtifactsOf' | 'shippingPackagesOf' | 'shipsBundleName'>, type: string, name: string, base: string, item: unknown, member: string | undefined): unknown {
        const shipping = host.shippingPackagesOf(type);
        if (!host.shipsBundleName(type, name, base, shipping)) return item;
        if (host.baseServesBundleMember(type, name, base, item, shipping)) return item;
        if (member !== undefined) return undefined;
        const own = host.shippedArtifactsOf(type, name, shipping)
            .find((artifact) => (artifact as { _packageId?: unknown } | null)?._packageId === base);
        if (own === undefined) return undefined;
        const candidate = host.engine.registry.getItem(type, name, base, itemDiscriminator(canonicalMetaType(type), own));
        return candidate !== undefined && host.baseServesBundleMember(type, name, base, candidate, shipping) ? candidate : undefined;
    }

    /**
     * [#7748] Audit an optimistic-concurrency refusal (the 409
     * `METADATA_CONFLICT` envelope) — ONE spelling shared by all four routes
     * that can raise it (save / publish / rollback / delete).
     *
     * ## Why this is a denial and not an absence
     *
     * The lock gate ({@link assertLockAllowsWrite}) already records the writes
     * it refuses, so a compliance report could show a locked item's rejected
     * saves. The 409 is refused OUTSIDE that helper — it comes back from the
     * repository's parent-version check — and until this landed nothing on that
     * route wrote a row at all. A caller repeatedly losing a race against
     * another author was therefore indistinguishable, in the trail, from a
     * caller who never tried: both leave nothing behind.
     *
     * A single helper rather than four copies is deliberate: the four call
     * sites already carry four near-identical hand-written conflict `Error`s,
     * and adding a fifth-through-eighth hand-written audit block is how one
     * idea acquires four spellings that then drift apart.
     */
    static async recordOptimisticConflictAudit(host: Pick<ProtocolHost, 'optimisticConflictAuditEntry' | 'recordMetadataAudit'>, args: {
            type: string;
            name: string;
            operation: 'save' | 'publish' | 'rollback' | 'delete';
            actor?: string;
            source: string;
            requestId?: string;
            expectedParent?: unknown;
            actualHead?: unknown;
        }): Promise<void> {
        await host.recordMetadataAudit(host.optimisticConflictAuditEntry(args));
    }

    /**
     * Phase 3a-env-writable: parse `OS_METADATA_WRITABLE` once.
     * Comma-separated singular type names. When the env var is set, the
     * listed types get treated as `allowEnvironmentOverlay: true` regardless of
     * their static registry entry. This is the runtime escape hatch admins
     * use to enable Studio-side editing of types whose protocol-level flag
     * is still false (object, field, permission, …).
     *
     * [#22411] Delegates to the repository's {@link envWritableMetadataTypes},
     * the ONE reader of the setting, so the listing and the save door read the
     * same set. This used to be a second copy of the parse. The 11.0 removal of
     * the legacy `OBJECTSTACK_METADATA_WRITABLE` spelling edited the other
     * copy and missed this one, so the listing advertised a hatch that the
     * repository then refused. ⛔ Never parse the variable here again.
     *
     * Memoised at first call (by the shared reader). Tests can override by
     * clearing the cache via
     * {@link ObjectStackProtocolImplementation.resetEnvWritableCache}.
     */
    static envWritableTypes(): ReadonlySet<string> {
        return envWritableMetadataTypes();
    }

    /**
     * [ADR-0131 D6/D7] The protocol refuses EVERY organization-scoped
     * metadata write. Returns the refusal, or `null` when the request names no
     * organization.
     *
     * Environment metadata — whatever Studio, the cloud build agent or an
     * install writes — belongs to the whole deployment, so `sys_metadata` has
     * no per-organization partition left to write into: the ADR-0005
     * per-organization overlay axis is retired (ADR-0131 D6), and with it the
     * five-type exemption this gate used to grant (`allowOrgOverride: true` —
     * `view`, `dashboard`, `report`, `translation`, `email_template` — and the
     * `OS_METADATA_WRITABLE` hatch, which unlocked org scoping exactly as it
     * unlocked the overlay). The `/meta` doors already carry no organization
     * into a write; this is the protocol's own refusal, so every other door
     * (the `/packages` verbs, the stored-row migrations, a plugin) answers
     * the same.
     *
     * One gate for every write verb — `saveMetaItem` (draft and publish),
     * `publishMetaItem`, `deleteMetaItem`, `rollbackMetaItem`, the commit
     * reverts and every package verb — asked FIRST, before any read, so
     * "refused, not refused after writing" holds on each. A legacy
     * organization-scoped row is not rewritten here or anywhere else in this
     * file: the promotion ceremony (ADR-0131 C7) carries those rows to the
     * environment layer.
     *
     * `NOT_OVERRIDABLE` / 403, the code this refusal has always carried: the
     * condition is still "this item has no per-organization channel", now for
     * every type. The first sentence names the tenancy posture in force,
     * because the posture is what a reader suspects first — and none of the
     * three (`single`, `group`, `isolated`) opens the channel.
     */
    static organizationScopedWriteRefusal(subject: string,
            organizationId: unknown,
            remedy = 'Retry with no organization: the write then lands environment-wide, where every organization reads it.',): Error | null {
        if (organizationId === undefined || organizationId === null || organizationId === '') return null;
        let posture: string;
        try {
            posture = `the '${resolveTenancyPosture()}' tenancy posture`;
        } catch {
            posture = 'an unrecognized tenancy posture';
        }
        const err: any = new Error(
            `${subject} cannot be written organization-scoped (organization '${String(organizationId)}'): `
            + `under ${posture}, as under every posture, environment metadata belongs to the whole deployment `
            + `and no organization holds its own copy (ADR-0131 D6). `
            + `${remedy} `
            + `A row stored organization-scoped before this release stays where it is until the promotion ceremony `
            + `(ADR-0131 C7) carries it to the environment layer. `
            + `See docs/adr/0131-total-organization-ownership-no-null-organization-id.md.`
        );
        err.code = 'NOT_OVERRIDABLE';
        err.status = 403;
        err.organizationId = organizationId;
        err.docs = 'docs/adr/0131-total-organization-ownership-no-null-organization-id.md';
        return err;
    }

    /** The request's `organizationId`, read off whatever the caller sent — the key is retired from every write verb's declared request, so a caller still sending it is untyped by construction. */
    static requestedOrganization(request: unknown): unknown {
        return request && typeof request === 'object'
            ? (request as { organizationId?: unknown }).organizationId
            : undefined;
    }

    /**
     * The two refusals {@link refusePackagedBaseOverride} and {@link
     * refusePackagedBaseRemoval} can raise — `NOT_OVERRIDABLE`, and
     * `ITEM_LOCKED` from `readOnlyBaseOverrideError` on a named read-only base
     * — both `403`. Anything else a lookup might throw is not a verdict and is
     * re-raised by {@link packagedBaseRefusal}, never handed out as one.
     */
    static isPackagedBaseRefusal(err: unknown): err is Error {
        if (!(err instanceof Error)) return false;
        const { code, status } = err as Error & { code?: unknown; status?: unknown };
        return status === 403 && (code === 'NOT_OVERRIDABLE' || code === 'ITEM_LOCKED');
    }

    /**
     * [#8594] The same row as a VALUE, for the site that must not write it
     * where the conflict is caught — see {@link lockWriteRefusal} for the full
     * argument. `recordOptimisticConflictAudit` above is now this plus the
     * write, so the four routes that call it are byte-identical to before and
     * the fifth (`promoteDraftForPublish`) hands the row to its caller.
     */
    static optimisticConflictAuditEntry(args: {
            type: string;
            name: string;
            operation: 'save' | 'publish' | 'rollback' | 'delete';
            actor?: string;
            source: string;
            requestId?: string;
            expectedParent?: unknown;
            actualHead?: unknown;
        }): MetadataAuditEntry {
        return {
            type: args.type,
            name: args.name,
            organizationId: null,
            operation: args.operation,
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'metadata_conflict',
            ...(args.actor ? { actor: args.actor } : {}),
            source: args.source,
            ...(args.requestId ? { requestId: args.requestId } : {}),
            // [#21207] Fork three, ruling A: a COPY never carries the stored
            // content hash — not raw (an offline verifier, at rest and served to
            // every audit reader), and not keyed either (a copy has no use for a
            // version token, and a keyed value would die with the key). The
            // note keeps its sentence and says which side was absent; a value
            // is `(withheld)`. `os migrate audit-metadata-bodies` rewrites the
            // notes written before this to exactly this text.
            note: `expected parent ${args.expectedParent == null ? 'null' : '(withheld)'} `
                + `but current is ${args.actualHead == null ? 'null' : '(withheld)'}`,
        };
    }
}
