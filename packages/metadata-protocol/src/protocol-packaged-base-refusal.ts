// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 13] Two packaged-base door verdicts of
 * `ObjectStackProtocolImplementation` — the package door's refusal of a write
 * onto an item a code package ships (`refusePackagedBaseOverride`) and the
 * removal verdict on a code-defined item of an origin-gated type
 * (`originGatedRemovalRefusal`) — moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same predicates, in the
 * same order, refusing with the same emitters, codes, statuses and sentences.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link PackagedBaseRefusalHost} members that method reads, plus
 * a `.call`. A method is handed over as a closure that calls it on the
 * protocol at call time, so a test double or spy set on the instance is still
 * the one the body reaches. Every other reader of these two methods keeps
 * calling the class method.
 *
 * The removal door's own refusal, `refusePackagedBaseRemoval`, stays in the
 * class: it reads the private static `mergesOverlayAtRead`, and the class's
 * private-static readers stay there. So does `packagedBaseRefusal`, the public
 * verdict both doors' refusals answer through, which reads the private static
 * `isPackagedBaseRefusal`.
 *
 * The bodies read no module-level declaration of `protocol.ts`; what they
 * import, they import from where `protocol.ts` imported it. Nothing
 * re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { isOriginGatedType, managedItemSealedSentence, regimeCDeclaredSaveSentence } from './packaged-base-regime.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';
import {
    customizationBasePackageId,
    customizationPackageId,
    getOverrideTypeClassification,
    isCustomizationPairOf,
    OverrideDeclarationSchema,
} from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec';
import { ITEM_KEY_DISCRIMINATORS, itemDiscriminator } from '@objectstack/metadata-core';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface PackagedBaseRefusalHost {
    isSealedManagedItem: ObjectStackProtocolImplementation['isSealedManagedItem'];
    isWritablePackage: ObjectStackProtocolImplementation['isWritablePackage'];
    packagedBaseRefusal: ObjectStackProtocolImplementation['packagedBaseRefusal'];
    packagedArtifactOwner: ObjectStackProtocolImplementation['packagedArtifactOwner'];
    resolveWritePackageScope: ObjectStackProtocolImplementation['resolveWritePackageScope'];
    shippedArtifactsOf: ObjectStackProtocolImplementation['shippedArtifactsOf'];
}

/** The body of `ObjectStackProtocolImplementation#refusePackagedBaseOverride`; the method's docblock there is its contract. */
export function refusePackagedBaseOverride(
    this: Pick<PackagedBaseRefusalHost, 'isSealedManagedItem' | 'isWritablePackage' | 'packagedArtifactOwner'>,
    request: { type: string; name: string; packageId?: string | null },
): void {
    if (this.isSealedManagedItem(request.type, request.name)) {
        // [#8184] THE PACKAGE DOOR — the SECOND refusal point for one
        // condition, and the reason this card exists.
        //
        // `SysMetadataRepository.assertAllowed` reads the base the
        // caller NAMED and answers `ITEM_LOCKED` (`lockSource:
        // 'package'`) when it is read-only (#7682, then #8146's
        // hatch ruling). That door is topology-INDEPENDENT — and it
        // was unreachable here, because this branch throws first on
        // every kernel with an `environmentId`. So one request
        // answered `ITEM_LOCKED` on a host-config / CLI-assembled
        // kernel and the undiscriminated `NOT_OVERRIDABLE` on a
        // project/cloud per-env one: the refusal VOCABULARY keyed off
        // a row-scoping key, which is the #5086 / #6710 finding
        // (see the block comment above) arriving on the error codes.
        // A client that learns to handle `ITEM_LOCKED` on one
        // deployment never saw it on the other.
        //
        // ⚠️ MIRRORED, NOT RE-INVENTED. Same predicate
        // ({@link isWritablePackage}, the ADR-0070 rule in one
        // place), same emitter — `readOnlyBaseOverrideError` is
        // called, not copied — so the code, the status, the
        // `lockSource`, the `packageId` and the sentence cannot drift
        // between the two doors. Two independently-authored refusals
        // for one condition is how `NOT_OVERRIDABLE`-everywhere
        // started.
        //
        // THE LIMB ORDERING IS THE RULE, and it is the same ordering
        // the repository states: BELOW every registry limb, and the
        // hatch is not a limb at all.
        //   • Below the registry limb — this whole branch is guarded
        //     by {@link isSealedManagedItem}, whose type half is the
        //     registry's `allowEnvironmentOverlay` alone, so a regime-O type
        //     never reaches the door. That is ADR-0005: an overlay of
        //     a code-shipped item ALWAYS names the read-only package
        //     it customizes, and a door one limb higher would close
        //     the overlay model outright. Pinned.
        //   • [ADR-0131 D6] No hatch limb. `OS_METADATA_WRITABLE` used
        //     to take an artifact-backed write past this branch, down
        //     to the repository door, where a package-less write landed
        //     an overlay of the managed item (#8146 had narrowed that to
        //     "never a NAMED read-only base"). Managed content is sealed
        //     now — the broad reading that comment reserved for a
        //     maintainer decision is the decision ADR-0131 D6 records —
        //     so the hatch is not consulted here, and the repository
        //     refuses the same write without it.
        //
        // The named-base limb below keeps its own code: a write that
        // NAMES the read-only base answers `ITEM_LOCKED`, and a
        // package-less one `NOT_OVERRIDABLE`, with or without the hatch.
        //
        // `runtime-only` needs no limb here: this branch is guarded by
        // `artifactBacked`, so the intent is always
        // `override-artifact`. The create side of the door is the
        // ADR-0070 D1 gate further down this method, which is already
        // topology-independent and already answers
        // `WRITABLE_PACKAGE_REQUIRED` / 422 on every kernel.
        const namedBase = typeof request.packageId === 'string' && request.packageId.length > 0;
        if (namedBase && !this.isWritablePackage(request.packageId)) {
            throw SysMetadataRepository.readOnlyBaseOverrideError(
                request.type, request.packageId as string,
            );
        }
        // [#20819, ADR-0131 D6] The SENTENCE is chosen per ADR-0126 regime,
        // and names the managed package for every other type; the code and
        // the status are unchanged. [#23577] Every write reads it, whatever
        // the write meant to do: the door cannot tell a create from an edit.
        //
        // [ADR-0146 D2] On a type a declared override can replace, the
        // sentence names the fixes the writer has — the pair (or a write
        // naming no package) may declare the override from the base's paired
        // `.custom` or rename; any other package may only rename — in place
        // of the bare seal: the override write gate ({@link judgeOverrideWrite})
        // admits exactly the pair's declaration, so the seal is no longer the
        // whole story.
        // [#28412] A Regime C type the declared override opens (`flow`) names
        // the declaration in place of its clone path, keeping its switch.
        const owner = this.packagedArtifactOwner(request);
        const declare = sealedDeclareOrRenameClause(request.type, owner, request.packageId);
        const err = new Error(
            (declare === undefined ? undefined : regimeCDeclaredSaveSentence(request.type, request.name, declare))
            ?? managedItemSealedSentence(request.type, request.name, 'save')
                + sealedDeclareOrRenameTail(request.type, owner, request.packageId),
        );
        (err as any).code = 'NOT_OVERRIDABLE';
        (err as any).status = 403;
        throw err;
    }
}

/**
 * [ADR-0146 D2] The sealed write's second sentence on a type whose override
 * channel is open, chosen by who writes:
 * - the base's paired `.custom`, or a write that names no package (the
 *   administrator's package-less write, which may still move to the pair):
 *   declare the override from the pair, or rename;
 * - any other named package: rename. Only the pair declares an override
 *   (ruling A on #28390), so a dependent's one fix is a new name, and the
 *   declare advice would send it to a refusal (`declared_outside_pair`).
 *
 * Empty for a type with no open channel — `action` waits for ADR-0146 D9's
 * conditions (its regime row keeps its own routes), and an excluded type has
 * none — and when the shipping package has no pair id. [#28412] `flow` is
 * open: its sealed sentence names the declaration too.
 */
function sealedDeclareOrRenameTail(type: string, basePackageId: unknown, writerPackageId: unknown): string {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (!isOpenOverrideType(singular) || typeof basePackageId !== 'string') return '';
    const pair = customizationPackageId(basePackageId);
    if (!pair.ok) return '';
    const writer = typeof writerPackageId === 'string' && writerPackageId.length > 0 ? writerPackageId : undefined;
    if (writer !== undefined && writer !== pair.value) {
        return ` To change it, rename the item: only '${pair.value}' may declare an override of '${basePackageId}'.`;
    }
    return ` To change it, declare an override from '${pair.value}' `
        + `(overrides: { package: '${basePackageId}', basedOn }), or rename the item.`;
}

/**
 * [#28412, ADR-0146 D2] {@link sealedDeclareOrRenameTail}'s choice, as the
 * clause a Regime C sentence carries in place of its clone path
 * (`regimeCDeclaredSaveSentence`): the pair (or a write naming no package)
 * may declare from the pair or rename; any other named package may only
 * rename. `undefined` exactly where the tail is empty.
 */
function sealedDeclareOrRenameClause(type: string, basePackageId: unknown, writerPackageId: unknown): string | undefined {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (!isOpenOverrideType(singular) || typeof basePackageId !== 'string') return undefined;
    const pair = customizationPackageId(basePackageId);
    if (!pair.ok) return undefined;
    const writer = typeof writerPackageId === 'string' && writerPackageId.length > 0 ? writerPackageId : undefined;
    if (writer !== undefined && writer !== pair.value) {
        return `Rename it to customize it (only '${pair.value}' may declare an override of '${basePackageId}')`;
    }
    return `Declare an override from '${pair.value}' or rename it to customize it`;
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-0146 D2 — the override write gate (ruling A on decision card #28390)
// ─────────────────────────────────────────────────────────────────────────

/**
 * [#28412, ADR-0146 D9] The behavioural types whose D9 conditions this runtime
 * delivers, so the gate admits their declared override:
 *
 *  - `flow` — all four. Served over the code package and rebound in one reload
 *    (`@objectstack/service-automation`'s flow precedence and the flow view of
 *    this package, which admit exactly the `.custom` row
 *    `isServedOverrideRowOf` names); ledger identity inherited (the
 *    override keeps the base's name, so `packagedFlowOwner`, the toggle door,
 *    the §7.3 subflow guard and the `FLOW_DISABLED` consult key it as the
 *    base); version pinning (#28405: a suspended run finishes on the body it
 *    started on).
 *
 * ⛔ Not `action`: its override door is not cut (D9's `action` paragraph), so
 * its declaration keeps the "not yet available" refusal. A type joins this set
 * in the change that delivers its conditions, never ahead of it.
 */
const CONDITIONS_DELIVERED: ReadonlySet<string> = new Set(['flow']);

/**
 * Whether a declared override of `type` is admitted today: the closed list's
 * disposition is `overridable` AND the type waits for no ADR-0146 D9
 * condition this runtime has not delivered ({@link CONDITIONS_DELIVERED}).
 * `flow` carries `conditions` and is delivered; `action` (its door is not cut)
 * carries them and is not, so it is classified overridable and still refused
 * here. The disposition and the conditions are read from
 * `OVERRIDE_TYPE_CLASSIFICATION`, never re-derived.
 */
function isOpenOverrideType(singular: string): boolean {
    const row = getOverrideTypeClassification(singular);
    if (row?.disposition !== 'overridable') return false;
    return (row.conditions?.length ?? 0) === 0 || CONDITIONS_DELIVERED.has(singular);
}

/**
 * [#28412, ADR-0146 D9 item 1] Whether a removal addressed to `packageId`
 * removes the shipping package's PAIR row of a type whose D9 conditions are
 * delivered ({@link CONDITIONS_DELIVERED}: `flow` today) — the row the pair's
 * declared override is stored in. Such a removal is admitted past the
 * sealed-removal refusal: it removes no managed definition, and the code
 * package's flow is what every read serves and what the automation engine
 * arms once the row is gone — the narrowing direction the #6960 ruling names.
 * ⛔ Only the pair, named: a removal naming no package, or any other package,
 * keeps the sealed refusal it had. ⛔ Only a delivered type: every other open
 * type (`view`, `mapping`, …) keeps main's delete verdict — its own removal
 * carve-out or its sealed refusal — untouched by this card.
 */
export function isPairRowRemoval(type: string, basePackageId: unknown, packageId: unknown): boolean {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (!CONDITIONS_DELIVERED.has(singular) || !isOpenOverrideType(singular)) return false;
    if (typeof basePackageId !== 'string') return false;
    if (typeof packageId !== 'string' || packageId.length === 0) return false;
    const pair = customizationPackageId(basePackageId);
    return pair.ok && pair.value === packageId;
}

/**
 * [#28746, ADR-0146 D2] The bundle member an item IS, for a type whose
 * identity is a pair (`ITEM_KEY_DISCRIMINATORS`: an `email_template` is one
 * item per `(name, locale)`), the canonical member when the body declares
 * none; `undefined` for every other type, whose identity is its name alone.
 *
 * Read off the identity table the registry keys its bundles on and the read
 * side serves a member by (`findServedOverlayRow`, the layered read), never a
 * type literal. The save is BODY-addressed, so the member is the body's own.
 */
export function overrideWriteMemberOf(type: string, item: unknown): string | undefined {
    return itemDiscriminator(PLURAL_TO_SINGULAR[type] ?? type, item);
}

/**
 * [#28746, ADR-0146 D2] The identity two packages' items collide on under the
 * override write gate: `identity` (an item's name; an `action`'s
 * `<objectName>:<name>`) joined with its bundle member
 * ({@link overrideWriteMemberOf}) for a pair-identified type, and `identity`
 * unchanged for every other type.
 *
 * The ONE spelling every door that hands the gate its `shippers` compares on:
 * {@link overrideWriteItemsOf} (so `os validate` and the install door's
 * incoming items), the install door's listing of an installed package, and
 * {@link overrideWriteVerdict}'s registry lookup at the same member. A base
 * that ships a template in `en-US` alone therefore ships no `fr-FR` member: a
 * declared `fr-FR` override is refused (`declared_package_ships_no_such_item`),
 * and an undeclared `fr-FR` beside it collides with nothing.
 */
export function overrideWriteIdentityOf(type: string, identity: string, item: unknown): string {
    const member = overrideWriteMemberOf(type, item);
    return member === undefined ? identity : `${identity}\u0000${member}`;
}

/** One item written into one package — what the override write gate judges. */
export interface OverrideWriteSubject {
    /** The metadata type, either spelling (folded here). */
    readonly type: string;
    readonly name: string;
    /** The package the item is written into; absent for a package-less row. */
    readonly packageId?: string | null;
    /** The item body; its `overrides` key is the declaration. */
    readonly item?: unknown;
}

/** What the gate knows about the written package's dependency closure. */
export interface OverrideWriteClosure {
    /**
     * The packages the written package's `manifest.dependencies` reach,
     * transitively, itself excluded. `undefined` when the closure cannot be
     * read: an undeclared same name then has no base to collide with (the
     * write is not narrowed on a guess), and a declaration is NOT admitted —
     * admitting needs the base to be proven inside the closure.
     */
    readonly dependencies: readonly string[] | undefined;
    /**
     * The packages of {@link dependencies} that ship an item of this type and
     * name — for a pair-identified type, of this bundle member
     * ({@link overrideWriteIdentityOf}).
     */
    readonly shippers: readonly string[];
}

/** Which named refusal of ADR-0146 D2 / D6 / D9 / D10 a write meets. */
export type OverrideWriteRule =
    | 'undeclared_same_name'
    | 'declared_outside_pair'
    | 'declared_package_outside_closure'
    | 'declared_package_ships_no_such_item'
    | 'declared_type_not_overridable'
    | 'declared_object'
    | 'declared_type_not_yet_available';

/**
 * The gate's verdict on one write:
 * - `admit` — the base's paired `.custom` declares an override of an item
 *   `base` ships: the item is the pair's own row, and it does not edit the
 *   base's managed item, so the sealed-write refusal does not apply to it;
 * - `refuse` — one named refusal, with its sentence;
 * - `not_concerned` — no declaration and no base item of that name in the
 *   closure: every other gate answers as before.
 */
export type OverrideWriteVerdict =
    | { readonly verdict: 'admit'; readonly base: string }
    | { readonly verdict: 'refuse'; readonly rule: OverrideWriteRule; readonly message: string }
    | { readonly verdict: 'not_concerned' };

const NOT_CONCERNED: OverrideWriteVerdict = { verdict: 'not_concerned' };

/**
 * The declaration an item body carries: its `overrides` value when that value
 * is one the spec's {@link OverrideDeclarationSchema} accepts, else none.
 *
 * A malformed `overrides` (null, not an object, no `package`, a `.custom`
 * package named as the base, a missing `basedOn`, an unknown key) is NOT a
 * declaration here: the gate is not concerned with it, and the door's schema
 * gate answers it with its own `422 INVALID_METADATA` naming the key, which is
 * the fact. The gate runs before that schema gate, so judging the malformed
 * value as a declaration would answer `403 NOT_OVERRIDABLE` in its place.
 */
function declarationOf(item: unknown): { present: boolean; base: string | undefined } {
    if (item === null || typeof item !== 'object' || !('overrides' in item)) return { present: false, base: undefined };
    const declared = OverrideDeclarationSchema.safeParse((item as { overrides?: unknown }).overrides);
    if (!declared.success) return { present: false, base: undefined };
    return { present: true, base: declared.data.package };
}

/**
 * THE override write gate's rule, as a pure verdict — the one judgement the
 * publish doors (`saveMetaItem`, `publishMetaItem`, `publishPackageDrafts`),
 * `os validate` and the marketplace install door all ask, so the three gate
 * points cannot drift (ADR-0146 D2, ruling A on #28390: only the paired
 * `<base>.custom` declares an override; a dependent's same-named item has one
 * fix, rename; a dependent carrying `overrides` is refused).
 *
 * The type list and the pair predicate are N-08's (`@objectstack/spec/kernel`:
 * `OVERRIDE_TYPE_CLASSIFICATION`, `isCustomizationPairOf`), read, never
 * re-derived. `basedOn` is recorded and never judged.
 *
 * Order: a declaration is judged on its type first (D10 `object`, D6 and the
 * other excluded types, then D9's `flow` and `action`), then on who declares
 * (the pair alone), then on what it names (inside the closure, and shipping
 * that item — for a pair-identified type, that bundle member: the caller's
 * `shippers` are counted at {@link overrideWriteIdentityOf}). An undeclared item is judged only when a package of its closure
 * ships the same name, on a type a declared override applies to; outside the
 * closure two packages keep ADR-0048 §3.3/§3.4's coexistence on a bare name.
 */
export function judgeOverrideWrite(
    subject: OverrideWriteSubject,
    closure: OverrideWriteClosure,
): OverrideWriteVerdict {
    const type = PLURAL_TO_SINGULAR[subject.type] ?? subject.type;
    const { name } = subject;
    const packageId = typeof subject.packageId === 'string' && subject.packageId.length > 0
        ? subject.packageId
        : undefined;
    const item = `'${type}/${name}'`;
    const declaration = declarationOf(subject.item);
    const refuse = (rule: OverrideWriteRule, message: string): OverrideWriteVerdict =>
        ({ verdict: 'refuse', rule, message });

    if (declaration.present) {
        const row = getOverrideTypeClassification(type);
        if (row?.disposition === 'extend_only') {
            return refuse('declared_object',
                `${item} carries \`overrides\`, but an object is extended, never replaced (ADR-0146 D10). `
                + 'Remove `overrides` and add the change as an `objectExtensions` entry of the base\'s paired .custom package.');
        }
        if (row?.disposition !== 'overridable') {
            return refuse('declared_type_not_overridable',
                `${item} carries \`overrides\`, but a ${type} takes no override (ADR-0146 D6). `
                + `Remove \`overrides\` and create your own ${type} under a new name ("new similar").`);
        }
        // `action` is classified overridable and waits for D9's conditions
        // (`isOpenOverrideType`): "action customization is not yet available".
        // [#28412] `flow`'s conditions are delivered, so it is judged below
        // like every open type.
        if (!isOpenOverrideType(type)) {
            return refuse('declared_type_not_yet_available',
                `${item} carries \`overrides\`: ${type} customization is not yet available, so a declared ${type} `
                + 'override is refused (ADR-0146 D9). Remove `overrides` and rename the item.');
        }
        const base = declaration.base;
        const pair = base === undefined ? undefined : customizationPackageId(base);
        if (base === undefined || pair === undefined || !pair.ok || !isCustomizationPairOf(packageId, base)) {
            const who = packageId === undefined ? 'a row bound to no package' : `package '${packageId}'`;
            const only = pair?.ok
                ? `only '${pair.value}' may declare an override of '${base}'`
                : 'only the base\'s paired .custom package may declare an override, naming the base in `overrides.package`';
            return refuse('declared_outside_pair',
                `${item} in ${who} carries \`overrides\`, and ${only}: a dependent package never replaces a base item `
                + '(ADR-0146 D2). Remove `overrides` and rename the item.');
        }
        if (!(closure.dependencies ?? []).includes(base)) {
            return refuse('declared_package_outside_closure',
                `${item} declares an override of '${base}', which is outside the dependency closure of '${packageId}'. `
                + `Declare a dependency on '${base}' in the \`dependencies\` of '${packageId}''s manifest, or remove \`overrides\` (ADR-0146 D2).`);
        }
        if (!closure.shippers.includes(base)) {
            // [#28746] A pair-identified type names the member it addressed.
            const member = overrideWriteMemberOf(type, subject.item);
            const ofMember = member === undefined ? '' : ` with ${ITEM_KEY_DISCRIMINATORS[type]?.field} '${member}'`;
            return refuse('declared_package_ships_no_such_item',
                `${item} declares an override of '${base}', which ships no ${type} named '${name}'${ofMember}. `
                + `Remove \`overrides\` to keep it as '${packageId}''s own item, or correct the name (ADR-0146 D2).`);
        }
        return { verdict: 'admit', base };
    }

    if (packageId === undefined || closure.shippers.length === 0) return NOT_CONCERNED;
    if (getOverrideTypeClassification(type)?.disposition !== 'overridable') return NOT_CONCERNED;
    const pairBase = customizationBasePackageId(packageId);
    const base = pairBase !== null && closure.shippers.includes(pairBase) ? pairBase : closure.shippers[0];
    if (pairBase === base && isOpenOverrideType(type)) {
        return refuse('undeclared_same_name',
            `${item} in '${packageId}' bears the name of the ${type} '${base}' ships but declares no override. `
            + `Declare it, adding overrides: { package: '${base}', basedOn } with the version of '${base}' it was `
            + 'taken from, or rename the item (ADR-0146 D2).');
    }
    const notYet = pairBase === base ? ` ${type} customization is not yet available.` : '';
    return refuse('undeclared_same_name',
        `${item} in package '${packageId}' bears the name of the ${type} '${base}' ships, inside its dependency `
        + `closure.${notYet} A dependent package adds items under its own names and never replaces a base item. `
        + 'Rename the item (ADR-0146 D2).');
}

/** One item of a package body, as the override write gate names it. */
export interface OverrideWriteItem {
    /** The singular metadata type. */
    readonly type: string;
    /** The name the gate's sentence carries. */
    readonly name: string;
    /**
     * The registry identity two packages collide on: an `action` is
     * `<objectName>:<name>` (the registry's key), every other item its name,
     * and [#28746] a pair-identified type's item that joined with its bundle
     * member ({@link overrideWriteIdentityOf}).
     */
    readonly identity: string;
    /** The item body the declaration is read from. */
    readonly item: unknown;
    /** Where it sits in the body, e.g. `dashboards[0]`, prefixed by the caller's `at`. */
    readonly path: string;
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Every item a package body's collections carry, named the way the registry
 * names it — the walk `os validate` and the marketplace install door hand
 * {@link judgeOverrideWrite}, so the two cannot disagree on what an item is
 * called. A `views:` container is the views it expands into
 * (`expandViewContainer`, the loader's own expansion); an `action` is keyed
 * `<objectName>:<name>`. A collection is an array or a name-keyed map.
 */
export function overrideWriteItemsOf(body: Record<string, unknown>, at = ''): OverrideWriteItem[] {
    const out: OverrideWriteItem[] = [];
    for (const [plural, collection] of Object.entries(body)) {
        const type = (PLURAL_TO_SINGULAR as Record<string, string | undefined>)[plural];
        if (type === undefined || collection === null || typeof collection !== 'object') continue;
        const entries: Array<[string, unknown, string | undefined]> = Array.isArray(collection)
            ? collection.map((item, i): [string, unknown, string | undefined] => [`${at}${plural}[${i}]`, item, undefined])
            : Object.entries(collection).map(([key, item]): [string, unknown, string | undefined] => [`${at}${plural}.${key}`, item, key]);
        for (const [path, item, key] of entries) {
            if (!isPlainRecord(item)) continue;
            const declaredName = typeof item.name === 'string' && item.name !== '' ? item.name : key;
            if (declaredName === undefined) continue;
            if (type === 'view' && isAggregatedViewContainer(item)) {
                const object = typeof item.object === 'string' && item.object !== '' ? item.object : declaredName;
                for (const view of expandViewContainer(object, item)) {
                    out.push({ type, name: view.name, identity: view.name, item: view.config, path });
                }
                continue;
            }
            const identity = type === 'action' && typeof item.objectName === 'string' && item.objectName !== ''
                ? `${item.objectName}:${declaredName}`
                : declaredName;
            out.push({ type, name: declaredName, identity: overrideWriteIdentityOf(type, identity, item), item, path });
        }
    }
    return out;
}

/**
 * The thrown form of a `refuse` verdict: `403 NOT_OVERRIDABLE`, the code and
 * status the sealed write already answers, so no door gains a code.
 */
export function overrideWriteRefusalError(
    verdict: Extract<OverrideWriteVerdict, { verdict: 'refuse' }>,
): Error {
    const err = new Error(verdict.message);
    (err as any).code = 'NOT_OVERRIDABLE';
    (err as any).status = 403;
    return err;
}

/**
 * The body of `ObjectStackProtocolImplementation#overrideWriteVerdict`; the
 * method's docblock there is its contract. Reads the closure from the
 * registry (`resolveWritePackageScope`, the save door's own) and the shipping
 * packages from the artifact lookup (`shippedArtifactsOf`, the read's own),
 * then asks {@link judgeOverrideWrite}.
 *
 * [#28746] For a pair-identified type the lookup is at the body's bundle
 * member ({@link overrideWriteMemberOf}), and an artifact of another member is
 * no shipper: a registry that ignores `member` can answer one, as
 * `mergeArtifactProtection` guards on the read side.
 */
export function overrideWriteVerdict(
    this: Pick<PackagedBaseRefusalHost, 'isWritablePackage' | 'resolveWritePackageScope' | 'shippedArtifactsOf'>,
    request: OverrideWriteSubject,
): OverrideWriteVerdict {
    const packageId = typeof request.packageId === 'string' && request.packageId.length > 0
        ? request.packageId
        : undefined;
    const declaration = declarationOf(request.item);
    if (packageId === undefined && !declaration.present) return NOT_CONCERNED;
    const scope = packageId === undefined ? undefined : this.resolveWritePackageScope(packageId);
    // A named package the registry cannot produce is not this gate's to
    // judge: both doors ask `uninstalledNamedBaseRefusal`, which refuses a
    // write naming an uninstalled base (`WRITABLE_PACKAGE_REQUIRED`) — the
    // fact about the package, not about the item.
    if (packageId !== undefined && scope === undefined) return NOT_CONCERNED;
    const dependencies = scope?.dependencies.filter((id) => id !== packageId);
    const member = overrideWriteMemberOf(request.type, request.item);
    const shippers = dependencies === undefined || dependencies.length === 0
        ? []
        : Array.from(new Set(
            this.shippedArtifactsOf(request.type, request.name, undefined, member)
                .filter((a) => overrideWriteMemberOf(request.type, a) === member)
                .map((a) => (a as { _packageId?: unknown } | null | undefined)?._packageId)
                // An override replaces an item of an INSTALLED, read-only base
                // (ADR-0146 D1): a writable package's item is edited in place
                // (ADR-0070), so a writable shipper is no base this gate guards.
                // Every artifact a kernel serves is registered read-only
                // (`registerApp` → `manifests`), so this keeps no real base out.
                .filter((id): id is string => typeof id === 'string' && dependencies.includes(id)
                    && !this.isWritablePackage(id)),
        ));
    return judgeOverrideWrite(request, { dependencies, shippers });
}


/** The body of `ObjectStackProtocolImplementation#originGatedRemovalRefusal`; the method's docblock there is its contract. */
export function originGatedRemovalRefusal(
    this: Pick<PackagedBaseRefusalHost, 'packagedBaseRefusal'>,
    type: string, name: string): Error | null {
    if (!isOriginGatedType(type)) return null;
    return this.packagedBaseRefusal({ type, name, operation: 'delete' });
}
