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
    readonly anonymousElevatedFlowRefusal: ObjectStackProtocolImplementation['anonymousElevatedFlowRefusal'];
    readonly anotherPackageShips: ObjectStackProtocolImplementation['anotherPackageShips'];
    readonly applyObjectRegistryMutation: ObjectStackProtocolImplementation['applyObjectRegistryMutation'];
    readonly applyRegistryWriteThrough: ObjectStackProtocolImplementation['applyRegistryWriteThrough'];
    readonly applyRemoteMetadataMutation: ObjectStackProtocolImplementation['applyRemoteMetadataMutation'];
    readonly applySeedBodies: ObjectStackProtocolImplementation['applySeedBodies'];
    readonly artifactLockLayerAt: ObjectStackProtocolImplementation['artifactLockLayerAt'];
    readonly assertAggregationFieldsExist: ObjectStackProtocolImplementation['assertAggregationFieldsExist'];
    readonly assertExpandTargetsExist: ObjectStackProtocolImplementation['assertExpandTargetsExist'];
    readonly assertFilterFieldsExist: ObjectStackProtocolImplementation['assertFilterFieldsExist'];
    readonly assertGroupByFieldsExist: ObjectStackProtocolImplementation['assertGroupByFieldsExist'];
    readonly assertLockAllowsDelete: ObjectStackProtocolImplementation['assertLockAllowsDelete'];
    readonly assertLockAllowsWrite: ObjectStackProtocolImplementation['assertLockAllowsWrite'];
    readonly assertNoInternalFieldEvaluated: ObjectStackProtocolImplementation['assertNoInternalFieldEvaluated'];
    readonly assertObjectRegistered: ObjectStackProtocolImplementation['assertObjectRegistered'];
    readonly assertProjectionFieldsExist: ObjectStackProtocolImplementation['assertProjectionFieldsExist'];
    readonly assertQueryParamsAreFields: ObjectStackProtocolImplementation['assertQueryParamsAreFields'];
    readonly assertRuntimeAuthoringRules: ObjectStackProtocolImplementation['assertRuntimeAuthoringRules'];
    readonly assertSearchFieldsAreSearchable: ObjectStackProtocolImplementation['assertSearchFieldsAreSearchable'];
    readonly assertSortFieldsExist: ObjectStackProtocolImplementation['assertSortFieldsExist'];
    readonly assertVersionMatch: ObjectStackProtocolImplementation['assertVersionMatch'];
    readonly authoredLockFamily: ObjectStackProtocolImplementation['authoredLockFamily'];
    readonly authoringChannel: ObjectStackProtocolImplementation['authoringChannel'];
    readonly authoringGates: ObjectStackProtocolImplementation['authoringGates'];
    readonly baseServesBundleMember: ObjectStackProtocolImplementation['baseServesBundleMember'];
    readonly carryForwardRedactedCredentials: ObjectStackProtocolImplementation['carryForwardRedactedCredentials'];
    readonly classifyObjectContribution: ObjectStackProtocolImplementation['classifyObjectContribution'];
    clusterNodeId: ObjectStackProtocolImplementation['clusterNodeId'];
    clusterPubSub: ObjectStackProtocolImplementation['clusterPubSub'];
    clusterUnsubscribe: ObjectStackProtocolImplementation['clusterUnsubscribe'];
    readonly codeOnlyCreateError: (typeof ObjectStackProtocolImplementation)['codeOnlyCreateError'];
    readonly codeOnlyOverrideError: (typeof ObjectStackProtocolImplementation)['codeOnlyOverrideError'];
    readonly convertStoredItem: ObjectStackProtocolImplementation['convertStoredItem'];
    readonly convertStoredItemDetailed: ObjectStackProtocolImplementation['convertStoredItemDetailed'];
    readonly copiesOwnShippedViewContainer: ObjectStackProtocolImplementation['copiesOwnShippedViewContainer'];
    readonly credentialChannelFor: ObjectStackProtocolImplementation['credentialChannelFor'];
    readonly credentialChannels: ObjectStackProtocolImplementation['credentialChannels'];
    readonly declinesStoredRow: ObjectStackProtocolImplementation['declinesStoredRow'];
    readonly defaultRecordPageSaveRefusal: ObjectStackProtocolImplementation['defaultRecordPageSaveRefusal'];
    readonly deleteMetaItemUnaudited: ObjectStackProtocolImplementation['deleteMetaItemUnaudited'];
    readonly detachMetadataMutationPubSub: ObjectStackProtocolImplementation['detachMetadataMutationPubSub'];
    readonly diffMetaItem: ObjectStackProtocolImplementation['diffMetaItem'];
    readonly disabledActionsOf: ObjectStackProtocolImplementation['disabledActionsOf'];
    readonly discardDraftInItsScope: ObjectStackProtocolImplementation['discardDraftInItsScope'];
    readonly draftPublishVerdict: ObjectStackProtocolImplementation['draftPublishVerdict'];
    readonly dropObjectStorage: ObjectStackProtocolImplementation['dropObjectStorage'];
    readonly dropStorageRemainingRowsRefusal: (typeof ObjectStackProtocolImplementation)['dropStorageRemainingRowsRefusal'];
    readonly emitMetaItemPublished: ObjectStackProtocolImplementation['emitMetaItemPublished'];
    readonly emitMetadataMutation: ObjectStackProtocolImplementation['emitMetadataMutation'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly ensureObjectStorage: ObjectStackProtocolImplementation['ensureObjectStorage'];
    readonly ensureOverlayIndex: ObjectStackProtocolImplementation['ensureOverlayIndex'];
    readonly ensureOverlayMembersBackfilled: ObjectStackProtocolImplementation['ensureOverlayMembersBackfilled'];
    readonly envWritableTypes: (typeof ObjectStackProtocolImplementation)['envWritableTypes'];
    readonly environmentId: ObjectStackProtocolImplementation['environmentId'];
    readonly expandRuntimeViewContainer: ObjectStackProtocolImplementation['expandRuntimeViewContainer'];
    readonly expandStoredViewContainers: ObjectStackProtocolImplementation['expandStoredViewContainers'];
    readonly expandUnderOwnName: ObjectStackProtocolImplementation['expandUnderOwnName'];
    readonly externalBindingSaveRefusal: ObjectStackProtocolImplementation['externalBindingSaveRefusal'];
    readonly findEnvironmentRow: ObjectStackProtocolImplementation['findEnvironmentRow'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly findPairAddedMemberRow: ObjectStackProtocolImplementation['findPairAddedMemberRow'];
    readonly findServedOverlayRow: ObjectStackProtocolImplementation['findServedOverlayRow'];
    readonly flowCanonicalizeFallbackWarned: ObjectStackProtocolImplementation['flowCanonicalizeFallbackWarned'];
    readonly flowRegistrationsOf: ObjectStackProtocolImplementation['flowRegistrationsOf'];
    readonly flowSaveReplaysRetired: ObjectStackProtocolImplementation['flowSaveReplaysRetired'];
    readonly foldObjectExtendersFromRegistry: ObjectStackProtocolImplementation['foldObjectExtendersFromRegistry'];
    readonly getMetaItem: ObjectStackProtocolImplementation['getMetaItem'];
    readonly getMetaItems: ObjectStackProtocolImplementation['getMetaItems'];
    readonly getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    readonly getPackagedObjectBase: ObjectStackProtocolImplementation['getPackagedObjectBase'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    readonly governServedObject: ObjectStackProtocolImplementation['governServedObject'];
    readonly historyMetaItem: ObjectStackProtocolImplementation['historyMetaItem'];
    readonly hydrateExpandedViewItems: ObjectStackProtocolImplementation['hydrateExpandedViewItems'];
    readonly hydrateOverlayIntoRegistry: ObjectStackProtocolImplementation['hydrateOverlayIntoRegistry'];
    readonly installPackage: ObjectStackProtocolImplementation['installPackage'];
    readonly isAnotherPackagesObject: ObjectStackProtocolImplementation['isAnotherPackagesObject'];
    readonly isArtifactBacked: ObjectStackProtocolImplementation['isArtifactBacked'];
    readonly isDeclaredCodeDatasource: ObjectStackProtocolImplementation['isDeclaredCodeDatasource'];
    readonly isHostCodeDatasource: ObjectStackProtocolImplementation['isHostCodeDatasource'];
    readonly isNestedArtifactField: ObjectStackProtocolImplementation['isNestedArtifactField'];
    readonly isOverlayAllowed: (typeof ObjectStackProtocolImplementation)['isOverlayAllowed'];
    readonly isPackagedBaseRefusal: (typeof ObjectStackProtocolImplementation)['isPackagedBaseRefusal'];
    readonly isRuntimeCreateAllowed: (typeof ObjectStackProtocolImplementation)['isRuntimeCreateAllowed'];
    readonly isSealedManagedItem: ObjectStackProtocolImplementation['isSealedManagedItem'];
    readonly isStoredEntryOfDeclinedName: ObjectStackProtocolImplementation['isStoredEntryOfDeclinedName'];
    readonly isStoredFlowEntryOfShippedName: ObjectStackProtocolImplementation['isStoredFlowEntryOfShippedName'];
    readonly isUnservedSealedOverlay: ObjectStackProtocolImplementation['isUnservedSealedOverlay'];
    readonly isWritablePackage: ObjectStackProtocolImplementation['isWritablePackage'];
    readonly legacyOrganizationRowsOf: ObjectStackProtocolImplementation['legacyOrganizationRowsOf'];
    readonly listCommits: ObjectStackProtocolImplementation['listCommits'];
    readonly listLiveMetadataTypes: ObjectStackProtocolImplementation['listLiveMetadataTypes'];
    readonly lockWriteRefusal: ObjectStackProtocolImplementation['lockWriteRefusal'];
    readonly lookupArtifactItem: ObjectStackProtocolImplementation['lookupArtifactItem'];
    readonly mergesOverlayAtRead: (typeof ObjectStackProtocolImplementation)['mergesOverlayAtRead'];
    readonly metaItemPublishedListeners: ObjectStackProtocolImplementation['metaItemPublishedListeners'];
    readonly metadataConflictRefusal: ObjectStackProtocolImplementation['metadataConflictRefusal'];
    readonly metadataMutationListeners: ObjectStackProtocolImplementation['metadataMutationListeners'];
    readonly mutationProjectors: ObjectStackProtocolImplementation['mutationProjectors'];
    readonly namedBaseOverlayWriteRefusal: ObjectStackProtocolImplementation['namedBaseOverlayWriteRefusal'];
    readonly namesWithOwnStoredRow: ObjectStackProtocolImplementation['namesWithOwnStoredRow'];
    readonly notifyMutationListenersLocal: ObjectStackProtocolImplementation['notifyMutationListenersLocal'];
    readonly objectExtensionItemRefusal: ObjectStackProtocolImplementation['objectExtensionItemRefusal'];
    readonly objectNamespacePrefixViolation: ObjectStackProtocolImplementation['objectNamespacePrefixViolation'];
    readonly objectRegistrationRefusal: ObjectStackProtocolImplementation['objectRegistrationRefusal'];
    readonly optimisticConflictAuditEntry: (typeof ObjectStackProtocolImplementation)['optimisticConflictAuditEntry'];
    readonly organizationScopedWriteRefusal: (typeof ObjectStackProtocolImplementation)['organizationScopedWriteRefusal'];
    readonly originGatedRemovalRefusal: ObjectStackProtocolImplementation['originGatedRemovalRefusal'];
    readonly overlaidShippedContainerViewNames: ObjectStackProtocolImplementation['overlaidShippedContainerViewNames'];
    readonly overlayBaseShippers: ObjectStackProtocolImplementation['overlayBaseShippers'];
    readonly overlayLockLayerAt: ObjectStackProtocolImplementation['overlayLockLayerAt'];
    readonly overlayPackageMismatchError: (typeof ObjectStackProtocolImplementation)['overlayPackageMismatchError'];
    readonly overlayRepos: ObjectStackProtocolImplementation['overlayRepos'];
    readonly overrideWriteVerdict: ObjectStackProtocolImplementation['overrideWriteVerdict'];
    readonly packagedArtifactBase: ObjectStackProtocolImplementation['packagedArtifactBase'];
    readonly packagedArtifactOwner: ObjectStackProtocolImplementation['packagedArtifactOwner'];
    readonly packagedBaseRefusal: ObjectStackProtocolImplementation['packagedBaseRefusal'];
    readonly packagelessAddress: ObjectStackProtocolImplementation['packagelessAddress'];
    readonly packagelessDraftAddress: ObjectStackProtocolImplementation['packagelessDraftAddress'];
    readonly packagelessOverlayWriteRefusal: ObjectStackProtocolImplementation['packagelessOverlayWriteRefusal'];
    readonly packagelessReadAddress: ObjectStackProtocolImplementation['packagelessReadAddress'];
    readonly pairsOfAddedMember: ObjectStackProtocolImplementation['pairsOfAddedMember'];
    readonly parseCommitItems: ObjectStackProtocolImplementation['parseCommitItems'];
    readonly permissionSetNameCollisionRefusal: ObjectStackProtocolImplementation['permissionSetNameCollisionRefusal'];
    readonly probeRecord: ObjectStackProtocolImplementation['probeRecord'];
    readonly promoteDraftForPublish: ObjectStackProtocolImplementation['promoteDraftForPublish'];
    readonly publishMaterializers: ObjectStackProtocolImplementation['publishMaterializers'];
    readonly publishMetaItemUnaudited: ObjectStackProtocolImplementation['publishMetaItemUnaudited'];
    readonly publishMetadataMutation: ObjectStackProtocolImplementation['publishMetadataMutation'];
    readonly readActiveOverlayRows: ObjectStackProtocolImplementation['readActiveOverlayRows'];
    readonly readFlattenedMetaItems: ObjectStackProtocolImplementation['readFlattenedMetaItems'];
    readonly readItemActiveRows: ObjectStackProtocolImplementation['readItemActiveRows'];
    readonly readItemFromMetadataService: ObjectStackProtocolImplementation['readItemFromMetadataService'];
    readonly readMetaItem: ObjectStackProtocolImplementation['readMetaItem'];
    readonly readMetaItemFace: ObjectStackProtocolImplementation['readMetaItemFace'];
    readonly readRevertableCommit: ObjectStackProtocolImplementation['readRevertableCommit'];
    readonly readVersionToken: ObjectStackProtocolImplementation['readVersionToken'];
    readonly receiptVersion: ObjectStackProtocolImplementation['receiptVersion'];
    readonly reconcileViewExpansions: ObjectStackProtocolImplementation['reconcileViewExpansions'];
    readonly recordMetadataAudit: ObjectStackProtocolImplementation['recordMetadataAudit'];
    readonly recordOptimisticConflictAudit: ObjectStackProtocolImplementation['recordOptimisticConflictAudit'];
    readonly recordPackageCommit: ObjectStackProtocolImplementation['recordPackageCommit'];
    readonly recordPendingDenialAudit: ObjectStackProtocolImplementation['recordPendingDenialAudit'];
    readonly refuseOrganizationScopedWrite: (typeof ObjectStackProtocolImplementation)['refuseOrganizationScopedWrite'];
    readonly refusePackagedBaseOverride: ObjectStackProtocolImplementation['refusePackagedBaseOverride'];
    readonly refusePackagedBaseRemoval: ObjectStackProtocolImplementation['refusePackagedBaseRemoval'];
    readonly refuseUngrammaticalMetaItemName: ObjectStackProtocolImplementation['refuseUngrammaticalMetaItemName'];
    readonly refuseUnmintableMetaType: ObjectStackProtocolImplementation['refuseUnmintableMetaType'];
    readonly registerStoredObjectExtension: ObjectStackProtocolImplementation['registerStoredObjectExtension'];
    readonly registeredTranslationBundle: ObjectStackProtocolImplementation['registeredTranslationBundle'];
    readonly registryAllowsOverlay: (typeof ObjectStackProtocolImplementation)['registryAllowsOverlay'];
    readonly registryMemberServedAt: ObjectStackProtocolImplementation['registryMemberServedAt'];
    readonly registryTakesStoredRows: ObjectStackProtocolImplementation['registryTakesStoredRows'];
    readonly releaseAdoptedObjectOwner: ObjectStackProtocolImplementation['releaseAdoptedObjectOwner'];
    readonly reportPageRequiresAbsentAtLoad: ObjectStackProtocolImplementation['reportPageRequiresAbsentAtLoad'];
    readonly reportSealedOverlayRows: ObjectStackProtocolImplementation['reportSealedOverlayRows'];
    readonly resolveAppPackageIdKey: ObjectStackProtocolImplementation['resolveAppPackageIdKey'];
    readonly resolveCascadeDeleteObjects: ObjectStackProtocolImplementation['resolveCascadeDeleteObjects'];
    readonly resolveDisabledActionsReader: ObjectStackProtocolImplementation['resolveDisabledActionsReader'];
    readonly resolveFlowCanonicalizer: ObjectStackProtocolImplementation['resolveFlowCanonicalizer'];
    readonly resolveFlowRegistrationReader: ObjectStackProtocolImplementation['resolveFlowRegistrationReader'];
    readonly resolveOverlayPackageBinding: ObjectStackProtocolImplementation['resolveOverlayPackageBinding'];
    readonly resolveRowlessExpandedView: ObjectStackProtocolImplementation['resolveRowlessExpandedView'];
    readonly resolveSduiManifest: ObjectStackProtocolImplementation['resolveSduiManifest'];
    readonly resolveWritePackageScope: ObjectStackProtocolImplementation['resolveWritePackageScope'];
    readonly restoreArtifactRegistryView: ObjectStackProtocolImplementation['restoreArtifactRegistryView'];
    readonly restoreInjectedColumnEchoes: ObjectStackProtocolImplementation['restoreInjectedColumnEchoes'];
    readonly restoreTranslatedObjectEchoes: ObjectStackProtocolImplementation['restoreTranslatedObjectEchoes'];
    readonly restoreWriteFor: ObjectStackProtocolImplementation['restoreWriteFor'];
    readonly restoredBodyWriter: ObjectStackProtocolImplementation['restoredBodyWriter'];
    readonly restoredCredentialPathsFor: ObjectStackProtocolImplementation['restoredCredentialPathsFor'];
    readonly resyncStoredObjectExtensions: ObjectStackProtocolImplementation['resyncStoredObjectExtensions'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    readonly revertCommit: ObjectStackProtocolImplementation['revertCommit'];
    readonly rollBackUnmanagedImport: ObjectStackProtocolImplementation['rollBackUnmanagedImport'];
    readonly rollbackMetaItemUnaudited: ObjectStackProtocolImplementation['rollbackMetaItemUnaudited'];
    readonly runAuthoringGate: ObjectStackProtocolImplementation['runAuthoringGate'];
    readonly runMutationProjector: ObjectStackProtocolImplementation['runMutationProjector'];
    readonly runPublishSideEffects: ObjectStackProtocolImplementation['runPublishSideEffects'];
    readonly runtimeViewContainerObject: ObjectStackProtocolImplementation['runtimeViewContainerObject'];
    readonly runtimeViewContainerPackage: ObjectStackProtocolImplementation['runtimeViewContainerPackage'];
    readonly saveConflict: ObjectStackProtocolImplementation['saveConflict'];
    readonly saveMetaItem: ObjectStackProtocolImplementation['saveMetaItem'];
    readonly saveMetaItemUnaudited: ObjectStackProtocolImplementation['saveMetaItemUnaudited'];
    readonly saveWriteBinding: ObjectStackProtocolImplementation['saveWriteBinding'];
    readonly seedExternalIdSaveRefusal: ObjectStackProtocolImplementation['seedExternalIdSaveRefusal'];
    readonly servedExpand: ObjectStackProtocolImplementation['servedExpand'];
    readonly servedLockState: ObjectStackProtocolImplementation['servedLockState'];
    readonly shippedArtifactsOf: ObjectStackProtocolImplementation['shippedArtifactsOf'];
    readonly shippingPackagesOf: ObjectStackProtocolImplementation['shippingPackagesOf'];
    readonly shipsBundleName: ObjectStackProtocolImplementation['shipsBundleName'];
    readonly shouldDropStorage: ObjectStackProtocolImplementation['shouldDropStorage'];
    readonly storableViewFallbackWarned: ObjectStackProtocolImplementation['storableViewFallbackWarned'];
    storeHydratedIntoRegistry: ObjectStackProtocolImplementation['storeHydratedIntoRegistry'];
    readonly storedFlowBindingAgrees: ObjectStackProtocolImplementation['storedFlowBindingAgrees'];
    readonly storedHashDigest: ObjectStackProtocolImplementation['storedHashDigest'];
    readonly storedOverlayEntries: ObjectStackProtocolImplementation['storedOverlayEntries'];
    readonly storedParentForToken: ObjectStackProtocolImplementation['storedParentForToken'];
    readonly storedRowKnownDatasources: ObjectStackProtocolImplementation['storedRowKnownDatasources'];
    readonly strictDraftReadAddress: ObjectStackProtocolImplementation['strictDraftReadAddress'];
    readonly stripServedObjectColumns: ObjectStackProtocolImplementation['stripServedObjectColumns'];
    readonly tenantAuthoredWriteRefusal: ObjectStackProtocolImplementation['tenantAuthoredWriteRefusal'];
    readonly throwMetadataServiceUnavailable: ObjectStackProtocolImplementation['throwMetadataServiceUnavailable'];
    readonly uninstallCleanups: ObjectStackProtocolImplementation['uninstallCleanups'];
    readonly uninstallGuards: ObjectStackProtocolImplementation['uninstallGuards'];
    readonly uninstalledNamedBaseRefusal: ObjectStackProtocolImplementation['uninstalledNamedBaseRefusal'];
    readonly unknownDatasourceSaveRefusal: ObjectStackProtocolImplementation['unknownDatasourceSaveRefusal'];
    readonly unknownGrantObjectSaveRefusal: ObjectStackProtocolImplementation['unknownGrantObjectSaveRefusal'];
    readonly unknownPicklistBindingSaveRefusal: ObjectStackProtocolImplementation['unknownPicklistBindingSaveRefusal'];
    readonly unmanagedImportCollisions: ObjectStackProtocolImplementation['unmanagedImportCollisions'];
    readonly viewContainerNameCollisionRefusal: ObjectStackProtocolImplementation['viewContainerNameCollisionRefusal'];
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
