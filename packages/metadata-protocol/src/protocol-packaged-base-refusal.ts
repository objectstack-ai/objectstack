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
import {
    isOriginGatedType,
    managedItemSealedSentence,
    packagedBaseRegimePrescription,
    packagedBaseRegimeRow,
    regimeCDeclaredSaveSentence,
} from './packaged-base-regime.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';
import { OBJECT_EXTENSION_TYPE } from './protocol-object-extension-item.js';
import { customizationPairEnsureRefusal, type PairRegistry } from './protocol-customization-package.js';
import { resolveOverlaySchema } from './protocol-meta-type-schema.js';
import { resolvePackageClosure } from '@objectstack/lint/runtime';
import { overlayMemberField, overlayMemberOfBody, overlayMemberValue } from './migrations/overlay-index.js';
import {
    customizationBasePackageId,
    DEFAULT_METADATA_TYPE_REGISTRY,
    getOverrideTypeClassification,
    OverrideDeclarationSchema,
    type OverrideClassificationBasis,
} from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec';
import { ITEM_KEY_DISCRIMINATORS, isPairOf, itemDiscriminator, pairOf } from '@objectstack/metadata-core';

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
        //     never reaches the door. That was ADR-0005: an overlay of
        //     a code-shipped item ALWAYS named the read-only package
        //     it customizes, and a door one limb higher would have closed
        //     the overlay model outright. Pinned. [#28905, ADR-0146 D1]
        //     Such an overlay now lands in the base's paired `.custom`:
        //     an authoring write naming the read-only base of one of the
        //     five types is refused by its own close
        //     ({@link namedBaseCloseSubject}), never by this door.
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
 * Empty for a type with no open channel — an excluded type has none — and
 * when the shipping package has no pair id. [#28412] `flow` is open: its
 * sealed sentence names the declaration too, and so, [#30065], does `action`'s.
 */
function sealedDeclareOrRenameTail(type: string, basePackageId: unknown, writerPackageId: unknown): string {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (!isOpenOverrideType(singular) || typeof basePackageId !== 'string') return '';
    const pair = pairOf(basePackageId);
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
    const pair = pairOf(basePackageId);
    if (!pair.ok) return undefined;
    const writer = typeof writerPackageId === 'string' && writerPackageId.length > 0 ? writerPackageId : undefined;
    if (writer !== undefined && writer !== pair.value) {
        return `Rename it to customize it (only '${pair.value}' may declare an override of '${basePackageId}')`;
    }
    return `Declare an override from '${pair.value}' or rename it to customize it`;
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-0146 D11 — the package-less write onto a packaged item is closed
// ─────────────────────────────────────────────────────────────────────────

/** The write a {@link packagelessOverlayWriteRefusal} judges: the four package-less writes ADR-0146 D11 closes. */
export type PackagelessWriteOperation = 'save' | 'publish' | 'delete' | 'rollback';

/**
 * The refusal `ObjectStackProtocolImplementation#packagelessOverlayWriteRefusal`
 * throws; the method's docblock there is its contract.
 *
 * [ADR-0146 D11] A write naming no package (`packageId` absent, `null` or
 * empty) onto an item of one of the five overlay types that one read-only code
 * package ships, whose row `os migrate packageless-overlays` would move into
 * the base's pair (`packagelessCloseSubject`, the ceremony's own reading), is
 * refused `403 NOT_OVERRIDABLE` — the code and status the sealed write already
 * answers, so no door gains a code. Every row the ceremony leaves keeps its
 * package-less write, so the sentence's two doors are always open: the pair
 * (`?package=<base>.custom`), where the customization is a declared override,
 * and the ceremony, which moves a row stored before the close there. Such a
 * row is still served until it is moved (the read path is not this
 * function's); only its package-less write is refused.
 *
 * The fix first, then the rule and the ceremony: the REST door bounds a
 * refusal's text (`CLIENT_MESSAGE_MAX`, 500 characters, `@objectstack/types`),
 * and the metadata item page shows that text as sent.
 */
export function packagelessOverlayWriteRefusal(
    request: { type: string; name: string },
    closed: { base: string; pair: string },
    operation: PackagelessWriteOperation,
): Error {
    const { item, shipped, pair, declared, writeInto, ceremony } = closedOverlayWriteClauses(request, closed);
    const rule = `A write naming no package is closed where ${ceremony} can move its row `
        + `(ADR-0146 D11); a package-less row stored before it is served until that command moves it into '${closed.pair}'.`;
    const message = operation === 'rollback'
        ? `${item} ${shipped}, and a rollback of its package-less row is closed (ADR-0146 D11): run `
            + `${ceremony} to move the row into ${pair}; to restore a version from before `
            + `the move, save that version's body there, declaring ${declared}.`
        : operation === 'delete'
            ? `${item} ${shipped}: remove its customization from ${pair}. ${rule}`
            : `${writeInto(operation)} ${rule}`;
    return closedOverlayWriteError(message);
}

/**
 * The clauses both closes of an overlay write onto a packaged item spell
 * ({@link packagelessOverlayWriteRefusal}, {@link namedBaseOverlayWriteRefusal}):
 * the item, the base that ships it, the pair (with its `?package=` address),
 * the declaration, and the fix — write it into the pair, declaring the
 * override. ONE spelling: a writer refused at either address reads the same
 * fix, and only the rule clause that follows it says which address is closed.
 *
 * Two more clauses, one spelling each: `ceremony`, the command that moves a
 * stored row into the pair (both sentences name it), and `boundRowServed`,
 * what serves a row bound to the base stored before the close until one of
 * the three open doors acts on it — [#29392] that command, which moves it
 * into the pair with its declaration, the pair's declared override, or a
 * delete naming the base.
 */
function closedOverlayWriteClauses(
    request: { type: string; name: string },
    closed: { base: string; pair: string },
) {
    const type = PLURAL_TO_SINGULAR[request.type] ?? request.type;
    const item = `'${type}/${request.name}'`;
    const shipped = `ships in '${closed.base}'`;
    const pair = `'${closed.pair}' (?package=${closed.pair})`;
    const declared = `overrides: { package: '${closed.base}', basedOn }`;
    const writeInto = (operation: 'save' | 'publish') =>
        `${item} ${shipped}: ${operation === 'publish' ? 'publish' : 'save'} it into ${pair}, declaring ${declared}.`;
    const ceremony = '`os migrate packageless-overlays`';
    const boundRowServed = `is served until moved by ${ceremony}, overridden by the pair, or deleted naming the base.`;
    return { item, shipped, pair, declared, writeInto, ceremony, boundRowServed };
}

/** `403 NOT_OVERRIDABLE`, the code and status the sealed write already answers, so neither close gains a code. */
function closedOverlayWriteError(message: string): Error {
    const err = new Error(message);
    (err as any).code = 'NOT_OVERRIDABLE';
    (err as any).status = 403;
    return err;
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-0146 D1 / D11 — the write naming the read-only base itself is closed
// ─────────────────────────────────────────────────────────────────────────

/**
 * The writes {@link namedBaseOverlayWriteRefusal} judges: the three that land
 * a row bound to the base. `rollback` is every restore of a stored version:
 * the per-item rollback and [#29390] a commit revert's restore limb (and the
 * package rollback through it), one sentence for both. ⛔ Not `delete`:
 * removing a row bound to the base writes nothing, and it is one way to clear
 * such a row stored before the close; [#29392] `os migrate packageless-overlays`
 * is the other, moving it into the pair with its declaration. The removal
 * serves the base's own document again, or the pair's declared override where
 * one exists (it is served over the row).
 */
export type NamedBaseWriteOperation = Exclude<PackagelessWriteOperation, 'delete'>;

/**
 * The refusal `ObjectStackProtocolImplementation#namedBaseOverlayWriteRefusal`
 * throws; the method's docblock there is its contract.
 *
 * [#28905, ADR-0146 D1, D11] An authoring write that names the read-only code
 * package itself (`?package=<base>`) onto an item of one of the five overlay
 * types that package ships stored the customization as a row bound to the
 * base, with no declaration: served at the base's address in place of its
 * document, outside the pair D1 puts every customization in. It is refused
 * with the fix the package-less close names ({@link closedOverlayWriteClauses}):
 * write it into the pair, declaring the override. A row stored that way before
 * the close is still served until one of three open doors acts on it, all
 * named in the sentence ({@link closedOverlayWriteClauses}' `boundRowServed`):
 * [#29392] `os migrate packageless-overlays` moves it into the pair with its
 * declaration, the pair declares the override (served over it), or a delete
 * naming the base removes it.
 *
 * Fix first, under the REST door's 500-character bound (`CLIENT_MESSAGE_MAX`,
 * `@objectstack/types`), as the package-less sentence.
 */
export function namedBaseOverlayWriteRefusal(
    request: { type: string; name: string },
    closed: { base: string; pair: string },
    operation: NamedBaseWriteOperation,
): Error {
    const { item, shipped, pair, declared, writeInto, boundRowServed } = closedOverlayWriteClauses(request, closed);
    const message = operation === 'rollback'
        ? `${item} ${shipped}, and a rollback of its row bound to the read-only base is closed (ADR-0146 D1, D11): `
            + `save the version's body into ${pair}, declaring ${declared}. It ${boundRowServed}`
        : `${writeInto(operation)} The read-only base itself takes no customization (ADR-0146 D1, D11): `
            + `a row bound to it ${boundRowServed}`;
    return closedOverlayWriteError(message);
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-0146 D1, D11 — "the fix the close names can be taken": one predicate
// ─────────────────────────────────────────────────────────────────────────

/** The pair an overlay-write close sends the write into, and the `basedOn` its declaration records. */
export interface OverlayPairFix {
    readonly base: string;
    readonly pair: string;
    readonly basedOn: string;
    /**
     * The closure the pair WILL have, present only while the pair is not
     * installed: the ensure door declares the pair's one dependency, the base
     * (`manifest.dependencies: { [base]: range }`), so its closure is the base
     * and what the base reaches. The gate's own read
     * (`resolveWritePackageScope`) answers nothing for a package the registry
     * cannot produce, and its `not_concerned` on a declared body is no verdict
     * about the write the fix takes.
     */
    readonly pendingPairScope?: WrittenPackageScope;
}

/** A written package and the closure of its declared dependencies, as `resolveWritePackageScope` answers it. */
export interface WrittenPackageScope {
    readonly packageId: string;
    readonly dependencies: readonly string[];
}

/**
 * The override write gate as a close asks it: {@link overrideWriteVerdict},
 * with the written package's closure when the caller holds it (a pair the
 * ensure step would create, {@link OverlayPairFix.pendingPairScope}).
 */
export type OverrideWriteVerdictAsk = (request: OverrideWriteSubject, writtenScope?: WrittenPackageScope) => OverrideWriteVerdict;

/**
 * [ADR-0146 D1, D11] The registry half of whether the fix both overlay-write
 * closes name — write it into `base`'s pair, declaring the override — can be
 * taken, or `null` when it cannot: read from the steps that write takes.
 *
 *  - the base has a pair id ({@link pairOf}; an id ending in
 *    `.custom` has none);
 *  - the ensure door would answer or create the pair
 *    ({@link customizationPairEnsureRefusal});
 *  - the base records a version (`basedOn`, its `manifest.version`, the value
 *    the ceremony records too).
 *
 * The other half is {@link overlayPairFixAdmits}, the override write gate on
 * the declared body. Two halves of one predicate so that a close may read its
 * own subject between them — the package-less close reads the item's stored
 * rows only for a name the registry has not already left open — and ⛔ each
 * close keeps only its own difference: which base it judges, and which body.
 * {@link namedBaseCloseSubject} and `packagelessCloseSubject`
 * (`protocol-packageless-overlay-migration.ts`) ask both. Registry reads only.
 */
export function overlayPairFixOf(
    host: { readonly engine: ObjectStackProtocolImplementation['engine'] },
    base: string,
): OverlayPairFix | null {
    const pairId = pairOf(base);
    if (!pairId.ok) return null; // no pair to name (the census's `no_pair`)
    const pair = pairId.value;
    const registry = (host.engine as { registry?: PairRegistry } | undefined)?.registry;
    if (!registry || typeof registry.getPackage !== 'function') return null;
    if (customizationPairEnsureRefusal(host.engine, registry, base, pair) !== undefined) return null; // the ensure door would refuse
    const basedOn = registry.getPackage(base)?.manifest?.version;
    if (typeof basedOn !== 'string' || basedOn === '') return null; // no `basedOn` to declare
    if (registry.getPackage(pair)) return { base, pair, basedOn };
    // The pair the ensure door would create: one dependency, the base.
    const baseClosure = resolvePackageClosure(base, (id) => registry.getPackage(id) as { manifest?: unknown } | undefined);
    const dependencies = [base, ...(baseClosure?.dependencies ?? []).filter((id) => id !== pair)];
    return { base, pair, basedOn, pendingPairScope: { packageId: pair, dependencies } };
}

/**
 * [ADR-0146 D1, D2, D11] The gate half of {@link overlayPairFixOf}: whether
 * the override write gate admits the body the fix writes into the pair — the
 * close's `body` (a save's, or the stored row's), else the item's bare
 * identity at `member`, declaring `overrides: { package: base, basedOn }`. An
 * `email_template` member at a locale the base does not ship is refused
 * there, so its write stays open.
 *
 * The gate is asked about the pair the fix writes into, installed or not: a
 * pair not yet ensured (a fresh install) is judged with the closure the
 * ensure door gives it ({@link OverlayPairFix.pendingPairScope}), so the
 * answer is the one the write meets once the pair exists.
 */
export function overlayPairFixAdmits(
    host: { readonly overrideWriteVerdict: OverrideWriteVerdictAsk },
    fix: OverlayPairFix,
    subject: {
        /** The singular type. */
        readonly type: string;
        readonly name: string;
        readonly body: Record<string, unknown> | undefined;
        /** The bundle member, as `OVERLAY_MEMBER_COLUMN` holds it. */
        readonly member: string | null | undefined;
    },
): boolean {
    const { type, name, body, member } = subject;
    const disc = member === undefined ? undefined : overlayMemberField(type);
    const declaredBody = {
        ...(body ?? { name, ...(disc && member !== null ? { [disc]: member } : {}) }),
        overrides: { package: fix.base, basedOn: fix.basedOn },
    };
    // [#30261] The save door's schema half: a body whose shape cannot carry
    // the declaration (a view container) is refused there, whatever the gate
    // answers. A bare identity has no shape to judge.
    if (body !== undefined && overrideDeclarationRefusedByShape(type, body)) return false;
    const verdict = host.overrideWriteVerdict({ type, name, packageId: fix.pair, item: declaredBody }, fix.pendingPairScope);
    return verdict.verdict !== 'refuse';
}

/**
 * [#30261, ADR-0146 D2, D11] Whether the schema the save door judges `body`
 * by (`resolveOverlaySchema`, the door's own resolver) refuses an `overrides`
 * key on it as unrecognized: the body's SHAPE cannot carry the override
 * declaration, so no save declaring it lands, whatever the override write gate
 * answers.
 *
 * Measured over the five overlay types the ceremony moves, one shape answers
 * `true`: the view CONTAINER (`ViewSchema`, the `container` member of
 * `ViewMetadataSchema`). A single view, a list or form overlay, a dashboard, a
 * report, a translation and an email template each spread
 * `OverrideDeclarationFields`. Read from the parse, not from a list of shapes,
 * so a member that gains or loses the key is answered by its own schema.
 *
 * Only the refusal of the KEY is read: an `unrecognized_keys` issue naming
 * `overrides` at the body's root. Inside a union it must be named by EVERY
 * branch still diagnosing the body — the view union keeps the branch the body
 * claims and mutes the others to a kind mismatch at the root
 * (`focusClaimedBranch`), which is dropped here as every consumer of a failed
 * union drops it — so a body that claims no branch, refused by the container
 * member and by a member that carries the key, is not answered `true`. Every
 * other finding on the body is the save door's to answer, as before, and
 * answers `false` here. The body's own `overrides` value, if any, is replaced
 * by a well-formed probe: the key alone decides.
 */
export function overrideDeclarationRefusedByShape(type: string, body: Record<string, unknown>): boolean {
    const schema = resolveOverlaySchema(type, body);
    if (!schema) return false;
    const parsed = schema.safeParse({ ...body, overrides: OVERRIDES_KEY_PROBE });
    return !parsed.success && parsed.error.issues.some(namesOverridesAtRoot);
}

/** A well-formed declaration: the probe asks whether the KEY is carried, so its value raises nothing. */
const OVERRIDES_KEY_PROBE = Object.freeze({ package: 'com.example.base', basedOn: '1.0.0' });

type ParseIssue = { code?: unknown; path?: unknown; keys?: unknown; errors?: unknown } | null;

/** An issue at the parsed value's root: a `path` of length 0. */
const atRoot = (issue: ParseIssue): boolean => Array.isArray(issue?.path) && issue.path.length === 0;

/**
 * An `unrecognized_keys` issue naming `overrides` at the parsed body's root;
 * for a union, named by every branch whose issues are not a bare kind
 * mismatch at the root (a muted branch, or a member of another kind).
 */
function namesOverridesAtRoot(issue: unknown): boolean {
    const candidate = issue as ParseIssue;
    if (candidate?.code === 'unrecognized_keys') {
        return atRoot(candidate) && Array.isArray(candidate.keys) && candidate.keys.includes('overrides');
    }
    if (candidate?.code === 'invalid_union' && Array.isArray(candidate.errors)) {
        const diagnosing = candidate.errors.filter((branch): branch is unknown[] => Array.isArray(branch)
            && !branch.every((i) => (i as ParseIssue)?.code === 'invalid_type' && atRoot(i as ParseIssue)));
        return diagnosing.length > 0 && diagnosing.every((branch) => branch.some(namesOverridesAtRoot));
    }
    return false;
}

/** The class members {@link namedBaseCloseSubject} reads, typed as the class declares them. */
export interface NamedBaseCloseHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    /** The read-only code packages that ship a name of an overlay type ([] for any other type). */
    readonly overlayBaseShippers: (type: string, name: string) => string[];
    /** The override write gate, as the declared write into the pair meets it at the save door. */
    readonly overrideWriteVerdict: OverrideWriteVerdictAsk;
}

/** The write naming a package that {@link namedBaseCloseSubject} judges. */
export interface NamedBaseWriteSubject {
    readonly type: string;
    readonly name: string;
    /** The package the write names; only a non-empty one is judged here (none is #28576's close). */
    readonly packageId?: string | null;
    /** The bundle member as the caller names it; absent, the body's member, else the canonical one. */
    readonly member?: string;
    /** A save's body. */
    readonly item?: unknown;
}

/**
 * [#28905, ADR-0146 D1, D11] The base and pair a write naming a package is
 * closed onto, or `null` when it stays open. Closed exactly where the write
 * names a READ-ONLY code package that ships the item, on one of the five
 * overlay types — the package-less close's reading of "packaged"
 * (`overlayBaseShippers`, the reading `os migrate packageless-overlays`
 * classifies by), with the named package among the shippers — and where the
 * fix the refusal names can be taken: {@link overlayPairFixOf} and
 * {@link overlayPairFixAdmits}, the predicate the package-less close asks too
 * (a pair id, the ensure door, a base version, the override write gate
 * admitting the declared body — an `email_template` member at a locale the
 * base does not ship stays open, as the package-less one does).
 *
 * This close's own difference: it reads no row (the declared body is the
 * save's, else the item's identity), and the named package may be one of
 * several shippers.
 *
 * A body carrying `overrides` is not judged here: the D2 gate answers a
 * declaration outside the pair, the schema gate a malformed one, as before.
 *
 * So every write this closes has a door, the pair; every other one keeps the
 * write it has on `main`. A writable package, a package that does not ship the
 * name (ADR-0070 D1's `WRITABLE_PACKAGE_REQUIRED` answers a new item in a
 * read-only one) and every other type are not this close's. Registry reads
 * only: it reads no row.
 */
export function namedBaseCloseSubject(
    this: NamedBaseCloseHost,
    request: NamedBaseWriteSubject,
): { base: string; pair: string } | null {
    const base = typeof request.packageId === 'string' && request.packageId.length > 0 ? request.packageId : undefined;
    if (base === undefined) return null; // the package-less write: #28576's close
    // A body carrying `overrides` keeps its answer: the D2 gate refuses a
    // declaration outside the pair (`declared_outside_pair`), the schema gate
    // a malformed one (`422 INVALID_METADATA`).
    if (isPlainRecord(request.item) && 'overrides' in request.item) return null;
    if (!this.overlayBaseShippers(request.type, request.name).includes(base)) return null;
    const fix = overlayPairFixOf(this, base);
    if (fix === null) return null;

    // The gate's verdict on the declared body, written into the pair.
    const type = PLURAL_TO_SINGULAR[request.type] ?? request.type;
    const written = isPlainRecord(request.item) ? request.item : undefined;
    const member = written !== undefined && request.member === undefined
        ? overlayMemberOfBody(type, written)
        : overlayMemberValue(type, request.member);
    if (!overlayPairFixAdmits(this, fix, { type, name: request.name, body: written, member })) return null;
    return { base, pair: fix.pair };
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
 *  - [#30065] `action` — conditions 1–3 (D9's `action` paragraph; condition 4
 *    does not apply, an action has no suspended run). Served over the code
 *    package's name: every read that serves the name — the by-name and
 *    execution reads, the lists, the layered read's `effective`, and the
 *    object read's `actions` the console draws the list toolbar, row menu and
 *    record header from — serves the `.custom` row `isServedOverrideRowOf`
 *    names, under the base's envelope, and the run doors resolve that
 *    declaration. Rebound in one reload: `@objectstack/objectql`'s authored
 *    action resync binds the override's body over the base's handler and
 *    restores the base's when the override is removed, in one step. One
 *    ledger row for the name: the activation ledger keys an action by name
 *    alone, and the served override carries the base's envelope, so the
 *    switch and its row's package are the base's whichever definition is
 *    armed. Its declaration may not widen who may run it
 *    ({@link actionOverrideWidening}).
 *
 * A type joins this set in the change that delivers its conditions, never
 * ahead of it.
 */
const CONDITIONS_DELIVERED: ReadonlySet<string> = new Set(['flow', 'action']);

/**
 * Whether a declared override of `type` is admitted today: the closed list's
 * disposition is `overridable` AND the type waits for no ADR-0146 D9
 * condition this runtime has not delivered ({@link CONDITIONS_DELIVERED}).
 * `flow` and `action` carry `conditions` and are delivered. The disposition
 * and the conditions are read from
 * `OVERRIDE_TYPE_CLASSIFICATION`, never re-derived.
 */
function isOpenOverrideType(singular: string): boolean {
    const row = getOverrideTypeClassification(singular);
    if (row?.disposition !== 'overridable') return false;
    return (row.conditions?.length ?? 0) === 0 || CONDITIONS_DELIVERED.has(singular);
}

/**
 * [#28412, ADR-0146 D9 item 1] Whether a removal addressed to `packageId`
 * removes the shipping package's PAIR row of a type whose declared override
 * the gate admits today ({@link isOpenOverrideType}) — the row the pair's
 * declared override is stored in. Such a removal is admitted past the
 * sealed-removal refusal: it removes no managed definition, and the code
 * package's item is what every read serves (for a flow, what the automation
 * engine arms) once the row is gone — the narrowing direction the #6960
 * ruling names, and ADR-0146's revert ("Restore package original" deletes the
 * overriding item from `.custom`, so the base's document is served again).
 *
 * [#30062] Every open type, no longer `flow` alone. A `doc` or `mapping`
 * opens no overlay channel and is no `supportsOverlay` type either, so the
 * sealed-removal refusal answered a pair's own removal of its declared
 * override with 403 and the override stayed served: a customization the
 * customer could not undo. The other open types already passed (their own
 * overlay channel or the #6960 carve-out); the removal is now told to the
 * store as runtime-only for all of them, as the declared save wrote the row.
 *
 * ⛔ Only the pair, named: a removal naming no package, the base, or any
 * other package, keeps the refusal it had — a base's own item is never
 * removed. ⛔ Only an open type: every excluded type keeps main's delete
 * verdict. [#30065] `action` is open, so a pair's removal of its declared
 * action override is admitted and the base's action is served again.
 */
export function isPairRowRemoval(type: string, basePackageId: unknown, packageId: unknown): boolean {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (!isOpenOverrideType(singular)) return false;
    if (typeof basePackageId !== 'string') return false;
    if (typeof packageId !== 'string' || packageId.length === 0) return false;
    const pair = pairOf(basePackageId);
    return pair.ok && pair.value === packageId;
}

/**
 * [#30065, ADR-0146 D9, ADR-0066 D4] What a declared `action` override would
 * widen about who may run the action, as one clause per widened gate — empty
 * when it widens nothing, or when the base's action is not in hand
 * ({@link OverrideWriteClosure.baseItemOf}).
 *
 * The override replaces the base's action whole (D2), so every key the run
 * doors read is the override's. Three of them decide WHO may run it, and the
 * override may only keep or tighten each:
 *
 *  - `requiredPermissions` — the capability gate the REST and MCP action
 *    doors answer 403 with: every capability the base requires stays
 *    required (adding one is allowed);
 *  - `ai.exposed` — the MCP surface's opt-in: an action the base keeps off
 *    the agent surface stays off it;
 *  - `ai.requiresConfirmation` — the human-confirmation gate an agent call
 *    answers 428 with: a base that declares it keeps it.
 *
 * What runs (`type`, `target`, `body`, `operation`, `patch`, `params`) and how
 * it is drawn (`label`, `visible`, `disabled`, `locations`) are replaced
 * whole: those change what the people who may already run the action get,
 * never who they are. `visible`, `disabled` and the keys lowered into
 * `visible` are rendering predicates no run door reads, so they gate nothing.
 */
export function actionOverrideWidening(baseItem: unknown, overrideItem: unknown): string[] {
    if (!isPlainRecord(baseItem)) return [];
    const override = isPlainRecord(overrideItem) ? overrideItem : {};
    const capabilities = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((c): c is string => typeof c === 'string') : [];
    const kept = new Set(capabilities(override.requiredPermissions));
    const dropped = capabilities(baseItem.requiredPermissions).filter((c) => !kept.has(c));
    const aiOf = (item: Record<string, unknown>): Record<string, unknown> => (isPlainRecord(item.ai) ? item.ai : {});
    const baseAi = aiOf(baseItem);
    const overrideAi = aiOf(override);
    const out: string[] = [];
    if (dropped.length > 0) {
        out.push(`it drops ${dropped.map((c) => `'${c}'`).join(', ')} from \`requiredPermissions\``);
    }
    if (baseAi.exposed !== true && overrideAi.exposed === true) {
        out.push('it sets `ai.exposed: true` on an action the base keeps off the agent surface');
    }
    if (baseAi.requiresConfirmation === true && overrideAi.requiresConfirmation !== true) {
        out.push('it drops `ai.requiresConfirmation: true`');
    }
    return out;
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

/**
 * [#30542] The object an `action` item is keyed on under the override write
 * gate — its `objectName`, `''` when it names none: the first half of the
 * `<objectName>:<name>` identity {@link overrideWriteItemsOf} gives it, and
 * what {@link overrideWriteVerdict} matches a declared override's base on.
 */
function overrideWriteActionObjectOf(item: unknown): string {
    const objectName = isPlainRecord(item) ? item.objectName : undefined;
    return typeof objectName === 'string' ? objectName : '';
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
    /**
     * [#30065] The item a shipping base ships under this name (for a
     * pair-identified type, at this bundle member), read by the door that
     * knows it — the protocol's artifact lookup, the artifact `os validate`
     * walks, the install door's listing. The gate reads it for one question
     * only: whether a declared `action` override widens who may run the
     * action ({@link actionOverrideWidening}). `undefined` when the door does
     * not hold the base's item (an `os validate` artifact that names a base it
     * does not carry): that question is then the publish door's, which always
     * holds it.
     */
    readonly baseItemOf?: (basePackageId: string) => unknown;
    /**
     * [#30623] The items of this type a base ships, at any object — read by
     * the door that holds them (the protocol's artifact lookup, the artifact
     * `os validate` walks, the install door's listing). The gate reads it for
     * one sentence only: when a declared `action` override names a base that
     * ships no action of that name on the override's object, the
     * `declared_package_ships_no_such_item` refusal names the object(s) the
     * base does ship it on ({@link shipsNoSuchItemMessage}). Absent, or
     * answering none of that name, the refusal reads as before.
     */
    readonly baseItemsOf?: (basePackageId: string) => readonly unknown[];
}

/** [#28834] The item door an `object_extension` is saved through (#28574), as the refusals name it. */
const OBJECT_EXTENSION_ITEM_DOOR = '`/api/v1/meta/object_extension`';

/** Which named refusal of ADR-0146 D2 / D6 / D9 / D10 a write meets. */
export type OverrideWriteRule =
    | 'undeclared_same_name'
    | 'declared_outside_pair'
    | 'declared_package_outside_closure'
    | 'declared_package_ships_no_such_item'
    | 'declared_type_not_overridable'
    | 'declared_object'
    | 'declared_type_not_yet_available'
    | 'declared_action_widens_access';

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
 * [#30062] The decision record each excluded type's basis rests on: the one
 * the refusal of a declared override of that type cites. Before, every
 * excluded type cited ADR-0146 D6, the security catalog's paragraph, whatever
 * excluded it.
 */
const EXCLUSION_BASIS_CITATION: Readonly<Record<OverrideClassificationBasis, string>> = {
    adr_0146_d2_listed: 'ADR-0146 D2',
    adr_0146_d6_security_catalog: 'ADR-0146 D6',
    adr_0146_d10_extended: 'ADR-0146 D10',
    adr_0126_code_only: 'ADR-0146 D6',
    not_package_shipped: 'ADR-0146 D2',
    not_runtime_creatable: 'ADR-0146 D2',
    adr_0126_one_shot: 'ADR-0126 §3',
    setup_owned_connection: 'ADR-0146 D1',
    behavioural_switch_first: 'ADR-0146 D9',
};

/**
 * [#30062] The Setup page an organization authors its OWN item of an
 * excluded type on, for a type no metadata door creates and no ADR-0126
 * regime row routes: a queue is a `sys_queue` record (ADR-0142 D1), listed at
 * Setup › Queues (`@objectstack/plugin-sharing`'s navigation contribution).
 */
const SETUP_AUTHORED_DOORS: Readonly<Record<string, string>> = {
    queue: 'Setup › Queues',
};

/** `type`'s registry entry admits a runtime create (`allowRuntimeCreate`), read on the canonical type. */
function admitsRuntimeCreate(type: string): boolean {
    return DEFAULT_METADATA_TYPE_REGISTRY.some((e) => e.type === type && e.allowRuntimeCreate === true);
}

/**
 * [#30062] The remedy a declared override of an excluded `type` is told: one
 * that works for that type, read from the facts that decide whether it does,
 * in this order, never from a sentence shared by every excluded type:
 *
 *  1. a Setup-owned connection (`datasource`, ADR-0146 D1): Setup › Datasources;
 *     a `field`: its object's extension in the pair (ADR-0146 D10);
 *  2. a type the metadata door creates (`allowRuntimeCreate`): the customer's
 *     own item under a new name, "new similar" (D6's remedy for its catalog);
 *  3. a type with an ADR-0126 Regime C row: that row's sanctioned path, the
 *     sentence every other door of the type names (`sharing_rule`: an
 *     organization rule, `POST /sharing/rules`, which Setup › Sharing Rules
 *     lists, or the switch);
 *  4. a type an organization authors as a Setup record ({@link SETUP_AUTHORED_DOORS});
 *  5. else the type is defined only in package source: it changes with a new
 *     version of the package that ships it.
 *
 * Before, every excluded type was told to "create your own TYPE under a new
 * name", and for a type with no runtime create (a sharing rule, a queue, a
 * code-only type) that create answered 403 `NOT_CREATABLE`.
 */
function excludedTypeRemedy(type: string, base: string | undefined): string {
    if (getOverrideTypeClassification(type)?.basis === 'setup_owned_connection') {
        return `Remove \`overrides\`: ${articleFor(type)} ${type} is the environment's own connection and does not travel in a package. `
            + 'Add your own under a new name in Setup › Datasources.';
    }
    if (type === 'field') {
        // ADR-0146 D10: a base field changes through its object's extension, never on its own.
        return 'Remove `overrides` and change the field through an object extension in the base\'s paired .custom package '
            + `(ADR-0146 D10): an \`object_extension\` item saved through ${OBJECT_EXTENSION_ITEM_DOOR} adds a field, or changes a base field within the display-property whitelist.`;
    }
    if (admitsRuntimeCreate(type)) {
        return `Remove \`overrides\` and create your own ${type} under a new name ("new similar").`;
    }
    if (packagedBaseRegimeRow(type)?.regime === 'C') {
        return `Remove \`overrides\`. ${packagedBaseRegimePrescription(type)}`;
    }
    const setup = Object.prototype.hasOwnProperty.call(SETUP_AUTHORED_DOORS, type) ? SETUP_AUTHORED_DOORS[type] : undefined;
    if (setup !== undefined) {
        return `Remove \`overrides\` and add your organization's own ${type} under a new name in ${setup}.`;
    }
    const shipper = base === undefined ? 'the package that ships it' : `'${base}'`;
    return `Remove \`overrides\`: ${articleFor(type)} ${type} is defined only in package source, so it changes only with a new version of ${shipper}.`;
}

/**
 * [#30623] The `declared_package_ships_no_such_item` sentence, the one every
 * door renders (they all ask {@link judgeOverrideWrite}). An `action` is keyed
 * `<objectName>:<name>`, so when `base` ships an action of that name on
 * ANOTHER object (`baseItems`, {@link OverrideWriteClosure.baseItemsOf}) the
 * name is right and the object is what is wrong: the sentence names both
 * objects and tells the author to keep the base action's `objectName`.
 * Otherwise — another type, no such name at all, or no items in hand — it
 * says the base ships no such item and to correct the name.
 */
function shipsNoSuchItemMessage(
    type: string,
    name: string,
    base: string,
    packageId: string | undefined,
    overrideItem: unknown,
    baseItems: readonly unknown[] | undefined,
): string {
    const item = `'${type}/${name}'`;
    if (type === 'action') {
        const bare = (n: unknown): unknown => (typeof n === 'string' ? n.slice(n.lastIndexOf(':') + 1) : n);
        const object = overrideWriteActionObjectOf(overrideItem);
        const others = Array.from(new Set((baseItems ?? [])
            .filter((a) => isPlainRecord(a) && bare(a.name) === bare(name))
            .map(overrideWriteActionObjectOf)
            .filter((o) => o !== object))).sort();
        if (others.length > 0) {
            const objectPhrase = (o: string): string => (o === '' ? 'no object' : `object '${o}'`);
            const fix = others.length === 1 && others[0] !== ''
                ? `keep the base action's \`objectName: '${others[0]}'\` in the override`
                : 'keep the `objectName` of the base action it replaces';
            return `${item} declares an override of '${base}' on ${objectPhrase(object)}, but '${base}' ships its action `
                + `'${bare(name)}' on ${others.map(objectPhrase).join(' and ')}. An override replaces the base's action on that `
                + `action's own object: ${fix}, or remove \`overrides\` to keep it as '${packageId}''s own item (ADR-0146 D2).`;
        }
    }
    // [#28746] A pair-identified type names the member it addressed.
    const member = overrideWriteMemberOf(type, overrideItem);
    const ofMember = member === undefined ? '' : ` with ${ITEM_KEY_DISCRIMINATORS[type]?.field} '${member}'`;
    return `${item} declares an override of '${base}', which ships no ${type} named '${name}'${ofMember}. `
        + `Remove \`overrides\` to keep it as '${packageId}''s own item, or correct the name (ADR-0146 D2).`;
}

/** The indefinite article for a type name, by its first letter: "an api", "a permission". */
function articleFor(type: string): 'a' | 'an' {
    return /^[aeiou]/.test(type) ? 'an' : 'a';
}

/**
 * THE override write gate's rule, as a pure verdict — the one judgement the
 * publish doors (`saveMetaItem`, `publishMetaItem`, `publishPackageDrafts`),
 * `os validate` and the marketplace install door all ask, so the three gate
 * points cannot drift (ADR-0146 D2, ruling A on #28390: only the paired
 * `<base>.custom` declares an override; a dependent's same-named item has one
 * fix, rename; a dependent carrying `overrides` is refused).
 *
 * The type list is N-08's (`@objectstack/spec/kernel`:
 * `OVERRIDE_TYPE_CLASSIFICATION`) and the pair predicate is the lookup's
 * (`isPairOf`, `@objectstack/metadata-core`), read, never re-derived.
 * `basedOn` is recorded and never judged.
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
            // [#28834] Both doors an extension is written through: the item
            // door (#28574) and the manifest's collection.
            return refuse('declared_object',
                `${item} carries \`overrides\`, but an object is extended, never replaced (ADR-0146 D10). `
                + 'Remove `overrides` and add the change as an object extension in the base\'s paired .custom package: '
                + `an \`object_extension\` item saved through ${OBJECT_EXTENSION_ITEM_DOOR}, or an \`objectExtensions\` entry of its manifest.`);
        }
        if (type === OBJECT_EXTENSION_TYPE) {
            // [#28834, ADR-0146 D10] An extension takes no override and gets
            // no new name: its name is the object it extends, so the D6
            // "new similar" remedy below would name a write that cannot exist.
            return refuse('declared_type_not_overridable',
                `${item} carries \`overrides\`, but an object extension takes no override (ADR-0146 D10): it adds to the `
                + `object it extends and is stored under that object's name. Remove \`overrides\` and edit the object_extension '${name}' itself.`);
        }
        if (row?.disposition !== 'overridable') {
            // [#30062] The citation is the type's own basis, and the remedy one that works for the type.
            const cite = row === undefined ? 'ADR-0146 D2' : EXCLUSION_BASIS_CITATION[row.basis];
            return refuse('declared_type_not_overridable',
                `${item} carries \`overrides\`, but ${articleFor(type)} ${type} takes no override (${cite}). `
                + excludedTypeRemedy(type, declaration.base));
        }
        // A type classified overridable that still waits for D9's conditions
        // (`isOpenOverrideType`) is refused: its customization "is not yet
        // available". [#28412, #30065] `flow`'s and `action`'s conditions are
        // delivered, so both are judged below like every open type.
        if (!isOpenOverrideType(type)) {
            return refuse('declared_type_not_yet_available',
                `${item} carries \`overrides\`: ${type} customization is not yet available, so a declared ${type} `
                + 'override is refused (ADR-0146 D9). Remove `overrides` and rename the item.');
        }
        const base = declaration.base;
        const pair = base === undefined ? undefined : pairOf(base);
        if (base === undefined || pair === undefined || !pair.ok || !isPairOf(packageId, base)) {
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
                shipsNoSuchItemMessage(type, name, base, packageId, subject.item, closure.baseItemsOf?.(base)));
        }
        // [#30065] A declared action override replaces the whole action, so
        // it could drop the gates that decide who may run it — the base's
        // vendor handler, which runs trusted, then answering callers the
        // base refused. It may tighten them and never widen them.
        if (type === 'action') {
            const widened = actionOverrideWidening(closure.baseItemOf?.(base), subject.item);
            if (widened.length > 0) {
                return refuse('declared_action_widens_access',
                    `${item} declares an override of '${base}' that widens who may run the action: ${widened.join('; ')}. `
                    + 'An action override may add a gate and never remove one: keep the base\'s gates in the override, '
                    + 'or add the action under a new name in the paired .custom package (ADR-0146 D9, ADR-0066 D4).');
            }
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
            const object = type === 'action' ? overrideWriteActionObjectOf(item) : '';
            const identity = object !== '' ? `${object}:${declaredName}` : declaredName;
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
 *
 * `writtenScope`, when given for the written package, is its closure in
 * place of the registry's read: a close asking about a pair the ensure step
 * would create ({@link OverlayPairFix.pendingPairScope}). Every door's own
 * write passes none.
 */
export function overrideWriteVerdict(
    this: Pick<PackagedBaseRefusalHost, 'isWritablePackage' | 'resolveWritePackageScope' | 'shippedArtifactsOf'>,
    request: OverrideWriteSubject,
    writtenScope?: WrittenPackageScope,
): OverrideWriteVerdict {
    const packageId = typeof request.packageId === 'string' && request.packageId.length > 0
        ? request.packageId
        : undefined;
    const declaration = declarationOf(request.item);
    if (packageId === undefined && !declaration.present) return NOT_CONCERNED;
    const scope = packageId === undefined
        ? undefined
        : writtenScope?.packageId === packageId ? writtenScope : this.resolveWritePackageScope(packageId);
    // A named package the registry cannot produce is not this gate's to
    // judge: both doors ask `uninstalledNamedBaseRefusal`, which refuses a
    // write naming an uninstalled base (`WRITABLE_PACKAGE_REQUIRED`) — the
    // fact about the package, not about the item.
    if (packageId !== undefined && scope === undefined) return NOT_CONCERNED;
    const dependencies = scope?.dependencies.filter((id) => id !== packageId);
    const member = overrideWriteMemberOf(request.type, request.item);
    // [#30542] A declared action override names its base's action by the
    // identity `os validate` and the install door key it on,
    // `<objectName>:<name>` ({@link overrideWriteItemsOf}): the base's action
    // of that name on another object is no shipper of it, so an override that
    // moves the action to another object is refused here as it is there.
    const onItsObject = (a: unknown): boolean => !declaration.present
        || (PLURAL_TO_SINGULAR[request.type] ?? request.type) !== 'action'
        || overrideWriteActionObjectOf(a) === overrideWriteActionObjectOf(request.item);
    const shippers = dependencies === undefined || dependencies.length === 0
        ? []
        : Array.from(new Set(
            this.shippedArtifactsOf(request.type, request.name, undefined, member)
                .filter((a) => overrideWriteMemberOf(request.type, a) === member && onItsObject(a))
                .map((a) => (a as { _packageId?: unknown } | null | undefined)?._packageId)
                // An override replaces an item of an INSTALLED, read-only base
                // (ADR-0146 D1): a writable package's item is edited in place
                // (ADR-0070), so a writable shipper is no base this gate guards.
                // Every artifact a kernel serves is registered read-only
                // (`registerApp` → `manifests`), so this keeps no real base out.
                .filter((id): id is string => typeof id === 'string' && dependencies.includes(id)
                    && !this.isWritablePackage(id)),
        ));
    // [#30065] The base's own item, the one a declared action override is
    // judged against: the shipping artifact under that base's envelope.
    const baseItemOf = (basePackageId: string): unknown => this.shippedArtifactsOf(request.type, request.name, undefined, member)
        .find((a) => overrideWriteMemberOf(request.type, a) === member && onItsObject(a)
            && (a as { _packageId?: unknown } | null | undefined)?._packageId === basePackageId);
    // [#30623] The base's items of this name at every object: what the
    // ships-no-such-item refusal names when the override moved the action.
    const baseItemsOf = (basePackageId: string): unknown[] => this.shippedArtifactsOf(request.type, request.name, undefined, member)
        .filter((a) => overrideWriteMemberOf(request.type, a) === member
            && (a as { _packageId?: unknown } | null | undefined)?._packageId === basePackageId);
    return judgeOverrideWrite(request, { dependencies, shippers, baseItemOf, baseItemsOf });
}


/** The body of `ObjectStackProtocolImplementation#originGatedRemovalRefusal`; the method's docblock there is its contract. */
export function originGatedRemovalRefusal(
    this: Pick<PackagedBaseRefusalHost, 'packagedBaseRefusal'>,
    type: string, name: string): Error | null {
    if (!isOriginGatedType(type)) return null;
    return this.packagedBaseRefusal({ type, name, operation: 'delete' });
}
