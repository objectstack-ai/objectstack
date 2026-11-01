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
import { isOriginGatedType, managedItemSealedSentence } from './packaged-base-regime.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';
import {
    customizationBasePackageId,
    customizationPackageId,
    getOverrideTypeClassification,
    isCustomizationPairOf,
} from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

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
        // sentence names the two fixes the author has — declare the override
        // from the base's paired `.custom`, or rename — in place of the bare
        // seal: the override write gate ({@link judgeOverrideWrite}) admits
        // exactly that declaration, so the seal is no longer the whole story.
        const err = new Error(
            managedItemSealedSentence(request.type, request.name, 'save')
            + sealedDeclareOrRenameTail(request.type, this.packagedArtifactOwner(request)),
        );
        (err as any).code = 'NOT_OVERRIDABLE';
        (err as any).status = 403;
        throw err;
    }
}

/**
 * [ADR-0146 D2] The sealed write's second sentence on a type whose override
 * channel is open: declare the override from the base's paired `.custom`, or
 * rename. Empty for a type with no open channel — `flow` and `action` wait for
 * ADR-0146 D9's conditions (their regime rows keep their own routes), and an
 * excluded type has none — and when the shipping package has no pair id.
 */
function sealedDeclareOrRenameTail(type: string, basePackageId: unknown): string {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (!isOpenOverrideType(singular) || typeof basePackageId !== 'string') return '';
    const pair = customizationPackageId(basePackageId);
    if (!pair.ok) return '';
    return ` To change it, declare an override from '${pair.value}' `
        + `(overrides: { package: '${basePackageId}', basedOn }), or rename the item.`;
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-0146 D2 — the override write gate (ruling A on decision card #28390)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Whether a declared override of `type` is admitted today: the closed list's
 * disposition is `overridable` AND the type waits for no ADR-0146 D9
 * condition. `flow` (D9 conditions, opened by its own card in this same gate)
 * and `action` (its ledger switch first; refused for the whole epic) carry
 * `conditions`, so they are classified overridable and still refused here.
 * Read from `OVERRIDE_TYPE_CLASSIFICATION`, never re-derived.
 */
function isOpenOverrideType(singular: string): boolean {
    const row = getOverrideTypeClassification(singular);
    return row?.disposition === 'overridable' && (row.conditions?.length ?? 0) === 0;
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
    /** The packages of {@link dependencies} that ship an item of this type and name. */
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
    | 'declared_flow_not_yet_available'
    | 'declared_action_not_yet_available';

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

/** The `overrides` value an item body carries, or `undefined` when it carries none. */
function declarationOf(item: unknown): { present: boolean; base: string | undefined } {
    if (item === null || typeof item !== 'object' || !('overrides' in item)) return { present: false, base: undefined };
    const declared = (item as { overrides?: unknown }).overrides;
    if (declared === undefined) return { present: false, base: undefined };
    const base = declared !== null && typeof declared === 'object'
        ? (declared as { package?: unknown }).package
        : undefined;
    return { present: true, base: typeof base === 'string' && base.length > 0 ? base : undefined };
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
 * that item). An undeclared item is judged only when a package of its closure
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
        if (type === 'flow') {
            return refuse('declared_flow_not_yet_available',
                `${item} carries \`overrides\`: flow customization is not yet available, so a declared flow `
                + 'override is refused (ADR-0146 D9). Remove `overrides` and rename the item.');
        }
        if (!isOpenOverrideType(type)) {
            return refuse('declared_action_not_yet_available',
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
            return refuse('declared_package_ships_no_such_item',
                `${item} declares an override of '${base}', which ships no ${type} named '${name}'. `
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
    const shippers = dependencies === undefined || dependencies.length === 0
        ? []
        : Array.from(new Set(
            this.shippedArtifactsOf(request.type, request.name)
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
