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
}

/** The body of `ObjectStackProtocolImplementation#refusePackagedBaseOverride`; the method's docblock there is its contract. */
export function refusePackagedBaseOverride(
    this: Pick<PackagedBaseRefusalHost, 'isSealedManagedItem' | 'isWritablePackage'>,
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
        const err = new Error(managedItemSealedSentence(request.type, request.name, 'save'));
        (err as any).code = 'NOT_OVERRIDABLE';
        (err as any).status = 403;
        throw err;
    }
}

/** The body of `ObjectStackProtocolImplementation#originGatedRemovalRefusal`; the method's docblock there is its contract. */
export function originGatedRemovalRefusal(
    this: Pick<PackagedBaseRefusalHost, 'packagedBaseRefusal'>,
    type: string, name: string): Error | null {
    if (!isOriginGatedType(type)) return null;
    return this.packagedBaseRefusal({ type, name, operation: 'delete' });
}
