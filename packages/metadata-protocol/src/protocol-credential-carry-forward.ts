// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 9] The credential carry-forward of `ObjectStackProtocolImplementation`
 * — the registered credential channel lookup (`credentialChannelFor`), the
 * save's write-path inverse of the read exits' credential redaction
 * (`carryForwardRedactedCredentials`), the stored body it compares against
 * (`storedBodyForCarryForward`) and the runtime authoring gate's half of the
 * same context (`restoredCredentialPathsFor`) — moved out of `protocol.ts`
 * whole. One member of the group stays in the class:
 * `readCodeLayerForCarryForward`, the code-layer read the stored body falls
 * back to, a `lookupArtifactItem(` site that
 * `protocol.lookup-artifact-item-call-sites.test.ts` reads in `protocol.ts`.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, in the same
 * order, with no `try`/`catch` added where the carry-forward forbids one. No
 * module-level declaration of `protocol.ts` is read by these bodies, so none
 * moved with them.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link CredentialCarryForwardHost} members that method reads,
 * plus a `.call`. A method is handed over as a closure that calls it on the
 * protocol at call time, so a test double or spy set on the instance is still
 * the one the body reaches, and the moved bodies that call one another do so
 * through the protocol, exactly as before. `credentialChannelFor` keeps its
 * other readers in the class, the cut 8 restore doors among them, and they
 * still call the method.
 *
 * The one field the bodies read, `credentialChannels`, goes as a GETTER, so
 * the read happens when the body makes it, as for every field in this series.
 *
 * Everything else the bodies read is imported from the module `protocol.ts`
 * imports it from (`metadata-redaction.ts`, `@objectstack/spec/shared`); from
 * `protocol.ts` itself this module imports types only, so there is no
 * runtime module cycle. Nothing re-exports this module, so the published
 * surface does not move.
 */

import type { MetadataCredentialChannel, ObjectStackProtocolImplementation } from './protocol.js';
import type { SysMetadataRepository } from './sys-metadata-repository.js';
import { carryForwardRedactedValues, hasMetadataRedactor, redactedPathsCarriedForward } from './metadata-redaction.js';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface CredentialCarryForwardHost {
    credentialChannelFor: ObjectStackProtocolImplementation['credentialChannelFor'];
    readonly credentialChannels: ObjectStackProtocolImplementation['credentialChannels'];
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    readCodeLayerForCarryForward: ObjectStackProtocolImplementation['readCodeLayerForCarryForward'];
    storedBodyForCarryForward: ObjectStackProtocolImplementation['storedBodyForCarryForward'];
}

/** The body of `ObjectStackProtocolImplementation#credentialChannelFor`; the method's docblock there is its contract. */
export function credentialChannelFor(
    this: Pick<CredentialCarryForwardHost, 'credentialChannels'>,
    type: string): MetadataCredentialChannel | undefined {
    return this.credentialChannels.get(PLURAL_TO_SINGULAR[type] ?? type);
}

/** The body of `ObjectStackProtocolImplementation#carryForwardRedactedCredentials`; the method's docblock there is its contract. */
export async function carryForwardRedactedCredentials(
    this: Pick<CredentialCarryForwardHost, 'storedBodyForCarryForward'>,
    args: {
        type: string;
        repo: SysMetadataRepository;
        ref: Parameters<SysMetadataRepository['get']>[0];
        state: 'draft' | 'active';
        packageId: string | null;
        item: any;
        /** [#22877] The bundle member the save addresses (its body's). */
        member?: string;
    }): Promise<any> {
    if (!hasMetadataRedactor(args.type)) return args.item;
    const body = await this.storedBodyForCarryForward(args);
    if (!body) return args.item;
    return carryForwardRedactedValues(args.type, args.item, body);
}

/** The body of `ObjectStackProtocolImplementation#storedBodyForCarryForward`; the method's docblock there is its contract. */
export async function storedBodyForCarryForward(
    this: Pick<CredentialCarryForwardHost, 'readCodeLayerForCarryForward'>,
    args: {
        type: string;
        repo: SysMetadataRepository;
        ref: Parameters<SysMetadataRepository['get']>[0];
        state: 'draft' | 'active';
        packageId: string | null;
        member?: string;
    }): Promise<unknown> {
    // [#22128] The row this save overwrites, and with no draft row yet the
    // active row the draft overlays: the one in the package the draft is
    // stamped into (`packageId`, the inherited binding included).
    const target = await args.repo.headAt(args.ref, {
        state: args.state,
        packageId: args.packageId,
        member: args.member,
    });
    let stored = target.head;
    if (!stored && args.state === 'draft') {
        stored = (await args.repo.headAt(args.ref, {
            state: 'active',
            packageId: target.packageId,
            member: args.member,
        })).head;
    }
    // [#20552] NO overlay row at either state: the body the read served is
    // the CODE layer, so that is what the incoming body is compared with.
    // Without this a code-authored item — an inbound flow whose secret is a
    // literal in the app's source, the shipped reference shape — had its
    // FIRST save persist an overlay row with the credential dropped, and
    // an overlay wins every later merge.
    return stored?.body ?? await this.readCodeLayerForCarryForward(args.type, args.ref.name, args.packageId);
}

/** The body of `ObjectStackProtocolImplementation#restoredCredentialPathsFor`; the method's docblock there is its contract. */
export async function restoredCredentialPathsFor(
    this: Pick<CredentialCarryForwardHost, 'credentialChannelFor' | 'getOverlayRepo' | 'storedBodyForCarryForward'>,
    args: {
        type: string;
        name: string;
        packageId: string | null;
        item: unknown;
    }): Promise<readonly string[]> {
    if (!hasMetadataRedactor(args.type)) return [];
    const repo = this.getOverlayRepo();
    const ref = {
        type: args.type,
        name: args.name,
        org: 'env',
    } as Parameters<typeof repo.get>[0];
    const body = await this.storedBodyForCarryForward({
        type: args.type,
        repo,
        ref,
        // The gate judges `active` writes only (#4463 D1), so this is the
        // state a gated save's carry-forward reads.
        state: 'active',
        packageId: args.packageId,
    });
    const carried = body ? redactedPathsCarriedForward(args.type, args.item, body) : [];
    // [#20790] A credential the write-only channel holds is withheld from
    // the stored body too, so the carry-forward restores nothing there —
    // and it is still present: the channel keeps it across this save.
    const held = await this.credentialChannelFor(args.type)?.heldPaths({
        name: args.name,
        state: 'active',
        item: args.item,
    });
    return held && held.length > 0 ? [...new Set([...carried, ...held])] : carried;
}
