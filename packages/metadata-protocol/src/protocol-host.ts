// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E1] The host: what a body moved out of `ObjectStackProtocolImplementation`
 * reaches the class through.
 *
 * Ruling E (6537939895) moves the class's members out of `protocol.ts` a whole
 * section at a time (E2). A moved body is an exported function whose first
 * parameter is `host`, and it differs from the method body it was by exactly one
 * closed set of rewrites, checked by `scripts/host-split.mjs`:
 *
 *   - `this.<member>` → `host.<member>`;
 *   - a private static `ObjectStackProtocolImplementation.<fn>(…)` → `host.<fn>(…)`;
 *   - `this.constructor` → `host`.
 *
 * The method stays on the class with its docblock and signature, so the published
 * `.d.ts` keeps it, and its body becomes `return <fn>(protocolHost(this), …)`.
 *
 * ## The host is one object per protocol instance
 *
 * {@link ProtocolHost} lists every class member some moved body reads, each typed
 * AS that member (`ObjectStackProtocolImplementation['x']`, or
 * `(typeof ObjectStackProtocolImplementation)['x']` for a static), so a change to
 * a member's signature on the class is a change here, and naming a member the
 * class does not have is a compile error. A moved function takes the `Pick` of
 * exactly the members its body reads.
 *
 * The object is built by the class itself, in its static block in `protocol.ts`:
 * only code inside the class body can read its private members, and a static
 * block adds no member to the class, so the published `.d.ts` does not move.
 * There:
 *
 *   - a METHOD is a closure that calls it on the instance at call time
 *     (`(...a) => protocol.x(...a)`), never a bound or copied function, so a
 *     method replaced on the instance or its prototype afterwards (a test double,
 *     a spy) is still the one a moved body reaches;
 *   - a FIELD is a getter that reads the instance's field when it is read, and a
 *     setter too when a moved body assigns it, so a moved body sees and makes the
 *     same writes the method body did;
 *   - a private STATIC method is a closure to the static.
 *
 * The census of read seams (`scripts/check-durability-degradation-log-level.mjs`,
 * `HOST_SPLIT`) and the two by-path pins (`protocol.read-verb-canonical-fold`,
 * `protocol.lookup-artifact-item-call-sites`) read a moved body through this
 * shape: a `host.x(…)` call resolves to the class method `x`, and a stub
 * `return fn(protocolHost(this), …)` to `fn`'s body.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * Every `ObjectStackProtocolImplementation` member a moved body reads, sorted by
 * name. `scripts/host-split.mjs move` adds the entries a move needs, here and in
 * the class's static block.
 */
export interface ProtocolHost {
    readonly artifactLockLayerAt: ObjectStackProtocolImplementation['artifactLockLayerAt'];
    readonly assertObjectRegistered: ObjectStackProtocolImplementation['assertObjectRegistered'];
    readonly assertVersionMatch: ObjectStackProtocolImplementation['assertVersionMatch'];
    readonly baseServesBundleMember: ObjectStackProtocolImplementation['baseServesBundleMember'];
    readonly convertStoredItem: ObjectStackProtocolImplementation['convertStoredItem'];
    readonly declinesStoredRow: ObjectStackProtocolImplementation['declinesStoredRow'];
    readonly disabledActionsOf: ObjectStackProtocolImplementation['disabledActionsOf'];
    readonly draftPublishVerdict: ObjectStackProtocolImplementation['draftPublishVerdict'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly environmentId: ObjectStackProtocolImplementation['environmentId'];
    readonly expandStoredViewContainers: ObjectStackProtocolImplementation['expandStoredViewContainers'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly findPairAddedMemberRow: ObjectStackProtocolImplementation['findPairAddedMemberRow'];
    readonly findServedOverlayRow: ObjectStackProtocolImplementation['findServedOverlayRow'];
    readonly flowRegistrationsOf: ObjectStackProtocolImplementation['flowRegistrationsOf'];
    readonly foldObjectExtendersFromRegistry: ObjectStackProtocolImplementation['foldObjectExtendersFromRegistry'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    readonly governServedObject: ObjectStackProtocolImplementation['governServedObject'];
    readonly hydrateOverlayIntoRegistry: ObjectStackProtocolImplementation['hydrateOverlayIntoRegistry'];
    readonly isArtifactBacked: ObjectStackProtocolImplementation['isArtifactBacked'];
    readonly isStoredEntryOfDeclinedName: ObjectStackProtocolImplementation['isStoredEntryOfDeclinedName'];
    readonly isStoredFlowEntryOfShippedName: ObjectStackProtocolImplementation['isStoredFlowEntryOfShippedName'];
    readonly isUnservedSealedOverlay: ObjectStackProtocolImplementation['isUnservedSealedOverlay'];
    readonly isWritablePackage: ObjectStackProtocolImplementation['isWritablePackage'];
    readonly lookupArtifactItem: ObjectStackProtocolImplementation['lookupArtifactItem'];
    readonly namesWithOwnStoredRow: ObjectStackProtocolImplementation['namesWithOwnStoredRow'];
    readonly overlayLockLayerAt: ObjectStackProtocolImplementation['overlayLockLayerAt'];
    readonly overrideWriteVerdict: ObjectStackProtocolImplementation['overrideWriteVerdict'];
    readonly packagedArtifactOwner: ObjectStackProtocolImplementation['packagedArtifactOwner'];
    readonly packagedBaseRefusal: ObjectStackProtocolImplementation['packagedBaseRefusal'];
    readonly packagelessAddress: ObjectStackProtocolImplementation['packagelessAddress'];
    readonly packagelessReadAddress: ObjectStackProtocolImplementation['packagelessReadAddress'];
    readonly probeRecord: ObjectStackProtocolImplementation['probeRecord'];
    readonly readActiveOverlayRows: ObjectStackProtocolImplementation['readActiveOverlayRows'];
    readonly readFlattenedMetaItems: ObjectStackProtocolImplementation['readFlattenedMetaItems'];
    readonly readItemActiveRows: ObjectStackProtocolImplementation['readItemActiveRows'];
    readonly readItemFromMetadataService: ObjectStackProtocolImplementation['readItemFromMetadataService'];
    readonly readMetaItemFace: ObjectStackProtocolImplementation['readMetaItemFace'];
    readonly readVersionToken: ObjectStackProtocolImplementation['readVersionToken'];
    readonly registryMemberServedAt: ObjectStackProtocolImplementation['registryMemberServedAt'];
    readonly resolveAppPackageIdKey: ObjectStackProtocolImplementation['resolveAppPackageIdKey'];
    readonly resolveCascadeDeleteObjects: ObjectStackProtocolImplementation['resolveCascadeDeleteObjects'];
    readonly resolveDisabledActionsReader: ObjectStackProtocolImplementation['resolveDisabledActionsReader'];
    readonly resolveFlowRegistrationReader: ObjectStackProtocolImplementation['resolveFlowRegistrationReader'];
    readonly resolveRowlessExpandedView: ObjectStackProtocolImplementation['resolveRowlessExpandedView'];
    readonly resolveWritePackageScope: ObjectStackProtocolImplementation['resolveWritePackageScope'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    readonly servedLockState: ObjectStackProtocolImplementation['servedLockState'];
    readonly shippedArtifactsOf: ObjectStackProtocolImplementation['shippedArtifactsOf'];
    readonly shippingPackagesOf: ObjectStackProtocolImplementation['shippingPackagesOf'];
    readonly shipsBundleName: ObjectStackProtocolImplementation['shipsBundleName'];
    readonly storedFlowBindingAgrees: ObjectStackProtocolImplementation['storedFlowBindingAgrees'];
    readonly storedOverlayEntries: ObjectStackProtocolImplementation['storedOverlayEntries'];
    readonly strictDraftReadAddress: ObjectStackProtocolImplementation['strictDraftReadAddress'];
    readonly throwMetadataServiceUnavailable: ObjectStackProtocolImplementation['throwMetadataServiceUnavailable'];
    readonly uninstalledNamedBaseRefusal: ObjectStackProtocolImplementation['uninstalledNamedBaseRefusal'];
}

const hosts = new WeakMap<ObjectStackProtocolImplementation, ProtocolHost>();
let build: ((protocol: ObjectStackProtocolImplementation) => ProtocolHost) | undefined;

/**
 * Called once, from `ObjectStackProtocolImplementation`'s static block: the one
 * place that can read the class's private members to build a host.
 */
export function installProtocolHost(factory: (protocol: ObjectStackProtocolImplementation) => ProtocolHost): void {
    build = factory;
}

/** The host of one protocol instance, built on first use and kept for the instance's life. */
export function protocolHost(protocol: ObjectStackProtocolImplementation): ProtocolHost {
    let host = hosts.get(protocol);
    if (host === undefined) {
        if (build === undefined) {
            throw new Error('protocolHost: ObjectStackProtocolImplementation has not installed its host factory');
        }
        host = build(protocol);
        hosts.set(protocol, host);
    }
    return host;
}
