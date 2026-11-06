// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    DataProtocol,
    FlowRegistration,
    MetadataProtocol,
    PackageProtocol,
} from '@objectstack/spec/api';
import { IDataEngine, engineCanRollBack, recordNotFoundError } from '@objectstack/core';
import { resolveThrownHttpError } from '@objectstack/types';
import { assertQueryReadRows, planQueryReadWindow, resolveQueryReadLimits } from '@objectstack/types';
import { type TenancyPosture } from '@objectstack/spec/security';
// [commit 376c70f98] The derived `version` this file's `getDiscovery()` serves as the
// `DiscoverySchema` "System Identity" field — never a literal again.
import { resolveDiscoveryVersion } from './discovery-version.js';
import type { MetadataHostEngine } from './host-engine.js';
import { omitInternalFieldsFromWriteResponse } from './write-response-internal-fields.js';
import { staleSummaryRefusalOrThrow, withEarnedAnswer, type SummaryRecomputeRefusal } from '@objectstack/types';
import {
    SDUI_MANIFEST_SERVICE,
    type RuntimePendingDeclarations,
} from './runtime-authoring-gate.js';
import type { RuntimeAuthoringIssue } from './runtime-authoring-gate.js';
// [#6418] `sys_metadata`'s overlay-uniqueness indexes: probe-first DDL plus the
// ADR-0120 D4 reporting that replaced this file's empty `catch` blocks.
import {
    backfillOverlayBundleMembers,
    overlayMemberWhere,
} from './migrations/overlay-index.js';
import {
    SysMetadataRepository,
    packageScopedRowWhere,
    packagelessAddressAmbiguityRefusal,
    resetEnvWritableMetadataTypes,
    unboundItemDraftAddress,
} from './sys-metadata-repository.js';
import { managedItemSealedSentence, packagedBaseRegimeRow, packagedBaseRegimeSentence } from './packaged-base-regime.js';
import {
    resolveItemLock,
    resolveItemLockLazily,
    resolveOverlayLockLayer,
    withItemLockFamily,
    type ItemAddress,
    type ItemLock,
    type StoredOverlayRow,
} from './item-lock.js';
import {
    ConflictError,
    type MetadataItem,
    readLegacyOrganizationRows,
} from '@objectstack/metadata-core';
// [#5532] One vocabulary of "which driver read errors are benign", shared with
// `sys-metadata-repository.ts` in this package and with `DatabaseLoader` in
// `@objectstack/metadata` (#5108). See `rethrowUnlessMetadataStoreUnprovisioned`.
import { isMissingTableError } from '@objectstack/metadata/errors';
// [#21412, #21470] The divergent `name` refusal — the one judge the boot loop,
// `os validate` and the artifact/HMR loader call too. Every door here that
// writes a `sys_metadata` row passes the name it writes the row under: the save
// door (`saveMetaItem`), the restore doors (`rollbackMetaItem`, `revertCommit`)
// and the draft promotion (`promoteDraftForPublish`).
import type {
    BatchUpdateRequest,
    BatchUpdateResponse,
    UpdateManyDataRequest,
    DeleteManyDataRequest,
    InstallPackageRequest,
    InstallPackageResponse,
    ImportUnmanagedPackageRequest,
    ImportUnmanagedPackageResponse,
    EnsureCustomizationPackageRequest,
    EnsureCustomizationPackageResponse,
} from '@objectstack/spec/api';
// [ADR-0131 D6] The `unmanaged` install mode: its request is PARSED through
// the published declaration, and the pure half of the import (what a package
// body holds, what is copied, what is refused) lives beside this file.
import type { MetadataCacheRequest, MetadataCacheResponse, ServiceInfo, ApiRoutes, WellKnownCapabilities, CapabilityDescriptor } from '@objectstack/spec/api';
import type { SeedAppliedLandedParsed } from '@objectstack/spec/api';
import { readServiceSelfInfo, readChannelRoute, readAuthFamilies, isSubscribableChannel, CHANNEL_SURFACE_SLOTS, resolveDiscoveryEnvironment } from '@objectstack/spec/api';
// [#24395] The save's authoring surface.
import {
    parseFilterAST,
    isFilterAST,
    REFERENCE_VALUE_TYPES,
    foldQueryAliasSlots,
    QUERY_TRANSPORT_ALIAS_SLOTS,
    QUERY_TRANSPORT_DOLLAR_ALIASES,
    QUERY_TRANSPORT_DOLLAR_PARAMS,
    type DroppedFieldsEvent,
    type EngineAggregateOptions,
    type EngineCountOptions,
    type EngineQueryOptions,
    type EngineQueryOptionsParsed,
    type ValidationAdvisoryEvent,
    externalBindingDatasourceRefusal,
} from '@objectstack/spec/data';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL, unrecognisedMetaTypeRefusal } from '@objectstack/spec/shared';
// [#13331] The cluster fan-out transport type only — the protocol never
// depends on `@objectstack/service-cluster`; a bridge plugin there hands the
// live transport in through `attachMetadataMutationPubSub`.
import type { IFieldFileService, IPubSub } from '@objectstack/spec/contracts';
import { FIELD_FILE_SERVICE } from '@objectstack/spec/contracts';
import type { ConversionNotice, ConversionTodoNotice } from '@objectstack/spec';
import { type I18nLabel } from '@objectstack/spec/ui';
// [commit ece4dad31] Emitted-specifier pin. This module's inferred public declarations
// structurally mention `FormFieldInput` (FormView `sections[].fields`), and
// this file imports BOTH `@objectstack/spec` (root, for
// `applyConversionsToStoredItem` above) and `@objectstack/spec/ui`. Once
// commit ece4dad31 made `FormFieldInput` nameable from the root entry, tsc's
// declaration emitter switched its synthesized reference from the `/ui` slice
// to the root — both are portable, but the root specifier drags spec's ENTIRE
// root module graph into every downstream tsc program that reads this
// package's dts (measured on PR #11716: +190k types, +805k instantiations,
// +~560MB on the debt-ledger re-measure of @objectstack/http-conformance —
// past a 4GB heap). An IMPORT (not a bare re-export — that creates no local
// binding) makes the emitter reuse this binding, keeping the emitted
// reference on the narrow `/ui` entry; the export statement is what keeps
// no-unused-locals green. index.ts deliberately does not re-export it
// (curated entry, unchanged).
import { type FormFieldInput } from '@objectstack/spec/ui';
export type { FormFieldInput };
import { CORE_SERVICE_PROVIDER, serviceUnavailableMessage, type TranslationBundle } from '@objectstack/spec/system';
import {
    type RestoredTranslatedSlot,
} from './protocol-translated-echo.js';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import {
    resolveLockState,
    type MetadataLock,
    type MetadataLockSource,
    type MetadataProvenance,
} from '@objectstack/spec/kernel';
// [#28409, ADR-0146 D3 / D8 item 2] The pair's id, the one spelling N-08 owns,
// and the one predicate that says a stored row is the served override of a
// base's name.
import { isServedOverrideRowOf, type ServedOverrideRow } from './served-override.js';
import { listServedOverrides, type ServedOverrideEntry } from './protocol-served-overrides.js';
// [#28413, ADR-0146 D11] The package-less overlay migration (`os migrate
// packageless-overlays`).
import {
    listPackagelessOverlays,
    migratePackagelessOverlays,
    packagelessCloseSubject,
    type PackagelessOverlayCensus,
    type PackagelessWriteSubject,
    type PackagelessOverlayMigration,
} from './protocol-packageless-overlay-migration.js';
// [#19417] The package-id declaration and its remedy text, imported to be
// SURFACED rather than restated — see the gate at the top of `installPackage`.
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { REFERENCE_SITES } from './reference-sites.js';
// [#5488] The `@objectstack/spec/api` import that stood here — `ApiEndpointSchema`,
// `validateApiEndpointDeclarations`, `type ApiEndpoint` — went with
// `gateApiDraftsForPublish` (see its retirement note in `publishPackageDrafts`).
// This module no longer judges endpoints at all: `api` is code-only since #5488,
// so no `api` draft can be authored here, and the ONE judge of what is servable
// stays `validateApiEndpointDeclarations` on the artifact route (stack schema,
// `publishPackage` #5189, and `buildEndpointIndex` at load, PR #5203). An
// endpoint-shaped import left behind with no caller reads as a capability this
// module still has (#3950), so it is removed rather than parked.
import {
    computeMetadataDiagnostics,
    type MetadataDiagnostics,
} from './metadata-diagnostics.js';
// [#8154] The per-type read-path redaction seam. `decorateMetadataItem` already
// composes `redactMetadataItem` (see its ordering note), which covers the
// `getMetaItems` / `getMetaItem` exits; the two named here are the exits that
// decoration does not reach — `getMetaItemLayered`, which serves three RAW
// layers, and `saveMetaItem`, which owes the redaction its write-path inverse.
// [#21086] The stored-row helpers are the generic data door's half: `findData`
// and `getData` serve `sys_metadata` / `sys_metadata_history` rows, whose
// `metadata` column is the same stored body, through the same redactor.
import {
    redactStoredMetadataRow,
    redactStoredMetadataRows,
    storedMetadataBodyGroupingRefusal,
    storedMetadataBodyPredicateRefusal,
    storedMetadataBodyProjection,
    ephemeralStoredHashDigest,
    serveStoredMetadataHashColumnRows,
    serveStoredMetadataHashColumns,
    storedMetadataHashEvaluateRefusal,
    type StoredHashDigest,
} from './metadata-redaction.js';
import type {
    StoredFlowCanonicalization,
    StoredMigrationReport,
} from './stored-migration.js';
import { collectDecisionModeReview } from './stored-migration.js';
// [#25467 cut 1] The bulk data writes (`batchData`, the `*ManyData` verbs, their
// loops and response builders); the methods of the same names below hand each
// body the members it reads (`BatchDataHost`).
import {
    batchData,
    buildBatchDataResponse,
    buildDeleteManyResponse,
    buildRolledBackBatchResponse,
    buildUpdateManyResponse,
    createManyData,
    deleteManyData,
    insertManyData,
    locateBatchCause,
    reconcileStoppedBatch,
    runAtomicBatch,
    runAtomicBatchData,
    runBatchDataLoop,
    runDeleteManyLoop,
    runUpdateManyLoop,
    updateManyData,
} from './protocol-batch-data.js';
// [#25467 cut 2] The metadata diagnostics sweep (`getMetaDiagnostics`); the method of
// the same name below hands the body the members it reads (`MetaDiagnosticsHost`).
import { getMetaDiagnostics } from './protocol-meta-diagnostics.js';
// [#25467 cut 3] The query validation (`assertObjectRegistered`, the `assert*FieldsExist`
// family, `refuseUnservedRelationTarget`, `servedExpand`); the methods of the same names
// below hand each body the members it reads (`QueryValidationHost`).
import {
    assertAggregationFieldsExist,
    assertExpandTargetsExist,
    assertFilterFieldsExist,
    assertGroupByFieldsExist,
    assertNoInternalFieldEvaluated,
    assertObjectRegistered,
    assertProjectionFieldsExist,
    assertQueryParamsAreFields,
    assertSearchFieldsAreSearchable,
    assertSortFieldsExist,
    refuseUnservedRelationTarget,
    resolveQueryFields,
    servedExpand,
    servesExpansionTarget,
} from './protocol-query-validation.js';
// [#25467 cut 4] The record reads (`assertRecordExists`, the OCC version checks,
// `readAsCaller`, `searchAll`, `omitInternalWriteFields`); the methods of the same
// names below hand each body the members it reads (`RecordReadHost`).
import {
    assertRecordExists,
    assertVersionMatch,
    assertVersionOf,
    omitInternalWriteFields,
    readAsCaller,
    searchAll,
} from './protocol-record-reads.js';
// [#25467 cut 5] The lock gate and the optimistic-concurrency write addresses
// (`getEffectiveLock`, `assertLockAllowsWrite`/`Delete`, `readVersionToken`, the
// draft and read addresses, `metadataConflictRefusal`); the methods of the same names
// below hand each body the members it reads (`LockVersionGateHost`).
import {
    assertLockAllowsDelete,
    assertLockAllowsWrite,
    getEffectiveLock,
    lockWriteRefusal,
    metadataConflictRefusal,
    packagelessDraftAddress,
    packagelessReadAddress,
    readLockGateOverlayLayer,
    readVersionToken,
    receiptVersion,
    recordMetadataAudit,
    recordPendingDenialAudit,
    storedHashDigest,
    storedHeadAt,
    storedParentForToken,
    strictDraftReadAddress,
} from './protocol-lock-version-gates.js';
// [#25467 cut 6] The save door's refusals (the item-name grammar, the default record
// page and external-binding refusals, the anonymous elevated-flow pair, the authored
// lock family, the write binding, the namespace prefix); the methods of the same names
// below hand each body the members it reads (`SaveDoorRefusalHost`).
import {
    anonymousElevatedFlowRefusal,
    authoredLockFamily,
    defaultRecordPageSaveRefusal,
    externalBindingDatasourceDefinition,
    externalBindingSaveRefusal,
    objectNamespacePrefixViolation,
    objectsBoundExternallyTo,
    permissionSetNameCollisionRefusal,
    refuseUngrammaticalMetaItemName,
    saveWriteBinding,
    seedExternalIdSaveRefusal,
    unknownDatasourceSaveRefusal,
    unknownGrantObjectSaveRefusal,
    unknownPicklistBindingSaveRefusal,
} from './protocol-save-door-refusals.js';
// [#25467 cut 7] Package install and update.
import {
    installPackage,
    packageInstallUndo,
    packagePersistService,
    updatePackage,
} from './protocol-package-install.js';
// [#25467 cut 8] The runtime authoring gate and the restored-body doors.
import {
    assertRuntimeAuthoringRules,
    draftPublishVerdict,
    refuseRestoredBodyTheSaveDoorRefuses,
    restoredBodyDerivation,
    restoredBodyWriter,
    runAuthoringGate,
} from './protocol-authoring-gate.js';
// [#25467 cut 9] The credential carry-forward and the credential channel lookup.
import {
    carryForwardRedactedCredentials,
    credentialChannelFor,
    restoredCredentialPathsFor,
    storedBodyForCarryForward,
} from './protocol-credential-carry-forward.js';
// [#25467 cut 10] The served lock state and the stored-row decline.
import {
    declinesStoredRow,
    isShippedFlowName,
    isStoredEntryOfDeclinedName,
    isStoredFlowEntryOfShippedName,
    isUnservedSealedOverlay,
    servedLockState,
} from './protocol-lock-state.js';
// [#25467 cut 11] The registry materialize/strip pair of the served object document.
import {
    governServedObject,
    materializeFromRegistry,
    stripMaterializedFromRegistry,
    stripServedObjectColumns,
} from './protocol-registry-materialize.js';
// [#25467 cut 12] The publish backfill pair: the judgement and the write half.
import { applyPublishBackfill, planPublishBackfill } from './protocol-publish-backfill.js';
// [#25467 cut 12] The `_drafts` list read and the one-draft discard.
import { discardDraftInItsScope, listDrafts } from './protocol-drafts.js';
// [#25467 cut 13] The package door's save refusal and the origin-gated removal verdict.
import {
    namedBaseCloseSubject,
    namedBaseOverlayWriteRefusal,
    originGatedRemovalRefusal,
    overrideWriteVerdict,
    packagelessOverlayWriteRefusal,
    refusePackagedBaseOverride,
} from './protocol-packaged-base-refusal.js';
import type {
    NamedBaseWriteOperation,
    NamedBaseWriteSubject,
    OverrideWriteSubject,
    OverrideWriteVerdict,
    WrittenPackageScope,
    PackagelessWriteOperation,
} from './protocol-packaged-base-refusal.js';
// [ADR-0146 D10, #28564] The `__c` extension-field reservation's one judge.
import {
    extensionFieldSuffixRefusalError,
    judgeExtensionFieldSuffix,
} from './protocol-extension-field-suffix.js';
// [#25467 cut 14] The publish batch's seed apply and its own pending declarations.
import { applySeedBodies, collectBatchPendingDeclarations } from './protocol-publish-batch.js';
// [#25467 cut 15] The artifact registry's lookups: an item's artifact, the packages that ship a type, and the lock's artifact layer.
import { artifactLockLayerAt, lookupArtifactItem, shippedArtifactsOf, shippingPackagesOf } from './protocol-artifact-lookup.js';
// [#25467 cut 16] The stored-overlay row reads: a type's active rows, their parsed entries, the names with a row of their own, and one item's rows.
import { namesWithOwnStoredRow, readActiveOverlayRows, readItemActiveRows, storedOverlayEntries } from './protocol-stored-overlay-reads.js';
// [#25467 cut 17] The object-owner verdicts: which contributor kind a stored object row registers as, and handing an adopted object's name to its rebound row.
import { classifyObjectContribution, releaseAdoptedObjectOwner } from './protocol-object-owner.js';
// [#25467 cut 18] The flow save's retired-spelling replay verdict (#23903 ruling B′): does a save newly introduce a retired spelling no stored row carries.
import { flowSaveReplaysRetired } from './protocol-flow-save-replay.js';
// [#25467 cut 19] A package write's validation scope: the written package and its declared dependency closure, from the registry.
import { resolveWritePackageScope } from './protocol-write-package-scope.js';
// [#28574, ADR-0146 D10] An object extension as an authorable item: the doors' gate, its shape schema, and the body every sync registers.
import {
    OBJECT_EXTENSION_TYPE,
    objectExtensionItemRefusal,
} from './protocol-object-extension-item.js';
import type { ObjectExtensionRegistry } from './protocol-object-extension-item.js';
// [#25467 cut 20] The code-layer read through the `metadata` service: package-scoped, singular/plural fallback, a stored object row's copy not counted as code.
import { readItemFromMetadataService } from './protocol-metadata-service-read.js';
// [#25467 cut 21] The boot report of the stored overlay rows no read serves because they overlay sealed managed content.
import { reportSealedOverlayRows } from './protocol-sealed-overlay-report.js';
// [#25467 cut 22] A row-less view name's expansion for the by-name read, and a container's expansion under its own name.
import { expandUnderOwnName, resolveRowlessExpandedView } from './protocol-view-expansion-names.js';
// [#25467 cut 23] The read-side conversion of a stored item: the ADR-0087 chain with its notices, and the warned-once read with the page `type` default.
import { convertStoredItem, convertStoredItemDetailed } from './protocol-stored-item-conversion.js';
// [#25467 cut 24] The live metadata-type listing: the SchemaRegistry's types and the `metadata` service's, de-duplicated.
import { listLiveMetadataTypes } from './protocol-live-metadata-types.js';
// [#25467 cut 24] The save door's 409 for a `ConflictError`, with its decision-audit row.
import { saveConflict } from './protocol-save-conflict.js';
// [#25467 cut 25] The post-persistence mutation fan-out: projector, local listeners, cluster publish, publish listeners.
import { emitMetaItemPublished, notifyMutationListenersLocal, publishMetadataMutation, runMutationProjector } from './protocol-mutation-fan-out.js';
// [#25467 cut 26] The runtime authoring gate's deployment-posture probes: org wall, tenancy, RLS keys, hierarchy.
import { hierarchyResolverMounted, orgWallEnforced, rlsMembershipResolverKeys, tenancyPostureInForce } from './protocol-authoring-posture-probes.js';
// [#25467 cut 27] The automation service's flow reads: the stored-flow canonicalizer and the engine's registrations.
import { flowRegistrationsOf, resolveFlowCanonicalizer, resolveFlowRegistrationReader } from './protocol-automation-flow-reads.js';
import { disabledActionsOf, resolveDisabledActionsReader } from './protocol-action-activation-reads.js';
// [#25467 cut 28] The code-datasource predicates: declared by an installed package, or registered by the host.
import { isDeclaredCodeDatasource, isHostCodeDatasource } from './protocol-code-datasource-predicates.js';
// [#25467 cut 29] The legacy-organization row filters: which rows a not-yet-migrated database still holds.
import { legacyOrganizationRowsOf, withoutLegacyOrganizationRows } from './protocol-legacy-organization-rows.js';
// [#25467 cut 30] The object-extender fold onto a MetadataService object body.
import { foldObjectExtendersFromRegistry } from './protocol-object-extender-fold.js';
// [#25467 cut 31] The disabled-package face of the by-name item read.
import { readMetaItemFace } from './protocol-meta-item-face.js';
// [#25467 cut 32] A stored commit row's `items` column read back as its revert plan.
import { parseCommitItems } from './protocol-commit-items.js';
// [#25467 cut 33] What a stored overlay row binds: the lock layer, the package binding, the external datasource.
import { overlayLockLayerAt, resolveOverlayPackageBinding, storedRowKnownDatasources } from './protocol-stored-row-bindings.js';
// [#25467 cut 33] Two degradations said out loud: the MetadataService 503 and the batch closure's once-per-process warn.
import { throwMetadataServiceUnavailable, warnClosureReadUnavailable } from './protocol-loud-degradations.js';
// [#25467 cut 33] The overlay-uniqueness indexes and the bundle-member backfill, once per process.
import { ensureOverlayIndex, ensureOverlayMembersBackfilled } from './protocol-overlay-index.js';
// [#25467 cut 33] The registry and view-container predicates: stored container expansion, binding, ownership, registry scope, overlaid views.
import { copiesOwnShippedViewContainer, expandStoredViewContainers, isAnotherPackagesObject, overlaidShippedContainerViewNames, registryTakesStoredRows, runtimeViewContainerObject } from './protocol-registry-view-predicates.js';
// [#25467 cut 33] The ADR-0067 commit row of a publish or revert turn, and its named INSERT.
import { persistPackageCommitRow, recordPackageCommit } from './protocol-package-commit-record.js';
// [#25467 cut 33] Package scope: the writable base, the named-base rule, storage teardown, the app package-id key.
import { isWritablePackage, resolveAppPackageIdKey, shouldDropStorage, uninstalledNamedBaseRefusal } from './protocol-package-scope.js';
// [#25467 cut 33] The /meta save door's refusal of a `:type` that is no metadata type at all.
import { refuseUnmintableMetaType } from './protocol-unmintable-meta-type.js';
// [#25467 cut 33] The deployment's SDUI component manifest, and the load-time page `requires` report against it.
import { reportPageRequiresAbsentAtLoad, resolveSduiManifest } from './protocol-sdui-manifest.js';
// [#25467 cut 35] The environment's own `sys_metadata` rows: the family read, the one-row read, the served row and the package-less address.
import { findEnvironmentRow, findEnvironmentRows, findServedOverlayRow, packagelessAddress, packagelessContentPackage } from './protocol-environment-rows.js';
// [#25467 cut 35] The stored rows of a collection, folded over the registered ones.
import { foldStoredCollection } from './protocol-stored-collection-fold.js';
// [#25467 cut 35] The environment-wide package uninstall verb.
import { deletePackage } from './protocol-package-uninstall.js';
// ADR-0146 D3 — the ensure door of a base's paired `.custom` package, and the
// pair-shaped-id predicate the duplicate asks before it reads a row.
import { ensureCustomizationPackage } from './protocol-customization-package.js';
// [#25467 cut 35] The unmanaged import: the names it would collide with, and the rollback of a failed one.
import { rollBackUnmanagedImport, unmanagedImportCollisions } from './protocol-unmanaged-import.js';
// [#27762] The own-reference rule for a datasource body's `external.credentialsRef` on the save door.
import { datasourceCredentialsRefSaveRefusal } from './protocol-datasource-credentials-ref.js';
// [#28355] The `denied` row the four single-item doors leave for a refusal that writes none of its own.
import { withRefusalAudit } from './protocol-refusal-audit.js';
// [#28665] The null-master rows a `controlled_by_parent` detail stops serving, counted into the finding that makes its master required.
// [#29510] `getMetaTypes()`'s named return type and the equality its pin reads.
import type { MetaTypesListing } from './protocol-meta-types-listing.js';
// [#25467 E0] The module preamble that stood here moved, verbatim, into the themed
// `protocol-*.ts` modules below. What this file exported from it, it still exports;
// the module order below is the order the rolled-up `.d.ts` keeps their declarations in.
// A byte-offset shift in this file can surface a class comment inside an inferred type
// of the published `.d.ts`: read its raw diff after any edit here.
import {
    canonicalMetaType,
    canonicalizeMetaRequestType,
} from './protocol-meta-type-schema.js';
export {
    canonicalMetaType,
    governServedItem,
    overlaySchemaDeclaredKey,
    stripServedSystemColumns,
} from './protocol-meta-type-schema.js';
import {
    isItemOfDisabledPackage,
    permissionSetOwnerBindingRefusal,
    runtimeHookWithoutBodyRefusal,
} from './protocol-authoring-refusals.js';
export {
    isActionWithheldByDisabledPackage,
    isItemOfDisabledPackage,
    isObjectOfDisabledPackage,
    noPendingDraftError,
    objectPackageDisabledError,
    permissionSetOwnerBindingRefusal,
    remainingRowsPhrase,
    runtimeHookWithoutBodyRefusal,
} from './protocol-authoring-refusals.js';
import type { MetadataIssueEntry } from './protocol-metadata-issues.js';
export { zodIssuesToMetadataIssues } from './protocol-metadata-issues.js';
export type { MetadataIssueEntry } from './protocol-metadata-issues.js';
import { readPublishBackfillRequest } from './protocol-publish-backfill-request.js';
import type { PublishBackfillEntry, PublishBackfillReceipt } from './protocol-publish-backfill-request.js';
export { PUBLISH_BACKFILL_PAGE_SIZE, publishBackfillRefusal } from './protocol-publish-backfill-request.js';
export type { PublishBackfillEntry, PublishBackfillReceipt } from './protocol-publish-backfill-request.js';
import { malformedFilterArrayError } from './protocol-data-request-shapes.js';
export { byIdUpdateRecord } from './protocol-data-request-shapes.js';
import {
    projectStorableViewBody,
    withDeclaredPageTypeDefault,
} from './protocol-view-normalization.js';
export {
    graftFoldedFormSections,
    graftNormalizedOperators,
    isPlainRecord,
    normalizeViewMetadata,
    projectStorableViewBody,
    withDeclaredPageTypeDefault,
} from './protocol-view-normalization.js';
import {
    stateTenantAuthorship,
} from './protocol-package-bindings.js';
import type {
    HydrationOptions,
    ShippingPackages,
    UnboundOwnerRefusalState,
    ViewContainerWrite,
} from './protocol-package-bindings.js';
export { withRowBinding } from './protocol-package-bindings.js';
export type { ShippingPackages } from './protocol-package-bindings.js';
import {
    bundleMemberDiscriminator,
    commitPlanKey,
    memberOption,
    resolveBundleMemberSelector,
} from './protocol-bundle-members.js';
import type { CommitPlanItem } from './protocol-bundle-members.js';
export {
    BUNDLE_MEMBER_MAX_LENGTH,
    BUNDLE_MEMBER_SELECTOR,
    bundleMemberDiscriminator,
    memberOption,
    resolveBundleMemberSelector,
} from './protocol-bundle-members.js';
export type { CommitPlanItem } from './protocol-bundle-members.js';
import { mergePackageAwareOverlay, rowMatchesOverlayWhere, servedViewExpansion } from './protocol-overlay-merge.js';
export {
    addressPackages,
    mergePackageAwareOverlay,
    rowMatchesOverlayWhere,
    servedOverlayRowCandidates,
    servedViewExpansion,
} from './protocol-overlay-merge.js';
export {
    ConcurrentUpdateError,
    MalformedVersionTokenError,
    canonicalVersionInstant,
} from './protocol-version-tokens.js';
import { CLONE_STRIP_FIELDS } from './protocol-write-constants.js';
export { FLOW_FALLBACK_VERDICT_NOT_REPLAYED } from './protocol-write-constants.js';
import {
    carryCatalogedErrorCode,
    clientFacingFailureCode,
    clientFacingFailureText,
    declaresClientRefusal,
    metadataReadFailureError,
} from './protocol-client-failures.js';
import type { BatchDataLoopOutcome, BatchDataRowResult } from './protocol-client-failures.js';
export {
    clientFacingFailureCode,
    clientFacingFailureText,
    declaresClientRefusal,
    metadataReadFailureError,
    metadataStoreUnavailableError,
    rowRequiredIdError,
    seedRequestValidationError,
    toRowApiError,
} from './protocol-client-failures.js';
export type { BatchDataLoopOutcome, BatchDataRowResult } from './protocol-client-failures.js';
import {
    RESERVED_LIST_QUERY_PARAMS,
    assertQueryParamArity,
    collectStoredMetadataFilterFields,
    conflictingQueryParamsError,
    countFlagValue,
    narrowStoredMetadataSearch,
    normalizeSortNodes,
    pageWindowValue,
    projectionFieldsValue,
    unusableFilterError,
} from './protocol-list-query-params.js';
export {
    FILTER_LOGICAL_KEYS,
    ODATA_SPELLING,
    QUERY_PARAM_NEAR_MISS,
    collectFilterReads,
    collectStoredMetadataFilterFields,
    invalidSortError,
    narrowStoredMetadataSearch,
    nearMissKey,
    quotedQueryValue,
    suggestFieldName,
} from './protocol-list-query-params.js';
export type { StoredMetadataSearchSchema } from './protocol-list-query-params.js';
import { SERVICE_CONFIG } from './protocol-discovery-services.js';
import type { MetadataWriteFace } from './protocol-write-face.js';
export { specValidationFindings } from './protocol-write-face.js';
export type { MetadataWriteFace } from './protocol-write-face.js';
import type {
    DeletePackageRequest,
    DeletePackageResponse,
    PublishMaterializeResult,
    PublishMaterializer,
    UninstallCleanup,
    UninstallCleanupOutcome,
    UninstallDeclared,
} from './protocol-package-lifecycle-types.js';
export { captureUninstallDeclared } from './protocol-package-lifecycle-types.js';
export type {
    DeletePackageRequest,
    DeletePackageResponse,
    PublishMaterializeResult,
    PublishMaterializer,
    UninstallCleanup,
    UninstallCleanupOutcome,
    UninstallDeclared,
} from './protocol-package-lifecycle-types.js';
import { METADATA_MUTATION_CLUSTER_CHANNEL } from './protocol-mutation-events.js';
import type {
    MetaItemPublishedEvent,
    MetadataMutationEvent,
    MetadataMutationProjector,
    MutationProjectionOutcome,
} from './protocol-mutation-events.js';
export { METADATA_MUTATION_CLUSTER_CHANNEL } from './protocol-mutation-events.js';
export type {
    ClusterMetadataMutationPayload,
    MetaItemPublishedEvent,
    MetadataMutationEvent,
    MetadataMutationProjector,
    MutationProjectionOutcome,
} from './protocol-mutation-events.js';
import type {
    MetadataAuthoringChannel,
    MetadataAuthoringGate,
    MetadataCredentialChannel,
} from './protocol-authoring-channel.js';
export type {
    MetadataAuthoringChannel,
    MetadataAuthoringGate,
    MetadataAuthoringGateContext,
    MetadataCredentialChannel,
} from './protocol-authoring-channel.js';
import { PREFLIGHT_AUDIT_CODE, withPendingAudit } from './protocol-audit-entry.js';
import type { MetadataAuditEntry, PreflightViolationCode } from './protocol-audit-entry.js';
export type { MetadataAuditEntry } from './protocol-audit-entry.js';
import { isNonCanonicalStoredType } from './protocol-stored-overlay-types.js';
import type { RowlessExpandedView, StoredOverlayEntry } from './protocol-stored-overlay-types.js';
export type { RowlessExpandedView, StoredOverlayEntry } from './protocol-stored-overlay-types.js';
import type {
    DeleteMetaItemRequest,
    PublishMetaItemRequest,
    RollbackMetaItemRequest,
    SaveMetaItemRequest,
} from './protocol-door-requests.js';
// [#25467 E1] The host a moved member body reaches this class through: the
// class builds it in its static block below, and a stub hands it to the body.
import { installProtocolHost, protocolHost } from './protocol-host.js';
// [#25467 E1] The host split's pilot: one member's whole body, moved through the host.
import { tenantAuthoredWriteRefusal } from './protocol-tenant-authored-write.js';
// [#25467 E2 cut 1a] The metadata list reads, and also the audit and UI-view reads.
import { auditMetaItem, getUiView } from './protocol-meta-audit-ui-view.js';
import {
    getMetaItems,
    getMetaItemsForExecution,
    getMetaItemsPerPackage,
    readFlattenedMetaItems,
} from './protocol-meta-list-reads.js';
// [#25467 E2 cut 1b] The metadata item reads and the layered reads.
import { getMetaItem, getMetaItemForExecution, readMetaItem } from './protocol-meta-item-reads.js';
import { getMetaItemLayered, packagelessLayeredReadRefusal } from './protocol-meta-layered-reads.js';
// [#25467 E2 section 3] The single-record data writes.
import { createData, deleteData, updateData, validateData } from './protocol-data-writes.js';
// [#29985 codemod] Class head: fields, stored-row conversion, resolvers, registration hooks, authoring gates, mutation pub/sub, overlay index: the members below delegate to its facet, `ProtocolClassHeadFacet`.
import { ProtocolClassHeadFacet } from './protocol-class-head.js';
// [#29985 codemod] Discovery, types, diagnostics, packaged bases, credential carry-forward: the members below delegate to its facet, `ProtocolDiscoveryAndBasesFacet`.
import { ProtocolDiscoveryAndBasesFacet, type PackagedArtifactBaseType } from './protocol-discovery-and-bases.js';
// [#29985 codemod] Data CRUD: the members below delegate to its facet, `ProtocolDataCrudFacet`.
import { ProtocolDataCrudFacet } from './protocol-data-crud.js';
// [#29985 codemod] Global search and the metadata cache: the members below delegate to its facet, `ProtocolSearchAndCacheFacet`.
import { ProtocolSearchAndCacheFacet } from './protocol-search-and-cache.js';
// [#29985 codemod] Write gates: overlay, code-only, organization, sealed and packaged-base refusals, locks, version tokens, conflict audit: the members below delegate to its facet, `ProtocolWriteGatesFacet`.
import { ProtocolWriteGatesFacet } from './protocol-write-gates.js';
// [#29985 codemod] Registry hydration, view expansion, write-through, object storage: the members below delegate to its facet, `ProtocolRegistryHydrationFacet`.
import { ProtocolRegistryHydrationFacet } from './protocol-registry-hydration.js';
// [#29985 codemod] Save refusals, saveMetaItem, saveConflict, migrateStoredMetadata: the members below delegate to its facet, `ProtocolSaveFacet`.
import { ProtocolSaveFacet } from './protocol-save.js';
// [#29985 codemod] History, publish, drafts, publish backfill: the members below delegate to its facet, `ProtocolHistoryAndPublishFacet`.
import { ProtocolHistoryAndPublishFacet } from './protocol-history-and-publish.js';
// [#29985 codemod] Package revert, duplicate, import, orphans, commits, revertCommit, rollback: the members below delegate to its facet, `ProtocolPackageCommitsFacet`.
import { ProtocolPackageCommitsFacet } from './protocol-package-commits.js';
// [#29985 codemod] Diff, deleteMetaItem, loadMetaFromDb, load reports, findReferencesToMeta: the members below delegate to its facet, `ProtocolDiffDeleteLoadFacet`.
import { ProtocolDiffDeleteLoadFacet } from './protocol-diff-delete-load.js';

/**
 * [#4435/#5138] The 404 a single-record operation answers when the id names no
 * row — the repo's ONE `RECORD_NOT_FOUND` envelope.
 *
 * [#7867] The body moved to `@objectstack/core`
 * (`utils/record-not-found.ts` — full provenance lives there); this is a
 * re-export, so every existing importer of
 * `@objectstack/metadata-protocol`'s `recordNotFoundError` is unchanged and
 * the three producers still share one function object.
 *
 * ⛔ Do not re-declare it here. It moved because a THIRD producer needed it and
 * could not reach this package: `ObjectQL.update()`/`delete()`'s by-id gate
 * lives in `packages/objectql`, whose `/core` entry closure is forbidden by
 * ADR-0076 D2's boundary ratchet from importing `@objectstack/metadata-protocol`
 * at all. A local copy here would be the second spelling #5138 ruled out.
 */
export { recordNotFoundError };

/**
 * The keys THIS file stamps onto every served document (`_diagnostics` via
 * `decorateMetadataItem`, `_draft` via the draft-preview overlay) — and the
 * strip that keeps them out of a persisted body (#4326) or a strict re-parse
 * (cloud#971).
 *
 * The list itself lives in `@objectstack/spec` because this module PRODUCES the
 * decoration while consumers in other layers (`service-automation`'s cold-boot
 * flow bind, …) have to REMOVE it: one shared definition is what stops the two
 * sides from drifting. See `spec/kernel/metadata-read-decorations.ts` for the
 * full rationale and for why the ADR-0010 protection envelope (`_lock`,
 * `_packageId`, …) is deliberately not stripped despite the shared spelling.
 *
 * Re-exported here so `@objectstack/metadata-protocol`'s public surface is
 * unchanged.
 */
export { stripReadDecorations };

/**
 * Implements the per-domain contracts this class ACTUALLY provides (ADR-0076
 * D10 — the facade never implemented the other domains; those live in their
 * owning services and are reached through the discovery `services` registry,
 * never through this class). Analytics left this list with the degraded shim
 * retirement (#3891) — the domain's one implementation is
 * `@objectstack/service-analytics`.
 */
export class ObjectStackProtocolImplementation implements
    DataProtocol, MetadataProtocol, PackageProtocol {
    private engine: MetadataHostEngine;
    private getServicesRegistry?: () => Map<string, any>;
    /**
     * Environment scope this protocol instance is bound to. It is a topology
     * declaration, not a row filter. ADR-0005 (revised 2026-05) gave every
     * environment its own physical database, so no saveMetaItem insert/update
     * writes an `environment_id` column and no loadMetaFromDb query constrains
     * on one — the isolation key that survived is `organization_id`, which is
     * what `ensureOverlayIndex` below indexes and what `loadMetaFromDb`'s own
     * where-clause names. Legacy rows may still carry the column; nothing here
     * reads it.
     *
     * [#6710] Topology ONLY. This key keeps every one of its other jobs — the
     * ADR-0005 overlay-whitelist gate, the ADR-0010 metadata-lock evaluation,
     * the SchemaRegistry hydration/listing posture, the local metadata-storage
     * provisioning decision — but it no longer decides whether the #4463
     * runtime authoring rules run. See {@link authoringChannel}.
     *
     * [#7674] …and no longer whether the #3050 pre-persistence authoring gate
     * runs either. The sentence above used to list "the #3050 authoring-gate
     * scope" among this key's surviving jobs, and that call site kept the
     * `environmentId !== undefined` wrapper #6710 had just retired next door —
     * so the identical proxy-signal defect outlived its own diagnosis on the
     * sibling gate. Both doors read {@link authoringChannel} now.
     *
     * [#23298] …and no longer, alone, whether a write registers its body into
     * the engine registry. That is {@link registryTakesStoredRows}, which also
     * reads {@link storeHydratedIntoRegistry}.
     */
    private environmentId?: string;

    /**
     * [#23298] Set by {@link loadMetaFromDb}: this protocol has hydrated its
     * own store into its engine registry, so every body the store holds is in
     * that registry already. Read by {@link registryTakesStoredRows} alone.
     */
    private storeHydratedIntoRegistry = false;

    /**
     * The declared authoring channel (#6710). Defaults to `'environment'`,
     * which is what makes the #4463 gate active on every kernel that does not
     * explicitly claim to be the package author's own bootstrap channel.
     *
     * Read by {@link assertRuntimeAuthoringRules} and, since #7674, by the
     * #3050 pre-persistence authoring gate's call site in {@link saveMetaItem}
     * — the two doors that ask "is this an AUTHOR publishing, or the package
     * author's own bootstrap?". It is deliberately NOT a general-purpose
     * authorization key: the ADR-0005 overlay-whitelist gate keeps reading
     * `environmentId`, because that one really is about row scope.
     */
    private authoringChannel: MetadataAuthoringChannel;

    /**
     * Lazily-instantiated SysMetadataRepository per organization. Keyed by
     * `${organizationId ?? '__env__'}`. Repositories are stateful — they
     * carry the per-org `seqCounter` and watch subscribers — so we cache
     * them rather than constructing one per call.
     */
    private overlayRepos = new Map<string, SysMetadataRepository>();

    /**
     * Publish-time materializers keyed by singular metadata type (ADR-0086 P2).
     * When a draft of a registered type is published, its body is projected
     * into a data-plane representation — e.g. service-automation's `flow`
     * materializer, which promotes the draft's credentials on publish. Domain
     * plugins own the projection (the generic protocol layer must not know the
     * data-plane shape), so they register here at init. Best-effort — a materializer failure is surfaced on
     * the publish response, never thrown (publishing metadata always succeeds
     * independently; the same contract as `seed` apply).
     */
    private publishMaterializers = new Map<string, PublishMaterializer>();

    /** [#2747] Named uninstall cleanups, run by {@link deletePackage}. */
    private uninstallCleanups = new Map<string, UninstallCleanup>();

    /**
     * Awaited per-type mutation projectors (ADR-0094), keyed by singular
     * metadata type. Unlike {@link publishMaterializers} (publish-only,
     * package door) a projector runs on EVERY persisted mutation of its type
     * — save, publish, delete — so a derived data-plane read-model can be a
     * pure projection with no unsynchronized door. One per type; a second
     * registration replaces the first (idempotent re-init).
     */
    private mutationProjectors = new Map<string, MetadataMutationProjector>();

    /**
     * Pre-persistence authoring gates (#3050). One per type; a second
     * registration replaces the first (idempotent re-init). Unlike
     * projectors these THROW to reject the write — see
     * {@link MetadataAuthoringGate}.
     */
    private authoringGates = new Map<string, MetadataAuthoringGate>();

    /** [#20790] Per-type write-only credential channels — see {@link registerCredentialChannel}. */
    private credentialChannels = new Map<string, MetadataCredentialChannel>();

    /**
     * Once-per-process dedupe for stored-row conversion notices
     * (`conversionId|type|name`). `getMetaItems`/`getMetaItem` re-read
     * sys_metadata on every call, so without this a single legacy row would
     * warn on every list request instead of once.
     */
    private storedConversionWarned = new Set<string>();

    /**
     * Once-per-process dedupe (`type|name`) for the warning `saveMetaItem`
     * emits when the flow canonicalizer throws and the save falls back to the
     * raw body (#4580). Studio autosaves the same draft over and over, and a
     * WIP cycle throws on every one of them.
     */
    private flowCanonicalizeFallbackWarned = new Set<string>();

    /**
     * [#20051] Once-per-process dedupe (`type|name`) for the warning
     * `saveMetaItem` emits when {@link projectStorableViewBody} does not converge
     * and a `view` is stored as its whole parse output. Same reason as the flow
     * dedupe above: Studio autosaves the same draft over and over.
     */
    private storableViewFallbackWarned = new Set<string>();

    /**
     * Canonicalize a stored `sys_metadata` body on rehydration (#3903;
     * ADR-0087 addendum "stored metadata replays the chain").
     *
     * Every seam that turns a row's `metadata` JSON into an in-memory item
     * funnels through here, so a row written under a past protocol is read
     * in today's canonical shape — parity with what the authored load path
     * has always done, extended by the full-chain replay data at rest needs
     * (a stored row has no author for a tombstone to teach).
     *
     * `flow` is deliberately skipped: flows canonicalize at
     * `AutomationEngine.registerFlow` — the execution seam — with the same
     * full-chain policy. (The reason this was first written for — the callout
     * rename's open-namespace conflict guard, which needed the engine's live
     * executor registry — retired with that guard; the conflict channel left
     * in protocol 18, #24001.)
     *
     * [#20101] …and a page that omits `type` is read with the default
     * `PageSchema` declares ({@link withDeclaredPageTypeDefault}). That fill is
     * applied HERE and not in {@link convertStoredItemDetailed}: it is not an
     * ADR-0087 conversion and emits no notice, so the stored-migration pass
     * (the Detailed caller) has nothing to rewrite, and the row at rest keeps
     * its bytes.
     */
    private convertStoredItem(type: string, data: unknown): unknown {
        // [#25467 cut 23] The body moved to `protocol-stored-item-conversion.ts` (see `StoredItemConversionHost`).
        const readStoredConversionWarned = () => this.storedConversionWarned;
        const host: ThisParameterType<typeof convertStoredItem> = {
            convertStoredItemDetailed: (...a) => this.convertStoredItemDetailed(...a),
            get storedConversionWarned() { return readStoredConversionWarned(); },
        };
        return convertStoredItem.call(host, type, data);
    }

    /**
     * {@link convertStoredItem} with the chain's notices handed back instead of
     * only logged — what {@link migrateStoredMetadata} reports per row (#4327).
     *
     * The notices ARE the change signal: a conversion emits exactly one per
     * rewrite it performs (ADR-0087 D2 "loud"), so an empty list means the row
     * is already canonical and there is nothing to persist. Comparing bodies
     * instead would be weaker — the pass is copy-on-write, so an untouched
     * branch is shared and a re-serialized identical body can still differ in
     * key order.
     *
     * [#17321] The TODOs ride along for the same caller. A conversion that
     * recognises a pre-protocol shape it cannot rewrite losslessly leaves the
     * site as stored and emits NO notice for it, so "no notices" alone means
     * "nothing to persist", never "on protocol": {@link migrateStoredMetadata}
     * reads `todos` to tell the two apart. They change nothing in `item`.
     *
     * [#25279] `knownDatasources` is handed to the chain for the refused-shape
     * listing ({@link storedRowKnownDatasources}); it changes nothing either.
     */
    private convertStoredItemDetailed(
        type: string,
        data: unknown,
        onNotice?: (notice: ConversionNotice) => void,
        knownDatasources?: ReadonlyMap<string, { readonly schemaMode?: unknown }>,
    ): { item: unknown; notices: ConversionNotice[]; todos: ConversionTodoNotice[] } {
        // [#25467 cut 23] The body moved to `protocol-stored-item-conversion.ts`.
        return convertStoredItemDetailed(type, data, onNotice, knownDatasources);
    }

    /**
     * [ADR-0015 §4.2 · #25279] The datasource a stored `object` row's
     * `external` binding names, as {@link externalBindingSaveRefusal} would
     * read it at that row's next save ({@link externalBindingDatasourceDefinition}),
     * for {@link migrateStoredMetadata}'s refused-shape listing.
     *
     * A stored object row reaches the conversion chain alone, so the listing's
     * `external` detector could answer only the primary half (`'default'`)
     * while the save door also refuses a binding on a stored or registered
     * managed datasource. Handed down here, the listing names the row exactly
     * when that door refuses it. `undefined` for any other row, a row with no
     * `external`, and a datasource no layer holds (no verdict, as at the door).
     * A read that fails propagates, as it does at the door.
     */
    private async storedRowKnownDatasources(
        singularType: string,
        body: unknown,
    ): Promise<ReadonlyMap<string, { readonly schemaMode?: unknown }> | undefined> {
        // [#25467 cut 33] The body moved to `protocol-stored-row-bindings.ts` (see `StoredRowBindingsHost`).
        const host: ThisParameterType<typeof storedRowKnownDatasources> = {
            externalBindingDatasourceDefinition: (...a) => this.externalBindingDatasourceDefinition(...a),
        };
        return storedRowKnownDatasources.call(host, singularType, body);
    }

    /**
     * Resolve a flow canonicalizer from the live services registry (#4498).
     *
     * `convertStoredItem` skips `flow` because a flow canonicalizes at the
     * automation engine, whose registration checks judge it against the live
     * node registry. #4454 built that capability as `AutomationEngine.canonicalizeStoredFlow` and handed
     * it to `migrateStoredMetadata` as an explicit hook, because the CLI has
     * to boot an engine of its own to hold one.
     *
     * Inside a server there is nothing to thread: this protocol is constructed
     * with an accessor for the kernel's service table (the same one
     * `analytics` and `package` are read from), and the automation service
     * registers itself under `automation`. So every caller running next to a
     * live engine can have the capability for free — which is what makes the
     * flow-skip fixable at `duplicatePackage` (a WRITE that was minting new
     * pre-protocol rows) rather than only at the CLI.
     *
     * Resolution is deliberately **lazy** — per call, never cached at
     * construction. Plugin init order is not guaranteed to put `automation`
     * in the table before the protocol is assembled (the CLI's
     * `buildDataMigrationPlugins` adds it after ObjectQL by design), and
     * caching `undefined` from a too-early read would silently disable flow
     * canonicalization for the life of the process.
     *
     * Returns `undefined` when no engine is reachable. That is a real state —
     * a control-plane or metadata-only host has no automation service — and
     * every caller must decide what it means for them rather than assume a
     * flow was handled.
     *
     * [#23775] `options` is handed through as given. Only the save door passes
     * one ({@link flowSaveReplaysRetired}); every other caller canonicalizes a
     * row or an artifact at rest and passes none, so the chain it gets replays
     * the retired entries, as before.
     */
    private resolveFlowCanonicalizer():
        ((name: string, body: unknown, options?: { includeRetired?: boolean }) => StoredFlowCanonicalization) | undefined {
        // [#25467 cut 27] The body moved to `protocol-automation-flow-reads.ts` (see `AutomationFlowReadsHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof resolveFlowCanonicalizer> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return resolveFlowCanonicalizer.call(host);
    }

    /**
     * [#23775, ADR-0087 addendum 2026-07-31] Does this flow save replay the
     * conversions retired from the authoring funnel? The predicate of the
     * maintainer's ruling B: a flow with NO stored row at the save's address is
     * authored input, judged as `normalizeStackInput` judges it — a retired
     * spelling stays in place and meets the parse refusal and its prescription
     * (`422 INVALID_METADATA`, located, the text `os validate` prints) — while a
     * re-save of a stored row keeps the full chain, so a legacy row stays
     * editable in Studio. The automation engine's rehydration is not asked.
     *
     * "A stored row at the save's address" is the row the save overwrites, as
     * the repository's `put` resolves it ({@link SysMetadataRepository.headAt}:
     * the state, the package, the inherited draft binding and the bundle
     * member), and for a draft save with no draft row yet the ACTIVE row the
     * draft overlays — the same baseline {@link authoredLockFamily} and
     * {@link storedBodyForCarryForward} read. The fallback is load-bearing:
     * Studio's flow designer saves drafts, so its first edit of a stored flow
     * has no draft row and would otherwise be judged as new. The mode does not
     * change the predicate, and the refusal it leads to is asked in draft and
     * publish mode alike. A flow a managed package ships never reaches here (it
     * is sealed, {@link refusePackagedBaseOverride}), so no code layer is read.
     *
     * Server-stated writes answer `true` without a read: their body is a row or
     * an artifact at rest, never a caller's. `source` set is a rewrite of a row
     * the store holds (the stored-metadata migration); a package duplicate
     * copies stored rows and an unmanaged import writes a built package's
     * flows, both canonicalized by their caller with the full chain first
     * wherever an engine is reachable. Judging them as authored would refuse,
     * on a host with no automation service only, the same body an engine host
     * accepts — the verdict split #21982 closed.
     *
     * Read with no `try`/`catch`, as the lock family's baseline is: a stored row
     * that could not be read is not an absent one.
     *
     * [#23903, ruling B′] A re-save is authored input too where its body NEWLY
     * INTRODUCES a retired spelling — an author or an AI adding a node with an
     * old spelling to a legacy flow. The rule compares conversion hits: a
     * retired entry that fires on the request at a site where it does not fire
     * on a stored row answers `false`, exactly as a new flow does; a request
     * whose every retired hit a stored row carries keeps the full chain, so a
     * served legacy body re-saves and is healed as before.
     *
     * A hit is one firing of a retired entry, named by the entry, the spelling
     * it rewrote (the notice's `from`) and its site: the notice's `path`, with
     * each array element on the way that carries an `id` (a node, a region's
     * node, an edge) named by that id instead of its index. So the same retired
     * spelling on a node the stored row does not have is a new hit even when
     * another node carries it, and adding, removing or moving a node never turns
     * a carried hit into a new one. Both bodies are scanned by the spec's own
     * pass (`applyConversionsToFlow`, the full chain minus
     * {@link FLOW_FALLBACK_VERDICT_NOT_REPLAYED}), never by the engine, so a
     * host with no automation service reaches the same answer (#21982).
     *
     * The rows that may carry a hit are the save's baseline above, and for a
     * DRAFT save the active row the draft overlays even when a draft row
     * exists. Studio keeps its buffer after a draft save: on an engine host the
     * first save heals the draft row, so the next autosave re-sends spellings
     * only the active row still carries, and judged against the draft row
     * alone Studio's second save of a legacy flow would be refused.
     */
    private async flowSaveReplaysRetired(request: {
        name: string;
        item?: unknown;
        packageId?: string | null;
        source?: string;
        writeFace?: MetadataWriteFace;
    }, mode: 'draft' | 'publish'): Promise<boolean> {
        // [#25467 cut 18] The body moved to `protocol-flow-save-replay.ts` (see `FlowSaveReplayHost`).
        const host: ThisParameterType<typeof flowSaveReplaysRetired> = {
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
        };
        return flowSaveReplaysRetired.call(host, request, mode);
    }

    /**
     * [#23316] The automation engine's verdict reader for a `flow` read — the
     * `registration` beside the item read's envelope and the `registrations`
     * beside the list's items (`FlowRegistrationSchema` in `@objectstack/spec`).
     *
     * The same seam as {@link resolveFlowCanonicalizer}: the kernel's service
     * table, read by name and per call, for the member the automation service
     * declares on `IAutomationService` (`getFlowRegistration`). This package
     * never imports the automation service, and resolution stays lazy for the
     * reason that docblock gives.
     *
     * `undefined` — so the read serves NO verdict — for every other type, and
     * where no reachable service declares the member: a control-plane or
     * metadata-only host judges no flow, and an absent field is how that is
     * said. ⛔ Never a third state the protocol makes up: the field is the
     * engine's answer or nothing. The answer is the engine of THIS process; no
     * cross-process store is read.
     */
    private resolveFlowRegistrationReader(type: string): ((name: string) => FlowRegistration) | undefined {
        // [#25467 cut 27] The body moved to `protocol-automation-flow-reads.ts` (see `AutomationFlowReadsHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof resolveFlowRegistrationReader> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return resolveFlowRegistrationReader.call(host, type);
    }

    /**
     * [#23316] The list's `registrations`: the engine's verdict per listed
     * item, keyed by its `name` — or nothing, where
     * {@link resolveFlowRegistrationReader} resolves no reader. A pending draft
     * (`_draft: true`, the `previewDrafts` overlay) gets no entry: no engine
     * holds a draft, exactly as the lock resolution above skips one.
     * `Object.fromEntries`, so a name is an own key whatever it spells.
     */
    private flowRegistrationsOf(type: string, items: readonly unknown[]): { registrations?: Record<string, FlowRegistration> } {
        // [#25467 cut 27] The body moved to `protocol-automation-flow-reads.ts` (see `AutomationFlowReadsHost`).
        const host: ThisParameterType<typeof flowRegistrationsOf> = {
            resolveFlowRegistrationReader: (...a) => this.resolveFlowRegistrationReader(...a),
        };
        return flowRegistrationsOf.call(host, type, items);
    }

    /**
     * [#27842] The data engine's packaged-action activation reader for an
     * `object` read — the `disabledActions` beside the item read's envelope
     * and beside the list's items (`GetMetaItemResponseSchema` in
     * `@objectstack/spec`): given an object body, the names in its
     * `actions[]` the activation ledger switches off.
     *
     * The seam {@link resolveFlowRegistrationReader} uses: the kernel's
     * service table, read by name per call, for the member the engine declares
     * on `IObjectQLEngine` (`getDisabledActions`). The slot is `objectql`, the
     * one the dispatch doors resolve before they refuse a switched-off action
     * 409 `ACTION_DISABLED`, so the read and the refusal answer from one
     * projection. This package never imports the engine. The engine is asked
     * once per call of this method, so one list read is one answer.
     *
     * `undefined` — so the read serves NO key — for every other type, where
     * no reachable engine declares the member, and where the engine answers
     * that no ledger is attached. ⛔ Never `[]` in those cases: absence is "no
     * ledger answered", and `[]` is the ledger's own "nothing here is off".
     */
    private resolveDisabledActionsReader(type: string): ((body: unknown) => string[]) | undefined {
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof resolveDisabledActionsReader> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return resolveDisabledActionsReader.call(host, type);
    }

    /** Docblock and body: {@link ProtocolClassHeadFacet.resolveCascadeDeleteObjects} in `protocol-class-head.ts` [#29985 codemod]. */
    private resolveCascadeDeleteObjects(type: string, name: string): string[] | undefined {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.resolveCascadeDeleteObjects(protocolHost(this), type, name);
    }

    /**
     * [#27842] The list's `disabledActions`: the reader's answer per listed
     * object, keyed by its `name` — or nothing, where
     * {@link resolveDisabledActionsReader} resolves no reader. A pending draft
     * (`_draft: true`, the `previewDrafts` overlay) gets no entry, as
     * {@link flowRegistrationsOf} gives it none.
     */
    private disabledActionsOf(type: string, items: readonly unknown[]): { disabledActions?: Record<string, string[]> } {
        const host: ThisParameterType<typeof disabledActionsOf> = {
            resolveDisabledActionsReader: (...a) => this.resolveDisabledActionsReader(...a),
        };
        return disabledActionsOf.call(host, type, items);
    }

    /**
     * [#20312] The deployment's ADR-0080 SDUI component manifest, when the host
     * registered one under {@link SDUI_MANIFEST_SERVICE} — `os serve` does, from
     * the CLI's `resolveSduiManifest`. Read per publish, exactly as
     * {@link resolveFlowCanonicalizer} reads `automation` and for its reason: a
     * host may register the key after this protocol is assembled, and a value
     * cached from a too-early read would switch the save door's page compile
     * off for the life of the process. A re-registered value is therefore seen
     * by the next publish.
     *
     * The same read serves the two other moments ADR-0080 §5 meets a page's
     * `requires`: the draft → active promotion ({@link promoteDraftForPublish}
     * re-stamps the promoted body) and the load of stored pages
     * ({@link loadMetaFromDb} reports a page naming a plugin the manifest does
     * not carry). One channel, three readers — never a second manifest read.
     *
     * `undefined` when nothing is registered: the save door then judges an html
     * page exactly as it did before the key existed, and the host that
     * registers nothing is the one that says so at boot. A registered value
     * that is not a manifest (no `components` map) is a host fault: it is
     * warned about once and read as nothing, never compiled against.
     */
    private resolveSduiManifest(): unknown {
        // [#25467 cut 33] The body moved to `protocol-sdui-manifest.ts` (see `SduiManifestHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const readUnusableSduiManifestWarned = () => this.unusableSduiManifestWarned;
        const writeUnusableSduiManifestWarned = (value: ObjectStackProtocolImplementation['unusableSduiManifestWarned']) => { this.unusableSduiManifestWarned = value; };
        const host: ThisParameterType<typeof resolveSduiManifest> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
            get unusableSduiManifestWarned() { return readUnusableSduiManifestWarned(); },
            set unusableSduiManifestWarned(value) { writeUnusableSduiManifestWarned(value); },
        };
        return resolveSduiManifest.call(host);
    }

    /** [#20312] One warn per process for an unusable registered manifest — see {@link resolveSduiManifest}. */
    private unusableSduiManifestWarned = false;

    /**
     * @param authoringChannel [#6710] which channel this kernel's metadata
     * writes arrive on. Omitted ⇒ `'environment'` ⇒ the #4463 runtime
     * authoring gate is ACTIVE. Only the genuine control-plane assembly passes
     * `'package-author'`. The default is the fail-safe direction on purpose:
     * a caller that forgets this argument gets more enforcement, never less.
     */
    constructor(
        engine: IDataEngine,
        getServicesRegistry?: () => Map<string, any>,
        environmentId?: string,
        authoringChannel: MetadataAuthoringChannel = 'environment',
    ) {
        this.engine = engine as MetadataHostEngine;
        this.getServicesRegistry = getServicesRegistry;
        this.environmentId = environmentId;
        this.authoringChannel = authoringChannel;
        // Fail at construction on a misconfigured read limit (`OS_DATA_*`), so a
        // typo is a boot fault naming the variable rather than a 500 on every
        // list read. `findData` reads the limits again per call.
        resolveQueryReadLimits();
    }

    // [#25467 E1] The one place that can read this class's private members builds
    // the host its moved bodies reach it through (`protocol-host.ts`). A static
    // block adds no member to the class: the published `.d.ts` does not move.
    static {
        installProtocolHost((protocol) => ({
            anonymousElevatedFlowRefusal: (...a) => protocol.anonymousElevatedFlowRefusal(...a),
            anotherPackageShips: (...a) => protocol.anotherPackageShips(...a),
            applyObjectRegistryMutation: (...a) => protocol.applyObjectRegistryMutation(...a),
            applyRegistryWriteThrough: (...a) => protocol.applyRegistryWriteThrough(...a),
            applyRemoteMetadataMutation: (...a) => protocol.applyRemoteMetadataMutation(...a),
            applySeedBodies: (...a) => protocol.applySeedBodies(...a),
            artifactLockLayerAt: (...a) => protocol.artifactLockLayerAt(...a),
            assertLockAllowsDelete: (...a) => protocol.assertLockAllowsDelete(...a),
            assertLockAllowsWrite: (...a) => protocol.assertLockAllowsWrite(...a),
            assertObjectRegistered: (...a) => protocol.assertObjectRegistered(...a),
            assertRuntimeAuthoringRules: (...a) => protocol.assertRuntimeAuthoringRules(...a),
            assertVersionMatch: (...a) => protocol.assertVersionMatch(...a),
            authoredLockFamily: (...a) => protocol.authoredLockFamily(...a),
            get authoringChannel() { return protocol.authoringChannel; },
            get authoringGates() { return protocol.authoringGates; },
            baseServesBundleMember: (...a) => protocol.baseServesBundleMember(...a),
            carryForwardRedactedCredentials: (...a) => protocol.carryForwardRedactedCredentials(...a),
            classifyObjectContribution: (...a) => protocol.classifyObjectContribution(...a),
            get clusterNodeId() { return protocol.clusterNodeId; },
            set clusterNodeId(value) { protocol.clusterNodeId = value; },
            get clusterPubSub() { return protocol.clusterPubSub; },
            set clusterPubSub(value) { protocol.clusterPubSub = value; },
            get clusterUnsubscribe() { return protocol.clusterUnsubscribe; },
            set clusterUnsubscribe(value) { protocol.clusterUnsubscribe = value; },
            codeOnlyCreateError: (...a) => ObjectStackProtocolImplementation.codeOnlyCreateError(...a),
            codeOnlyOverrideError: (...a) => ObjectStackProtocolImplementation.codeOnlyOverrideError(...a),
            convertStoredItem: (...a) => protocol.convertStoredItem(...a),
            convertStoredItemDetailed: (...a) => protocol.convertStoredItemDetailed(...a),
            copiesOwnShippedViewContainer: (...a) => protocol.copiesOwnShippedViewContainer(...a),
            credentialChannelFor: (...a) => protocol.credentialChannelFor(...a),
            get credentialChannels() { return protocol.credentialChannels; },
            declinesStoredRow: (...a) => protocol.declinesStoredRow(...a),
            defaultRecordPageSaveRefusal: (...a) => protocol.defaultRecordPageSaveRefusal(...a),
            detachMetadataMutationPubSub: (...a) => protocol.detachMetadataMutationPubSub(...a),
            diffMetaItem: (...a) => protocol.diffMetaItem(...a),
            disabledActionsOf: (...a) => protocol.disabledActionsOf(...a),
            discardDraftInItsScope: (...a) => protocol.discardDraftInItsScope(...a),
            draftPublishVerdict: (...a) => protocol.draftPublishVerdict(...a),
            dropObjectStorage: (...a) => protocol.dropObjectStorage(...a),
            dropStorageRemainingRowsRefusal: (...a) => ObjectStackProtocolImplementation.dropStorageRemainingRowsRefusal(...a),
            emitMetaItemPublished: (...a) => protocol.emitMetaItemPublished(...a),
            emitMetadataMutation: (...a) => protocol.emitMetadataMutation(...a),
            get engine() { return protocol.engine; },
            ensureObjectStorage: (...a) => protocol.ensureObjectStorage(...a),
            ensureOverlayIndex: (...a) => protocol.ensureOverlayIndex(...a),
            ensureOverlayMembersBackfilled: (...a) => protocol.ensureOverlayMembersBackfilled(...a),
            envWritableTypes: (...a) => ObjectStackProtocolImplementation.envWritableTypes(...a),
            get environmentId() { return protocol.environmentId; },
            expandRuntimeViewContainer: (...a) => protocol.expandRuntimeViewContainer(...a),
            expandStoredViewContainers: (...a) => protocol.expandStoredViewContainers(...a),
            expandUnderOwnName: (...a) => protocol.expandUnderOwnName(...a),
            externalBindingSaveRefusal: (...a) => protocol.externalBindingSaveRefusal(...a),
            findEnvironmentRow: (...a) => protocol.findEnvironmentRow(...a),
            findEnvironmentRows: (...a) => protocol.findEnvironmentRows(...a),
            findPairAddedMemberRow: (...a) => protocol.findPairAddedMemberRow(...a),
            findServedOverlayRow: (...a) => protocol.findServedOverlayRow(...a),
            get flowCanonicalizeFallbackWarned() { return protocol.flowCanonicalizeFallbackWarned; },
            flowRegistrationsOf: (...a) => protocol.flowRegistrationsOf(...a),
            flowSaveReplaysRetired: (...a) => protocol.flowSaveReplaysRetired(...a),
            foldObjectExtendersFromRegistry: (...a) => protocol.foldObjectExtendersFromRegistry(...a),
            getMetaItem: (...a) => protocol.getMetaItem(...a),
            getMetaItems: (...a) => protocol.getMetaItems(...a),
            getOverlayRepo: (...a) => protocol.getOverlayRepo(...a),
            getPackagedObjectBase: (...a) => protocol.getPackagedObjectBase(...a),
            get getServicesRegistry() { return protocol.getServicesRegistry; },
            governServedObject: (...a) => protocol.governServedObject(...a),
            historyMetaItem: (...a) => protocol.historyMetaItem(...a),
            hydrateExpandedViewItems: (...a) => protocol.hydrateExpandedViewItems(...a),
            hydrateOverlayIntoRegistry: (...a) => protocol.hydrateOverlayIntoRegistry(...a),
            installPackage: (...a) => protocol.installPackage(...a),
            isAnotherPackagesObject: (...a) => protocol.isAnotherPackagesObject(...a),
            isArtifactBacked: (...a) => protocol.isArtifactBacked(...a),
            isDeclaredCodeDatasource: (...a) => protocol.isDeclaredCodeDatasource(...a),
            isHostCodeDatasource: (...a) => protocol.isHostCodeDatasource(...a),
            isNestedArtifactField: (...a) => protocol.isNestedArtifactField(...a),
            isOverlayAllowed: (...a) => ObjectStackProtocolImplementation.isOverlayAllowed(...a),
            isRuntimeCreateAllowed: (...a) => ObjectStackProtocolImplementation.isRuntimeCreateAllowed(...a),
            isSealedManagedItem: (...a) => protocol.isSealedManagedItem(...a),
            isStoredEntryOfDeclinedName: (...a) => protocol.isStoredEntryOfDeclinedName(...a),
            isStoredFlowEntryOfShippedName: (...a) => protocol.isStoredFlowEntryOfShippedName(...a),
            isUnservedSealedOverlay: (...a) => protocol.isUnservedSealedOverlay(...a),
            isWritablePackage: (...a) => protocol.isWritablePackage(...a),
            legacyOrganizationRowsOf: (...a) => protocol.legacyOrganizationRowsOf(...a),
            listCommits: (...a) => protocol.listCommits(...a),
            listLiveMetadataTypes: (...a) => protocol.listLiveMetadataTypes(...a),
            lockWriteRefusal: (...a) => protocol.lockWriteRefusal(...a),
            lookupArtifactItem: (...a) => protocol.lookupArtifactItem(...a),
            mergesOverlayAtRead: (...a) => ObjectStackProtocolImplementation.mergesOverlayAtRead(...a),
            get metaItemPublishedListeners() { return protocol.metaItemPublishedListeners; },
            metadataConflictRefusal: (...a) => protocol.metadataConflictRefusal(...a),
            get metadataMutationListeners() { return protocol.metadataMutationListeners; },
            get mutationProjectors() { return protocol.mutationProjectors; },
            namedBaseOverlayWriteRefusal: (...a) => protocol.namedBaseOverlayWriteRefusal(...a),
            namesWithOwnStoredRow: (...a) => protocol.namesWithOwnStoredRow(...a),
            notifyMutationListenersLocal: (...a) => protocol.notifyMutationListenersLocal(...a),
            objectExtensionItemRefusal: (...a) => protocol.objectExtensionItemRefusal(...a),
            objectNamespacePrefixViolation: (...a) => protocol.objectNamespacePrefixViolation(...a),
            objectRegistrationRefusal: (...a) => protocol.objectRegistrationRefusal(...a),
            optimisticConflictAuditEntry: (...a) => ObjectStackProtocolImplementation.optimisticConflictAuditEntry(...a),
            organizationScopedWriteRefusal: (...a) => ObjectStackProtocolImplementation.organizationScopedWriteRefusal(...a),
            originGatedRemovalRefusal: (...a) => protocol.originGatedRemovalRefusal(...a),
            overlaidShippedContainerViewNames: (...a) => protocol.overlaidShippedContainerViewNames(...a),
            overlayLockLayerAt: (...a) => protocol.overlayLockLayerAt(...a),
            overlayPackageMismatchError: (...a) => ObjectStackProtocolImplementation.overlayPackageMismatchError(...a),
            get overlayRepos() { return protocol.overlayRepos; },
            overrideWriteVerdict: (...a) => protocol.overrideWriteVerdict(...a),
            packagedArtifactBase: (...a) => protocol.packagedArtifactBase(...a),
            packagedArtifactOwner: (...a) => protocol.packagedArtifactOwner(...a),
            packagedBaseRefusal: (...a) => protocol.packagedBaseRefusal(...a),
            packagelessAddress: (...a) => protocol.packagelessAddress(...a),
            packagelessDraftAddress: (...a) => protocol.packagelessDraftAddress(...a),
            packagelessOverlayWriteRefusal: (...a) => protocol.packagelessOverlayWriteRefusal(...a),
            packagelessReadAddress: (...a) => protocol.packagelessReadAddress(...a),
            pairOfAddedMember: (...a) => protocol.pairOfAddedMember(...a),
            parseCommitItems: (...a) => protocol.parseCommitItems(...a),
            permissionSetNameCollisionRefusal: (...a) => protocol.permissionSetNameCollisionRefusal(...a),
            probeRecord: (...a) => protocol.probeRecord(...a),
            promoteDraftForPublish: (...a) => protocol.promoteDraftForPublish(...a),
            get publishMaterializers() { return protocol.publishMaterializers; },
            publishMetadataMutation: (...a) => protocol.publishMetadataMutation(...a),
            readActiveOverlayRows: (...a) => protocol.readActiveOverlayRows(...a),
            readFlattenedMetaItems: (...a) => protocol.readFlattenedMetaItems(...a),
            readItemActiveRows: (...a) => protocol.readItemActiveRows(...a),
            readItemFromMetadataService: (...a) => protocol.readItemFromMetadataService(...a),
            readMetaItem: (...a) => protocol.readMetaItem(...a),
            readMetaItemFace: (...a) => protocol.readMetaItemFace(...a),
            readRevertableCommit: (...a) => protocol.readRevertableCommit(...a),
            readVersionToken: (...a) => protocol.readVersionToken(...a),
            receiptVersion: (...a) => protocol.receiptVersion(...a),
            reconcileViewExpansions: (...a) => protocol.reconcileViewExpansions(...a),
            recordMetadataAudit: (...a) => protocol.recordMetadataAudit(...a),
            recordOptimisticConflictAudit: (...a) => protocol.recordOptimisticConflictAudit(...a),
            recordPackageCommit: (...a) => protocol.recordPackageCommit(...a),
            recordPendingDenialAudit: (...a) => protocol.recordPendingDenialAudit(...a),
            refuseOrganizationScopedWrite: (...a) => ObjectStackProtocolImplementation.refuseOrganizationScopedWrite(...a),
            refusePackagedBaseOverride: (...a) => protocol.refusePackagedBaseOverride(...a),
            refusePackagedBaseRemoval: (...a) => protocol.refusePackagedBaseRemoval(...a),
            refuseUngrammaticalMetaItemName: (...a) => protocol.refuseUngrammaticalMetaItemName(...a),
            refuseUnmintableMetaType: (...a) => protocol.refuseUnmintableMetaType(...a),
            registerStoredObjectExtension: (...a) => protocol.registerStoredObjectExtension(...a),
            registeredTranslationBundle: (...a) => protocol.registeredTranslationBundle(...a),
            registryAllowsOverlay: (...a) => ObjectStackProtocolImplementation.registryAllowsOverlay(...a),
            registryMemberServedAt: (...a) => protocol.registryMemberServedAt(...a),
            registryTakesStoredRows: (...a) => protocol.registryTakesStoredRows(...a),
            releaseAdoptedObjectOwner: (...a) => protocol.releaseAdoptedObjectOwner(...a),
            reportPageRequiresAbsentAtLoad: (...a) => protocol.reportPageRequiresAbsentAtLoad(...a),
            reportSealedOverlayRows: (...a) => protocol.reportSealedOverlayRows(...a),
            resolveAppPackageIdKey: (...a) => protocol.resolveAppPackageIdKey(...a),
            resolveCascadeDeleteObjects: (...a) => protocol.resolveCascadeDeleteObjects(...a),
            resolveDisabledActionsReader: (...a) => protocol.resolveDisabledActionsReader(...a),
            resolveFlowCanonicalizer: (...a) => protocol.resolveFlowCanonicalizer(...a),
            resolveFlowRegistrationReader: (...a) => protocol.resolveFlowRegistrationReader(...a),
            resolveOverlayPackageBinding: (...a) => protocol.resolveOverlayPackageBinding(...a),
            resolveRowlessExpandedView: (...a) => protocol.resolveRowlessExpandedView(...a),
            resolveSduiManifest: (...a) => protocol.resolveSduiManifest(...a),
            resolveWritePackageScope: (...a) => protocol.resolveWritePackageScope(...a),
            restoreArtifactRegistryView: (...a) => protocol.restoreArtifactRegistryView(...a),
            restoreInjectedColumnEchoes: (...a) => protocol.restoreInjectedColumnEchoes(...a),
            restoreTranslatedObjectEchoes: (...a) => protocol.restoreTranslatedObjectEchoes(...a),
            restoreWriteFor: (...a) => protocol.restoreWriteFor(...a),
            restoredBodyWriter: (...a) => protocol.restoredBodyWriter(...a),
            restoredCredentialPathsFor: (...a) => protocol.restoredCredentialPathsFor(...a),
            resyncStoredObjectExtensions: (...a) => protocol.resyncStoredObjectExtensions(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => protocol.rethrowUnlessMetadataStoreUnprovisioned(...a),
            revertCommit: (...a) => protocol.revertCommit(...a),
            rollBackUnmanagedImport: (...a) => protocol.rollBackUnmanagedImport(...a),
            runAuthoringGate: (...a) => protocol.runAuthoringGate(...a),
            runMutationProjector: (...a) => protocol.runMutationProjector(...a),
            runPublishSideEffects: (...a) => protocol.runPublishSideEffects(...a),
            runtimeViewContainerObject: (...a) => protocol.runtimeViewContainerObject(...a),
            runtimeViewContainerPackage: (...a) => protocol.runtimeViewContainerPackage(...a),
            saveConflict: (...a) => protocol.saveConflict(...a),
            saveMetaItem: (...a) => protocol.saveMetaItem(...a),
            saveWriteBinding: (...a) => protocol.saveWriteBinding(...a),
            seedExternalIdSaveRefusal: (...a) => protocol.seedExternalIdSaveRefusal(...a),
            servedLockState: (...a) => protocol.servedLockState(...a),
            shippedArtifactsOf: (...a) => protocol.shippedArtifactsOf(...a),
            shippingPackagesOf: (...a) => protocol.shippingPackagesOf(...a),
            shipsBundleName: (...a) => protocol.shipsBundleName(...a),
            shouldDropStorage: (...a) => protocol.shouldDropStorage(...a),
            get storableViewFallbackWarned() { return protocol.storableViewFallbackWarned; },
            get storeHydratedIntoRegistry() { return protocol.storeHydratedIntoRegistry; },
            set storeHydratedIntoRegistry(value) { protocol.storeHydratedIntoRegistry = value; },
            storedFlowBindingAgrees: (...a) => protocol.storedFlowBindingAgrees(...a),
            storedHashDigest: (...a) => protocol.storedHashDigest(...a),
            storedOverlayEntries: (...a) => protocol.storedOverlayEntries(...a),
            storedParentForToken: (...a) => protocol.storedParentForToken(...a),
            storedRowKnownDatasources: (...a) => protocol.storedRowKnownDatasources(...a),
            strictDraftReadAddress: (...a) => protocol.strictDraftReadAddress(...a),
            stripServedObjectColumns: (...a) => protocol.stripServedObjectColumns(...a),
            tenantAuthoredWriteRefusal: (...a) => protocol.tenantAuthoredWriteRefusal(...a),
            throwMetadataServiceUnavailable: (...a) => protocol.throwMetadataServiceUnavailable(...a),
            get uninstallCleanups() { return protocol.uninstallCleanups; },
            uninstalledNamedBaseRefusal: (...a) => protocol.uninstalledNamedBaseRefusal(...a),
            unknownDatasourceSaveRefusal: (...a) => protocol.unknownDatasourceSaveRefusal(...a),
            unknownGrantObjectSaveRefusal: (...a) => protocol.unknownGrantObjectSaveRefusal(...a),
            unknownPicklistBindingSaveRefusal: (...a) => protocol.unknownPicklistBindingSaveRefusal(...a),
            unmanagedImportCollisions: (...a) => protocol.unmanagedImportCollisions(...a),
            viewContainerNameCollisionRefusal: (...a) => protocol.viewContainerNameCollisionRefusal(...a),
        }));
    }

    /**
     * Register a publish-time materializer for a metadata type (ADR-0086 P2).
     * Called by domain plugins at init (e.g. service-automation registers the
     * `flow` materializer). The singular type name is
     * used — `permissions` and `permission` both resolve here. One materializer
     * per type; a second registration replaces the first (idempotent re-init).
     */
    registerPublishMaterializer(type: string, materializer: PublishMaterializer): void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.registerPublishMaterializer(protocolHost(this), type, materializer);
    }

    /**
     * Register a named uninstall-time data-plane cleanup (ADR-0086 D3, #2747).
     * Called by domain plugins at init — e.g. plugin-security registers the
     * cleanup that revokes every grant naming a permission set the package
     * declared when the owning package is uninstalled, so grants are revoked
     * everywhere at once (no ghost grants). One cleanup per name; a
     * second registration replaces the first (idempotent re-init).
     */
    registerUninstallCleanup(name: string, cleanup: UninstallCleanup): void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.registerUninstallCleanup(protocolHost(this), name, cleanup);
    }

    /**
     * Run every registered uninstall cleanup for one package and report each
     * outcome (ADR-0086 D3, #2747) — THE one runner of the registry above.
     *
     * [#21490] Extracted from {@link deletePackage}, which calls it as its last
     * step, so that a door uninstalling a package the protocol never stored —
     * install-local's `DELETE /api/v1/marketplace/install-local/:manifestId`,
     * whose package has no `sys_packages` row and no `sys_metadata` rows —
     * runs the SAME cleanups after its own removal instead of none. Measured on
     * that door before this existed: the package's object answered 404 after a
     * restart while its `managed_by: package` `sys_permission_set` row and its
     * user grant survived. `deletePackage` itself does not fit that door: it
     * answers `success: false` when it deletes
     * no `sys_metadata` row, and withdraws the package from the running
     * registry, which that door never did.
     *
     * Best-effort per cleanup and never throws: a cleanup's failure is an
     * outcome (`success: false`), its text quoted only when the cleanup
     * declared a refusal. Ghost grants are a security condition, so every
     * caller surfaces a failed outcome — on its response, as `deletePackage`
     * does — and never swallows it.
     */
    async runUninstallCleanups(
        request: Pick<DeletePackageRequest, 'packageId' | 'actor'> & { declared?: UninstallDeclared },
    ): Promise<UninstallCleanupOutcome[]> {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.runUninstallCleanups(protocolHost(this), request);
    }

    /**
     * Register the awaited mutation projector for a metadata type (ADR-0094).
     * Called by the domain plugin that owns the derived read-model (e.g.
     * service-datasource registers the `datasource` projector). Singular or
     * plural type names both resolve.
     */
    registerMutationProjector(type: string, projector: MetadataMutationProjector): void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.registerMutationProjector(protocolHost(this), type, projector);
    }

    /**
     * Register the pre-persistence authoring gate for a metadata type
     * (ADR-0094 addendum seam; #3050). Called by domain plugins at init —
     * e.g. plugin-security registers the `object` OWD posture gate. The gate
     * THROWS to reject the write. Singular or plural type names both resolve;
     * one gate per type, a second registration replaces the first.
     */
    registerAuthoringGate(type: string, gate: MetadataAuthoringGate): void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.registerAuthoringGate(protocolHost(this), type, gate);
    }

    /**
     * [#20790] Register the write-only credential channel for a metadata type
     * (see {@link MetadataCredentialChannel}). Called by the domain plugin that
     * owns the type's credentials — the automation plugin registers `flow`'s.
     * Singular or plural type names both resolve; one channel per type, a
     * second registration replaces the first (idempotent re-init).
     */
    registerCredentialChannel(type: string, channel: MetadataCredentialChannel): void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.registerCredentialChannel(protocolHost(this), type, channel);
    }

    /** [#20790] The registered credential channel of `type`, if any. */
    private credentialChannelFor(type: string): MetadataCredentialChannel | undefined {
        // [#25467 cut 9] The body moved to `protocol-credential-carry-forward.ts` (see `CredentialCarryForwardHost`).
        const readCredentialChannels = () => this.credentialChannels;
        const host: ThisParameterType<typeof credentialChannelFor> = {
            get credentialChannels() { return readCredentialChannels(); },
        };
        return credentialChannelFor.call(host, type);
    }

    /**
     * [#20790] R2 — the body-derivation a restore passes to
     * `repo.restoreVersion`: the type's channel strip, so a restored version
     * that still holds a credential (one written before the move) never puts
     * it back at rest, and the channel keeps its current one. `undefined` for a
     * type with no channel — the history body is restored byte for byte.
     */
    private restoredBodyDerivation(type: string): ((body: unknown) => unknown) | undefined {
        // [#25467 cut 8] The body moved to `protocol-authoring-gate.ts` (see `AuthoringGateHost`).
        const host: ThisParameterType<typeof restoredBodyDerivation> = {
            credentialChannelFor: (...a) => this.credentialChannelFor(...a),
        };
        return restoredBodyDerivation.call(host, type);
    }

    /**
     * [#21470] What a restore passes to `repo.restoreVersion` as
     * `deriveRestoredBody`: the divergent `name` refusal FIRST, then
     * {@link restoredBodyDerivation}. A version stored before `saveMetaItem`
     * judged every type can carry a `name` that is not its row's; written back,
     * the write-through registers the row under that `name` and under none by
     * its own. `restoreVersion` calls this on the very history body it read,
     * before it reads the active row and before `put` — so a refused version
     * writes nothing, the position the credential strip already has. The
     * refusal is the save door's judge and envelope (`VALIDATION_ERROR` / 400):
     * `rollbackMetaItem` rethrows it, `revertCommit` reports it per item in
     * `failed[]`. A body that passes comes out of the strip, or byte for byte
     * where the type has no credential channel.
     *
     * [ADR-0086 D3] …and, second, the permission set's owner judge
     * ({@link permissionSetOwnerBindingRefusal}), with the same envelope: a
     * version stored before the save door judged `packageId` can carry one that
     * disagrees with the row it is restored into, and restoring it would make it
     * active with an owner nobody reads. `binding` is the active row's
     * `package_id`, which both callers read before the restore and which
     * `restoreVersion` → `put` keeps on the row it writes, so the judge and the
     * write read one binding.
     *
     * [#25278] …and, third, the save door's refusal family that runs after its
     * schema gate ({@link refuseRestoredBodyTheSaveDoorRefuses}), on the same
     * body and in the same position, so a refused version writes nothing.
     *
     * @param type The canonical (singular) type the row is restored under.
     * @param name The name the row is restored under.
     * @param binding The package binding of the active row the version is restored into (`null`: none).
     * @param source The restoring door, as the history row and the audit row record it.
     */
    private restoredBodyWriter(type: string, name: string, binding: string | null, source: string): (historyBody: unknown) => Promise<unknown> {
        // [#25467 cut 8] The body moved to `protocol-authoring-gate.ts` (see `AuthoringGateHost`).
        const host: ThisParameterType<typeof restoredBodyWriter> = {
            objectExtensionItemRefusal: (...a) => this.objectExtensionItemRefusal(...a),
            refuseRestoredBodyTheSaveDoorRefuses: (...a) => this.refuseRestoredBodyTheSaveDoorRefuses(...a),
            restoredBodyDerivation: (...a) => this.restoredBodyDerivation(...a),
        };
        return restoredBodyWriter.call(host, type, name, binding, source);
    }

    /** Docblock and body: {@link ProtocolClassHeadFacet.restoreWriteFor} in `protocol-class-head.ts` [#29985 codemod]. */
    private restoreWriteFor(
        singularType: string,
        name: string,
        binding: string | null,
        artifactBacked: boolean,
        source: string,
    ): { intent: 'override-artifact' | 'runtime-only'; deriveRestoredBody: (historyBody: unknown) => Promise<unknown> } {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.restoreWriteFor(protocolHost(this), singularType, name, binding, artifactBacked, source);
    }

    /**
     * [#25278] The save door's refusal family, asked of a history body a
     * restore is about to make the active row.
     *
     * `saveMetaItem` refuses these shapes after its schema gate. A restore
     * writes a stored version back, so a version saved before a refusal
     * existed, or one half of a pair whose other half has moved since, came
     * back live through `rollbackMetaItem` and `revertCommit`'s restore limb
     * with no refusal at all. Each is asked here through the save door's own
     * judge, with its envelope, in the save door's order, ⛔ never a copy of a
     * rule:
     *
     *  - [harden] a permission set whose name a different owner already holds
     *    ({@link permissionSetNameCollisionRefusal}, `NAMESPACE_CONFLICT` /
     *    422), judged against `binding` — the binding the restore lands in:
     *    `restoreVersion` → `put` keeps the active row's `package_id`, and with
     *    no active row it writes the package-unbound row, which `null` names.
     *    The save door asks it before its schema gate, so it is asked first
     *    here. A version restored after another owner took the name — its set
     *    deleted, then a package declaring the name installed — is refused
     *    rather than made a second holder;
     *  - a hook with no `body` ({@link runtimeHookWithoutBodyRefusal});
     *  - a second default record page of an object
     *    ({@link defaultRecordPageSaveRefusal});
     *  - an `external` object binding on a datasource this environment holds as
     *    managed, from either side of the pair
     *    ({@link externalBindingSaveRefusal}): a datasource restored to managed
     *    while objects bind it `external` is refused naming them, and an
     *    object restored `external` on a datasource that is managed now is
     *    refused at `external`;
     *  - [#26724] an object restored with a `datasource` that names no
     *    datasource here, when that is not the binding it holds now
     *    ({@link unknownDatasourceSaveRefusal});
     *  - [#28990] a permission set restored with a grant on an object that
     *    does not exist here, when the set does not hold that grant now
     *    ({@link unknownGrantObjectSaveRefusal});
     *  - [#29898] an object (or object extension) restored with a field bound
     *    to a picklist no loaded package declares, when the object does not
     *    hold that binding now ({@link unknownPicklistBindingSaveRefusal});
     *  - [#27818] a datasource restored with an `external.credentialsRef` the
     *    active row it is restored into does not hold now
     *    ({@link datasourceCredentialsRefSaveRefusal}, in its restore words);
     *  - a `runAs: 'system'` flow an anonymous endpoint names
     *    ({@link anonymousElevatedFlowRefusal}): a restore writes an ACTIVE
     *    row, the case the save door asks it of;
     *  - the shared runtime authoring rules
     *    ({@link assertRuntimeAuthoringRules}), judged as an `active` write
     *    bound to the row's own package, and told which credentials the
     *    write-only channel holds — the restore keeps them (R2) — as the draft
     *    promotion tells it; [#29696] a flow version judged in its
     *    D2-converted spelling (`storedFlowVerdictBody`), as the promotion
     *    judges a flow draft, and restored as stored;
     *  - the authoring gate a domain plugin registers
     *    ({@link runAuthoringGate}), on the channel the save door asks it on.
     *
     * Not asked, each for its reason:
     *
     *  - the schema gate itself. A history body is a stored row, and whether
     *    today's parse may refuse a stored version is the ADR-0087 stored-shape
     *    question (stored rows keep their conversion path), which this does
     *    not decide. Every judge above reads its body defensively, and the
     *    runtime gate reports a rule that throws instead of blocking on it.
     *  - ADR-0070 D1's read-only-base create refusal
     *    (`SysMetadataRepository.readOnlyBaseCreateError`). D1 judges a
     *    package a caller NAMES for a new item; a restore names none and
     *    writes into the active row's own binding, which `put` keeps. `put`'s
     *    package-door note records why D1 is not extended to the doors that
     *    carry a row's own binding: it would refuse the repair of legacy
     *    package-bound rows.
     *  - the credential channel's `store` refusal. A restore stores no
     *    credential: the channel keeps its current one
     *    ({@link restoredBodyDerivation}).
     *
     * The runtime gate's advisories are not carried: neither restore receipt
     * declares a key for them, and adding one is a response-shape change.
     *
     * Asked from {@link restoredBodyWriter} inside `restoreVersion`, before it
     * reads the active row or puts, so a refused version writes nothing.
     * `rollbackMetaItem` rethrows the refusal; `revertCommit` reports it per
     * item in `failed[]`, judged against the store as each item reaches it.
     */
    private refuseRestoredBodyTheSaveDoorRefuses(
        type: string,
        name: string,
        body: unknown,
        binding: string | null,
        source: string,
    ): Promise<void> {
        // [#25467 cut 8] The body moved to `protocol-authoring-gate.ts` (see `AuthoringGateHost`).
        const readAuthoringChannel = () => this.authoringChannel;
        const host: ThisParameterType<typeof refuseRestoredBodyTheSaveDoorRefuses> = {
            anonymousElevatedFlowRefusal: (...a) => this.anonymousElevatedFlowRefusal(...a),
            assertRuntimeAuthoringRules: (...a) => this.assertRuntimeAuthoringRules(...a),
            get authoringChannel() { return readAuthoringChannel(); },
            credentialChannelFor: (...a) => this.credentialChannelFor(...a),
            defaultRecordPageSaveRefusal: (...a) => this.defaultRecordPageSaveRefusal(...a),
            externalBindingSaveRefusal: (...a) => this.externalBindingSaveRefusal(...a),
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            permissionSetNameCollisionRefusal: (...a) => this.permissionSetNameCollisionRefusal(...a),
            runAuthoringGate: (...a) => this.runAuthoringGate(...a),
            unknownDatasourceSaveRefusal: (...a) => this.unknownDatasourceSaveRefusal(...a),
            unknownGrantObjectSaveRefusal: (...a) => this.unknownGrantObjectSaveRefusal(...a),
            unknownPicklistBindingSaveRefusal: (...a) => this.unknownPicklistBindingSaveRefusal(...a),
            seedExternalIdSaveRefusal: (...a) => this.seedExternalIdSaveRefusal(...a),
        };
        return refuseRestoredBodyTheSaveDoorRefuses.call(host, type, name, body, binding, source);
    }

    /**
     * Run the registered authoring gate for an about-to-persist body (#3050).
     * No-op when no gate is registered for the type. A gate throw PROPAGATES
     * (with its status/code) — that is the contract: the write is rejected
     * before persistence. Resolves the artifact-backed flag and the packaged
     * declaration body (the baseline an overlay customizes) for the gate.
     */
    private runAuthoringGate(evt: {
        type: string; name: string; state: 'draft' | 'active'; body: unknown;
    }): Promise<void> {
        // [#25467 cut 8] The body moved to `protocol-authoring-gate.ts` (see `AuthoringGateHost`).
        const readAuthoringGates = () => this.authoringGates;
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof runAuthoringGate> = {
            get authoringGates() { return readAuthoringGates(); },
            get engine() { return readEngine(); },
            isArtifactBacked: (...a) => this.isArtifactBacked(...a),
        };
        return runAuthoringGate.call(host, evt);
    }

    /**
     * The #4463 runtime authoring gate — the fourth door.
     *
     * Runs the SHARED author-time rule registry (`@objectstack/lint`'s
     * `AUTHORING_RULES`, the same table `os validate` / `os build` / `os lint`
     * run) over a body about to go `active`, and throws the 422 its gating
     * findings earn. Draft saves are never gated (D1) — publishing the draft
     * runs this.
     *
     * Deliberately NOT a {@link registerAuthoringGate} registration: those are
     * per-type and single-slot, owned by the domain plugin that registers them
     * (plugin-security holds `object`). This is the platform's own gate and it
     * must be unconditional — a plugin cannot displace it, and no surface can
     * skip it, because every surface reaches this class.
     *
     * The rules resolve names against the LIVE object universe, which is
     * strictly better information than the CLI's single-package view — the
     * inversion #4463 D2 points out: the same rule can be more decisive here
     * than it can be at build time.
     *
     * [#6285 / #6155 Q3=A] It also supplies the two DEPLOYMENT facts the CLI
     * cannot know and the shared registry therefore must not read: the
     * organization partition this write lands in, and whether this deployment
     * enforces an organization wall. Both are gathered here — the impure side —
     * and passed as arguments, so `evaluateRuntimeAuthoringGate` stays a pure
     * function of its inputs and a test can drive both postures without
     * mutating the process.
     *
     * [#4717] Throws on the gating half, RETURNS the advisory half. Advisories
     * do not block anything, so the only honest place for them is the 2xx the
     * write earns — `saveMetaItem` attaches them to its response, and since
     * #9176 the draft→active promotion does the same: `promoteDraftForPublish`
     * hands the findings out and `publishMetaItem` attaches them, so both
     * write doors report what D1 makes both of them measure. [#9343] The batch
     * route `publishPackageDrafts` reports them too, per `published[]` element
     * — one gate, two doors, one receipt vocabulary.
     * Returns an empty array on every early return: no rules ran, so there is
     * nothing to report, and "clean" is told apart from "nothing ran" by the
     * gate's own `rulesRun`, not by this.
     */
    private assertRuntimeAuthoringRules(evt: {
        type: string; name: string; state: 'draft' | 'active'; body: unknown; source?: string;
        /**
         * [#9612] The package this write belongs to (`saveMetaItem`'s
         * `packageId`, or the promoted draft row's). It decides the CLOSURE the
         * write is judged against — see {@link resolveWritePackageScope}.
         * Absent, unknown to the registry, or the `sys_metadata` overlay
         * sentinel ⇒ nothing is narrowed.
         */
        packageId?: string | null;
        /**
         * [#10377] The declarations this write's own BATCH is publishing
         * alongside it, when the caller HAS a batch. Only
         * `publishPackageDrafts` does; every other door writes one item, so its
         * closure is the live universe and it states nothing here.
         *
         * Threaded rather than gathered: the batch's pending drafts are
         * `sys_metadata` rows the caller has already listed and is about to
         * consume, and re-deriving them from this side would mean guessing
         * WHICH batch a write belongs to — which is the question the caller is
         * the only one holding the answer to.
         */
        pending?: RuntimePendingDeclarations;
        /**
         * [#20611] How to learn the positions in `body` that this write's
         * carry-forward will fill from the stored row — the credentials the read
         * path withheld, which a body saved back after a read arrives without.
         * Stated by `saveMetaItem`, the one door whose body can arrive that way,
         * and [#20790] by the draft→active promotion for a type with a
         * write-only credential channel: the stored draft row holds what its own
         * save carried forward, but not what that save moved into the channel.
         *
         * A function, called only once the gate is known to run (after the
         * early returns below): a draft save, the package-author channel and
         * the `migrate-stored` pass pay no stored-row read for it. ⛔ It is NOT
         * wrapped in the best-effort guard the collections get: a stored-row read
         * that fails fails this save, as the carry-forward's own read does —
         * answering "nothing is stored" instead would refuse a signed flow's
         * round trip for a secret it still holds.
         */
        restoredCredentialPaths?: () => Promise<readonly string[]>;
    }): Promise<RuntimeAuthoringIssue[]> {
        // [#25467 cut 8] The body moved to `protocol-authoring-gate.ts` (see `AuthoringGateHost`).
        const readAuthoringChannel = () => this.authoringChannel;
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof assertRuntimeAuthoringRules> = {
            get authoringChannel() { return readAuthoringChannel(); },
            get engine() { return readEngine(); },
            foldStoredCollection: (...a) => this.foldStoredCollection(...a),
            hierarchyResolverMounted: (...a) => this.hierarchyResolverMounted(...a),
            orgWallEnforced: (...a) => this.orgWallEnforced(...a),
            resolveSduiManifest: (...a) => this.resolveSduiManifest(...a),
            resolveWritePackageScope: (...a) => this.resolveWritePackageScope(...a),
            rlsMembershipResolverKeys: (...a) => this.rlsMembershipResolverKeys(...a),
            tenancyPostureInForce: (...a) => this.tenancyPostureInForce(...a),
        };
        return assertRuntimeAuthoringRules.call(host, evt);
    }

    /**
     * [#26707] What publishing a stored draft would answer from the runtime
     * authoring gate, without publishing it: the refusal's `issues` (rule id,
     * path, message, exactly as the publish 422 carries them), or `[]` when
     * the publish would pass the gate.
     *
     * The draft save stays ungated (#4463 D1): a draft may be half-finished and
     * is stored as before. What changes is what its READ says about it. The
     * draft's `_diagnostics` used to be the schema parse alone, so a draft the
     * publish refuses (`expression-invalid` on a flow edge, a summary field
     * with no operations, …) read `valid: true` in every editor until the
     * author pressed Publish, and in a package publish it rolled back every
     * other draft with it.
     *
     * One judgement, never a second copy of the rules: this reads
     * `judgeRuntimeAuthoringRules`, the function the publish gate
     * ({@link assertRuntimeAuthoringRules}) throws from, with the arguments the
     * draft→active promotion states — the draft row's package (whose other
     * drafts are the closure "Publish all" judges it against, read by the
     * batch door's own collector) and the credential channel's held positions.
     * Computed on every draft read rather than stored at save: the verdict
     * depends on the live universe and the package's other drafts, which a
     * stored verdict would not see change.
     *
     * [#27444] An object draft is also told the namespace-prefix verdict
     * ({@link objectNamespacePrefixViolation}, `NAMESPACE_PREFIX`), the one
     * rule outside the gate that the promotion doors refuse a draft on — the
     * same judge, on the draft row's package, never a copy of it.
     *
     * [#29557] …and on the body the promotion judges: a flow draft in its
     * D2-converted spelling (`storedFlowVerdictBody`, the save door's seam).
     */
    private draftPublishVerdict(draft: {
        type: string; name: string; body: unknown; packageId: string | null;
    }): Promise<RuntimeAuthoringIssue[]> {
        const readAuthoringChannel = () => this.authoringChannel;
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof draftPublishVerdict> = {
            get authoringChannel() { return readAuthoringChannel(); },
            get engine() { return readEngine(); },
            collectBatchPendingDeclarations: (...a) => this.collectBatchPendingDeclarations(...a),
            credentialChannelFor: (...a) => this.credentialChannelFor(...a),
            foldStoredCollection: (...a) => this.foldStoredCollection(...a),
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            hierarchyResolverMounted: (...a) => this.hierarchyResolverMounted(...a),
            objectNamespacePrefixViolation: (...a) => this.objectNamespacePrefixViolation(...a),
            orgWallEnforced: (...a) => this.orgWallEnforced(...a),
            resolveSduiManifest: (...a) => this.resolveSduiManifest(...a),
            resolveWritePackageScope: (...a) => this.resolveWritePackageScope(...a),
            rlsMembershipResolverKeys: (...a) => this.rlsMembershipResolverKeys(...a),
            tenancyPostureInForce: (...a) => this.tenancyPostureInForce(...a),
        };
        return draftPublishVerdict.call(host, draft);
    }

    /**
     * [#15950] Fold the STORED half of a resolution universe onto the registry
     * half {@link assertRuntimeAuthoringRules} gathers.
     *
     * ## Why a second half exists at all
     *
     * `RuntimeStackContext` declares every one of these collections as the
     * **live** declarations — `runtime-gate.ts`'s own words for `datasets` are
     * "The live dataset declarations (stack key `datasets`)" — and live
     * metadata has TWO homes in this platform, not one: the SchemaRegistry,
     * which code packages fill at boot, and `sys_metadata`, which every runtime
     * author writes to. {@link getMetaItems} — the read API behind
     * `GET /meta/:type` — has always answered from both and merged them. This
     * gate answered from the registry alone.
     *
     * For `object` the two rarely disagree, because
     * {@link applyRegistryWriteThrough}'s object branch registers
     * unconditionally. For every OTHER type that branch returns early on an
     * environment-scoped kernel (and {@link hydrateOverlayIntoRegistry} declines
     * an org-scoped row on any kernel), so a `PUT /meta/dataset` that answers
     * `200` leaves the registry untouched until the next boot re-hydrates it.
     * Measured on the card's shape, in one instant: the row is in the store,
     * `GET /meta/dataset` returns it with `_diagnostics.valid: true`, and
     * `registry.listItems('dataset')` returns only the five code-package
     * datasets — so a dashboard bound to it collected one phantom
     * `widget-dataset-unknown` per widget, with a hint enumerating everything
     * except the artifact the author had just saved, until the process
     * restarted. The 422 and the 200 were two readers disagreeing about the
     * same word, and the side that was wrong is this one: the lint contract
     * says "live", and the registry alone is not that.
     *
     * ## The fold is the READ API's own merge — [#16224]
     *
     * #15950's repair contributed store-only NAMES and never displaced a
     * registry entry, and it wrote the residual that left into this docblock:
     * where an overlay REDEFINES a code-package item, the gate still judged
     * that item's CONTENT from the registry's version. #16224 measured that
     * residual end to end and it is worse than one phantom. A code package
     * ships `dataset/D` with measure `m`; an env-wide overlay redefines `D`
     * without `m`. In ONE instant the gate ACCEPTED a widget bound to `m`,
     * which the runtime cannot serve, and REFUSED a widget bound to the measure
     * the overlay does declare, which it can — an acceptance that should have
     * been a refusal and a refusal that should have been an acceptance, from
     * one cause: a body nobody serves.
     *
     * So the additive merge is gone and {@link mergePackageAwareOverlay} — the
     * merge {@link getMetaItems} performs, with the transform it performs it
     * with — is what runs here. Two readers of the word "live" now read through
     * one function.
     *
     * ⛔ That is NOT the reversal it can look like. The argument against
     * additivity's alternative was never "an overlay must not win"; it was
     * "an UNRESOLVED body must not win" — the registry's copy of an `object` is
     * the RESOLVED schema (ADR-0029 D9.2: a base layer with its `extend`
     * contributors folded on) while a `sys_metadata` row is the base layer
     * alone, so a raw row displacing the resolved body would make a field
     * reference that resolves today read as dangling. That argument names its
     * own remedy in the same breath, and {@link getMetaItems} has always
     * applied it: run {@link foldObjectExtendersFromRegistry} on the winner.
     * The distinction is therefore kept by FOLDING rather than by declining,
     * and it is pinned as such — `protocol.runtime-gate-stored-universe.test.ts`
     * asserts that an `object` overlay wins on its own columns AND keeps the
     * registry's `extend` contributors.
     *
     * The universe still only ever grows a NAME: for a name the registry does
     * not carry, this is byte-for-byte #15950's additive contribution, and that
     * arm is pinned alongside the redefinition arm in the same process.
     *
     * ## What the read is scoped to
     *
     * `state: 'active'` only. A draft must not resolve: #7529's ruling is
     * refuse-at-publish precisely so an author can write the widget first and
     * the dataset second, and a draft dataset satisfying a board's binding
     * would publish a board that cannot render.
     *
     * Env-wide rows plus, when the write has one, this write's own
     * organization — the same two-tier read {@link getMetaItems} performs, and
     * the same partition the write itself lands in. No other org's overlays are
     * visible here, on any kernel.
     *
     * ⛔ No disabled-package filter, and that is deliberate rather than
     * forgotten: `getMetaItems` applies one, and the comment on it says in as
     * many words that the registry primitives keep serving a disabled package's
     * items so that "migrations, cross-package references and the runtime
     * authoring gate (`protocol.ts` resolution context) still see a complete
     * object universe". Filtering here would make the stored half narrower than
     * the registry half it is folded onto.
     *
     * ## Degradation — the invariant, and the half of it that was missing
     *
     * "Never let context-gathering fail a write" still holds: nothing here
     * throws, and a store this host cannot read leaves the caller with the
     * registry half it would have had anyway. What is NOT kept is the other
     * behaviour of the `catch {}` above — degrading into something that reads
     * like a smaller universe with nothing said. A missing table is the one
     * benign case (`isMissingTableError`, the declared discriminator: an
     * unprovisioned `sys_metadata` genuinely holds no rows, so the registry
     * half IS the whole answer); any other failure is reported once, because a
     * gather that silently shrinks is how a phantom refusal is manufactured,
     * and this method exists because of one.
     *
     * `warn`, not `error`, per this repo's degradation rule: no write claims to
     * have persisted anything it did not. The consequence is a possible wrong
     * verdict on the NEXT reference, and the message says so.
     */
    private async foldStoredCollection(
        registered: unknown[],
        singularType: string,
        pluralType: string,
    ): Promise<unknown[]> {
        // [#25467 cut 35] The body moved to `protocol-stored-collection-fold.ts` (see `StoredCollectionFoldHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof foldStoredCollection> = {
            convertStoredItem: (...a) => this.convertStoredItem(...a),
            get engine() { return readEngine(); },
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            foldObjectExtendersFromRegistry: (...a) => this.foldObjectExtendersFromRegistry(...a),
        };
        return foldStoredCollection.call(host, registered, singularType, pluralType);
    }

    /**
     * [#9612] The package closure a write is judged against, or `undefined`
     * when the gate must keep receiving the whole tenant.
     *
     * ## What it computes
     *
     * `{ packageId, dependencies }` where `dependencies` is the TRANSITIVE
     * closure of the written package's declared `manifest.dependencies`. The
     * lint gate then keeps an object when it belongs to one of those packages,
     * is a platform/system object, or carries no package provenance at all
     * (`narrowObjectsToPackageClosure`).
     *
     * ## Why it can be exact rather than an estimate
     *
     * A package's declared dependencies bound what it MAY reference. So the
     * set of objects a package write can legitimately resolve against is a
     * DECLARED fact the platform already stores, not something the gate has to
     * infer from the body it is judging. That is the whole reason the
     * maintainer's ruling picks the package as the validation unit
     * (「客户开发开发,校验是否也应该基于软件包」) rather than "whatever this
     * rule can be proven to reach", which would be a second opinion per rule.
     *
     * ## Every way this returns `undefined`, and why that direction is safe
     *
     * - no package id on the write (a bare tenant overlay row);
     * - the `sys_metadata` sentinel, which marks a rehydrated overlay row and
     *   is not a package id (`registry.ts` reads it the same way);
     * - **the registry cannot produce the package** — so its dependency
     *   declaration cannot be read, and an undeclared bound is not a bound;
     * - the registry has no `getPackage` at all (a metadata-only test double),
     *   or throws.
     *
     * In every one of those the gate receives the WHOLE collection and behaves
     * exactly as it did before this change. ⛔ There is deliberately no branch
     * that narrows on a guess and no branch that skips rules: the failure
     * direction is more validation input, never less. A "skip when N is large"
     * fast path is the fail-open at scale this card was explicitly forbidden to
     * build (commit c7655d472 restored a declared-but-unenforced refusal, #9261 an outage read as emptiness,
     * ADR-0110 D3 — a miss and a fault are different facts).
     */
    private resolveWritePackageScope(
        packageId: string | null | undefined,
    ): { packageId: string; dependencies: string[] } | undefined {
        // [#25467 cut 19] The body moved to `protocol-write-package-scope.ts` (see `WritePackageScopeHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof resolveWritePackageScope> = {
            get engine() { return readEngine(); },
        };
        return resolveWritePackageScope.call(host, packageId);
    }

    /**
     * [#28574, ADR-0146 D10] The save, publish and restore doors' gate for an
     * `object_extension` body written into `binding` (the RESOLVED package of
     * the row): {@link objectExtensionItemRefusal}, asked with this engine's
     * registry and the package's dependency closure
     * ({@link resolveWritePackageScope}). Any other type answers `undefined`.
     */
    private objectExtensionItemRefusal(
        type: string,
        item: unknown,
        name: string,
        binding: string | null | undefined,
    ): Error | undefined {
        if ((PLURAL_TO_SINGULAR[type] ?? type) !== OBJECT_EXTENSION_TYPE) return undefined;
        return objectExtensionItemRefusal(OBJECT_EXTENSION_TYPE, {
            item,
            name,
            binding,
            registry: this.engine?.registry as ObjectExtensionRegistry | undefined,
            scope: this.resolveWritePackageScope(binding),
        });
    }

    /** Docblock and body: {@link ProtocolClassHeadFacet.registerStoredObjectExtension} in `protocol-class-head.ts` [#29985 codemod]. */
    private registerStoredObjectExtension(body: unknown, packageId: string | null | undefined): boolean {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.registerStoredObjectExtension(protocolHost(this), body, packageId);
    }

    /** Docblock and body: {@link ProtocolClassHeadFacet.resyncStoredObjectExtensions} in `protocol-class-head.ts` [#29985 codemod]. */
    private async resyncStoredObjectExtensions(name: string): Promise<void> {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.resyncStoredObjectExtensions(protocolHost(this), name);
    }

    /**
     * [#6285] Does this deployment enforce an organization wall (ADR-0105 D1)?
     *
     * The authoritative reading, and the only one:
     * `postureEnforcesWall(resolveTenancyPosture())`. `resolveMultiOrgEnabled()`
     * is the demoted legacy input — a deployment that sets only the canonical
     * `OS_TENANCY_POSTURE` reads `false` there while genuinely running a walled
     * posture, which is the bug shape cloud#1020 and #5233 already paid for.
     *
     * Read per call rather than memoised: `resolveTenancyPosture()` reads
     * `process.env` live by contract, and a gate that cached the answer at
     * construction would disagree with every other consumer for the life of the
     * process.
     *
     * `resolveTenancyPosture()` THROWS on an unrecognized `OS_TENANCY_POSTURE`
     * — deliberately, so a typo cannot silently remove the wall. That refusal
     * belongs at boot, not on a metadata write, so it is caught here and read
     * as WALLED. Fail-closed is the direction ADR-0105 argues for on exactly
     * this input ("refusing to boot rather than silently falling back to a
     * posture with no organization wall"), and it costs nothing in practice: a
     * deployment in that state does not boot, and even when reached it only
     * arms a guardrail — a publish still has to match every other limb of the
     * refusal combination to be turned away.
     */
    private orgWallEnforced(): boolean {
        // [#25467 cut 26] The body moved to `protocol-authoring-posture-probes.ts`; it reads no member.
        return orgWallEnforced();
    }

    /**
     * [#21476] The tenancy posture IN FORCE, as this kernel's `tenancy` service
     * reports it (`anonymousFormIntakePosture`, `@objectstack/metadata-core`) —
     * the runtime authoring gate's input for its public-form intake advisory.
     * `undefined` when no tenancy service is registered.
     *
     * The doors that advisory speaks for read exactly this: both anonymous form
     * doors in `@objectstack/rest` ask the same service through the same
     * reader, and it is the posture SecurityPlugin hands the engine. So a
     * DEGRADED walled deployment (a wall requested and not enforceable, which
     * the service reports as `single`) gets no advisory, because its doors do
     * serve the form and its engine does take the insert.
     *
     * ⛔ It does NOT replace {@link orgWallEnforced}. That input is the
     * REQUESTED posture, read fail-closed: #6155 Q3=A names
     * `postureEnforcesWall(resolveTenancyPosture())` as the #6285 refusal's
     * input verbatim, and an unrecognized `OS_TENANCY_POSTURE` reads as walled
     * (ADR-0105). Feeding that refusal this reading instead would narrow it —
     * off on a degraded deployment, on a composition with no tenancy service,
     * and on an unrecognized posture value — which is a ruling's to make, not
     * an advisory's. Two rules, two questions, two inputs.
     *
     * Read per publish, as {@link resolveSduiManifest} reads its service, and
     * never allowed to fail the write: a service whose posture cannot be read
     * reports none, and the advisory is simply not raised.
     */
    private tenancyPostureInForce(): TenancyPosture | undefined {
        // [#25467 cut 26] The body moved to `protocol-authoring-posture-probes.ts` (see `AuthoringPostureProbesHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof tenancyPostureInForce> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return tenancyPostureInForce.call(host);
    }

    /**
     * [#25234] The `current_user.*` keys the registered membership resolver
     * owns (`IRlsMembershipResolver.keys`, ADR-0105 D11), `[]` when none is
     * registered — the input the runtime publish gate judges membership-key
     * ownership with.
     *
     * Read per publish, as {@link resolveSduiManifest} reads its service: a
     * resolver registered after this protocol is assembled is seen by the next
     * publish. `undefined` — the CLI's reading, under which no ownership is
     * judged — when this host has no service registry, or when the registered
     * value carries no readable `keys` list: a resolver whose keys cannot be
     * read owns keys the gate cannot see, so it states none rather than the
     * wrong ones.
     */
    private rlsMembershipResolverKeys(): readonly string[] | undefined {
        // [#25467 cut 26] The body moved to `protocol-authoring-posture-probes.ts` (see `AuthoringPostureProbesHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof rlsMembershipResolverKeys> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return rlsMembershipResolverKeys.call(host);
    }

    /**
     * [#26188] Is a hierarchy resolver mounted on this runtime — a service
     * registered under `HIERARCHY_SCOPE_RESOLVER_SERVICE` (ADR-0057; the
     * enterprise `hierarchy-security` capability registers one, the open edition
     * none)? The input the runtime authoring gate refuses an unenforceable
     * hierarchy scope with on publish, and warns on a draft save with.
     *
     * Read per write, as {@link rlsMembershipResolverKeys} reads its service, so a
     * resolver registered after this protocol is assembled is seen by the next
     * write; nothing is recorded. `undefined` — the CLI's reading, under which
     * nothing is judged — when this host has no service registry or the lookup
     * throws.
     */
    private hierarchyResolverMounted(): boolean | undefined {
        // [#25467 cut 26] The body moved to `protocol-authoring-posture-probes.ts` (see `AuthoringPostureProbesHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof hierarchyResolverMounted> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return hierarchyResolverMounted.call(host);
    }

    /**
     * Run the registered projector for a just-persisted mutation (ADR-0094).
     * Returns `undefined` when no projector is registered for the type;
     * otherwise a {@link MutationProjectionOutcome} that callers attach to
     * the write's response as `projectionApplied`. Never throws.
     */
    private async runMutationProjector(
        evt: MetadataMutationEvent & { body?: unknown },
    ): Promise<MutationProjectionOutcome | undefined> {
        // [#25467 cut 25] The body moved to `protocol-mutation-fan-out.ts` (see `MutationFanOutHost`).
        const readMutationProjectors = () => this.mutationProjectors;
        const host: ThisParameterType<typeof runMutationProjector> = {
            get mutationProjectors() { return readMutationProjectors(); },
        };
        return runMutationProjector.call(host, evt);
    }

    /**
     * Runtime-mutation listeners (#2588). Every metadata mutation that lands
     * through this protocol — `saveMetaItem` (draft AND direct-active saves),
     * `publishMetaItem` (per-item and package publish-drafts), and
     * `deleteMetaItem` — notifies these listeners AFTER persistence succeeds.
     *
     * This is the ONE choke point every authoring surface funnels through
     * (rest-server, http-dispatcher, AI builders, direct protocol callers),
     * so boot-cached runtime consumers can re-sync on authoring without each
     * HTTP surface hand-announcing. First consumer: ObjectQLPlugin re-binds
     * runtime-authored hooks when a `hook` row changes.
     *
     * Server-side extension only — NOT part of the ObjectStackProtocol wire
     * contract (same status as `loadMetaFromDb`).
     */
    private metadataMutationListeners: Array<(evt: MetadataMutationEvent) => void> = [];

    /** Subscribe to post-persistence metadata mutations. Returns an unsubscribe fn. */
    onMetadataMutation(listener: (evt: MetadataMutationEvent) => void): () => void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.onMetadataMutation(protocolHost(this), listener);
    }

    /** Docblock and body: {@link ProtocolClassHeadFacet.emitMetadataMutation} in `protocol-class-head.ts` [#29985 codemod]. */
    private emitMetadataMutation(evt: MetadataMutationEvent): void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.emitMetadataMutation(protocolHost(this), evt);
    }

    /**
     * The LOCAL half of {@link emitMetadataMutation} — split out (#13331,
     * mirroring `MetadataManager.notifyWatchersLocal`) so a mutation received
     * FROM the cluster can be replayed to this replica's listeners without
     * re-publishing it: replaying through `emitMetadataMutation` would
     * publish again from this node, every peer would apply-and-republish in
     * turn, and the loopback guard (which only suppresses a node's OWN
     * messages) could not stop the storm.
     */
    private notifyMutationListenersLocal(evt: MetadataMutationEvent): void {
        // [#25467 cut 25] The body moved to `protocol-mutation-fan-out.ts` (see `MutationFanOutHost`).
        const readMetadataMutationListeners = () => this.metadataMutationListeners;
        const host: ThisParameterType<typeof notifyMutationListenersLocal> = {
            get metadataMutationListeners() { return readMetadataMutationListeners(); },
        };
        return notifyMutationListenersLocal.call(host, evt);
    }

    // ── [#13331] Cross-node registry convergence ────────────────────────────
    //
    // The gap this closes, measured on a live 3-replica EE deployment: a
    // runtime-authored object persists to the SHARED `sys_metadata` (so
    // `/api/v1/meta/*` answers 200 fleet-wide) but registers with the ObjectQL
    // engine registry of the WRITING replica only — `assertObjectRegistered`
    // fails closed on the other replicas and `/api/v1/data/<object>` answers
    // OBJECT_NOT_FOUND on (N-1)/N of the fleet, indefinitely (200 concurrent
    // creates through the LB: 67×201 / 133×404; boot-loaded control object:
    // 0 errors). The authoring path lives entirely in this protocol and never
    // touches the metadata service, so `MetadataManager`'s `metadata.changed`
    // bridge — even when attached — never hears these writes. The protocol is
    // the state owner here, and owns the fan-out (ruled 2026-09-01, Option A).

    /** The cluster transport, when a bridge attached one. [#13331] */
    private clusterPubSub?: IPubSub;
    /** This node's cluster id — stamps `originNode` for loopback suppression. */
    private clusterNodeId?: string;
    /** Disposer for the cluster subscription, when attached. */
    private clusterUnsubscribe?: () => void;

    /**
     * [#13331] Attach a cluster pub/sub transport so this protocol's
     * post-persistence mutations fan out on
     * {@link METADATA_MUTATION_CLUSTER_CHANNEL} and peer mutations converge
     * this replica's registry. Mirrors `MetadataManager.attachClusterPubSub()`
     * and the engine's `attachAuthzInvalidationPubSub()` — including their
     * idempotency on the `(pubsub, nodeId)` pair — and is called the same
     * way: by `MetadataClusterBridgePlugin` in `@objectstack/service-cluster`,
     * once per kernel boot at `kernel:ready`, after both services exist.
     *
     * ⭐ Receipt runs CONVERGENCE, not trust: the payload is an address, and
     * {@link applyRemoteMetadataMutation} re-reads the row from this
     * replica's own `sys_metadata` before re-running the registry
     * write-through. Duplicates are harmless (same read, same registration);
     * loss is bounded the way it always was — by the next boot's full reload
     * — because no shipped driver exceeds at-most-once delivery
     * (`IPubSub`'s own contract). This channel narrows the staleness window
     * from "until restart" to "one network hop"; it does not promise more.
     *
     * @returns a disposer that detaches the bridge.
     */
    attachMetadataMutationPubSub(pubsub: IPubSub, nodeId: string): () => void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.attachMetadataMutationPubSub(protocolHost(this), pubsub, nodeId);
    }

    /** Tear down the cluster wiring. Safe to call multiple times. [#13331] */
    detachMetadataMutationPubSub(): void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.detachMetadataMutationPubSub(protocolHost(this));
    }

    /**
     * [#13331] The cluster half of {@link emitMetadataMutation}: publish the
     * mutation's ADDRESS to peers. Best-effort and fire-and-forget — a
     * publish failure must never fail the write it announces (the row is
     * already persisted), matching `MetadataManager.notifyWatchers`' cluster
     * leg verbatim. No-op until a bridge attaches a transport.
     *
     * Drafts are not published: they never enter any replica's registry
     * (including this one's — `saveMetaItem` gates its write-through on
     * `mode === 'publish'`), so a draft signal would wake every peer to
     * converge on a no-op.
     */
    private publishMetadataMutation(evt: MetadataMutationEvent): void {
        // [#25467 cut 25] The body moved to `protocol-mutation-fan-out.ts` (see `MutationFanOutHost`).
        const readClusterPubSub = () => this.clusterPubSub;
        const readClusterNodeId = () => this.clusterNodeId;
        const host: ThisParameterType<typeof publishMetadataMutation> = {
            get clusterPubSub() { return readClusterPubSub(); },
            get clusterNodeId() { return readClusterNodeId(); },
        };
        return publishMetadataMutation.call(host, evt);
    }

    /** Docblock and body: {@link ProtocolClassHeadFacet.applyRemoteMetadataMutation} in `protocol-class-head.ts` [#29985 codemod]. */
    private async applyRemoteMetadataMutation(evt: MetadataMutationEvent): Promise<void> {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.applyRemoteMetadataMutation(protocolHost(this), evt);
    }

    /**
     * [#10219] Per-item publish listeners — the producer-side half of the
     * publish→re-bind signal.
     *
     * ## The gap this closes
     *
     * A metadata publish at RUNTIME leaves every boot-cached consumer holding
     * the pre-publish view; the platform's declared signal for "re-read what
     * you cached" is the `metadata:reloaded` lifecycle event. Two announcers
     * existed — the metadata plugin's dev-artifact watcher, and the runtime
     * dispatcher AFTER `POST /packages/:id/publish-drafts`. The per-item door
     * (`POST /api/v1/meta/:type/:name/publish`) announced nothing, so a flow
     * published one item at a time never bound its trigger until the kernel was
     * rebuilt: measured on a cloud rig, a record-change flow published as
     * `state='active'` produced no bind log and no execution, and only the
     * `kernel:ready` cold-boot bind (#2560) ever picked it up.
     *
     * ## Why the seam is here and not at the HTTP route
     *
     * `publishMetaItem` is the ONE producer behind every per-item publish
     * transport (REST today; anything else that reaches the protocol next), and
     * the batch door's announce already lives outside the protocol. Announcing
     * from the producer means a new transport inherits the signal instead of
     * having to remember it — the same argument {@link onMetadataMutation}
     * makes one method over.
     *
     * The protocol itself holds no kernel hook bus, so it does not announce:
     * it NOTIFIES, and the plugin that owns this protocol instance
     * (`ObjectQLPlugin.subscribeMetadataRebind`, which is armed for both
     * assembly modes) translates the notification into `ctx.trigger(
     * 'metadata:reloaded', { changed })`. That keeps the lifecycle event
     * emitted by something that actually has the kernel, exactly as the
     * dispatcher does for the batch door.
     *
     * Server-side extension only — NOT part of the ObjectStackProtocol wire
     * contract (same status as {@link onMetadataMutation}).
     */
    private metaItemPublishedListeners: Array<(evt: MetaItemPublishedEvent) => void | Promise<void>> = [];

    /**
     * Subscribe to per-item publishes. Returns an unsubscribe fn.
     *
     * Listeners are AWAITED (unlike {@link onMetadataMutation}'s fire-and-forget
     * fan-out) so the publish's own 2xx means "the re-bind was attempted",
     * matching the batch door — which awaits its `metadata:reloaded` announce
     * before answering. A caller that publishes a flow and immediately writes a
     * record must not race the bind.
     */
    onMetaItemPublished(listener: (evt: MetaItemPublishedEvent) => void | Promise<void>): () => void {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.onMetaItemPublished(protocolHost(this), listener);
    }

    /**
     * Notify per-item publish listeners, awaited and isolated.
     *
     * Best-effort by contract: the draft is already promoted and durable when
     * this runs, so a subscriber failure must never turn a landed publish into
     * an error response. It IS logged — losing an in-memory re-sync is the
     * functional degradation AGENTS.md uses as its worked example ("a trigger
     * is not armed"), and the batch door's equivalent catch logs at `warn` for
     * the same reason. The sentence names the consequence and the recovery
     * rather than the internal failure alone.
     *
     * ⛔ The caught text is NOT copied onto the publish response. The batch door
     * carries a `rebindError` key because its response is a batch receipt; this
     * door's response is declared by `PublishMetaItemResponseSchema` and adding
     * a zero-reader diagnostic key to a wire contract buys no capability
     * (the #6955 ruling, one payload over) — the operator-facing channel is
     * this log.
     */
    private async emitMetaItemPublished(evt: MetaItemPublishedEvent): Promise<void> {
        // [#25467 cut 25] The body moved to `protocol-mutation-fan-out.ts` (see `MutationFanOutHost`).
        const readMetaItemPublishedListeners = () => this.metaItemPublishedListeners;
        const host: ThisParameterType<typeof emitMetaItemPublished> = {
            get metaItemPublishedListeners() { return readMetaItemPublishedListeners(); },
        };
        return emitMetaItemPublished.call(host, evt);
    }

    /** Docblock and body: {@link ProtocolClassHeadFacet.getOverlayRepo} in `protocol-class-head.ts` [#29985 codemod]. */
    private getOverlayRepo(): SysMetadataRepository {
        // [#29985 codemod] The body moved to `protocol-class-head.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolClassHeadFacet.getOverlayRepo(protocolHost(this));
    }

    /**
     * One-time guard for ensuring the overlay-uniqueness UNIQUE INDEXes exist
     * on `sys_metadata`. ADR-0005 (revised 2026-05) + ADR-0048: per-env DBs
     * replace the old "per-project" isolation, so `environment_id` is no longer
     * a discriminator — overlay uniqueness is
     * `(type, name, organization_id, COALESCE(package_id, ''))`, enforced once
     * among ACTIVE rows and once among DRAFT rows. Idempotent SQL — safe to
     * attempt on every protocol instance.
     *
     * ⚠️ This method resolves a raw-SQL seam and nothing more. The DDL, its
     * ORDER and its reporting live in `./migrations/overlay-index.ts` (#6418),
     * which replaced the DROP-then-CREATE sequence that used to sit here: the
     * drop always succeeded and a failing create left `sys_metadata` with no
     * unique index at all, silently, because both `catch` blocks were empty.
     * See that module's header for why the order is now probe-first and why the
     * dialect fallback must stay NON-unique.
     *
     * The raw-SQL surface is resolved by `./migrations/driver-exec.ts`:
     * `execute()` first — the member `IDataDriver` declares non-optionally —
     * then `raw()` as the fallback for a host or third-party driver that
     * defines it. This method used to try `raw` first, disagreeing with
     * `seed-tenancy-backfill.ts`; that module's header carries the argument for
     * the order and the measurement showing the flip changes nothing on any
     * driver this repo ships.
     *
     * Kept in this package rather than imported from
     * `@objectstack/metadata/migrations`. ⚠️ The reason recorded here used to be
     * a circular dependency ("metadata already depends on objectql") — that is
     * STALE: `@objectstack/metadata` does not depend on `@objectstack/objectql`,
     * and `@objectstack/metadata` is already a declared dependency of this
     * package. The live reasons are that `driver-exec.ts` is internal to
     * `metadata`'s migrations directory rather than part of its published
     * surface, and that this method runs on EVERY boot, so importing the
     * `./migrations` barrel would put it on the boot path.
     */
    private overlayIndexEnsured = false;
    private async ensureOverlayIndex(): Promise<void> {
        // [#25467 cut 33] The body moved to `protocol-overlay-index.ts` (see `OverlayIndexHost`).
        const readEngine = () => this.engine;
        const readOverlayIndexEnsured = () => this.overlayIndexEnsured;
        const writeOverlayIndexEnsured = (value: ObjectStackProtocolImplementation['overlayIndexEnsured']) => { this.overlayIndexEnsured = value; };
        const host: ThisParameterType<typeof ensureOverlayIndex> = {
            get engine() { return readEngine(); },
            ensureOverlayMembersBackfilled: (...a) => this.ensureOverlayMembersBackfilled(...a),
            get overlayIndexEnsured() { return readOverlayIndexEnsured(); },
            set overlayIndexEnsured(value) { writeOverlayIndexEnsured(value); },
        };
        return ensureOverlayIndex.call(host);
    }

    /**
     * [#22877] One run per protocol instance of the bundle-member backfill
     * (`./migrations/overlay-index.ts` {@link backfillOverlayBundleMembers}):
     * a row of a bundled type stored before `sys_metadata.bundle_member`
     * existed is given the member its body declares, so a bare-name read does
     * not take a second locale's overlay for the canonical one and that
     * locale's next save updates the row instead of minting a second.
     *
     * Asked by boot hydration ({@link loadMetaFromDb}) once its own read of
     * the table succeeded, and by the first write ({@link ensureOverlayIndex})
     * on a host that hydrates nothing. Never throws — the migration reports its
     * own failure at `error`, and the guard stays down so the next instance
     * (the next boot) retries.
     */
    private overlayMembersBackfilled = false;
    private async ensureOverlayMembersBackfilled(): Promise<void> {
        // [#25467 cut 33] The body moved to `protocol-overlay-index.ts` (see `OverlayIndexHost`).
        const readEngine = () => this.engine;
        const readOverlayMembersBackfilled = () => this.overlayMembersBackfilled;
        const writeOverlayMembersBackfilled = (value: ObjectStackProtocolImplementation['overlayMembersBackfilled']) => { this.overlayMembersBackfilled = value; };
        const host: ThisParameterType<typeof ensureOverlayMembersBackfilled> = {
            get engine() { return readEngine(); },
            get overlayMembersBackfilled() { return readOverlayMembersBackfilled(); },
            set overlayMembersBackfilled(value) { writeOverlayMembersBackfilled(value); },
        };
        return ensureOverlayMembersBackfilled.call(host);
    }

    /**
     * Exposes the environment scope the protocol is bound to. Consumers like
     * the HTTP dispatcher use this to decide whether to trust the process-
     * wide SchemaRegistry (an unscoped kernel owns it) or whether they must
     * route the read through this protocol's own sys_metadata lookup — which
     * is scoped by `organization_id`, never by an `environment_id` column
     * (ADR-0005 revised 2026-05).
     */
    getProjectId(): string | undefined {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.getProjectId(protocolHost(this));
    }

    async getDiscovery(): Promise<{
        authFamilies?: {
            admin: boolean;
        } | undefined;
        version: string;
        name: string;
        /** @deprecated Use `name`. Removed in protocol 18 (#4828). */
        apiName: string;
        environment: "sandbox" | "production" | "development";
        routes: {
            data: string;
            metadata: string;
            discovery?: string | undefined;
            ui?: string | undefined;
            auth?: string | undefined;
            automation?: string | undefined;
            storage?: string | undefined;
            analytics?: string | undefined;
            packages?: string | undefined;
            datasources?: string | undefined;
            email?: string | undefined;
            approvals?: string | undefined;
            realtime?: string | undefined;
            notifications?: string | undefined;
            ai?: string | undefined;
            i18n?: string | undefined;
            mcp?: string | undefined;
        };
        locale: {
            default: string;
            supported: string[];
            timezone: string;
        };
        services: Record<string, {
            enabled: boolean;
            status: "registered" | "degraded" | "available" | "unavailable" | "stub";
            handlerReady?: boolean | undefined;
            route?: string | undefined;
            provider?: string | undefined;
            version?: string | undefined;
            message?: string | undefined;
            rateLimit?: {
                requestsPerMinute?: number | undefined;
                requestsPerHour?: number | undefined;
                burstLimit?: number | undefined;
                retryAfterMs?: number | undefined;
            } | undefined;
        }>;
        capabilities: Record<"ai" | "automation" | "cron" | "analytics" | "files" | "search" | "export" | "i18n" | "notifications" | "comments" | "chunkedUpload" | "transactionalBatch" | "websockets", {
            enabled: boolean;
            features?: Record<string, boolean> | undefined;
            description?: string | undefined;
        }>;
    }> {
        // Get registered services from kernel if available
        const registeredServices = this.getServicesRegistry ? this.getServicesRegistry() : new Map();

        // Build dynamic service info with proper typing. Analytics is NOT in
        // this kernel-provided block: since the degraded ObjectQL fallback was
        // retired (#3891) it is an ordinary optional service, computed from the
        // registry via SERVICE_CONFIG below — absent means `unavailable`, and
        // no route is advertised (the pre-#2462 hardcode here is exactly what
        // the fallback was invented to make true).
        //
        // [#4089] The `metadata` slot is reported from whatever fills it, not
        // hardcoded `available`. The kernel auto-registers `createMemoryMetadata`
        // when no MetadataPlugin is present, and plugin-dev registers its own
        // in-memory registry; both self-describe as `degraded` (D12), and
        // hardcoding `available` here overstated them as exactly equivalent to a
        // sys_metadata-backed registry. Absent or unmarked ⇒ `available`, which
        // is what the real MetadataPlugin (carrying no marker) reports.
        //
        // This is also where the two builders stopped disagreeing: the runtime
        // dispatcher hardcoded the opposite verdict for the same slot
        // (`degraded` + "DB persistence pending"), so one host called a persisted
        // registry degraded while the other called an in-memory one available.
        // Both now compute it, and `handlerReady: true` is stated on both sides:
        // `/api/v1/meta` is served by the protocol, not by this service, so it is
        // mounted whichever implementation occupies the slot.
        const metadataSelf = readServiceSelfInfo(registeredServices.get('metadata'));

        // [#4130] `data` was the last self-judging entry in this block. Same
        // reasoning, one degree weaker: its hardcoded `available` is currently
        // true, but only because ObjectQL is the slot's sole producer and
        // plugin-dev (whose `data` stub declares `stub`) always loads
        // ObjectQLPlugin as a child. That is a load-order convention in another
        // package, not something this builder verifies — so verify it here.
        // Unmarked implementation ⇒ `available` + `handlerReady: true`, i.e.
        // exactly what the hardcode said, now derived rather than asserted.
        const dataSelf = readServiceSelfInfo(registeredServices.get('data'));

        const services: Record<string, ServiceInfo> = {
            // --- Kernel-provided (objectql is an example kernel implementation) ---
            metadata:  {
                enabled: true,
                status: metadataSelf?.status ?? ('available' as const),
                handlerReady: true,
                route: '/api/v1/meta',
                provider: 'objectql',
                ...(metadataSelf?.message ? { message: metadataSelf.message } : {}),
            },
            data:      {
                enabled: true,
                status: dataSelf?.status ?? ('available' as const),
                handlerReady: dataSelf?.handlerReady ?? true,
                route: '/api/v1/data',
                provider: 'objectql',
                ...(dataSelf?.message ? { message: dataSelf.message } : {}),
            },
        };

        // [#4000, #4058] The dispatcher answers a self-declared non-handler in
        // one of ITS domains' slots with the same 404/501 an empty slot gets
        // (`isServiceServeable`, runtime/src/service-serveable.ts), so this
        // builder must not advertise a route for one — that would be the
        // `declared ≠ enforced` gap discovery exists to close.
        //
        // Scoped to the dispatcher-owned domains on purpose. For the other
        // entries in SERVICE_CONFIG the route belongs to the plugin that
        // registers the service (service-storage's own `/api/v1/storage`
        // routes, plugin-search, plugin-graphql, …) rather than to a dispatcher
        // domain, so `handlerReady` there says nothing about whether THAT route
        // is mounted, and suppressing it would be a guess. `storage` stays
        // listed as the one entry with no dispatcher domain behind it — #4087
        // retired the `/storage` bridge — because for that slot `handlerReady`
        // is not a proxy for anything, it is the fact itself: an occupant that
        // mounts no HTTP surface must not have `/api/v1/storage` advertised on
        // its behalf. When service-storage is installed it registers a real
        // (unmarked) service and mounts the routes, so the entry never fires.
        const DISPATCHER_GATED_SERVICES = new Set([
            'analytics', 'automation', 'notification', 'ai', 'i18n', 'storage',
        ]);
        const unserveable = (serviceName: string) =>
            DISPATCHER_GATED_SERVICES.has(serviceName)
            && readServiceSelfInfo(registeredServices.get(serviceName))?.handlerReady === false;
        const advertisedRoute = (serviceName: string, route?: string) =>
            unserveable(serviceName) ? undefined : route;

        // Check which services are actually registered
        for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
            if (registeredServices.has(serviceName)) {
                // Registered — but honor a stub/dev/fallback self-description
                // instead of blindly reporting 'available' (ADR-0076 D12).
                const self = readServiceSelfInfo(registeredServices.get(serviceName));
                // [#14646] Channel slots answer a different question than every
                // other row here. `enabled` elsewhere means "the slot is
                // filled"; for a slot whose advertised capability IS a
                // subscribable channel that reading is what let `/discovery`
                // report `enabled: true` beside "no HTTP/WS realtime surface is
                // mounted" — both true, one field, two meanings. Here `enabled`
                // is the shared predicate itself, evaluated on the very entry a
                // consumer reads, so the field and the definition are one
                // computation. The route comes from the occupant because no
                // builder in the open framework mounts a realtime transport.
                if (CHANNEL_SURFACE_SLOTS.has(serviceName)) {
                    const channelRoute = readChannelRoute(registeredServices.get(serviceName));
                    const handlerReady = channelRoute !== undefined;
                    services[serviceName] = {
                        enabled: isSubscribableChannel({ handlerReady, route: channelRoute }),
                        // A mounted channel makes an unmarked occupant plainly
                        // `available`; without one the slot keeps the reduced
                        // status its row declares (`degraded` for realtime — the
                        // capability it advertises IS the missing surface).
                        status: self?.status
                            ?? (handlerReady
                                ? ('available' as const)
                                : (config.noHttpSurface?.statusWhenUnmarked ?? ('available' as const))),
                        route: channelRoute,
                        provider: CORE_SERVICE_PROVIDER[serviceName] ?? undefined,
                        handlerReady,
                        // The "no surface" sentence is only true while there is
                        // no surface; a mounted channel drops it and keeps only
                        // whatever the occupant says about itself.
                        ...(self?.message
                            ? { message: self.message }
                            : !handlerReady && config.noHttpSurface
                                ? { message: config.noHttpSurface.message }
                                : {}),
                    };
                    continue;
                }
                // No HTTP surface at all: the handler can never be ready, and
                // the entry's own `noHttpSurface` declaration says whether that
                // also degrades the slot (realtime) or not (cache/queue/job —
                // in-process contracts, #4318).
                const noHttpSurface = !config.route;
                services[serviceName] = {
                    enabled: true,
                    status: self?.status ?? (config.noHttpSurface?.statusWhenUnmarked ?? ('available' as const)),
                    route: advertisedRoute(serviceName, config.route),
                    provider: CORE_SERVICE_PROVIDER[serviceName] ?? undefined,
                    ...(noHttpSurface || self?.handlerReady !== undefined
                        ? { handlerReady: noHttpSurface ? false : self?.handlerReady }
                        : {}),
                    ...(self?.message
                        ? { message: self.message }
                        : config.noHttpSurface
                            ? { message: config.noHttpSurface.message }
                            : {}),
                };
            } else {
                // Service is not registered
                services[serviceName] = {
                    enabled: false,
                    status: 'unavailable' as const,
                    message: serviceUnavailableMessage(serviceName),
                };
            }
        }

        // [#9683] `file-storage` is the deprecated v17 alias of the `storage`
        // slot, and it is a key existing consumers really read off this
        // document (objectui's console endpoint catalog is keyed by it). The
        // registry resolves both names to the same instance, so discovery
        // mirrors the canonical row VERBATIM under the alias key until the
        // alias retires at the next major — dropping the key would be the
        // silent inside-a-major break the ruling forbids. Deliberately a
        // byte-equal copy, not a second opinion: one slot, two spellings.
        services['file-storage'] = { ...services['storage'] };

        // Build routes from services — a flat convenience map for client routing
        const serviceToRouteKey: Record<string, keyof ApiRoutes> = {
            analytics: 'analytics',
            auth: 'auth',
            automation: 'automation',
            ui: 'ui',
            realtime: 'realtime',
            notification: 'notifications',
            ai: 'ai',
            i18n: 'i18n',
            storage: 'storage',
            // [#6633] The package-management surface. `package` is NOT a
            // CoreServiceName slot, so it must not enter SERVICE_CONFIG — a
            // non-slot row there is the shape of the retired `graphql` defect,
            // and it would also fabricate a `services` availability entry whose
            // remedy line lies. Its route flows through the
            // NON_SLOT_SERVICE_ROUTES loop below instead: same gate
            // (registered service), same mapping table, one hop over.
            package: 'packages',
        };

        // [#6633] Routes advertised for registered services that are not
        // CoreServiceName slots. Advertised iff the service is registered —
        // the same convention every SERVICE_CONFIG row uses, and for `package`
        // it is exactly the predicate that decides the mount on both real host
        // types: the @objectstack/rest direct-mount registrar is gated on this
        // same service (`direct-mount-composition.ts`), and the runtime
        // dispatcher — whose `/packages` domain is unconditional — answers
        // discovery from its own `getDiscoveryInfo()`, never from this
        // builder.
        //
        // `datasources` is deliberately NOT here (same reasoning as `mcp`,
        // #5679): the federation mount belongs to the REST host, which this
        // builder cannot see, and the runtime dispatcher serves no
        // `/datasources` domain at all — advertising it from here would be the
        // advertise-the-unmounted half of ADR-0076 D12. The REST discovery
        // endpoint advertises it from its recorded direct mounts.
        const NON_SLOT_SERVICE_ROUTES: Record<string, string> = {
            package: '/api/v1/packages',
        };

        const optionalRoutes: Partial<ApiRoutes> = {};

        // Add routes for available plugin services. Services without an HTTP
        // surface (config.route undefined) advertise no route (D12, #2462).
        for (const serviceName of Object.keys(SERVICE_CONFIG)) {
            // [#14646] Read the route off the entry that was just built rather
            // than re-deriving it from the table. Byte-identical for every
            // table-routed slot, and it is the only spelling that stays correct
            // for a channel slot, whose route comes from the occupant — two
            // derivations of one fact is how `routes` and `services` drift.
            const route = services[serviceName]?.route;
            if (registeredServices.has(serviceName) && route) {
                const routeKey = serviceToRouteKey[serviceName];
                if (routeKey) {
                    optionalRoutes[routeKey] = route;
                }
            }
        }

        // [#6633] Same flow for the non-slot routed services declared above.
        for (const [serviceName, route] of Object.entries(NON_SLOT_SERVICE_ROUTES)) {
            if (registeredServices.has(serviceName)) {
                const routeKey = serviceToRouteKey[serviceName];
                if (routeKey) {
                    optionalRoutes[routeKey] = route;
                }
            }
        }

        const routes: ApiRoutes = {
            data: '/api/v1/data',
            metadata: '/api/v1/meta',
            ...optionalRoutes,
        };

        // Build well-known capabilities from registered services.
        //
        // [#5672] `WellKnownCapabilitiesSchema` is THE capability vocabulary and
        // `DiscoverySchema.capabilities` is now a closed object over it, so this
        // literal must answer EVERY key — a capability this host does not
        // deliver is `enabled: false`, never an absent key (maintainer ruling A,
        // 2026-08-06). The `WellKnownCapabilities` annotation is what enforces
        // that at compile time: adding a key to the vocabulary breaks this line
        // until it is answered here.
        //
        // Each key's basis is recorded next to it. Where a capability is backed
        // by a service slot, the predicate is deliberately the SAME one that
        // decides whether the route is advertised (`advertisedRoute`/
        // `unserveable` above) — what we advertise and what we claim cannot
        // disagree.
        const capabilityServed = (serviceName: string) =>
            registeredServices.has(serviceName) && !unserveable(serviceName);

        const wellKnown: WellKnownCapabilities = {
            // Comments/chatter are served by the `sys_comment` object via the generic
            // data API (ADR-0052 §5) — not a dedicated service. The capability is true
            // iff that object is loaded (the always-on audit slate provides it); this
            // keeps declared === enforced (Prime Directive #10). #3180
            comments: !!this.engine.registry?.getObject?.('sys_comment'),
            automation: registeredServices.has('automation'),
            cron: registeredServices.has('job'),
            // [#7541] Serveability-gated on the protocol's OWN search
            // implementation, was slot presence. This is the same predicate the
            // route refuses on: `registerSearchEndpoints`
            // (packages/rest/src/rest-server.ts) 501s exactly when
            // `typeof protocol.searchAll !== 'function'`, so the two ends can no
            // longer answer the same question differently — the rule stated at
            // the top of this block, applied to the key that was still exempt.
            //
            // The old predicate was wrong in the direction discovery exists to
            // prevent: `searchAll` is implemented by this class unconditionally,
            // nothing in either repository registers the `search` slot
            // (CORE_SERVICE_PROVIDER records that, verified), so every REST host
            // served `GET /api/v1/search` 200 while advertising
            // `capabilities.search = false`. A conforming client — one that
            // trusts the document instead of probing — skipped a working
            // surface. Prime Directive #10 inverted.
            //
            // `services.search` is deliberately NOT collapsed into this. The
            // slot is a distinct question with its own answer: `CoreServiceName`
            // declares it "Search Engine (Elastic/Meili)" and `ISearchService`
            // is an index/query contract, so `services.search` reports WHICH
            // ENGINE occupies the slot while this bit reports WHETHER THE
            // SURFACE IS SERVED (`WellKnownCapabilitiesSchema.search`: "whether
            // the backend supports full-text search"). They may legitimately
            // differ — an empty slot with a served endpoint is today's normal
            // host — and `serviceUnavailableMessage('search')` now says so in
            // the same document, the way `ui` does for the same shape (#4146).
            search: typeof this.searchAll === 'function',
            export: registeredServices.has('automation') || registeredServices.has('queue'),
            // [#5672] Serveability-gated, was presence-only. Two reasons, and
            // the second is the binding one:
            //   1. `declared === enforced` — a self-declared stub storage service
            //      mounts no HTTP surface, so this builder already withholds
            //      `routes.storage` from it; advertising chunked upload anyway
            //      promised an upload endpoint that cannot exist.
            //   2. the runtime dispatcher answers this key `hasFiles`, i.e.
            //      `isServiceServeable(filesSvc)`. Leaving this one on presence
            //      would make the two producers give the SAME host opposite
            //      answers for the SAME key — a new dialect inside the
            //      vocabulary this issue exists to unify.
            chunkedUpload: capabilityServed('storage'),
            // Atomic cross-object batch (#3298 / #1604 / ADR-0034 item 4): the
            // REST /batch endpoint runs its ops inside `engine.transaction()`,
            // which only opens a real (all-or-nothing) transaction when the
            // DEFAULT DRIVER can carry one — otherwise it takes its declared
            // non-transactional path (ADR-0119 D1) and the batch degrades to a
            // non-atomic passthrough. Advertise the capability iff the runtime
            // can actually roll back, so `declared === enforced` (Prime
            // Directive #10). The rest-server producer ANDs this with
            // `api.enableBatch` so a server that doesn't mount the route reports
            // `false` at its layer.
            //
            // [#18997] `engineCanRollBack`, NOT `typeof this.engine?.transaction
            // === 'function'`. The refusal this advertisement exists to help a
            // caller avoid — `runAtomicBatch`'s `501 NOT_IMPLEMENTED`, whose own
            // remedy text says to probe `capabilities.transactionalBatch` on
            // /discovery first — already asks `engineCanRollBack`, which asks the
            // DRIVER as well as the engine. `engine.transaction` is a function on
            // every real engine, so the engine-only probe answered `true` for the
            // two compositions that 501: a default driver with no
            // `beginTransaction` at all, and one that INHERITED it and declared
            // `supports.transactionsUnsupported` (#18063). An advertised
            // capability must answer the same question the refusal path asks,
            // from the same predicate — two derivations of one capability is how
            // these drifted. Narrowing only: this predicate is the engine probe
            // AND a driver clause, so no composition newly advertises `true`
            // (`protocol.discovery-transactional-batch-honesty.test.ts` pins both
            // directions, and the driver clause is skipped where the registry is
            // not inspectable, so a test double keeps its old answer).
            transactionalBatch: engineCanRollBack(this.engine),

            // ── Joined the vocabulary with ruling A (#5672) ───────────────────
            // These six used to be the runtime dispatcher's half of the split.
            // This builder can answer all of them from the services registry it
            // already reads, so none of them is a "cannot deliver ⇒ false"
            // placeholder — they are measured, per key:

            // [#14646] Derived, not stated. This flag and `services.realtime`
            // answer the same question — "is there a channel to subscribe to?"
            // — so it is the same predicate applied to the same entry
            // (`isSubscribableChannel`), and a host that mounts a transport
            // flips both in one step. It was a literal `false` beside an entry
            // saying `enabled: true`: two constants that happened to be right
            // are not agreement, they are two places to forget. False on every
            // host the open framework ships, because `service-realtime` is an
            // in-process pub/sub bus that names no channel route (ADR-0076 D12,
            // #2462; maintainer ruling A, 2026-09-04).
            websockets: isSubscribableChannel(services['realtime']),
            // Storage: the `storage` slot (#9683), gated on serveability rather
            // than presence — a self-declared stub mounts nothing, and this
            // builder already withholds `routes.storage` from it.
            files: capabilityServed('storage'),
            analytics: capabilityServed('analytics'),
            ai: capabilityServed('ai'),
            // Slot is `notification` (singular, CoreServiceName); the capability
            // and the route key are plural. Same slot, three spellings — the
            // mapping is here so nothing has to guess it.
            notifications: capabilityServed('notification'),
            i18n: capabilityServed('i18n'),
        };

        // Convert flat booleans → hierarchical capability objects.
        //
        // [#5672] Keyed by the vocabulary, not by `string`. The old
        // `Record<string, …>` was assignable to the open record
        // `DiscoverySchema.capabilities` used to be; against the closed shape
        // it no longer is, and that is the closure doing its job — the compiler
        // now refuses a producer whose capability map is not the whole
        // vocabulary. Iterating `wellKnown`'s own keys means fullness is
        // carried over from the annotated literal above rather than re-asserted.
        const capabilities = {} as Record<keyof WellKnownCapabilities, CapabilityDescriptor>;
        for (const key of Object.keys(wellKnown) as Array<keyof WellKnownCapabilities>) {
            capabilities[key] = { enabled: wellKnown[key] };
        }

        // [#4828] Locale, derived from the registered i18n service exactly the
        // way the runtime dispatcher's `getDiscoveryInfo()` derives it — same
        // accessors, same fallback. `DiscoverySchema` declares `locale`
        // REQUIRED and this producer never emitted it, so the REST `/discovery`
        // shape could not satisfy the schema at all; deriving it (rather than
        // hardcoding `en`) keeps the answer honest on a stack that actually
        // ships translations.
        const i18nSvc = registeredServices.get('i18n');
        let locale = { default: 'en', supported: ['en'], timezone: 'UTC' };
        if (i18nSvc) {
            const defaultLocale = typeof i18nSvc.getDefaultLocale === 'function'
                ? i18nSvc.getDefaultLocale() : 'en';
            const locales = typeof i18nSvc.getLocales === 'function'
                ? i18nSvc.getLocales() : [];
            locale = {
                default: defaultLocale,
                supported: locales.length > 0 ? locales : [defaultLocale],
                timezone: 'UTC',
            };
        }

        // [#4828] `name` is the canonical identity key (`DiscoverySchema`
        // requires it); `apiName` is the deprecated alias, emitted with the
        // IDENTICAL value until its scheduled removal in protocol 18 (schedule
        // in `GetDiscoveryResponseSchema`). Before this, the two discovery
        // producers spelled the same concept differently and disjointly — this
        // one emitted only `apiName`, the dispatcher only `name` — so no
        // consumer had a key that worked against both.
        const name = 'ObjectStack API';

        // [#21046] Which optional `/auth` route families are mounted — the
        // registered auth service's OWN public-config answer, the object
        // `GET /auth/config` serves, through the one reader the runtime
        // dispatcher's `getDiscoveryInfo()` calls too (`readAuthFamilies`,
        // `@objectstack/spec/api`). This builder never re-derives "is the admin
        // plugin on" itself. `undefined` — no `auth` service in this kernel
        // (then no `routes.auth` either), or one that publishes no public
        // config — emits no key; the REST `/discovery` passes the value through.
        const authFamilies = readAuthFamilies(registeredServices.get('auth'));

        return {
            // [commit 376c70f98] The serving system's identity, DERIVED — an injected
            // `OS_RUNTIME_VERSION` stamp, falling back to this package's own
            // resolved version. It was the literal `'1.0'` while the other
            // `DiscoverySchema` producer (`HttpDispatcher.getDiscoveryInfo()`
            // in `@objectstack/runtime`) carried its own literal `'1.0.0'` —
            // two producers of the same field disagreeing with each other,
            // which is what proves neither constant was ever a contract value.
            // #10993 fixed that producer the same way; see
            // {@link resolveDiscoveryVersion} for the derivation, the fallback,
            // and why the resolver is a package-local copy rather than an
            // import.
            version: resolveDiscoveryVersion(),
            name,
            /** @deprecated Use `name`. Removed in protocol 18 (#4828). */
            apiName: name,
            // [#5936] The operator's value, passed as read — no local default.
            // What an ABSENT `NODE_ENV` advertises is decided once, inside
            // `resolveDiscoveryEnvironment` (`production`, per the 2026-08-07
            // ruling, direction 1), so this producer and the runtime dispatcher
            // cannot drift on it. Before that ruling the default lived at the
            // dispatcher's own call site and this producer had no equivalent, so
            // a deployment that forgot the variable was told `development` here
            // and `production` there — the exact drift the shared mapper exists
            // to prevent (#4828). Do not re-introduce a default here.
            environment: resolveDiscoveryEnvironment(
                (globalThis as { process?: { env?: Record<string, string | undefined> } })
                    .process?.env?.NODE_ENV,
            ),
            routes,
            locale,
            services,
            capabilities,
            ...(authFamilies ? { authFamilies } : {}),
        };
    }

    /**
     * [#6992] The LIVE metadata-type set of this kernel: every type either
     * registry has heard of, whether or not `DEFAULT_METADATA_TYPE_REGISTRY`
     * declares it. Spellings are returned as each source stores them
     * (singular or plural) — callers normalise through
     * {@link PLURAL_TO_SINGULAR}, as they already did inline.
     *
     * Two sources, and both are needed:
     *
     *  - `engine.registry.getRegisteredTypes()` — the SchemaRegistry. This is
     *    the one that actually carries the plugin-registered family: manifests
     *    register through the `manifest` service during kernel Phase 1
     *    (`ql.registerApp`), so by Phase 2 it holds `theme`, `connector`,
     *    `webhook`, `analytics_cube`, … — none of which have a registry entry
     *    (and `sharing_rule`, which has had one since ADR-0131 D6).
     *  - the `metadata` service's `getRegisteredTypes()` — types the
     *    MetadataManager knows. Its `typeRegistry` is seeded with
     *    `DEFAULT_METADATA_TYPE_REGISTRY` in the manager's constructor, so
     *    early in boot this source contributes only declared types; it grows
     *    later as items are registered (artifact load, runtime `register()`)
     *    and is read for the types the SchemaRegistry has not been told
     *    about. (This comment used to also name `additionalTypes` as a growth
     *    path — that key never had a reader and was retired by #8586.)
     *
     * Extracted from {@link getMetaTypes} rather than copied: the listing and
     * every other caller must answer "which types exist here" identically.
     * One accessor, no second vocabulary.
     */
    private async listLiveMetadataTypes(): Promise<string[]> {
        // [#25467 cut 24] The body moved to `protocol-live-metadata-types.ts` (see `LiveMetadataTypesHost`).
        const readEngine = () => this.engine;
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof listLiveMetadataTypes> = {
            get engine() { return readEngine(); },
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return listLiveMetadataTypes.call(host);
    }

    // [#29510] Named return type; the `exact` pin below holds it EQUAL to what this body infers.
    async getMetaTypes(): Promise<MetaTypesListing> {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.getMetaTypes(protocolHost(this));
    }

    /**
     * Sweep all (or filtered) metadata types and report entries that
     * fail spec validation. Powers the Studio governance view
     * (`GET /api/v1/meta/diagnostics`) and `os doctor`-style CLI
     * checks.
     *
     * `severity` defaults to `'error'` — only entries with at least
     * one Zod error issue are returned. `'warning'` includes
     * everything we surface (warnings are reserved for a future lint
     * layer on top of spec validation).
     *
     * `type` may be either a singular (`'view'`) or plural (`'views'`)
     * identifier; the underlying `getMetaItems` already normalises. An
     * UNRECOGNISED spelling of a declared type (`'viewes'`) is refused with
     * the 400 `getMetaItems` raises for it, not swallowed into a
     * "scanned 1 type, 0 problems" answer — see the [#8924] note in the
     * per-type catch below.
     *
     * Implementation note: leverages the `_diagnostics` already
     * decorated onto items by `getMetaItems()` to avoid running
     * `safeParse()` twice. For types whose schema is unregistered we
     * skip silently (they cannot be validated and should not appear
     * as "valid" either — they are simply opaque to this report).
     */
    getMetaDiagnostics(request: {
        type?: string;
        severity?: 'error' | 'warning';
        packageId?: string;
    } = {}): Promise<{
        entries: Array<{ type: string; name: string; diagnostics: MetadataDiagnostics }>;
        total: number;
        scannedTypes: number;
        scannedItems: number;
        /**
         * Per-type aggregate stats — count of items and the list of
         * packages contributing to each type. Computed in the same
         * sweep so the Studio directory page can render tile counts
         * and a package filter in one round-trip. `locked` is the number
         * of items whose read envelope reports `lock` other than `'none'`
         * — the same derivation `getMetaItem` publishes (#21694).
         */
        stats: Record<string, { count: number; locked: number; packages: string[] }>;
    }> {
        // [#25467 cut 2] The body moved to `protocol-meta-diagnostics.ts` (see `MetaDiagnosticsHost`).
        const host: ThisParameterType<typeof getMetaDiagnostics> = {
            artifactLockLayerAt: (...a) => this.artifactLockLayerAt(...a),
            getMetaItems: (...a) => this.getMetaItems(...a),
            isArtifactBacked: (...a) => this.isArtifactBacked(...a),
            servedLockState: (...a) => this.servedLockState(...a),
            shippingPackagesOf: (...a) => this.shippingPackagesOf(...a),
        };
        return getMetaDiagnostics.call(host, request);
    }

    /**
     * [#5532] Decide what a failed READ against `sys_metadata` means, and
     * rethrow unless it is the ONE benign reason.
     *
     * ## The defect
     *
     * Every overlay read in `getMetaItems`/`getMetaItem` used to `catch {}` into
     * its own empty value — `items` left as-is, `item` left `undefined`, the
     * draft lookup falling through to the active read. That made a metadata
     * store the protocol cannot reach **indistinguishable** from an environment
     * where the item was never customised, and the emptiness then travelled
     * the whole read chain unremarked:
     *
     *   - `getMetaItemCached` turned it into `not found` — an outage answered
     *     as "that item does not exist", which is the opposite disposition
     *     (retry the backend vs. create the item / fix the link);
     *   - the `state='draft'` read turned it into `NO_DRAFT` / 404 — an outage
     *     answered as "there is no pending edit", which a publish flow reads as
     *     "nothing to publish";
     *   - `getMetaItems` turned it into `items: []` — an outage answered as
     *     "this environment declares none of these", the exact shape #5108 fixed
     *     one layer down in `DatabaseLoader` and #5089 in `listForIndex`.
     *
     * ADR-0110 D3 is the rule: a miss and an outage are different facts with
     * opposite meanings, and a consumer must never read one as the other.
     *
     * ## The one benign reason
     *
     * `sys_metadata` has not been provisioned yet. There are then genuinely no
     * overlay rows, so falling through to the registry / MetadataService IS the
     * truth, and a first boot must not explode. Classification is by error TYPE
     * through {@link isMissingTableError} — the same predicate `DatabaseLoader`
     * (#5108) and this package's own `SysMetadataRepository` (#4867) ask, so a
     * driver quirk is taught to the platform once. Conservative in the same
     * direction: an unrecognised error is NOT benign, because a false "benign"
     * silently mis-answers "does this exist?" while a false "real" costs one
     * 503 the caller can retry.
     *
     * ## [#12536] Not benign is not the same as "the store is down"
     *
     * A non-benign failure is classified once more before it is wrapped, by
     * {@link metadataReadFailureError}: a metadata app's hook may have REFUSED
     * this read and marked its refusal with `userMessage` (commit 79c46da90), and that is
     * an application refusal, not a dependency outage. Handing it to the 503
     * below destroyed the mark at the producer — the two failures left this
     * guard as the same envelope with the same sentence. The classification
     * splits them; neither category's wording changes.
     *
     * @throws {@link markedApplicationRefusalError} — [#12536] FIRST, when the
     *         failure carried a producer's `userMessage` mark (commit 79c46da90): the
     *         author's text verbatim, in its own refusal category, with the
     *         cause still carried for the operator and nothing else quoted.
     * @throws {@link metadataStoreUnavailableError} — a 503 carrying the driver
     *         error as `cause`, for every UNMARKED non-benign failure. Not the
     *         driver error itself: unwrapped, it has
     *         no status, so the REST boundary would have to guess from the
     *         message text — and `mapDataError` guesses `no such table` into
     *         `404 OBJECT_NOT_FOUND`, i.e. straight back into a miss.
     * @returns normally ONLY for the benign case, licensing the caller to treat
     *          the overlay as absent.
     */
    private rethrowUnlessMetadataStoreUnprovisioned(error: unknown, readObject: string): void {
        // [commit 4cda78c9b] `readObject` is REQUIRED, deliberately. This helper serves
        // callers that read four different tables (`sys_metadata`,
        // `sys_metadata_audit`, `sys_metadata_commit`, `sys_metadata_history`),
        // so a default would silently answer about the wrong one for three of
        // them — measured, not hypothetical: the first draft of this repair
        // hardcoded `sys_metadata` and turned `diffMetaItem`'s genuinely
        // unprovisioned `sys_metadata_history` into a loud failure. A required
        // parameter makes the compiler ask the question at every new call site.
        if (isMissingTableError(error, readObject)) return;
        // [#12536] CLASSIFY, do not assume. A read can fail because the store
        // is unreachable OR because a metadata app's hook refused it in its
        // own words — see {@link metadataReadFailureError}.
        throw metadataReadFailureError(error);
    }

    /**
     * [#7556] Resolve an OBJECT body that came from the MetadataService into the
     * object's resolved schema, by folding the registry's `extend` contributors
     * onto it.
     *
     * The two readers of a single object — this file's by-name read and its
     * layered view — consult {@link readItemFromMetadataService} BEFORE the
     * SchemaRegistry, because that service is the HMR-fresh copy. For every
     * other metadata type that ordering is free. For `object` it is not: an
     * object's resolved schema is DEFINED (ADR-0029 D9.2 / D9.6) as a base layer
     * with its `extend` contributors folded on, and the MetadataService copy is
     * only the base layer. A deployment that ingests a compiled artifact
     * (`artifactSource`, i.e. every sealed/served runtime) registers its
     * `objects` into that service, and its `objectExtensions` never reach it as
     * items: the ObjectQL engine's `registerApp` registers each one as an
     * `'extend'` contributor of its target object, and the artifact loader files
     * no item from that collection, because an extension carries `extend` and no
     * `name`. So the body this method receives is the owner's declaration with
     * no extender in it. Serving it unfolded is what made the showcase's three
     * `objectExtensions` fields readable through `GET /meta/object`, writable
     * through the data API, and absent from `GET /meta/object/:name` — the read
     * the edit and new forms derive from.
     *
     * The list read needs no counterpart: it reads `registry.listItems`, whose
     * object branch resolves through the same fold, so it was never wrong.
     * This method exists to make the two AGREE at their one point of
     * divergence, not to give the by-name route a rule of its own.
     *
     * Applied ONLY to a MetadataService body. A registry-sourced body has
     * already been folded, and the fold concatenates `validations`/`indexes`
     * (see {@link SchemaRegistry.foldObjectExtendersOnto}), so applying it twice
     * would duplicate both.
     */
    private foldObjectExtendersFromRegistry(type: string, name: unknown, body: unknown, onlyExtensionsOf?: string): unknown {
        // [#25467 cut 30] The body moved to `protocol-object-extender-fold.ts` (see `ObjectExtenderFoldHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof foldObjectExtendersFromRegistry> = {
            get engine() { return readEngine(); },
        };
        return foldObjectExtendersFromRegistry.call(host, type, name, body, onlyExtensionsOf);
    }

    /**
     * [#8284] The PACKAGED (code-layer) OWNER declaration of an object —
     * the base layer, BEFORE `objectExtensions` are folded onto it
     * (ADR-0029 D9.2) and before any tenant `sys_metadata` overlay.
     *
     * Read-only, synchronous, and the ONE fact the localization boundary
     * cannot derive for itself. `translateObject`
     * (`@objectstack/spec/system`) resolves an object's `label` /
     * `pluralLabel` / `description` against the i18n catalog, which is keyed
     * by object name and is the packaged translation of exactly this
     * declaration. Consulting it unconditionally overwrote every scalar that
     * had been authored ON TOP of the declaration — a code-shipped extension
     * scalar, and the tenant's own Studio rename, which answered `200` and
     * then appeared on neither `/meta/object` read (#8284, maintainer ruling
     * 2026-08-13: the catalog loses to an explicit override, decided by
     * comparison against this value).
     *
     * ⛔ NOT {@link lookupArtifactItem}, whose object branch answers
     * `resolveOwnerLayer` — owner **plus its extenders** (see
     * `SchemaRegistry.getArtifactItem`). That body already carries the
     * extension's scalar, so comparing against it would call the extension's
     * label "unchanged" and hand the catalog back the very case #8037 filed.
     * The discriminator is `getPackagedObjectOwner`, which is the same
     * "does a code package ship this?" test (`isCodeArtifactBody`) applied to
     * the OWNER contributor alone.
     *
     * [#27559] Its `validations` are the one exception to "owner only": the
     * registry's `getPackagedObjectBase` appends the rules each CODE extender
     * ships, because a rule's packaged message is whichever code layer shipped
     * that rule name, and the rule evaluator's `packagedRuleLookup` reads the
     * same answer, so `/meta` and the refusal judge a tenant's rewrite against
     * one packaged rule set. The scalars above stay the owner's. A registry
     * double that predates that method is read through
     * `getPackagedObjectOwner`, the owner alone.
     *
     * Returns `undefined` — meaning "no packaged baseline, do not infer
     * anything" — for a runtime/tenant-authored object (no code owner), an
     * unknown name, and a partial registry double. The caller's contract is
     * that absence restores the pre-#8284 behaviour rather than guessing.
     */
    getPackagedObjectBase(name: string): unknown {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.getPackagedObjectBase(protocolHost(this), name);
    }

    /**
     * [#20680] The PACKAGED (code-layer) declaration of a DASHBOARD — the
     * body a code package ships, before any tenant `sys_metadata` overlay.
     * The dashboard twin of {@link getPackagedObjectBase}, and the fact
     * `translateDashboard` (`@objectstack/spec/system`) compares against as
     * its `packagedBase`: the i18n catalog is the packaged translation of
     * exactly this body, so it may only replace a string the served
     * dashboard still carries unchanged from it (ADR-0029 D9.2a — an explicit
     * override beats a packaged default; ADR-0126 Regime O — a packaged
     * dashboard is overlay-editable, and a published overlay is what every
     * read serves).
     *
     * Measured before this existed: an org overlay on `system_overview`
     * published and was returned by {@link getMetaItem} and
     * {@link getMetaItems} — the write and every protocol read resolve ONE
     * identity (`type: 'dashboard'`, the name, `package_id: null`, the org) —
     * yet the served widget title stayed the shipped one, because the
     * translation of the served document had no base to compare with.
     *
     * {@link lookupArtifactItem}, and nothing wider: it answers only an item
     * whose `_packageId` marks a genuine code package and is immune to an
     * overlay row hydrated under the plain registry key, so the body it
     * returns can never be the overlay it is meant to be compared against.
     * A dashboard has no extension fold, so — unlike the object case — the
     * artifact item IS the packaged declaration.
     *
     * Returns `undefined` — "no packaged baseline, infer nothing", which the
     * translator reads as the catalog applying unchanged — for a
     * runtime/tenant-authored dashboard (no code package ships it), an
     * unknown name, and a registry double without the lookup.
     */
    getPackagedDashboardBase(name: string): unknown {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.getPackagedDashboardBase(protocolHost(this), name);
    }

    /**
     * [#20731] The PACKAGED (code-layer) declaration of a VIEW — the view
     * item a code package ships, before any tenant `sys_metadata` overlay.
     * The view twin of {@link getPackagedDashboardBase}, answered the same
     * way, and the fact `translateView` (`@objectstack/spec/system`) compares
     * against as its `packagedBase`: the i18n catalog
     * (`objects.<object>._views.<viewKey>`) is the packaged translation of
     * exactly this body, so it may only replace a string the served view
     * still carries unchanged from it (ADR-0029 D9.2a — an explicit override
     * beats a packaged default; ADR-0126 Regime O — a packaged view is
     * overlay-editable, and a published overlay is what every read serves).
     *
     * Measured before this existed: an org overlay on the showcase's
     * `showcase_task.in_progress` changed its label, published, and was
     * returned by {@link getMetaItem} and {@link getMetaItems}, yet a `zh-CN`
     * reader was served the catalog's translation of the shipped label,
     * because the translation of the served view had no base to compare with.
     *
     * `name` is the served view's REGISTRY identity — the qualified
     * `<object>.<viewKey>` the boot registers each view of a `defineView`
     * container under (`expandViewContainer`), which is also the name the
     * overlay row and both reads carry. ⛔ Not the bare `<viewKey>` the catalog
     * is keyed by under its object: that key is unique only within one object,
     * so it can never select the base (it answers `undefined` here unless some
     * code package registers a view under that literal name).
     *
     * Shadow-immune for the same reason as the dashboard's: an overlay hydrated
     * under the plain registry key is never returned as the base it is meant
     * to be compared against. A view has no extension fold, so the artifact
     * item IS the packaged declaration.
     *
     * Returns `undefined` for a runtime/tenant-authored view (no code package
     * ships it), an unknown or empty name, and a registry double without the
     * lookup — "no packaged baseline", read by the translator as the catalog
     * applying unchanged.
     */
    getPackagedViewBase(name: string): unknown {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.getPackagedViewBase(protocolHost(this), name);
    }

    /**
     * [#25788] The PACKAGED (code-layer) declaration of a REPORT — the report
     * item a code package ships, before any tenant `sys_metadata` overlay.
     * The report twin of {@link getPackagedDashboardBase}, answered the same
     * way, and the fact `translateReport` (`@objectstack/spec/system`)
     * compares against as its `packagedBase`: the i18n catalog
     * (`reports.<name>.label` / `.description`) is the packaged translation of
     * exactly this body, so it may only replace a string the served report
     * still carries unchanged from it (ADR-0029 D9.2a — an explicit override
     * beats a packaged default; ADR-0126 Regime O — a packaged report is
     * overlay-editable, and a published overlay is what every read serves).
     *
     * Landed with the report translator itself, so a report was never served
     * translated without its base: an org's re-authored report label is
     * never replaced by the catalog's translation of the shipped one.
     *
     * A report has no extension fold, so the artifact item IS the packaged
     * declaration. Returns `undefined` for a runtime/tenant-authored report
     * (no code package ships it), an unknown or empty name, and a registry
     * double without the lookup — "no packaged baseline", read by the
     * translator as the catalog applying unchanged.
     */
    getPackagedReportBase(name: string): unknown {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.getPackagedReportBase(protocolHost(this), name);
    }

    /**
     * [#30062] The PACKAGED (code-layer) declaration of a PAGE — the page a
     * code package ships, before a `.custom` pair's declared override replaces
     * it (ADR-0146 D2). The page twin of {@link getPackagedDashboardBase},
     * answered the same way, and the fact `translatePage`
     * (`@objectstack/spec/system`) compares against as its `packagedBase`: the
     * i18n catalog (`pages.<name>`) is the packaged translation of exactly
     * this body, so it may only replace a string the served page still carries
     * unchanged from it (ruling record 6631250894: a translation in the pair,
     * then the override's own label, then the base's translation).
     *
     * Measured before this existed: a pair's override of the CRM's
     * `crm_welcome` labelled `OVpage` was served, and a `zh-CN` reader got the
     * base's `欢迎页`, because the translation of the served page had no base to
     * compare with.
     *
     * Shadow-immune for the dashboard's reason: the override is served from its
     * row, never as the artifact, so the body returned is the base's own. A
     * page has no extension fold, so the artifact item IS the packaged
     * declaration. Returns `undefined` for a page no code package ships, an
     * unknown or empty name, and a registry double without the lookup — "no
     * packaged baseline", read by the translator as the catalog applying
     * unchanged.
     */
    getPackagedPageBase(name: string): unknown {
        return ProtocolDiscoveryAndBasesFacet.getPackagedPageBase(protocolHost(this), name);
    }

    /**
     * [#30062] The PACKAGED (code-layer) declaration of a DATASET, the fact
     * `translateDataset` compares each string against (`datasets.<name>`: its
     * label, description, dimension and measure labels). The dataset twin of
     * {@link getPackagedPageBase}, answered the same way and for the same
     * reason: a pair's dataset override kept the base's translated label and
     * measure labels over its own. Returns `undefined` on the same
     * uncertainties.
     */
    getPackagedDatasetBase(name: string): unknown {
        return ProtocolDiscoveryAndBasesFacet.getPackagedDatasetBase(protocolHost(this), name);
    }

    /**
     * [#30062] The PACKAGED (code-layer) declaration of an APP, the fact
     * `translateApp` compares each string against (`apps.<name>`: its label,
     * description and navigation labels, a node judged against the base's node
     * of the same `id`). The app twin of {@link getPackagedPageBase}, answered
     * the same way. Returns `undefined` on the same uncertainties.
     */
    getPackagedAppBase(name: string): unknown {
        return ProtocolDiscoveryAndBasesFacet.getPackagedAppBase(protocolHost(this), name);
    }

    /**
     * [#30062] The PACKAGED (code-layer) declaration of a BOOK, the fact
     * `translateBook` compares each string against (`books.<name>`: its label,
     * description and group labels, a group judged against the base's group of
     * the same `key`). The book twin of {@link getPackagedPageBase}, answered
     * the same way. Returns `undefined` on the same uncertainties.
     */
    getPackagedBookBase(name: string): unknown {
        return ProtocolDiscoveryAndBasesFacet.getPackagedBookBase(protocolHost(this), name);
    }

    /**
     * [#30062, ADR-0146 D2] The base package a SERVED metadata document is the
     * declared override of, or `undefined` when it is none — read off the
     * envelope every read stamps on a pair's declaring row when it serves it as
     * the base's item (`_packageId` = the base) beside the declaration it was
     * saved with (`overrides.package`). The serving layer asks it before it
     * hands a translator the pair's own translations
     * ({@link getPairTranslationBundle}). An `object` is extended, never
     * replaced (D10), so it never answers one.
     */
    servedOverrideBaseOf(type: string, document: unknown): string | undefined {
        return ProtocolDiscoveryAndBasesFacet.servedOverrideBaseOf(type, document);
    }

    /**
     * [#30062, ADR-0146 D2/D3] The translations a base's paired `.custom`
     * package ships itself, locale-keyed (`{ [locale]: data }`), for the
     * translators' `pairBundle` (`@objectstack/spec/system`): the first rank of
     * the label order on a declared override (ruling record 6631250894 — a
     * translation in the pair, then the override's own label, then the base's
     * translation).
     *
     * Needed because the catalog the deployment serves cannot say where a
     * string came from: the i18n service deep-merges every code bundle and
     * every authored `translation` row, package ids dropped. The pair's own
     * translations are its active `translation` rows (the pair is an authored
     * package, created only through {@link ensureCustomizationPackage}, so it
     * ships no code bundle of its own), read here by their binding.
     *
     * `undefined` when the base has no pair id, when the pair stores no
     * translation, and when the row read fails — "no pair translation known",
     * which the translators read as they did before the option existed.
     */
    getPairTranslationBundle(basePackageId: string): Promise<TranslationBundle | undefined> {
        return ProtocolDiscoveryAndBasesFacet.getPairTranslationBundle(protocolHost(this), basePackageId);
    }

    /** Docblock and body: {@link ProtocolDiscoveryAndBasesFacet.packagedArtifactBase} in `protocol-discovery-and-bases.ts` [#29985 codemod]. */
    private packagedArtifactBase(type: PackagedArtifactBaseType, name: string): unknown {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.packagedArtifactBase(protocolHost(this), type, name);
    }

    /**
     * [#8268, generalising #8038] The REGISTRY-SIDE half of
     * {@link governServedItem}'s presence convergence: replay the registry's
     * object-materialization seam onto the served body.
     *
     * `applyInjectedSystemColumns` (#6562) converges the columns whose
     * membership is a pure function of the document
     * (`resolveInjectedSystemColumns`), so it needs nothing but the body. The
     * materialization stamps are not like that. `__search` is DEPLOYMENT-gated
     * (`SchemaRegistry` provisions it only when its own `searchCompanion` flag
     * is on, and that flag is `options.searchCompanion ??
     * resolveSearchPinyinEnabled()`, which a host may set explicitly), and the
     * ADR-0079 `nameField` designation must match the answer THAT registry
     * reached over THAT object's contributors. So the answer has to come from
     * the registry that made the decision, which is why this is a method here
     * and a `materializeServedObjectOnto` there, exactly as
     * {@link foldObjectExtendersFromRegistry} is a method here and a
     * `foldObjectExtendersOnto` there (#7556).
     *
     * ⛔ It asks for the WHOLE seam, deliberately, and this is the point of
     * #8268 rather than an implementation detail. Three stamps of one seam —
     * #6562's injected system columns, #8038's `__search`, #8268's `nameField`
     * — diverged on this exact read path and were found, filed and fixed ONE AT
     * A TIME, because each convergence reached for one named stamp. A stamp
     * added to `materializeBaseLayer` now arrives here already converged, with
     * no fourth method and no fourth card.
     *
     * Applied AFTER `governServedItem` at each exit, because the registry
     * materializes after `applySystemFields` too: the title is resolved by
     * `resolveDisplayField` over the POST-injection field set, so injecting
     * first is what makes this pass and the registry's own answer the same
     * answer rather than two independent guesses.
     *
     * No-op for every type but `object`, and — via the registry — for a
     * deployment with companions off, an object with no eligible display field,
     * and a body already carrying every stamp (every registry-backed read,
     * which is the majority path this converges the minority onto).
     */
    private materializeFromRegistry<T>(type: string, body: T): T {
        // [#25467 cut 11] The body moved to `protocol-registry-materialize.ts` (see `RegistryMaterializeHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof materializeFromRegistry> = {
            get engine() { return readEngine(); },
        };
        return (materializeFromRegistry<T>).call(host, type, body);
    }

    /**
     * {@link governServedItem} plus the registry-gated half it cannot reach
     * ({@link materializeFromRegistry}) — the whole of what a `/meta` READ EXIT
     * owes an object document. Every call site of the free function that is a
     * read exit goes through this instead; the one call site that is not —
     * `getMetaItemLayered`'s `code` / `overlay` layers, which are deliberately
     * raw — never called it in the first place (#6562 ruling constraint 1,
     * #7556's boundary).
     */
    private governServedObject<T>(type: string, item: T): T {
        // [#25467 cut 11] The body moved to `protocol-registry-materialize.ts` (see `RegistryMaterializeHost`).
        const host: ThisParameterType<typeof governServedObject> = {
            materializeFromRegistry: (...a) => this.materializeFromRegistry(...a),
        };
        return (governServedObject<T>).call(host, type, item);
    }

    /**
     * [#8268, generalising #8038] The write-side counterpart of
     * {@link materializeFromRegistry}, owed for the reason
     * {@link stripServedSystemColumns} is owed one field family over: the write
     * path persists an `object`'s request body verbatim (ADR-0005 appendix
     * (c), the "Addendum — 2026-05-16 (c)"), so a
     * document this service's read added a stamp to would otherwise be handed
     * straight back and stored carrying it.
     *
     * Measured on the runtime-created object path — the write door type
     * `object` has open by default, an artifact-backed object refusing the save
     * outright with `NOT_OVERRIDABLE` — the stored row went from
     * `fields: [name]` to `fields: [__search, name]` on a single GET → PUT
     * before #8038 added the companion half, and gained a `nameField` the
     * author never wrote on the same round trip before #8268 added the title
     * half. The landed `#4326` round-trip pin catches either omission, which is
     * why the read half and this half must move together.
     *
     * ⛔ Asks the registry for the WHOLE seam's inverse rather than for one
     * named stamp — the same reason {@link materializeFromRegistry} does.
     */
    private stripMaterializedFromRegistry<T>(type: string, item: T): T {
        // [#25467 cut 11] The body moved to `protocol-registry-materialize.ts` (see `RegistryMaterializeHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof stripMaterializedFromRegistry> = {
            get engine() { return readEngine(); },
        };
        return (stripMaterializedFromRegistry<T>).call(host, type, item);
    }

    /**
     * {@link stripServedSystemColumns} plus the registry-seam half
     * ({@link stripMaterializedFromRegistry}) — the whole of what the write
     * path owes {@link governServedObject}.
     */
    private stripServedObjectColumns<T>(type: string, item: T): T {
        // [#25467 cut 11] The body moved to `protocol-registry-materialize.ts` (see `RegistryMaterializeHost`).
        const host: ThisParameterType<typeof stripServedObjectColumns> = {
            stripMaterializedFromRegistry: (...a) => this.stripMaterializedFromRegistry(...a),
        };
        return (stripServedObjectColumns<T>).call(host, type, item);
    }

    /** Docblock and body: {@link ProtocolDiscoveryAndBasesFacet.objectRegistrationRefusal} in `protocol-discovery-and-bases.ts` [#29985 codemod]. */
    private objectRegistrationRefusal(
        body: unknown,
        layer: ReturnType<ObjectStackProtocolImplementation['classifyObjectContribution']>,
    ): Error | null {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.objectRegistrationRefusal(protocolHost(this), body, layer);
    }

    /** Docblock and body: {@link ProtocolDiscoveryAndBasesFacet.restoreTranslatedObjectEchoes} in `protocol-discovery-and-bases.ts` [#29985 codemod]. */
    private async restoreTranslatedObjectEchoes(
        request: SaveMetaItemRequest,
        repo: SysMetadataRepository,
        ref: Parameters<SysMetadataRepository['get']>[0],
        mode: 'draft' | 'publish',
    ): Promise<{ item: SaveMetaItemRequest['item']; restored: RestoredTranslatedSlot[] }> {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.restoreTranslatedObjectEchoes(protocolHost(this), request, repo, ref, mode);
    }

    /** Docblock and body: {@link ProtocolDiscoveryAndBasesFacet.restoreInjectedColumnEchoes} in `protocol-discovery-and-bases.ts` [#29985 codemod]. */
    private restoreInjectedColumnEchoes(request: SaveMetaItemRequest): SaveMetaItemRequest['item'] {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.restoreInjectedColumnEchoes(protocolHost(this), request);
    }

    /** Docblock and body: {@link ProtocolDiscoveryAndBasesFacet.registeredTranslationBundle} in `protocol-discovery-and-bases.ts` [#29985 codemod]. */
    private registeredTranslationBundle(): TranslationBundle | undefined {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.registeredTranslationBundle(protocolHost(this));
    }

    /**
     * [#8154] The write-path counterpart the read exits' credential redaction
     * owes, in the same sense {@link stripServedObjectColumns} is owed to
     * {@link governServedObject}: a body this service's READ subtracted
     * something from must not persist that subtraction when it comes straight
     * back. Here the stakes are higher than a phantom customization — the
     * subtracted material is a credential nobody can retype from the wire.
     *
     * Reads the row at rest through the overlay repository, whose rows are
     * served VERBATIM (no ADR-0087 conversion): the comparison must be
     * against the bytes that were written, because those are the bytes the read
     * exit redacted. {@link carryForwardRedactedValues} then decides per
     * redacted path — see its docblock for the three outcomes.
     *
     * [#22128] The row is the one THIS save overwrites, from the repository's
     * write-address resolution ({@link SysMetadataRepository.headAt}) — ⛔ never
     * a read at the key the caller named. A draft save that names no package is
     * stored in the package of the item's active row (#11087); read at the
     * package-unbound key, neither that draft nor that active row was found,
     * the comparison fell to the code layer, and the first package-less draft
     * save of a package-owned datasource persisted its stored credential away.
     *
     * ⚠️ THE DRAFT FALLBACK IS LOAD-BEARING, not defensive. A `?mode=draft`
     * save of an item with no draft row yet has nothing at its own state to
     * compare against, while the body the author edited came from the ACTIVE
     * row — so without the fallback the first draft save drops the credential,
     * and `promoteDraft` later publishes that loss into the active row. The
     * leak's write-side twin, one lifecycle over.
     *
     * ⛔ No `try`/`catch`. A failed stored-row read must fail the SAVE: the
     * alternative is persisting a body whose credential we could not confirm
     * was carried, which is the silent deletion this method exists to prevent.
     * The read is skipped entirely — no extra query, for any save — when the
     * type has no registered redactor, which is every type but `datasource`
     * (built in) and `flow` (registered by the automation plugin, #20552).
     */
    private carryForwardRedactedCredentials(args: {
        type: string;
        repo: SysMetadataRepository;
        ref: Parameters<SysMetadataRepository['get']>[0];
        state: 'draft' | 'active';
        packageId: string | null;
        item: any;
        /** [#22877] The bundle member the save addresses (its body's). */
        member?: string;
    }): Promise<{ item: any; dropped: string[] }> {
        // [#25467 cut 9] The body moved to `protocol-credential-carry-forward.ts` (see `CredentialCarryForwardHost`).
        // [#28640 ②B] It answers the grafted body and the stored positions the
        // save drops (the redactor's `notCarriedForwardKeys`), never re-grafted.
        const host: ThisParameterType<typeof carryForwardRedactedCredentials> = {
            storedBodyForCarryForward: (...a) => this.storedBodyForCarryForward(...a),
        };
        return carryForwardRedactedCredentials.call(host, args);
    }

    /**
     * The body a carry-forward compares against: the row the write overwrites
     * at its own state ({@link SysMetadataRepository.headAt}), the ACTIVE row
     * the draft overlays for a draft save with no draft row yet (see
     * {@link carryForwardRedactedCredentials} for why that fallback is
     * load-bearing), else the CODE layer. RAW in every case — the bytes the
     * read exits redacted — and read with no `try`/`catch`, for the reason the
     * carry-forward gives.
     */
    private storedBodyForCarryForward(args: {
        type: string;
        repo: SysMetadataRepository;
        ref: Parameters<SysMetadataRepository['get']>[0];
        state: 'draft' | 'active';
        packageId: string | null;
        member?: string;
    }): Promise<unknown> {
        // [#25467 cut 9] The body moved to `protocol-credential-carry-forward.ts` (see `CredentialCarryForwardHost`).
        const host: ThisParameterType<typeof storedBodyForCarryForward> = {
            readCodeLayerForCarryForward: (...a) => this.readCodeLayerForCarryForward(...a),
        };
        return storedBodyForCarryForward.call(host, args);
    }

    /**
     * [#20611] The runtime authoring gate's half of the redaction context: the
     * positions in `item` that {@link carryForwardRedactedCredentials} will fill
     * from the stored row when this save reaches its put — computed from the
     * SAME stored body, by the same plan (`redactedPathsCarriedForward`), and
     * without grafting anything. The carry-forward stays after every gate, so no
     * gate handles a restored credential; the gate is told only WHERE one will
     * be restored, which is what it needs to read a withheld-and-stored
     * credential as present rather than missing.
     *
     * Its own read of the row, deliberately not shared with the carry-forward's:
     * that one stays immediately before the put, where it has always been, so a
     * write racing this save between the two is still carried from the latest
     * row. The cost is one more indexed read on an active save of a type with a
     * registered redactor, and nothing for any other type.
     */
    private restoredCredentialPathsFor(args: {
        type: string;
        name: string;
        packageId: string | null;
        item: unknown;
    }): Promise<readonly string[]> {
        // [#25467 cut 9] The body moved to `protocol-credential-carry-forward.ts` (see `CredentialCarryForwardHost`).
        const host: ThisParameterType<typeof restoredCredentialPathsFor> = {
            credentialChannelFor: (...a) => this.credentialChannelFor(...a),
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            storedBodyForCarryForward: (...a) => this.storedBodyForCarryForward(...a),
        };
        return restoredCredentialPathsFor.call(host, args);
    }

    /** Docblock and body: {@link ProtocolDiscoveryAndBasesFacet.readCodeLayerForCarryForward} in `protocol-discovery-and-bases.ts` [#29985 codemod]. */
    private async readCodeLayerForCarryForward(
        type: string,
        name: string,
        packageId: string | null,
    ): Promise<unknown> {
        // [#29985 codemod] The body moved to `protocol-discovery-and-bases.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiscoveryAndBasesFacet.readCodeLayerForCarryForward(protocolHost(this), type, name, packageId);
    }

    /**
     * [#5840] Read ONE item from the `metadata` service, keeping the ADR-0110
     * D3 verdict instead of flattening it into `undefined`.
     *
     * The `sys_metadata` overlay reads in this file already refuse to answer an
     * outage as an absence (#5532 / #5707) — they see a throw and rethrow it as
     * a 503. The MetadataService reads could not do the same, and not because
     * anyone decided they should not: `MetadataManager.get()` swallows a loader
     * failure internally, so an unreachable metadata database arrived here as
     * the very same `undefined` a name that was never declared produces. The
     * verdict existed one layer down (`loadDiagnosed`) and was discarded two
     * hops before this call site. `getDiagnosed` (#5840) hands it over.
     *
     * Deliberately does NOT throw: the two callers want the same fact and
     * dispose of it differently — see each call site. A service that predates
     * `getDiagnosed` reports nothing degraded, which is exactly what it could
     * express before, so its behaviour is unchanged.
     *
     * The singular/plural retry is folded in because both callers do it, and
     * `degraded` must be the verdict of the WHOLE lookup: a first read that
     * failed is not made trustworthy by an alternate spelling that cleanly
     * missed.
     *
     * ## [#23645] A tenant-authored OBJECT body is not a code layer
     *
     * Every caller reads this as the CODE layer: the delete heal's baseline
     * ({@link restoreArtifactRegistryView}, tier 2), the by-name read's step 2,
     * the layered read's `code` layer and the carry-forward's code layer. For
     * an `object` the service can also hold a copy of a stored row. On a kernel
     * with no `environmentId`, ObjectQL's boot bridge
     * (`bridgeObjectsToMetadataService`) copies every object the registry holds
     * into the service, so every runtime object hydrated from `sys_metadata`
     * lands there too, stamped `_provenance: 'org'`. Nothing removes that copy
     * when the row is deleted. Measured on a real `ObjectKernel` with
     * `MetadataPlugin` and `ObjectQLPlugin`: after `DELETE` of a boot-hydrated
     * runtime object answered "it no longer exists", tier 2 found the copy,
     * re-registered it and returned before tier 3's `unregisterObject`. The
     * owner, the data plane and `getMetaItem` (step 2, the same copy) all kept
     * serving the deleted definition until a restart. An object saved in the
     * same process was never copied, so its delete worked.
     *
     * So an `object` body stamped tenant-authored answers here as a clean miss.
     * This is the discriminator {@link getMetaItemLayered} already applies to
     * the registry's plain key ([#21059]): the ADR-0010 marker the hydrator
     * writes, read through `isTenantAuthored`. ⛔ No new marker. A stored row is
     * read from the store, never from this code-layer read. A miss here is not
     * degraded, because the service answered.
     *
     * ⛔ `object` only. The security catalog's echo (`plugin-security`)
     * registers stored `permission` and `position` rows in the service on
     * purpose, stamped the same way. It keeps them current on every mutation,
     * and this read serves them as the code layer by design: its own pins read
     * the layered `code` layer as the echo.
     */
    private async readItemFromMetadataService(
        type: string,
        name: string,
        packageId?: string,
    ): Promise<{ data: unknown; degraded: boolean; errors: string[] }> {
        // [#25467 cut 20] The body moved to `protocol-metadata-service-read.ts` (see `MetadataServiceReadHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof readItemFromMetadataService> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return readItemFromMetadataService.call(host, type, name, packageId);
    }

    /**
     * [#5840] The MetadataService counterpart of
     * {@link rethrowUnlessMetadataStoreUnprovisioned}: turn a degraded read
     * into the same 503 the overlay half of these methods already throws.
     *
     * There is no driver error to carry here — `MetadataManager` warn-logs and
     * skips each failing loader — so `cause` is built from the messages it
     * collected, which is what reaches the operator through
     * `handleRouteError` / `logWithheldServerFault`.
     */
    private throwMetadataServiceUnavailable(errors: string[]): never {
        // [#25467 cut 33] The body moved to `protocol-loud-degradations.ts`; it reads no member.
        return throwMetadataServiceUnavailable(errors);
    }

    async getMetaItems(request: { type: string; packageId?: string; previewDrafts?: boolean }) {
        // [#25467 E1] The body moved to `protocol-meta-list-reads.ts`; it reaches this class through `protocol-host.ts`.
        return getMetaItems(protocolHost(this), request);
    }

    /**
     * [#20552] The flattened list {@link getMetaItems} reads — the same
     * sources, the same merge, the same protection envelope — handed back
     * WITHOUT the serving decorations: no `_diagnostics`, and no per-type
     * credential redaction (`decorateMetadataItems` →
     * `redactMetadataItem`).
     *
     * It exists for exactly one kind of caller: an in-process engine that
     * EXECUTES the definitions it reads. The automation engine arms a flow's
     * inbound hook with the HMAC secret on the flow's start node, and it
     * (re)binds flows from this view at `kernel:ready` and on every
     * `metadata:reloaded`. Once `flow` carries a registered redactor, the
     * served view no longer holds that secret — so a binder reading
     * {@link getMetaItems} would register every `api` flow without its
     * credential, the engine would refuse it, and a Studio-published or
     * rotated secret would never reach the hook. Redaction is a SERVING act
     * (`spec/kernel/metadata-type-redaction.ts`): a raw-record consumer keeps
     * reading the stored body, as the datasource connect path always has.
     *
     * ⛔ Never call this from a door that answers a caller — HTTP, MCP, an
     * export, a log line. Every such exit serves {@link getMetaItems}, whose
     * redaction is the whole reason this method has to exist separately.
     */
    async getMetaItemsForExecution(request: { type: string; packageId?: string; previewDrafts?: boolean }) {
        // [#25467 E1] The body moved to `protocol-meta-list-reads.ts`; it reaches this class through `protocol-host.ts`.
        return getMetaItemsForExecution(protocolHost(this), request);
    }

    /**
     * [#28409, ADR-0146 D8] The list as each package's own address holds it,
     * BEFORE the one effective read: {@link getMetaItems} with the served
     * decorations, with every package's item of a name kept (ADR-0048,
     * one item per package of a name), and with no package's declared
     * override served over that package's own item, and [#29871] with a
     * DISABLED package's items kept: a disable hides them from every served
     * and executed read and leaves them stored (they come back on enable), so
     * the package's own address still holds them. The same sources, the same
     * merges, the same envelope; three steps of the effective read are not
     * taken, and nothing else differs.
     *
     * The list {@link getMetaItems} served before ADR-0146 D8, kept for its
     * two readers and no other:
     *
     *  - **the anonymous form doors' withdrawal judgement** (`form-routes.ts`
     *    in `@objectstack/rest`). A withdrawal is a kill switch: a public form
     *    withdrawn by any body the doors honoured is never re-opened (the
     *    hard requirement ruled on #28238, option 3). So the doors judge it
     *    against this layer beside the effective list, never against a layer
     *    narrower than this one — it still holds a dependent package's
     *    same-named row and the base's own document under a declared override
     *    (and a disabled package's view, whose withdrawal can only close a
     *    form: the doors offer only the effective list's forms);
     *  - **the package export** (`GET /packages/:id/export` in
     *    `@objectstack/runtime`). A package exports its own items: the base's
     *    export carries the base unchanged, and its pair's export carries the
     *    overriding item with its `overrides` block (ADR-0146 D8 item 3); and a
     *    disabled package's export carries its items, as
     *    `PackageExportBundleSchema` declares (every package exported, enabled
     *    or not, and installed enabled).
     *
     * ⛔ Not a second list for anything else. Every door that serves a
     * package's name serves {@link getMetaItems}, the one effective read.
     */
    async getMetaItemsPerPackage(request: { type: string; packageId?: string; previewDrafts?: boolean }) {
        // [#25467 E1] The body moved to `protocol-meta-list-reads.ts`; it reaches this class through `protocol-host.ts`.
        return getMetaItemsPerPackage(protocolHost(this), request);
    }

    /**
     * [#28411, ADR-0146 D8 item 4] The served overrides of a base package's
     * items: each ACTIVE row of its paired `<base>.custom` package that
     * {@link isServedOverrideRowOf} admits and no read declines, as
     * `{ type, name, member?, basedOn?, version? }`, ordered by type, name and
     * member. The overrides half of `GET /packages/:id/customizations`; the
     * body and its narrowings are `protocol-served-overrides.ts`'s.
     *
     * A base with no pair, or an id with no pair, answers `[]`, and the read
     * never creates the pair. No diff and no `basedOn` verdict: `basedOn` is
     * copied as recorded (ADR-0146 D2, D6).
     *
     * @throws the `sys_metadata` read failure, classified by
     *         {@link rethrowUnlessMetadataStoreUnprovisioned}; an unprovisioned
     *         table answers `[]`.
     */
    async listServedOverrides(request: { packageId: string }): Promise<ServedOverrideEntry[]> {
        const host: ThisParameterType<typeof listServedOverrides> = {
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            declinesStoredRow: (...a) => this.declinesStoredRow(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
        };
        return listServedOverrides.call(host, request);
    }

    /**
     * [#28413, ADR-0146 D11] The census `os migrate packageless-overlays`
     * previews: every environment `sys_metadata` row of one of the five
     * `allowEnvironmentOverlay` types bound to no package, classified against
     * the code packages that ship its name — `movable` (exactly one ships it,
     * and its pair holds no row of the name in that state), `shadowed` (the
     * pair already does), `multi_shipped`, `foreign_declaration` or `no_pair`
     * — plus the count of rows of a name no package ships (environment
     * metadata, left alone), and every pair row declaring an override with no
     * `basedOn`. Writes nothing; the body and its rules are
     * `protocol-packageless-overlay-migration.ts`'s.
     *
     * @throws the `sys_metadata` read failure, classified by
     *         {@link rethrowUnlessMetadataStoreUnprovisioned}; an unprovisioned
     *         table answers an empty census.
     */
    async listPackagelessOverlays(): Promise<PackagelessOverlayCensus> {
        const host: ThisParameterType<typeof listPackagelessOverlays> = {
            overlayTypes: ObjectStackProtocolImplementation.OVERLAY_ALLOWED_TYPES,
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
            shippedArtifactsOf: (...a) => this.shippedArtifactsOf(...a),
            isWritablePackage: (...a) => this.isWritablePackage(...a),
        };
        return listPackagelessOverlays.call(host);
    }

    /**
     * [#28413, ADR-0146 D11] `os migrate packageless-overlays --apply`: move
     * each `movable` row of {@link listPackagelessOverlays}'s census into its
     * base's paired `<base>.custom` as a declared override — the pair ensured
     * through {@link ensureCustomizationPackage}, the body given
     * `overrides: { package: <base>, basedOn: <base manifest.version> }` and
     * saved through {@link saveMetaItem} in the row's own state, read back as
     * the served override (`isServedOverrideRowOf`), and only then the unbound
     * row deleted by its own address — and complete every pair declaration
     * missing `basedOn` the same way. One outcome per row, never thrown for a
     * row; a second run moves nothing. ⛔ Not a boot step.
     */
    async migratePackagelessOverlays(request: { actor: string }): Promise<PackagelessOverlayMigration> {
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof migratePackagelessOverlays> = {
            get engine() { return readEngine(); },
            overlayTypes: ObjectStackProtocolImplementation.OVERLAY_ALLOWED_TYPES,
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
            shippedArtifactsOf: (...a) => this.shippedArtifactsOf(...a),
            isWritablePackage: (...a) => this.isWritablePackage(...a),
            ensureCustomizationPackage: (...a) => this.ensureCustomizationPackage(...a),
            saveMetaItem: (...a) => this.saveMetaItem(...a),
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            // [#30000] Awaited here too: the census of `sys_metadata` writes reads every call into the heal.
            restoreArtifactRegistryView: async (...a) => { await this.restoreArtifactRegistryView(...a); },
        };
        return migratePackagelessOverlays.call(host, request);
    }

    /**
     * The one body behind {@link getMetaItems},
     * {@link getMetaItemsForExecution} and {@link getMetaItemsPerPackage}.
     * `audience` decides ONLY whether the serving decorations are applied at
     * the very end; every source, merge and filter above that line is shared,
     * so the list the engine executes and the list a caller is served cannot
     * disagree about which items exist.
     *
     * [#28409] `layer` decides ONLY whether the two steps of the one
     * effective read are taken (ADR-0146 D8): a package's declared override
     * served over its slot ({@link servedOverlayRowCandidates}'
     * `servedOverride`), and, naming no package, a name exactly one code
     * package ships listed once, under that package
     * ({@link soleShippingPackageOf}). `'effective'` takes both; the
     * per-package layer takes neither.
     *
     * `request` arrives already folded by the calling face (#4432).
     */
    private async readFlattenedMetaItems(
        request: { type: string; packageId?: string; previewDrafts?: boolean },
        audience: 'served' | 'execution',
        layer: 'effective' | 'per-package' = 'effective',
    ) {
        // [#25467 E1] The body moved to `protocol-meta-list-reads.ts`; it reaches this class through `protocol-host.ts`.
        return readFlattenedMetaItems(protocolHost(this), request, audience, layer);
    }

    /**
     * [ADR-0131 D6/D7] THE protocol seam for every read of a `sys_metadata`
     * family table: the engine's read, without a legacy organization's rows.
     *
     * The family declares no organization column, so the engine can neither
     * filter on it nor return it. On a database the organization-ownership
     * ceremony has not migrated, the physical column still holds each legacy
     * organization's rows ({@link readLegacyOrganizationRows}). `os serve`
     * refuses such a database; the `os migrate` boots (the ceremony's own
     * among them) read it, and none of their reads may serve, list, address,
     * lock or bind one organization's row as the environment's. So every read
     * goes through here: on a migrated or fresh database this costs one catalog
     * read per process (the absent verdict is remembered), and a read that
     * cannot answer throws. A read inside a transaction joins it
     * (`context.transaction`).
     *
     * [#23609] A read that PAGES (`limit`, `offset`) leaves the legacy rows out
     * before the page is cut, never after: filtered after, a page the legacy
     * rows sat in came back short (an audit page, a commit page), and a
     * `limit: 1` probe whose one row was a legacy organization's read as "no
     * row" ({@link revertStoredPackage}'s "never been published"). The read
     * stays the common path; only when the legacy rows could have taken a
     * place in the page is it re-read with them excluded in the query itself.
     * On a migrated or fresh database there are none, and the one read is the
     * whole answer.
     *
     * Two reads deliberately do NOT: {@link migrateStoredMetadata}, which must
     * see a legacy row to report it, and the commit read of {@link revertCommit}
     * and {@link rollbackToPackageCommit} ({@link readRevertableCommit}), which
     * refuses a legacy commit by name; each reads the column itself.
     */
    private async findEnvironmentRows(table: string, query: { where: Record<string, unknown>; context?: unknown; [key: string]: unknown }): Promise<any[]> {
        // [#25467 cut 35] The body moved to `protocol-environment-rows.ts` (see `EnvironmentRowsHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof findEnvironmentRows> = {
            get engine() { return readEngine(); },
            legacyOrganizationRowsOf: (...a) => this.legacyOrganizationRowsOf(...a),
            withoutLegacyOrganizationRows: (...a) => this.withoutLegacyOrganizationRows(...a),
        };
        return findEnvironmentRows.call(host, table, query);
    }

    /**
     * [ADR-0131 D6/D7] {@link findEnvironmentRows} for one row: the single-row
     * read stays the common path; only when the row it returns is a legacy
     * organization's is the address re-read for the environment's own row
     * (`null` when there is none).
     */
    private async findEnvironmentRow(table: string, query: { where: Record<string, unknown>; context?: unknown; [key: string]: unknown }): Promise<any> {
        // [#25467 cut 35] The body moved to `protocol-environment-rows.ts` (see `EnvironmentRowsHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof findEnvironmentRow> = {
            get engine() { return readEngine(); },
            legacyOrganizationRowsOf: (...a) => this.legacyOrganizationRowsOf(...a),
        };
        return findEnvironmentRow.call(host, table, query);
    }

    private async withoutLegacyOrganizationRows<R>(table: string, rows: R[] | null | undefined, context?: unknown): Promise<R[]> {
        // [#25467 cut 29] The body moved to `protocol-legacy-organization-rows.ts` (see `LegacyOrganizationRowsHost`).
        const host: ThisParameterType<typeof withoutLegacyOrganizationRows> = {
            legacyOrganizationRowsOf: (...a) => this.legacyOrganizationRowsOf(...a),
        };
        return (withoutLegacyOrganizationRows<R>).call(host, table, rows, context);
    }

    private legacyOrganizationRowsOf(table: string, context?: unknown): Promise<ReadonlyMap<string, string>> {
        // [#25467 cut 29] The body moved to `protocol-legacy-organization-rows.ts` (see `LegacyOrganizationRowsHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof legacyOrganizationRowsOf> = {
            get engine() { return readEngine(); },
        };
        return legacyOrganizationRowsOf.call(host, table, context);
    }

    /**
     * [#21442, ADR-0131 D6] The active `sys_metadata` rows a read of
     * `request.type` consults: the environment's rows, restricted to
     * `request.packageId` when one is given. Moved here unchanged from
     * {@link readFlattenedMetaItems}, the list read, so the by-name read
     * ({@link resolveRowlessExpandedView}) selects the view containers it
     * expands by this same rule — ⛔ never a second selection rule, which would
     * be a second expansion rule.
     *
     * A read failure is thrown as the engine threw it; each caller applies the
     * #5532 rule ({@link rethrowUnlessMetadataStoreUnprovisioned}).
     */
    private async readActiveOverlayRows(
        request: { type: string; packageId?: string },
    ): Promise<any[]> {
        // [#25467 cut 16] The body moved to `protocol-stored-overlay-reads.ts` (see `StoredOverlayReadHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof readActiveOverlayRows> = {
            get engine() { return readEngine(); },
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
        };
        return readActiveOverlayRows.call(host, request);
    }

    /**
     * [#21442] Each active row {@link readActiveOverlayRows} returned, parsed as
     * the list read parses it: the body (stored-row conversions replayed), the
     * package and the organization the row is bound to, and the row's own name.
     * Moved here from {@link readFlattenedMetaItems} so the by-name read
     * expands the very bodies the list read expands.
     */
    private storedOverlayEntries(
        request: { type: string },
        records: any[],
    ): StoredOverlayEntry[] {
        // [#25467 cut 16] The body moved to `protocol-stored-overlay-reads.ts` (see `StoredOverlayReadHost`).
        const host: ThisParameterType<typeof storedOverlayEntries> = {
            convertStoredItem: (...a) => this.convertStoredItem(...a),
        };
        return storedOverlayEntries.call(host, request, records);
    }

    /**
     * [#21442] Every item the stored view containers in `overlays` expand, in
     * row order, each paired with the stored row it was expanded from. The one
     * expansion pass both doors run: the list read serves the items, and
     * {@link resolveRowlessExpandedView} also needs the row. Each container
     * goes through {@link expandRuntimeViewContainer}, unchanged. [#21967]
     * Which of them serves a name at a package's address is
     * {@link servedViewExpansion}'s answer, for both doors: within one package
     * a later expansion of a name replaces an earlier one.
     */
    private expandStoredViewContainers<E extends { data: unknown; packageId: string | undefined }>(
        type: string,
        overlays: readonly E[],
    ): Array<{ item: Record<string, unknown>; container: E }> {
        // [#25467 cut 33] The body moved to `protocol-registry-view-predicates.ts` (see `RegistryViewPredicatesHost`).
        const host: ThisParameterType<typeof expandStoredViewContainers> = {
            expandRuntimeViewContainer: (...a) => this.expandRuntimeViewContainer(...a),
        };
        return (expandStoredViewContainers<E>).call(host, type, overlays);
    }

    /**
     * [#21510] The names that have a stored row of their own among `records`,
     * the active rows {@link readActiveOverlayRows} selected for one caller.
     *
     * ADR-0005 keys an overlay by its own name, so a row stored under exactly a
     * name is the sanctioned override for that name. An expansion is derived
     * from its container, so it fills only a name that is NOT in this set. This
     * is the one predicate both doors ask: the list read
     * ({@link readFlattenedMetaItems}) never lets an expansion displace a
     * stored row of the same name, and the by-name read
     * ({@link resolveRowlessExpandedView}) answers an expansion only for a name
     * outside it. Both doors pass the rows they selected for the same caller,
     * so a name that has a row in one organization only is row-less for every
     * other caller. ⛔ Never a second test of "this name has its own row":
     * two tests are two rules, and the doors would disagree again.
     *
     * [#21967] …and both pass the package whose slot they fill, so a name that
     * has a row in one package only is row-less for every other package's
     * slot. With `packageId`, a row counts when it is bound to that package or
     * package-less, the package dimension of {@link servedOverlayRowCandidates}
     * (a package-less row stands in for every package, ADR-0048); with none,
     * every row counts. Before, the list asked with no package for every slot,
     * so one package's row of a name kept every other package's container
     * expansion of it out of the list, while the by-name read naming that
     * other package served the expansion.
     */
    private namesWithOwnStoredRow(records: readonly any[], packageId?: string): ReadonlySet<string> {
        // [#25467 cut 16] The body moved to `protocol-stored-overlay-reads.ts`.
        return namesWithOwnStoredRow(records, packageId);
    }

    /**
     * [#21442] The item the list read serves under `request.name` when that
     * name is ROW-LESS — no stored row of its own — and a stored view
     * container in this caller's scope expands it; `undefined` otherwise.
     *
     * The list read ({@link readFlattenedMetaItems}) expands every stored
     * container it reads into its own answer, so `GET /meta/view?object=`
     * lists the container's views. Nothing else stores or registers those
     * views on every kernel: the registry hydration that does
     * ({@link hydrateExpandedViewItems}) ran on a save only on an unscoped
     * kernel ([#23298]: now wherever {@link registryTakesStoredRows}), and
     * only for an environment-wide row. So the by-name read answered an
     * expanded name only there, and answered nothing on an
     * environment-scoped kernel or for an organization-scoped container — and,
     * where the name is one a package also ships, answered the packaged row
     * instead of the one the list serves.
     *
     * The answer is the list read's own, by construction: the same rows
     * ({@link readActiveOverlayRows}, same `packageId`, the environment's),
     * the same parse ({@link storedOverlayEntries}) and the same expansion
     * ({@link expandStoredViewContainers} over
     * {@link expandRuntimeViewContainer}), selected for the address by the
     * same function ({@link servedViewExpansion}). [#21967] Naming a package,
     * that is the package's slot in the list: the expansion of the package's
     * own container row, else of a package-less one, which stands in (the
     * package-less rows are read as the list scoped to the package reads
     * them); naming none, any expansion of the name, the last one winning.
     * Nothing is persisted or registered: an
     * expansion is derived from its container on every read, so there is no
     * second copy to drift from it (ADR-0005 keys an overlay by its own name).
     * ⛔ No kernel-specific branch — every kernel answers through this path.
     *
     * A stored row of this very name is the name's own row and is answered
     * as such by the caller's own read, never an expansion — the same
     * predicate the list read applies ({@link namesWithOwnStoredRow}). The `container`
     * returned is the stored row the item derives from — its own name, body,
     * package and organization — which the layered read reports as the
     * name's provenance and the history and diff reads resolve to.
     */
    private async resolveRowlessExpandedView(
        request: { type: string; name: string; packageId?: string },
    ): Promise<RowlessExpandedView | undefined> {
        // [#25467 cut 22] The body moved to `protocol-view-expansion-names.ts` (see `ViewExpansionNamesHost`).
        const host: ThisParameterType<typeof resolveRowlessExpandedView> = {
            expandStoredViewContainers: (...a) => this.expandStoredViewContainers(...a),
            namesWithOwnStoredRow: (...a) => this.namesWithOwnStoredRow(...a),
            readActiveOverlayRows: (...a) => this.readActiveOverlayRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
            storedOverlayEntries: (...a) => this.storedOverlayEntries(...a),
        };
        return resolveRowlessExpandedView.call(host, request);
    }

    /**
     * [#21716, ADR-0005] The stored `sys_metadata` row a by-name read SERVES
     * for `(type, name)` — the ONE content resolution {@link getMetaItem} (both its draft-preview
     * arm and its row read) and {@link getMetaItemLayered} call.
     *
     * [#21761] It decides the served CONTENT only, never the lock. The lock's
     * `overlay` layer is {@link overlayLockLayerAt}, which every reader and
     * the `_lock` gate call with the item's address: it reads every row of the
     * item in scope, where this method prefers one. Before #21761 the gate
     * called this method too, with no package, so a read naming a package
     * reported that package's row while the gate bound whichever row
     * `findOne` returned first.
     *
     * The environment's rows only (ADR-0131 D6/D7): a legacy organization's
     * row, on a database the ceremony has not migrated, is left out by
     * {@link findEnvironmentRow}, off the physical column, and never served.
     * ADR-0048 prefer-local: with a `packageId`, that package's row first and
     * then the package-less row, never another package's; with none, any row.
     *
     * [#21804] That order is {@link servedOverlayRowCandidates}, and this
     * method is its store reader: one `findOne` per candidate, first hit
     * served. The list's merge ({@link mergePackageAwareOverlay}) is its other
     * reader, over the rows the list already read, so a package's list slot
     * serves the row this method serves for that package.
     *
     * The reads keep the at-rest tolerance they have always had: a row stored
     * under the type's other spelling (pre-#4432 residue) is the last resort.
     *
     * [#24371] `activeRows`, when given, is the item's ACTIVE rows under both
     * spellings as {@link readItemActiveRows} read them: the candidates are then
     * selected from those rows, each by the `where` it would have sent the
     * store ({@link rowMatchesOverlayWhere}), instead of one `findOne` each.
     *
     * [#28409, ADR-0146 D8 item 2] `servedOverride: true`, from a read that
     * serves the package's name, puts the package's declared override first
     * ({@link servedOverlayRowCandidates}); the answer's `overrideOf` then
     * names the package the row overrides, and the caller serves the row as
     * that package's item.
     *
     * Returns `undefined` when no row is found. A failed read propagates: each
     * caller owns its #5532 discrimination.
     */
    private async findServedOverlayRow(args: {
        type: string;
        name: string;
        state: 'active' | 'draft';
        /** [#23715] `null`: the package-unbound row alone (see {@link servedOverlayRowCandidates}). */
        packageId?: string | null;
        /** [#22877] The bundle member a by-name door's selector named; omitted, the canonical one. */
        member?: string;
        /** [#28409] The package's declared override first — see {@link servedOverlayRowCandidates}. */
        servedOverride?: boolean;
    }, activeRows?: readonly StoredOverlayRow[]): Promise<{ row: any; overrideOf?: string } | undefined> {
        // [#25467 cut 35] The body moved to `protocol-environment-rows.ts` (see `EnvironmentRowsHost`).
        const host: ThisParameterType<typeof findServedOverlayRow> = {
            findEnvironmentRow: (...a) => this.findEnvironmentRow(...a),
        };
        return findServedOverlayRow.call(host, args, activeRows);
    }

    /**
     * [#21761, ADR-0005, ADR-0048, ADR-0010 §3.3] The item-lock resolution's
     * `overlay` layer ({@link resolveItemLock}) for the item at `address`:
     * {@link resolveOverlayLockLayer}, the one selection of the rows in scope,
     * over the item's stored ACTIVE rows, read here scope by scope with no
     * package filter. The `_lock` gate ({@link readLockGateOverlayLayer}),
     * {@link getMetaItem}, {@link getMetaItemLayered} and the list
     * ({@link readFlattenedMetaItems}, from the rows it already read) select
     * the lock this way from the address each was asked about, so a read and a
     * door cannot bind different rows.
     *
     * `otherSpelling` is the one declared difference between the callers. The
     * reads pass `true`: a row stored under the type's other spelling
     * (pre-#4432 residue) is in scope when no canonical row is, as for the
     * content they serve ({@link findServedOverlayRow}). The `_lock` gate
     * passes `false`: a write addresses the canonical namespace only (#4432,
     * #9009, the key `SysMetadataRepository.whereFor` stores under), and
     * extending a tolerant lookup below the folding boundary into every write
     * is what #4432 refused. So the two agree on every row stored under the
     * canonical spelling, which is every row a live write can mint.
     *
     * [#24371] `activeRows`, when given, is the item's ACTIVE rows under both
     * spellings as {@link readItemActiveRows} read them, and each spelling's
     * rows are taken from them instead of read again.
     *
     * A failed read propagates: each caller owns its #5532 / #5706
     * discrimination.
     */
    private overlayLockLayerAt(
        address: ItemAddress,
        options: { readonly otherSpelling: boolean },
        activeRows?: readonly StoredOverlayRow[],
    ): Promise<unknown> {
        // [#25467 cut 33] The body moved to `protocol-stored-row-bindings.ts` (see `StoredRowBindingsHost`).
        const host: ThisParameterType<typeof overlayLockLayerAt> = {
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
        };
        return overlayLockLayerAt.call(host, address, options, activeRows);
    }

    /**
     * [#24371, ADR-0131 D6] The item's stored ACTIVE rows under BOTH spellings
     * of its type, in ONE store read: every row any of the by-name read's
     * active-row selections consults ({@link packagelessAddress}'s binding,
     * {@link findServedOverlayRow}'s candidates and {@link overlayLockLayerAt}'s
     * scope), each of which then selects from these rows by the `where` it
     * would have sent the store. Before, {@link getMetaItem} sent those
     * selections to the store one by one, five serial reads of the same rows
     * on every `/data` request (the API-exposure gate reads the object by
     * name), and every read is a round trip to a hosted database.
     *
     * The environment's rows only ({@link findEnvironmentRows}). A failed read
     * propagates: the caller owns its #5532 discrimination.
     *
     * [#10757 leg 6] `cached` — the API faces only ({@link getMetaItem} and,
     * [#24535], {@link getMetaItemForExecution}, which share this key) —
     * reads through the overlay cache that already holds the list read's rows
     * (`meta-overlay-cache.ts`, #11967), under a key naming this item: the
     * same raw rows, upstream of every parse, merge and hydration, retired the
     * moment a `sys_metadata` write settles (a save is seen by the next read,
     * as before) or the epoch moves for a non-`write` reason, and bounded by
     * `OS_METADATA_OVERLAY_CACHE_TTL_MS`. The REST
     * API-exposure gate reads the object by name on every `/data` request, and
     * this read was its one uncached `sys_metadata` round trip. Uncached, the
     * read is per call and never kept, exactly as before.
     */
    private async readItemActiveRows(type: string, name: string, cached = false): Promise<StoredOverlayRow[]> {
        // [#25467 cut 16] The body moved to `protocol-stored-overlay-reads.ts` (see `StoredOverlayReadHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof readItemActiveRows> = {
            get engine() { return readEngine(); },
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
        };
        return readItemActiveRows.call(host, type, name, cached);
    }

    /**
     * [#23183] The packages {@link resolveAppPackageIdKey} has reported as
     * holding more than one app, keyed by package and app set, so the operator
     * is told once per state rather than once per read.
     */
    private readonly reportedMultiAppPackages = new Set<string>();

    /**
     * [#23183] ADR-0048 §3.1: "The route/container coordinate for an installed
     * package's UI is its package id … With the current one-app-per-package
     * invariant, the app *is* the package container." So the app item read
     * answers for a package id as it answers for the app's own name, as
     * `GetMetaItemRequestSchema.name` declares. This is the one place the key is
     * resolved: both transports' item reads hand {@link getMetaItem} the key
     * they were asked for, and neither resolves it itself.
     *
     * Recognised by `isAppPackageIdKey` (`@objectstack/spec/api`): `type: 'app'`
     * and a key in the package-id grammar, which no app name is in. Every other
     * request is returned untouched, so every by-name read of every type is
     * unchanged.
     *
     * "The package's app" is what the package-scoped list serves
     * ({@link getMetaItems} with `packageId`, the read behind
     * `GET /meta/app?package=`): the apps the package ships, its stored rows
     * included, none for a disabled package. Its drafts are in view exactly
     * when this read reads drafts (`state: 'draft'` or `previewDrafts`), so the
     * key resolves to the app the read itself would serve.
     *
     *  - ONE app: the request becomes that app's by-name read, scoped to the
     *    package (`packageId`, ADR-0048 prefer-local). The envelope names the
     *    app by its own `name`, the address a save of it uses and the item its
     *    `version` token belongs to.
     *  - NONE, or MORE THAN ONE (a package breaking ADR-0019 D3's at-most-one
     *    rule, which the save door does not enforce): the request is returned
     *    as asked, and its by-name read answers absence, because no legal app
     *    name is in the package-id grammar. Absence, and no answer of its own:
     *    the doors' read gate answers an unpublished app as absent (ADR-0045
     *    §3), and a separate "two apps" answer would let a caller see an app
     *    being built in the package before it is published. The operator is
     *    told instead, in the log.
     *
     * A `packageId` naming a different package is refused `400 INVALID_REQUEST`:
     * the key already names the package, and a prefer-local scope from a
     * second package would read that package's same-name app, not this one's.
     *
     * A failed list read propagates: a store outage is never answered as "no
     * such package" (#5532).
     */
    private async resolveAppPackageIdKey<R extends {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
    }>(request: R): Promise<R> {
        // [#25467 cut 33] The body moved to `protocol-package-scope.ts` (see `PackageScopeHost`).
        const readReportedMultiAppPackages = () => this.reportedMultiAppPackages;
        const host: ThisParameterType<typeof resolveAppPackageIdKey> = {
            getMetaItems: (...a) => this.getMetaItems(...a),
            get reportedMultiAppPackages() { return readReportedMultiAppPackages(); },
        };
        return (resolveAppPackageIdKey<R>).call(host, request);
    }

    /**
     * The by-name `/meta` read (`GET /meta/:type/:name`): an API reader.
     *
     * [#7557, #24097] An object whose owning package is disabled is refused
     * here, `404 OBJECT_PACKAGE_DISABLED`, in every state this read serves
     * (active, `state: 'draft'`, `previewDrafts`), checked once before any
     * layer is read: the listing omits that object and the data plane refuses
     * it, and this read answers with them. Authoring callers inside this class
     * that must still see the object (the save's destructive-change check)
     * read {@link readMetaItem}, the shared body, instead: the reader-class
     * split `package-disable-enforcement.test.ts` pins.
     *
     * [#7557, #24210] Every other type but `package` has no data plane, so a
     * disabled package's item is answered as ABSENT, the answer a name with
     * nothing behind it gets: the list read omits that item, by the same
     * predicate ({@link isItemOfDisabledPackage}) asked of the item this read
     * resolved, in every state. The strict draft read throws the missing
     * draft's `404 NO_DRAFT`. The other reads serve no `item`, which both
     * transports answer `404 RESOURCE_NOT_FOUND`, byte for byte the missing
     * name's answer, and drop `registration`, the engine's verdict on a served
     * flow. The protection envelope stays: it reports the write doors'
     * verdicts about this address (#21670), and a disable does not change how
     * the lock gate judges a save there. `package` is never hidden, so a
     * disabled package can still be read and re-enabled.
     */
    async getMetaItem(request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        /** [#22877] The bundle member to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
        member?: string,
    }) {
        // [#25467 E1] The body moved to `protocol-meta-item-reads.ts`; it reaches this class through `protocol-host.ts`.
        return getMetaItem(protocolHost(this), request);
    }

    /**
     * [#24535] The item {@link getMetaItem} reads — the same sources, the same
     * overlay cache, the same merge, lock and governance, the same
     * disabled-package refusal and withholding, the same envelope — handed
     * back WITHOUT the serving decorations: no `_diagnostics` (the full schema
     * `safeParse` of {@link computeMetadataDiagnostics}, and a view's
     * cross-document reference diagnostics), no per-type credential redaction
     * (`decorateMetadataItem` → `redactMetadataItem`), and no `registration`.
     * The by-name twin of {@link getMetaItemsForExecution}, for the reason
     * that method records, and the second face of the one body
     * {@link readMetaItemFace}.
     *
     * It exists for a caller that ACTS on a definition and serves none of it.
     * The REST API-exposure gate reads the object behind every
     * `GET /api/v1/data/OBJECT` by name to judge its `enable` block, and
     * nothing else; on the served face that read paid a full diagnostic
     * `safeParse` of the object's definition per request (11.8% of a HotCRM
     * read's CPU, measured), to compute a key the gate never reads.
     *
     * ⛔ Never serve what this returns from a door that answers a caller —
     * HTTP, MCP, an export, a log line. Every such exit serves
     * {@link getMetaItem}, whose redaction is the whole reason this method has
     * to exist separately. A gate inside such a door may read a DECISION off
     * it (the exposure gate reads `enable`); no byte of the body may reach the
     * response.
     */
    async getMetaItemForExecution(request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        /** [#22877] The bundle member to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
        member?: string,
    }) {
        // [#25467 E1] The body moved to `protocol-meta-item-reads.ts`; it reaches this class through `protocol-host.ts`.
        return getMetaItemForExecution(protocolHost(this), request);
    }

    /**
     * The one body behind {@link getMetaItem} and
     * {@link getMetaItemForExecution}: the disabled-package refusal and
     * withholding {@link getMetaItem} documents, around {@link readMetaItem}.
     * `face` decides ONLY whether the serving decorations are applied at the
     * read's exits; every source, cache, merge, lock and governance step
     * above them is shared, so the item a gate acts on and the item a caller
     * is served cannot disagree about which body is behind the name.
     *
     * `request` arrives already folded by the calling face (#4432).
     */
    private async readMetaItemFace(request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        member?: string,
    }, face: 'served' | 'execution') {
        // [#25467 cut 31] The body moved to `protocol-meta-item-face.ts` (see `MetaItemFaceHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof readMetaItemFace> = {
            get engine() { return readEngine(); },
            readMetaItem: (...a) => this.readMetaItem(...a),
        };
        return readMetaItemFace.call(host, request, face);
    }

    /**
     * The body of {@link getMetaItem} without its disabled-package refusal:
     * the object as the layers resolve it, whether or not its package is
     * disabled. Private on purpose; only this class's authoring callers read
     * it.
     *
     * [#10757 leg 6] `face` is set by the API faces alone ({@link getMetaItem}
     * and [#24535] {@link getMetaItemForExecution}, through
     * {@link readMetaItemFace}): they read the item's active rows through the
     * overlay cache ({@link readItemActiveRows}), under one entry for both. An
     * authoring caller passes nothing and reads the store, so a save is never
     * judged against a cached row.
     *
     * [#24535] `face: 'execution'` skips the serving decorations at this
     * read's exits, and nothing else: see {@link getMetaItemForExecution}. An
     * authoring caller is decorated as the served face is, as before.
     */
    private async readMetaItem(request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        member?: string,
    }, opts: { face?: 'served' | 'execution' } = {}) {
        // [#25467 E1] The body moved to `protocol-meta-item-reads.ts`; it reaches this class through `protocol-host.ts`.
        return readMetaItem(protocolHost(this), request, opts);
    }

    /**
     * [#28337, ADR-0048] The layered view's door refusal: what
     * `GET /meta/:type/:name/layers` (and the deprecated `?layers=true`)
     * answers when it names no package and the item's ACTIVE rows are bound
     * to two or more packages. The refusal the package-less save and delete
     * answer for the same rows ({@link packagelessAddressAmbiguityRefusal},
     * `409 RESOURCE_CONFLICT`, the holders sorted and the `?package=`
     * prescription), asked of the same resolution
     * ({@link packagelessAddress} at `active`, at the addressed bundle member,
     * read in full): one answer to one ambiguity. `undefined` for a name one
     * package holds, none does, or only the package-unbound row does, and for
     * every request that names a package (the caller asks only without one).
     *
     * Before, {@link getMetaItemLayered} naming no package took its overlay
     * from {@link packagelessReadAddress}, which answers no package for such
     * a name, so the layer was the first row a package-agnostic lookup met:
     * one holder's stack, picked silently, while the Studio editor that loads
     * this view and the save it then sends were refused for the same name.
     *
     * Asked by the DOOR (the shared layered chain in `@objectstack/rest`,
     * `createMetaLayeredAnswer`), ⛔ never inside {@link getMetaItemLayered}:
     * its in-process resolution readers (the security catalog echo, the
     * packaged-permission-set lock gate, `/published`) read the layers of a
     * name with no package and keep the answer they had.
     */
    async packagelessLayeredReadRefusal(request: {
        type: string;
        name: string;
        /** The bundle member the layered read addresses ({@link resolveBundleMemberSelector}); omitted, the canonical one. */
        member?: string;
    }): Promise<(Error & { code: 'RESOURCE_CONFLICT'; status: 409 }) | undefined> {
        // [#25467 E1] The body moved to `protocol-meta-layered-reads.ts`; it reaches this class through `protocol-host.ts`.
        return packagelessLayeredReadRefusal(protocolHost(this), request);
    }

    /**
     * Phase 3a-layered-get: return the 3 layers of a metadata item
     * separately — `code` (artifact-loaded baseline), `overlay` (per-org
     * customisation row, if any), and `effective` (what `getMetaItem`
     * would return, i.e. overlay-wins merge — except for a flow name the
     * loader ships, where `getMetaItem` serves the loader's body, so
     * `effective` is the code layer and a stored row of that name is
     * reported in `overlay` as a shadowed layer, #21002; and likewise for a
     * code-defined datasource name, whose code layer is the MetadataService's
     * in-memory registration, #21922).
     *
     * Drives the "Code default vs Overlay vs Effective" diff tab in the
     * generic Metadata Resource Edit page. Admins can see exactly what
     * was customised and reset selectively.
     *
     * `code` is null if no artifact baseline exists; `overlay` is null if
     * no sys_metadata row exists for the requested scope; `effective` is
     * never null when either layer exists.
     *
     * [#5707] Those three sentences are ASSERTIONS about what the author
     * declared, so the method may only make them from a read that happened.
     * The layers are a 3-LAYER shape (code / overlay / effective), not a
     * 3-VALUE one: there is no "unknown" spelling for a layer, and the null
     * that would have to stand in for it already means "not customised". So
     * an overlay read that failed is reported as a failure, never as a layer.
     *
     * [#5840] That rule now holds on BOTH halves. It could not before: the
     * code layer's failure is a loader `MetadataManager` warn-logs and skips,
     * so it reached this method as an ordinary `undefined` and became
     * `code: null` — the same unfounded assertion, one column to the left, and
     * the one the lock/affordance flags are derived from.
     *
     * @throws {@link markedApplicationRefusalError} — [#12536] FIRST, when the
     *         failure carried a producer's `userMessage` mark (commit 79c46da90): an
     *         application refusal in the author's own words, classified at the
     *         producer and NOT the 503 below. See {@link
     *         metadataReadFailureError}.
     * @throws {@link metadataStoreUnavailableError} — 503 /
     *         `SERVICE_UNAVAILABLE` when a read that would decide a layer did
     *         not happen: the `sys_metadata` overlay read failing for any
     *         reason other than the table not being provisioned yet (which
     *         genuinely means "no overlay row" and still returns normally),
     *         carrying the driver error on `cause`; or (#5840) the code
     *         layer's MetadataService read reporting `degraded` with nothing
     *         in the registry to answer instead, carrying the failing loaders'
     *         messages on `cause`.
     *
     * [#29814] `opts.withDraft` adds the `draft` layer
     * (`GetMetaItemLayeredResponseSchema.draft`): the pending draft row the
     * strict `state: 'draft'` read of {@link getMetaItem} serves, at that
     * read's address, AS STORED — converted like the `overlay` layer and
     * credential-redacted like every layer, never governed, translated or
     * stamped — or `null` when no draft is pending. Without the option the
     * answer carries no `draft` key ("not served"). Only a door that has
     * admitted its caller to pending drafts (`mayReadPendingDrafts` in
     * `@objectstack/rest`, and its runtime twin) asks for it; every other
     * reader of this method reads no draft. A failed draft read throws, as
     * the overlay read does, for the same [#5707] reason.
     */
    async getMetaItemLayered(request: {
        type: string;
        name: string;
        packageId?: string;
        /** [#26699] The bundle member whose layers to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
        member?: string;
    }, opts: { withDraft?: boolean } = {}): Promise<{
        type: string;
        name: string;
        code: unknown | null;
        overlay: unknown | null;
        overlayScope: 'env' | null;
        effective: unknown | null;
        /** [#29814] The pending draft row as stored, only when `opts.withDraft` asked; `null` for none. */
        draft?: unknown | null;
        /**
         * Load-time validation result for the effective payload — same
         * shape attached to getMetaItems/getMetaItem by
         * decorateMetadataItem. Undefined for types without a registered
         * Zod schema (function/service/router). Lets the Studio edit
         * page surface invalid-metadata banners + inline field errors
         * without a second round-trip.
         */
        _diagnostics?: MetadataDiagnostics;
        // ── ADR-0010 protection envelope ──
        lock: MetadataLock;
        lockReason?: string;
        // `MetadataLockSource` (artifact | package | env-forced) — the only
        // producer feeding this field on this path is the item-lock
        // resolution's `lockSource` ([#21738] {@link resolveItemLock}: the
        // binding layer's declared `_lockSource`), typed
        // `MetadataLockSource | undefined`. The `'overlay'` arm this annotation
        // used to carry was dead: the door's `'artifact' | 'overlay'` is the
        // resolution's `layer`, which `getEffectiveLock` reports in its refusal
        // text and which never feeds this response (commit 11b779e0f).
        lockSource?: MetadataLockSource;
        lockDocsUrl?: string;
        provenance?: MetadataProvenance;
        packageId?: string;
        packageVersion?: string;
        editable: boolean;
        deletable: boolean;
        resettable: boolean;
    }> {
        // [#25467 E1] The body moved to `protocol-meta-layered-reads.ts`; it reaches this class through `protocol-host.ts`.
        return getMetaItemLayered(protocolHost(this), request, opts);
    }

    /**
     * ADR-0010 §3.6 / Phase 4.1 — read the metadata-protection audit log
     * for a single item. Returns the most-recent rows of
     * `sys_metadata_audit` for this (type, name) tuple, sorted newest
     * first. Refused (`denied`) and forced (`forced`) writes both appear
     * here — they never reach the `history` endpoint, which only tracks
     * successful body snapshots.
     *
     * The table is provisioned by `platform-objects` and is the
     * compliance surface for the lock-enforcement story. When the
     * environment has not yet provisioned the table (legacy install
     * prior to ADR-0010) the call returns `{ events: [] }` instead of
     * raising, keeping the Studio tab harmless.
     *
     * [#9638] `{ events: [] }` means "the audit trail was read and this item
     * has no entries" and NOTHING else. Exactly two causes answer it without a
     * read: the unprovisioned table above, and a host engine that exposes no
     * `find` (the `typeof` probe before the read). Every other failure — a
     * connection drop, a permission denial, a timeout, a malformed row, a query
     * bug — RAISES, because the rows may well exist and simply were not seen,
     * and a compliance reader must never be handed "nobody touched this item"
     * on those terms (ADR-0110 D3). The unqualified `catch` that used to report
     * all of them as an empty trail is what this closes.
     *
     * @throws {@link markedApplicationRefusalError} — [#12536] FIRST, when the
     *         failure carried a producer's `userMessage` mark (commit 79c46da90): an
     *         application refusal in the author's own words, classified at the
     *         producer and NOT the 503 below. See {@link
     *         metadataReadFailureError}.
     * @throws {@link metadataStoreUnavailableError} — a 503 carrying the driver
     *         error as `cause`, for every read failure that is not an
     *         unprovisioned table. The `/audit` route's existing
     *         `handleRouteError` turns it into an honest 5xx.
     *
     * [ADR-0131 D6/D7] The environment's rows only: the trail table declares no
     * organization column, and a legacy organization's rows are left out off
     * the physical column ({@link findEnvironmentRows}).
     */
    async auditMetaItem(request: {
        type: string;
        name: string;
        limit?: number;
    }): Promise<{
        events: Array<{
            id: unknown;
            occurredAt: string;
            actor: string;
            source: string | null;
            operation: 'save' | 'publish' | 'rollback' | 'delete' | 'reset';
            outcome: 'allowed' | 'denied' | 'forced';
            code: string;
            lockState: MetadataLock | null;
            lockOverridden: boolean;
            requestId: string | null;
            note: string | null;
        }>;
    }> {
        // [#25467 E1] The body moved to `protocol-meta-audit-ui-view.ts`; it reaches this class through `protocol-host.ts`.
        return auditMetaItem(protocolHost(this), request);
    }

    async getUiView(request: { object: string, type: 'list' | 'form' }) {
        // [#25467 E1] The body moved to `protocol-meta-audit-ui-view.ts`; it reaches this class through `protocol-host.ts`.
        return getUiView(protocolHost(this), request);
    }

    /**
     * [#3770] Data-plane existence gate — the object MUST be in the schema
     * registry before any data entry point below touches storage.
     *
     * ## Why this exists
     *
     * The REST API-exposure gate (`enforceApiAccess`, ADR-0049 / #1889) skips
     * objects it cannot find in metadata, and justified that with "the data
     * path will 404 anyway". It would not. `engine.find` then resolved an
     * UNREGISTERED name straight to a physical table name, so the request
     * only 404'd as a *side effect* of the driver complaining about a missing
     * table (which the REST layer recognises by matching the driver's error
     * string) — and did not 404 at all when a table with that name happened
     * to exist: out-of-band DDL, a registration that failed after
     * `syncObjectSchema` had already run, a registration race. In that window
     * the exposure gate was silently skipped and the rows were served.
     *
     * The gate lives HERE, at the protocol ingress, for the same reason
     * `enforceApiAccess` does: this is the external API boundary, and it
     * answers before the query is parsed. `apiEnabled` controls automatic API
     * exposure, not data access, and internal callers (hooks, flows,
     * migrations, raw ObjectQL) are unaffected by it. The object-existence
     * half is no longer the door's alone: the engine's in-process verbs now
     * refuse a name the registry does not resolve with this same envelope
     * (`objectNotFoundError`, `@objectstack/core`), so an in-process caller
     * cannot read a table by a name this gate refuses.
     *
     * ## Tiering — mirrors the #3545 decision recorded in `api-exposure.ts`
     *
     * - **Registry present, object absent → fail CLOSED** (404
     *   `OBJECT_NOT_FOUND`). The registry is authoritative for objects:
     *   `object` is `allowEnvironmentOverlay: false` (ADR-0005) and every
     *   metadata row is environment-wide (ADR-0131 D6), so no object
     *   definition can legitimately exist outside the process-wide registry, and
     *   both boot hydration (`loadMetaFromDb`) and runtime authoring
     *   (`applyObjectRegistryMutation`) register the schema before its table
     *   is reachable.
     *
     *   [#6190] That justification rested on a premise the WRITE path did not
     *   enforce until this note was written. `allowEnvironmentOverlay: false` closed
     *   the overlay tier only; `object` is also `allowRuntimeCreate: true`, and
     *   that tier stamped `organization_id` on the row like any other — so a
     *   Studio-authored `object` COULD legitimately exist as a per-org row,
     *   invisible to boot hydration, and this gate's fail-closed answer meant
     *   404 for every record in a table that still held the data. The premise
     *   is now true by enforcement: {@link organizationScopedWriteRefusal}
     *   refuses an org-scoped write of every type (ADR-0131 D6), on every
     *   minting path, so the only org-scoped `object` rows that can
     *   exist are residue written before that gate (#6190's ruling 2 = A:
     *   handled non-destructively — carried by the v18 ceremony, and a
     *   database still holding them refused at boot, ADR-0131 D10 item 5). Fail-closed stays the right answer for
     *   those: the registry entry is genuinely absent, and serving the table
     *   would serve one org's rows to every org. Pinned by
     *   `protocol.org-scoped-write-refused.test.ts`, which keeps `object` as
     *   its named specimen precisely so this paragraph cannot go stale
     *   silently again.
     * - **No registry on the engine at all → skip.** There is no source of
     *   truth to consult, so the check cannot answer; failing closed would
     *   break every registry-less host (edge/Lite embeddings, engine doubles)
     *   for no security gain. Warned once per process so a deployment in that
     *   state is observable rather than a silent blanket-allow — the lesson
     *   #3545 recorded for `loadObjectItems`.
     */
    private assertObjectRegistered(object: string): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof assertObjectRegistered> = {
            get engine() { return readEngine(); },
        };
        return assertObjectRegistered.call(host, object);
    }

    /**
     * [#4134] The names a list query may legitimately use on `object`, or
     * `null` when nothing authoritative is available to check against.
     *
     * ONE resolution shared by all four read axes — filter (#4134), sort,
     * projection and expand (#4226) — because "does this field exist" is one
     * question and four answers to it is exactly the state these issues were
     * filed about. It is also the read half of a question the WRITE path
     * already answers loudly (`400 INVALID_FIELD` via `mapDataError` in
     * `@objectstack/rest`).
     *
     * Tiering mirrors {@link assertObjectRegistered}, one level down:
     *
     * - **Schema present with a field map → authoritative.** An unlisted name
     *   is a 400. The registry injects the audit/tenant/owner columns
     *   (`created_at`, `created_by`, `updated_at`, `updated_by`,
     *   `organization_id`, `owner_id`) into `fields`, so those are usable
     *   normally; `id` and the two audit timestamps are added defensively
     *   because they are primary-key/engine-assigned rather than declared, and
     *   `engine.find()` admits the same three unconditionally — a gate stricter
     *   than the engine it guards would reject queries that used to work.
     * - **No registry, or a schema with no field map → skip.** Nothing to check
     *   against (registry-less Lite/edge hosts, engine doubles, external
     *   datasources whose columns are not mirrored locally). The
     *   object-existence gate above already warns once when the registry itself
     *   is missing, so this stays quiet rather than warning twice per process.
     */
    private resolveQueryFields(object: string): { known: ReadonlySet<string>, declared: readonly string[], fields: any, schema: any } | null {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof resolveQueryFields> = {
            get engine() { return readEngine(); },
        };
        return resolveQueryFields.call(host, object);
    }

    /**
     * [#4134] Read-path unknown-field gate for the implicit filters `findData`
     * derives from leftover query parameters.
     *
     * Rejects with the SAME envelope the write path produces for the same
     * mistake — `400 INVALID_FIELD` + `field` + `object` — so a name that
     * cannot be written cannot be silently filtered on either. Dotted paths are
     * judged on their head segment only (`owner_id.name`), matching how
     * `engine.find()` validates projections.
     */
    private assertQueryParamsAreFields(object: string, params: readonly string[]): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertQueryParamsAreFields> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertQueryParamsAreFields.call(host, object, params);
    }

    /**
     * [#7534] The same read-path gate, on the EXPLICIT filter axes — the `where`
     * object, the `$filter` string and the filter AST.
     *
     * #4134 closed this defect for the filters `findData` DERIVES from leftover
     * query parameters, and {@link resolveQueryFields} was written for "ONE
     * resolution shared by all four read axes". The explicit axes never called
     * it, so one endpoint family answered ONE mistake two ways, chosen by which
     * door the caller used:
     *
     * ```
     * GET  /data/showcase_invoice?not_a_field=x            -> 400 INVALID_FIELD
     * POST /data/showcase_invoice/query {where:{not_a_field:'x'}} -> 200 {records:[],total:0}
     * ```
     *
     * The losing answer is the exact failure #4134 was filed about: an unknown
     * name lowers into a field-equality predicate that can only match zero rows,
     * so the response is indistinguishable from "no data" — and it cost a real
     * investigation once already, where an empty list was read as an RLS /
     * org-scope visibility bug rather than a typo.
     *
     * ONE call covers all three doors because they are not three code paths:
     * `where` / `filter` / `filters` / `$filter` resolve to one slot at the
     * #3795 fold, and a filter AST is lowered by `parseFilterAST` — the single
     * sink for that sugar — before this runs. So this gate reads the same
     * `FilterCondition` the driver will read, which is what keeps "the field the
     * gate saw" and "the column that reached the driver" from drifting apart.
     *
     * # Ordering: after the #4134 param gate, before the #4164 merge
     *
     * Deliberately NOT reordered relative to its siblings. Running it AFTER
     * {@link assertQueryParamsAreFields} keeps that gate's verdict first when a
     * request gets both wrong, so no existing precedence moves; running it
     * BEFORE the #4164 implicit/explicit merge is what lets it name the axis the
     * caller actually used, since after the merge the two are one `$and` and the
     * distinction is gone.
     *
     * # What it does NOT do
     *
     * The `param` in the message is the caller's own wire spelling (#4226's
     * discipline — telling someone who sent `?$filter=…` that "'where' is
     * invalid" names a parameter absent from their request). The message states
     * the zero-row consequence rather than just the bad name, because that is
     * the part a caller cannot infer from a `200`.
     *
     * Value shapes are NOT judged here: a wrong-typed or unrunnable filter is
     * `INVALID_FILTER`'s job (#4121 / #4181), already answered upstream in this
     * same block. This gate answers questions about the NAME, with exactly the
     * envelope the write path and the bare-key door already give it.
     *
     * [#8296] It answers TWO of them now — "does this field exist" and, second,
     * "does this field's TYPE materialise a column to filter on". A `formula`
     * field is known, undotted and unfilterable: it cleared this gate precisely
     * BECAUSE the object declares it, reached a driver that has no column for
     * it, and answered 200 with zero rows in BOTH directions. That was the last
     * axis in this family still fail-open — SORT refuses the same field
     * (#6994/#7095) and SEARCH refuses it (#6674) — and it is the shape the
     * standing ruling of 2026-08-12 names: a declaration the platform cannot
     * honour is refused at the latest checkpoint that can see the whole
     * picture, naming the offending key path, never answered 200.
     *
     * [#8371] THREE now — third, "can a DOTTED key's head serve a path". A
     * dotted key with a real head rode past the first verdict on its head
     * segment while SORT (#4256) and PROJECTION (#7589) refused the same
     * spelling; measured on all three drivers, a relation-, virtual- or
     * scalar-headed dotted filter matches zero rows everywhere. Judged
     * between the two verdicts above (`unknown` > `dotted` > type — the sort
     * axis' ladder) by the classification both doors share
     * (`classifyDottedFilterHead`, `@objectstack/spec/data`); the
     * structured/JSON head (`address.city`) is DELIBERATELY unjudged — see the
     * inline note.
     *
     * SCOPE: this is an INGRESS gate, so it covers what reaches {@link
     * findData}. The half it cannot reach — a caller handing a `where` straight
     * to `engine.find` / `findOne` / `count` / `aggregate` / `update` /
     * `delete`, which is how a flow node's `config.filter` travels — is closed
     * at the engine's own
     * filter seam by `assertFilterIsMaterializable` (`@objectstack/objectql`,
     * `filter-comparand-shape.ts`), with the same `400 INVALID_FIELD` and the
     * same remedy sentence. Same two-door shape, and same reason, as the sort
     * axis' #7095.
     */
    private assertFilterFieldsExist(object: string, where: unknown, param: string): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertFilterFieldsExist> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertFilterFieldsExist.call(host, object, where, param);
    }

    /**
     * [#4226] SORT axis. A sort naming a field the object does not have is
     * refused (`400 INVALID_SORT`) instead of being dropped on the floor.
     *
     * The stakes sit between the other two axes: the row SET is unchanged, so
     * this is not #4181's "returned everything" — but `sort` + `top` is how a
     * caller asks for "the latest N", and a dropped sort makes that an
     * arbitrary N that no amount of inspecting the response can reveal.
     * `SqlDriver` has a deliberate backstop that drops an unknown ORDER BY
     * column and returns the rows unordered (objectstack#3821 — rows matter
     * more than their order); that backstop is for a *driver* that has already
     * been handed the query. Refusing HERE, before it is handed over, is what
     * keeps it from doubling as a silent tolerance at the API boundary.
     *
     * The colon form gets its own hint: `?sort=title:desc` is the spelling
     * `GET /data/:object/export` accepts, and a caller who moved between the
     * two routes deserves better than "no such field 'title:desc'".
     *
     * [#4256] A dotted path (`?sort=account.company_name`) is refused on the
     * same terms — the last sort shape that still degraded silently after
     * #4226. Its head segment being a real field is what carried it past the
     * unknown-field check while no driver could then order by it: `SqlDriver`
     * hands the path to Knex, which renders `"account"."company_name"` against
     * a table that was never joined, and the #3821 unknown-column backstop
     * retries WITHOUT the sort; Mongo and the memory driver resolve the path
     * against the row itself, where a foreign key is a scalar id, so every
     * value is missing and the ordering is a no-op. Unknown heads keep the
     * typo-shaped rejection above (reported first, like the expand gate's
     * `unknown` > `not-a-reference` precedence); a dotted path on a real head
     * gets a message that says which relationship it tried to cross and
     * prescribes what `query-syntax.mdx` has prescribed since #4240:
     * denormalise the value onto the queried object and sort by that.
     *
     * [#6924] WHAT to denormalise onto was wrong, and this overturns #4256's
     * own recorded wording. That issue chose "a formula or rollup field that
     * copies it into a real column" — a prescription the platform cannot
     * deliver, so the refusal handed the author a dead end at the exact moment
     * they asked for help. Measured on a REAL `SqlDriver` (better-sqlite3) and
     * on `InMemoryDriver`, with a `formula` field named directly — which at the
     * time was NOT dotted and NOT unknown, so this gate let it through
     * (#6994 closes that, third verdict below):
     *
     * ```
     * control  orderBy title asc    -> A B C D E      (a real column sorts)
     * baseline no sort              -> C A E B D      (insertion order)
     * orderBy  <formula field> asc  -> C A E B D  200 (insertion order)
     * orderBy  <formula field> desc -> C A E B D  200 (direction-blind)
     * ```
     *
     * No column exists to order by (`SqlDriver.createColumn` returns early for
     * `formula`; sqlite answers `no such column`), the #3821 unknown-column
     * backstop retries WITHOUT the sort, and the response is 200 with every
     * row present in an arbitrary order — the very failure #4226/#4256 exist
     * to stop. Following the old hint therefore landed the author back inside
     * the defect they had just been refused for.
     *
     * `rollup`/`summary` was the other half of that wording and is NOT broken
     * the same way — it does get a real, maintained column (`table.decimal`
     * on tables created since #16318, `table.float` on earlier ones;
     * measured: `orderBy <summary> desc` -> E D C B A over values 5 4 3 2 1).
     * It is dropped from the hint because it cannot do THIS job: a rollup
     * aggregates CHILD records (count/sum/min/max/avg), so it cannot carry a
     * looked-up parent's column (`account.company_name`) onto this object.
     * Wrong tool, not a broken one — naming it here still sends the author
     * somewhere that cannot work.
     *
     * "Stored" is #6673's vocabulary for the same correction on the SEARCH
     * axis (`validate-searchable-fields.ts`, "a stored text field"); the two
     * axes deliberately say the same word.
     *
     * [#6994] The non-dotted half of that same defect, refused as the THIRD
     * verdict below. It is the SORT axis finally growing the verdict its two
     * neighbours in this class already have: `assertSearchFieldsExist` splits
     * `unknown` from `unsearchable` (a known field whose TYPE search cannot
     * scan) and `assertExpandFieldsExist` splits `unknown` from `notRelations`
     * (a known field whose TYPE cannot be expanded). Sort had only `unknown`
     * and `dotted`, so "known field, wrong type for this axis" was the one
     * member of the family with no door — which is why a `formula` field
     * reached a driver that has no column for it.
     *
     * SCOPE: this is an INGRESS gate, so it covers what reaches {@link findData}
     * — the REST list route, `POST /data/:object/query`, the export route (which
     * funnels its `$orderby` through here) and the RPC dispatcher.
     *
     * [#7095] It is no longer the ONLY door for this verdict, and the half it
     * cannot reach is now closed rather than merely noted. A caller reaching
     * `engine.find()` / `engine.findOne()` directly — hooks, flows, reports,
     * expand sub-reads — used to get the silent drop;
     * `assertOrderByIsMaterializable` (`@objectstack/objectql`, `engine.ts`)
     * refuses it there with the SAME `400 INVALID_SORT` and the same remedy
     * sentence this gate emits, ruled on #7095 (an ORDER BY the engine cannot
     * apply is a refusal with guidance prose, never a silent drop). What made
     * leaving it at ingress untenable is that the direct path is AUTHOR-
     * reachable, not merely internal: a saved report's `query.orderBy` was
     * forwarded verbatim into `engine.find` (by the saved-report stack, since
     * retired in #20102), and it never passed through here.
     *
     * ONE EDGE, measured and deliberately left: a nested `expand` sort is also
     * forwarded into the expansion sub-read (`expandRelatedRecords`), and the
     * engine door does fire there — but that sub-read sits inside a pre-existing
     * graceful-degradation `catch` that swallows EVERY expand failure and
     * retains the raw foreign keys. So that one path improves from silent to
     * OBSERVABLE (a warning carrying the field and the remedy) rather than
     * becoming a refusal. Reversing that backstop is the #3821-family swallow —
     * a separate decision on all expand failure modes, not a rider on this one.
     *
     * This gate is UNCHANGED and still the first door: it keeps the `param` name
     * in the message (which the engine cannot know) and the `unknown` >
     * `dotted` > unmaterializable precedence. The engine door deliberately
     * judges only the third verdict — see its docblock for why it does not
     * inherit the other two.
     */
    private assertSortFieldsExist(object: string, orderBy: ReadonlyArray<{ field: string }>, param: string): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertSortFieldsExist> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertSortFieldsExist.call(host, object, orderBy, param);
    }

    /**
     * [#4226] PROJECTION axis. A `select`/`fields` naming a column the object
     * does not have is refused (`400 INVALID_FIELD`).
     *
     * This axis fails in the direction nobody expects. `engine.find()` drops
     * unknown columns (deliberate `SELECT *` / OData tolerance) and then falls
     * back to `*` when that leaves the projection empty (so the driver is not
     * handed an empty SELECT list) — which compose into: `?select=<typo>` asked
     * for ONE column and got EVERY column. A parameter whose entire purpose is
     * to return less had "return more" as its failure mode, pointing away from
     * both FLS and data minimisation.
     *
     * Rejecting the partially-unknown case too (`?select=title,no_such`) is the
     * #3948 reading — an unapplied projection must not look like a satisfied
     * one — and the same rule the filter axis already lives by. The tolerant
     * reading (align with Salesforce/OData leniency) would have to explain why
     * `?status=<typo>` is a 400 and `?select=<typo>` is not, on one endpoint,
     * about the same field map.
     *
     * The engine's tolerance on THIS axis is untouched: it guards INTERNAL
     * callers (hooks, flows, expand sub-reads, registry-less hosts) that never
     * pass through this ingress, exactly like the object-existence gate above.
     * An unknown projection name is dropped and the projection falls back to
     * `*`, so the engine still over-returns rather than throwing.
     *
     * [#7095] That tolerance is PER-AXIS, and this docblock used to be read as
     * a statement about the engine in general — it is not one any more, so the
     * limit is written here rather than left to be inferred. On the SORT axis
     * the engine now REFUSES an ORDER BY it cannot materialise
     * (`assertOrderByIsMaterializable`, `@objectstack/objectql`), because the
     * two axes fail differently: a dropped projection name returns MORE than
     * asked (every column, inspectable in the response), while a dropped sort
     * returns the right rows in an order the response cannot be distinguished
     * from a satisfied one — and with `limit`, an arbitrary page of them. The
     * #7095 sweep found no in-tree internal caller relying on the sort drop, so
     * narrowing it cost no caller anything; nothing equivalent has been measured
     * for the projection axis, and this sentence is not a licence to assume it.
     *
     * [#7532] The DOTTED leg, which this gate used to pass on its head
     * segment. `f.split('.')[0]` is what let `fields=['name','account.name']`
     * through: `account` IS a field, so the entry cleared the unknown-name
     * check above and reached the driver as a projection column. Measured at
     * that commit on a REAL `SqlDriver` (better-sqlite3), against the same
     * object the card reports:
     *
     * ```
     * no projection              -> account amount created_at id name status updated_at
     * fields ['name']            -> name                          (a plain name narrows)
     * fields ['name','account.name'] -> account amount created_at id name status updated_at
     * fields ['account.name']    -> account amount created_at id name status updated_at
     * ```
     *
     * The dotted rows are BYTE-IDENTICAL to no projection at all — the exact
     * "asked for less, received more" this axis' first paragraph describes,
     * reached by a different route. Knex renders `"account"."name"` against a
     * table that was never joined, sqlite answers `no such column`, and
     * `SqlDriver`'s #3821 recovery ladder retries `select('*')` because rows
     * matter more than the projection. That ladder is a DRIVER-side tolerance
     * for internal callers and is deliberately left alone here (filed
     * separately as defence-in-depth); refusing at this ingress is what stops a
     * request from reaching it carrying a projection no driver can apply.
     *
     * It also settles the card's second complaint: an unknown PLAIN column was
     * a 400 while an unknown DOTTED one was a 200 with every field, so one
     * mistake got opposite verdicts on one endpoint depending on spelling.
     *
     * The governing precedent is #5918 on the analytics MEASURES axis, which
     * faced this exact shape and ruled the same way: refuse the dotted member
     * loudly, naming the caller's original spelling, *because there is no
     * correct answer to converge on*. That is the distinction from #5739, where
     * refusing would have rejected queries that already compiled correctly.
     * Here — as there — nothing resolved these paths, so both the typo
     * (`titel.name`) and the genuine traversal intent (`account.name`) eat this
     * 400: the two are not separable at this door, and the alternative is the
     * over-return above.
     *
     * NOT a removal of a working feature — nothing resolved these paths. The
     * spec's `fields` description, `query-syntax.mdx`, `data/query.mdx` and the
     * `query.joins` / nested-select retirement prescriptions all still offer a
     * dotted `fields` path as the way to read one related column; every one of
     * them describes behaviour no driver implements. Aligning that prose with
     * `expand` is spec/docs surface with its own blast radius and is called out
     * on the PR rather than smuggled in here.
     *
     * [#4196] It also owns the projection's SHAPE, which is a different
     * question from its names and is answered first — see below.
     */
    private assertProjectionFieldsExist(object: string, fields: unknown, param: string): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertProjectionFieldsExist> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertProjectionFieldsExist.call(host, object, fields, param);
    }

    /**
     * [#4226] EXPAND axis. An `expand`/`populate` naming something the engine
     * cannot expand is refused (`400 INVALID_FIELD`).
     *
     * The lightest of the three — neither the row set nor the returned columns
     * change, the relation simply is not there — but the response gives the
     * caller nothing to distinguish "this relation does not exist" from "every
     * row happens to have a null foreign key", and the client then renders raw
     * ids where names belong.
     *
     * Two rejections, one code, different messages, because the fixes differ:
     * a name that is no field at all is a typo, while a name that IS a field
     * but holds no reference (`?expand=title`) is a misunderstanding of what
     * expansion does. {@link REFERENCE_VALUE_TYPES} is the spec's own list of
     * types whose value "points at another record … the related record object
     * in expanded form" — the same set `engine.expandRelatedRecords` resolves,
     * so this gate cannot drift from what expansion actually delivers. The
     * "does it name a target" half reads `referenceTargetOf` for the same
     * reason: the engine resolves the target through that one function, so a
     * type whose target is implied (`user` ⇒ `sys_user`) can never be refused
     * here and expanded there.
     */
    private assertExpandTargetsExist(object: string, names: readonly string[]): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertExpandTargetsExist> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertExpandTargetsExist.call(host, object, names);
    }

    /**
     * [#4254] SEARCH-FIELDS axis. A `searchFields` override naming something
     * `search` cannot scan is refused (`400 INVALID_FIELD`).
     *
     * This axis is the `select` failure with the sign flipped OUTWARD. The
     * engine's `resolveSearchFields` drops unknown names and, when that leaves
     * the override empty, falls back to the FULL allowed set — the exact
     * two-step #4226 closed on projections, except that where a widened
     * projection returns extra columns, a widened search returns extra ROWS:
     * `?search=alpha&searchFields=<typo>` matched rows the caller's narrowing
     * excluded, in a response with nothing to distinguish it from a satisfied
     * one. `searchFields` exists only to narrow (ADR-0061: the override is
     * "intersected with the allowed set — it can narrow the scan, never widen
     * it"), so failing open to a wider scan is the one direction it must never
     * take. Its only in-framework caller today is `GET /data/:object/export` —
     * the same route whose `search` support just shipped precisely so an
     * export would stop downloading "the unsearched superset … in a file that
     * looks authoritative".
     *
     * Rejections share one code and differ in message, because the fixes
     * differ (the same split the expand axis draws): a name that is no field
     * at all is a typo, while a REAL field outside the searchable set needs
     * the OBJECT changed — added to a declared `searchableFields`, or declared
     * searchable at all when the auto-default excludes its type. [#6674] adds
     * the one case where changing the OBJECT cannot help either: a VIRTUAL
     * (`formula`) field has no stored column on any driver, so declaring it
     * searchable is not a narrower search but a scan of nothing — it used to
     * clear this gate precisely BECAUSE the object declared it, the fail-open
     * shape this axis exists to refuse. The allowed
     * set itself comes from {@link resolveSearchFieldResolution} in
     * `@objectstack/spec/data` — the same function the engine's search
     * expansion consumes — so this gate cannot admit a field the engine would
     * then decline to scan, nor refuse one it would.
     *
     * Names are judged EXACTLY (no dotted-head tolerance): the engine
     * intersects the override with the allowed set by exact string, so
     * `owner_id.name` — plausible from the select/sort axes — would be
     * silently dropped there, and this gate letting it through would
     * reintroduce the fallback it exists to close.
     *
     * ## The PROJECTION axis answers the same name differently — on purpose
     *
     * A name this gate refuses can still be spelled in `select` and come back
     * 200 with the key simply absent: {@link assertProjectionFieldsExist} gates
     * on whether a field is KNOWN, not on whether it is RETURNABLE, and the
     * engine's read path then drops what the caller may not see
     * (`omitInternalFields` for `internal: true` columns,
     * `stripSearchCompanionFromRead` for the hidden `__search` companion).
     * Measured on `__search`: `searchFields=__search` is a 400 here, while
     * `select=__search` is a 200 whose body lacks it.
     *
     * That is not a gap someone forgot to close — it was asked as its own
     * question and ruled intended on 2026-08-12 (#7876, direction C). The two
     * axes are different KINDS of surface. `searchFields` is AUTHORING input:
     * it tells the server how to RUN the query, so a value the server will not
     * honour changes WHICH ROWS come back — the fail-open this gate exists for.
     * `select` is a READ PROJECTION: it names what the caller would like back,
     * the row set is untouched either way, and a column the caller may not see
     * is simply not in the body.
     *
     * ⛔ Do not close the asymmetry by teaching the projection gate to refuse
     * unreturnable columns. That was the alternative on #7876 and it was
     * declined: it converts requests that answer 200 today into failures, for
     * symmetry, on spellings with no measured callers. A real caller burned by
     * a silent drop reopens the question on THAT measurement; the asymmetry
     * alone does not.
     */
    private assertSearchFieldsAreSearchable(object: string, requested: unknown, param: string): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertSearchFieldsAreSearchable> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertSearchFieldsAreSearchable.call(host, object, requested, param);
    }

    /**
     * [#4254] GROUP-BY axis. A grouping target the object does not have is
     * refused (`400 INVALID_FIELD`); a grouping target the spec cannot read is
     * refused as a shape (`400 INVALID_QUERY`).
     *
     * The failure this closes is the quietest of the family: the in-memory
     * aggregation path projects an unknown column as `null` for every row, so
     * ALL rows land in one bucket — `groupBy=[<typo>]` answered
     * `[{ <typo>: null, n: <true row count> }]`, a structurally perfect result
     * identical to "this column really holds a single value". A chart draws
     * one bar; nothing anywhere says the grouping never ran. And the answer
     * depended on which backend a deployment happens to sit on: a driver with
     * native aggregation hands `GROUP BY <typo>` to its database instead
     * (whose refusal `SqlDriver` may or may not surface), while the in-memory
     * fallback invents the one-bucket result — the "two routes, opposite
     * answers" split #4226 closed, relocated one axis over. Refusing at the
     * shared ingress is what makes the two paths agree.
     *
     * Names are judged EXACTLY, not by dotted head: the aggregation contract
     * groups by THIS object's columns (`row[field]` verbatim on the in-memory
     * path, a bare column reference in pushed-down SQL), so a dotted path can
     * only ever produce the null bucket.
     */
    private assertGroupByFieldsExist(object: string, groupBy: unknown): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertGroupByFieldsExist> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertGroupByFieldsExist.call(host, object, groupBy);
    }

    /**
     * [#4254] AGGREGATIONS axis. An aggregation over a field the object does
     * not have is refused (`400 INVALID_FIELD`); an entry the spec cannot read
     * is refused as a shape (`400 INVALID_QUERY`).
     *
     * The stakes are the highest of the three #4254 axes because the wrong
     * answer is a NUMBER: the in-memory path collects `undefined` for every
     * row and `sum` folds those to 0, so `sum(<typo>)` answered `0` — the same
     * `0` a genuinely empty quarter produces, in a report whose whole job is
     * to be believed. (`avg`/`min`/`max` answer `null`, `count(<typo>)` counts
     * nothing — every function has a plausible-looking value for a column that
     * is not there.)
     *
     * The shape checks pin the rest of the spec's `AggregationNode` contract,
     * because each violation also had a silent placeholder instead of an
     * error: a function outside the spec enum computed `null`, a missing
     * `alias` keyed the result column `"undefined"`, and a field-less
     * aggregation is only meaningful as `count(*)` — for every other function
     * it answered `null`/`0` while looking like a served query. `count` with
     * no field (or the explicit `'*'` sentinel) is the one legitimate
     * field-less form and passes.
     *
     * [#20148] …and the KEYS inside each entry's `filter` (the per-aggregation
     * filter, `AggregationNodeSchema.filter`), judged by the very gate the
     * explicit `where` takes ({@link assertFilterFieldsExist}): the same field
     * set, the same `unknown` > `dotted` > virtual ladder, the same
     * `INVALID_FIELD` / 400, with the caller's own position as the parameter
     * (`aggregations[1].filter`). Measured on the base through `POST
     * /data/:object/query` on driver-memory and driver-sql: `{ nope: 1 }` in
     * one aggregation's filter answered 200 with that count 0 (every count
     * under `$ne`, a `$not`, or a `$or` branch that held), while the same key
     * in `where` answered this 400. Run after the entry and field checks
     * above, so an entry the spec cannot read keeps its shape verdict, and an
     * unknown aggregated field keeps its own.
     */
    private assertAggregationFieldsExist(object: string, aggregations: unknown): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof assertAggregationFieldsExist> = {
            assertFilterFieldsExist: (...a) => this.assertFilterFieldsExist(...a),
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertAggregationFieldsExist.call(host, object, aggregations);
    }

    /**
     * [#22646] The data door's EVALUATE refusal for a field declared
     * `internal: true` — "the value is never returned on a generic data exit"
     * (#21197): a filter, sort, group key, aggregation operand, per-aggregation
     * filter, nested-relation condition or `expand` entry's own filter/sort on
     * such a column reveals the stored value by evaluating it, so it is REFUSED,
     * `INVALID_FIELD` / 400, located at the object, the field and the position.
     *
     * The judgement is the ENGINE's, not this door's: the engine owns the flag
     * (it omits the column from every row) and holds the one definition,
     * `QueryEvaluationGate#assertNoInternalFieldEvaluated` on the `objectql`
     * slot (`internal-field-evaluation-guard.ts` in `@objectstack/objectql`),
     * which its own read path also applies to every non-system caller — so a
     * host with no `protocol` service, or a protocol other than this one, still
     * refuses. This door asks it, before the engine reads anything, for EVERY
     * caller (administrators and system contexts included, the stored-body
     * family's stance here), and hooks its own question in at each
     * nested-relation hop: the RELATED object's API exposure
     * ({@link refuseUnservedRelationTarget}, #22737) is asked before anything of
     * that object is judged, so the order of refusals is the one this door has
     * always given. ⛔ Never a copy of the walk here (route-ownership rule 1).
     *
     * An engine that does not carry the member (a test double, a metadata-only
     * store) is judged on no field here: the flag is the engine's to honour, and
     * an engine without the gate does not withhold the column either. The
     * door's own exposure question is still asked at every hop on such an
     * engine, by a walk that judges no field.
     *
     * Not judged here because the ingress already refuses them, measured: a
     * DOTTED sort or group-by path crossing a relation (the sort gate's
     * `dotted` verdict, `INVALID_SORT`; the group-by gate's unknown-field
     * verdict, `INVALID_FIELD`), and a dotted filter key (the engine's dotted
     * door). A dotted sort inside an `expand` entry is admitted but orders a
     * batch the expansion re-keys by id with no `limit`, so it changes no answer.
     */
    assertNoInternalFieldEvaluated(object: string, options: Record<string, any>): void {
        // [#25467 cut 3] The body lives in `protocol-query-validation.ts` (see `QueryValidationHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof assertNoInternalFieldEvaluated> = {
            get engine() { return readEngine(); },
            refuseUnservedRelationTarget: (...a) => this.refuseUnservedRelationTarget(...a),
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
        };
        return assertNoInternalFieldEvaluated.call(host, object, options);
    }

    /**
     * [#22737] A NESTED-RELATION condition is evaluated on its TARGET object
     * (`ObjectQL.lowerRelationConditions` reads it as the caller), so the
     * target is asked the spec's one exposure decision for
     * {@link RELATION_CONDITION_TARGET_OPERATION}. A target it does not serve
     * is REFUSED in the data door's own exposure answer: `404
     * OBJECT_API_DISABLED` for the off switch, `405
     * OBJECT_API_METHOD_NOT_ALLOWED` with the effective operation set for a
     * whitelist. Refused, not withheld as {@link servedExpand} withholds:
     * dropping a condition would widen the result, and a related object the
     * caller may not read already answers this position with a refusal. The
     * decision takes no caller. The target is named, as the `internal: true`
     * refusal at this hop names it: it is the lookup's declared target.
     */
    private refuseUnservedRelationTarget(target: string, param: string): void {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof refuseUnservedRelationTarget> = {
            get engine() { return readEngine(); },
        };
        return refuseUnservedRelationTarget.call(host, target, param);
    }

    /**
     * [#22661] The `$expand` tree this door hands the engine, without the
     * entries whose TARGET object's declared exposure does not serve the read.
     *
     * An expansion reads a SECOND object: the record a lookup points at, served
     * under the source row. The data routes judge the ADDRESSED object's
     * `enable` block (`apiEnabled: false` answers 404, an `apiMethods` whitelist
     * that does not grant the verb answers 405); the expansion's target was
     * never asked, so `GET /data/{source}?$expand={lookup}` served the row
     * fields of an object `GET /data/{target}` refuses. Every level is asked the
     * spec's one decision, `canServeApiOperation(enable, 'get')`
     * ({@link EXPANSION_TARGET_OPERATION} says why `get`), against that level's
     * own target, and the decision takes no caller, so an administrator and a
     * member get the same tree.
     *
     * Withheld, not refused, and that is the precedent measured on this door: a
     * related record the caller may not READ is answered by the engine's
     * expansion as the bare foreign key (its sub-read is refused and the id is
     * retained, `ObjectQL.expandRelatedRecords`), so the field answers exactly
     * as an unexpanded lookup does. An unexposed target answers the same way:
     * its entry is dropped here, nothing below it is read, and the field keeps
     * its stored id. Nothing about the target is named in the response.
     *
     * Here, at the door, and not in the engine: exposure is a property of the
     * API, and the engine's privileged callers (a flow's `config.expand`, a
     * hook's own read) never pass this door, the same split #7823 drew for the
     * write results and #22646 for the evaluate positions.
     *
     * Copy-on-write: the caller's map is never mutated, and an unchanged tree
     * comes back by reference. A key that names no reference field of its level
     * is left alone — the top level is the expand gate's to refuse, and a
     * deeper one is a key the engine reads nothing for. Below the walk's depth
     * backstop an entry is dropped rather than passed unjudged.
     */
    private servedExpand(source: string, expand: Record<string, any>, depth: number): Record<string, any> {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const host: ThisParameterType<typeof servedExpand> = {
            resolveQueryFields: (...a) => this.resolveQueryFields(...a),
            servedExpand: (...a) => this.servedExpand(...a),
            servesExpansionTarget: (...a) => this.servesExpansionTarget(...a),
        };
        return servedExpand.call(host, source, expand, depth);
    }

    /** [#22661] Does the target's declared exposure serve an expansion read of it? */
    private servesExpansionTarget(target: string): boolean {
        // [#25467 cut 3] The body moved to `protocol-query-validation.ts` (see `QueryValidationHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof servesExpansionTarget> = {
            get engine() { return readEngine(); },
        };
        return servesExpansionTarget.call(host, target);
    }

    async findData(request: { object: string, query?: any, context?: any }): Promise<{
        hasMore: boolean;
        total?: number | undefined;
        object: string;
        records: any[];
    }> {
        // [#3770] Existence first: an unregistered object is a 404 before any
        // query parameter is even parsed, so an unknown name can never be
        // probed for query-shape validity (nor reach the driver as a table).
        this.assertObjectRegistered(request.object);
        const options: any = { ...request.query };
        // The execution context is SERVER-DERIVED and never caller input.
        //
        // `request.query` is the raw request bag on every ingress that reaches
        // here — the REST `POST /data/:object/query` route hands `req.body`
        // straight in as `query`. `context` is in the known-params set below, so
        // it was not swept into the implicit-filter bucket either: a caller's
        // `context` survived this spread and, because the assignment below is
        // conditional, became the operation's execution context whenever no
        // server context resolved (before #3963 an anonymous request on a
        // `requireAuth: false` deployment; the invariant holds regardless).
        //
        // What rides on it is total: plugin-security's middleware opens with
        // `if (opCtx.context?.isSystem) return next()` — the entire RLS / FLS /
        // CRUD chain skipped — and `__expandRead` marks a read as an expansion
        // sub-read (#2850; it waived the object-level CRUD gate for "public"
        // objects until #7626 removed that). Neither is ever schema-stripped on
        // this path: `ExecutionContextSchema.parse` runs only in
        // `engine.createContext`, which the read path does not use.
        //
        // Route-level `enforceAuth` is what kept that from being reachable, so
        // this was a fail-OPEN default one layer down. Drop any inbound
        // `context` unconditionally: the protocol must not depend on a gate
        // above it staying switched on.
        delete options.context;

        // [#7321] Arity BEFORE any read, fold or coercion. `IHttpRequest.query`
        // is `Record< string, string | string[] >`; the array arm is real (the
        // `node:http` adapter hands `?x=1&x=2` through as `['1','2']`, measured
        // over a socket on #6878), and every coercion below was written for the
        // string arm. `Number(['1','2'])` is `NaN`, so `?$top=1&$top=2` used to
        // reach the driver as `limit: NaN` — a wrong answer served as a 200.
        //
        // Single-vs-multi is a PER-PARAMETER judgement, never a sweep: `$select`
        // / `$expand` / `$searchFields` / `$orderby` accept the array arm on
        // purpose and are untouched here. See
        // {@link ARRAY_VALUED_QUERY_SLOTS} for the full disposition.
        assertQueryParamArity(options);

        // Forward the dispatcher's ExecutionContext so RBAC/RLS middleware
        // can apply per-request enforcement. The protocol layer is purely
        // a normalizer — it must never strip security context.
        if (request.context !== undefined) {
            options.context = request.context;
        }

        // ====================================================================
        // Normalize legacy params → QueryAST standard (where/fields/orderBy/offset/expand)
        // ====================================================================

        // OData-style `$`-prefixed params → bare aliases that the rest of
        // this function knows how to normalize. Without this step, params
        // like `?$top=2&$orderby=...` survive into the catch-all
        // implicit-filter pass below and get merged into `where` as
        // bogus field-equality predicates (e.g. `where.$top = "2"`),
        // which silently returns zero rows for every list endpoint.
        //
        // [#4226] `wireSpelling` remembers which alias each rewritten slot
        // arrived under, so a rejection quotes the parameter the caller
        // actually wrote. Telling someone who sent `?$orderby=…` that
        // "'orderBy' is invalid" names a parameter absent from their request.
        //
        // [#7321] The table itself now lives at module scope
        // ({@link QUERY_TRANSPORT_DOLLAR_ALIASES}) so the arity survey above and this fold
        // cannot drift apart on which `$` spellings exist.
        const wireSpelling: Record<string, string> = {};
        for (const [dollar, bare] of QUERY_TRANSPORT_DOLLAR_ALIASES) {
            if (options[dollar] != null && options[bare] == null) {
                options[bare] = options[dollar];
                wireSpelling[bare] = dollar;
            }
            delete options[dollar];
        }

        // [#3795] One slot, one value. Every alias spelling of the six
        // QueryAST slots resolves HERE, by the spec's own table, before the
        // per-slot wire coercion below ever runs — so that coercion reads
        // canonical keys only. An alias alone folds into its canonical key;
        // redundant identical spellings collapse; different values for one
        // slot are refused (the #4181 rule, generalized from the filter slot
        // to all of them — four used to resolve BACKWARDS here, each in its
        // own way, disagreeing with the spec's documented precedence and with
        // the runtime dispatcher's copy of the same fold; `top`→`limit`
        // joined the table last, via #4346).
        //
        // `arrivedAs` remembers which spelling carried each slot's value;
        // composed with `wireSpelling` it names the parameter the caller
        // actually wrote in every rejection below (#4226).
        const spellingFor = (name: string): string => wireSpelling[name] ?? name;
        const arrivedAs = foldQueryAliasSlots(options, QUERY_TRANSPORT_ALIAS_SLOTS, (conflict) => {
            throw conflictingQueryParamsError(conflict, spellingFor);
        });
        const slotParam = (canonical: string): string => spellingFor(arrivedAs[canonical] ?? canonical);

        // Numeric fields — coerce querystring strings. `top` already folded
        // into `limit` above: the pair joined the #3795 slot table with #4346,
        // replacing an open-coded rewrite here that resolved it BACKWARDS
        // (`options.limit = Number(options.top)` — the alias overwrote the
        // canonical key, so `{top: 1, limit: 3}` answered 1 over HTTP and 3
        // through a direct engine call).
        //
        // [#25229] The coercion is CHECKED, not bare (see
        // {@link pageWindowValue}). This is the one statement every list door
        // reaches with the window still unvalidated — `GET /data/:object`'s
        // querystring, `POST /data/:object/query`'s body (whose schema checks
        // the type, not the sign) and the runtime dispatcher — so the refusal
        // lives here, once.
        if (options.limit != null) options.limit = pageWindowValue(options.limit, slotParam('limit'));
        if (options.offset != null) options.offset = pageWindowValue(options.offset, slotParam('offset'));

        // Projection: comma-separated string → array. A single-value
        // querystring param arrives as a bare string — `?fields=name` or the
        // folded `?select=` / `$select` spellings — which drivers' `.map()`
        // calls over `query.fields` would otherwise throw on.
        //
        // [#26644] …and a value naming no field is refused rather than becoming
        // `[]`, which every driver serves as no projection at all (see
        // {@link projectionFieldsValue}).
        const projectionKey = slotParam('fields');
        if (typeof options.fields === 'string' || Array.isArray(options.fields)) {
            options.fields = projectionFieldsValue(options.fields, projectionKey);
        } else if (options.fields !== undefined) {
            delete options.fields;
        }
        // [#4226] Unknown projection columns are refused rather than dropped —
        // see `assertProjectionFieldsExist` for why this axis' silent failure
        // returned MORE than was asked for.
        this.assertProjectionFieldsExist(request.object, options.fields, projectionKey);

        // Sort: every wire shape → SortNode[].
        //
        // [#4226] `normalizeSortNodes` folds the two shapes that used to fall
        // through this block untouched — `string[]` and `{field: direction}` —
        // and refuses the ones it cannot read. Before it, "not a string and not
        // an array" simply skipped the branch, leaving a value on `orderBy`
        // that `SqlDriver`'s `Array.isArray` guard then declined to turn into
        // an ORDER BY clause: no sort, no error, no way to tell.
        const sortValue = options.orderBy;
        const sortKey = slotParam('orderBy');
        if (sortValue === undefined || sortValue === null) {
            // Nothing to sort by — and an explicit `orderBy: null` must not ride
            // to the engine as a value every driver quietly declines to read.
            delete options.orderBy;
        } else {
            const orderBy = normalizeSortNodes(sortValue, sortKey);
            // [#4226] Validated on the NORMALIZED nodes, so one gate covers
            // every spelling — `?sort=no_such`, `['-no_such']`, `{no_such:
            // 'desc'}` and `[{field:'no_such'}]` are one mistake with one
            // answer. Assigned only after it passes, so a rejected sort cannot
            // leave a half-applied one behind.
            this.assertSortFieldsExist(request.object, orderBy, sortKey);
            if (orderBy.length > 0) options.orderBy = orderBy;
            else delete options.orderBy;
        }

        // Filter: the folded slot value → a usable `FilterCondition` on
        // `where`, or a rejection. The four spellings of this slot
        // (`where`/`filter`/`filters`/`$filter`) already resolved through the
        // #3795 fold above — #4181's one-slot-one-value rule, which this block
        // pioneered before the fold generalized it.
        const filterKey = slotParam('where');

        if (options.where !== undefined) {
            let parsedFilter = options.where;
            // A blank `?filter=` is ABSENT, not malformed — the same `length > 0`
            // guard the export route applies before parsing. Deleting `where`
            // here (rather than leaving `''` on it) is what lets every consumer
            // below test presence with a plain falsy check.
            if (typeof parsedFilter === 'string' && parsedFilter.trim() === '') {
                delete options.where;
            } else {
                // [#4181] JSON string → object. Parse failure is a REJECTION, not
                // a fallback. The `catch { /* keep as-is */ }` this replaces left
                // the raw string on `where`, a shape no driver consumes — so the
                // filter was dropped whole and `?filter={status:done` (one missing
                // quote) answered 200 with the UNFILTERED page. Worst member of
                // the #3948 family: #4134 zeroed, #4164 dropped one predicate,
                // this returned everything.
                //
                // The sibling `GET /data/:object/export` route has rejected this
                // exact input since it was written (`400 INVALID_REQUEST`,
                // "filter must be JSON"); the list path was the outlier. The
                // guard lives HERE, in the shared normalizer, so `GET
                // /data/:object`, `POST /data/:object/query` and the runtime
                // dispatcher all inherit one answer instead of three.
                if (typeof parsedFilter === 'string') {
                    try {
                        parsedFilter = JSON.parse(parsedFilter);
                    } catch {
                        throw unusableFilterError(filterKey, 'must be valid JSON');
                    }
                }
                // Filter AST array → FilterCondition object
                if (isFilterAST(parsedFilter)) {
                    parsedFilter = parseFilterAST(parsedFilter);
                } else if (Array.isArray(parsedFilter) && parsedFilter.length > 0) {
                    // [#4121] `isFilterAST` was being read as a *conversion* gate,
                    // so an array it refused was assigned to `where` unconverted —
                    // an opaque value the driver then had to make sense of. Every
                    // driver now fails on it, so this is not a narrowing; it moves
                    // the failure to where the malformed filter actually arrived,
                    // with the request's own vocabulary in the message instead of a
                    // driver-internal one.
                    //
                    // It also closes what the driver-side fix could not: a lone
                    // `['and']` / `['or']` sets the join mode, matches no element,
                    // and emits NO predicate — the last shape that still returned
                    // every row silently after #3948. An empty `[]` is left alone:
                    // it means "no filter", and every path already treats it that
                    // way — so it falls through to the shape check below, which
                    // passes it (an array IS an object).
                    throw malformedFilterArrayError(parsedFilter);
                }
                // [#4181] Parsed-but-unusable is the same failure one step later:
                // `?filter=5` / `?filter="open"` / `?filter=null` all yield a
                // non-object `where` that no driver reads. #4121 above catches the
                // array shapes; this catches the scalar ones, and together they are
                // what lets the #4164 merge below trust `where` to be an object.
                if (parsedFilter === null || typeof parsedFilter !== 'object') {
                    throw unusableFilterError(
                        filterKey,
                        `must be a filter object or condition array, received ${parsedFilter === null ? 'null' : typeof parsedFilter}`,
                    );
                }
                options.where = parsedFilter;
            }
        }

        // Expand: the folded slot value → `Record<string, QueryAST>`. A comma
        // list (string) and a name array both lower to `{name: {object: name}}`;
        // the advanced `{rel: QueryAST}` map a caller may send directly on
        // `POST /data/:object/query` passes through as-is. Lowering the ARRAY
        // shape here (not just the string) also closes a pre-#3795 gap: a raw
        // name array used to survive this block whole, so the #4226 gate read
        // its INDICES as relation names and refused real requests with
        // "Unknown field '0'".
        const expandValue = options.expand;
        const expandNames: string[] = [];
        if (typeof expandValue === 'string') {
            expandNames.push(...expandValue.split(',').map((s: string) => s.trim()).filter(Boolean));
        } else if (Array.isArray(expandValue)) {
            expandNames.push(...expandValue);
        }
        if (typeof options.expand !== 'object' || options.expand === null || Array.isArray(options.expand)) {
            delete options.expand;
        }
        if (expandNames.length > 0 && !options.expand) {
            options.expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                options.expand[rel] = { object: rel };
            }
        }
        // [#4226] Both routes into `expand` are gated: the comma-list spellings
        // collected above, and the advanced `{rel: QueryAST}` map a caller may
        // send directly on `POST /data/:object/query`. Validating the map's KEYS
        // rather than `expandNames` is what covers the second one.
        if (options.expand && typeof options.expand === 'object') {
            this.assertExpandTargetsExist(request.object, Object.keys(options.expand));
            // [#22661] …then every level's TARGET is asked its declared exposure,
            // and an entry the decision does not serve is withheld (the field
            // answers as an unexpanded lookup) — see {@link servedExpand}. Ahead
            // of the `internal: true` walk below, so nothing about a withheld
            // target is judged, named or read.
            options.expand = this.servedExpand(request.object, options.expand, 0);
            if (Object.keys(options.expand).length === 0) delete options.expand;
        }

        // [#4254] The `searchFields` override is validated on the value the
        // ENGINE will read — the standalone parameter when present, otherwise
        // the object-form `search: { query, fields }` a `POST` body may carry
        // (same precedence as the engine's own `searchFields ?? search.fields`,
        // and the same shapes: the engine accepts the comma-string and array
        // forms from either slot). Checked whether or not a `search` term rode
        // along: the caller named fields either way, and a stale override is
        // the same typo before the search that will eventually use it is added.
        if (options.searchFields != null) {
            this.assertSearchFieldsAreSearchable(
                request.object, options.searchFields, wireSpelling.searchFields ?? 'searchFields',
            );
        } else if (options.search !== null && typeof options.search === 'object'
            && (options.search as any)?.fields != null) {
            this.assertSearchFieldsAreSearchable(
                request.object, (options.search as any).fields, wireSpelling.search ?? 'search',
            );
        }
        // [#21207] …and on a stored-metadata table a search never scans the body
        // or content-hash columns: refused when named, narrowed away otherwise.
        // Runs after the searchability gate above, so a name that is not
        // searchable at all keeps its own answer. [#21544] The ONE narrowing,
        // a module function the in-process reader-context seam calls too.
        const narrowedSearchFields = narrowStoredMetadataSearch(
            request.object, options, this.engine?.registry?.getObject?.(request.object), wireSpelling,
        );
        if (narrowedSearchFields) options.searchFields = narrowedSearchFields;

        // Boolean fields. [#26644] `count` is CHECKED, not merely lowered: a
        // value that is neither true nor false is refused rather than left to
        // read as "count anyway" below (see {@link countFlagValue}).
        if (options.distinct === 'true') options.distinct = true;
        else if (options.distinct === 'false') options.distinct = false;
        if (options.count != null) options.count = countFlagValue(options.count, slotParam('count'));

        // [#2926 ⑩] Every supported OData-style `$` alias has been consumed and
        // deleted above ($top/$skip/$orderby/$select/$count/$search/
        // $searchFields/$filter/$expand). A `$`-prefixed key can never be a
        // field name, so anything left is an unsupported query parameter —
        // fail loudly instead of letting it fall into the implicit-filter
        // bucket below, where it silently matched zero rows (or, before the
        // $filter alias existed, was dropped entirely and returned the
        // UNFILTERED page — a footgun for scripts resolving ids by name).
        const unsupportedDollarParams = Object.keys(options).filter((k) => k.startsWith('$'));
        if (unsupportedDollarParams.length > 0) {
            // [#16066] The supported set is QUOTED from the declaration, never
            // re-typed here: a spelling added to the spec table used to leave
            // this sentence naming a set the door no longer had, so the caller
            // was told to use a parameter list that was already wrong.
            const err: any = new Error(
                `Unsupported query parameter(s): ${unsupportedDollarParams.join(', ')}. ` +
                `Supported $-prefixed parameters: ${QUERY_TRANSPORT_DOLLAR_PARAMS.join(', ')}.`,
            );
            err.status = 400;
            err.code = 'UNSUPPORTED_QUERY_PARAM';
            throw err;
        }

        // [#4134] A leftover key is about to be lowered into a field-equality
        // predicate (or, when an explicit `where` won, dropped on the floor).
        // Both readings are only sound if the key names a REAL field: a filter
        // on a field that does not exist can never match, so `?pageSize=5`
        // returned 200 + `total: 0` — indistinguishable from "no data". The
        // write path already rejects the same input loudly (`INVALID_FIELD`);
        // this is the read half of that one piece of knowledge, and the mirror
        // of #3948's rule for driver-memory: an unapplied filter must not look
        // like a satisfied one.
        //
        // Validated BEFORE the `!options.where` branch below, so a bad param is
        // a 400 whether or not the caller also sent an explicit filter — the
        // failure must not depend on which other params rode along.
        const leftoverParams = Object.keys(options).filter((k) => !RESERVED_LIST_QUERY_PARAMS.has(k));
        if (leftoverParams.length > 0) {
            this.assertQueryParamsAreFields(request.object, leftoverParams);
        }

        // [#7534] The same question, on the EXPLICIT filter the caller wrote —
        // the sibling door #4134's fix never reached. `options.where` is a
        // lowered `FilterCondition` by this point whichever of the three doors
        // carried it (`where` object, `$filter` string, filter AST), so one call
        // covers all three. Placed here, and not earlier, on purpose: see
        // `assertFilterFieldsExist` for why it runs after the param gate above
        // and before the #4164 merge below.
        this.assertFilterFieldsExist(request.object, options.where, filterKey);

        // Flat field filters: REST-style query params like ?id=abc&status=open
        // are implicit field-level equality predicates. Every leftover key is a
        // verified field name by this point — the #4134 gate above runs FIRST,
        // which is exactly what makes the merge below safe: an unknown name
        // already 400'd, so nothing merged here can be a predicate that matches
        // nothing.
        //
        // [#4164] Implicit predicates now COMPOSE with an explicit `where`
        // instead of being silently dropped. `?filter={...}&status=open` means
        // what it says — both apply, `{ $and: [explicit, implicit] }` — the
        // same composition the engine itself uses to fold the `$search`
        // predicate or an expand's declared filter into an existing `where`,
        // and a combinator the #3774 conformance suite pins across every
        // FilterCondition backend. Contradictory sides need no special case:
        // both predicates apply and the intersection is an HONEST zero (the
        // filters ran), unlike the pre-#4134 zero (a filter that never ran).
        // Consuming the keys here also stops them riding to `engine.find` as
        // stray top-level AST junk, and count() below reads the same
        // `options.where`, so pagination totals see the merged predicate too.
        //
        // #4164 shipped with a `typeof explicitWhere === 'object'` guard here,
        // because the parse tolerance above could leave a raw unparseable string
        // on `where` and folding real predicates into that garbage would neither
        // apply them nor surface the bug. #4181 fixed that at the source — a
        // filter now either parses to an object or 400s — so `where` is an
        // object or absent by construction and the guard is gone with it.
        const explicitWhere = options.where;
        if (leftoverParams.length > 0) {
            const implicitFilters: Record<string, unknown> = {};
            for (const key of leftoverParams) {
                implicitFilters[key] = options[key];
                delete options[key];
            }
            // An absent or empty explicit filter (`?filter={}`, `?filter=`) is
            // vacuous — the implicit predicates stand alone rather than being
            // wrapped in a one-armed `$and`.
            options.where = !explicitWhere || Object.keys(explicitWhere).length === 0
                ? implicitFilters
                : { $and: [explicitWhere, implicitFilters] };
        }

        // [#4254] The aggregation axes name fields too, and were the last
        // read-path axes that answered a wrong name with a plausible result
        // (one null-keyed bucket; sum = 0). Validated before the routing
        // below so an unreadable SHAPE cannot slip past the `Array.isArray`
        // routing guard and ride to `engine.find` as ignored AST junk —
        // rows returned ungrouped, looking exactly like a served query.
        this.assertGroupByFieldsExist(request.object, options.groupBy);
        this.assertAggregationFieldsExist(request.object, options.aggregations);
        // [#25819] An aggregate axis sent as an EMPTY list, with no non-empty
        // axis beside it, asks for an aggregate of nothing. The routing below
        // reads it as no aggregate and handed the key to `engine.find`, which
        // refuses an option it does not execute with an uncoded error whose
        // words carry the quoted object name — read at the REST door as the
        // unknown-object heuristic: `404 OBJECT_NOT_FOUND`, "Object '…' is not
        // registered", for a registered object. No shipped caller sends `[]`
        // meaning the plain rows, so it is refused for what it is. An empty
        // list beside a non-empty one is served as before (`groupBy` with
        // `aggregations: []` lists the groups).
        {
            const emptyAxes = (['groupBy', 'aggregations'] as const)
                .filter((k) => Array.isArray(options[k]) && options[k].length === 0);
            const servedAxis = (['groupBy', 'aggregations'] as const)
                .some((k) => Array.isArray(options[k]) && options[k].length > 0);
            if (emptyAxes.length > 0 && !servedAxis) {
                const named = emptyAxes.map((k) => `'query.${k}'`).join(' and ');
                const err: any = new Error(
                    `${named} ${emptyAxes.length > 1 ? 'are empty lists' : 'is an empty list'} on object `
                    + `'${request.object}': an aggregate query names at least one aggregation, or a non-empty `
                    + `'groupBy' to list its groups. The query was NOT run. Send e.g. { "aggregations": `
                    + `[{ "function": "count", "alias": "n" }] }, or omit ${emptyAxes.map((k) => `'${k}'`).join(' and ')} `
                    + 'for the plain rows.',
                );
                err.status = 400;
                err.code = 'INVALID_QUERY';
                err.param = emptyAxes[emptyAxes.length - 1];
                err.object = request.object;
                throw err;
            }
        }
        // [#21086] A stored metadata body is served only as its type's read
        // projection (see `redactStoredMetadataRows` below), and a GROUP KEY
        // cannot be projected — so grouping by the body column of a
        // stored-metadata table is refused, after the existence gates so an
        // unknown name keeps its own answer.
        const bodyGroupingRefusal = storedMetadataBodyGroupingRefusal(request.object, options.groupBy);
        if (bodyGroupingRefusal) throw bodyGroupingRefusal;
        // [#21120] …and the FILTER / SORT half of the same family (maintainer
        // ruling A): a predicate or an order key on the stored body column
        // evaluates the body — a filter oracle that rebuilds a withheld
        // credential by probing, or an order over the same bytes — so it is
        // refused here, in the same shape as the grouping refusal, before the
        // engine is asked. [#21544] The columns a filter READS are collected by
        // the family's ONE collector, which the reader-context seam calls too:
        // every key's head AND every cross-field `{ $field }` comparand, at any
        // depth, in `where` and each `aggregations[i].filter` — so a filter that
        // reads the body or a hash without naming it as a key (a comparand), or
        // names it below the ingress collector's depth backstop, is refused like
        // a direct one. `[]` outside the family.
        const filterFields = collectStoredMetadataFilterFields(request.object, options);
        const sortFields = Array.isArray(options.orderBy)
            ? (options.orderBy as ReadonlyArray<{ field?: unknown }>).map((e) => e?.field)
            : [];
        const bodyPredicateRefusal = storedMetadataBodyPredicateRefusal(request.object, { filterFields, sortFields });
        if (bodyPredicateRefusal) throw bodyPredicateRefusal;
        // [#21207] The same three shapes on the stored CONTENT-HASH columns
        // (maintainer ruling A on the second execution fork): a group key would
        // serve the stored hash, a filter on it is an online verifier, a sort
        // orders by it. Refused in the body column's envelope, before the engine.
        const hashEvaluateRefusal = storedMetadataHashEvaluateRefusal(request.object, {
            groupBy: options.groupBy,
            filterFields,
            sortFields,
        });
        if (hashEvaluateRefusal) throw hashEvaluateRefusal;

        // [#22646] A field declared `internal: true` is withheld from every
        // generic exit (#21197) — the engine omits it from every row. The
        // EVALUATE positions do not follow that by omission: a filter, sort,
        // group-by, aggregate operand, per-aggregation filter or a one-level
        // expand's own filter/sort on such a column reveals the stored value by
        // evaluating it (a filter is a confirmation oracle, a sort leaks order).
        // So they are refused here, at the generic data door, after the
        // existence gates and before the engine — the same shape, envelope and
        // caller-independence as the stored-metadata body/hash family above.
        // Internal fields in a `$search` set are handled on their own axes: the
        // auto-default never scans one (engine), an explicit `$searchFields`
        // naming one is refused (the gate above, #4254 posture).
        this.assertNoInternalFieldEvaluated(request.object, options);

        // Route to engine.aggregate() when the query has GROUP BY / aggregations.
        // engine.find() does not do in-memory aggregation fallback, so without
        // this branch a spec-shape aggregate request would silently return
        // ungrouped raw rows on drivers (e.g. SqlDriver) that don't natively
        // honor groupBy/aggregations in find().
        const hasGroupBy = Array.isArray(options.groupBy) && options.groupBy.length > 0;
        const hasAggregations = Array.isArray(options.aggregations) && options.aggregations.length > 0;
        // The deployment's read limits (`OS_DATA_DEFAULT_PAGE_SIZE`,
        // `OS_DATA_MAX_PAGE_SIZE`, `OS_DATA_QUERY_ROW_BUDGET`; the rule is
        // `@objectstack/types`' `query-read-limits.ts`). Planned here, after
        // every shape gate and before the engine, so a refusal leaves the
        // driver unasked. All three unset returns the caller's own `limit`.
        const readLimits = resolveQueryReadLimits();
        if (hasGroupBy || hasAggregations) {
            // The grouped branch slices in memory and never reads `offset`, so
            // the window it is judged on is the groups it returns.
            const groupRead = {
                surface: 'list' as const,
                object: request.object,
                limit: typeof options.limit === 'number' ? options.limit : undefined,
                limitParam: slotParam('limit'),
            };
            const groupPlan = planQueryReadWindow(groupRead, readLimits, console);
            if (!groupPlan.probe) options.limit = groupPlan.limit;
            const aggregateQuery: EngineAggregateOptions = {
                where: options.where,
                groupBy: options.groupBy,
                aggregations: options.aggregations,
                // Enforced engine-side since #4286 (step 3) — dropping it here
                // was finding 1: the one wire path to aggregate() lost the
                // clause before any executor could ever see it.
                having: options.having,
                // ADR-0061 `search` is declared on the query beside `groupBy` /
                // `aggregations` with no carve-out, and the flat branch below
                // hands it to `engine.find`. Leaving it out of THIS bag answered
                // a grouped query under a search with the UNSEARCHED groups —
                // no error, no warning. The engine expands it through the same
                // expander `find` uses, so the header numbers are the grouping
                // of exactly the rows the flat query returns. `searchFields` was
                // validated above on both branches (#4254 gate).
                search: options.search,
                searchFields: options.searchFields,
                context: options.context,
            };
            const records = await this.engine.aggregate(request.object, aggregateQuery);
            assertQueryReadRows(groupRead, groupPlan, records.length, console);
            // Apply limit client-side (EngineAggregateOptions doesn't carry limit).
            // `records` is the full grouped set, so its length IS the real total
            // and `hasMore` follows from whether the slice dropped any groups.
            const limited = typeof options.limit === 'number' && options.limit > 0
                ? records.slice(0, options.limit)
                : records;
            return {
                object: request.object,
                records: limited,
                total: records.length,
                hasMore: limited.length < records.length,
            };
        }

        // [#4371 option 2] Strip the PROTOCOL-layer keys off the bag before it
        // becomes the engine option bag — the engine now rejects option keys
        // it does not execute, and these belong to this layer, not to it:
        // - `object`: the POST-body convenience copy of the route object
        //   (reserved above so it is not read as a field filter). It used to
        //   ride the spread into the engine AST and OVERRIDE the resolved
        //   object, splitting `ast.object` from the table actually queried —
        //   a mismatch is refused, never resolved by picking a winner.
        // - `count`: a response-shape flag this method consumed above (and,
        //   since #10757, one it actually HONOURS — see `countOptOut` below).
        // - QueryAST tombstones (`cursor`/`joins`/`windowFunctions`/
        //   `distinct`): reserved at the wire gate so they are not read as
        //   field filters; on the wire they stay ignored-with-tombstone-docs
        //   (schema parse is where they 400), and they must not leak to the
        //   engine as junk.
        // - `having`: consumed by the aggregate branch above; the find path
        //   cannot serve it.
        if (options.object != null && options.object !== request.object) {
            const err: any = new Error(
                `Conflicting object: the route addresses '${request.object}' but the query body ` +
                `says '${options.object}'. The body 'object' key is a convenience copy of the ` +
                'route object and must match it.',
            );
            err.status = 400;
            err.code = 'QUERY_OBJECT_MISMATCH';
            throw err;
        }
        // [#10757] `$count=false` — read the flag BEFORE the strip below deletes
        // it, because the strip is what kept it from ever being honoured: the
        // parameter has been declared (`ODataQuerySchema.$count`,
        // `packages/spec/src/api/odata.zod.ts`), aliased (`$count` → `count`,
        // {@link QUERY_TRANSPORT_DOLLAR_ALIASES}), reserved from the implicit-field-filter
        // bucket ({@link RESERVED_LIST_QUERY_PARAMS}), arity-checked and boolean-
        // coerced — and then deleted unread, so every list request paid for the
        // COUNT query below whether or not the caller wanted a `total`.
        //
        // Only an EXPLICIT `false` opts out. An absent `$count` keeps today's
        // behaviour (count runs, `total` is reported) rather than taking OData's
        // "absent means omit" reading: every existing caller sends nothing and
        // reads `total`, so the OData default would silently break all of them.
        // The parameter is therefore an opt-OUT here, and that asymmetry is
        // deliberate — see the changeset for the wording that ships to consumers.
        const countOptOut = options.count === false;
        for (const k of ['object', 'count', 'joins', 'windowFunctions', 'cursor', 'distinct', 'having']) {
            delete options[k];
        }
        // [#21086] The generic data door is a read exit for the stored metadata
        // body too: a `sys_metadata` / `sys_metadata_history` row's `metadata`
        // column is served as its type's read projection — the one `/meta`
        // serves — so a stored credential is withheld here exactly as there.
        // The row's `type` selects the redactor, so it is read even when the
        // projection named only the body, and taken back off before serving.
        const bodyProjection = storedMetadataBodyProjection(request.object, options.fields);
        if (bodyProjection.addedType) options.fields = bodyProjection.fields;
        // A list read with no `limit` takes the default page size, and its
        // answer says whether more rows exist (`hasMore` / `total` below). A
        // PROBE limit (a row budget with no page size) is the server's, not the
        // caller's: the answer is refused when it overruns, and otherwise it is
        // the whole set, so the probe is taken back off before the page
        // metadata below reads `limit`.
        const listRead = {
            surface: 'list' as const,
            object: request.object,
            limit: typeof options.limit === 'number' ? options.limit : undefined,
            offset: typeof options.offset === 'number' ? options.offset : undefined,
            limitParam: slotParam('limit'),
        };
        const listPlan = planQueryReadWindow(listRead, readLimits, console);
        if (listPlan.limit !== undefined) options.limit = listPlan.limit;
        // [#29764] The bag `engine.find` receives is typed as the engine declares
        // it. `options` is the caller's normalized request bag, and by this line
        // every key the normalizer does not hand on has been folded, deleted or
        // moved into `where`. What can still stand is the find set below, plus
        // `groupBy` / `aggregations` holding null at most (a non-empty one took
        // the aggregate branch above, an empty one was refused). The engine reads
        // a null option as absent, so leaving those two out changes nothing. Keys
        // are copied only when present, so the engine sees the same bag as before.
        const findQuery: EngineQueryOptions = {
            ...(options.context !== undefined ? { context: options.context } : {}),
            ...(options.where !== undefined ? { where: options.where } : {}),
            ...(options.fields !== undefined ? { fields: options.fields } : {}),
            ...(options.orderBy !== undefined ? { orderBy: options.orderBy } : {}),
            ...(options.limit !== undefined ? { limit: options.limit } : {}),
            ...(options.offset !== undefined ? { offset: options.offset } : {}),
            ...(options.search !== undefined ? { search: options.search } : {}),
            ...(options.searchFields !== undefined ? { searchFields: options.searchFields } : {}),
            ...(options.expand !== undefined ? { expand: options.expand } : {}),
        };
        // [#21207] …and its stored CONTENT HASH (`checksum`, `previous_checksum`)
        // is served in keyed form — never the stored value, which beside the
        // projected body confirms a guess at the withheld material offline —
        // under the provider's key, or the process-scoped ephemeral one.
        const found = await this.engine.find(request.object, findQuery);
        if (listPlan.probe) {
            assertQueryReadRows(listRead, listPlan, found.length, console);
            delete options.limit;
        }
        const records = await serveStoredMetadataHashColumnRows(
            request.object,
            redactStoredMetadataRows(
                request.object,
                found,
                { dropType: bodyProjection.addedType },
            ),
            this.storedHashDigest(),
        );
        // Pagination metadata. When a `limit` is present the response is a single
        // page, so `records.length` is the page size — NOT the match total. Run a
        // count over the same `where` so the client can render total pages and know
        // whether more pages remain (true server-side pagination). Without a limit
        // AND without an offset the full result set is returned, so its length
        // already IS the total.
        //
        // [#28547] An offset with no limit is a paged request too. The read
        // returns every match AFTER the offset, so `records.length` is the
        // match count MINUS the offset: `?$skip=3&$count=true` over 14 rows
        // answered `total: 11` while `?$skip=3&$top=100&$count=true` answered
        // 14, and an offset past the end answered `total: 0`. Adding the offset
        // back is not the fix (it says 999 for `offset: 999` over 14 rows), so
        // such a request takes the one count path below, `$count=false` arm
        // included: `total` is the filtered count whatever the offset.
        //
        // [#22790] The count takes the query's `search` / `searchFields` too: the
        // engine expands them through the one ADR-0061 expander `find` uses, so
        // `total` counts exactly the rows this query pages. A search used to skip
        // the count and report a page-local estimate (`offset + page + 1`) that
        // the Console rendered as the record count.
        //
        // [#22588] `limit: 0` IS a limit. It asks for no rows (objectstack#6485,
        // the drivers' pagination conformance), so `records.length` is 0 and was
        // reported as the total: `?$top=0` answered `total: 0` while `?$top=1`
        // answered the true count, and the Console's footer probe — which sends
        // exactly `$top: 0` to read the total and nothing else — showed `0` on
        // every list page. Gated `> 0`, a zero-row page fell into the "no limit,
        // the full set is the total" arm, which is true of every limit except
        // this one. So `>= 0`: a zero-row request is a paged request like any
        // other, and the three arms below keep their meaning for it — the count
        // runs (`total` is the filtered count, whatever the page size), and
        // `$count=false` still omits `total` instead of reporting the page's 0.
        const pageLimit = typeof options.limit === 'number' && options.limit >= 0 ? options.limit : undefined;
        const pageOffset = typeof options.offset === 'number' && options.offset > 0 ? options.offset : 0;
        let total: number | undefined = records.length;
        let hasMore = false;
        if (pageLimit !== undefined || pageOffset > 0) {
            // `distinct` used to suppress the count here too — #4286 finding 2:
            // the flag's ONLY observable effect platform-wide, on a capability
            // that never deduplicated a row. Removed with `query.distinct`
            // (tombstoned in spec 17); `total`/`hasMore` are truthful again.
            if (countOptOut) {
                // [#10757] The caller said it does not need `total`, so the
                // COUNT query is not issued at all — that is the whole point of
                // the parameter, and on a remote database it is a full round
                // trip saved per list request.
                //
                // `total` is OMITTED rather than estimated. `FindDataResponse`
                // declares it optional ("Total number of records matching the
                // filter (IF REQUESTED)",
                // `packages/spec/src/api/protocol.zod.ts`), so absent is the
                // declared shape for "not requested" — and it is the only
                // honest one: a real number was available and the caller
                // declined it. Handing back a plausible-looking guess is how a
                // page-local estimate ends up rendered as a record count.
                //
                // `hasMore` is still answered, from the page alone: a FULL page
                // means there may be more. It never over-reports the data — it
                // can only say "maybe more" on an exactly-full last page.
                // With an offset and no limit, every row after the offset came
                // back, so there is no further page.
                hasMore = pageLimit !== undefined && records.length === pageLimit;
                total = undefined;
            } else {
                // [#10757] `counted` is a separate, always-assigned local so
                // `hasMore` below compares against a `number`: `total` became
                // optional when `$count=false` gained the right to omit it, and
                // TypeScript cannot narrow it back across the try/catch.
                let counted: number;
                try {
                    const countQuery: EngineCountOptions = {
                        where: options.where,
                        search: options.search,
                        searchFields: options.searchFields,
                        context: options.context,
                    };
                    counted = await this.engine.count(request.object, countQuery);
                } catch {
                    // engine.count() has its own find().length fallback; if it still
                    // throws, degrade to a page-local total rather than failing the list.
                    counted = pageOffset + records.length;
                }
                total = counted;
                hasMore = pageOffset + records.length < counted;
            }
        }
        return {
            object: request.object,
            records,
            // [#10757] Omitted, not `undefined`-valued: a JSON body carrying
            // `"total": null` (or a key some serializers keep) reads as "the
            // total is nothing", which is a different claim from "no total was
            // requested". The key is simply absent.
            ...(total === undefined ? {} : { total }),
            hasMore,
        };
    }

    async getData(request: { object: string, id: string, expand?: string | string[], select?: string | string[], context?: any }): Promise<{
        object: string;
        id: string;
        record: Record<string, any>;
    }> {
        this.assertObjectRegistered(request.object); // [#3770]
        const queryOptions: any = {
            where: { id: request.id }
        };
        if (request.context !== undefined) {
            queryOptions.context = request.context;
        }

        // Support fields for single-record retrieval
        //
        // [#4226] Gated exactly as on the list path. `GET /data/:object/:id` and
        // `GET /data/:object` read the same `select`/`expand` against the same
        // field map, so answering one with a 400 and the other with a silently
        // widened projection would recreate, one route over, the very split
        // ("two routes, opposite answers for one input") this issue was filed
        // about.
        //
        // [#26644] …including the empty projection: a blank `?select=` was
        // falsy and skipped, a comma-only one became `[]` — both answered every
        // column. Asked on any value present, as the list path asks it.
        if (request.select != null) {
            queryOptions.fields = typeof request.select === 'string' || Array.isArray(request.select)
                ? projectionFieldsValue(request.select, 'select')
                : request.select;
            this.assertProjectionFieldsExist(request.object, queryOptions.fields, 'select');
        }
        // [#21086] Same read projection as the list path (`findData`): the row's
        // `type` is read even when `select` named only the body.
        const bodyProjection = storedMetadataBodyProjection(request.object, queryOptions.fields);
        if (bodyProjection.addedType) queryOptions.fields = bodyProjection.fields;

        // Support expand for single-record retrieval
        if (request.expand) {
            const expandNames = typeof request.expand === 'string'
                ? request.expand.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.expand;
            this.assertExpandTargetsExist(request.object, expandNames);
            const expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                expand[rel] = { object: rel };
            }
            // [#22661] The same exposure judgement as the list path: an entry
            // whose target does not serve `get` is withheld ({@link servedExpand}).
            const served = this.servedExpand(request.object, expand, 0);
            if (Object.keys(served).length > 0) queryOptions.expand = served;
        }

        // [#29764] The bag `engine.findOne` receives is typed as the engine
        // declares it. `queryOptions` stays the working bag: the projection
        // helpers above answer `unknown` (they serve the raw list query too), so
        // its `fields` has no declared type until it is handed on here. Keys are
        // copied only when present, so the engine sees the same bag as before.
        const findOneQuery: EngineQueryOptions = {
            where: queryOptions.where,
            ...(queryOptions.context !== undefined ? { context: queryOptions.context } : {}),
            ...(queryOptions.fields !== undefined ? { fields: queryOptions.fields } : {}),
            ...(queryOptions.expand !== undefined ? { expand: queryOptions.expand } : {}),
        };
        const result = await this.engine.findOne(request.object, findOneQuery);
        if (result) {
            return {
                object: request.object,
                id: request.id,
                // [#21207] Same served form as the list path: the content-hash
                // columns keyed.
                record: await serveStoredMetadataHashColumns(
                    request.object,
                    redactStoredMetadataRow(request.object, result, { dropType: bodyProjection.addedType }),
                    this.storedHashDigest(),
                ),
            };
        }
        throw recordNotFoundError(request.object, request.id);
    }

    /**
     * Validate-only (commit 18189983d — #4633 ruling D): report the write path's verdict
     * on candidate rows without persisting any of them.
     *
     * Deliberately thin. The verdict comes from `engine.validate()`, which
     * calls the same `validateRecord` / `evaluateValidationRules` that
     * `insert()` calls — so "the preview agrees with the write" is guaranteed
     * by construction rather than by a mirror kept in step by hand. That
     * mirror is what this replaces: `rest/src/import-coerce.ts` re-implemented
     * a slice of the engine's rules and structurally could not predict the
     * rest of the family (ADR-0104 value shapes, `format`, object-level
     * `validations`, the state machine).
     *
     * Same object-existence gate as every other data entry point (#3770), so
     * an unknown object fails the same way here as it would on the real write
     * — a preview that 404s differently from its write is a mirror again.
     *
     * [#20922] The per-row drops ride the same verdict: `engine.validate`
     * answers each accepted row's `droppedFields` from its own strips, so this
     * relays them as it relays `errors` / `warnings`. No listener is passed
     * here: the engine's `onFieldsDropped` events are the batch-level union,
     * and this response has no batch-level slot to put them in.
     */
    async validateData(request: { object: string, data: any, mode?: 'insert' | 'update', context?: any }) {
        // [#25467 E1] The body moved to `protocol-data-writes.ts`; it reaches this class through `protocol-host.ts`.
        return validateData(protocolHost(this), request);
    }

    async createData(request: { object: string, data: any, context?: any }) {
        // [#25467 E1] The body moved to `protocol-data-writes.ts`; it reaches this class through `protocol-host.ts`.
        return createData(protocolHost(this), request);
    }

    /**
     * Clone a record — read the source, drop engine-owned columns, and
     * insert a fresh copy. Gated by the object's `enable.clone` capability
     * (default `true`; only an explicit `enable.clone === false` disables it).
     *
     * Shallow by design: it duplicates the record's own scalar/business field
     * values, not its related child records. The insert path re-stamps audit
     * columns, regenerates `autonumber` fields, and recomputes derived
     * (`formula`/`summary`) fields, so the copy is a valid new row rather than
     * a byte-identical twin. Caller-supplied `overrides` are applied last and
     * win over the copied values — the natural place to set a new `name`,
     * clear a unique field, or reset status before insert.
     */
    async cloneData(request: { object: string, id: string, overrides?: Record<string, any>, context?: any }): Promise<{
        warnings?: {
            rule: string;
            severity: "info" | "warning";
            field: string;
            code: string;
            message: string;
        }[] | undefined;
        droppedFields?: {
            object: string;
            fields: string[];
            reason: "readonly" | "computed" | "readonly_when" | "primary_key" | "stored_expression";
        }[] | undefined;
        object: string;
        id: any;
        sourceId: string;
        record: any;
    }> {
        // [#3770] This object-existence check used to be open-coded here and
        // was the ONLY one on the whole data plane; it is now the shared gate
        // every data entry point runs. Same error envelope as before.
        this.assertObjectRegistered(request.object);
        const schema: any = this.engine.registry?.getObject(request.object);
        // `enable.clone` defaults to true in the spec; treat an absent block /
        // absent flag as enabled and only block on an explicit `false`.
        if (schema?.enable?.clone === false) {
            const err: any = new Error(`Cloning is disabled for object '${request.object}'`);
            err.code = 'CLONE_DISABLED';
            err.status = 403;
            err.object = request.object;
            throw err;
        }

        const ctx = request.context;
        const ctxOpt = ctx !== undefined ? { context: ctx } : undefined;

        const source = await this.engine.findOne(
            request.object,
            { where: { id: request.id }, ...ctxOpt },
        );
        if (!source) throw recordNotFoundError(request.object, request.id);

        // Copy the source, then strip the columns the engine owns so the insert
        // path re-derives them rather than carrying the source's values over.
        const data: Record<string, any> = { ...source };
        for (const f of CLONE_STRIP_FIELDS) delete data[f];
        const fields: Record<string, any> = schema?.fields || {};
        for (const [name, def] of Object.entries(fields)) {
            if (!def) continue;
            // Engine-/automation-owned values: injected system/audit columns,
            // engine-generated autonumbers, and computed formula/summary fields.
            if ((def as any).system === true
                || (def as any).type === 'autonumber'
                || (def as any).type === 'formula'
                || (def as any).type === 'summary') {
                delete data[name];
                continue;
            }
            // [#29200] A read-only column the source left EMPTY is not carried
            // into the insert. Carried, it reached `engine.insert`'s strip as a
            // present key and was reported in `droppedFields` (and the
            // `X-ObjectStack-Dropped-Fields` header) although neither the caller
            // nor the source supplied a value. Leaving it out stores the same
            // row: the strip would have taken it from a non-system caller, and
            // the insert's defaults treat an explicit `null` exactly as an
            // omitted key. A read-only column that HOLDS a value is still
            // carried, stripped and reported (#15703), and so is one the caller
            // sets through `overrides`, which are applied below.
            if ((def as any).readonly && data[name] == null) delete data[name];
        }
        // Caller overrides win (new name, cleared unique field, reset status…).
        if (request.overrides && typeof request.overrides === 'object') {
            Object.assign(data, request.overrides);
        }

        // [#3043/#14147] A clone is a create: a non-system caller must not carry
        // over (or override in) a read-only column — copying the source's
        // `approval_status` or forging one via `overrides` would mint an approved
        // record. That strip is `engine.insert`'s since #14147, so the payload
        // goes over whole and the insert re-derives the field's `defaultValue`,
        // symmetric with createData. `overrides` are applied ABOVE this line, so
        // a readonly key smuggled through them is still judged by the strip.
        //
        // [#15703] And the verdict is REPORTED, the same listener `createData`
        // wires: a clone is the one create shape that carries a read-only column
        // without the caller typing it (the source's `approval_status` travels in
        // the copy), so the 201 body says which keys the engine dropped instead of
        // leaving the caller to diff `record` against the source. Maintainer
        // ruling 2026-09-08 (option 1); `CloneDataResponseSchema` declares the
        // member in the same change, because that schema is declared AS PRODUCED.
        const dropped: DroppedFieldsEvent[] = [];
        // [#22726] A clone is a create: its advisory rule hits are answered as
        // `warnings`, the same listener `createData` wires.
        const warnings: ValidationAdvisoryEvent[] = [];
        const opts: any = {
            onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
            onValidationAdvisory: (e: ValidationAdvisoryEvent) => { warnings.push(e); },
        };
        if (ctx !== undefined) opts.context = ctx;
        // [#28782] A copy the engine stored but whose parent roll-up it could
        // not recompute carries this method's answer on the refusal, as
        // `createData` does since #28781 (`withEarnedAnswer`).
        let stale: SummaryRecomputeRefusal | undefined;
        const result = await this.engine.insert(request.object, data, opts)
            .catch((e: unknown) => (stale = staleSummaryRefusalOrThrow(e)).written as any);
        // [#7823] Same ingress strip as `createData` — a clone's 201 body is
        // the same generic-data-path surface. (The SOURCE row was read through
        // the engine's find path, which already omits internal fields, so the
        // copy never carried one in; this guards the INSERT RESULT, which the
        // engine returns whole by design.)
        omitInternalFieldsFromWriteResponse(schema, result);
        const answer = {
            object: request.object,
            id: result.id,
            sourceId: request.id,
            record: result,
            ...(dropped.length > 0 ? { droppedFields: dropped } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
        };
        if (stale) throw withEarnedAnswer(stale, answer);
        return answer;
    }

    async updateData(request: { object: string, id: string, data: any, expectedVersion?: string, context?: any }) {
        // [#25467 E1] The body moved to `protocol-data-writes.ts`; it reaches this class through `protocol-host.ts`.
        return updateData(protocolHost(this), request);
    }

    async deleteData(request: { object: string, id: string, expectedVersion?: string, context?: any }) {
        // [#25467 E1] The body moved to `protocol-data-writes.ts`; it reaches this class through `protocol-host.ts`.
        return deleteData(protocolHost(this), request);
    }

    /**
     * [#7823] The write-response `internal: true` strip, exposed for generic
     * write ingresses that live OUTSIDE this class. The one consumer today is
     * the REST cross-object transactional batch (`POST /batch` in
     * `@objectstack/rest`), whose UPDATE arm calls `ql.update` directly — a
     * deliberate #3835-era choice made when the engine still stripped its own
     * write results — and pushes the returned row into the response body.
     * `@objectstack/rest` does not depend on this package, so it reaches the
     * helper through the protocol instance it already holds (duck-typed, the
     * way it probes `createManyData`). In-place, idempotent, non-objects
     * skipped — see `write-response-internal-fields.ts`.
     */
    omitInternalWriteFields(object: string, records: unknown): void {
        // [#25467 cut 4] The body moved to `protocol-record-reads.ts` (see `RecordReadHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof omitInternalWriteFields> = {
            get engine() { return readEngine(); },
        };
        return omitInternalWriteFields.call(host, object, records);
    }

    /** Docblock and body: {@link ProtocolDataCrudFacet.probeRecord} in `protocol-data-crud.ts` [#29985 codemod]. */
    private async probeRecord(object: string, id: string): Promise<any> {
        // [#29985 codemod] The body moved to `protocol-data-crud.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDataCrudFacet.probeRecord(protocolHost(this), object, id);
    }

    /**
     * [#5088] The by-id update's existence answer for the BY-ID BULK write
     * faces (`updateManyData` and `batchData`'s `update` branch), one per row —
     * the same check {@link updateData} makes inline below its write.
     *
     * ⭐ Asked AFTER `engine.update` has judged the write, and only when it
     * resolved a `null` readback — never in front of the engine. The engine
     * answers its refusals (object- and row-level authorization, the external
     * datasource's write guard) and then refuses a row that is not there
     * itself, ahead of every `before*` hook, so a write the caller may not make
     * is refused whether or not the id names a row, as a delete is. What is
     * left for this check is the readback `IDataEngine.update` declares as two
     * answers: a row that is not there (an engine that resolves rather than
     * refuses), or a write that LANDED and moved the row out of the caller's
     * row scope — which this tells apart by asking existence, so the second
     * keeps its success.
     *
     * The history below is why the bulk faces carry the check at all.
     *
     * #4435's "a write that touched zero rows must not report success" landed on
     * 2 of the 5 write faces in this file: `updateData` (probe) and
     * `runDeleteManyLoop` (`deleted === false`). The three bulk faces went
     * straight to `engine.update` / `engine.delete`, so a row naming no record
     * did not merely misreport — it entered the WRITE PIPELINE. Downstream that
     * is worse than a wrong status code: with no stored row to overlay, #4770's
     * record materialisation (stored ⊕ payload) produces a payload-only record,
     * a hook `condition` reading any untouched field finds it absent, and
     * #4775's unevaluable-condition abort fires. The row then failed
     * `INTERNAL_ERROR` with a diagnostic accusing a CORRECT hook of naming an
     * undeclared field. Three contracts disagreeing because one of them never
     * ran; the probe is what makes them agree again.
     *
     * Deliberately the same `probeRecord` the OCC comparison uses, for the
     * reason documented there: it asks EXISTENCE, not visibility, which keeps
     * this check out of the RLS model (the by-id write policy stays #1994's
     * decision, inside `engine.update`) and keeps the `rls-by-id-write` proof
     * able to go red. And never inferred from the `null` readback alone —
     * `updateData`'s note explains why that inference would answer 404 to a
     * write that succeeded by moving the row out of the caller's scope.
     *
     * Inside the atomic arm this still reads the batch's own uncommitted state:
     * `engine.transaction` runs its callback inside the ambient `txStore`
     * (ADR-0034), and `buildDriverOptions` falls back to that store when the
     * context carries no explicit `transaction`, so the probe rides the same
     * connection as the writes it guards.
     */
    private assertRecordExists(object: string, id: string): Promise<void> {
        // [#25467 cut 4] The body moved to `protocol-record-reads.ts` (see `RecordReadHost`).
        const host: ThisParameterType<typeof assertRecordExists> = {
            probeRecord: (...a) => this.probeRecord(...a),
        };
        return assertRecordExists.call(host, object, id);
    }

    /**
     * Optimistic Concurrency Control — the COMPARISON half, over the row
     * {@link assertVersionMatch}'s probe has already read. A token that agrees
     * (or no token) issues no query of its own. Only a MISMATCH reads again —
     * see the conflict paragraph below.
     *
     * When the caller passes a non-empty `expectedVersion` token (typically the
     * `updated_at` value they read), a mismatch throws `ConcurrentUpdateError`,
     * which the REST layer maps to 409.
     *
     * Behaviour:
     *  - Empty/missing token → no check (opt-in semantics; existing callers
     *    that haven't yet adopted OCC are unaffected).
     *  - [#13576] The one exception to "empty → no check": a token that is
     *    PRESENT but is the quoted-empty RFC-7232 entity-tag (`""`) is a
     *    malformed concurrency token, not an absent one — see
     *    {@link assertVersionTokenNotMalformed} — and throws
     *    `MalformedVersionTokenError` (400) instead of silently skipping the
     *    guard. Every other falsy shape (no header/field at all, `''`,
     *    whitespace-only) is untouched by this and still opts out.
     *  - Record not found → no check. We intentionally do not treat "missing
     *    record" as a concurrency conflict; both `updateData` and `deleteData`
     *    leave it to the engine, which judges the write first.
     *  - Record has no `updated_at` field (timestamps disabled) → no check.
     *    Logging would be noisy here; OCC is opt-in and the absence of a
     *    version column is an explicit "this object doesn't support OCC"
     *    signal.
     *  - Both tokens are normalised to ONE representation before they are
     *    compared (#13382): a canonical absolute instant when they denote one,
     *    the verbatim token otherwise. Which spelling of an instant a driver
     *    hands back — a JS `Date` on Postgres/MySQL/Mongo, ISO text on the
     *    SQLite family — must not decide whether a save is a conflict. See
     *    `normaliseVersionToken` for the measured input domain and for why the
     *    change cannot refuse a token that is accepted today.
     *
     * ## [#23586] The conflict reports only what the caller may read
     *
     * `current` is the SYSTEM-context probe ({@link probeRecord}: existence,
     * not visibility), and this gate runs before `engine.update` /
     * `engine.delete` apply the caller's policy. So a mismatch does not answer
     * from it. It re-reads the row under the caller's own `context`, the read
     * door's question (every RLS and FLS rule applies):
     *
     *  - a row → the `409`, with THAT row as `currentRecord`, field-masked as
     *    the caller's own read is. `currentVersion` stays the token this
     *    comparison ran on. A caller who reads the row but may not write it
     *    gets this `409` too: the row it is shown is one it can GET anyway;
     *  - no row — the read RETURNS none → no answer from this gate at all.
     *    The comparison is dropped and the request goes on to the write,
     *    whose door answers it: the stale token then gets exactly the answer
     *    the same request without a token gets, and so does a token on an id
     *    that names no row ("Record not found → no check" above). That is the
     *    governing text for the write doors (ruling of record 5985885287): a
     *    row the caller cannot read answers what a nonexistent id answers, on
     *    update and delete alike;
     *  - a read that THROWS — a refusal (the caller's read grant withheld) or
     *    a fault — propagates as raised, exactly as it did before the
     *    absent-row handover existed. A refused read is not an absent row,
     *    and only an absent row is handed over.
     *
     * Why the write door's answer for an absent row, and not one of this
     * gate's own: this gate runs BEFORE the write is authorized, so a `404` of
     * its own differs from the write door's answer for every caller the write
     * door refuses first (no update or delete grant), and from what an id
     * naming no row gets. For an absent row the write door holds the guard
     * itself: it asks the caller's read question ahead of a by-id write, and a
     * row that read does not return is answered `recordNotFoundError`.
     *
     * The read is issued only on a mismatch: a request whose token agrees, or
     * that sends none, reads exactly what it read before.
     */
    private assertVersionOf(
        object: string,
        id: string,
        current: any,
        expectedVersion: string | undefined,
        context: EngineQueryOptionsParsed['context'],
    ): Promise<void> {
        // [#25467 cut 4] The body moved to `protocol-record-reads.ts` (see `RecordReadHost`).
        const host: ThisParameterType<typeof assertVersionOf> = {
            readAsCaller: (...a) => this.readAsCaller(...a),
        };
        return assertVersionOf.call(host, object, id, current, expectedVersion, context);
    }

    /**
     * OCC gate for the two single-record by-id writes, `updateData` and
     * `deleteData`. Neither asks existence ahead of the engine — the engine
     * judges the write and then refuses a row that is not there (#4435, and
     * `deleteData` reads the driver's `false` besides) — so this probes ONLY
     * when the caller actually opted into OCC, keeping a plain PATCH or DELETE
     * at zero extra reads.
     *
     * [#13576] The malformed-token check runs FIRST, before the probe — a
     * malformed client token is a request defect independent of whether the
     * target record exists, and rejecting it costs nothing extra (no probe
     * needed either way). This is a SEPARATE call from the one inside
     * {@link assertVersionOf}, not a delegation to it: this function returns
     * early on a well-formed-but-absent token (`if (!normaliseVersionToken(…))
     * return`) BEFORE ever reaching `assertVersionOf`, so without its own
     * check here a malformed token would take that same early return and the
     * guard would stay silently skipped — exactly the two-doors shape the
     * original defect had (measured, #13576 A2.2).
     */
    private assertVersionMatch(
        object: string,
        id: string,
        expectedVersion: string | undefined,
        context: EngineQueryOptionsParsed['context'],
    ): Promise<void> {
        // [#25467 cut 4] The body moved to `protocol-record-reads.ts` (see `RecordReadHost`).
        const host: ThisParameterType<typeof assertVersionMatch> = {
            assertVersionOf: (...a) => this.assertVersionOf(...a),
            probeRecord: (...a) => this.probeRecord(...a),
        };
        return assertVersionMatch.call(host, object, id, expectedVersion, context);
    }

    /**
     * [#23586] The row as the CALLER reads it by id — the twin of
     * {@link probeRecord}, which asks existence as the system. Same `context`
     * spelling as the write it precedes: passed only when the request carried
     * one, so a caller with no context reads as its write would run.
     */
    private readAsCaller(object: string, id: string, context: EngineQueryOptionsParsed['context']): Promise<any> {
        // [#25467 cut 4] The body moved to `protocol-record-reads.ts` (see `RecordReadHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof readAsCaller> = {
            get engine() { return readEngine(); },
        };
        return readAsCaller.call(host, object, id, context);
    }

    // ==========================================
    // Global Search (M10.5)
    // ==========================================
    /**
     * Cross-object search across all registered objects that opt in via
     * `enable.searchable !== false` and `enable.apiEnabled !== false`.
     *
     * ## [#7643] WHICH columns are searched is not decided here
     *
     * The per-object query is handed `search: <q>` and the ENGINE resolves the
     * fields and compiles the clause (`expandSearchOnAst` →
     * `objectql/src/search-filter.ts` `expandSearchToFilter`, ADR-0061) — the
     * same one expansion that serves the record picker and the list
     * quick-search. This method used to resolve its own set (text-typed fields
     * carrying the field-level `searchable: true` flag, falling back to the
     * title field) and build its own AND-of-OR, which made the ⌘K palette's
     * recall a STRICT SUBSET of the executor's on two axes at once:
     *
     *  - it never ORed the hidden `__search` companion column, so full-pinyin
     *    (`huaningkeji`) and initials (`hnkj`) matched the seeded CJK row
     *    through `POST /data/:object/query {search}` and returned NOTHING from
     *    `GET /api/v1/search` — #2486 recall, absent on this door only; and
     *  - it read the field-level `searchable` flag, which `$search` has never
     *    read, instead of the object's `searchableFields` — whose own declared
     *    contract already names global search as one of its three consumers
     *    ("the record picker, list quick-search and global search",
     *    `object.zod.ts`). So the palette was a SECOND, narrower definition of
     *    a recall rule the spec says is one rule.
     *
     * Only the CROSS-OBJECT half is this method's own: which objects are swept,
     * the per-object cap, hit ranking and title/snippet rendering. Everything
     * inside one object's query now has a single producer.
     *
     * ## Matching
     *
     * Whitespace-separated terms are AND-ed, fields OR-ed, and matching folds
     * case via `$icontains`. All three are the engine expansion's decisions and
     * this paragraph only DESCRIBES them — it is never a second declaration.
     * [#7850] It previously read "case-insensitive LIKE": `LIKE` names no
     * operator in this vocabulary (and since #6518's LIKE→GLOB change, not even
     * the SQL the compilers emit), while the sentence one screen down named
     * `$contains`, which #4706 Q2 = A defines as case-SENSITIVE. Both halves of
     * that contradiction are gone; `$icontains` is the operator that folds.
     *
     * RBAC/RLS is enforced by forwarding the caller's `context` to
     * `engine.find` so users only see records they are entitled to read.
     *
     * ## [#22640] An object whose declared exposure refuses `search` is outside the sweep
     *
     * Which objects this door may serve at all is not decided here. It is the
     * spec's one exposure decision, `canServeApiOperation(enable, 'search')`
     * (`@objectstack/spec/data`), the same one the REST data routes, the
     * dispatcher, MCP and the analytics door turn into their refusals. It
     * judges `apiEnabled: false` first, then the `apiMethods` whitelist, where
     * `search` derives from `list`. The sweep used to spell its own
     * predicate and read only the off switch, so an object whose whitelist
     * withholds `list` was still swept. A refused object leaves nothing
     * behind, exactly like an unreadable one below. The decision takes no
     * caller, so the answer is the same for every persona.
     *
     * `searchable: false` stays as its own skip, because the decision answers
     * an object with no whitelist without reading that flag.
     *
     * ## An object the caller may not READ is outside the sweep
     *
     * The REST door checks authentication only, so the object-level read
     * admission is decided per object, here: before an object is queried, the
     * `security` service's `canReadObject` — the engine middleware's own read
     * gate, arm for arm (`ISecurityService.canReadObject`) — is asked with the
     * caller's context, and an object it refuses is skipped. Without this, the
     * middleware's denial on the first unreadable object in scope failed the
     * WHOLE search with 403, so a member who could not read every object got
     * no results at all. The field-level half is the same question one axis
     * down: the engine's predicate guard refuses a search that would match on
     * a field the caller may not query, so each object's search fields are
     * narrowed to the security service's `getQueryableFields` answer, and an
     * object left with none is skipped too.
     *
     * A skipped object leaves nothing behind: it is never queried, never
     * named, and never counted in `totalObjects`, and the decision is made
     * before any row is read — so no hit, count or timing depends on what the
     * object holds. An explicit `objects=` naming an unreadable object answers
     * exactly as one naming an object that does not exist. A `false` is a
     * narrowing only; the engine still enforces everything on the objects
     * that ARE queried, row scope included. If `canReadObject` itself throws,
     * the search fails rather than answering without that object. Note that
     * plugin-security's `canReadObject` catches a permission-resolution
     * failure itself and answers `false` (its documented fail-closed
     * contract), so during a permission outage the sweep SKIPS objects rather
     * than failing: nothing is disclosed, but `totalObjects` shrinks.
     *
     * ## [#8896] A swept object that could not be READ fails the search
     *
     * `totalObjects` / `totalHits` / `truncated` describe a COMPLETE sweep of
     * the objects that were in scope, so an object whose read failed may not
     * simply be dropped out of them — that hands the caller a partial scan
     * wearing a whole one's numbers. The single benign failure is an object
     * whose table was never provisioned (`isMissingTableError`): it can hold no
     * rows, so "no hits from here" is the truth and it is skipped exactly as
     * before. Every other read failure propagates. See the `catch` below.
     *
     * ## [#13216] Published pages are swept too — into the sibling `pages`
     *
     * On an UNSCOPED sweep the response additionally carries `pages`: hits
     * over the published pages the caller's own metadata read door serves,
     * matched on name / label / description. Deliberately a SIBLING array,
     * never members of `hits` — every `hits` element is a record with an
     * `object`/`id` address, and an existing consumer iterating it must not
     * receive an element whose address vocabulary it predates. The sweep's
     * authorization story and matching rules are documented at the sweep
     * itself, below the record loop.
     */
    searchAll(request: {
        q: string;
        objects?: string[];
        limit?: number;
        perObject?: number;
        context?: any;
    }): Promise<{
        query: string;
        hits: Array<{
            object: string;
            id: string;
            title: string;
            snippet?: string;
            record: any;
        }>;
        pages: Array<{
            kind: 'page';
            name: string;
            title: string;
            snippet?: string;
            pageType?: string;
        }>;
        totalObjects: number;
        totalHits: number;
        truncated: boolean;
    }> {
        // [#25467 cut 4] The body moved to `protocol-record-reads.ts` (see `RecordReadHost`).
        const readEngine = () => this.engine;
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof searchAll> = {
            get engine() { return readEngine(); },
            getMetaItems: (...a) => this.getMetaItems(...a),
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return searchAll.call(host, request);
    }

    // ==========================================
    // Metadata Caching
    // ==========================================

    /**
     * The cached read delegates to {@link getMetaItem}, so it serves the same
     * environment → code read order (ADR-0131 D6) — the whole reason this
     * method delegates rather than re-reading.
     */
    async getMetaItemCached(request: { type: string, name: string, cacheRequest?: MetadataCacheRequest, locale?: string }): Promise<MetadataCacheResponse & { registration?: FlowRegistration; disabledActions?: string[]; cascadeDeleteObjects?: string[] }> {
        // [#29985 codemod] The body moved to `protocol-search-and-cache.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolSearchAndCacheFacet.getMetaItemCached(protocolHost(this), request);
    }

    // ==========================================
    // Batch Operations
    // ==========================================

    batchData(request: { object: string, request: BatchUpdateRequest, context?: any }): Promise<BatchUpdateResponse> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof batchData> = {
            assertObjectRegistered: (...a) => this.assertObjectRegistered(...a),
            buildBatchDataResponse: (...a) => this.buildBatchDataResponse(...a),
            get engine() { return readEngine(); },
            runAtomicBatchData: (...a) => this.runAtomicBatchData(...a),
            runBatchDataLoop: (...a) => this.runBatchDataLoop(...a),
        };
        return batchData.call(host, request);
    }

    /**
     * The atomic arm of {@link batchData} (ADR-0119 D4): the whole batch runs
     * inside ONE `engine.transaction()`, so the first failure rolls back every
     * prior write — and the response says so, rather than reporting rows that
     * no longer exist as successes.
     */
    private runAtomicBatchData(args: {
        object: string;
        operation: BatchUpdateRequest['operation'];
        records: BatchUpdateRequest['records'];
        options: BatchUpdateRequest['options'];
        batchSchema: any;
        context: any;
    }): Promise<BatchUpdateResponse> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof runAtomicBatchData> = {
            buildBatchDataResponse: (...a) => this.buildBatchDataResponse(...a),
            buildRolledBackBatchResponse: (...a) => this.buildRolledBackBatchResponse(...a),
            runAtomicBatch: (...a) => this.runAtomicBatch(...a),
            runBatchDataLoop: (...a) => this.runBatchDataLoop(...a),
        };
        return runAtomicBatchData.call(host, args);
    }

    /**
     * The atomic arm, shared by every bulk-write surface on this protocol
     * (#4620): `batchData` (ADR-0119 D4), `updateManyData` and
     * `deleteManyData`.
     *
     * D4 fixed `batchData` alone, and its two siblings in this file carried the
     * same class of defect — `deleteManyData` `break`-ed the loop and left every
     * prior delete committed under a response that called itself atomic (worse
     * than the `batchData` case: a partial delete has no natural undo), while
     * `updateManyData` never read `atomic` at all. Fixed by giving all three ONE
     * runner rather than a third and fourth copy of transaction handling —
     * copies are exactly how the next sibling drifts back into a lie.
     *
     * Each caller supplies only what differs: the per-record loop, and the two
     * response builders. Everything that makes `atomic` a guarantee — the
     * fail-closed capability gate, the single `engine.transaction()`, the abort
     * sentinel, the zero-successes rollback response — lives here, once.
     */
    private runAtomicBatch(args: {
        object: string;
        context: any;
        runLoop: (trxCtx: any) => Promise<BatchDataLoopOutcome>;
        onCommit: (outcome: BatchDataLoopOutcome) => BatchUpdateResponse;
        onRollback: (outcome: BatchDataLoopOutcome) => BatchUpdateResponse;
    }): Promise<BatchUpdateResponse> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof runAtomicBatch> = {
            get engine() { return readEngine(); },
        };
        return runAtomicBatch.call(host, args);
    }

    /**
     * The per-record loop, shared by both arms of {@link batchData} (ADR-0119
     * D4) so atomic and non-atomic cannot drift apart. `atomic` changes exactly
     * one thing: it aborts on the first failure regardless of
     * `continueOnError` (whose own contract text already scopes it to
     * `atomic=false`). It used to change a second — forbidding the upsert
     * fallback insert, whose failure inside an aborted transaction could only
     * mask the real cause — until #5099 removed that fallback from BOTH arms:
     * the upsert fork is decided before any write (by what the caller can
     * read, since the fork's own note says why), so a fallback insert could
     * only bury a real update failure under the duplicate-key error of
     * inserting a row the caller was just shown to read.
     */
    private runBatchDataLoop(args: {
        object: string;
        operation: BatchUpdateRequest['operation'];
        records: BatchUpdateRequest['records'];
        options: BatchUpdateRequest['options'];
        batchSchema: any;
        context: any;
        atomic: boolean;
    }): Promise<BatchDataLoopOutcome> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const readEngine = () => this.engine;
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof runBatchDataLoop> = {
            assertRecordExists: (...a) => this.assertRecordExists(...a),
            get engine() { return readEngine(); },
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return runBatchDataLoop.call(host, args);
    }

    /**
     * [#7539] Reconciles a STOPPED loop's outcome with the request it answers,
     * shared by the ordinary (committed) response of all three bulk-write
     * surfaces.
     *
     * Without `continueOnError` a failure ends the run — the declared default
     * (`BatchOptionsSchema.continueOnError`: *"If true (and atomic=false),
     * continue processing remaining records after errors"*), and ADR-0119 D4
     * left it deliberately untouched ("non-atomic batches behave exactly as
     * before"). Stopping was never the bug. Reporting the stop was: the three
     * builders read `total` from the REQUEST (`records.length`) while `results`,
     * `succeeded` and `failed` came from a loop that had stopped early, so an
     * un-attempted record was invisible **twice over** — it produced no
     * `results[]` entry and was counted in neither bucket. The only trace of it
     * was `succeeded + failed != total`: an arithmetic mismatch no client
     * should have to notice, let alone interpret.
     *
     * So every record gets a row saying what happened to it, and the counters
     * add up. The classification is the one the ATOMIC arm has emitted since
     * #4793 — `NOT_ATTEMPTED` as `errors[0].code`, registered in the ADR-0112
     * ledger, the message carrying the human-readable cause and the causal row
     * index — because "never ran" means the same thing to a client whether the
     * batch stopped to roll back or stopped because it was told to. The message
     * additionally names `continueOnError`, since on THIS arm the caller's next
     * action is a flag rather than a fixed row.
     *
     * `failed` therefore counts every row that is not a success, exactly as
     * {@link buildRolledBackBatchResponse} already does, keeping ONE reading of
     * the envelope across both arms: `succeeded` and `failed` partition
     * `results`, and `succeeded + failed === total === results.length`. A new
     * `notAttempted` envelope field would have bought the same information at
     * the price of two different meanings for `failed` on two arms of one
     * endpoint — which is the kind of drift that separated the rows from the
     * counters here in the first place.
     *
     * A no-op when the loop ran to completion: every all-success path, every
     * `continueOnError` run, and the atomic arm's `onCommit`, which by
     * construction only ever sees `failed === 0`.
     */
    private reconcileStoppedBatch(
        records: ReadonlyArray<{ id?: string }>,
        outcome: BatchDataLoopOutcome,
    ): BatchDataLoopOutcome {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof reconcileStoppedBatch> = {
            locateBatchCause: (...a) => this.locateBatchCause(...a),
        };
        return reconcileStoppedBatch.call(host, records, outcome);
    }

    /**
     * The row that ENDED the run, plus the clause both builders interpolate.
     *
     * ⛔ NOT `findIndex(r => !r.success)`. `success` is the envelope's
     * *outcome* bit, and its false arm is open by construction: it means "this
     * row is not a success", which since #19412 also covers a row that MATCHED
     * and was deliberately NOT removed — an outcome, not a fault, carrying no
     * `errors[]` entry. Locating the cause with it named that survivor and then
     * called the real error, sitting in the same array, "unknown" (#19452).
     *
     * The discriminator is the row's `errors[]` entry, which is the ONE per-row
     * value whose declared meaning is a fault:
     * `BatchOperationResultSchema.errors` is documented as *"Array of errors if
     * operation failed"*, and the ADR-0087 v17 migration entry publishes
     * `row.errors?.[0]?.message` / `.code` to consumers as exactly that read.
     * It cannot widen the way the boolean did: every entry must carry an
     * `ApiError.code` drawn from the closed `StandardErrorCode ∪
     * ERROR_CODE_LEDGER` vocabulary, so an unregistered code fails
     * `BatchOperationResultSchema.parse` — giving a non-fault ending an
     * `errors[]` entry is a ledger widening in `packages/spec`, which is
     * precisely the step both survivor sites declined to take. `message` is
     * REQUIRED on `ApiErrorSchema`, so a located cause always has one and the
     * 「unknown error」 fallback is gone rather than merely unreached.
     *
     * Scanned from the END because a run ends AT the row it stops on: every
     * stop is a `break` in a loop's `catch`, immediately after that row was
     * pushed. A fault that does NOT stop the run (the `Unknown operation:` arm
     * records one and keeps going) must not be able to shadow the row that did.
     *
     * When no row recorded a fault at all the batch still ended for a reason —
     * `runAtomicBatch` aborts on `outcome.failed > 0`, which a lone survivor
     * satisfies — so the non-success row is named as what it is, ⛔ never as a
     * failure and ⛔ never as an 「unknown error」.
     */
    private locateBatchCause(
        rows: ReadonlyArray<BatchDataRowResult>,
    ): { index: number; clause: string } | undefined {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        return locateBatchCause(rows);
    }

    /** The ordinary (committed) batch response — every row reports what it did. */
    private buildBatchDataResponse(
        operation: BatchUpdateRequest['operation'],
        records: BatchUpdateRequest['records'],
        options: BatchUpdateRequest['options'],
        outcome: BatchDataLoopOutcome,
    ): BatchUpdateResponse {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof buildBatchDataResponse> = {
            reconcileStoppedBatch: (...a) => this.reconcileStoppedBatch(...a),
        };
        return buildBatchDataResponse.call(host, operation, records, options, outcome);
    }

    /**
     * The response for an atomic batch that rolled back (ADR-0119 D4).
     *
     * Nothing persisted, so nothing may report success — the old code's real
     * damage was not the missing transaction alone but telling the caller that
     * rows it had just undone were `success: true`. Rows are classified from
     * what actually happened: a row that had succeeded is now `ROLLED_BACK`,
     * the row that failed keeps its causal error, and rows the abort never
     * reached are `NOT_ATTEMPTED`. The classification is STRUCTURED (#4793):
     * `ROLLED_BACK` / `NOT_ATTEMPTED` are `errors[0].code` values registered in
     * the ERROR_CODE_LEDGER, so a client branches on the code — the message
     * carries only the human-readable cause and the causal row's index, never
     * a prefix convention to regex. `returnRecords` is moot — no record exists
     * to return, and a `droppedFields` warning about a reverted write would
     * only mislead.
     */
    private buildRolledBackBatchResponse(
        operation: BatchUpdateRequest['operation'],
        // Only `length` and `id` are read, so `updateManyData`'s rows and the
        // id list `deleteManyData` rolls back reuse this verbatim (#4620) —
        // the marking a client reconciles against must be one implementation,
        // not three that agree today.
        records: ReadonlyArray<{ id?: string }>,
        outcome: BatchDataLoopOutcome,
    ): BatchUpdateResponse {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof buildRolledBackBatchResponse> = {
            locateBatchCause: (...a) => this.locateBatchCause(...a),
        };
        return buildRolledBackBatchResponse.call(host, operation, records, outcome);
    }

    createManyData(request: { object: string, records: any[], context?: any }): Promise<any> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof createManyData> = {
            assertObjectRegistered: (...a) => this.assertObjectRegistered(...a),
            get engine() { return readEngine(); },
        };
        return createManyData.call(host, request);
    }

    /**
     * Partial-success bulk create (framework#3172): like createManyData, but a
     * row that fails validation is a per-row verdict instead of aborting the
     * whole batch — the import runner uses this so a bad row never forces a
     * degradation re-run of the good rows' beforeInsert hooks. Requires an
     * engine with `insertMany` (ObjectQL has it); absent that, callers should
     * fall back to createManyData.
     *
     * ## `droppedFields` is BATCH-LEVEL here, and names no row
     *
     * This response HAS a per-row slot (`outcomes[i]`) and still reports the
     * drop set at the top level, which is the one thing about this method worth
     * writing down. The slot exists; what does not exist is a per-row ANSWER to
     * put in it.
     *
     * Every create-side strip is the ENGINE's — runtime-owned `autonumber`
     * (#5503) and static author-declared `readonly` (#14147) — and its
     * `onFieldsDropped` event is the UNION over the batch, the listener
     * signature carrying no row index. This seam used to reconstruct a row set
     * from that union by asking which rows SUPPLIED each dropped name
     * (`[...engineDropped].filter((f) => f in supplied)`). That is not the same
     * question, and it named rows that are not at fault:
     *
     *  - Maintainer ruling C (#14147) put the static-`readonly` strip INSIDE
     *    `engine.insert`, AFTER the `beforeInsert` hooks, where it exempts keys
     *    a hook itself assigned — recorded PER ROW
     *    (`hookWrittenKeys: rowHookWrittenKeys[i]`,
     *    `packages/objectql/src/engine.ts`). A hook that stamps a protected key
     *    on some rows and not others makes those rows drop DIFFERENT sets, so a
     *    row that supplied the name and had it KEPT was reported as having lost
     *    it — a dropped-field warning on an outcome whose `record` carries the
     *    value that was written.
     *  - A row the batch culled before the strip (a validation failure —
     *    `ok: false`) dropped nothing at all, because the strip loop skips it;
     *    supplying the name was still enough to have it named.
     *
     * ⛔ And the outcome's own `record` cannot repair the inference either, so
     * a post-hoc "is the key still there?" check is not the cheaper route: a
     * stripped `readonly` field is RE-DEFAULTED over exactly the keys the strip
     * took (#3043's contract — a forged `approval_status` comes back `draft`),
     * and a stripped `autonumber` is refilled by `applyAutonumbers` afterwards.
     * On both the key is PRESENT on the row that really did drop it, so that
     * check would delete TRUE attributions while leaving the hook-exempt false
     * one standing. Comparing values fails for the case `hookWrittenKeys` was
     * built for in the first place — the hook assigning the value the caller
     * also sent.
     *
     * So the honest set — `{rows whose payload carried N}` minus `{rows whose
     * beforeInsert hook assigned N}` — is computed per row upstream and is not
     * reachable through this seam. Rather than name rows on a guess, the union
     * is reported where it is true: on the response. ⚠️ Read a name here as
     * "AT LEAST ONE row dropped this field", never "this row dropped it".
     * Restoring row precision means giving the engine's drop report a per-row
     * channel (an `onFieldsDropped` signature that carries the row), never a
     * reconstruction at this call site.
     */
    insertManyData(request: { object: string, records: any[], context?: any }): Promise<{ object: string; outcomes: Array<{ ok: boolean; record?: any; error?: unknown; droppedFields?: DroppedFieldsEvent[] }>; droppedFields?: DroppedFieldsEvent[] }> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof insertManyData> = {
            assertObjectRegistered: (...a) => this.assertObjectRegistered(...a),
            get engine() { return readEngine(); },
        };
        return insertManyData.call(host, request);
    }
    
    updateManyData(request: UpdateManyDataRequest & { context?: any }): Promise<BatchUpdateResponse> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof updateManyData> = {
            assertObjectRegistered: (...a) => this.assertObjectRegistered(...a),
            buildRolledBackBatchResponse: (...a) => this.buildRolledBackBatchResponse(...a),
            buildUpdateManyResponse: (...a) => this.buildUpdateManyResponse(...a),
            runAtomicBatch: (...a) => this.runAtomicBatch(...a),
            runUpdateManyLoop: (...a) => this.runUpdateManyLoop(...a),
        };
        return updateManyData.call(host, request);
    }

    /**
     * The per-record loop of {@link updateManyData}, shared by both arms
     * (#4620) so atomic and non-atomic cannot drift apart. `atomic` changes
     * exactly one thing: it aborts on the first failure regardless of
     * `continueOnError` — whose own contract text already scopes it to
     * `atomic=false`, and which has nothing to continue toward when every write
     * so far is about to be undone.
     */
    private runUpdateManyLoop(args: {
        object: string;
        records: UpdateManyDataRequest['records'];
        options: UpdateManyDataRequest['options'];
        context: any;
        atomic: boolean;
    }): Promise<BatchDataLoopOutcome> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof runUpdateManyLoop> = {
            assertRecordExists: (...a) => this.assertRecordExists(...a),
            get engine() { return readEngine(); },
        };
        return runUpdateManyLoop.call(host, args);
    }

    /**
     * The ordinary (committed) `updateMany` response. Deliberately NOT
     * {@link buildBatchDataResponse}: this surface has never honoured
     * `returnRecords`, and quietly starting to would change the default
     * (non-atomic) path's payload while fixing an unrelated bug (#4620).
     */
    private buildUpdateManyResponse(
        records: UpdateManyDataRequest['records'],
        outcome: BatchDataLoopOutcome,
    ): BatchUpdateResponse {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof buildUpdateManyResponse> = {
            reconcileStoppedBatch: (...a) => this.reconcileStoppedBatch(...a),
        };
        return buildUpdateManyResponse.call(host, records, outcome);
    }

    // `analyticsQuery` / `getAnalyticsMeta` were retired with the degraded
    // `analytics` service shim (#3891 / #3878). They aggregated through
    // `engine.aggregate` WITHOUT the caller's ExecutionContext — no RLS or
    // tenant predicate was ever injected — and read a non-contract `filters`
    // field while silently ignoring the canonical `AnalyticsQuery.where`, so a
    // spec-conformant filtered request returned an unscoped full-table
    // aggregate. The analytics domain has exactly one implementation now:
    // `@objectstack/service-analytics` (context-aware, fail-closed
    // `getReadScope`). Deployments without it get an honest 404 from the
    // dispatcher's `/analytics` domain instead of wrong numbers.

    async triggerAutomation(_request: any): Promise<any> {
        throw new Error('triggerAutomation requires plugin-automation service. Install and register a plugin that provides the "automation" service.');
    }

    /**
     * Bulk delete by id — the `POST /data/:object/deleteMany` ingress.
     *
     * [#3897] This used to build `{ where: { id: { $in: ids } } }` and then
     * spread `...request.options` OVER it. `options` is caller-supplied (the
     * REST route splats the whole request body into the protocol request), so
     * a body key replaced the predicate the endpoint is named after:
     *
     *   {"ids":["a"],"options":{"multi":true,"where":{}}}
     *
     * reached `engine.delete` as an unscoped bulk delete — widening "delete
     * these 3 records" into "delete everything this caller is allowed to
     * delete" (RLS/sharing middleware still composes onto the AST, so the blast
     * radius is the caller's visible set, not the whole table). The same spread
     * could smuggle in `context`, i.e. a forged principal on any deployment
     * where the route is reachable without auth.
     *
     * The fix is structural rather than a re-ordered spread: caller `options`
     * is a `BatchOptions` bag (`atomic` / `returnRecords` /
     * `continueOnError` / `validateOnly`) and carries NOTHING `engine.delete`
     * consumes, so it is never merged into the engine options. The engine call
     * is built here from the validated id list alone, and each id is deleted by
     * scalar primary key — the same shape `batchData`'s `delete` case uses.
     *
     * Deleting per id (instead of one `$in` bulk delete) also fixes the second
     * half of #3897 and two silent gaps behind it:
     *   - the endpoint's happy path never worked at all — `deleteManyData` never
     *     set `multi`, so a well-formed `{"ids":[…]}` hit engine.ts's
     *     `'Delete requires an ID or options.multi=true'` throw, and ONLY the
     *     requests that triggered the override above got through;
     *   - the bulk branch skips `cascadeDeleteRelations`, so `deleteBehavior`
     *     (`cascade` / `set_null` / `restrict`) was not honoured for the rows it
     *     removed;
     *   - the declared {@link BatchUpdateResponse} contract (per-record results,
     *     `atomic` / `continueOnError`) was unimplementable from a bulk row
     *     count. It is now actually delivered.
     *
     * [#4620] That last bullet over-claimed for one member: `atomic` was
     * per-record, but it only stopped the loop — no transaction, no rollback,
     * every earlier delete left committed under a response titled atomic. It is
     * delivered for real now, through the shared {@link runAtomicBatch}, and
     * refused (501 `NOT_IMPLEMENTED`) on a runtime that cannot roll back.
     */
    deleteManyData(request: DeleteManyDataRequest & { context?: any }): Promise<BatchUpdateResponse> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof deleteManyData> = {
            assertObjectRegistered: (...a) => this.assertObjectRegistered(...a),
            buildDeleteManyResponse: (...a) => this.buildDeleteManyResponse(...a),
            buildRolledBackBatchResponse: (...a) => this.buildRolledBackBatchResponse(...a),
            runAtomicBatch: (...a) => this.runAtomicBatch(...a),
            runDeleteManyLoop: (...a) => this.runDeleteManyLoop(...a),
        };
        return deleteManyData.call(host, request);
    }

    /**
     * The per-id loop of {@link deleteManyData}, shared by both arms (#4620) —
     * see {@link runUpdateManyLoop} for why `atomic` outranks `continueOnError`.
     */
    private runDeleteManyLoop(args: {
        object: string;
        ids: unknown[];
        options: DeleteManyDataRequest['options'];
        context: any;
        atomic: boolean;
    }): Promise<BatchDataLoopOutcome> {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof runDeleteManyLoop> = {
            get engine() { return readEngine(); },
        };
        return runDeleteManyLoop.call(host, args);
    }

    /** The ordinary (committed) `deleteMany` response — every id reports what it did. */
    private buildDeleteManyResponse(ids: unknown[], outcome: BatchDataLoopOutcome): BatchUpdateResponse {
        // [#25467 cut 1] The body moved to `protocol-batch-data.ts` (see `BatchDataHost`).
        const host: ThisParameterType<typeof buildDeleteManyResponse> = {
            reconcileStoppedBatch: (...a) => this.reconcileStoppedBatch(...a),
        };
        return buildDeleteManyResponse.call(host, ids, outcome);
    }

    /**
     * Metadata types that are customer-overridable via {@link saveMetaItem}/
     * {@link deleteMetaItem} in project-kernel mode. Derived from the canonical
     * registry in {@link DEFAULT_METADATA_TYPE_REGISTRY}: a type opts in by
     * setting `allowEnvironmentOverlay: true` on its registry entry. The set is
     * augmented with the plural form of every singular so callers using REST
     * conventions (`/api/v1/meta/views/...`) get the same gate. See ADR-0005
     * §"Whitelist enforcement" for the rationale and the per-type rollout
     * checklist.
     */
    private static readonly OVERLAY_ALLOWED_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.allowEnvironmentOverlay) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /** Docblock and body: {@link ProtocolWriteGatesFacet.envWritableTypes} in `protocol-write-gates.ts` [#29985 codemod]. */
    private static envWritableTypes(): ReadonlySet<string> {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reads nothing of this class.
        return ProtocolWriteGatesFacet.envWritableTypes();
    }

    /** Test hook — clear the memoised env-writable cache (the shared reader's one cache). */
    static resetEnvWritableCache(): void {
        resetEnvWritableMetadataTypes();
    }

    /**
     * Types that opt into runtime creation of brand-new items (ADR-0005
     * extension — two-tier model). A type may have
     * `allowEnvironmentOverlay: false` (cannot overlay artifact-shipped items)
     * yet still set `allowRuntimeCreate: true` (users can author new
     * items in `sys_metadata`). The two flags are orthogonal; see
     * {@link isArtifactBacked} for how the protocol decides which gate
     * applies to a given save/delete.
     */
    /**
     * Set of type names that have a static entry in
     * `DEFAULT_METADATA_TYPE_REGISTRY`. Anything outside this set carries no
     * declared two-tier flags of its own, so the predicates below have to
     * decide what its absence means.
     *
     * ⚠️ [#8421] It used to mean "plugin-registered, therefore writable", and
     * `getMetaTypes()` synthesised `allowRuntimeCreate: true` to match. It no
     * longer does: the listing derives that flag from the static SPELLING
     * contract (see {@link getMetaTypes}), which is a strictly larger set than
     * this one — it also carries the six URL-map-only plugin kinds. Absence
     * from THIS set is therefore not on its own an answer to "may it be
     * created"; see {@link isRuntimeCreateAllowed} for what absence still buys.
     */
    private static readonly STATIC_REGISTRY_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    private static readonly RUNTIME_CREATE_ALLOWED_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.allowRuntimeCreate) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /**
     * [#6960] Metadata types whose stored overlay row of an item a managed
     * package ships may be REMOVED through the ordinary delete door without
     * the type's environment-overlay permission — `supportsOverlay: true` on
     * the registry entry, read straight off the declaration.
     *
     * This is a strictly different question from {@link OVERLAY_ALLOWED_TYPES}
     * (`allowEnvironmentOverlay`), and the registry keeps the two flags apart on
     * purpose: `allowEnvironmentOverlay` decides whether an environment may
     * overlay an item a managed package ships, on the save AND on the served
     * read ({@link isSealedManagedItem}, {@link declinesStoredRow});
     * `supportsOverlay` decides the removal carve-out alone — such a row may be
     * removed without that permission: the removal removes no managed
     * definition, and changes what is served for `permission` alone
     * ({@link refusePackagedBaseRemoval}). It opens no save and it decides no
     * read. Commit
     * ee58392e1 rolled the permission back for six types — `permission`,
     * `position`, `page`, `app`, `dataset`, `book` — and deliberately left
     * this flag alone, which is exactly the state #6960 was filed about: rows
     * authored BEFORE the rollback stay stored, and this carve-out is how an
     * operator removes them.
     *
     * Registry-derived, never a hand-written list (Prime Directive #8), and
     * augmented with the plural spelling so `/api/v1/meta/pages/...` is judged
     * identically to the singular — the same normalization every sibling set
     * in this class does.
     */
    private static readonly OVERLAY_CAPABLE_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.supportsOverlay) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

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
    private static mergesOverlayAtRead(type: string): boolean {
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
    private static registryAllowsOverlay(type: string): boolean {
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
    private static isOverlayAllowed(type: string): boolean {
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
    private static isRuntimeCreateAllowed(type: string): boolean {
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
     * [#7893] The prescription for a type whose artifacts are NOT standalone.
     *
     * `filePatterns` is the right source for every OTHER type, because for
     * every other type it names a file a loader really ingests. `field` is the
     * one declared type where it does not: `**\/*.field.ts` matches nothing in
     * any app (see {@link isNestedArtifactField} for the measurement), because
     * fields are authored INSIDE the object. Reading the glob back would answer
     * a refusal with a route that has never worked — moving the confusion one
     * layer down instead of ending it, which is exactly what #5086's refusal
     * shape exists to avoid.
     *
     * The remedy named here is the one the maintainer ruled on 2026-08-12 and
     * is a route that genuinely composes: `object` keeps `allowRuntimeCreate:
     * true`, so writing the whole object with the new field in `fields` both
     * persists and reaches every consumer. Adding a field at runtime is still
     * possible; only this spelling of it is withdrawn.
     *
     * Keyed by type rather than branched inline so a second fragment type, if
     * one is ever declared, states its own remedy instead of inheriting an
     * unrelated one.
     *
     * [ADR-0131 D6] `sharing_rule` is the second type whose remedy is not its
     * glob, for a different reason: it is regime C, and a regime-C item is
     * customized at runtime — an organization authors its own rule through the
     * sharing door, and a declared rule is cloned there and switched off through
     * the activation ledger. "Declare it in source and redeploy" names only the
     * package author's route, which is not the one a runtime caller has.
     */
    private static readonly CODE_ONLY_TYPE_REMEDY: Readonly<Record<string, string>> = {
        field: ' Fields are not standalone artifacts: author it inside its object and write the whole '
            + 'object instead (PUT /api/v1/meta/object/:object with the new field in `fields`), or declare '
            + 'it in the object source (**/*.object.ts) and redeploy.',
        sharing_rule: ' Author an organization rule instead (POST /api/v1/sharing/rules), or clone a declared rule '
            + 'there under a new name and switch the declared one off '
            + '(POST /api/v1/security/_activation/sharing_rule/:name, body {enabled: false}).',
    };

    /**
     * The prescription half of a code-only refusal (#5086): where the author
     * is supposed to declare this item instead. Read from the type's own
     * registry entry (`filePatterns`), so a newly-flagged type carries an
     * accurate hint the day it is flagged — nothing here to keep in sync,
     * except the types {@link CODE_ONLY_TYPE_REMEDY} names explicitly.
     */
    private static codeOnlySourceHint(type: string): string {
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
    private static codeOnlyCreateError(type: string): Error {
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
    private static codeOnlyOverrideError(type: string, name: string): Error {
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

    /** Docblock and body: {@link ProtocolWriteGatesFacet.organizationScopedWriteRefusal} in `protocol-write-gates.ts` [#29985 codemod]. */
    private static organizationScopedWriteRefusal(
        subject: string,
        organizationId: unknown,
        remedy = 'Retry with no organization: the write then lands environment-wide, where every organization reads it.',
    ): Error | null {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reads nothing of this class.
        return ProtocolWriteGatesFacet.organizationScopedWriteRefusal(subject, organizationId, remedy);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.requestedOrganization} in `protocol-write-gates.ts` [#29985 codemod]. */
    private static requestedOrganization(request: unknown): unknown {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reads nothing of this class.
        return ProtocolWriteGatesFacet.requestedOrganization(request);
    }

    /** Throw {@link organizationScopedWriteRefusal} for an organization-scoped write request. */
    private static refuseOrganizationScopedWrite(subject: string, request: unknown): void {
        const refusal = this.organizationScopedWriteRefusal(subject, this.requestedOrganization(request));
        if (refusal) throw refusal;
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.isArtifactBacked} in `protocol-write-gates.ts` [#29985 codemod]. */
    private isArtifactBacked(type: string, name: string): boolean {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.isArtifactBacked(protocolHost(this), type, name);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.isSealedManagedItem} in `protocol-write-gates.ts` [#29985 codemod]. */
    private isSealedManagedItem(type: string, name: string): boolean {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.isSealedManagedItem(protocolHost(this), type, name);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.overlayBaseShippers} in `protocol-write-gates.ts` [#29985 codemod]. */
    private overlayBaseShippers(type: string, name: string): string[] {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.overlayBaseShippers(protocolHost(this), type, name);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.isNestedArtifactField} in `protocol-write-gates.ts` [#29985 codemod]. */
    private isNestedArtifactField(type: string, name: string): boolean {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.isNestedArtifactField(protocolHost(this), type, name);
    }

    /**
     * [#21899] Is `(datasource, name)` a datasource an installed code package
     * declares — a code-defined datasource?
     *
     * ## Why this predicate needs a resolver of its own
     *
     * The second non-standalone shape in {@link isNestedArtifactField}'s
     * census. A code-defined datasource never reaches the SchemaRegistry as an
     * item: `AppPlugin` registers it in the MetadataService, in memory only,
     * stamped `origin: 'code'` (ADR-0062), so the artifact-only lookup misses
     * every one. That miss was the whole defect: {@link isArtifactBacked}
     * answered false, the save took the `runtime-only` intent, and
     * `allowRuntimeCreate: true` let `PUT /api/v1/meta/datasource/:name`
     * persist an edit of a datasource the published contract
     * (`DatasourceSchema.origin`: "code — authored as `*.datasource.ts`,
     * GitOps-owned, read-only in the UI") and the datasource-admin service both
     * call read-only. Seen here, the package door and the repository's write
     * intent refuse it the way they refuse every code-shipped item of a type
     * with no overlay channel.
     *
     * ## What it reads
     *
     *  - **The installed package records** the engine registry holds
     *    (`getAllPackages()`), each record's manifest `datasources`.
     *    `registerApp` installs that record from the same manifest it indexes
     *    the datasource definitions from, and `AppPlugin` registers what the
     *    package bodies declare — so this is the set the runtime treats as
     *    code-defined, read from where the package ships it.
     *  - **In its one canonical form**: the array
     *    `ObjectStackDefinitionSchema.datasources` declares. The name-keyed map
     *    is authorable, but `defineStack` normalizes it to the array before any
     *    artifact is built (`MAP_SUPPORTED_FIELDS`), and the showcase's
     *    installed record carries the array (measured). No map fallback: Prime
     *    Directive #12 keeps one contract.
     *  - **Every installed package, a disabled one included**: the registry
     *    never filters package records, and a disabled package still ships the
     *    datasource the runtime registered for it — the artifact-only lookup
     *    answers for a disabled package's items the same way.
     *  - [#21944] **The host's code-datasource set**, the kernel service
     *    `'code-datasource-names'`: every datasource name the host registers
     *    from code, filled by the runtime in Phase 1 (`AppPlugin` with what the
     *    artifact declares, `DefaultDatasourcePlugin` with the host's own
     *    `default`). It is how this predicate sees `default`, which no package
     *    declares — `DefaultDatasourcePlugin` registers it from the host's
     *    definition, and the datasource-admin service refuses to edit or remove
     *    it as code-defined. The same set decides the datasource-admin plugin's
     *    boot restore (#21922), so the two doors read one answer. Read per
     *    call through the services registry, by name (its producer is
     *    `@objectstack/runtime`'s `code-datasource-names.ts`, which this
     *    package does not depend on); absent on a host that composes no
     *    code-datasource producer, where nothing is added to the packages'
     *    answer.
     *  - ⛔ **Never the MetadataService slot's `origin`**: a stored row the
     *    datasource-admin plugin restored at boot overwrote that slot, `origin`
     *    and all, so the slot answers what was stored last, not what a package
     *    ships. ⛔ **Never a request body's `origin`**: the caller sets it.
     *
     * ## What it does not see
     *
     *  - **A name neither a package declares nor the host registers from
     *    code** answers false and keeps the `runtime-only` intent: a runtime
     *    datasource stays creatable, editable and removable through this door.
     */
    private isDeclaredCodeDatasource(type: string, name: string): boolean {
        // [#25467 cut 28] The body moved to `protocol-code-datasource-predicates.ts` (see `CodeDatasourcePredicatesHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof isDeclaredCodeDatasource> = {
            get engine() { return readEngine(); },
            isHostCodeDatasource: (...a) => this.isHostCodeDatasource(...a),
        };
        return isDeclaredCodeDatasource.call(host, type, name);
    }

    /**
     * [#21944] The host's code-datasource set alone — the first half of
     * {@link isDeclaredCodeDatasource}, and exactly the names the
     * datasource-admin boot restore reads to keep a stored row off a code
     * definition and to name it in a warning ({@link loadMetaFromDb} leaves
     * those rows to that warning).
     */
    private isHostCodeDatasource(type: string, name: string): boolean {
        // [#25467 cut 28] The body moved to `protocol-code-datasource-predicates.ts` (see `CodeDatasourcePredicatesHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof isHostCodeDatasource> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return isHostCodeDatasource.call(host, type, name);
    }

    /**
     * [#20679, ADR-0126 §2] The `/meta` door's LOCKED-BASE verdict on an item
     * that already exists, as a VALUE — for a second door that writes or
     * removes the same artifact without passing through {@link saveMetaItem} /
     * {@link deleteMetaItem}.
     *
     * The one caller today is `@objectstack/runtime`'s `/automation` domain:
     * `PUT /automation/:name` re-registers a flow definition in the live
     * automation engine and `DELETE /automation/:name` unregisters one, and
     * neither is a `sys_metadata` write — so neither ever reached this class's
     * refusals, nor `SysMetadataRepository`'s. A packaged flow the `/meta` door
     * refuses to change could be changed, or removed, in place through that
     * door on the `manage_metadata` authoring gate alone: the ADR-0126 §2
     * promise ("the packaged base is locked — in-place edit refused loudly at
     * the write door") kept by one door onto the artifact and not the other.
     *
     * ## Asked HERE, never re-derived by the caller
     *
     * Both answers are the ones this class already gives: {@link
     * refusePackagedBaseOverride} is `saveMetaItem`'s package door and {@link
     * refusePackagedBaseRemoval} is `deleteMetaItem`'s, each lifted out of that
     * method UNCHANGED and called by it exactly where the inline code stood.
     * They THROW, as that code did; this method is the one place a throw is
     * turned into a value, and it re-raises anything that is not the refusal.
     * "Is this artifact-backed?" ({@link isArtifactBacked}: the registry's
     * artifact-only lookup, which answers from the entries the artifact loader
     * registered under a package id — never from the body a caller sends) and
     * "does the type have an overlay channel?" — [ADR-0131 D6] asked together
     * as {@link isSealedManagedItem}, the registry's `allowEnvironmentOverlay` alone,
     * never the `OS_METADATA_WRITABLE` hatch — keep exactly one spelling. The refusal — code, status and sentence — is registered to
     * this package in the ADR-0112 ledger, so the caller relays it verbatim
     * and stamps no code of its own.
     *
     * ## Topology-INDEPENDENT, deliberately
     *
     * [#22220] `saveMetaItem` asks its package door on every topology too,
     * ahead of the gates that judge the body; the SAME predicate is enforced
     * one layer down, by `SysMetadataRepository.assertAllowed` at the write
     * itself, as the store-level backstop — so the `/meta` door refuses a
     * packaged item's in-place write on every topology. A caller whose write
     * never reaches the repository has no such second layer, so it is
     * answered here on every topology. The removal side
     * agrees: the `/meta` door never removes a packaged base on any topology
     * (on a host-config kernel with no overlay row its delete is a no-op that
     * leaves the artifact standing, and with one the repository's delete gate
     * refuses).
     *
     * ## What it deliberately does NOT answer
     *
     *  - a name no code package ships (not artifact-backed ⇒ `null`) —
     *    creation is the `allowRuntimeCreate` tier's question, never this
     *    lock's;
     *  - the ADR-0010 per-item `_lock` (L3), which `saveMetaItem` enforces
     *    separately and records to `sys_metadata_audit`: with the hatch shut,
     *    an artifact-backed item of a type without `allowEnvironmentOverlay` is
     *    refused here before its `_lock` could matter;
     *  - a named base (`?package=`) on a door that carries none: the
     *    package-less refusal (`NOT_OVERRIDABLE`) is the whole answer there.
     *    [#20761] A save that DOES name one — `/meta`'s own write, reaching
     *    this verdict through {@link tenantAuthoredWriteRefusal} — passes it
     *    as `packageId`, and gets the named-base answer `saveMetaItem`'s
     *    package door gives (`ITEM_LOCKED` on a read-only base), so asking
     *    here never moves that door's vocabulary.
     *
     * ## One `save`, whatever the write meant
     *
     * [#23577] `save` is every write under the name: a door cannot tell a
     * create from an edit, so the refusal advises neither and states what it
     * knows (`managedItemSealedSentence` in `./packaged-base-regime.ts`).
     *
     * @returns the refusal to relay, or `null` when the `/meta` door would not
     *          refuse this write or removal on the locked-base ground.
     */
    packagedBaseRefusal(request: { type: string; name: string; operation: 'save' | 'delete'; packageId?: string | null }): Error | null {
        // [#9009] Folded HERE, at the producer of the verdict, so a caller that
        // arrives with a plural spelling cannot address around the lock.
        const folded = canonicalizeMetaRequestType(request);
        try {
            if (folded.operation === 'delete') this.refusePackagedBaseRemoval(folded);
            else {
                this.refusePackagedBaseOverride({
                    type: folded.type,
                    name: folded.name,
                    ...(folded.packageId ? { packageId: folded.packageId } : {}),
                });
            }
        } catch (err) {
            if (ObjectStackProtocolImplementation.isPackagedBaseRefusal(err)) return err;
            throw err;
        }
        return null;
    }

    /**
     * [#21670, ADR-0010 §5, ADR-0126 §2] The protection envelope a metadata READ
     * publishes beside the document — `lock`, `editable`, `deletable` and the
     * rest — for `(type, name)`, whose served document is `document` and whose
     * item lock is `itemLock`. The ONE derivation both reads call:
     * {@link getMetaItem} and {@link getMetaItemLayered} — and [#21694] the
     * per-type `locked` count of {@link getMetaDiagnostics}, so the directory
     * tile and the item agree.
     *
     * The flags are a promise about the write doors: `editable` says whether a
     * write of this item is refused on lock grounds, `deletable` whether its
     * removal is. Two limbs refuse such a write, so both are asked here, and
     * neither is re-derived:
     *
     *  - the item's own ADR-0010 `_lock` — `itemLock`, the answer of the one
     *    item-lock resolution ({@link resolveItemLock}, [#21738]) that the
     *    `_lock` gate ({@link getEffectiveLock}, behind {@link lockWriteRefusal}
     *    / {@link assertLockAllowsDelete}) takes too. The caller hands it the
     *    layers it resolved; this method never reads a lock off `document`,
     *    whose `_lock` used to be the reads' own derivation and disagreed with
     *    the gate on the artifact layer (an explicit artifact `'none'`; the
     *    layered read's `code ?? overlay`). The gate answers on every topology
     *    since #21694, as the package limb does;
     *  - the locked packaged base: an item a code package ships, on a type with
     *    no overlay channel — {@link packagedBaseRefusal}, the verdict the
     *    `/meta` doors and the `/automation` doors already share (`NOT_OVERRIDABLE`,
     *    or `ITEM_LOCKED` when the write names the read-only package). It
     *    carries the registry's flags and the #6960 removal carve-out, and
     *    answers alike on every topology and — [ADR-0131 D6] managed content
     *    being sealed — with the `OS_METADATA_WRITABLE` hatch open or shut.
     *
     * Asked from the first limb alone, a packaged flow or action read
     * `lock: 'none'`, `editable: true`, `deletable: true` while every door
     * refused it in place: a client or an agent that reads `editable` was told
     * the opposite of what the server enforces.
     *
     * `lock` is then the state whose ADR-0010 verdicts are exactly the two
     * booleans — read off the lock algebra itself (`evaluateLockForWrite` /
     * `evaluateLockForDelete`), never a second table — so the envelope keeps
     * the shape the spec declares for it: `editable` false iff `lock` is
     * `no-overlay` or `full`, `deletable` false iff `no-delete` or `full`. An
     * item's own `_lock` and the package verdict JOIN; neither replaces the
     * other. `lockReason` / `lockSource` / `lockDocsUrl` are the binding
     * layer's, from the same resolution, and absent when no layer binds: the
     * package limb adds no prose of its own, and `provenance` / `packageId` /
     * `packageVersion` (read off `document`, unchanged) already name the
     * package.
     *
     * ⛔ Not a policy. Which writes are refused is decided at the doors; this
     * method only reports their answer, so a door that moves moves this read
     * with it.
     *
     * [#21899] One removal verdict depends on the store, not the registry: an
     * origin-gated code-defined item ({@link originGatedRemovalRefusal}) is
     * refused removal unless a stored row exists, whose delete is repair. So
     * `storedRowServed` — whether the read found a stored row for the item —
     * is the one store fact this derivation takes, and only that verdict reads
     * it: `deletable` is true while there is such a row to remove, false once
     * there is none. Every other removal verdict ignores it. The diagnostics
     * tile passes none (it counts `lock !== 'none'`, which both answers are).
     */
    private servedLockState(
        type: string,
        name: string,
        document: unknown,
        artifactBacked: boolean,
        itemLock: ItemLock,
        storedRowServed = false,
    ): ReturnType<typeof resolveLockState> {
        // [#25467 cut 10] The body moved to `protocol-lock-state.ts` (see `LockStateHost`).
        const host: ThisParameterType<typeof servedLockState> = {
            packagedBaseRefusal: (...a) => this.packagedBaseRefusal(...a),
        };
        return servedLockState.call(host, type, name, document, artifactBacked, itemLock, storedRowServed);
    }

    /**
     * [#20913, #20761 ruling rule 1, ADR-0126 §2 / §3] Is `name` a FLOW name
     * the loader's set holds ({@link packagedArtifactOwner})? Every other type,
     * and a flow name no managed package ships, answers `false`.
     *
     * `flow` is Regime C: the packaged base is locked, "⛔ Never silent
     * override, never an overlay read path". So the flattened view
     * ({@link readFlattenedMetaItems}, both faces) serves a shipped flow name
     * from the loader's own entries alone, and a stored row of that name is
     * neither merged into the package's slot nor lets it stand in for it —
     * {@link isStoredFlowEntryOfShippedName} for the registry's list, this
     * predicate by NAME for a row read from the store, whose own bytes decide
     * nothing ([#21922] the reads ask both through {@link declinesStoredRow}
     * and its registry half, which add the code-defined datasource names).
     * Merged, such a row was served under the package's provenance
     * and the automation engine's `kernel:ready` sync armed it over the body
     * the boot pull had armed: the stored body dispatched while every receipt
     * named the package.
     *
     * The row itself is neither refused nor rewritten here: it stays at rest,
     * {@link hydrateOverlayIntoRegistry} still registers it as the
     * tenant-authored row it is, and the automation boot pull reports it as a
     * shadowed contender. What becomes of such rows (keep, refuse, migrate) is
     * not decided by this method.
     *
     * [#21002] PUBLIC so the published-snapshot doors can ASK it, never
     * re-derive it. {@link getMetaItemLayered} decides its effective layer with
     * this predicate, and `GET /meta/:type/:name/published` (the REST route
     * and its dispatcher twin) reads that layered answer: when a stored row is
     * present and this predicate holds for the answer's `type` and `name`, the
     * effective layer — the loader's body — is what the door serves, and in
     * every other case the door serves the stored row as before. One decision
     * point for the three reads; the doors hold no copy of the rule.
     *
     * [#21922] The layered read asks this predicate through
     * {@link declinesStoredRow}, which also declines the stored row of a
     * code-defined datasource name. [#21986] The published doors ask
     * {@link declinesStoredRow} in its place, so for such a name they serve
     * the code definition too.
     */
    isShippedFlowName(type: string, name: unknown): boolean {
        // [#25467 cut 10] The body moved to `protocol-lock-state.ts` (see `LockStateHost`).
        const host: ThisParameterType<typeof isShippedFlowName> = {
            packagedArtifactOwner: (...a) => this.packagedArtifactOwner(...a),
        };
        return isShippedFlowName.call(host, type, name);
    }

    /**
     * [#20913] A registry entry of a shipped flow name ({@link isShippedFlowName})
     * that is NOT one of the loader's own entries — the stored row the
     * hydration registered under the bare key. The loader's entries are told
     * apart by `isCodeArtifactBody`, the per-entry test the set's own lookup
     * (`SchemaRegistry.getArtifactItem`) applies; a stored flow row reaches the
     * registry tenant-marked and, since this card, without the artifact's
     * envelope ({@link hydrateOverlayIntoRegistry}), so it never passes it.
     */
    private isStoredFlowEntryOfShippedName(type: string, item: unknown): boolean {
        // [#25467 cut 10] The body moved to `protocol-lock-state.ts` (see `LockStateHost`).
        const host: ThisParameterType<typeof isStoredFlowEntryOfShippedName> = {
            isShippedFlowName: (...a) => this.isShippedFlowName(...a),
        };
        return isStoredFlowEntryOfShippedName.call(host, type, item);
    }

    /**
     * [#21922, ADR-0062 D4, ADR-0126 §3] Is `name` one whose STORED row the
     * active reads never adopt, judged by NAME? The one decision the by-name
     * read ({@link getMetaItem}), the flattened view
     * ({@link readFlattenedMetaItems}, both faces) and the layered read's
     * effective layer ({@link getMetaItemLayered}) take before they serve a
     * stored row. ⛔ No read carries a copy of it, and it opens no precedence
     * path of its own: the row is skipped, and each read falls through to the
     * code layer it already reads next.
     *
     * Exactly three answers, none re-derived here:
     *
     *  - a FLOW name the loader's set holds ({@link isShippedFlowName},
     *    #20913 / #20946 / #21002) — Regime C, "never an overlay read path";
     *    the reads serve the loader's entry;
     *  - a CODE-DEFINED DATASOURCE name ({@link isDeclaredCodeDatasource}: the
     *    host's code-datasource set, then the installed packages'
     *    declarations) — "code wins on collision", the datasource-admin
     *    service's invariant, which the boot restore obeys too. The code
     *    definition is the MetadataService's in-memory registration, and that
     *    is the layer the reads serve. A stored row under such a name is never
     *    a layer of it, only residue ({@link originGatedRemovalRefusal}): it
     *    stays at rest, the boot restore names it in a warning, and the `/meta`
     *    DELETE removes it as repair.
     *  - [ADR-0131 D6, triage ruling Q1 → C] a SEALED managed item
     *    ({@link isUnservedSealedOverlay}): an environment overlay row on an
     *    item a managed package ships, of ANY type whose registry entry opens
     *    no overlay channel ({@link isSealedManagedItem}: every type but the
     *    five regime-O ones, so a merge-at-read `page` or `app` as much as a
     *    flow or an object), `permission` excepted, is in no
     *    regime D6 recognises — the package definition wins. Such rows were
     *    written through the `OS_METADATA_WRITABLE` hatch before the seal; they
     *    stay at rest, untouched, and the boot report names them per type with
     *    the two remedies ({@link reportSealedOverlayRows}). [#29613] Except,
     *    for a `page`, `app`, `dataset`, `doc`, `book` or [#30062] `mapping`, the shipping
     *    package's declared `.custom` override (`row`, below): ADR-0146 D8
     *    item 2 serves it, as a dashboard's.
     *
     * ⛔ Never a row's, slot's or body's `origin` — the caller sets it.
     *
     * Every other type, and a name neither predicate holds for, keeps
     * ADR-0005's read order: the stored overlay wins. Each caller scopes it to
     * the ACTIVE read, so a draft is answered as a draft.
     *
     * What it does not move: whether a read FOUND a stored row
     * (`storedRowServed`, the fact {@link servedLockState}'s `deletable`
     * reads), the `_lock` gate's overlay layer ({@link overlayLockLayerAt},
     * read whether or not the row is adopted), and the DELETE's own row probe.
     *
     * [#21986] PUBLIC so a door that serves a stored row out of the layered
     * read can ASK it, never re-derive it: `GET /meta/:type/:name/published`
     * (the REST route and its dispatcher twin) reads {@link getMetaItemLayered}
     * and, when a stored row is present and this predicate holds for the
     * answer's `type` and `name`, serves the `effective` layer (the loader's
     * body, or the code definition) instead of the row. Every other stored row
     * is served as before. A door asks this method alone: ⛔ no door restates
     * either half, or the host's code-datasource set. A write door does not
     * ask it; the writes keep their own refusals.
     *
     * [#28412, ADR-0146 D9 item 1] `row` — the stored row the read is about to
     * serve (its `type`, `package_id` column and body) — admits exactly one
     * stored row of a shipped flow name: the shipping package's declared
     * override, a row bound to that package's paired `<package>.custom` whose
     * body declares `overrides.package` = the package
     * ({@link isServedOverrideRowOf}, the one predicate; ⛔ never the body's
     * `_packageId`). That row is the packaged flow now, served over the
     * loader's body for the name. Without `row`, or for any other row, the
     * answer is the by-name one above. The flattened view, the by-name read,
     * the layered read and the per-package customization read pass the row
     * they serve.
     */
    declinesStoredRow(type: string, name: unknown, row?: ServedOverrideRow): boolean {
        // [#25467 cut 10] The body moved to `protocol-lock-state.ts` (see `LockStateHost`).
        const host: ThisParameterType<typeof declinesStoredRow> = {
            isDeclaredCodeDatasource: (...a) => this.isDeclaredCodeDatasource(...a),
            isShippedFlowName: (...a) => this.isShippedFlowName(...a),
            isUnservedSealedOverlay: (...a) => this.isUnservedSealedOverlay(...a),
            packagedArtifactOwner: (...a) => this.packagedArtifactOwner(...a),
        };
        return declinesStoredRow.call(host, type, name, row);
    }

    /**
     * [ADR-0131 D6, triage ruling Q1 → C] Is a stored environment row of
     * `(type, name)` an overlay of SEALED managed content, which no read
     * serves? {@link isSealedManagedItem}, the predicate the save and delete
     * doors refuse by, so the write refusal and the read narrowing cannot
     * disagree about which items are sealed.
     *
     * ⛔ Except `permission`. A permission set a code package ships is guarded
     * by its own lock (ADR-0086 / ADR-0094, `packaged-permission-set-lock`),
     * and the forks stored before that lock existed have a maintainer ruling
     * of their own: a detection reading, "no automatic reap/merge … not a
     * silent migration" (a cold boot now refuses such a fork, ADR-0048, and
     * the offline `os migrate security-catalog-overlays` removes it). Not serving
     * such a fork would change the grants the deployment enforces without an
     * operator's act, so it keeps that ruling's disposition.
     */
    private isUnservedSealedOverlay(type: string, name: string): boolean {
        // [#25467 cut 10] The body moved to `protocol-lock-state.ts` (see `LockStateHost`).
        const host: ThisParameterType<typeof isUnservedSealedOverlay> = {
            isSealedManagedItem: (...a) => this.isSealedManagedItem(...a),
        };
        return isUnservedSealedOverlay.call(host, type, name);
    }

    /**
     * [#21922] The registry half of {@link declinesStoredRow}: a registry entry
     * under such a name that is not a code artifact body — the stored row
     * {@link hydrateOverlayIntoRegistry} registered under the bare key,
     * tenant-marked. For a flow name it answers what
     * {@link isStoredFlowEntryOfShippedName} answers. A code-defined datasource
     * is never a SchemaRegistry item at all (its code definition is the
     * MetadataService's), so every entry it matches is a hydrated row.
     */
    private isStoredEntryOfDeclinedName(type: string, item: unknown): boolean {
        // [#25467 cut 10] The body moved to `protocol-lock-state.ts` (see `LockStateHost`).
        const host: ThisParameterType<typeof isStoredEntryOfDeclinedName> = {
            declinesStoredRow: (...a) => this.declinesStoredRow(...a),
        };
        return isStoredEntryOfDeclinedName.call(host, type, item);
    }

    /**
     * [#20761, ADR-0126 §2 / §7.3] THE LOADER'S SET, read: the package that
     * ships `(type, name)` as a code artifact, or `undefined` when none does.
     *
     * For a flow, "packaged" means exactly "loaded by the loader from a
     * managed package" — there is no other legitimate route. This answers
     * from the entries the artifact loader registered under a package id
     * ({@link lookupArtifactItem} → `SchemaRegistry.getArtifactItem`, immune to
     * plain-key overlay shadows and blind to tenant-authored rows) — the SAME
     * lookup {@link packagedBaseRefusal}'s `isArtifactBacked` asks, so the
     * lock and every classification built on this answer read one set. ⛔
     * Never the body a caller sends: an authoring door's body cannot move it.
     *
     * The automation engine is the reader beside the lock: its §7.3 subflow
     * guards, its activation door and the activation row's package
     * attribution classify a flow by this answer (the automation plugin hands
     * the engine a reader over it), never by the stamps the flow's own body
     * carries. Read at question time, never cached, so it follows the
     * registry across a package install, upgrade and reload exactly as the
     * lock does.
     */
    packagedArtifactOwner(request: { type: string; name: string }): string | undefined {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.packagedArtifactOwner(protocolHost(this), request);
    }

    /**
     * [#20761, ADR-0126 §2, ADR-0131 D6] THE ONE RULE every authoring door
     * applies to a `flow` it writes: a flow written through an authoring door
     * is TENANT-AUTHORED — no exception, on any door. The automation create
     * and update doors, the clone door and `/meta` all ask this method; none
     * re-derives it.
     *
     *  1. **A name the loader's set holds** ({@link packagedArtifactOwner}) is a
     *     locked base, and the answer is {@link packagedBaseRefusal}'s —
     *     reused, never re-implemented. That covers a round trip of a shipped
     *     flow: its served body echoes stamps that AGREE with the set, and the
     *     write is still an in-place edit of a locked base. [ADR-0131 D6] The
     *     `OS_METADATA_WRITABLE` hatch no longer admits it: a managed flow is
     *     sealed with the hatch open or shut, so the body's stamps never get
     *     the chance to decide anything for a name the loader's set holds.
     *  2. **Any other name, with a body whose stamps would classify it as
     *     code-shipped** (`isCodeArtifactBody`, ADR-0029 D9.6), is refused
     *     LOUDLY. The body asserts a provenance the platform never
     *     established — a flow no managed package loaded, claiming one did.
     *     ⛔ Never honoured (the engine would count it as a vendor flow under
     *     §7.3 and attribute an activation row to the named package), and ⛔
     *     never silently stripped (the caller would never learn that what it
     *     sent is not what was stored).
     *  3. **Everything else is admitted.** A tenant row's own stamps, echoed
     *     on a round trip, agree with the server's fact, so they are a no-op
     *     here. Most classify the body as tenant-authored already
     *     (`_provenance: 'org'`, the `sys_metadata` sentinel). One does not,
     *     and it is MEASURED, not hypothetical: a stored flow bound to a
     *     package is served with its binding surfaced as `_packageId` and no
     *     `_provenance` (the `/meta` read's parity with the list path), so its
     *     round trip carries stamps `isCodeArtifactBody` reads as code-shipped.
     *     Those stamps name the package the SERVER binds that row to, so they
     *     agree with its fact: {@link storedFlowBindingAgrees} asks the store,
     *     and the write this door is making — a `/meta` save naming that same
     *     package as its base — agrees by the same token.
     *
     * `INVALID_METADATA` / 422 — registered to this package in the ADR-0112
     * ledger, ⛔ no code is minted — for the reason `saveMetaItem`'s
     * layered-envelope refusal uses it: the body carries keys the server owns
     * and a client may not persist. Not a 403: no caller can be authorized
     * into asserting a provenance. Not a 409: nothing about the target's
     * current state is contested — the name is free.
     *
     * [#20863, ADR-0070 D1] **The named-base rule — after rule 1's lock,
     * before rule 2: a base the write NAMES must be a package this deployment
     * has installed.** A `/meta` save may name the package it is saved into.
     * One naming an id no installed package has would store a flow bound to a
     * package that does not exist and serve that binding back — a binding the
     * platform can never honour, accepted silently. It is refused LOUDLY,
     * whatever stamps the body carries: none (which rule 3 admits) or a stamp
     * naming that same id (which the named-base agreement of rule 3 admits) —
     * the two branches that used to let it through. The hatch does not lift
     * it either: `OS_METADATA_WRITABLE` unlocks a TYPE, never a binding.
     *
     *  - "Installed" is read where the `/meta` write path already resolves a
     *    base: {@link resolveWritePackageScope}, the registry's `getPackage`.
     *    ⛔ Never a second list of packages, and ⛔ never the loader's set
     *    alone — a tenant's own writable base (created through the package
     *    door, rehydrated from the package store at boot) is installed and
     *    ships no flow, and a save into it is the ordinary authoring path.
     *  - The `sys_metadata` sentinel names no package — a row stored under it
     *    reads back package-less — so a save naming it is a package-less save,
     *    admitted as before.
     *  - Fail direction: `resolveWritePackageScope` answers `undefined` for a
     *    registry it cannot read as well as for an id it does not hold, so on
     *    a registry with no `getPackage` (a metadata-only double — every real
     *    composition's `SchemaRegistry` has one) a named base is refused. A
     *    binding the platform cannot establish is not honoured: the same
     *    closed direction the automation engine takes with no loader's-set
     *    reader attached.
     *
     * `WRITABLE_PACKAGE_REQUIRED` / 422 — registered to this package in the
     * ADR-0112 ledger, ⛔ no code is minted — because ADR-0070 D1 decided it
     * for exactly this condition: a runtime create whose resolved target is
     * MISSING, or read-only, is refused with it, and the prescription is the
     * one this caller needs (choose or create a writable base, or name none).
     * Not `INVALID_METADATA`: the definition may be perfectly valid — what is
     * wrong is the base the request names, not a key in the body. The
     * sentence is this refusal's own, because the D1 emitter's
     * (`readOnlyBaseCreateError`) says the package is read-only, which is
     * false of a package that does not exist; the `packageId` and `docs`
     * members mirror that emitter's.
     *
     * Scoped to `flow` (the 2026-09-30 ruling recorded on the card, point 5):
     * for every OTHER type this returns `null`. [#26708] The named-base rule
     * alone has since been generalised: `saveMetaItem` asks
     * {@link uninstalledNamedBaseRefusal} for every type right after this
     * method, so a view naming an uninstalled base is refused there, not here.
     *
     * @returns the refusal to relay verbatim, or `null` when the write may
     *          proceed on these grounds.
     */
    async tenantAuthoredWriteRefusal(request: { type: string; name: string; item: unknown; packageId?: string | null }): Promise<Error | null> {
        // [#25467 E1] The body moved to `protocol-tenant-authored-write.ts`; it reaches this class through `protocol-host.ts`.
        return tenantAuthoredWriteRefusal(protocolHost(this), request);
    }

    /**
     * [#20863, #26708, ADR-0070 D1] THE NAMED-BASE RULE, for every metadata
     * type: a base an authoring write NAMES must be a package this deployment
     * has installed. Returns the refusal to throw, or `null` when the write
     * names no package, names the `sys_metadata` sentinel, or names an
     * installed one.
     *
     * Lifted out of {@link tenantAuthoredWriteRefusal} — where it was the
     * flow-only rule between the lock and the provenance check (that
     * docblock's named-base section is this rule's record: what "installed"
     * reads, why the sentinel is package-less, the fail direction, and why the
     * code is `WRITABLE_PACKAGE_REQUIRED` / 422). The flow arm still asks it
     * at that position, and `saveMetaItem` asks it for every type, draft and
     * active alike: a save naming an id no installed package has stored the
     * item bound to a package that does not exist — with no manifest there is
     * no namespace, so the object prefix rule was skipped too, and
     * `publish-drafts` on that id then served the item live.
     *
     * The sentence names the type the write names; for a flow it is the
     * sentence the flow arm always answered, byte for byte.
     *
     * [#26921] Two more doors ask it, about a binding the CALLER did not name
     * but the item's stored rows give — rows bound to such an id were stored
     * before the save door refused one, and these two doors still extended
     * or published them:
     *
     *  - `inherited`: a save naming no package, whose address the item's rows
     *    give (#11087 / ADR-0048: the package of its active row, or of its
     *    lone draft). It kept the phantom binding.
     *  - `verb: 'publish'`: the per-item publish ({@link promoteDraftForPublish}),
     *    named or not — the package its promotion lands in. It served the
     *    draft live, the way `publish-drafts` did before it refused the id.
     *
     * Same rule and envelope; only the sentence says which write was refused
     * and the way out. Saving "without naming a package" is no way out there
     * (that save inherits the binding), so those two name the ones that are:
     * creating a package with that id, or removing the rows bound to it — a
     * delete naming the id still removes the active row, and discarding the
     * drafts under it removes those. ⛔ Nothing here migrates or deletes a
     * stored row: the author chooses.
     */
    private uninstalledNamedBaseRefusal(
        request: { type: string; name: string; packageId?: string | null },
        how: { verb?: 'save' | 'publish'; inherited?: boolean } = {},
    ): Error | null {
        // [#25467 cut 33] The body moved to `protocol-package-scope.ts` (see `PackageScopeHost`).
        const host: ThisParameterType<typeof uninstalledNamedBaseRefusal> = {
            resolveWritePackageScope: (...a) => this.resolveWritePackageScope(...a),
        };
        return uninstalledNamedBaseRefusal.call(host, request, how);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.storedFlowBindingAgrees} in `protocol-write-gates.ts` [#29985 codemod]. */
    private async storedFlowBindingAgrees(name: string, packageId: string): Promise<boolean> {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.storedFlowBindingAgrees(protocolHost(this), name, packageId);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.isPackagedBaseRefusal} in `protocol-write-gates.ts` [#29985 codemod]. */
    private static isPackagedBaseRefusal(err: unknown): err is Error {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reads nothing of this class.
        return ProtocolWriteGatesFacet.isPackagedBaseRefusal(err);
    }

    // [#20819, #20910, ADR-0126 §2 / §3] The packaged-base refusal's sentence is
    // chosen PER REGIME, from the ONE regime table in `./packaged-base-regime.ts`
    // (`packagedBaseRegimeSentence` there), which the repository's type door and
    // its named-base `ITEM_LOCKED` limb read too — so the three doors onto one
    // locked base cannot prescribe three different things. Each Regime C type's
    // row supplies its own sanctioned routes (`flow` clone and switch, `action`
    // its activation switch, `permission` its clone); a type with no declared
    // regime keeps the sentence the emitters below carry inline, byte for byte.

    /**
     * [#8184] THE PACKAGE DOOR — `saveMetaItem`'s refusal of a write onto an
     * item a code package ships, on a type with no per-org overlay channel.
     * Throws the refusal; returns when the write is not refused on that ground.
     *
     * [#20679] Lifted out of `saveMetaItem` UNCHANGED — the `if` below, its
     * record and both emitters are that method's lines, byte for byte apart
     * from indentation — so {@link packagedBaseRefusal} can hand a second write
     * door the same verdict. `saveMetaItem` calls it at the same position
     * (below the code-only and org-scope refusals, above the ADR-0010 `_lock`
     * check) — [#22220] on every topology, where it used to be asked behind
     * `environmentId !== undefined` only. The one added line computes
     * `overlayAllowed` the way `saveMetaItem` computes it at its top. In the
     * record, "the block comment above" and "this method" mean `saveMetaItem`.
     *
     * [#20819] Since lifted, the package-less `NOT_OVERRIDABLE` SENTENCE is
     * chosen per ADR-0126 regime ({@link packagedBaseRegimeSentence}); the
     * predicate, the code and the status are unchanged. [#20910] The named-base
     * limb's emitter, `readOnlyBaseOverrideError`, takes a Regime C type's
     * prescription from the same table — in that emitter, so both doors that
     * call it keep one sentence.
     *
     * [ADR-0131 D6] Managed content is sealed: the predicate is
     * {@link isSealedManagedItem}, shared with {@link refusePackagedBaseRemoval},
     * and the `OS_METADATA_WRITABLE` hatch no longer takes a write past it. The
     * sentence names the managed package ({@link managedItemSealedSentence}, the
     * one builder the repository's type door reads too); the code and the status
     * are unchanged.
     */
    private refusePackagedBaseOverride(
        request: { type: string; name: string; packageId?: string | null },
    ): void {
        // [#25467 cut 13] The body moved to `protocol-packaged-base-refusal.ts` (see `PackagedBaseRefusalHost`).
        const host: ThisParameterType<typeof refusePackagedBaseOverride> = {
            isSealedManagedItem: (...a) => this.isSealedManagedItem(...a),
            isWritablePackage: (...a) => this.isWritablePackage(...a),
            packagedArtifactOwner: (...a) => this.packagedArtifactOwner(...a),
        };
        return refusePackagedBaseOverride.call(host, request);
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
    private async packagelessOverlayWriteRefusal(
        request: PackagelessWriteSubject,
        operation: PackagelessWriteOperation,
    ): Promise<Error | null> {
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
    private namedBaseOverlayWriteRefusal(
        request: NamedBaseWriteSubject,
        operation: NamedBaseWriteOperation,
    ): Error | null {
        const host: ThisParameterType<typeof namedBaseCloseSubject> = {
            engine: this.engine,
            overlayBaseShippers: (...a) => this.overlayBaseShippers(...a),
            overrideWriteVerdict: (...a) => this.overrideWriteVerdict(...a),
        };
        const closed = namedBaseCloseSubject.call(host, request);
        return closed ? namedBaseOverlayWriteRefusal(request, closed, operation) : null;
    }

    /**
     * [ADR-0146 D2, ruling A on #28390] The override write gate's verdict on
     * one item written into one package: `admit` for the base's paired
     * `<base>.custom` declaring an override of an item the base ships, one
     * named `refuse`, or `not_concerned`. The rule is
     * `judgeOverrideWrite` (`protocol-packaged-base-refusal.ts`), the one
     * judgement `os validate` and the marketplace install door ask too; this
     * method supplies its two registry facts — the written package's
     * dependency closure ({@link resolveWritePackageScope}) and which closure
     * packages ship the name ({@link shippedArtifactsOf}).
     *
     * Asked by the save door ahead of {@link refusePackagedBaseOverride}, and
     * by the promotion ({@link promoteDraftForPublish}, so both
     * `publishMetaItem` and `publishPackageDrafts`) on the draft's body. The
     * two overlay-write closes ask it about the pair their fix writes into,
     * with the closure a pair not yet ensured will have (`writtenScope`).
     */
    private overrideWriteVerdict(request: OverrideWriteSubject, writtenScope?: WrittenPackageScope): OverrideWriteVerdict {
        const host: ThisParameterType<typeof overrideWriteVerdict> = {
            isWritablePackage: (...a) => this.isWritablePackage(...a),
            resolveWritePackageScope: (...a) => this.resolveWritePackageScope(...a),
            shippedArtifactsOf: (...a) => this.shippedArtifactsOf(...a),
        };
        return overrideWriteVerdict.call(host, request, writtenScope);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.refusePackagedBaseRemoval} in `protocol-write-gates.ts` [#29985 codemod]. */
    private refusePackagedBaseRemoval(request: { type: string; name: string }): void {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.refusePackagedBaseRemoval(protocolHost(this), request);
    }

    /**
     * [#21899, ADR-0126 §3] The removal verdict on an item of an ORIGIN-GATED
     * type ({@link isOriginGatedType} — `datasource`: code-defined read-only,
     * runtime-created free) when the item is code-defined: the package door's
     * own refusal, {@link packagedBaseRefusal} for `delete`, held for
     * {@link deleteMetaItem} to answer at its row probe. `null` for an item of
     * any other type and for a runtime item of this one (nothing ships the
     * name) — each keeps the verdict it had. [ADR-0131 D6] `OS_METADATA_WRITABLE`
     * open on the type no longer lifts it: a code-defined item is sealed with
     * the hatch open or shut, and the stored-row repair below is the same in
     * both.
     *
     * ## The one removal it lifts, and the one it keeps
     *
     * `deleteMetaItem` throws it when NO stored row exists under the name: the
     * delete would remove nothing, and a code-defined datasource is not
     * removable at runtime — the datasource-admin service's verdict, now the
     * `/meta` door's too, in the same `NOT_OVERRIDABLE` / 403 its save gets.
     * When a stored row DOES exist, the delete goes ahead and removes it.
     *
     * That second half is not a new rule. It is the one {@link saveMetaItem}'s
     * #5086 record states and #6960 extended, applied to the save refusal this
     * card adds: "removing a code-only row that predates this refusal is
     * repair, and must stay possible", because the removal restores the
     * code-declared state — the narrowing direction, which cannot widen
     * anything. Rows that predate it exist (#21899 measured them: a `/meta`
     * save of a code-defined datasource persisted one, and at boot it shadows
     * the code definition in both doors), and before this refusal the `/meta`
     * door was the one door that could clear them; refusing every delete would
     * leave them to database surgery.
     *
     * #6960's own carve-out ({@link mergesOverlayAtRead}) does not reach it,
     * and is not widened to: it is keyed on `supportsOverlay`, which
     * `datasource` does not declare — and `object`, which shares those flags,
     * keeps refusing both verbs (ADR-0029 D9.6). What sets an origin-gated type
     * apart is that its code-defined items are never persisted at all, so a
     * stored row under one is never a layer of it, only residue. The
     * repository's delete gate mirrors the lift for the same type
     * ({@link SysMetadataRepository.assertDeleteAllowed}), because it is
     * topology-independent and is the gate a host-config kernel asks.
     *
     * The read envelope reports the same verdict ({@link servedLockState}):
     * `editable: false` always, and `deletable` true exactly while the read
     * found a stored row for the delete to remove.
     */
    private originGatedRemovalRefusal(type: string, name: string): Error | null {
        // [#25467 cut 13] The body moved to `protocol-packaged-base-refusal.ts` (see `PackagedBaseRefusalHost`).
        const host: ThisParameterType<typeof originGatedRemovalRefusal> = {
            packagedBaseRefusal: (...a) => this.packagedBaseRefusal(...a),
        };
        return originGatedRemovalRefusal.call(host, type, name);
    }

    // ───────────────────────────────────────────────────────────────────
    // ADR-0010 — metadata protection (Phase 1: L3 item-level lock)
    // ───────────────────────────────────────────────────────────────────

    /**
     * Look up an item from the artifact registry across both the requested
     * type and its singular/plural twin. Returns `undefined` when the
     * registry is unavailable or the item is not artifact-backed.
     *
     * [#22877] `member` — for a type whose identity is a pair, the ONE bundle
     * member whose artifact to answer, as its discriminator value; omitted,
     * the bundle's artifact canonical-first. A registry without the parameter
     * ignores it, so a caller that needs the member checks the answer.
     */
    private lookupArtifactItem(type: string, name: string, currentPackageId?: string, member?: string): unknown {
        // [#25467 cut 15] The body moved to `protocol-artifact-lookup.ts` (see `ArtifactLookupHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof lookupArtifactItem> = {
            get engine() { return readEngine(); },
        };
        return lookupArtifactItem.call(host, type, name, currentPackageId, member);
    }

    /**
     * [#21803, ADR-0010 §3.3, ADR-0048 §3.4] The item-lock resolution's
     * `artifact` layer ({@link resolveItemLock}) for the item at `address`:
     * {@link resolveArtifactLockLayer}, the one selection, over
     * {@link shippedArtifactsOf}. The `_lock` gate ({@link getEffectiveLock}),
     * {@link getMetaItem}, {@link getMetaItemLayered}, the list
     * ({@link readFlattenedMetaItems}) and the diagnostics tile
     * ({@link getMetaDiagnostics}) all take the artifact layer here, so no
     * caller picks the artifact its lock comes from. Content does not come from
     * here: each of them still serves the address's own package's artifact
     * ({@link lookupArtifactItem} with the request's package).
     *
     * `shipping` is {@link shippingPackagesOf} for the type, read once by a
     * caller that asks about many items of one type.
     */
    private artifactLockLayerAt(address: ItemAddress, shipping?: ShippingPackages): readonly unknown[] {
        // [#25467 cut 15] The body moved to `protocol-artifact-lookup.ts` (see `ArtifactLookupHost`).
        const host: ThisParameterType<typeof artifactLockLayerAt> = {
            shippedArtifactsOf: (...a) => this.shippedArtifactsOf(...a),
        };
        return artifactLockLayerAt.call(host, address, shipping);
    }

    /**
     * [#21803] Every artifact an installed code package registered under
     * `(type, name)`: what the registry's artifact-only lookup
     * ({@link lookupArtifactItem}) answers for each package that can ship the
     * name ({@link shippingPackagesOf}), kept when it is that package's own
     * (`_packageId` equal to the package asked for, the prefer-local hit), plus
     * what it answers with no package at all.
     *
     * The registry has no enumeration of its own for this, so the reader asks
     * its existing lookups per package. The package-less lookup is always in
     * the set. It is the one the `_lock` gate made before #21803 (the first
     * package registered), so the resolution over this set never answers
     * looser than the gate did under any registration order; with no composite
     * entry at all it is also the only way to reach an artifact registered
     * under the plain key.
     *
     * An `object` has one owner (`SchemaRegistry.registerObject` refuses a
     * second code package's claim on the name, ADR-0029 D3), and its artifact
     * lookup reads the owner's layer whatever package is asked for, so the
     * owner is the whole set.
     *
     * [#28746] `member` — one bundle member's artifacts, for a type whose
     * identity is a pair (the override write gate's question, which asks
     * about the member a write addresses). Omitted, the bundle's artifact
     * canonical-first, as before: a lock binds the NAME.
     */
    private shippedArtifactsOf(type: string, name: string, shipping?: ShippingPackages, member?: string): unknown[] {
        // [#25467 cut 15] The body moved to `protocol-artifact-lookup.ts` (see `ArtifactLookupHost`).
        const host: ThisParameterType<typeof shippedArtifactsOf> = {
            lookupArtifactItem: (...a) => this.lookupArtifactItem(...a),
            shippingPackagesOf: (...a) => this.shippingPackagesOf(...a),
        };
        return shippedArtifactsOf.call(host, type, name, shipping, member);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.shipsBundleName} in `protocol-write-gates.ts` [#29985 codemod]. */
    private shipsBundleName(type: string, name: string, base: string, shipping: ShippingPackages): boolean {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.shipsBundleName(protocolHost(this), type, name, base, shipping);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.baseServesBundleMember} in `protocol-write-gates.ts` [#29985 codemod]. */
    private baseServesBundleMember(type: string, name: string, base: string, item: unknown, shipping: ShippingPackages): boolean {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.baseServesBundleMember(protocolHost(this), type, name, base, item, shipping);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.pairOfAddedMember} in `protocol-write-gates.ts` [#29985 codemod]. */
    private pairOfAddedMember(type: string, name: string, base: string, member: string): string | undefined {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.pairOfAddedMember(protocolHost(this), type, name, base, member);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.findPairAddedMemberRow} in `protocol-write-gates.ts` [#29985 codemod]. */
    private async findPairAddedMemberRow(
        type: string, name: string, base: string, member: string | undefined, wantedMember: string,
        activeRows?: readonly StoredOverlayRow[],
    ): Promise<any> {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.findPairAddedMemberRow(protocolHost(this), type, name, base, member, wantedMember, activeRows);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.registryMemberServedAt} in `protocol-write-gates.ts` [#29985 codemod]. */
    private registryMemberServedAt(type: string, name: string, base: string, item: unknown, member: string | undefined): unknown {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.registryMemberServedAt(protocolHost(this), type, name, base, item, member);
    }

    /**
     * [#21803] The packages that can ship an item of `type`, read off the
     * registry's own listings:
     *
     *  - `byName`: per name, the package of every entry the registry lists for
     *    the type under that name (both spellings);
     *  - `anyName`: the packages the listing cannot attribute to a name, probed
     *    for every name. The listing hides a DISABLED package's entries and the
     *    artifact lookup does not (the `_lock` gate bound a disabled package's
     *    artifact before #21803 when it was registered first), so every
     *    installed package the registry reports disabled is here (every
     *    installed package, when the registry cannot say which are disabled); so
     *    is the package of a listed entry that carries no `name`.
     *
     * A registry without either listing, or whose listing throws (a
     * metadata-only host's partial registry: listing there is best-effort
     * context, never the reason a write fails), contributes nothing here, and
     * {@link shippedArtifactsOf} then answers with the package-less lookup and
     * whatever could be listed: never looser than the `_lock` gate before
     * #21803, which asked that lookup alone.
     */
    private shippingPackagesOf(type: string): ShippingPackages {
        // [#25467 cut 15] The body moved to `protocol-artifact-lookup.ts` (see `ArtifactLookupHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof shippingPackagesOf> = {
            get engine() { return readEngine(); },
        };
        return shippingPackagesOf.call(host, type);
    }

    /**
     * True when `packageId` is a **writable base** — a DB-backed package an
     * org or the AI may author *new* metadata into (ADR-0070 D2).
     *
     * [#7560] The rule itself moved to {@link isWritablePackage} in
     * `./package-writability.js` because it gained a SECOND caller: the
     * `/packages` lifecycle routes, which must refuse to disable or delete a
     * read-only package the same way this path refuses to author into one. Two
     * hand-kept copies of "which packages are read-only" is precisely the drift
     * that let `DELETE /packages/:id` remove a platform package from a live
     * deployment while `saveMetaItem` was refusing to add one field to it. This
     * method stays as the in-class spelling; the shared function is the
     * definition, and its doc comment carries the reasoning.
     */
    private isWritablePackage(packageId: string | null | undefined): boolean {
        // [#25467 cut 33] The body moved to `protocol-package-scope.ts` (see `PackageScopeHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof isWritablePackage> = {
            get engine() { return readEngine(); },
        };
        return isWritablePackage.call(host, packageId);
    }

    /**
     * Resolve the effective `_lock` for an item by consulting the
     * artifact registry first, then the persisted overlay row. Artifact
     * always wins — by design, an overlay cannot loosen a packaged
     * lock (ADR-0010 §3.3).
     *
     * Returns `'none'` when nothing is locked, which is the common
     * case. It answers alike on every topology: no `environmentId` term,
     * and since #21694 neither caller gates on one.
     *
     * ## [#21738] The rule is the one item-lock resolution's
     *
     * Which layer binds, and what an explicit `'none'` means, is decided by
     * {@link resolveItemLock} — the resolution both reads' envelopes and the
     * served body's lock family take too — never here. This method only
     * gathers the two layers the gate reads (the artifact, then the overlay
     * row, below) and reads the overlay row only when the artifact does not
     * bind ({@link resolveItemLockLazily}), as it always has: a packaged lock
     * is answered without a store read, and a store that cannot be read never
     * turns its `ITEM_LOCKED` into a 503. The refusal's `source=` names the
     * binding layer, as before.
     *
     * ## [#21716] The overlay limb reads the row the READ serves
     *
     * The overlay limb used to query one row: `organization_id` equal to the
     * request's organization, or null without one. The reads resolve by
     * precedence instead — the org-scoped row, else the env-wide row
     * (ADR-0005) — so for an organization with no row of its own, both reads
     * served the env-wide row and published its `_lock` (`editable: false`
     * under `full`) while this limb found nothing and answered `'none'`: an
     * org-scoped save and delete of an item ADR-0010 §3.3 declares "Overlay
     * writes rejected" were admitted. The door was looser than the read on the
     * organization axis, as it had been on the topology axis (#21694).
     *
     * So the limb asked {@link findServedOverlayRow} — the resolution both
     * reads call. [ADR-0131 D6] Both now read the environment's rows alone,
     * and so does this limb. ⛔ No second predicate: a change to the read's
     * precedence moves this limb with it.
     *
     * ## [#21761] The limb and the reads select the rows from one ADDRESS
     *
     * The limb used to ask {@link findServedOverlayRow} with no package, so it
     * bound whichever of the item's rows `findOne` returned first, while a
     * read naming a package (`?package=`, ADR-0048) reported that package's
     * row. Now the limb hands {@link overlayLockLayerAt} the item's address,
     * the request's `packageId` included where the door carries one (save,
     * publish), and the reads hand it theirs. Both get the strictest lock
     * among the item's rows in scope, whichever package each is bound to:
     * every row this limb could bind before, so a write it refused under some
     * row order is refused under every one, and the reads report that lock.
     * Canonical spelling only (#4432, the one declared difference, stated on
     * {@link overlayLockLayerAt}).
     *
     * ## [#21803] The artifact limb and the reads take every shipping package
     *
     * The artifact limb used to look the artifact up with no package, so with
     * two installed packages shipping one name (ADR-0048 §3.4) it bound the
     * first package registered, while a read naming a package reported that
     * package's artifact. Now the limb hands {@link artifactLockLayerAt} the
     * write's address and the reads hand it theirs; the resolution reads the
     * layers once per shipping package and binds the strictest answer
     * ({@link resolveItemLock}). The package-less artifact this limb bound
     * before is always one of them, so no write it refused under some
     * registration order is admitted under any. The overlay rows are read only
     * when a shipping package's own artifact declares no lock, or none ships
     * the name ({@link resolveItemLockLazily}).
     *
     * `'none'` is a VERDICT, not a default: both callers turn it into
     * "allow". So it is returned only when the absence of a lock was
     * actually established. When the overlay row cannot be read this
     * method THROWS (#5706) rather than answering "unlocked" — see the
     * `catch` below and {@link rethrowUnlessMetadataStoreUnprovisioned}.
     *
     * @throws {@link markedApplicationRefusalError} — [#12536] FIRST, when the
     *         failure carried a producer's `userMessage` mark (commit 79c46da90): an
     *         application refusal in the author's own words, classified at the
     *         producer and NOT the 503 below. See {@link
     *         metadataReadFailureError}.
     * @throws {@link metadataStoreUnavailableError} — 503 /
     *         `SERVICE_UNAVAILABLE`, when the lock state could not be
     *         determined. The one non-throwing failure is an
     *         unprovisioned `sys_metadata`, where "no overlay row" is
     *         the truth rather than an unknown.
     *
     * ## [#9009] The type key is FOLDED HERE, not trusted from the caller
     *
     * This method used to hand `type` to its two limbs verbatim, and the two
     * limbs do not read it the same way — which is the whole defect:
     *
     *  - the ARTIFACT limb folds. {@link lookupArtifactItem} resolves
     *    `PLURAL_TO_SINGULAR[type] ?? type` and then tries the raw spelling as
     *    a second lookup, so a plural found the packaged `_lock` anyway.
     *  - the OVERLAY limb did not. It queried `sys_metadata` with the raw
     *    `type`, and `SysMetadataRepository.whereFor` emits the canonical
     *    spelling with no at-rest fallback — so the stored ACTIVE row exists
     *    under a `type` the query never asks for. `findOne` misses, and the
     *    method falls through to `'none'`: not a neutral value but the verdict
     *    "the author declared no protection" (#5706), which
     *    `evaluateLockForWrite` / `evaluateLockForDelete` turn into "allow".
     *
     * So an ADR-0010 `_lock` was addressable AROUND from the wire by spelling
     * the type differently, and the gate answered "unlocked" with complete
     * confidence. #8769 (publish) and #8819 (rollback) each closed that at ONE
     * entry point by folding the request; this closes it at the producer of the
     * verdict, so the class cannot be re-opened by the next caller that arrives
     * without a fold. Contract-first (Prime Directive #12) — and the fold is
     * the right shape HERE rather than an assert, because this is the one
     * consumer whose silent wrong answer disarms a protection gate: folding can
     * only ever find MORE locks, never fewer.
     *
     * {@link canonicalMetaType}, deliberately, and not `PLURAL_TO_SINGULAR` —
     * the manifest-collection map omits `field`, `seed`, `external_catalog` and
     * `translation`, which is exactly the "tolerant AND INCOMPLETE" fold
     * {@link recordMetadataAudit}'s header rejects: it would canonicalize the
     * types that never needed it and leave the four that do.
     *
     * ⛔ This changes NOTHING for any caller reachable today, and that was
     * measured rather than assumed before it was written: every path into the
     * gate — `saveMetaItem`, `deleteMetaItem`, `rollbackMetaItem`,
     * `publishMetaItem` and `publishPackageDrafts` (via
     * `promoteDraftForPublish`) — folds its own request first, so `canonical`
     * is `type` at every live site and both limbs already agreed. What the fold
     * removes is the unstated "callers must fold" invariant that had already
     * cost this family several cards.
     *
     * ⚠️ It does NOT fold the type the REFUSAL and its audit row are reported
     * under; those still carry the caller's spelling on purpose. An unfolded
     * caller that now correctly finds a lock therefore meets
     * {@link recordMetadataAudit}'s `AUDIT_TYPE_NOT_CANONICAL` assert (#8908)
     * and fails LOUDLY at 500 instead of silently allowing the write. That is
     * the fail-closed direction and the assert doing its job — not a hole to
     * paper over here by folding the ledger key too.
     */
    private getEffectiveLock(
        type: string,
        name: string,
        packageId?: string,
    ): Promise<{
        lock: MetadataLock;
        lockReason: string | undefined;
        lockSource: 'artifact' | 'overlay' | undefined;
    }> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof getEffectiveLock> = {
            artifactLockLayerAt: (...a) => this.artifactLockLayerAt(...a),
            readLockGateOverlayLayer: (...a) => this.readLockGateOverlayLayer(...a),
        };
        return getEffectiveLock.call(host, type, name, packageId);
    }

    /**
     * [#21738] The `_lock` gate's `overlay` layer for {@link getEffectiveLock}:
     * [#21761] the lock document {@link overlayLockLayerAt} selects from the
     * write's address, or `undefined` when no row in scope declares a lock (or
     * `sys_metadata` is not provisioned yet). Throws when the rows cannot be
     * read (#5706).
     */
    private readLockGateOverlayLayer(
        canonicalType: string,
        name: string,
        packageId: string | undefined,
    ): Promise<unknown> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof readLockGateOverlayLayer> = {
            overlayLockLayerAt: (...a) => this.overlayLockLayerAt(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
        };
        return readLockGateOverlayLayer.call(host, canonicalType, name, packageId);
    }

    /**
     * Best-effort audit-row writer (ADR-0010 §3.6). Failures here are
     * logged but never block the underlying decision: an environment
     * without the audit table provisioned (legacy installs before this
     * ADR landed) still answers normal API calls, just without the
     * compliance trail. Phase 2 will make the audit table a hard
     * dependency.
     *
     * ## [#8908] `type` is an ASSERTED input, not a tolerated one
     *
     * This method used to open with
     *
     *     type: PLURAL_TO_SINGULAR[entry.type] ?? entry.type,
     *
     * — a silent fold that made every call site free to hand the compliance
     * ledger whatever spelling it happened to hold. Two things were wrong with
     * it, and the second is why it could not simply stay:
     *
     *  - **Lenient consumer.** Contract-first (Prime Directive #12) puts the
     *    fold at the producer. A writer that repairs its callers' keys is the
     *    same shape `canonicalMetaType`'s header has rejected since #4432, one
     *    table over.
     *  - **Tolerant AND INCOMPLETE.** The fold read the MANIFEST-collection map,
     *    which omits the types that are not stack collections. So the trail was
     *    canonicalized for the 29 types that never needed it and left
     *    non-canonical for exactly the ones that did — the ledger recording a
     *    second namespace for the items most likely to be in one.
     *
     * Ruled on #8908 (auto-adjudicated 2026-08-15, with the promote refusal, as
     * ONE card): fold at the boundary, assert here. The four call sites that
     * build a row out of an AT-REST `type` — all of them on
     * `publishPackageDrafts` — now fold with {@link canonicalMetaType}; the
     * `/meta` routes were already canonical by the time they got here
     * ({@link canonicalizeMetaRequestType}, applied at every entry point).
     *
     * ⛔ The refusal is a THROW and is deliberately OUTSIDE the `try` below.
     * Inside it, the method's own best-effort `catch` would swallow it into a
     * `console.warn` — which is precisely the "soften the assert to a warn"
     * the ruling forbids, reached by accident rather than by decision.
     *
     * What it does NOT refuse, by construction: a canonical type (no canonical
     * spelling folds elsewhere), and a plugin-registered or otherwise
     * unrecognised kind (`canonicalMetaType` is the identity for anything the
     * static map does not carry, so a kind the platform has not heard of can
     * never be refused by this gate — the same positive-control-by-construction
     * `metaUrlSpellingRefusal` is built on).
     */
    private recordMetadataAudit(entry: MetadataAuditEntry): Promise<void> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof recordMetadataAudit> = {
            get engine() { return readEngine(); },
        };
        return recordMetadataAudit.call(host, entry);
    }

    /**
     * [#8594] The ADR-0010 L3 write verdict as a VALUE: the structured `Error`
     * a refused caller should throw, PLUS the denial row that refusal owes —
     * and it writes NOTHING itself. Null on allow.
     *
     * Split out of {@link assertLockAllowsWrite} (which is now this plus the
     * write) for the one caller that cannot let the row be written where the
     * verdict is reached: `promoteDraftForPublish` runs inside a batch
     * transaction on one of its two routes, so a row written here would roll
     * back with the batch its own refusal aborted. Callers that are not inside
     * a transaction keep using `assertLockAllowsWrite` unchanged — this is an
     * extraction, not a behaviour change, and `save` / `rollback` still get
     * their row from the same expression they always did.
     *
     * ## [#21694] Topology-INDEPENDENT, like the package door
     *
     * This gate, and {@link assertLockAllowsDelete} beside it, used to open
     * with `if (this.environmentId === undefined) return null;`. No ADR
     * records that carve-out: ADR-0010 §3.3 states the lock table with no
     * topology column, and the only reason ever written down was the title of
     * the test that pinned it ("control-plane bootstrap"). That is the
     * inference #6710 refuted (see {@link MetadataAuthoringChannel}):
     * `environmentId` is a row-scoping key, and the CLI's host-config
     * assembler — the showcase's own boot shape — leaves it undefined while it
     * serves an end-user `PUT /api/v1/meta/*`. So a host-config kernel
     * admitted every save, publish, rollback and delete of a `_lock`ed item,
     * while both reads ({@link servedLockState}) reported it locked: the door
     * looser than the read, on the topology the flagship app boots.
     *
     * The gate now answers alike on every kernel, as {@link
     * packagedBaseRefusal} does. Where it sits relative to that package door
     * is each caller's ordering, and it is the same on every topology: see the
     * `saveMetaItem` and `deleteMetaItem` call sites.
     */
    private lockWriteRefusal(args: {
        type: string;
        name: string;
        /**
         * [#21761] The package the write names (ADR-0048 `?package=`), part of
         * the item's address the gate selects the rows in scope from. It never
         * narrows those rows; it picks whose prose a refusal carries when
         * several rows declare the strictest lock, as it does on the reads.
         */
        packageId?: string;
        operation: 'save' | 'publish' | 'rollback';
        actor?: string;
        source?: string;
        requestId?: string;
    }): Promise<{ err: Error; audit: MetadataAuditEntry } | null> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof lockWriteRefusal> = {
            getEffectiveLock: (...a) => this.getEffectiveLock(...a),
        };
        return lockWriteRefusal.call(host, args);
    }

    /**
     * Phase 1 L3 enforcement for write operations (save / publish /
     * rollback). Returns null on allow. Returns the structured `Error`
     * the caller should `throw` on deny — also records the denial in
     * the audit log so refused attempts are visible in compliance
     * reports (refused writes never reach sys_metadata_history).
     *
     * ⚠️ Records the row WHERE IT STANDS, so only call it from a site that is
     * not inside a transaction it could be rolled back by. From inside one, use
     * {@link lockWriteRefusal} and hand the row to the caller that owns the
     * transaction (see `promoteDraftForPublish`).
     */
    private assertLockAllowsWrite(args: {
        type: string;
        name: string;
        /** [#21761] See {@link lockWriteRefusal}. */
        packageId?: string;
        operation: 'save' | 'publish' | 'rollback';
        actor?: string;
        source?: string;
        requestId?: string;
    }): Promise<Error | null> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof assertLockAllowsWrite> = {
            lockWriteRefusal: (...a) => this.lockWriteRefusal(...a),
            recordMetadataAudit: (...a) => this.recordMetadataAudit(...a),
        };
        return assertLockAllowsWrite.call(host, args);
    }

    /**
     * Counterpart of {@link assertLockAllowsWrite} for delete. [#21694]
     * Topology-independent for the same reason — see {@link lockWriteRefusal}.
     */
    private assertLockAllowsDelete(args: {
        type: string;
        name: string;
        /**
         * [#23297] The package the delete names (ADR-0048 `?package=`), handed
         * to the gate as the save's is ({@link lockWriteRefusal}): part of the
         * item's address. It never narrows the rows or the shipping packages
         * the lock is resolved over (#21761, #21803: the strictest of them
         * binds, so a delete naming a package is refused whenever the save
         * naming it is); it picks whose prose the refusal carries.
         */
        packageId?: string;
        actor?: string;
        source?: string;
        requestId?: string;
    }): Promise<Error | null> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof assertLockAllowsDelete> = {
            getEffectiveLock: (...a) => this.getEffectiveLock(...a),
            recordMetadataAudit: (...a) => this.recordMetadataAudit(...a),
        };
        return assertLockAllowsDelete.call(host, args);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.recordOptimisticConflictAudit} in `protocol-write-gates.ts` [#29985 codemod]. */
    private async recordOptimisticConflictAudit(args: {
        type: string;
        name: string;
        operation: 'save' | 'publish' | 'rollback' | 'delete';
        actor?: string;
        source: string;
        requestId?: string;
        expectedParent?: unknown;
        actualHead?: unknown;
    }): Promise<void> {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolWriteGatesFacet.recordOptimisticConflictAudit(protocolHost(this), args);
    }

    // -----------------------------------------------------------------------
    // [#21207] The stored content hash, as the `/meta` doors serve and take it
    // -----------------------------------------------------------------------
    //
    // Maintainer ruling B on #21207: the stored content hash of a metadata body
    // stays the canonical SHA-256 at rest — the repository contract, its
    // producers and the parent links are untouched — but no door hands it out.
    // It is a hash over the WHOLE stored body, withheld credential material
    // included, so beside the projected body it confirms a guess at that
    // material offline. Every door that serves it serves a keyed digest of it
    // (the crypto provider's, or with none registered a process-scoped
    // ephemeral key's); every door that takes a version token back compares the
    // token in that same form and hands the STORED value to the repository.

    /**
     * The keyed digest the doors serve and compare under: the registered crypto
     * provider's, read from the engine at the moment of use — a host registers
     * the provider AFTER the kernel starts, so a value read once at
     * construction would answer "none" for good — and, while none is registered
     * (or the host engine has no such accessor), {@link ephemeralStoredHashDigest}.
     *
     * ⛔ Never `undefined`: a door with no key would serve no token, every
     * caller would then hold the same empty one, and a client that sends no pin
     * for an empty token would turn every pinned write into an unpinned one —
     * the optimistic lock failing OPEN.
     */
    private storedHashDigest(): StoredHashDigest {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof storedHashDigest> = {
            get engine() { return readEngine(); },
        };
        return storedHashDigest.call(host);
    }

    /**
     * A write receipt's `version` — the version token a caller sends back as
     * `If-Match` — for a write whose stored content hash is `stored`: its keyed
     * digest ({@link storedHashDigest}). Never empty, never the stored value.
     */
    private receiptVersion(stored: string): Promise<string> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof receiptVersion> = {
            storedHashDigest: (...a) => this.storedHashDigest(...a),
        };
        return receiptVersion.call(host, stored);
    }

    /**
     * [#22114] The stored head a `/meta` save at one address compares a
     * caller's version token against: the `state` row at `ref`'s organization
     * partition that a save naming `packageId` (`null` = no package) upserts,
     * as the repository serves it. `null` when that save would create.
     *
     * The ONE head read both halves of the ADR-0008 chain make. The save door
     * takes its expected parent from it — the inbound token judged against it
     * ({@link storedParentForToken}), or, unpinned, the head itself — and the
     * item read serves its keyed form as `version` ({@link readVersionToken}).
     * So the token a read hands out is the token a save at the same address
     * accepts, and the one a receipt serves for that row — ⛔ never a second
     * derivation of either.
     *
     * [#22128] Resolved by the repository's own write-address resolution
     * ({@link SysMetadataRepository.headAt}), the one its lock judges with —
     * ⛔ never {@link SysMetadataRepository.get} at the named key. A draft
     * save that names no package is stored in the package of the item's
     * active row (#11087), so the row at the package-unbound key is not the
     * row that save overwrites: read there, the parent of an existing draft
     * was `null`, the repository's lock refused the unpinned save 409, and the
     * `?state=draft` read served `version: null` while the draft existed.
     */
    private storedHeadAt(
        repo: SysMetadataRepository,
        ref: Parameters<SysMetadataRepository['headAt']>[0],
        state: 'active' | 'draft',
        packageId: string | null,
        /**
         * [#22877] The bundle member the save addresses (its body's); omitted,
         * the canonical member — what a by-name read addresses today.
         */
        member?: string,
    ): Promise<string | null> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        return storedHeadAt(repo, ref, state, packageId, member);
    }

    /**
     * [#22114] The item read's `version`: the keyed form
     * ({@link receiptVersion}) of the stored head a save to this item compares
     * against ({@link storedHeadAt}), at the read's own scope — the
     * environment's partition and `packageId` — and its lifecycle, or `null`
     * when no stored row is there. The `/meta` save door builds its address
     * from the same facts (no organization on either since ADR-0131 D6, and
     * `?package=` names the binding on both), so a read followed by a save with the served token is accepted, and a
     * `null` says that save is a create: the state `If-None-Match: *` asserts.
     *
     * ⚠️ The address of the SAVE, not of the served content. A read falls back
     * from a package's own row to the package-less one (ADR-0048); a save
     * does not, it writes its own partition. A token of a row the save would
     * not overwrite would be refused by that save every time, so such a read
     * serves `null` rather than the served row's token. [#22128] And the
     * other way round: a `?state=draft` read that names no package serves the
     * token of the draft a package-less draft save overwrites, which is the
     * draft bound to the package of the item's active row when there is one
     * (#11087) — the address the save resolves, not the key it was handed.
     * [#23165] The active read that names no package likewise serves the token
     * of the row a direct save (or a delete) naming none writes: the one
     * package's row the item is bound to ({@link packagelessAddress}). For an
     * item several packages hold, that save and that delete are refused
     * whatever they carry, and the token stays the package-unbound row's.
     */
    private readVersionToken(
        /** [#22877] `member` — the bundle member the read addressed; omitted, the canonical one. */
        request: { type: string; name: string; packageId?: string; member?: string },
        state: 'active' | 'draft',
        /**
         * [#24371] The item's package-less binding ({@link packagelessAddress}
         * at `active`) when the caller has already resolved it; omitted, it is
         * read here.
         */
        packagelessPackageId?: string | null,
    ): Promise<string | null> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof readVersionToken> = {
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            packagelessAddress: (...a) => this.packagelessAddress(...a),
            receiptVersion: (...a) => this.receiptVersion(...a),
            storedHeadAt: (...a) => this.storedHeadAt(...a),
        };
        return readVersionToken.call(host, request, state, packagelessPackageId);
    }

    /**
     * [#23291, ADR-0048 §3.3] The package a by-name read that names no package
     * takes its stored CONTENT from: the item's own package when its active
     * rows are bound to exactly one ({@link packagelessAddress}, the address
     * the save, the delete and the read's `version` resolve), else
     * `undefined`, any row (the best-effort first match). {@link getMetaItem}
     * and {@link getMetaItemLayered} both ask it, so the plain read, the
     * layered read's `effective` and `/published` serve one row. [#23715] The
     * strict draft read asks {@link strictDraftReadAddress} instead: the draft
     * its `version` names.
     *
     * [#28238] The code packages that ship the name are candidates too
     * ({@link packagelessContentPackage}, the rule {@link getMetaItem} applies
     * to the rows it already read): a row bound to another package is not
     * served for a name one code package ships, and `null` is the
     * package-unbound row alone. The write address does not move.
     */
    private packagelessReadAddress(type: string, name: string, member?: string): Promise<string | null | undefined> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof packagelessReadAddress> = {
            packagelessAddress: (...a) => this.packagelessAddress(...a),
            shippedArtifactsOf: (...a) => this.shippedArtifactsOf(...a),
        };
        return packagelessReadAddress.call(host, type, name, member);
    }

    /**
     * [#23715, ADR-0048, ADR-0070 TL;DR 1] The package the strict draft read
     * that names no package (`?state=draft`), and the draft-overlay preview
     * naming none (`previewDrafts`), take their draft CONTENT from: the draft
     * its `version` names ({@link readVersionToken}, through
     * `SysMetadataRepository.headAt`), which is the draft
     * {@link packagelessDraftAddress} gives the draft save, the per-item
     * publish and the draft discard naming none. `packageId` is that draft's
     * binding, `null` for the package-unbound draft alone.
     *
     * An `ambiguous` address (two or more packages, refused by those doors)
     * keeps what the read served before: the package-unbound draft, the row
     * `headAt` answers there, else (`bestEffort`) the first draft row of any
     * package, the best-effort first match ADR-0048 §3.3 states, served with
     * `version: null`.
     *
     * Before, the read took its content from the item's ACTIVE rows
     * ({@link packagelessReadAddress}). Over an item never published into a
     * package those name no package, so the content was the first draft row
     * a package-agnostic lookup returned (#8907) while the `version` was the
     * package-unbound draft's.
     */
    private strictDraftReadAddress(
        type: string,
        name: string,
        member?: string,
    ): Promise<{ packageId: string | null; bestEffort: boolean }> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof strictDraftReadAddress> = {
            packagelessDraftAddress: (...a) => this.packagelessDraftAddress(...a),
        };
        return strictDraftReadAddress.call(host, type, name, member);
    }

    /**
     * [#23165, ADR-0048] THE package-less write address: which row of an item a
     * write that names no package addresses, read from the item's stored rows
     * at `state`. The item's own package when those rows are bound to exactly
     * one, else the package-unbound row. `candidates` is every distinct
     * binding, sorted; two or more is a name several packages hold, which the
     * doors refuse ({@link packagelessAddressAmbiguityRefusal}) and for which
     * `packageId` is `null`. `unbound` says whether a package-unbound row sits
     * beside them, which is what a delete of a package's row leaves served.
     *
     * The one resolution its three readers take, so they cannot disagree:
     * {@link saveMetaItem}'s direct (active) save, which then writes as a save
     * naming that package does; {@link deleteMetaItem}, which then removes as a
     * delete naming that package does; and {@link readVersionToken}, whose
     * `version` a save or a delete at the same address accepts. [#23495] The
     * draft doors' address is {@link packagelessDraftAddress}, which reads it
     * at both states: the draft discard used to read it from the draft rows
     * alone, so it removed another package's draft than the one the draft
     * save writes.
     *
     * Why the package's row: a write addresses exactly one
     * `(org, type, name, package_id)` row, and the item read that names no
     * package serves the package's row whenever it is the item's only row. A
     * save that wrote the package-unbound row instead minted a second row
     * beside it and answered `200` for a write that read never served; a
     * delete that took the first row a package-agnostic `findOne` met removed
     * one package's row of an item two packages hold, or the package-less row
     * beside a package's, and claimed the item gone. The draft save has
     * resolved its address from the item's active row since #11087
     * (`SysMetadataRepository.resolveWriteHead`, which [#23297] reads every
     * active row and refuses two packages' with the same refusal); the direct
     * save and the delete did not, and this is that half.
     *
     * The rows are the ones the item read chooses among
     * ({@link findServedOverlayRow}): the environment's (ADR-0131 D6), the
     * state the write addresses, the canonical type, the bundle member
     * (#22877), and no package predicate. They are read in full, never
     * sampled: with two packages' rows at one address a package-agnostic
     * `findOne` is a driver-order coin toss (#8907). A package-less row beside
     * the package's row is not a second package, and stays as it is (no
     * conversion: the card's existing-rows line). An item with no binding
     * keeps the package-unbound row, as before. An unprovisioned store holds
     * no row; any other failed read propagates (#5532), because guessing the
     * binding would choose the row the write lands in.
     *
     * ⛔ Not the repository's write-address default: `put`, `headAt` and
     * `delete` keep their documented ones (omitted = the package-unbound row
     * for `put`/`headAt`, any row for `delete`), because the callers that reach
     * them with no package (`promoteDraft` and `restoreVersion` of a
     * package-less row) mean that row, as do the server-stated rewrites the
     * save door does not resolve for. The doors resolve, then name the
     * package.
     */
    private async packagelessAddress(
        type: string,
        name: string,
        /** [#22877] The bundle member the write addresses (a save's body's, a delete's selector); omitted, the canonical one. */
        member?: string,
        state: 'active' | 'draft' = 'active',
        /** [#24371] The item's active rows as {@link readItemActiveRows} read them: selected from, not read again. */
        activeRows?: readonly StoredOverlayRow[],
    ): Promise<{ packageId: string | null; candidates: readonly string[]; unbound: boolean }> {
        // [#25467 cut 35] The body moved to `protocol-environment-rows.ts` (see `EnvironmentRowsHost`).
        const host: ThisParameterType<typeof packagelessAddress> = {
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
        };
        return packagelessAddress.call(host, type, name, member, state, activeRows);
    }

    /**
     * [#23495, ADR-0048, ADR-0070 TL;DR 1] THE package-less DRAFT address:
     * which draft of an item a draft door that names no package acts on. The
     * per-item publish ({@link promoteDraftForPublish}) and the draft discard
     * ({@link deleteMetaItem} with `state: 'draft'`) take it, so they act on
     * the draft the draft save naming no package writes (#11087,
     * `SysMetadataRepository.resolveWriteHead`) and the strict draft read
     * naming no package serves ([#23715] {@link strictDraftReadAddress}).
     *
     * The address is the draft save's, read from the item's ACTIVE rows
     * ({@link packagelessAddress}):
     *
     *  - bound to one package `P`: `P`'s draft, else the package-unbound draft,
     *    which the draft save adopts into `P` on its next write and the read
     *    serves in `P`'s place (ADR-0048 prefer-local). A publish promotes such
     *    a draft INTO `P` (`into`), the row the read naming no package serves
     *    next. Neither present: no draft (`none`), whatever other packages'
     *    drafts are stored; the strict draft read answers `404 NO_DRAFT` here
     *    too, and those drafts are addressed by naming their package.
     *  - bound to two or more packages: `ambiguous`, refused by both doors
     *    with the refusal the draft save answers
     *    ({@link packagelessAddressAmbiguityRefusal}, `409 RESOURCE_CONFLICT`).
     *  - bound to none (an item never published into a package): the
     *    package-unbound draft. With no such draft, the one package's draft
     *    when exactly one package holds a draft (the only draft the read
     *    naming no package can serve); two or more is `ambiguous`; none at
     *    all is `none`. [#23657] The draft save naming no package writes the
     *    same draft and is refused the same way: one rule,
     *    {@link unboundItemDraftAddress}, which `resolveWriteHead` asks too.
     *
     * Every row is read in full, never sampled: a package-agnostic `findOne`
     * over two drafts is a driver-order coin toss (#8907). The per-item publish
     * took the first draft row that `findOne` met, and the discard read the
     * draft rows alone. Over an item bound to `P` both acted on another
     * package's draft than the one the save writes, and the publish could
     * promote a package-unbound draft into an active row no read naming no
     * package serves.
     *
     * `key` is the stored binding of the draft row acted on (`null` for the
     * package-unbound draft), `into` the package its promotion is written
     * under, and `drafts` the bindings of every draft row of the item, which
     * the doors' receipts name.
     */
    private packagelessDraftAddress(
        type: string,
        name: string,
        /** [#22877] The bundle member the door addresses; omitted, the canonical one. */
        member?: string,
    ): Promise<
        | { kind: 'ambiguous'; candidates: readonly string[] }
        | {
            kind: 'draft' | 'none';
            key: string | null;
            into: string | null;
            drafts: { packageId: string | null; candidates: readonly string[]; unbound: boolean };
        }
    > {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof packagelessDraftAddress> = {
            packagelessAddress: (...a) => this.packagelessAddress(...a),
        };
        return packagelessDraftAddress.call(host, type, name, member);
    }

    /**
     * Resolve a caller's version token to the STORED head it names, for a write
     * whose current stored head is `currentStored`: the token must equal the
     * keyed digest of that head, and the stored value is what the repository's
     * own optimistic lock then compares. `null` keeps its meaning ("expect no
     * row") and carries no hash. Anything else — the raw stored hash a pre-keying
     * client still holds, a stale token, an empty or withheld token, a token
     * keyed before a restart or before a provider was registered — is an
     * {@link InboundVersionConflictError}, which the door's conflict branch
     * answers 409. ⛔ A sent token is never read as "no pin".
     */
    private storedParentForToken(
        ref: { org: string; type: string; name: string },
        token: string | null,
        currentStored: string | null,
    ): Promise<string | null> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof storedParentForToken> = {
            storedHashDigest: (...a) => this.storedHashDigest(...a),
        };
        return storedParentForToken.call(host, ref, token, currentStored);
    }

    /**
     * The 409 `METADATA_CONFLICT` a door answers for a `ConflictError`, whose
     * text and attributes carry the SERVED (keyed) form of a stored hash or
     * none at all — never a stored hash. `subject` names the item, `prefix` is
     * the door's own first sentence.
     *
     *  - a repository race (the stored head moved between the door's read and
     *    its write): `Expected parent X but current is Y`, both keyed;
     *  - a caller's token naming no current head: the keyed current head.
     *
     * A side with no served form is `(withheld)`; an absent side is `null`.
     *
     * [#22114] The current side also rides as DATA, `currentVersion`: the
     * value the sentence names (the keyed head, or `null` when no row is
     * there), which the REST door serializes beside the sentence
     * (`MetadataConflictErrorSchema` in `@objectstack/spec`). For the save
     * door it is the version the next item read at the same address serves
     * ({@link readVersionToken}), so a client re-pins from the refusal without
     * parsing prose. A head with no served form sets neither attribute.
     *
     * [#23406] `firstWritePin` — the lifecycle a save's first-write pin (a
     * present `null` parent, `If-None-Match: *` on the REST door) asserted had
     * no row. That caller loaded nothing, so "modified since you loaded it"
     * and "Expected parent null" misstate what it did; when the repository
     * judged that `null` parent, the sentence states the assertion and the row
     * that contradicts it instead. The code, the status and every attribute
     * are the same as for any other conflict.
     */
    private metadataConflictRefusal(
        err: ConflictError,
        subject: string,
        prefix: string,
        firstWritePin?: 'draft' | 'active',
    ): Promise<Error> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof metadataConflictRefusal> = {
            storedHashDigest: (...a) => this.storedHashDigest(...a),
        };
        return metadataConflictRefusal.call(host, err, subject, prefix, firstWritePin);
    }

    /** Docblock and body: {@link ProtocolWriteGatesFacet.optimisticConflictAuditEntry} in `protocol-write-gates.ts` [#29985 codemod]. */
    private static optimisticConflictAuditEntry(args: {
        type: string;
        name: string;
        operation: 'save' | 'publish' | 'rollback' | 'delete';
        actor?: string;
        source: string;
        requestId?: string;
        expectedParent?: unknown;
        actualHead?: unknown;
    }): MetadataAuditEntry {
        // [#29985 codemod] The body moved to `protocol-write-gates.ts`; it reads nothing of this class.
        return ProtocolWriteGatesFacet.optimisticConflictAuditEntry(args);
    }

    /**
     * [#8594] Write the denial row a refusal is still carrying — on the
     * CALLER's side of the caller's transaction.
     *
     * The counterpart of {@link withPendingAudit}: `promoteDraftForPublish`
     * attaches the row to the error it throws instead of writing it, and each
     * of its two callers records it from a position where a rollback cannot
     * reach it. A no-op for every other refusal (the driver faults,
     * `NOT_OVERRIDABLE`, `INVALID_METADATA` …), which carry no row and never
     * did — this closes the two denials that USED to write one and lose it, and
     * mints nothing new.
     *
     * `source` is overridable because the row is now written by the route that
     * owns it: the batch route must not file its rows under
     * `protocol.publishMetaItem`, which is the name the shared Phase-1 helper
     * passes for both of them.
     */
    private recordPendingDenialAudit(
        err: unknown,
        overrides?: { source?: string },
    ): Promise<void> {
        // [#25467 cut 5] The body moved to `protocol-lock-version-gates.ts` (see `LockVersionGateHost`).
        const host: ThisParameterType<typeof recordPendingDenialAudit> = {
            recordMetadataAudit: (...a) => this.recordMetadataAudit(...a),
        };
        return recordPendingDenialAudit.call(host, err, overrides);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.applyObjectRegistryMutation} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private async applyObjectRegistryMutation(request: { type: string; name: string; item?: any; packageId?: string | null }): Promise<void> {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.applyObjectRegistryMutation(protocolHost(this), request);
    }

    /**
     * [ADR-0029 D9.8/D9.9] Which contributor KIND a `sys_metadata` object row
     * registers as — and whether it may register at all.
     *
     * ```
     * packaged `own` contributor already registered for this name?
     *   no  -> `own`      (a runtime-authored object; today's behaviour, keyed
     *                      by the row's package_id or the sentinel)
     *   yes -> `overlay`  (a tenant layer over the code definition)
     * ```
     *
     * Every row this classifies came out of `sys_metadata` and is therefore
     * tenant-authored by definition, which is why the question is only about
     * the OTHER side: a runtime-authored object's owner IS the tenant's own
     * row, and re-writing it stays an ordinary re-registration rather than
     * becoming a layer over itself.
     *
     * The row's `package_id` (`P`) is provenance ON the layer, never an
     * ownership claim (D9.9), so against the packaged owner's id `O`:
     *
     * | case | verdict |
     * |:--|:--|
     * | `P == O` | the normal case — one overlay layer over `O`'s object. |
     * | `P` empty / absent (the `'sys_metadata'` sentinel) | **accepted** — a package-less env-wide overlay is ADR-0005's platform-global shape. Before D9 this THREW `already owned by package "O"`, an artefact of the borrowed `own` slot rather than a decision (#6995, measured as P2). |
     * | `P == Q`, some other package | **mismatch** — refused loudly. |
     *
     * ## [#23416] …and against a RUNTIME-authored owner's id `R`
     *
     * With no packaged owner, the object may still have an owner: the `own`
     * contributor a package's `sys_metadata` row registered (the write-through
     * or the boot hydration). That is the contributor `registerObject`'s
     * single-owner rule compares an incoming `own` claim against, so a row
     * bound to a different package was written and then refused by the
     * registry into {@link applyObjectRegistryMutation}'s best-effort warn: the
     * save answered `200` while `sys_metadata` held a row the registry could
     * not hold, which is the disagreement {@link overlayPackageMismatchError}
     * exists to prevent. So the same mismatch arm answers it, judged on the
     * registry's own fact (`getObjectOwner`, keyed on the object name exactly as
     * `registerObject` keys its contributors), never on a guess:
     *
     * | case | verdict |
     * |:--|:--|
     * | `P == R` | `own` — the owner's re-save, an ordinary re-registration. |
     * | `P` empty / absent | `own`, unchanged — a direct save naming no package is addressed to `R`'s row before this runs ({@link packagelessAddress}). |
     * | `P == Q`, some other package | **mismatch** — refused loudly, the code owner's refusal and prescription. |
     *
     * ## [#23514] …and against an owner keyed by the `'sys_metadata'` sentinel
     *
     * A runtime object first saved naming no package is owned by that
     * package-less row, keyed by the sentinel. A save naming package `Q` beside
     * it was classified `own` and written, and the write-through's
     * `registerObject(…, Q, …, 'own')` met the registry's single-owner rule and
     * landed in the best-effort warn: the save answered `200`, the metadata
     * read served `Q`'s row, and the registry and the data plane kept the
     * package-less definition, before and after a boot. So the sentinel owner
     * takes the same `mismatch` verdict, with the sentinel as `ownerPackageId`;
     * {@link overlayPackageMismatchError} gives it its own prescription, since
     * "bind it to `'sys_metadata'`" names no package (ADR-0070 TL;DR 1: the
     * package-less state is no authoring destination).
     *
     * | case | verdict |
     * |:--|:--|
     * | `P` empty / absent | `own`, unchanged — the package-less row's own re-save. |
     * | `P == Q`, any package | **mismatch** — refused loudly, with the move-into-a-package prescription. |
     *
     * An object with no owner at all is left to the `own` verdict.
     *
     * Falls back to `'own'` — today's behaviour — for a registry that does not
     * offer the discriminator, so a duck-typed engine double is never made to
     * fail by a question it cannot answer.
     */
    private classifyObjectContribution(
        name: string,
        rowPackageId: string | null | undefined,
    ):
        | { kind: 'own' | 'overlay'; packageId: string }
        | { kind: 'mismatch'; packageId: string; ownerPackageId: string } {
        // [#25467 cut 17] The body moved to `protocol-object-owner.ts` (see `ObjectOwnerHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof classifyObjectContribution> = {
            get engine() { return readEngine(); },
        };
        return classifyObjectContribution.call(host, name, rowPackageId);
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
    private static overlayPackageMismatchError(
        name: string, rowPackageId: string, ownerPackageId: string,
        /** [#23514] The state the refusal answers, for a `'sys_metadata'` sentinel owner only. */
        unboundOwnerState: UnboundOwnerRefusalState = {},
    ): Error {
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

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.unboundOwnerPackageRefusal} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private static unboundOwnerPackageRefusal(
        name: string, rowPackageId: string, state: UnboundOwnerRefusalState = {},
    ): Error {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reads nothing of this class.
        return ProtocolRegistryHydrationFacet.unboundOwnerPackageRefusal(name, rowPackageId, state);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.hydrateOverlayIntoRegistry} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private async hydrateOverlayIntoRegistry(
        type: string,
        data: unknown,
        options: HydrationOptions,
    ): Promise<boolean> {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.hydrateOverlayIntoRegistry(protocolHost(this), type, data, options);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.expandRuntimeViewContainer} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private expandRuntimeViewContainer(
        type: string,
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
        },
    ): Record<string, unknown>[] {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.expandRuntimeViewContainer(protocolHost(this), type, data, options);
    }

    /**
     * [#13407] The object a runtime view container binds: its own top-level
     * `object`, then `list.data.object`, `form.data.object`, and its own
     * `name`. See {@link expandRuntimeViewContainer}'s "Object-name
     * derivation".
     */
    private runtimeViewContainerObject(container: Record<string, any>): string | undefined {
        // [#25467 cut 33] The body moved to `protocol-registry-view-predicates.ts`; it reads no member.
        return runtimeViewContainerObject(container);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.shippedViewContainerOf} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private shippedViewContainerOf(
        type: string,
        name: unknown,
        packageId: string | undefined,
    ): Record<string, unknown> | undefined {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.shippedViewContainerOf(protocolHost(this), type, name, packageId);
    }

    /**
     * [#21980] True when `container`, bound to `object`, is a stored copy of a
     * container its own package ships: `ownPackageId` ships a view container
     * under the copy's name ({@link shippedViewContainerOf}), bound to the
     * same object. The loaders registered that container's views under
     * `<object>.<key>` for that package, so the copy's names are that
     * package's, and the copy expands to them.
     */
    private copiesOwnShippedViewContainer(
        type: string,
        object: string,
        container: Record<string, any>,
        ownPackageId: string | undefined,
    ): boolean {
        // [#25467 cut 33] The body moved to `protocol-registry-view-predicates.ts` (see `RegistryViewPredicatesHost`).
        const host: ThisParameterType<typeof copiesOwnShippedViewContainer> = {
            runtimeViewContainerObject: (...a) => this.runtimeViewContainerObject(...a),
            shippedViewContainerOf: (...a) => this.shippedViewContainerOf(...a),
        };
        return copiesOwnShippedViewContainer.call(host, type, object, container, ownPackageId);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.runtimeViewContainerPackage} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private runtimeViewContainerPackage(
        type: string,
        container: Record<string, any>,
        options: { packageId?: string | null },
    ): string | undefined {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.runtimeViewContainerPackage(protocolHost(this), type, container, options);
    }

    /**
     * [#21334] True when a code package owns `object` and it is not
     * `ownPackageId`. The discriminator is `getPackagedObjectOwner`, the same
     * "does a code package ship this?" test {@link classifyObjectContribution}
     * asks. A runtime-authored object has no packaged owner, so a container on
     * one keeps today's `<object>.<key>` names; so does a registry that cannot
     * answer.
     */
    private isAnotherPackagesObject(object: string, ownPackageId: string | undefined): boolean {
        // [#25467 cut 33] The body moved to `protocol-registry-view-predicates.ts` (see `RegistryViewPredicatesHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof isAnotherPackagesObject> = {
            get engine() { return readEngine(); },
        };
        return isAnotherPackagesObject.call(host, object, ownPackageId);
    }

    /**
     * [#21334] Expand a container on another package's object under its own
     * name: every such container but a stored copy of a container its own
     * package ships, which takes the loaders' names ([#21980],
     * {@link copiesOwnShippedViewContainer}). The spec's expander runs with `<object>.<container name>` as its
     * base, so every member it knows — today a named `list`, `listViews`,
     * `formViews`, `form` — comes out as `<object>.<container name>.<key>`,
     * de-duplicated by the spec's own rule, and a member kind the spec adds
     * later is placed the same way. Each item's `object` is set back to the
     * object it binds.
     *
     * The bare `list` is lent the container's name as its key, then served as
     * `<object>.<container name>` itself, its `config` the list as authored.
     * Where the owning package ships that very name (a container named after
     * one of that package's keys), it stays at the spelling the spec gave it,
     * `<object>.<container name>.<container name>`, so it never takes the
     * packaged view's name.
     *
     * A container with no name of its own has nothing to expand under, and
     * expands nothing.
     */
    private expandUnderOwnName(
        type: string,
        object: string,
        container: Record<string, any>,
        ownPackageId: string | undefined,
    ): Record<string, unknown>[] {
        // [#25467 cut 22] The body moved to `protocol-view-expansion-names.ts` (see `ViewExpansionNamesHost`).
        const host: ThisParameterType<typeof expandUnderOwnName> = {
            isShippedByAnotherPackage: (...a) => this.isShippedByAnotherPackage(...a),
        };
        return expandUnderOwnName.call(host, type, object, container, ownPackageId);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.isShippedByAnotherPackage} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private isShippedByAnotherPackage(type: string, name: string, ownPackageId: string | undefined): boolean {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.isShippedByAnotherPackage(protocolHost(this), type, name, ownPackageId);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.hydrateExpandedViewItems} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private async hydrateExpandedViewItems(
        type: string,
        data: unknown,
        options: HydrationOptions,
    ): Promise<void> {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.hydrateExpandedViewItems(protocolHost(this), type, data, options);
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
    private async reconcileViewExpansions(
        type: string,
        write: ViewContainerWrite,
        /** The write's own scope: `null` for an env-wide row. [#6780] */
        organizationId: string | null,
    ): Promise<void> {
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
     * [#23149, #23198] The names {@link reconcileViewExpansions} registered,
     * per registry, then per container name, then per stored row of that name
     * (its package binding, `''` for the package-less row). It is what a later
     * write of that row reconciles against, and what a reset heals. Only the
     * reconcile reads or writes it.
     *
     * The registry holds no link from an expanded item back to its container,
     * and the container row is gone by the time the heal runs. Expanding the
     * body again at reset time would also answer from registry state that may
     * have moved since the publish: a package installed in between changes
     * which names {@link anotherPackageShips} skips. So the heal reads this
     * record instead, and heals the names that were registered, no more.
     *
     * Keyed on the registry, not on the protocol instance, for the reason
     * `meta-overlay-cache.ts` keys its bucket on the engine: two protocol
     * instances over one registry share the entries they write. A `WeakMap`,
     * so the record lives as long as the registry and no longer.
     *
     * Per row, because one container name can have two stored rows (a
     * package-less row and a package-bound one, ADR-0048), and the list read
     * hydrates both on every call. Keyed on the name alone, each row's
     * hydration reconciled against the other row's set, so a list read
     * retired the members one row has and the other lacks. A view both rows
     * expand to, which one row drops, leaves the registry with that row; both
     * doors answer it from the other row's stored row, and the next list read
     * registers it again. A reset addresses every row of the name, because
     * its heal is handed no binding, and the row that remains is hydrated
     * again on the next list read.
     */
    private static readonly registeredViewExpansions =
        new WeakMap<object, Map<string, Map<string, ReadonlySet<string>>>>();

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.anotherPackageShips} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private anotherPackageShips(type: string, name: string, own: unknown, shipping?: ShippingPackages): boolean {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.anotherPackageShips(protocolHost(this), type, name, own, shipping);
    }

    /**
     * [#23298] Does this protocol's engine registry take the rows this kernel
     * stores? The ONE answer to the kernel-scope question both registry writes
     * ask: the write-through ({@link applyRegistryWriteThrough}) and the
     * delete's heal re-registering a baseline ({@link restoreArtifactRegistryView}).
     * One predicate, so a save and the reset after it cannot disagree about
     * whose registry it is.
     *
     *  - **An unscoped (control-plane) kernel: yes**, as always. Its rows are
     *    the ones its registry's unscoped callers read.
     *  - **An environment kernel that has hydrated its own store into the
     *    registry ({@link loadMetaFromDb}): yes.** That registry takes every
     *    body the store holds at each boot, so registering the body a write
     *    just made live registers nothing the next boot would not; it only
     *    stops the registry serving the boot-time body, or no body, until a
     *    rebuild.
     *    `ObjectQLPlugin.start()` calls `loadMetaFromDb` on an environment
     *    kernel only when the composition declares `hydrateMetadataFromDb`,
     *    whose stated precondition is that the kernel's registry is
     *    per-instance isolated and its `sys_metadata` lives on its own driver.
     *    The standalone stack declares it on every serving boot (`env_local`);
     *    a hosted tenant kernel that persists its own `sys_metadata` declares
     *    it too.
     *  - **Any other environment kernel: no.** Its store was never hydrated
     *    into its registry, which may be one it shares with unscoped callers,
     *    and a project-scoped row must never be registered there.
     *
     * ⛔ `environmentId` alone does not answer this. It says the kernel serves
     * one environment, not whose registry the protocol writes into, and reading
     * it as the answer left every hydrating environment kernel serving the
     * boot-time body of anything saved after boot — a narrowed permission
     * set's wider grant included.
     */
    private registryTakesStoredRows(): boolean {
        // [#25467 cut 33] The body moved to `protocol-registry-view-predicates.ts` (see `RegistryViewPredicatesHost`).
        const readEnvironmentId = () => this.environmentId;
        const readStoreHydratedIntoRegistry = () => this.storeHydratedIntoRegistry;
        const host: ThisParameterType<typeof registryTakesStoredRows> = {
            get environmentId() { return readEnvironmentId(); },
            get storeHydratedIntoRegistry() { return readStoreHydratedIntoRegistry(); },
        };
        return registryTakesStoredRows.call(host);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.applyRegistryWriteThrough} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private async applyRegistryWriteThrough(request: {
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
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.applyRegistryWriteThrough(protocolHost(this), request);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.restoreArtifactRegistryView} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private async restoreArtifactRegistryView(
        type: string,
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
        member?: string,
    ): Promise<void> {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.restoreArtifactRegistryView(protocolHost(this), type, name, organizationId, member);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.ensureObjectStorage} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private async ensureObjectStorage(type: string, name: string): Promise<RuntimeAuthoringIssue | undefined> {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.ensureObjectStorage(protocolHost(this), type, name);
    }

    /**
     * [#4636] The package binding of a persisted overlay row, read from the
     * row itself.
     *
     * The write paths that HAVE a `packageId` parameter (`saveMetaItem`, the
     * publish promotion) pass the caller's binding straight through — the same
     * value `SysMetadataRepository.put` stamps on the row, so key and row agree
     * by construction. `rollbackMetaItem` has no such parameter: it addresses a
     * row that already exists, and the row's own `package_id` is the only
     * authoritative answer to "who owns this".
     *
     * Mirrors the repository's own `whereFor(ref, 'active', undefined)`: no
     * package predicate (match any package), scoped by org + type + name +
     * state. Deliberately NOT a `findOne` on the repository — `MetadataItem`
     * projects the body, not the binding, and widening that shared type to
     * carry one field for one caller is a contract change PR1 does not need.
     *
     * Not caught: a metadata-store outage here means the ownership key would be
     * a guess, and every caller reads this BEFORE its write, so failing is
     * still failing closed.
     */
    private async resolveOverlayPackageBinding(
        type: string,
        name: string,
        /**
         * [#22877] The bundle member whose row's binding to read; omitted, the
         * canonical member. Nothing for a type with no members.
         */
        member?: string,
    ): Promise<string | null> {
        // [#25467 cut 33] The body moved to `protocol-stored-row-bindings.ts` (see `StoredRowBindingsHost`).
        const host: ThisParameterType<typeof resolveOverlayPackageBinding> = {
            findEnvironmentRow: (...a) => this.findEnvironmentRow(...a),
        };
        return resolveOverlayPackageBinding.call(host, type, name, member);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.dropObjectStorage} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private async dropObjectStorage(type: string, name: string): Promise<void> {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolRegistryHydrationFacet.dropObjectStorage(protocolHost(this), type, name);
    }

    /**
     * Guard for storage teardown on delete. Drops a physical table only when
     * the caller opted in AND it is safe: object types only (others have no
     * table), active state only (drafts were never materialised), and never a
     * `sys_`-prefixed platform table.
     */
    private shouldDropStorage(type: string, name: string, dropStorage: boolean | undefined, state: 'active' | 'draft'): boolean {
        // [#25467 cut 33] The body moved to `protocol-package-scope.ts`; it reads no member.
        return shouldDropStorage(type, name, dropStorage, state);
    }

    /** Docblock and body: {@link ProtocolRegistryHydrationFacet.dropStorageRemainingRowsRefusal} in `protocol-registry-hydration.ts` [#29985 codemod]. */
    private static dropStorageRemainingRowsRefusal(
        type: string,
        name: string,
        deletedPackage: string | null,
        remainingPackages: readonly string[],
        unboundRemains: boolean,
    ): Error & { code: 'RESOURCE_CONFLICT'; status: 409 } {
        // [#29985 codemod] The body moved to `protocol-registry-hydration.ts`; it reads nothing of this class.
        return ProtocolRegistryHydrationFacet.dropStorageRemainingRowsRefusal(type, name, deletedPackage, remainingPackages, unboundRemains);
    }

    /**
     * [commit 311433f6b] The item-name grammar verdict — stage 1 of the
     * maintainer-ruled retirement of compound `<section>/<name>` addressing
     * (2026-08-25). Refuse, on the doors that MINT or PROMOTE a `sys_metadata`
     * row, an item name outside the declared grammar: lowercase snake_case
     * segments, optionally dot-qualified (`METADATA_ITEM_NAME_PATTERN`,
     * `@objectstack/spec/shared` — the one segment source, shared with
     * `ViewItemNameSchema`'s dot-required arity).
     *
     * What this closes, measured before this landed (the census commit 311433f6b records):
     * `''`, `'//'`, `'a/b/c'`, `'Views/All Leads'` were all accepted and
     * stored as item names, and a slash in the name BYPASSED
     * {@link refuseUnmintableMetaType} entirely (`type=fieldz name='a'` →
     * 400, `type=fieldz name='a/b'` → accepted and stored). The compound
     * REST/dispatcher arities still fold `:section/:name` into one
     * slash-joined string; a write arriving that way is now refused here with
     * the dotted spelling as the prescription (their retirement is D3,
     * commit 7986d973f — this door does not wait for it).
     *
     * Scoping, deliberate and parallel to {@link refuseUnmintableMetaType}:
     *
     *  - **`saveMetaItem` and `publishMetaItem` only** — the door that mints
     *    a row and the door that promotes one to `active`.
     *  - **Read doors and `deleteMetaItem` stay open**: residue rows written
     *    before this grammar existed must remain listable and clearable, or
     *    the accumulation becomes one nobody can clear.
     *  - **`migrateStoredMetadata` is NOT exempt.** Its per-row rewrite calls
     *    this same door with the STORED name, so an off-grammar stored row's
     *    in-place rewrite is refused — recorded loudly as that row's
     *    `outcome: 'failed'` with this refusal's text on the migration
     *    report, never silently. That is the ruled shape: a stored slash row
     *    is D2 reopening as its own card, not something to rewrite quietly
     *    under its junk name. A future name-changing conversion writes under
     *    its NEW (grammatical) name and passes this door untouched.
     *
     * Static, answerable from the request alone — no store read — which is
     * why it runs before the {@link refuseUnmintableMetaType} probe.
     */
    private refuseUngrammaticalMetaItemName(request: { type: string, name: string }): void {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        return refuseUngrammaticalMetaItemName(request);
    }

    /**
     * [#8421] The SECOND `/meta` verdict: refuse a `:type` segment that is not
     * a metadata type AT ALL, on the one entry point that MINTS a
     * `sys_metadata` namespace.
     *
     * {@link metaUrlSpellingRefusal} (#7894) is silent for a name that is not a
     * plural of anything — `fieldz` reaches for no declared type — so
     * `PUT /api/v1/meta/fieldz/showcase_task.title` answered 200 and persisted
     * a row under `type='fieldz'`. Maintainer ruling 2026-08-14 (「同意」), joint
     * with #8586: retiring `additionalTypes` removed the last channel by which
     * a plugin could DECLARE a metadata kind, so an unrecognised name can no
     * longer be a declaration this boundary has not heard about.
     * {@link unrecognisedMetaTypeRefusal} is that verdict.
     *
     * ## Why the verdict is not raised on all six `/meta` entry points
     *
     * Measured, not timid:
     *
     *  - **The live type set legitimately holds keys the static contract does
     *    not.** An ordinary `registerApp` puts `data` (a manifest's seed
     *    datasets), `kind` (`contributes.kinds`) and `package` into
     *    `SchemaRegistry`, and {@link listLiveMetadataTypes} — hence `GET
     *    /api/v1/meta/types` — enumerates exactly that set. Refusing
     *    unrecognised names on the READ entries would answer 400 for types this
     *    same service advertises, trading one declared-≠-served gap for another.
     *  - **`deleteMetaItem` must stay open for the opposite reason.** Rows
     *    minted under an unrecognised type BEFORE this refusal are real and
     *    nothing rewrites them on upgrade; refusing delete would strand them
     *    permanently — turning the accumulation this card was filed about into
     *    an accumulation nobody can clear.
     *
     * ## …and why one shape reaching THIS door is exempt (#8421 rework, revised by commit 311433f6b)
     *
     * The first cut had TWO exemptions, both regressions measured on the three
     * consumer packages the first cut never ran. The FIRST — skip the verdict
     * when the name contains a slash, because the compound arity puts an
     * OBJECT name in the `:type` segment (`/metadata/lead/views/all_leads` is
     * `type='lead'`, `name='views/all_leads'`, and `lead` is runtime data no
     * static contract can enumerate) — is GONE (commit 311433f6b): the item-name
     * grammar verdict ({@link refuseUngrammaticalMetaItemName}) runs before
     * this probe and refuses every slash-bearing name outright, so no request
     * that needed the exemption can reach this door any more. That also
     * closes the residue the exemption used to document: `PUT
     * /meta/fieldz/a/b` was accepted and minted `type='fieldz'`; it is now
     * refused at the grammar gate, and this verdict applies to every name
     * that gets past it.
     *
     *  2. **A namespace that ALREADY EXISTS is not being minted.** Two
     *     production paths re-save a row taking its type from an existing
     *     `sys_metadata` row: {@link migrateStoredMetadata} (`source:
     *     'migrate-stored'`) and {@link duplicatePackage}'s copy/clone. Measured
     *     on this branch: migrate never reaches this door for such a row
     *     (`applyConversionsToStoredItem` returns it untouched — an unrecognised
     *     type has no manifest collection, hence no conversion chain, hence no
     *     notice, hence `outcome: 'canonical'`), while **`duplicatePackage`
     *     DID** — a package holding one residue row answered
     *     `{success: false, copiedCount: 0, failedCount: 1}`. That contradicts
     *     the `deleteMetaItem` reasoning directly above, so the exemption is a
     *     repair of this change rather than a new decision.
     *
     * The store — not the caller — is what says the namespace exists, so the
     * exemption cannot be claimed by a request: the probe runs only once the
     * static verdict has already fired, never on the ordinary save path. An
     * unprovisioned store counts as "no rows" and the refusal stands; any other
     * read failure propagates as a 503 rather than being invented into an
     * existence claim (see {@link metaTypeNamespaceExists}).
     */
    private async refuseUnmintableMetaType(request: { type: string, name: string }): Promise<void> {
        // [#25467 cut 33] The body moved to `protocol-unmintable-meta-type.ts` (see `UnmintableMetaTypeHost`).
        const host: ThisParameterType<typeof refuseUnmintableMetaType> = {
            metaTypeNamespaceExists: (...a) => this.metaTypeNamespaceExists(...a),
        };
        return refuseUnmintableMetaType.call(host, request);
    }

    /** Docblock and body: {@link ProtocolSaveFacet.metaTypeNamespaceExists} in `protocol-save.ts` [#29985 codemod]. */
    private async metaTypeNamespaceExists(type: string): Promise<boolean> {
        // [#29985 codemod] The body moved to `protocol-save.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolSaveFacet.metaTypeNamespaceExists(protocolHost(this), type);
    }

    /**
     * [#23015] The save door's half of "one default record page per object per
     * deployment" (maintainer ruling A, record 6134056653; `PageSchema.isDefault`).
     *
     * A `page` body that is the default record page of an object
     * (`defaultRecordPageObject`, the one reading `defineStack` and the
     * registry judge by too) is refused when another page already holds that
     * object's default. The holders are the two sources a deployment serves
     * pages from, judged by name:
     *
     *  - **the stored pages** — the environment-wide active rows
     *    ({@link readActiveOverlayRows}, parsed by {@link storedOverlayEntries}),
     *    a row bound to a package naming that package;
     *  - **the registry's pages** — `SchemaRegistry.defaultRecordPageHoldersOf`
     *    (the reading the registration refusals judge by: packaged pages, their
     *    install claims, and the environment items written through), for every
     *    name no stored row holds. A stored row under a name stands in for
     *    every registry slot of that name, as it does on every read
     *    (ADR-0005), so its own body decides for the name.
     *
     * Asked by `saveMetaItem` on the body it is about to store (draft or
     * publish mode), and by the draft publish (`promoteDraftForPublish`) on the
     * draft body it is about to promote — the save judged only the pages
     * active at that moment, and another may have taken the default since.
     * [#25278] And by the restore doors on the history body they write back
     * (`refuseRestoredBodyTheSaveDoorRefuses`), for the same reason.
     *
     * The page saved under `saveName` is never its own holder: a save under the
     * existing default's own name is an overlay of that page (ADR-0005), not a
     * second default, and stays accepted. A registry with no such reading (a
     * host engine that is not `SchemaRegistry`) contributes no packaged holder;
     * the stored rows are still judged.
     *
     * An UNPROVISIONED store counts as "no stored pages"; any other read
     * failure propagates ({@link rethrowUnlessMetadataStoreUnprovisioned}):
     * answering "no other default" from a read that never happened would
     * accept the very second default this exists to refuse.
     *
     * `DEFAULT_RECORD_PAGE_CONFLICT` / 422 — the envelope the registry's
     * registration refusal carries for the same condition, so a client reads
     * one code whether the second default arrived by a save or by an install.
     * The message names this page and the holder, then the prescription, then
     * why: a 4xx message crosses the REST boundary truncated at its tail. ⛔ It
     * never prescribes overlaying a page a package ships by name: the save door
     * refuses that write (`NOT_OVERRIDABLE`). Runtime words carry no tracker
     * number.
     */
    private defaultRecordPageSaveRefusal(
        type: string,
        item: unknown,
        saveName: string,
        verb: 'saved' | 'published' | 'restored' = 'saved',
    ): Promise<(Error & { code: 'DEFAULT_RECORD_PAGE_CONFLICT'; status: 422 }) | undefined> {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof defaultRecordPageSaveRefusal> = {
            get engine() { return readEngine(); },
            readActiveOverlayRows: (...a) => this.readActiveOverlayRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
            storedOverlayEntries: (...a) => this.storedOverlayEntries(...a),
        };
        return defaultRecordPageSaveRefusal.call(host, type, item, saveName, verb);
    }

    /**
     * The `NAMESPACE_CONFLICT` / 422 a permission-set write is refused with when
     * its name is already held by a DIFFERENT owner — the security catalog's
     * "one name, one holder" (maintainer rulings Q4 = A on #15196, record
     * 6050490870, and A on #22307, record 6063176077) at every door a body
     * reaches `active` through: the save door ({@link saveMetaItem}, draft and
     * publish mode), the draft→active promotion ({@link promoteDraftForPublish},
     * shared by the per-item publish and {@link publishPackageDrafts}) and the
     * restore doors ({@link refuseRestoredBodyTheSaveDoorRefuses}, under
     * `rollbackMetaItem` and `revertCommit`). The faces that write through the
     * save door meet it there too: {@link duplicatePackage} reports a copied
     * set's refusal in `failed[]`, and {@link migrateStoredMetadata} records it
     * as the re-saved row's failure.
     *
     * `owner` is the binding the write LANDS IN, which each door resolves for
     * itself: the save door's {@link packagelessDraftAddress} for a draft that
     * names no package, the #23165 address for a publish-mode save; the
     * promotion's `promoteInto`; the restore's active-row binding. See
     * {@link permissionSetNameCollisionRefusal} for the two holder readings it
     * meets (the stored rows, and the registry's own package-held reading,
     * ruling letter B on #22371, record 6074838935), the package-less row it
     * reads as a package's, and why a same-owner re-author is untouched.
     *
     * `NAMESPACE_CONFLICT` / 422 with the registry's words, because the rulings
     * fix the rule's envelope at that code and status on every path: the code
     * is `@objectstack/objectql`'s, co-registered under this package in the
     * error-code ledger (ADR-0112). No code is minted.
     */
    private permissionSetNameCollisionRefusal(
        singularType: string,
        name: string,
        owner: string | null | undefined,
        verb: 'save' | 'publish' | 'restore',
    ): Promise<(Error & { code: 'NAMESPACE_CONFLICT'; status: 422 }) | undefined> {
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof permissionSetNameCollisionRefusal> = {
            get engine() { return readEngine(); },
            readActiveOverlayRows: (...a) => this.readActiveOverlayRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
            storedOverlayEntries: (...a) => this.storedOverlayEntries(...a),
        };
        return permissionSetNameCollisionRefusal.call(host, singularType, name, owner, verb);
    }

    /**
     * [ADR-0015 §4.2 · #25211] The save doors' half of "`object.external` only
     * on a datasource whose `schemaMode` is not 'managed'": the pair of the item
     * being saved and the stored or registered item on the other side of it,
     * which no parse can see.
     *
     * `ObjectSchema`'s refinement judges a binding on the primary datasource
     * (`'default'`, written or omitted) inside the schema gate, and
     * `defineStack` / `composeStacks` a binding on a datasource a stack
     * declares (#25168). A binding on a datasource stored or registered here
     * reached neither. Measured before this: an object saved `external` on a
     * managed `wh`, and `wh` saved as managed (or with no `schemaMode`, the
     * spec default) under objects bound to it with `external`, were both
     * stored, in draft and in publish mode and under `force`, and the runtime
     * then disagrees with itself about the object: its schema sync skips the
     * DDL as federated while the boot validation and the write gate judge it
     * as managed.
     *
     * Both directions, because either item can be the one saved last:
     *  - an `object` with `external`: judged against the datasource it names,
     *    as this door's own by-name read resolves it ({@link readMetaItem}: the
     *    environment's stored row, else the definition the code layer
     *    registers);
     *  - a `datasource`: judged against every object that binds it with
     *    `external` ({@link objectsBoundExternallyTo}). Only the `managed`
     *    verdict counts here; a binding on the primary datasource is a fact
     *    about the object alone, which its own save is refused for.
     * The judgement is the spec's ({@link externalBindingDatasourceRefusal}),
     * ⛔ never a copy, so a finding reads as the parse's and `defineStack`'s
     * do. A datasource neither layer holds gets no verdict.
     *
     * Asked in draft and in publish mode by {@link saveMetaItem}, after the
     * schema gate, and again by {@link promoteDraftForPublish} on the draft
     * body, because the other half can change between a draft's save and its
     * publish; [#25278] and by the restore doors on the history body they
     * write back ({@link refuseRestoredBodyTheSaveDoorRefuses}), because it can
     * change after a version is saved too. An object's draft is not among the
     * objects a datasource save meets: the draft is judged at its own publish. `force` does not reach
     * it: `force` acknowledges a destructive diff, and this is no diff.
     * Answered as the schema gate answers: `422 INVALID_METADATA`, the
     * findings in `issues`, at `external` for an object and at `schemaMode`
     * for a datasource.
     */
    private externalBindingSaveRefusal(
        singularType: string,
        item: unknown,
        name: string,
        writeFace?: MetadataWriteFace,
    ): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const host: ThisParameterType<typeof externalBindingSaveRefusal> = {
            externalBindingDatasourceDefinition: (...a) => this.externalBindingDatasourceDefinition(...a),
            objectsBoundExternallyTo: (...a) => this.objectsBoundExternallyTo(...a),
        };
        return externalBindingSaveRefusal.call(host, singularType, item, name, writeFace);
    }

    /**
     * [#25211 · #25279] The definition of the datasource an `external` object
     * names, as this environment resolves it by name ({@link readMetaItem}: the
     * stored row, else the definition the code layer registers), or `undefined`
     * when no layer holds one. The ONE read behind the object half of
     * {@link externalBindingSaveRefusal} and the stored-migration pass's listing
     * of the same refusal ({@link storedRowKnownDatasources}), so the two cannot
     * judge a binding against different datasources.
     */
    private externalBindingDatasourceDefinition(
        datasource: string,
    ): Promise<{ readonly schemaMode?: unknown } | undefined> {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const host: ThisParameterType<typeof externalBindingDatasourceDefinition> = {
            readMetaItem: (...a) => this.readMetaItem(...a),
        };
        return externalBindingDatasourceDefinition.call(host, datasource);
    }

    /**
     * [#26724] The save doors refuse an `object` whose `datasource` names a
     * datasource that does not exist here. Before this, such an object was
     * stored and published ("published"), and then never registered: the
     * engine routes an explicit `datasource` to the driver of that name only
     * (`resolveDatasourceBinding` step 1), so every data call on it answered
     * 404 "not registered", and nothing told the author why.
     *
     * A name exists when any of these holds, and the refusal fires on none:
     *  - it is absent, empty or `'default'` (the primary datasource);
     *  - the engine has a driver registered under it
     *    (`IDataEngine.getDriverByName`): one a host or plugin registers at
     *    run time with no datasource item (a `driver.*` service, an `onEnable`
     *    `drivers.register`). An engine without that member cannot say a name
     *    is unknown, so nothing is refused on it;
     *  - a datasource item of that name resolves through this door's by-name
     *    read ({@link readMetaItem}: the environment's stored row, else the
     *    code layer's definition), connected or not;
     *  - it is still pending: on a draft save, any datasource draft of that
     *    name; on a package publish, a datasource draft of the same batch
     *    (`pending` as a set), since the batch promotes as one unit in no
     *    type order;
     *  - the object's current definition already names it: the binding is not
     *    this write's. A re-save, a stored-row migration or a restore that
     *    keeps it is not judged; a declaration boot (`os migrate`) never runs
     *    `onEnable`, so a driver registered there is absent from it.
     *
     * Asked in draft and in publish mode by {@link saveMetaItem} after the
     * schema gate, again by {@link promoteDraftForPublish} on the draft body
     * (the datasource can go between a draft's save and its publish), and by
     * the restore doors ({@link refuseRestoredBodyTheSaveDoorRefuses}).
     * Answered as the schema gate answers: `422 INVALID_METADATA`, one finding
     * at `datasource` naming the datasource.
     */
    private unknownDatasourceSaveRefusal(
        singularType: string,
        item: unknown,
        name: string,
        pending?: 'drafts' | ReadonlySet<string>,
        writeFace?: MetadataWriteFace,
    ): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof unknownDatasourceSaveRefusal> = {
            get engine() { return readEngine(); },
            listDrafts: (...a) => this.listDrafts(...a),
            readMetaItem: (...a) => this.readMetaItem(...a),
        };
        return unknownDatasourceSaveRefusal.call(host, singularType, item, name, pending, writeFace);
    }

    /**
     * [#28990] The save doors refuse a `permission` set whose `objects` map
     * grants on an object that does not exist here. Before this, such a set
     * was stored and published (200), and the grant applied to nothing: the
     * permission evaluator keys a grant by the object's name, so a short `lead`
     * where the object is `crm_lead` silently grants nothing — the case
     * `defineStack`'s build rule refuses for a stack's own sets ("Fail loudly
     * at build time"); this is the same judgement at the runtime door.
     *
     * A grant key is known when any of these holds, and the refusal fires on
     * none:
     *  - it is `'*'`, the wildcard the evaluator falls back to;
     *  - the engine's registry registers an object of exactly that name — any
     *    package's, the platform's (`sys_*`, the RBAC link tables) included,
     *    since they are registered, so the build rule's platform-prefix
     *    allowance needs no restating here. A registry that cannot look an
     *    object up refuses nothing;
     *  - an object of that name resolves through this door's by-name read
     *    ({@link readMetaItem}: the environment's stored row, else the code
     *    layer's definition);
     *  - it is still pending: on a draft save, any object draft of that name;
     *    on a package publish, an object draft of the same batch (`pending` as
     *    a set), since the batch promotes as one unit in no type order;
     *  - the set's current definition already grants on it: the grant is not
     *    this write's. A re-save or a restore that keeps it is not judged, and
     *    neither is an object that has gone since the grant was made;
     *  - [#30255] the save copies it verbatim from a set that already holds it
     *    (`inherited`, the request's `inheritedGrantObjects`: the permission-set
     *    clone door's copy). The grant is the source's, not this write's — the
     *    rule above, for a copy. A platform set may grant on an object of an
     *    optional platform plugin this deployment does not install
     *    (`member_default` on `sys_comment` / `sys_activity`, which
     *    `@objectstack/plugin-audit` registers): the grant applies to nothing
     *    here, in the source and in the copy alike, and the copy is what the
     *    clone door promises.
     *
     * Asked in draft and in publish mode by {@link saveMetaItem} after the
     * schema gate (except a `migrate-stored` re-save, the platform healing
     * its own storage: a draft-only set holds no active definition, so its
     * own rewrite would be judged as new grants), again by {@link promoteDraftForPublish} on the draft body
     * (the object can go between a draft's save and its publish), and by the
     * restore doors ({@link refuseRestoredBodyTheSaveDoorRefuses}). Answered
     * as the schema gate answers: `422 INVALID_METADATA`, one finding per
     * unknown object at `objects.<name>`, naming it. [#29279] `door` names
     * what the finding says was looked for: a save counts an object saved
     * here, a draft's publish (`'publish'`) only a published object or an
     * object draft of its batch.
     */
    private unknownGrantObjectSaveRefusal(
        singularType: string,
        item: unknown,
        name: string,
        pending?: 'drafts' | ReadonlySet<string>,
        writeFace?: MetadataWriteFace,
        door?: 'save' | 'publish',
        inherited?: readonly string[],
    ): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof unknownGrantObjectSaveRefusal> = {
            get engine() { return readEngine(); },
            listDrafts: (...a) => this.listDrafts(...a),
            readMetaItem: (...a) => this.readMetaItem(...a),
        };
        return unknownGrantObjectSaveRefusal.call(host, singularType, item, name, pending, writeFace, door, inherited);
    }

    /**
     * [#29898] The save doors refuse an `object` (or an `object_extension`)
     * whose field is bound to a picklist no loaded package declares. Before
     * this, such a body was stored and published (200, its draft reading
     * `_diagnostics.valid: true`), the field was served with no options, and
     * the record validator refused every value of it — the shape the boot and
     * the late-install load already refuse
     * (`describeUnresolvedPicklistReferences`) and `os validate` / `os build`
     * refuse for a stack's own fields (`picklist-reference-unknown`); this is
     * the same judgement at the runtime door.
     *
     * A binding is known when any of these holds, and the refusal fires on
     * none:
     *  - the engine's registry resolves the list (`resolvePicklistOptions`,
     *    the read that serves the field's options): a list the package
     *    itself, a dependency, the base package of a `.custom` pair or any
     *    other package installed here declares. A registry that cannot
     *    resolve a list refuses nothing;
     *  - the object's current definition already binds that field to that
     *    list: the binding is not this write's. A re-save or a restore that
     *    keeps it is not judged, and neither is a list that has gone since.
     *
     * No pending arm: a picklist is not runtime-creatable, so no draft of
     * this batch can declare one.
     *
     * Asked in draft and in publish mode by {@link saveMetaItem} after the
     * schema gate (except a `migrate-stored` re-save, the platform healing
     * its own storage), again by {@link promoteDraftForPublish} on the draft
     * body (a draft stored before this refusal, or whose list went between
     * its save and its publish), and by the restore doors
     * ({@link refuseRestoredBodyTheSaveDoorRefuses}). Answered as the schema
     * gate answers: `422 INVALID_METADATA`, one finding per unknown binding
     * at `fields.<field>.picklist`, naming the field and the list.
     */
    private unknownPicklistBindingSaveRefusal(
        singularType: string,
        item: unknown,
        name: string,
        writeFace?: MetadataWriteFace,
    ): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof unknownPicklistBindingSaveRefusal> = {
            get engine() { return readEngine(); },
            readMetaItem: (...a) => this.readMetaItem(...a),
        };
        return unknownPicklistBindingSaveRefusal.call(host, singularType, item, name, writeFace);
    }

    /**
     * [#28952] The refusal of a `seed` whose `externalId` names no field of
     * the seed's object: a load in a keyed mode (`upsert`, `update`,
     * `ignore`) keys each existing row and each incoming record by that
     * field, and a field the object lacks keys every one of them empty, so
     * nothing ever matches and every publish and every replay inserts each
     * record again (or, in `update` mode, skips it) with a success receipt.
     * Each member of a composite `externalId` is judged; an undeclared one is
     * `SeedSchema`'s default, `name`. `insert` and `replace` never match, so
     * they are not judged.
     *
     * The object is judged as the publish will have it: a draft of it in the
     * same package batch (`pending` as the batch's object declarations), else
     * the engine's registered definition, whose fields include extension
     * fields; the columns the registry injects (`id`, the audit and tenant
     * columns) count. Not refused when the object cannot be resolved: on a
     * draft save, an object that is itself still a draft (`pending` as
     * `'drafts'`) is judged at the seed's publish; an object resolved by
     * neither is reported by the load.
     *
     * Asked in draft and in publish mode by {@link saveMetaItem} after the
     * schema gate (except a `migrate-stored` re-save, the platform healing
     * its own storage), again by {@link promoteDraftForPublish} on the draft
     * body, so a seed stored before this refusal or whose object lost the
     * field is refused when it is published and a batch publish aborts on
     * it, and by the restore doors ({@link refuseRestoredBodyTheSaveDoorRefuses}).
     * Answered as the schema gate answers, with the envelope of
     * {@link unknownDatasourceSaveRefusal}: `422 INVALID_METADATA`, one finding
     * per missing member at `externalId` (`externalId.N` for a composite
     * member), naming the field and the object. The boot loader
     * never refuses; it warns once for a keyed dataset whose every record
     * keys empty ({@link SeedLoaderService}).
     */
    private seedExternalIdSaveRefusal(
        singularType: string,
        item: unknown,
        name: string,
        pending?: 'drafts' | ReadonlyArray<unknown>,
        writeFace?: MetadataWriteFace,
    ): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof seedExternalIdSaveRefusal> = {
            get engine() { return readEngine(); },
            listDrafts: (...a) => this.listDrafts(...a),
        };
        return seedExternalIdSaveRefusal.call(host, singularType, item, name, pending, writeFace);
    }

    /**
     * [#25211] Every object this environment holds that binds `datasource`
     * with `external`, for {@link externalBindingSaveRefusal}'s datasource
     * half: the environment's stored active rows ({@link readActiveOverlayRows},
     * read as the list read parses them), and the registry's objects no stored
     * row overlays (an object's stored row is its base layer, ADR-0029 D9).
     * Drafts are not read: a draft does not bind anything until its publish,
     * which is judged on its own.
     */
    private objectsBoundExternallyTo(datasource: string): Promise<Array<{ name: string; external: unknown }>> {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof objectsBoundExternallyTo> = {
            get engine() { return readEngine(); },
            readActiveOverlayRows: (...a) => this.readActiveOverlayRows(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
            storedOverlayEntries: (...a) => this.storedOverlayEntries(...a),
        };
        return objectsBoundExternallyTo.call(host, datasource);
    }

    /**
     * [ADR-0138 D2b] The flow half of the anonymous door × elevated flow
     * refusal: a flow published with `runAs: 'system'` while an
     * `authRequired: false` endpoint of `type: 'flow'` names it.
     *
     * The record refuses the pair "in both directions, because either item can
     * be the last one edited". An endpoint is code-only (`api` is
     * `allowRuntimeCreate: false`; the code-only inlet refuses its write), so its
     * own publish is the stack parse and the metadata layer's package publish,
     * where the judge runs over both items. A flow is authorable here, so this
     * door is where the OTHER direction is read: the flow is the item being
     * published, and the endpoints that name it are read from what declares
     * them on this host. Both judges are the one in
     * `@objectstack/spec/api` (`anonymousElevatedFlowPairs`), so the stack and
     * this door cannot grow two opinions of the pair.
     *
     * Asked at every door a flow body reaches `active` through: the save in
     * publish mode ({@link saveMetaItem}), the draft promotion
     * ({@link promoteDraftForPublish}) the per-item publish and
     * `publishPackageDrafts` share, and [#25278] the restore doors
     * ({@link refuseRestoredBodyTheSaveDoorRefuses}). A draft save is let
     * through: a draft does not execute, and its publish is judged here.
     * `migrate-stored` re-saves
     * (the credential move, `os migrate meta --stored`) are not judged: they
     * rewrite a row that already exists, and refusing one would leave a
     * credential the move exists to take out of the row in cleartext. Such a
     * row keeps executing as published until its next publish, which this
     * refuses (the semantic entry `api-endpoint-anonymous-elevated-flow-refused`
     * says so to an upgrading author).
     *
     * Where the endpoints are read, both, because each is a home a code
     * stack's `apis` has on a real boot: the engine registry's `api` items
     * (`registerApp` files every stack's `apis` there) and the `metadata`
     * service's `list('api')`, the manager whose index the endpoint matcher
     * serves from. Their items are read as bodies, as {@link getMetaItems}
     * reads the same two sources. ⛔ `sys_metadata` is not read: an `api` row
     * there is never served (the matcher does not read the store) and none can
     * be written any more. A read that fails propagates: answering "no
     * endpoint names it" from a read that never happened would publish the
     * very pair this refuses.
     *
     * `INVALID_METADATA` / 422 with `issues[]` at `runAs` — the envelope this
     * door's other publish-time contract refusals carry (the schema gate and
     * the runtime authoring gate), so Studio highlights the key the refusal is
     * about. ⛔ No new code. The message prescribes before it explains (a 4xx
     * message crosses the REST boundary with its tail truncated) and carries no
     * tracker number.
     */
    private anonymousElevatedFlowRefusal(
        singularType: string,
        item: unknown,
        name: string,
    ): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const readEngine = () => this.engine;
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof anonymousElevatedFlowRefusal> = {
            get engine() { return readEngine(); },
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return anonymousElevatedFlowRefusal.call(host, singularType, item, name);
    }

    /** Docblock and body: {@link ProtocolSaveFacet.viewContainerNameCollisionRefusal} in `protocol-save.ts` [#29985 codemod]. */
    private async viewContainerNameCollisionRefusal(
        type: string,
        item: unknown,
        saveName: string,
        packageId: string | null | undefined,
    ): Promise<(Error & { code: 'VALIDATION_ERROR'; status: 400 }) | undefined> {
        // [#29985 codemod] The body moved to `protocol-save.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolSaveFacet.viewContainerNameCollisionRefusal(protocolHost(this), type, item, saveName, packageId);
    }

    /**
     * [#21639] The view names of the shipped container a container row
     * overlays by its own name — the one source of "a view item a package
     * ships" that row may replace. ADR-0005 keys an overlay by its own name,
     * and the package-aware merge seats a row in its package's slot, so the
     * overlaid container is the artifact of the row's own name in the row's
     * own package ({@link runtimeViewContainerPackage}); a package-bound row
     * overlays only its own package's artifact. Empty for a row that overlays
     * no shipped container.
     */
    private overlaidShippedContainerViewNames(
        type: string,
        container: Record<string, unknown>,
        packageId: string | null | undefined,
    ): ReadonlySet<string> {
        // [#25467 cut 33] The body moved to `protocol-registry-view-predicates.ts` (see `RegistryViewPredicatesHost`).
        const host: ThisParameterType<typeof overlaidShippedContainerViewNames> = {
            expandRuntimeViewContainer: (...a) => this.expandRuntimeViewContainer(...a),
            runtimeViewContainerPackage: (...a) => this.runtimeViewContainerPackage(...a),
            shippedViewContainerOf: (...a) => this.shippedViewContainerOf(...a),
        };
        return overlaidShippedContainerViewNames.call(host, type, container, packageId);
    }

    /**
     * [#23119, ADR-0010 §3.5 and §4.1] The lock family an AUTHOR's save
     * persists: the one the row it writes already stores. An author's write
     * never sets, changes or removes an item's lock. ADR-0010 §4.1 strips the
     * protection fields on write and has the loader reattach them on load,
     * §3.5 gives an environment-authored item no package lock, and the spec
     * calls the `_lock*` keys the runtime's private envelope, never authored
     * (`shared/protection.zod.ts`). A stored row lock is one the runtime
     * stamped: a loader's or a plugin's `applyProtection`, an install, a
     * migration's re-save. Stored verbatim, which is what this door did, a
     * hand-written or echoed `_lock: 'full'` bound the item for good: the next
     * save and the delete answered `ITEM_LOCKED`, and no door unlocks it.
     *
     * Three outcomes, judged after the `protection` block's refusal:
     *
     *  - **No `_lock*` key in the body.** The body says nothing about the
     *    lock, so the row keeps the family it stores. This is not a removal.
     *    Dropping the stored family instead would be the fail-open direction
     *    {@link DERIVED_PROVENANCE_KEYS}' note refuses, and it was measured
     *    here: a `no-delete` a server face had stamped was lost to the next
     *    author save, and the delete it refused went through.
     *  - **An echo.** Studio and the AI authoring surfaces send the served
     *    body back on every edit, so a family equal to one a read of this item
     *    serves is accepted and ignored. Two such families exist. One is what
     *    the active reads serve at the save's address ({@link getMetaItem},
     *    the layered read's `effective`, the list): the one item-lock
     *    resolution's answer ({@link resolveItemLock} over every shipping
     *    package's artifact and the item's stored rows in scope), written onto
     *    the body by {@link withItemLockFamily}. The other is the family stored
     *    on the row this save writes, which the draft read, the preview read
     *    and the layered read's `overlay` layer serve verbatim. Accepting the
     *    second changes nothing, because it is the family carried forward. A
     *    new item, or a first overlay of a packaged one, has no row: its
     *    artifact's lock still binds through the resolution, and the row it
     *    gets stores none.
     *  - **Anything else** sets, changes or removes the lock, and is refused
     *    ({@link authoredLockFamilyRefusal}). That includes a family copied
     *    from another item, which neither read serves for this one.
     *
     * The row is the one the repository's `put` resolves for this save
     * ({@link SysMetadataRepository.headAt}: its state, package and bundle
     * member, the inherited draft binding included). A draft save with no
     * draft row yet reads the ACTIVE row the draft overlays. That fallback is
     * load-bearing: the draft is published by promotion, so a draft that
     * dropped the active row's lock would publish the loss
     * ({@link storedBodyForCarryForward} draws the same line for a credential).
     * Read with no `try`/`catch`: a stored lock that could not be read must
     * fail the save, never be written away.
     *
     * A member whose value the type's own declaration refuses is left to the
     * parse: the body is handed on untouched, and the parse refuses it with
     * `422 INVALID_METADATA`, as before. That is the path the unmanaged
     * import's strip (`stripUnmanagedImportLock`) hands a lock it cannot parse
     * down, and its refusal does not move. A type that declares no such key,
     * or has no schema at all (`external_catalog`), is judged here: no parse
     * would refuse the key there, and stored, the `_lock` gate reads it.
     *
     * Asked of every write that reaches the author arm: the REST `PUT`
     * (`meta-envelope`), the runtime dispatcher (`meta-dispatch`), the
     * external-table import (`external-import`, whose body the server builds
     * and which never carries a `_lock*` key), the unmanaged import
     * (`package-unmanaged-import`, stripped, and writing only names no row
     * held), and the in-process doors that state no face. The server-stated
     * rewrites (`source`, `package-duplicate`) keep stamping, as before. No
     * stored lock is unbound here.
     */
    private authoredLockFamily(args: {
        type: string;
        name: string;
        packageId: string | null | undefined;
        mode: 'draft' | 'publish';
        item: unknown;
    }): Promise<unknown> {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const host: ThisParameterType<typeof authoredLockFamily> = {
            artifactLockLayerAt: (...a) => this.artifactLockLayerAt(...a),
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            overlayLockLayerAt: (...a) => this.overlayLockLayerAt(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
        };
        return authoredLockFamily.call(host, args);
    }

    /**
     * [ADR-0086 D3] The package binding of the row a save writes, as
     * {@link permissionSetOwnerBindingRefusal} compares a body's `packageId`
     * against it: the binding the write RESOLVES, never the request's spelling.
     *
     * - A save that names a package writes that package's row (ADR-0048).
     * - A draft save that names none writes into the package of the item's
     *   active row when it has one (#11087): the repository's own write-address
     *   resolution answers it ({@link SysMetadataRepository.headAt}, the binding
     *   `put` stamps), so the judge and the write read one answer.
     * - A direct save that names none writes the row its address resolved
     *   before this is asked, which names no package here.
     *
     * The store is read only when the judge has something to compare: a
     * permission set whose body carries a string `packageId`, saved as a draft
     * that names no package. Every other save answers from the request. An
     * unprovisioned store holds no row and so no binding; any other failed read
     * propagates (#5532), because a guessed binding would judge a row the write
     * does not land in.
     */
    private saveWriteBinding(
        singularType: string,
        request: { name: string; item?: unknown; packageId?: string | null },
        mode: 'draft' | 'publish',
    ): Promise<string | null> {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const host: ThisParameterType<typeof saveWriteBinding> = {
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
        };
        return saveWriteBinding.call(host, singularType, request, mode);
    }

    /**
     * [#24547 · ADR-0129 D2] The package namespace-prefix verdict on one object
     * name: `validateObjectNamespacePrefix`'s own authored prescription when
     * `name` lacks the `${namespace}_` prefix of the package it is written
     * under, else `null`.
     *
     * ONE judge for the three runtime doors that make an object live under a
     * package — the publish pre-flight of {@link publishPackageDrafts}, the
     * direct (publish-mode) save of {@link saveMetaItem}, and the per-item
     * publish of {@link publishMetaItem} (asked in
     * {@link promoteDraftForPublish}, on the package the promotion writes
     * under) — so they cannot give opposite verdicts on one name in one
     * package again, nor tell the author different things about it.
     *
     * The namespace is the one the package DECLARES: its installed manifest,
     * where {@link installPackage} derives and persists one when the author
     * wrote none. A package that declares none, and a write bound to no
     * package, are not judged — like `defineStack`, nothing here invents a
     * prefix (`validateObjectNamespacePrefix` skips an empty namespace).
     */
    private objectNamespacePrefixViolation(name: string, packageId: string | null | undefined): string | null {
        // [#25467 cut 6] The body moved to `protocol-save-door-refusals.ts` (see `SaveDoorRefusalHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof objectNamespacePrefixViolation> = {
            get engine() { return readEngine(); },
        };
        return objectNamespacePrefixViolation.call(host, name, packageId);
    }

    // [#21207] `parentVersion` is a CALLER's version token — the keyed form a
    // receipt served — and is compared in that form (`storedParentForToken`).
    // `storedParentVersion` is the in-process twin for a caller that read the
    // STORED content hash itself (`migrateStoredMetadata`): it reaches the
    // repository as given. ⛔ No transport sets it — every door builds its
    // request field by field from named inputs, never by spreading a body.
    async saveMetaItem(request: SaveMetaItemRequest): Promise<{
        state: "draft" | "active";
        message: string;
        advisories?: {
            rule: string;
            path: string;
            where: string;
            message: string;
            hint: string;
            severity: "error" | "info" | "warning";
        }[] | undefined;
        projectionApplied?: MutationProjectionOutcome | undefined;
        success: boolean;
        version: string;
        seq: number;
    }> {
        // [#28355] A refusal that carries no row of its own leaves its `denied` row here.
        return withRefusalAudit((entry) => this.recordMetadataAudit(entry), {
            operation: 'save', type: request.type, name: request.name, actor: request.actor,
            source: request.source ?? 'protocol.saveMetaItem',
        }, () => this.saveMetaItemUnaudited(request));
    }

    /** Docblock and body: {@link ProtocolSaveFacet.saveMetaItemUnaudited} in `protocol-save.ts` [#29985 codemod]. */
    private async saveMetaItemUnaudited(request: SaveMetaItemRequest) {
        // [#29985 codemod] The body moved to `protocol-save.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolSaveFacet.saveMetaItemUnaudited(protocolHost(this), request);
    }

    /**
     * The save door's 409 for a `ConflictError` — the repository's race, or a
     * caller's token the keyed comparison refused — plus its decision-audit row.
     * One builder for both, so the two cannot answer in different words.
     * [#21207] The text and attributes carry keyed values or none
     * ({@link metadataConflictRefusal}); the audit row carries no hash at all.
     * [#23406] A caller that sent the first-write pin (`parentVersion: null`)
     * asserted that the lifecycle it writes had no row, and is told that, not
     * that the item changed since it loaded it.
     */
    private async saveConflict(
        err: ConflictError,
        request: { type: string; name: string; actor?: string; parentVersion?: string | null; mode?: 'draft' | 'publish' },
        writeSource: string,
    ): Promise<Error> {
        // [#25467 cut 24] The body moved to `protocol-save-conflict.ts` (see `SaveConflictHost`).
        const host: ThisParameterType<typeof saveConflict> = {
            metadataConflictRefusal: (...a) => this.metadataConflictRefusal(...a),
            recordOptimisticConflictAudit: (...a) => this.recordOptimisticConflictAudit(...a),
        };
        return saveConflict.call(host, err, request, writeSource);
    }

    /**
     * `os migrate meta --stored` — canonicalize `sys_metadata` rows in place so
     * the read-path conversion chain has a finish line (#4327).
     *
     * #4317 made every stored-row rehydration seam replay the full ADR-0087
     * chain, so a row written under any past protocol *reads* canonical forever
     * ({@link convertStoredItem}). The rows themselves stayed legacy: the chain
     * re-lowers them on every load and each one emits a conversion notice per
     * process. This pass ends that for a deployment that runs it — same chain,
     * same policy, result written back — while the read path stays the
     * guarantee for every deployment that does not (#3855: operator-run
     * migrations cannot be relied upon, so nothing here is load-bearing).
     *
     * ## What it walks
     *
     * `active` and `draft` rows. On a database the organization-ownership
     * ceremony has not migrated, a legacy organization's row is told apart by
     * its physical `organization_id` ({@link readLegacyOrganizationRows}) and
     * reported, never re-saved (below). `archived` / `deprecated` rows are deliberately
     * not read: they are not served metadata, and rewriting them would edit a
     * record of what *was*. `sys_metadata_history` is untouched for the same
     * reason the addendum gives — converting a version body would break the
     * checksum↔body pairing.
     *
     * ## How it writes
     *
     * Through {@link saveMetaItem}, not the repository directly, so a rewritten
     * row gets everything an author's save gets: the schema gate, a
     * `sys_metadata_history` row, a fresh checksum, the mutation projectors and
     * the watch event Studio's HMR consumes. Three deliberate arguments:
     *
     * - `parentVersion: row.checksum` — a true optimistic lock. A concurrent
     *   writer that moved the row between our read and our write gets a 409,
     *   reported as `failed`, never a clobber.
     * - `force: true` — the destructive-change diff compares the *stored*
     *   body (which `getMetaItem` already serves converted) against the body we
     *   are about to write (the same conversion). It is empty by construction,
     *   and there is no author here for a confirmation prompt to reach.
     * - `source: 'migrate-stored'` — so a history diff distinguishes a
     *   canonicalization pass from an edit someone made. This is the ONLY
     *   place the pass names itself: `actor` (below) is the user who ran it
     *   or nobody, never a label (#23068).
     *
     * ## What it lists and never writes
     *
     * `decisionModeReview` (#15429, maintainer ruling letter C): every stored
     * `decision` node with no `conditions` list, no `mode` and two or more
     * conditioned out-edges. Such a node took every true branch before
     * protocol 18 and takes the first one now, and a stored row keeps that
     * new meaning — the D2 entry that writes `mode: 'inclusive'` replays only
     * over authored sources (`os migrate meta --from 17`), where the operator
     * asserts the source's age; nothing asserts a row's. The list is the
     * operator's review of that change, before and after the upgrade: it is
     * built from the stored body with the D2 entry's own predicate
     * ({@link collectDecisionModeReview}), it is the same on preview and apply,
     * and it moves no row outcome, no count and no verdict.
     *
     * ## What it declines to touch, and says so
     *
     * This section documents the function's FULL internal surface, which is
     * not always identical to what an operator running the CLI can observe:
     * `os migrate meta --stored` always passes its own automation engine
     * (see `canonicalizeFlow` above), so the first bullet below is never
     * observed from that door. That is now the only difference between this
     * list and `content/docs/deployment/cli.mdx`'s decline table, which
     * documents the operator-observable surface and so carries the other
     * four. #9271 ruled that split intentional: keep each list correct for
     * its own audience rather than reconciling them.
     *
     * - **`flow` rows with no reachable automation engine.** A flow
     *   canonicalizes at the engine, whose registration checks need the live
     *   node registry. When one is reachable —
     *   passed as `canonicalizeFlow`, or resolved from the services registry
     *   (#4498) — flows are migrated like anything else (#4454); when none is,
     *   they are reported `skipped` with that reason, never counted done.
     * - **Types with no repository write path** (neither `allowEnvironmentOverlay` nor
     *   `allowRuntimeCreate`). This pass declines them, and since #5086 it
     *   would have no choice: `saveMetaItem` refuses a code-only type with
     *   `403 NOT_CREATABLE` / `NOT_OVERRIDABLE` before persistence. The skip
     *   predates that refusal and outranks it — declining is a *reported*
     *   `skipped` row, where forwarding the write would surface as `failed`
     *   noise on every run. (Historical note for anyone reading the skip
     *   reason: until #5264 the write would instead have landed in a legacy
     *   raw-engine branch that recorded no history and forced `state:
     *   'active'`. That branch is gone; the skip is what always kept this
     *   pass away from it.)
     *
     *   Today that is exactly one type, `agent`, and its skip is **permanent
     *   by design, not a to-do** (#4507): ADR-0063 §2 closes `*.agent.ts` to
     *   third parties, so the only agent definitions in existence are the two
     *   the platform ships from version control — where git, not
     *   `sys_metadata_history`, is the change log. See the note beside the
     *   `agent` entry in `metadata-plugin.zod.ts` before treating this branch
     *   as a gap to close.
     * - **Rows that still fail the current schema after conversion.**
     *   `saveMetaItem` rejects them (422) and that rejection is correct: the
     *   body is a genuine contract violation, not chain-owned history. They
     *   surface as `failed` with the validation message, keep reading through
     *   the chain, and stay fixable in Studio.
     * - **Rows stored under a non-canonical metadata type spelling** (#8957,
     *   {@link isNonCanonicalStoredType}). This pass canonicalizes BODIES;
     *   rewriting a stored type spelling is an identity move — a new
     *   `(org, type, name, package_id)` key, not an edit — so it is out of
     *   its reach. Nothing on the canonical type can see such a row — no
     *   registry read, no compliance query — and the batch publish refuses
     *   it for the same reason (`STORED_TYPE_NOT_CANONICAL`). Reported
     *   `skipped`, not `failed`: nothing is broken about this pass, the row
     *   is simply outside its reach. Re-author the item under the canonical
     *   type (`PUT /meta/<canonical>/<name>`) and drop the non-canonical
     *   row.
     * - **Sites the chain leaves as stored for want of a lossless rewrite**
     *   (#17321, ADR-0087 D3's structured TODO). A conversion that recognises
     *   a pre-protocol shape it cannot rewrite without changing what it means
     *   — a page filter carrying `$or`, which a flat rule list cannot spell —
     *   leaves the site byte-identical and reports a TODO instead of a notice.
     *   The same list carries the shapes protocol 18 refuses that no
     *   conversion covers (#23269, #23270, #23271: a `controlled_by_parent`
     *   object without exactly one required `master_detail`, a view bound to
     *   the retired view-level API source, a flow value slot carrying a `{…}`
     *   token), each TODO naming the D3 entry that refuses it. A flow row's
     *   TODOs come back from the flow canonicalizer.
     *   Every such site is listed under its row (`rows[].todos`) with the
     *   block and the reason, whatever the row's outcome; a row whose ONLY
     *   finding is TODOs has nothing to persist and is reported `skipped`,
     *   never `canonical`. Like the skip classes above, TODOs do not flip
     *   {@link storedMigrationClean}: no run of this pass could clear them.
     */
    async migrateStoredMetadata(request: {
        /** Write. Omitted / false = preview: reports what it would do, writes nothing. */
        apply?: boolean;
        /** Restrict to these metadata types (singular or plural spelling). */
        types?: string[];
        /**
         * The id of the user running the pass — omit it when no user is
         * (a CLI run against the database, an `isSystem` caller). It becomes
         * each rewrite's `PutOptions.actor`, so it lands in
         * `sys_metadata_history.recorded_by` and the row's `updated_by`, both
         * `lookup('sys_user')`: omitted, they record `null`, #4556's
         * "system-initiated". ⛔ Never a label naming the door or the pass —
         * that is a reference to no user, and `source: 'migrate-stored'`
         * already says where the write came from (#23068).
         */
        actor?: string;
        /**
         * Canonicalize a stored `flow` body (#4454). **Optional override** —
         * when omitted, the automation engine is resolved from the live
         * services registry (#4498, {@link resolveFlowCanonicalizer}).
         *
         * `AutomationEngine.canonicalizeStoredFlow` is the implementation.
         * A flow canonicalizes at the engine, whose registration checks need
         * the live node registry. A caller running next to a live engine (an admin route, a
         * server task) needs to pass nothing; the CLI passes its own because
         * it boots an inert engine specifically to hold one, and an explicit
         * hook is also what makes the flow branch testable without an engine.
         *
         * When neither is available — a control-plane or metadata-only host —
         * flow rows are reported `skipped` with that reason rather than
         * quietly counted done.
         *
         * Must return the **storable** shape — conversions and the schema's
         * `condition` envelopes, without schema defaults. Throwing is a valid
         * answer for a row that cannot canonicalize; the row is reported
         * `failed` with the message.
         */
        canonicalizeFlow?: (name: string, body: unknown) => StoredFlowCanonicalization;
    } = {}): Promise<StoredMigrationReport> {
        // [#29985 codemod] The body moved to `protocol-save.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolSaveFacet.migrateStoredMetadata(protocolHost(this), request);
    }

    /**
     * Yield the durable change-log for a single metadata item — every
     * put/delete recorded in `sys_metadata_history` for `(org, type, name)`,
     * in event_seq order. Powers the Studio "History" tab and any
     * client-side audit timeline.
     *
     * Returns `[]` for code-only types (neither `allowEnvironmentOverlay` nor
     * `allowRuntimeCreate`) instead of throwing — callers can treat "no
     * history" uniformly. Those types have no history to yield by
     * construction: `saveMetaItem` refuses them outright (#5086), and the one
     * write channel they retain — `deleteMetaItem`'s legacy raw-engine branch
     * on a control-plane kernel — appends no `sys_metadata_history` row.
     */
    async historyMetaItem(request: {
        type: string;
        name: string;
        sinceSeq?: number;
        limit?: number;
        /** [#22877] The bundle member whose lineage to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
        member?: string;
    }): Promise<{ events: import('@objectstack/metadata-core').MetadataEvent[] }> {
        // [#29985 codemod] The body moved to `protocol-history-and-publish.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolHistoryAndPublishFacet.historyMetaItem(protocolHost(this), request);
    }

    /**
     * Promote the pending draft overlay to the live (`active`) row.
     * Records a history event with `op='publish'`. 404 (`NO_DRAFT`)
     * when there is nothing to publish.
     */
    async publishMetaItem(request: PublishMetaItemRequest): Promise<{
        success: boolean;
        version: string;
        seq: number;
        message?: string;
        /**
         * Present when a `seed` draft was published: the result of materializing
         * its rows. Publishing the metadata ALWAYS succeeds independently — a
         * seed-load problem is surfaced here, never thrown, so callers (and UIs)
         * must check `seedApplied.success` instead of assuming data went live.
         */
        seedApplied?: {
            success: boolean;
            inserted: number;
            updated: number;
            error?: string;
            errors?: unknown[];
            /** [#30348] Per object, the rows created vs matched — `SeedAppliedLandedSchema`. */
            landed?: SeedAppliedLandedParsed[];
        };
        /**
         * Present when a publish-time materializer is registered for this type
         * (ADR-0086 P2 — e.g. `flow`): the result of projecting the published
         * body into its data-plane representation. Best-effort,
         * same contract as `seedApplied` — surfaced, never thrown.
         */
        materializeApplied?: PublishMaterializeResult;
        /**
         * Present when an ADR-0094 mutation projector is registered for this
         * type: the outcome of the awaited post-persist projection. The
         * draft→active promotion runs the projector exactly as a direct active
         * save does, so this is the same receipt `saveMetaItem` returns.
         *
         * [#7294] It was ASSIGNED below and missing from this annotation, so
         * the method's declared type denied a key the wire body carried — the
         * same declared-≠-returned gap one layer down from the one #7294
         * closed on the spec side.
         */
        projectionApplied?: MutationProjectionOutcome;
        /**
         * [#9176] Present ONLY when the #4463 runtime authoring gate raised at
         * least one non-blocking finding against the draft body this promotion
         * carried to `active` — an empty array is never emitted, so a clean
         * publish's response bytes are unchanged (the #4717 discipline, one
         * door over). Every entry is `warning`/`info` by construction: an
         * `error` finding refuses the promotion as the 422 instead.
         */
        advisories?: RuntimeAuthoringIssue[];
    }> {
        // [#28355] A refusal that carries no row of its own leaves its `denied` row here.
        return withRefusalAudit((entry) => this.recordMetadataAudit(entry), {
            operation: 'publish', type: request.type, name: request.name, actor: request.actor,
            source: 'protocol.publishMetaItem',
        }, () => this.publishMetaItemUnaudited(request));
    }

    /** Docblock and body: {@link ProtocolHistoryAndPublishFacet.publishMetaItemUnaudited} in `protocol-history-and-publish.ts` [#29985 codemod]. */
    private async publishMetaItemUnaudited(request: PublishMetaItemRequest): Promise<{
        success: boolean;
        version: string;
        seq: number;
        message?: string;
        /**
         * Present when a `seed` draft was published: the result of materializing
         * its rows. Publishing the metadata ALWAYS succeeds independently — a
         * seed-load problem is surfaced here, never thrown, so callers (and UIs)
         * must check `seedApplied.success` instead of assuming data went live.
         */
        seedApplied?: {
            success: boolean;
            inserted: number;
            updated: number;
            error?: string;
            errors?: unknown[];
            /** [#30348] Per object, the rows created vs matched — `SeedAppliedLandedSchema`. */
            landed?: SeedAppliedLandedParsed[];
        };
        /**
         * Present when a publish-time materializer is registered for this type
         * (ADR-0086 P2 — e.g. `flow`): the result of projecting the published
         * body into its data-plane representation. Best-effort,
         * same contract as `seedApplied` — surfaced, never thrown.
         */
        materializeApplied?: PublishMaterializeResult;
        /**
         * Present when an ADR-0094 mutation projector is registered for this
         * type: the outcome of the awaited post-persist projection. The
         * draft→active promotion runs the projector exactly as a direct active
         * save does, so this is the same receipt `saveMetaItem` returns.
         *
         * [#7294] It was ASSIGNED below and missing from this annotation, so
         * the method's declared type denied a key the wire body carried — the
         * same declared-≠-returned gap one layer down from the one #7294
         * closed on the spec side.
         */
        projectionApplied?: MutationProjectionOutcome;
        /**
         * [#9176] Present ONLY when the #4463 runtime authoring gate raised at
         * least one non-blocking finding against the draft body this promotion
         * carried to `active` — an empty array is never emitted, so a clean
         * publish's response bytes are unchanged (the #4717 discipline, one
         * door over). Every entry is `warning`/`info` by construction: an
         * `error` finding refuses the promotion as the 422 instead.
         */
        advisories?: RuntimeAuthoringIssue[];
    }> {
        // [#29985 codemod] The body moved to `protocol-history-and-publish.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolHistoryAndPublishFacet.publishMetaItemUnaudited(protocolHost(this), request);
    }

    /** Docblock and body: {@link ProtocolHistoryAndPublishFacet.promoteDraftForPublish} in `protocol-history-and-publish.ts` [#29985 codemod]. */
    private async promoteDraftForPublish(request: {
        type: string; name: string; actor?: string; message?: string;
        /**
         * [#8907] ADR-0048 — the package binding of the draft being promoted,
         * when the caller listed it under one. Threaded straight into
         * `repo.promoteDraft` so the promotion resolves the draft under the
         * SAME key it was listed by.
         *
         * `undefined` (any caller with no binding to state) names no package:
         * [#23495] the draft the draft save naming no package writes
         * ({@link packagelessDraftAddress}), never the first draft row a
         * package-agnostic read meets. `null` pins the lookup to
         * the unbound row — so the field is passed through only when the caller
         * actually has a binding to state. [commit 490879ad0] That parenthetical used to
         * read "the `publishMetaItem` path, which names no package"; since
         * commit 9e04c3e35 the per-item door names one whenever its HTTP caller does, so
         * `undefined` is now about the ABSENCE of a binding, never about which
         * caller is on the other end.
         */
        packageId?: string | null;
        /**
         * [#10377] The OTHER drafts this promotion is part of a batch with,
         * projected into the gate's context collections. Forwarded verbatim to
         * {@link assertRuntimeAuthoringRules} — this method computes nothing
         * from it and holds no opinion about its contents.
         *
         * Stated by `publishPackageDrafts` (a package publishes as a unit);
         * absent on the `publishMetaItem` path, whose batch is one item, so a
         * "same-batch" closure would be the item itself and change nothing.
         */
        pending?: RuntimePendingDeclarations;
        /**
         * [#26724] The names of the datasource drafts this promotion's batch
         * publishes with it, for {@link unknownDatasourceSaveRefusal}: an
         * object draft may name one. Stated by `publishPackageDrafts`; absent
         * on the `publishMetaItem` path, where the datasource must be live.
         */
        batchDatasources?: ReadonlySet<string>;
        /**
         * [#28990] The names of the object drafts this promotion's batch
         * publishes with it, for {@link unknownGrantObjectSaveRefusal}: a
         * permission-set draft may grant on one. Stated by
         * `publishPackageDrafts`; absent on the `publishMetaItem` path, where
         * the object must exist already.
         */
        batchObjects?: ReadonlySet<string>;
        /**
         * [#22877] The bundle member whose draft to promote; omitted, the
         * canonical one. The draft read, the gate's read and the promotion
         * all address it, so the body judged is the body that goes live.
         */
        member?: string;
    }): Promise<{
        singularType: string;
        /**
         * [#9176] The #4463 gate's advisory half for this promotion — the
         * non-blocking findings `assertRuntimeAuthoringRules` RETURNS (its
         * gating half throws before this method resolves). Empty when the
         * gate raised nothing or did not run (no draft, package-author
         * channel); `publishMetaItem` attaches it to its response only when
         * non-empty, exactly as `saveMetaItem` does one door over. [#9343]
         * The batch caller (`publishPackageDrafts`) reads it too and attaches
         * it to the matching `published[]` element, same omitted-when-empty
         * discipline — per the maintainer's ruling, no parallel top-level map.
         */
        advisories: RuntimeAuthoringIssue[];
        result: { version: string; seq: number; item: MetadataItem; packageId: string | null };
    }> {
        // [#29985 codemod] The body moved to `protocol-history-and-publish.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolHistoryAndPublishFacet.promoteDraftForPublish(protocolHost(this), request);
    }

    /** Docblock and body: {@link ProtocolHistoryAndPublishFacet.runPublishSideEffects} in `protocol-history-and-publish.ts` [#29985 codemod]. */
    private async runPublishSideEffects(args: {
        singularType: string;
        name: string;
        body: unknown;
        packageId: string | null;
        actor?: string;
        skipSeedApply?: boolean;
    }): Promise<{
        seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[]; landed?: SeedAppliedLandedParsed[] };
        materializeApplied?: PublishMaterializeResult;
        projectionApplied?: MutationProjectionOutcome;
        storageRefused?: RuntimeAuthoringIssue;
    }> {
        // [#29985 codemod] The body moved to `protocol-history-and-publish.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolHistoryAndPublishFacet.runPublishSideEffects(protocolHost(this), args);
    }

    /**
     * Materialize published `seed` bodies into data rows via the SeedLoaderService
     * (externalId-keyed upsert, multi-pass for cross-seed references). Passing ALL
     * of a publish's seed bodies in ONE call lets a child seed reference a parent
     * seed's rows regardless of publish order. Best-effort: any failure is
     * returned, never thrown — publishing metadata must not be blocked by a data
     * problem, but the caller surfaces `seedApplied` so the failure is LOUD.
     */
    private async applySeedBodies(
        bodies: unknown[],
    ): Promise<{
        success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[];
        issues?: Array<{ path: string; message: string; code?: string | undefined }>;
        landed?: SeedAppliedLandedParsed[];
    }> {
        // [#25467 cut 14] The body moved to `protocol-publish-batch.ts` (see `PublishBatchHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof applySeedBodies> = {
            get engine() { return readEngine(); },
            getMetaItem: (...a) => this.getMetaItem(...a),
            // [#25779] The `field-files` service, so a published seed's files
            // are stored as the boot seed's are.
            getFieldFiles: () => this.getServicesRegistry?.().get(FIELD_FILE_SERVICE) as IFieldFileService | undefined,
        };
        return applySeedBodies.call(host, bodies);
    }

    /**
     * List pending DRAFT metadata (ADR-0033) for the org, optionally narrowed
     * by `packageId` and/or `type`. The list reads of `getMetaItems` only see
     * the ACTIVE registry; this exposes what an AI authored but a human hasn't
     * published yet, so the console can show a "pending changes" surface and a
     * just-built app package isn't displayed as empty. No body is returned —
     * only its own `label` ([#22200]), the one member a draft-only item can be
     * shown by other than its machine name, passed through from
     * {@link SysMetadataRepository.listDrafts} as the repository projects it.
     *
     * [#23073] `member` tells two drafts of one bundle apart (ruling
     * 6116165299, letter A: each member is addressable by name). It is the
     * repository header's stored member, the column the package-batch doors
     * promote and discard by, with the canonical member spelled out, as the
     * by-name doors' `member` selector takes it back
     * ({@link bundleMemberDiscriminator}); absent for a type with no members.
     *
     * [#7557, #24210] A disabled package's drafts are omitted, as the list
     * read omits its items and the by-name draft read answers them `404
     * NO_DRAFT`: each row's `packageId`, asked of the same predicate ({@link
     * isItemOfDisabledPackage}); `package` is never hidden. This method serves
     * the `_drafts` doors only. The package batch doors (publish, discard, the
     * batch closure) read the repository's `listDrafts` directly, so a
     * disabled package's drafts still publish and discard.
     *
     * [#29180] A `packageId` naming a package that is not installed and that
     * no pending draft is bound to is refused `400 INVALID_REQUEST`, the
     * diagnostics sweep's rule for its own package filter, rather than
     * answered an empty list a caller reads as "nothing pending". An unknown
     * `type` is refused by the transports before this is called, with the
     * list door's verdict.
     */
    async listDrafts(request?: {
        packageId?: string;
        type?: string;
    }): Promise<{
        drafts: Array<{
            type: string;
            name: string;
            /** [#23073] The bundle member the draft is (`'zh-CN'`, the canonical `'en-US'`); absent for a type with no members. */
            member?: string;
            /** The draft body's own top-level `label`, as authored; `null` when it declares none. */
            label: I18nLabel | null;
            packageId: string | null;
            updatedAt: string | null;
            updatedBy: string | null;
        }>;
    }> {
        // [#25467 cut 12] The body moved to `protocol-drafts.ts` (see `DraftsHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof listDrafts> = {
            get engine() { return readEngine(); },
            ensureOverlayIndex: (...a) => this.ensureOverlayIndex(...a),
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            getMetaItems: (...a) => this.getMetaItems(...a),
        };
        return listDrafts.call(host, request);
    }

    /**
     * [#10377] The batch's own pending declarations, projected into the gate's
     * context collections — the half of the closure that makes a package
     * publishable as a SELF-CONSISTENT UNIT.
     *
     * ## What was broken
     *
     * `assertRuntimeAuthoringRules` resolves every context collection off
     * `engine.registry`, i.e. the LIVE universe. A draft is not in it — the
     * write-through runs on `mode: 'publish'` — and the batch's own promotions
     * do not put it there either, because `applyRegistryWriteThrough` lives in
     * Phase 2, after the Phase-1 transaction in which every draft is gated and
     * promoted. So while a batch is being judged NO sibling of that batch is
     * visible to any other member's gate pass, in ANY order. Measured
     * 2026-08-21 on a cloud rig: a package carrying `dataset/shyx_customer_ds`
     * and a `dashboard` whose widget binds it rolled back at the dashboard
     * with `[widget-dataset-unknown] … does not resolve to a declared
     * dataset`, on every attempt and under both dataset names the author
     * tried. The dataset was in the same batch, three rows away.
     *
     * ## Why the bodies are read here and not inside the loop
     *
     * The promote DELETES the draft row (`repo.promoteDraft` = active-row put +
     * draft delete), so a body read after the first promotion is a body that
     * may already be gone — the same reason the seed capture inside Phase 1
     * reads BEFORE its own promote. Reading the whole set up front also makes
     * the closure ORDER-INDEPENDENT by construction rather than by luck of
     * iteration: every member is judged against the same complete set.
     *
     * ## Scope, and why no extra filtering is needed
     *
     * `drafts` is already exactly this package's pending set — `listDrafts`
     * narrows by `package_id`, and surfaces env-wide plus own-org rows, which
     * is precisely the population the caller is about to promote. So the
     * closure is "this package's own declarations", restated from the list the
     * batch is defined by, never a second query with a second scope.
     *
     * ⛔ Read failures PROPAGATE — a repository that HAS the read and fails it
     * is a fault, not a miss. This runs before Phase 1's transaction, so
     * nothing has been written and the publish fails having changed nothing,
     * and every row read here is a row `promoteDraftForPublish` is about to
     * read again anyway. Swallowing would silently shrink the closure, which
     * does not fail open — it manufactures a refusal that names a declaration
     * the author can SEE in their own package (ADR-0110 D3: a miss and a fault
     * are different facts). The MISSING-member case is the other fact and is
     * handled below, loudly and without a throw.
     *
     * ## Why the batch's existing enumeration cannot supply the bodies
     *
     * `listDrafts` — the read that DEFINES this batch — is a declared header
     * projection: it maps rows to `(type, name, label, packageId, updatedAt,
     * updatedBy)` and drops `metadata` on purpose — of the
     * body only its own top-level `label` leaves ([#22200]) — because its other
     * caller is the console's "pending changes" list. Widening it would put
     * every draft BODY on that listing, and it would not even remove the guard
     * below: the doubles that lack `repo.get` stub `listDrafts` too, so a
     * body-carrying projection would hand back headers there anyway — degrading
     * SILENTLY instead of degrading with a reason. So the second read stays,
     * and the absence of the member it needs is stated rather than assumed.
     */
    private async collectBatchPendingDeclarations(
        drafts: ReadonlyArray<{ type: string; name: string; member?: string }>,
    ): Promise<RuntimePendingDeclarations | undefined> {
        // [#25467 cut 14] The body moved to `protocol-publish-batch.ts` (see `PublishBatchHost`).
        const host: ThisParameterType<typeof collectBatchPendingDeclarations> = {
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
            warnClosureReadUnavailable: (...a) => this.warnClosureReadUnavailable(...a),
        };
        return collectBatchPendingDeclarations.call(host, drafts);
    }

    /**
     * [#10377] Say WHY the batch closure degraded — once per process.
     *
     * A bare degrade is the failure shape this repo has paid for before: a gate
     * that quietly stops seeing part of its input reads as "clean", and the
     * only symptom is a refusal somewhere else that names a declaration the
     * author can see. So the reason is stated, with the member that was
     * missing and what the consequence is.
     *
     * Deduped because Studio republishes the same package repeatedly and a
     * repository shape does not change between two publishes — the first line
     * carries the whole fact, and the hundredth adds nothing.
     */
    private warnClosureReadUnavailable(type: string, name: string): void {
        // [#25467 cut 33] The body moved to `protocol-loud-degradations.ts` (see `LoudDegradationsHost`).
        const readClosureReadWarned = () => this.closureReadWarned;
        const writeClosureReadWarned = (value: ObjectStackProtocolImplementation['closureReadWarned']) => { this.closureReadWarned = value; };
        const host: ThisParameterType<typeof warnClosureReadUnavailable> = {
            get closureReadWarned() { return readClosureReadWarned(); },
            set closureReadWarned(value) { writeClosureReadWarned(value); },
        };
        return warnClosureReadUnavailable.call(host, type, name);
    }

    /** One warn per process for the {@link warnClosureReadUnavailable} degrade. */
    private closureReadWarned = false;

    /**
     * [#24253] The judgement half of a `publishPackageDrafts` backfill, run
     * before anything is promoted. An entry is honoured only when this batch
     * holds an `object` draft of that name, the draft declares the field, the
     * object the engine serves today does NOT (only a field this publish adds
     * may be filled, so no value a user wrote is ever overwritten), and the
     * field declares a literal `defaultValue`. A runtime token (`NOW()`,
     * `current_user`) or an expression envelope is resolved per insert against
     * that insert's context, so there is no one value to stamp into rows
     * written by other people at other times: refused, named.
     *
     * Every failing entry is collected, so one answer names them all.
     */
    private async planPublishBackfill(
        packageId: string,
        entries: ReadonlyArray<{ object: string; field: string }>,
        drafts: ReadonlyArray<{ type: string; name: string; member?: string }>,
    ): Promise<PublishBackfillEntry[]> {
        // [#25467 cut 12] The body moved to `protocol-publish-backfill.ts` (see `PublishBackfillHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof planPublishBackfill> = {
            get engine() { return readEngine(); },
            getOverlayRepo: (...a) => this.getOverlayRepo(...a),
        };
        return planPublishBackfill.call(host, packageId, entries, drafts);
    }

    /**
     * [#24253] The write half: for each planned field, the rows whose value is
     * absent get the field's literal default, a page at a time, AS THE CALLER.
     * Each page goes through {@link updateManyData} with the caller's context,
     * the bulk face of the by-id PATCH, so permissions, RLS/FLS, validation and
     * record hooks run per row as on that caller's own edit, and a row the
     * caller cannot see is not read.
     *
     * The publish has committed by now and is not undone by a failed write. A
     * field stops at its first failing row and reports the rows written so far
     * with the error, by name; the other fields still run. A row is counted
     * only when the engine kept the value: a row whose field a rule stripped
     * (`droppedFields`), or that reads back empty after it was written, stops
     * the field instead of looping on it.
     */
    private async applyPublishBackfill(
        packageId: string,
        plan: ReadonlyArray<PublishBackfillEntry>,
        context: unknown,
    ): Promise<PublishBackfillReceipt> {
        // [#25467 cut 12] The body moved to `protocol-publish-backfill.ts` (see `PublishBackfillHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof applyPublishBackfill> = {
            get engine() { return readEngine(); },
            updateManyData: (...a) => this.updateManyData(...a),
        };
        return applyPublishBackfill.call(host, packageId, plan, context);
    }

    /**
     * Publish every pending DRAFT bound to a package in one shot (ADR-0033) —
     * the "publish whole app" action. Promotes each draft→active by reusing the
     * per-item {@link publishMetaItem} primitive (which runs the overridable /
     * lock guards and refreshes the runtime registry), so this needs NO
     * `metadata` service (unlike `MetadataService.publishPackage`, which reads
     * the in-memory registry and 503s when that service is absent). Per-item
     * failures are collected and do NOT abort the rest.
     *
     * [#9406] The wire face of this return is DECLARED:
     * `PublishPackageDraftsResponseSchema` in `@objectstack/spec/api` (the
     * #5745/#7294 "declared = returned" pair, batch door). The declaration
     * covers this object PLUS the REST door's mutations (`seedApplied`
     * back-fill and the ADR-0045 `unhiddenApps`/`unhideError`/`rebindError`
     * receipts in `packages/runtime/src/domains/packages.ts`). Changing this
     * return type means updating the schema and its two conformance suites
     * (`packages/objectql/src/publish-package-drafts-response-conformance.test.ts`,
     * `packages/runtime/src/domains/packages-publish-drafts-response-conformance.test.ts`)
     * in the same PR. `probes` is deliberately opaque in the declaration —
     * upgrade it only on a consumer-driven card (#9406 ruling).
     */
    async publishPackageDrafts(request: {
        packageId: string;
        actor?: string;
        /**
         * ADR-0067 — commit message (for AI turns: the user's instruction).
         * [ADR-0146 D1] Also the change note of every item this publish
         * promotes: each `sys_metadata_history` row it writes records it as
         * `change_note`. Absent or empty, those rows keep the sentence naming
         * the package.
         */
        message?: string;
        /** ADR-0067 — AI model that authored the turn (absent for human/CLI). */
        aiModel?: string;
        /**
         * [#24253] Opt-in: fields THIS publish adds whose literal
         * `defaultValue` is written into the object's existing rows once the
         * drafts are live. Absent or empty, no row is touched. Every entry is
         * judged before anything is promoted ({@link planPublishBackfill}), and
         * one that cannot be honoured refuses the whole request.
         */
        backfill?: ReadonlyArray<{ object: string; field: string }>;
        /**
         * [#24253] The caller's execution context: the principal the
         * `backfill` writes run as, so object permissions, RLS/FLS and record
         * hooks apply exactly as they do to that caller's own edit. Required
         * when `backfill` names anything. [#25484] The build probes read as it
         * too: a dashboard widget is probed through `queryDataset` as this
         * caller, the renderer's path, never as the system.
         */
        context?: unknown;
    }): Promise<{
        success: boolean;
        /**
         * [#10462] First-class discriminant for WHICH exit answered — the fact
         * `success` alone cannot carry: a publish with nothing to promote and
         * a genuine refusal both answer `success: false` (cloud#1488 graded
         * the former as a rollback and burned two repair rounds on artifacts
         * that were already correct). Producer invariants, pinned in the
         * conformance suites: `outcome === 'refused'` if and only if
         * `failed.length > 0`; `outcome === 'nothing_to_publish'` if and only
         * if `published.length === 0 && failed.length === 0`; and
         * `success === (outcome === 'published')` — `success` keeps its exact
         * pre-#10462 value and is now derivable. Values are lowercase snake,
         * matching the `sys_metadata_audit` outcome vocabulary.
         */
        outcome: 'published' | 'refused' | 'nothing_to_publish';
        publishedCount: number;
        failedCount: number;
        published: Array<{
            type: string;
            name: string;
            version: string;
            /**
             * [#9343] The #4463 runtime authoring gate's non-blocking findings
             * for THIS draft's promotion — the same element shape and the same
             * omitted-when-empty discipline as
             * `PublishMetaItemResponseSchema.advisories` on the single-item
             * door (#9176), riding each `published[]` element per the
             * maintainer's ruling (no parallel top-level map). Present ONLY
             * when the gate raised at least one finding against this draft —
             * an empty array is never emitted, so an advisory-free batch's
             * response bytes are unchanged. Advisory by construction: every
             * entry is `warning`/`info`, because an `error` finding refuses
             * the promotion and — the batch being all-or-nothing (ADR-0067
             * D2) — aborts the whole batch as `failed[]` instead;
             * `failed[]` elements never carry this key.
             */
            advisories?: RuntimeAuthoringIssue[];
        }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
        /** Aggregate result of materializing every published `seed` (absent when no seeds). */
        seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[]; landed?: SeedAppliedLandedParsed[] };
        /**
         * ADR-0086 P2 — aggregate result of publish-time materializers across the
         * batch (e.g. `flow`). Absent when no published item had a registered
         * materializer. `failures` names each item whose projection did NOT
         * land, so the caller surfaces it instead of reporting a clean publish
         * over an item that never went live.
         */
        materializeApplied?: {
            success: boolean;
            inserted: number;
            updated: number;
            failures: Array<{ type: string; name: string; error: string }>;
        };
        /**
         * ADR-0038 L3 — post-publish runtime probe report (absent when nothing
         * was publishable). One real read per published artifact: seeded
         * objects must have rows, views must be readable, dashboard widgets'
         * dataset selections must execute and return data. `issues` carries
         * BuildIssue-shaped findings (layer 'runtime') for the agent / chat
         * health surfaces; probes never fail the publish itself.
         */
        probes?: import('./build-probes.js').BuildProbeReport;
        /** ADR-0067 — id of the commit this publish recorded (absent if nothing published). */
        commitId?: string;
        /**
         * [#24253] What the requested `backfill` wrote, per field — present
         * only when the request named at least one field and the batch
         * published. See {@link applyPublishBackfill}.
         */
        backfillApplied?: PublishBackfillReceipt;
    }> {
        // [ADR-0131 D6] FIRST: an organization-scoped package publish is
        // refused. See {@link organizationScopedWriteRefusal}.
        ObjectStackProtocolImplementation.refuseOrganizationScopedWrite(
            `Package '${request.packageId}'`, request,
        );
        // [#24253] The request's own shape is judged before any server state
        // is read; what it names is judged against the drafts below.
        const backfillRequest = readPublishBackfillRequest(request.packageId, request.backfill, request.context);
        await this.ensureOverlayIndex();
        // Environment-wide drafts only: the environment repository lists the
        // environment's rows (a legacy organization's is left out off the
        // physical column), so a legacy organization-scoped draft
        // is never promoted here (it waits for the promotion ceremony,
        // ADR-0131 C7).
        const repo = this.getOverlayRepo();
        const drafts = await repo.listDrafts({ packageId: request.packageId });
        // [#24253] Before anything is promoted: a backfill entry that cannot be
        // honoured refuses the request whole, so a publish never lands with
        // half of what its caller asked for.
        const backfillPlan = backfillRequest.length > 0
            ? await this.planPublishBackfill(request.packageId, backfillRequest, drafts)
            : [];

        // Runtime enforcement of the package namespace-prefix rule (ADR-0028
        // current-state contract). `defineStack` enforces this at compile time,
        // but Studio-authored packages never take that path — so a bare,
        // collision-prone object name (`ticket` instead of `leave_ticket`)
        // could publish unchecked. Read the package's DECLARED namespace and
        // reject any object draft missing the `<ns>_` prefix BEFORE promoting
        // anything — the publish is atomic, so one bad name fails the whole
        // batch with an actionable message. Like `defineStack`, we do NOT
        // invent a prefix here when the package declares no namespace (legacy
        // packages are grandfathered); the default is derived+persisted once at
        // install time (`installPackage`), so real Studio packages always have
        // one by the time they publish.
        //
        // [#24547] The verdict is {@link objectNamespacePrefixViolation}'s, the
        // judge the direct save in {@link saveMetaItem} and the per-item
        // publish ({@link promoteDraftForPublish}) ask too, so the three doors
        // give one verdict and one sentence for one name in one package.
        /**
         * Every PRE-FLIGHT refusal of this batch, in one report.
         *
         * The namespace-prefix rule established the posture and the
         * ADR-0121 endpoint gates below join it: a violation is found BEFORE
         * anything is promoted, and it fails the WHOLE batch
         * (`publishedCount: 0`, `published: []`) rather than publishing the
         * healthy siblings around it. That is not a choice made here — it is
         * ADR-0067 D2's turn-atomicity ("a commit cannot half-land") read
         * backwards onto the pre-flight, and it is what `MetadataManager.
         * publishPackage` does with the same gates on the other path (#5189):
         * one `validationErrors` list, `itemsPublished: 0`.
         *
         * Both gates run before the report is returned, so an author fixing a
         * package sees the object-name violations AND the endpoint violations
         * in one round trip instead of one class per publish attempt.
         */
        const preflightViolations: Array<{
            type: string;
            name: string;
            error: string;
            code: PreflightViolationCode;
        }> = [];
        for (const d of drafts) {
            if (d.type !== 'object') continue;
            const err = this.objectNamespacePrefixViolation(d.name, request.packageId);
            if (err) {
                preflightViolations.push({
                    type: d.type,
                    name: d.name,
                    error: err,
                    code: 'NAMESPACE_PREFIX',
                });
            }
        }

        // ═══ [#8908] The AT-REST spelling gate ════════════════════════════════
        //
        // The second pre-flight rule, and the one route by which the namespace
        // #7894 retired could still mint ACTIVE rows. See
        // {@link isNonCanonicalStoredType} for the class and for why the
        // manifest-PRESENT plurals are deliberately NOT in it.
        //
        // Refused here, at the pre-flight, rather than by folding the stored
        // spelling at the promote — that alternative was weighed and ruled
        // against on #8908 (auto-adjudicated 2026-08-15, option (a)). Folding
        // would make these rows behave like `objects`: unpromotable, batch
        // aborted on `NO_DRAFT`, which is fail-closed but strands the operator
        // with a verdict that describes a missing draft rather than the residue
        // they actually have. The refusal below names the row, names the
        // canonical spelling, and says what to do about it — the shape the
        // namespace-prefix gate above already established, and batch-atomic for
        // the same ADR-0067 D2 reason.
        //
        // ⛔ What this deliberately does NOT do: migrate the row. A
        // `_migrate-stored` / boot-reconciliation conversion was the other
        // option on the card and is explicitly NOT ruled — it stays available as
        // a follow-up with its own appetite. Do not grow one here.
        //
        // ⚠️ The reason the message does not just say "run the stored
        // migration", and STILL does not: `migrateStoredMetadata` canonicalizes
        // BODIES, and rewriting a stored type spelling is an identity move, so
        // that door cannot fix this residue either. What changed under #8957 is
        // only what it SAYS about it. When this comment was written it scanned
        // with `PLURAL_TO_SINGULAR[rawType] ?? rawType` — the same manifest map
        // — so for exactly these spellings it converted bodies under the plural
        // key, found nothing to change, and reported the row `canonical`:
        // "nothing to do" about the row this gate had just refused, from the
        // door an operator naturally reaches for next. It now scans with the
        // canonical fold and reports the row `skipped`, carrying this same
        // reason. The two doors agree; neither migrates it, and the actionable
        // instruction is still the re-author path, stated in full.
        for (const d of drafts) {
            if (!isNonCanonicalStoredType(d.type)) continue;
            const canonical = canonicalMetaType(d.type);
            preflightViolations.push({
                type: d.type,
                name: d.name,
                error: `Draft '${d.type}/${d.name}' is stored under the non-canonical metadata type `
                    + `'${d.type}'; the canonical type for this item is '${canonical}'. Publishing it would `
                    + `mint an ACTIVE row in a second namespace that no registry read and no compliance `
                    + `query on '${canonical}' can see (the '/meta' URL door now folds a type to its canonical spelling before it writes; `
                    + `this row predates that). Re-author the item under '${canonical}' `
                    + `(PUT /meta/${canonical}/${d.name}) and drop the '${d.type}' row. Note that `
                    + `POST /meta/_migrate-stored does NOT rewrite a stored type spelling — it canonicalizes `
                    + `bodies, and reports rows of this class as 'skipped' with that same reason.`,
                code: 'STORED_TYPE_NOT_CANONICAL',
            });
        }

        // [#5488 — RETIRED GATE, recorded overturn of PR #5279]
        //
        // `gateApiDraftsForPublish` stood here (#5206 step 2, #5040 E7 /
        // ADR-0121) and ran the endpoint publish gates over this batch's `api`
        // drafts. It is deliberately REMOVED, two days after it landed, by the
        // maintainer ruling of 2026-08-07T16:59Z implemented in #5488 — not
        // deleted as dead weight and not lost in a refactor.
        //
        // Why it can go: the gate judged whether an `api` draft was fit to be
        // PROMOTED TO ACTIVE in `sys_metadata`. No such row is ever served. The
        // serving criterion belongs to `IMetadataService.matchEndpoint` →
        // `EndpointMatcher` → `MetadataManager.listForIndex('api')`, which
        // reads the manager's registry plus its filesystem/memory loaders;
        // `sys_metadata` is in neither, so a promoted endpoint 404s forever
        // (real boot, #5488 — no `EXCLUDED` line, because it was never in the
        // index to be excluded from). The gate was a correct verdict about a
        // state with no consumer.
        //
        // Why it MUST go rather than sit unreached: `api` is now code-only
        // (`allowRuntimeCreate: false` + `allowEnvironmentOverlay: false`), and the
        // #5086 inlet refuses the write BEFORE persistence and BEFORE the
        // draft/publish branch — it does not look at `mode`. So no `api` draft
        // row can be created any more, and this gate could never again see one.
        // Leaving it would leave unreachable code asserting a rule about a row
        // that cannot exist, which is the shape of a phantom check.
        //
        // What still judges endpoints, unchanged: `validateApiEndpointDeclarations`
        // / `identityFreeEndpointGateFailure` (`api/endpoint-publish-gate.ts`)
        // on the route that actually serves — the stack schema, `publishPackage`
        // (#5189), and again at load in `buildEndpointIndex` (PR #5203). ADR-0121
        // keeps its "publish REJECTS" ruling in full on that route; only the
        // runtime-authored-draft door it used to also cover is gone, because
        // that door opened onto nothing.
        //
        // Re-entry, as the ruling recorded it: if #2657 Part B promotes `apis`
        // to a registered type WITH A REAL CONSUMPTION PATH, this gate comes
        // back with it — implementation first, declaration second.

        if (preflightViolations.length > 0) {
            // ═══ [#8595] The PRE-FLIGHT refusal's own audit rows ═══════════════
            //
            // Without these, this `return` left `sys_metadata_audit` completely
            // empty: a package refused for a bad object name was indistinguish-
            // able in the trail from a package nobody ever pressed Publish on —
            // the #7748 defect, at the one refusal site neither #8400 nor #8594
            // could reach. Both of those write from BELOW: #8400's rows are
            // driven off the post-commit state and its `batch_aborted` row from
            // the transaction's `catch`, and #8594's inner verdicts ride out on
            // an error thrown inside the promotion loop. This `return` is ABOVE
            // `engine.transaction()`, so no error is ever thrown and no
            // promotion is ever attempted — control never reaches either site.
            //
            // ── Shape: ONE ROW PER VIOLATION, keyed on its own (type, name) ───
            //
            // Not one row for the batch. A pre-flight refusal is not "one causal
            // item aborted the batch" — it is N violations, each naming a
            // different draft, so there is no single causal item to key a batch
            // row on. `batch_aborted`'s own note records why that matters: the
            // audit row is keyed on `(type, name)`, and minting an identity for
            // an unattributable failure "would put a fictional item in a
            // compliance ledger" — which is exactly what a single batch-level
            // row would need here. Every violation, by contrast, already HAS an
            // honest identity: the draft that broke the rule.
            //
            // Measured against the reader rather than assumed: `auditMetaItem`
            // (the door `GET /api/v1/meta/:type/:name/audit` serves Studio's
            // audit-log tab from) queries `where { type, name }` ordered by
            // `occurred_at desc`. One row per violation is therefore readable
            // per item; a synthetic batch row would be readable under no real
            // item at all.
            //
            // ── Durability ────────────────────────────────────────────────────
            //
            // Written outside any transaction because there is not one here yet
            // — the pre-flight is the code above `engine.transaction()`. So
            // unlike every other denial on this route there is nothing to
            // survive: the row lands when it is written. `publishPackageDrafts`
            // audits its refusals from a position a rollback cannot reach at
            // every site, and this one gets it by construction.
            for (const v of preflightViolations) {
                await this.recordMetadataAudit({
                    // [#8908] THE BOUNDARY FOLD, on the route that reads rows at
                    // rest. `v.type` is the STORED spelling, which for a
                    // `STORED_TYPE_NOT_CANONICAL` violation is by definition not
                    // the canonical one — and `recordMetadataAudit` now refuses a
                    // non-canonical `type` outright rather than folding it
                    // silently (see its header). Folding here is not merely what
                    // makes the writer's assert satisfiable: it is what makes the
                    // row READABLE. `auditMetaItem` serves
                    // `GET /meta/:type/:name/audit`, whose own `:type` segment is
                    // folded at the `/meta` boundary, so a row filed under the
                    // plural spelling is a row no operator can query for. The
                    // stored spelling is not lost — it is named in `note` and in
                    // `failed[].error`, where it is the actionable fact.
                    type: canonicalMetaType(v.type),
                    name: v.name,
                    organizationId: null,
                    operation: 'publish',
                    outcome: 'denied',
                    // The violation's own verdict, in the audit column's
                    // lowercase vocabulary — the value a compliance query
                    // filters on. See `PREFLIGHT_AUDIT_CODE` for why this one
                    // carries the specific rule while `batch_aborted` carries a
                    // fixed value.
                    code: PREFLIGHT_AUDIT_CODE[v.code],
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.publishPackageDrafts',
                    // `note` is WIRE-VISIBLE (`auditMetaItem` maps it straight
                    // onto the `/audit` response). Safe here: this text is
                    // `validateObjectNamespacePrefix`'s own authored, actionable
                    // message — no driver dialect to withhold, unlike the
                    // `batch_aborted` note's `clientFacingFailureText`.
                    note: `refused before publish — package '${request.packageId}': ${v.error}`,
                });
            }
            return {
                success: false,
                // [#10462] Guarded by `preflightViolations.length > 0`, so
                // `failed[]` is non-empty by construction — this exit is
                // always a refusal.
                outcome: 'refused',
                publishedCount: 0,
                failedCount: preflightViolations.length,
                published: [],
                // Projected explicitly: `organizationId` is internal bookkeeping
                // for the audit rows above and must not widen this response.
                failed: preflightViolations.map((v) => ({
                    type: v.type, name: v.name, error: v.error, code: v.code,
                })),
            };
        }

        const published: Array<{ type: string; name: string; version: string; advisories?: RuntimeAuthoringIssue[] }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string; issues?: Array<{ path: string; message: string; code?: string }> }> = [];

        // Structure first, seeds LAST — a seed's rows can only land after its
        // object's table exists (publishMetaItem creates it). Within the seeds we
        // batch-apply every body in ONE loader pass below (multi-pass reference
        // resolution across the whole set), so per-item apply is suppressed.
        const ordered = [
            ...drafts.filter((d) => d.type !== 'seed'),
            ...drafts.filter((d) => d.type === 'seed'),
        ];
        const seedBodies: unknown[] = [];

        // [#10377] The closure this batch is judged against, read ONCE and
        // BEFORE any promotion (a promote deletes the draft row it reads).
        // Every member of the batch is then gated against the same complete
        // set, which is what makes a dashboard-plus-its-dataset package
        // publishable in either order — see
        // {@link collectBatchPendingDeclarations}.
        const pendingDeclarations = await this.collectBatchPendingDeclarations(drafts);
        const batchDatasources: ReadonlySet<string> = new Set(
            drafts.filter((d) => canonicalMetaType(d.type) === 'datasource').map((d) => d.name),
        );
        const batchObjects: ReadonlySet<string> = new Set(
            drafts.filter((d) => canonicalMetaType(d.type) === 'object').map((d) => d.name),
        );

        // ADR-0067 — capture each artifact's PRE-publish state so this turn can
        // be recorded as ONE revertible commit. existedBefore=false → the commit
        // creates it (revert = soft-remove); true → it edits an existing artifact
        // (revert = restoreVersion(prevVersion)).
        //
        // [#8896] This paragraph used to end "Best-effort: a capture failure
        // just omits that item from the revert plan, never blocks the publish."
        // Both halves were wrong, and they were wrong in different directions —
        // the comment described the code inaccurately, AND the behaviour it
        // described would not have been correct either:
        //
        //   * The code never omitted. It pushed a FABRICATED entry —
        //     `existedBefore: false, prevVersion: null` — i.e. the literal
        //     opposite of the healthy branch's `existedBefore: !!activeRow` for
        //     any artifact that did exist. `existedBefore: false` means "revert
        //     = soft-remove", so reverting this commit DELETES an artifact
        //     whose previous version was supposed to be restored. A read that
        //     failed was answered with a value, and the value chosen was the
        //     destructive one.
        //   * Omitting would not have been the fix. An item missing from the
        //     plan is simply not reverted, so the revert silently leaves the
        //     newly published version live while reporting the turn undone.
        //
        // Both are the same defect underneath: a revert plan derived from a
        // read that did not happen. So the capture is discriminated by error
        // TYPE instead, per the maintainer's ruling for this family —
        // unprovisioned is truthful emptiness, everything else surfaces. See
        // the `catch` below for why the benign branch keeps exactly the push
        // that was wrong unconditionally.
        const commitItems: CommitPlanItem[] = [];
        for (const d of ordered) {
            try {
                // Read the pre-publish active row in the draft's scope, the
                // environment's (ADR-0131 D6), so an env-wide edit is not
                // mis-recorded as a create in the revert plan (#3115).
                // [#21911] The explicit system opt-in — see findServedOverlayRow.
                // [#22877] …and the draft's own bundle member: another
                // member's active row is not this member's pre-publish state,
                // and the revert plan records the member it describes.
                // [#29414] …and the publishing package's own row: every draft
                // listed here is bound to `request.packageId` and is promoted
                // into that package's row, so another package's active row of
                // the same name (a row bound to the read-only base beside its
                // `.custom` pair) is not this item's pre-publish state. Read
                // package-agnostically, the pair's first publish was recorded
                // as an edit of the base row's version, and its revert
                // addressed the base row instead of removing the pair's.
                const activeRow = (await this.findEnvironmentRow('sys_metadata', {
                    where: {
                        type: d.type, name: d.name, state: 'active', package_id: request.packageId,
                        ...overlayMemberWhere(d.type, d.member),
                    },
                    context: { isSystem: true },
                })) as { version?: number } | null;
                commitItems.push({
                    type: d.type,
                    name: d.name,
                    existedBefore: !!activeRow,
                    prevVersion: activeRow && typeof activeRow.version === 'number' ? activeRow.version : null,
                    ...(d.member !== undefined ? { member: d.member } : {}),
                });
            } catch (error) {
                // [#8896] Benign: `sys_metadata` has not been provisioned yet.
                // There is then genuinely no active row for anything, so
                // `existedBefore: false, prevVersion: null` IS this artifact's
                // pre-publish state and the revert plan it produces (revert =
                // soft-remove) is correct. That is the ONE case in which the
                // unconditional push above was ever right, and it is kept
                // byte-for-byte. Asked through the shared `isMissingTableError`
                // predicate (`@objectstack/metadata/errors`, #4825).
                //
                // Everything else — a connection drop, a timeout, a query
                // error — means an active row may well exist and simply was not
                // seen, so no honest `existedBefore` can be computed. It
                // propagates, and the position of this loop is what makes that
                // safe: the capture pass runs BEFORE Phase 1's transaction, so
                // nothing has been written yet and the publish fails having
                // changed nothing. Refusing to publish beats publishing with a
                // revert plan that would delete an artifact on the way back.
                //
                // No new error code and no new response field: the caller
                // receives the read's own failure, envelope intact.
                if (!isMissingTableError(error, 'sys_metadata')) throw error;
                commitItems.push({
                    type: d.type, name: d.name, existedBefore: false, prevVersion: null,
                    ...(d.member !== undefined ? { member: d.member } : {}),
                });
            }
        }
        const publishedSeqs: number[] = [];
        // ADR-0086 P2 — accumulate each item's publish-time materialization so a
        // batch package publish surfaces a permission set that failed to go live
        // (owned by the env door / another package), not just a clean count.
        const materialize = { any: false, inserted: 0, updated: 0, failures: [] as Array<{ type: string; name: string; error: string }> };

        // ═══ Phase 1 — ATOMIC metadata writes (ADR-0067 D2) ═══
        // Every draft promotion AND the sys_metadata_commit record run inside
        // ONE engine transaction: any failure rolls ALL of them back — "a
        // commit cannot half-land". Nested repository writes JOIN this
        // transaction via the engine's ambient-tx join (a nested begin would
        // deadlock single-connection pools), and side effects are deliberately
        // deferred to Phase 2: DDL cannot run inside the driver transaction,
        // in-memory registry mutations cannot roll back, and projections /
        // probes are healed by boot reconciliation — side effects can
        // self-heal, a half-landed metadata batch cannot (the ADR-0094
        // lesson). Engines without `transaction()` (memory driver, minimal
        // stubs) fall through to a plain sequential run with the same weaker
        // guarantee the repository's `withTxn` documents.
        type PromotedDraft = {
            d: { type: string; name: string; member?: string };
            singularType: string;
            body: unknown;
            packageId: string | null;
            version: string;
            seq: number;
            /**
             * [#9343] The #4463 gate's advisory half for this promotion,
             * captured from `promoteDraftForPublish`'s return inside Phase 1
             * so Phase 2 can attach it to this draft's `published[]` element.
             * Empty = the gate raised nothing (or did not run) — the element
             * then carries no `advisories` key at all.
             */
            advisories: RuntimeAuthoringIssue[];
        };
        const promoted: PromotedDraft[] = [];
        // (assigned inside the transaction closure — keep the wide type)
        let commit = null as { commitId: string } | null;
        // ADR-0119 D1 — `transaction` is contract-declared, so this reaches it
        // by name instead of through a structural cast. Bound once up front:
        // the probe and the call must agree on one resolved function.
        const engineTx = typeof this.engine?.transaction === 'function'
            ? this.engine.transaction.bind(this.engine)
            : undefined;
        const inTxn: <T>(cb: () => Promise<T>) => Promise<T> =
            engineTx ? (cb) => engineTx(() => cb()) : (cb) => cb();
        try {
            await inTxn(async () => {
                for (const d of ordered) {
                    try {
                        if (d.type === 'seed') {
                            // Capture the body BEFORE promote (the draft row is
                            // deleted by the promote, and reading the draft is
                            // unambiguous).
                            const ref = { type: d.type, name: d.name, org: 'env' } as unknown as Parameters<typeof repo.get>[0];
                            const draft = await repo.get(ref, { state: 'draft', ...memberOption(d.member) });
                            if (draft?.body) seedBodies.push(draft.body);
                        }
                        const { singularType, advisories, result } = await this.promoteDraftForPublish({
                            // [#8908] The stored spelling, FOLDED — this route's
                            // boundary, the analogue of `canonicalizeMetaRequestType`
                            // on the six `/meta` entry points. Every row that
                            // reaches here has passed the at-rest spelling gate
                            // above, so the only non-canonical spellings left are
                            // the manifest-PRESENT plurals, for which this fold and
                            // the manifest fold `promoteDraftForPublish` already
                            // applies agree exactly — the promote resolves the same
                            // row it always did, and `d.type` (unfolded) still
                            // populates `failed[]` / `published[]`, which are wire
                            // shapes reporting what the operator actually stored.
                            //
                            // What it changes for those rows is the two things
                            // downstream of `request.type` that had NOT folded:
                            // `getEffectiveLock`'s overlay limb (queried the plural,
                            // found no row, answered `'none'` — "the author declared
                            // no protection" — for an item whose canonical row may
                            // carry `_lock`; the single-item twin of that hole is
                            // #8769 group C), and the `type` on the pending audit
                            // rows those two gates hand back, which the writer now
                            // refuses if it is not canonical.
                            type: canonicalMetaType(d.type),
                            name: d.name,
                            // [#8907] Promote each draft under the PACKAGE
                            // `listDrafts` surfaced it from: ADR-0048 keys
                            // overlay rows by `(org, type, name, package_id)`,
                            // so with two packages holding drafts for one
                            // `(type, name)` a promote that omits the package
                            // dimension cannot tell them apart — publishing A
                            // promoted and drained B's row, left A's own edit
                            // pending, and still answered `success: true`.
                            // `d.packageId` is the row's own binding, so this
                            // is the listed key restated, never a new one.
                            packageId: d.packageId,
                            // [#22877] …and as the bundle member `listDrafts`
                            // surfaced it as: two members' drafts of one name
                            // are two drafts, and promoting the canonical one
                            // for each promoted it twice (`NO_DRAFT` the
                            // second time, aborting the batch) and left the
                            // other member's draft pending.
                            ...memberOption(d.member),
                            // [#10377] The whole batch's own declarations, so
                            // this member is judged against the package it is
                            // being published AS PART OF and not against the
                            // universe as it stood before the publish started.
                            ...(pendingDeclarations !== undefined
                                ? { pending: pendingDeclarations } : {}),
                            // [#26724] …and the datasources it drafts, which
                            // an object draft beside them may name.
                            batchDatasources,
                            // [#28990] …and the objects it drafts, which a
                            // permission-set draft beside them may grant on.
                            batchObjects,
                            ...(request.actor ? { actor: request.actor } : {}),
                            // [ADR-0146 D1] The author's change note, when the
                            // publish carries one, is what every history row
                            // this batch writes records as its `change_note`
                            // (the same note the package commit below keeps),
                            // so the item history says why the item changed.
                            // With none, the sentence naming the package.
                            message: request.message
                                ? request.message
                                : `publish app package '${request.packageId}'`,
                        });
                        promoted.push({
                            d, singularType,
                            body: result.item.body,
                            packageId: result.packageId,
                            version: result.version,
                            seq: result.seq,
                            advisories,
                        });
                        if (typeof result.seq === 'number') publishedSeqs.push(result.seq);
                    } catch (e: unknown) {
                        // Tag the causal item and abort — the surrounding
                        // transaction rolls back every promotion made so far.
                        const err = e instanceof Error ? e : new Error(String(e));
                        (err as { __batchItem?: unknown }).__batchItem = d;
                        throw err;
                    }
                }
                // ADR-0067 — record this turn as ONE commit, INSIDE the same
                // transaction as the promotions it describes: the commit row and
                // the published state land or roll back together, so a recorded
                // commit can never describe a partial publish.
                if (promoted.length > 0) {
                    // [#22877] Keyed by member too: two members of one name
                    // are two plan items.
                    const promotedKeys = new Set(promoted.map((p) => commitPlanKey(p.d)));
                    commit = await this.recordPackageCommit({
                        packageId: request.packageId,
                        operation: 'apply',
                        ...(request.message ? { message: request.message } : {}),
                        ...(request.actor ? { actor: request.actor } : {}),
                        ...(request.aiModel ? { aiModel: request.aiModel } : {}),
                        items: commitItems.filter((it) => promotedKeys.has(commitPlanKey(it))),
                        ...(publishedSeqs.length
                            ? { eventSeqStart: Math.min(...publishedSeqs), eventSeqEnd: Math.max(...publishedSeqs) }
                            : {}),
                    });
                }
            });
        } catch (e: any) {
            // The batch rolled back — NOTHING landed (ADR-0067 D2). Report the
            // causal item with its real error; every other draft is marked
            // BATCH_ABORTED so the caller sees the all-or-nothing semantics
            // instead of inferring them from publishedCount 0.
            const causal = e?.__batchItem as
                { type: string; name: string; organizationId?: string | null; member?: string } | undefined;
            // [#8333 · P6] `failed[].error` is RESPONSE DATA, not a message, so
            // no HTTP boundary's withhold reaches it. Measured on `origin/main`
            // by failing the `sys_metadata` write under the promote: the batch
            // answered `failed[0].error = "SQLITE_ERROR: no such table:
            // sys_metadata"`.
            //
            // ⚠️ This is the site the card warned about, and the measurement is
            // why it could be converted rather than escalated. Its authored
            // population — the one #4277 exists for — is `assertRuntimeAuthoringRules`'
            // author-time rejection, and it DECLARES `422 INVALID_METADATA`
            // with structured `issues`. Reproduced end to end with a real
            // broken-CEL approval flow: after this change the caller still
            // receives `flows[0].nodes[1].config.approvers[0].value:
            // [approval-expression-invalid] …`, plus `code` and `issues`. Every
            // other refusal reaching here declares 4xx too (`NOT_OVERRIDABLE`
            // 403, `METADATA_CONFLICT` 409, the repository's 403/404/409/422).
            // So the rule withholds the driver text and nothing else.
            //
            // [#8441] `code` was left as it was by #8333 — a different field
            // with a different rule (a closed union) — and measured afterwards
            // it still carried the driver's own dialect: `SQLITE_ERROR` beside
            // the withheld sentence. It is now filtered by CATALOG MEMBERSHIP,
            // not by the 4xx question, so `INVALID_METADATA` / `NOT_OVERRIDABLE`
            // and every other declared code reach the caller untouched. See
            // {@link clientFacingFailureCode}. `issues` stays as it was: it is
            // structured authoring feedback, which no driver error carries.
            console.warn(
                `[protocol.publishPackageDrafts] batch publish of '${request.packageId}' rolled back at `
                + `${causal ? `${causal.type}/${causal.name}` : 'an unidentified item'}: ${e?.message ?? e}`,
            );
            // One error drives the whole map — the batch is all-or-nothing — so
            // the filter runs once rather than per row.
            const causalCode = clientFacingFailureCode(e);
            // ═══ [#8400] The refusal audit — OUTSIDE the transaction ═══
            //
            // This is the row whose PLACEMENT is the whole point of the card.
            // `engine.transaction()` has already unwound by the time control
            // reaches this `catch`, so the insert below lands in no transaction
            // and survives the rollback that provoked it. Written INSIDE the
            // Phase-1 closure it would roll back with the batch, and the trail
            // would once again record nothing at all about a refused publish —
            // the exact defect #7748 exists to close, reintroduced on the batch
            // route.
            //
            // ⚠️ [#8594 — the sibling above is now FIXED, one line below.] The
            // note that stood here said the inner denial rows were written from
            // inside this transaction and rolled back with it, so this row could
            // be unconditional: there was never anything of theirs to duplicate.
            // That is no longer true — `promoteDraftForPublish` hands its refusal
            // row out instead of writing it, and the line below lands it here,
            // outside the transaction, in the INNER verdict's own vocabulary
            // (`item_locked` / `metadata_conflict`, with its `lock_state`).
            //
            // The row below stays unconditional anyway, for a different reason:
            // it records a DIFFERENT fact. `item_locked` says why THIS item was
            // refused; `batch_aborted` says the whole batch rolled back and
            // nothing landed — the ADR-0067 D2 consequence, which is what the
            // other drafts' authors need to read, and the only row there is when
            // the cause carries no inner verdict at all (a driver fault,
            // `NOT_OVERRIDABLE`, `INVALID_METADATA`). Two facts, two rows, same
            // causal item.
            //
            // ⚠️ `note` is WIRE-VISIBLE — `auditMetaItem` maps it straight onto
            // the `GET /api/v1/meta/:type/:name/audit` response — so it carries
            // {@link clientFacingFailureText}, not `e.message`. Putting the raw
            // sentence here would route the driver dialect #8333 withheld from
            // `failed[].error` around that rule through a second door. The full
            // untruncated text is already in the `console.warn` above, which is
            // where an operator reads it.
            // ═══ [#8594] The INNER verdict's own row — also outside the txn ═══
            //
            // `promoteDraftForPublish` refused this batch and handed its denial
            // row out on the error rather than writing it inside the closure
            // that has since unwound. Recording it here gives a package publish
            // refused by a lock the same `code = 'item_locked'` + `lock_state`
            // row a single-item publish has always left — the vocabulary a
            // compliance query actually filters on, which `batch_aborted` alone
            // could not supply. No-op when the cause carries no inner verdict.
            //
            // `source` is re-stamped: the shared Phase-1 helper passes
            // `protocol.publishMetaItem` for both of its routes, and this row
            // was written by the batch route.
            await this.recordPendingDenialAudit(e, { source: 'protocol.publishPackageDrafts' });
            if (causal) {
                await this.recordMetadataAudit({
                    // [#8908] Folded for the same two reasons as the pre-flight
                    // rows above — readability through `auditMetaItem`, and the
                    // writer's assert. `causal` is the draft row itself
                    // (`__batchItem`), so its `type` is the STORED spelling.
                    type: canonicalMetaType(causal.type),
                    name: causal.name,
                    organizationId: null,
                    operation: 'publish',
                    outcome: 'denied',
                    // adr0112-ok: D6b — persisted audit column, its own
                    // vocabulary. ONE fixed value for this site rather than the
                    // lower-cased causal code: the causal code is whatever the
                    // catalog can produce, and lower-casing it would turn this
                    // column's documented closed set into an open one that
                    // drifts with every new error code. The cause is in `note`.
                    code: 'batch_aborted',
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.publishPackageDrafts',
                    note: `batch publish of package '${request.packageId}' rolled back (ADR-0067 D2); `
                        + `nothing landed${causalCode ? ` [${causalCode}]` : ''}: `
                        + clientFacingFailureText(e, 'publish failed'),
                });
            }
            // No row when the causal item is unidentifiable (a failure in the
            // transaction machinery itself rather than in any one promotion):
            // the audit row is keyed on `(type, name)`, and minting an identity
            // for a failure nobody can attribute would put a fictional item in
            // a compliance ledger. `console.warn` above stays the record there.
            const failedOut = ordered.map((d) =>
                causal && commitPlanKey(d) === commitPlanKey(causal)
                    ? {
                        type: d.type, name: d.name,
                        error: clientFacingFailureText(e, 'publish failed'),
                        ...(causalCode ? { code: causalCode } : {}),
                        // Carry structured spec-validation issues so the publish
                        // surface can point at the offending field.
                        ...(Array.isArray(e?.issues) ? { issues: e.issues } : {}),
                    }
                    : {
                        type: d.type, name: d.name,
                        error: `not published — the batch is all-or-nothing (ADR-0067 D2) and `
                            + `${causal ? `${causal.type}/${causal.name}` : 'another item'} failed; the transaction rolled back`,
                        code: 'BATCH_ABORTED',
                    });
            return {
                success: false,
                // [#10462] `failedOut` mirrors `ordered` one-to-one, so it is
                // empty ONLY when the batch had zero drafts — a failure in the
                // transaction machinery itself over nothing pending. Deriving
                // the outcome (rather than hard-coding 'refused') keeps the
                // producer invariant `outcome === 'refused' iff
                // failed.length > 0` true on every return site; on that edge
                // "nothing to publish" stays the truthful answer (nothing was
                // pending, nothing was refused) and the `console.warn` above
                // remains the record of the machinery failure.
                outcome: failedOut.length > 0 ? 'refused' : 'nothing_to_publish',
                publishedCount: 0,
                failedCount: failedOut.length,
                published: [],
                failed: failedOut,
            };
        }

        // ═══ Phase 2 — side effects, after the metadata committed ═══
        // Registry refresh, DDL, materializers, projections, events — per item
        // in publish order. Best-effort at the batch level: the metadata IS
        // live at this point, so a side-effect failure must be surfaced (via
        // materialize.failures / probes), never turned into a fake unpublish.

        // ─── [#8400] ADR-0010 — one `publish`/`allowed` row per promoted item ──
        //
        // Studio's "publish whole app" wrote NO audit rows at all: this route
        // calls `promoteDraftForPublish` directly, so #7748's row in
        // `publishMetaItem` never ran for it, and the trail showed a batch
        // publish of twenty artifacts as nothing whatsoever.
        //
        // PLACEMENT — Phase 2, driven off `promoted[]`, and deliberately not
        // inside the Phase-1 closure. An audit row written in there rolls back
        // with the batch; for an allowed publish that is arguably right, but the
        // same placement applied to the refusal (see the `catch` above) is
        // exactly wrong, and one route must not audit its two outcomes under two
        // different durability rules. Driving both off the post-commit state
        // gives the row the same meaning at both sites: it exists iff the
        // decision is durable. This also matches the position `saveMetaItem`,
        // `deleteMetaItem` and `publishMetaItem` all take — persistence
        // committed, side effects not yet run.
        //
        // Before the side-effect loop rather than interleaved with it: every
        // promoted item's metadata is already live, so its row must not depend
        // on whether a later item's DDL happened to throw.
        for (const p of promoted) {
            await this.recordMetadataAudit({
                // [#8908] Folded — the third and last site on this route that
                // builds an audit row out of a stored `type`. Deliberately
                // `canonicalMetaType(p.d.type)` and not `p.singularType`: the
                // latter is the MANIFEST fold, which is a no-op for exactly the
                // spellings this card is about, so it would have looked like a
                // canonicalization while changing nothing (measured and closed on
                // #8858 as a provable no-op).
                type: canonicalMetaType(p.d.type),
                name: p.d.name,
                organizationId: null,
                operation: 'publish',
                outcome: 'allowed',
                code: 'ok',
                ...(request.actor ? { actor: request.actor } : {}),
                source: 'protocol.publishPackageDrafts',
                note: `active — package '${request.packageId}'`
                    + (commit ? `, commit ${commit.commitId}` : ''),
            });
        }

        for (const p of promoted) {
            // [#9343] Omitted-when-empty, never `advisories: []` — the #4717
            // discipline every advisory-carrying door follows: an advisory-free
            // element's bytes are unchanged, and absence means "nothing to
            // report", never "the gate did not run".
            const element: (typeof published)[number] = {
                // [#21207] Each element's version token is keyed, like the
                // single-item doors' (`receiptVersion`); `p.version` stays the
                // stored hash for everything internal.
                type: p.d.type, name: p.d.name, version: await this.receiptVersion(p.version),
                ...(p.advisories.length > 0 ? { advisories: [...p.advisories] } : {}),
            };
            published.push(element);
            try {
                const eff = await this.runPublishSideEffects({
                    singularType: p.singularType,
                    name: p.d.name,
                    body: p.body,
                    packageId: p.packageId,
                    ...(request.actor ? { actor: request.actor } : {}),
                    skipSeedApply: true,
                });
                // [#30693] A refused object-storage sync rides THIS element's
                // `advisories`, the same `object-storage-sync-refused` warning
                // `publishMetaItem` and a publish-mode save answer (#30635).
                // The metadata is live and the element stays published; before
                // this, only the server log said the table was not created or
                // altered. Appended after the gate's findings, still
                // omitted-when-empty: a clean sync adds no key.
                if (eff.storageRefused) {
                    element.advisories = [...(element.advisories ?? []), eff.storageRefused];
                }
                if (eff.materializeApplied) {
                    materialize.any = true;
                    materialize.inserted += eff.materializeApplied.inserted;
                    materialize.updated += eff.materializeApplied.updated;
                    if (!eff.materializeApplied.success) {
                        materialize.failures.push({
                            type: p.d.type, name: p.d.name,
                            error: eff.materializeApplied.error ?? 'materialize failed',
                        });
                    }
                }
            } catch (e: any) {
                // Boot reconciliation heals registry/DDL/projection drift; the
                // published metadata is authoritative. Surface, don't lie.
                console.warn(
                    `[Protocol] publish side effects failed for ${p.d.type}/${p.d.name}: ${e?.message ?? e}`,
                );
                materialize.any = true;
                // [#8333 · P7] The PREFIX is unchanged byte for byte — it is
                // the operational fact a caller needs (the metadata IS live;
                // boot reconciliation heals the drift), and pins read it. Only
                // the interpolation changes: measured on `origin/main`, a
                // driver failure inside the side effects put `SQLITE_ERROR: no
                // such table: sys_metadata` on the tail of this sentence, on a
                // 200 response.
                //
                // Everything this `try` wraps is infrastructure — registry
                // write-through, table DDL, the projector, the event — so no
                // authored refusal was measured arriving here at all; the
                // materializer's authored refusal takes P8's RETURN path
                // instead. The rule is applied uniformly anyway rather than
                // special-cased: a declared 4xx from any of them is still
                // quoted.
                materialize.failures.push({
                    type: p.d.type, name: p.d.name,
                    error: 'side effects failed (metadata is live; boot reconciliation heals): '
                        + clientFacingFailureText(e, 'the reason is in the server log'),
                });
            }
        }

        const seedApplied = seedBodies.length > 0 ? await this.applySeedBodies(seedBodies) : undefined;

        // [#24253] AFTER every promoted item's side effects, never before: the
        // registry write-through is what makes the engine serve the new field
        // (a write naming a field the registry lacks is stripped), and
        // `ensureObjectStorage` is what adds its column. A sync that was
        // refused there leaves no column, so the write below fails and is
        // reported per field, never skipped.
        const backfillApplied = backfillPlan.length > 0 && published.length > 0
            ? await this.applyPublishBackfill(request.packageId, backfillPlan, request.context)
            : undefined;

        // ADR-0038 L3: exercise what was just published — one real read per
        // artifact — so "Published!" can never again mean "and silently
        // broken". Best-effort by design: a probe crash is swallowed (the
        // publish already happened and must report as such), and findings ride
        // the response for the agent / chat health card to act on.
        let probes: import('./build-probes.js').BuildProbeReport | undefined;
        if (published.length > 0) {
            try {
                const { runBuildProbes } = await import('./build-probes.js');
                const analytics = this.getServicesRegistry?.().get('analytics');
                probes = await runBuildProbes({
                    engine: this.engine as any,
                    getItem: async (type, name) => {
                        const wrapper: any = await (this as any).getMetaItem({ type, name });
                        return wrapper?.item ?? wrapper ?? undefined;
                    },
                    published,
                    ...(analytics && typeof analytics.queryDataset === 'function' ? { analytics } : {}),
                    organizationId: null,
                    ...(request.context !== undefined ? { context: request.context } : {}),
                });
            } catch {
                probes = undefined;
            }
        }

        // ADR-0067 D2 — the commit record was written INSIDE the Phase-1
        // transaction above, together with the promotions it describes.

        // [#10462] The no-op exit — a publish with nothing to promote — used
        // to be the ONLY exit that left no trace at all: no audit row (right:
        // `sys_metadata_audit` rows are keyed on `(type, name)`, and a batch
        // with zero items has no honest identity to mint — the limiting case
        // of the rule both refusal sites already follow) and no log line
        // (wrong: an operator who reads `success: false` as a refusal goes
        // looking for a rollback that never happened). `info`, not `warn`:
        // nothing was claimed persisted and nothing was lost, so this is
        // neither a durability nor a functional degradation.
        if (published.length === 0 && failed.length === 0) {
            console.info(
                `[Protocol] publishPackageDrafts: nothing to publish for package `
                + `'${request.packageId}' — no pending drafts were found, and nothing was refused.`,
            );
        }

        return {
            success: failed.length === 0 && published.length > 0,
            // [#10462] Derived, never stored: 'refused' the moment anything is
            // in `failed[]` (defensive — every failure on this route unwinds
            // through the Phase-1 catch above today), else 'published' iff
            // something landed, else the no-op. Exactly the three-way fact
            // `success` compresses into one boolean.
            outcome: failed.length > 0
                ? 'refused'
                : published.length > 0 ? 'published' : 'nothing_to_publish',
            publishedCount: published.length,
            failedCount: failed.length,
            published,
            failed,
            ...(seedApplied ? { seedApplied } : {}),
            ...(materialize.any
                ? { materializeApplied: {
                    success: materialize.failures.length === 0,
                    inserted: materialize.inserted,
                    updated: materialize.updated,
                    failures: materialize.failures,
                } }
                : {}),
            ...(probes ? { probes } : {}),
            ...(commit ? { commitId: commit.commitId } : {}),
            ...(backfillApplied ? { backfillApplied } : {}),
        };
    }

    /**
     * Discard every pending DRAFT bound to a package — the NON-destructive
     * inverse of {@link publishPackageDrafts}. Drops only `state='draft'` rows
     * (via the per-item delete primitive), reverting the package to its last
     * published baseline; active/published metadata and physical tables are
     * left untouched.
     *
     * Use case: "I edited this app for a while and it turned out worse than
     * before — abandon all my changes." Routes through the sys_metadata path
     * (no metadata-service dependency). {@link revertStoredPackage} takes the
     * same per-draft step for `POST /packages/:id/revert`.
     */
    async discardPackageDrafts(request: {
        packageId: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        discardedCount: number;
        failedCount: number;
        discarded: Array<{ type: string; name: string }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
    }> {
        // [#29985 codemod] The body moved to `protocol-history-and-publish.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolHistoryAndPublishFacet.discardPackageDrafts(protocolHost(this), request);
    }

    /**
     * Discard ONE pending draft — the per-draft step
     * {@link discardPackageDrafts} and {@link revertStoredPackage} share. The
     * draft is environment-wide: both list through the environment
     * repository (ADR-0131 D6).
     */
    private async discardDraftInItsScope(
        /**
         * [#22877] `member` — the draft's bundle member, as `listDrafts`
         * surfaced it: the discard removes THAT member's draft. Without it the
         * canonical member's was addressed for every draft of the name, so a
         * second locale's draft answered "no pending draft" and stayed.
         */
        draft: { type: string; name: string; member?: string; packageId?: string | null },
        actor: string | undefined,
    ): Promise<void> {
        // [#25467 cut 12] The body moved to `protocol-drafts.ts` (see `DraftsHost`).
        const host: ThisParameterType<typeof discardDraftInItsScope> = {
            deleteMetaItem: (...a) => this.deleteMetaItem(...a),
        };
        return discardDraftInItsScope.call(host, draft, actor);
    }

    /**
     * [#22090] Revert a package's STORED members to their published version —
     * the half of `POST /packages/:id/revert` a Studio-authored package needs.
     *
     * ## Why the metadata service could not do this
     *
     * `MetadataManager.revertPackage` collects members from its in-memory
     * registry, by an item's own `packageId` / `package` key. A Studio-authored
     * package lives in `sys_metadata`, bound by each row's `package_id`
     * column, and none of its rows is in that registry: a real boot gives the
     * manager no `sys_metadata` loader, and `@objectstack/metadata` cannot
     * reach this package (the dependency runs the other way). So the revert of
     * a Studio package answered 404 "No metadata items found" while the
     * package held published items and a pending draft.
     *
     * ## What "revert" means for a stored member
     *
     * A stored item's published version is its ACTIVE row, and a pending
     * change is a separate DRAFT row beside it. Reverting the package to its
     * published state is removing its drafts, through the per-draft step
     * {@link discardPackageDrafts} takes ({@link discardDraftInItsScope}) —
     * not a second revert mechanism. A draft with no active row (an item
     * created after the last publish) is removed too: it was not part of the
     * published state.
     *
     * Membership is the package's rows as {@link SysMetadataRepository.listDrafts}
     * reads them — `package_id`, environment-wide (ADR-0131 D6) — and
     * the active rows are read through the same predicate,
     * {@link packageScopedRowWhere}, never a `where` of this method's own.
     *
     * ## Answers
     *
     * - No stored row bound to the package: `{ stored: false }`, and nothing
     *   is touched. Its members, if it has any, are the metadata service's;
     *   the caller asks that service's `revertPackage` next, so a code-shipped
     *   package reverts exactly as it did before. An unprovisioned
     *   `sys_metadata` answers the same way: there are genuinely no rows.
     * - Stored rows, none of them active: `RESOURCE_CONFLICT` / 409. The
     *   package has never been published, so there is no published version to
     *   revert to. Nothing is touched.
     * - Otherwise every draft is discarded. A published package with no draft
     *   is already at its published version, which is a success too.
     *
     * A draft whose discard is refused fails the call with that refusal's own
     * `code` and `status` (ADR-0112). {@link discardPackageDrafts} answers a
     * per-item outcome report; this verb's door answers `{ success: true }` or
     * an error, so a refusal collected into a list would reach the caller as a
     * success. Drafts discarded before the refusal stay discarded, as they do
     * in {@link discardPackageDrafts}.
     */
    async revertStoredPackage(request: {
        packageId: string;
        actor?: string;
    }): Promise<{
        stored: boolean;
        discarded: Array<{ type: string; name: string }>;
    }> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.revertStoredPackage(protocolHost(this), request);
    }

    /**
     * Delete an ENTIRE package: every `sys_metadata` row bound to it (active
     * AND draft) and — by default — the physical table of each object it
     * defined. DESTRUCTIVE: removes the app and its data. Use case: "I don't
     * want this package anymore."
     *
     * Set `keepData: true` to remove the metadata but preserve object tables.
     * The `sys_`-table guard in {@link deleteMetaItem} still applies, so
     * platform storage is never dropped. Drafts are removed before active rows
     * so each object's table is torn down once. Per-item failures are collected
     * without aborting the rest.
     *
     * [#21276] The steps, in order. Nothing durable happens before step 4, so
     * a refusal at any of steps 1–4 leaves everything as it was:
     *  1. the retired-key refusal (`INVALID_REQUEST`) — pure;
     *  2. the `sys_metadata` read — a read; a failure is thrown;
     *  3. the registry's uninstall refusal (another package extends an object
     *     this one owns, ADR-0029), asked through
     *     `SchemaRegistry.assertPackageUninstallable` — pure; thrown as is;
     *     then [#23473] the shared-object refusal (another stored row holds an
     *     object whose table this uninstall would drop) — reads only, the
     *     per-item delete's own address reads; `RESOURCE_CONFLICT` / 409;
     *  4. the `sys_packages` delete through the `package` service — the FIRST
     *     durable step; a refusal, returned or thrown, is thrown as this verb's
     *     failure (see {@link packagePersistFailureError});
     *  5. the per-item `sys_metadata` deletes and table teardown — each refusal
     *     is collected in `failed[]`;
     *  6. the registry withdrawal — step 3 already asked its refusal; anything
     *     it still throws is logged, and the package leaves at the next
     *     restart, since its stored row is already gone;
     *  7. the uninstall cleanups — each refusal is reported in `cleanups[]`.
     */
    async deletePackage(request: DeletePackageRequest): Promise<DeletePackageResponse> {
        // [#25467 cut 35] The body moved to `protocol-package-uninstall.ts` (see `PackageUninstallHost`).
        const readEngine = () => this.engine;
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof deletePackage> = {
            deleteMetaItem: (...a) => this.deleteMetaItem(...a),
            get engine() { return readEngine(); },
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            get getServicesRegistry() { return readGetServicesRegistry(); },
            packagelessAddress: (...a) => this.packagelessAddress(...a),
            runUninstallCleanups: (...a) => this.runUninstallCleanups(...a),
            shouldDropStorage: (...a) => this.shouldDropStorage(...a),
        };
        return deletePackage.call(host, request);
    }

    /**
     * ADR-0070 D4 — duplicate a writable base into a NEW package (the Airtable
     * "duplicate base" gesture). Clones every ACTIVE item the source owns into
     * `targetPackageId`, RE-NAMESPACING object names — the blueprint prefixes a
     * base's object names with its namespace (e.g. `iojn_repair_ticket`), and
     * `sys_metadata` keys on (type,name,org), so a same-name copy would collide
     * with the source — and rewriting every intra-package reference (lookup
     * `reference`, view `object`, expressions, etc.) to the new names. Per-item
     * best-effort; one failure never aborts the whole clone. The copy's package
     * record is not an item: when its install is refused, that refusal refuses
     * the whole duplicate, before any item is written.
     *
     * Every copied object is named in the target namespace: `iojn_customer`
     * becomes `iojn2_customer`, and an object whose name lacks the source
     * prefix (`ticket`) becomes `iojn2_ticket` — the prefix rule's own rename
     * (ADR-0129 D2). Such a name is rewritten where it is REFERENCED (an
     * object-reference property, exact value), never inside free text; and
     * when its target name is already claimed (the source also holds
     * `iojn_ticket`) the object is refused in `failed[]`, before anything is
     * written for it, with the source rename that clears it.
     *
     * A copied permission set's field rules follow too: in `fields`, keyed
     * `<object>.<field>`, a key's object part takes the renamed object's name
     * and its field part is left as stored.
     *
     * A rename at a reference site that meets a name the item already holds
     * there (a permission set's or a translation's `objects` key, a hook's
     * `object` entry) is never merged: the item is refused in `failed[]`,
     * naming both, before anything is written for it.
     *
     * Every copied name stays in step with what it names. A view item's
     * `<object>.<viewKey>` name takes its object's copy name and keeps its view
     * key (`ticket.board` becomes `iojn2_ticket.board`), and a value that is
     * that whole name follows it; an item of an object the copy does not rename
     * keeps its name. A record entry's `name` that echoes its key (an object's
     * field) follows the key, and free text renames an object's name only as a
     * whole identifier, never inside a longer one (`x_iojn_customer` stays).
     */
    async duplicatePackage(request: {
        sourcePackageId: string;
        targetPackageId: string;
        targetName?: string;
        targetNamespace?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        copiedCount: number;
        failedCount: number;
        targetPackageId: string;
        copied: Array<{ type: string; name: string }>;
        failed: Array<{ type: string; name: string; error: string }>;
    }> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.duplicatePackage(protocolHost(this), request);
    }

    /**
     * [ADR-0131 D6] The `unmanaged` install mode's copy-once import: every
     * metadata item of ONE package body is written into a NEW writable base in
     * the environment ledger, through {@link saveMetaItem} — the same save
     * door a Studio edit takes — so every copied item is environment metadata
     * from its first byte: owned by the base, `organization_id` NULL, served
     * `_provenance: 'org'`, edited by the next save, and followed by no
     * upgrade. The package's protection lock is not copied, in either
     * spelling — the `_lock` envelope (`_lock`, `_lockReason`, `_lockSource`,
     * `_lockDocsUrl`) or, on a type that declares it, the `protection` block —
     * and the answer's `strippedLocks` names each lock dropped with the
     * package's reason (ADR-0010 §3.3 and Phase 4.3; the ruling on the D6 lock
     * fork, record 6119681934 — `stripUnmanagedImportLock`).
     * The managed mode is the package install; this verb is what that
     * install's manifest service is to it, and no more (see
     * `package-unmanaged-install.ts` for what is copied, what is refused, and
     * what is left to the door).
     *
     * ## All or nothing (the stage-0 ACCEPT's Q7)
     *
     * Every refusal that can be judged is raised BEFORE the base exists, so a
     * refused import writes nothing — no package record, no row:
     *  1. an organization-scoped request (ADR-0131 D6, as every write verb);
     *  2. a request its published declaration refuses
     *     (`ImportUnmanagedPackageRequestSchema`);
     *  3. the deployment's REQUESTED tenancy posture walls organizations
     *     (`UNMANAGED_INSTALL_WALLED_POSTURE` / 409; Q2: requested, never in
     *     force, and an unrecognised value reads as walled);
     *  4. the body carries what cannot be copied (`UNMANAGED_INSTALL_UNCOPYABLE`
     *     / 422; Q5), names it badly, or names no usable target (400);
     *  5. the ADR-0087 D1 protocol handshake;
     *  6. the target id names an installed package (`RESOURCE_CONFLICT` / 409;
     *     Q3: ⛔ never into an existing base) or the namespace is owned;
     *  7. an item does not convert to today's protocol (`INVALID_METADATA` /
     *     422);
     *  8. a name collides with an environment row or an item a managed package
     *     ships (`RESOURCE_CONFLICT` / 409).
     *
     * Then the base is installed ({@link installPackage}, scope-less, the
     * source namespace kept, an id that differs from the source) and every item
     * is written in registry `loadOrder`.
     *
     * ## Rename-on-install (`targetNamespace`, unmanaged only)
     *
     * A request naming a `targetNamespace` copies the package under that
     * namespace instead of the source's: it is the base's namespace, every
     * copied object name takes it in place of the source prefix, and every
     * reference to a renamed name is rewritten — the rename
     * {@link duplicatePackage} applies, by the same engine
     * (`package-namespace-rename.ts`), after the view containers are expanded.
     * Every refusal that rename can meet is raised before the base exists: a
     * namespace its declaration refuses or the platform reserves (400), an
     * object whose copy name is claimed, a copy name the item grammar or the
     * storage identifier limit refuses, and a reference collision (400
     * `INVALID_REQUEST`, naming each item). The collision check (8.) judges
     * the renamed names, and the answer's `sourceNamespace` records the
     * namespace the names came from. A managed install is never renamed: it
     * keeps its upgrade channel. A write that fails deletes the base
     * ({@link deletePackage}, which removes its rows and drops its tables), and
     * the failure is thrown with the item's own `code` and `status`, naming the
     * item and what the rollback did. There is no half-copied app.
     *
     * ⛔ No `OS_METADATA_WRITABLE` hatch: a runtime-uncreatable type is refused
     * by the registry's own flag, never opened for this verb — a second write
     * path is exactly what Q5 rules out.
     *
     * `actor` is stated by the door that calls this verb, never by a body; it
     * is outside the published request for that reason.
     */
    async importUnmanagedPackage(
        request: ImportUnmanagedPackageRequest & { actor?: string },
    ): Promise<ImportUnmanagedPackageResponse> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.importUnmanagedPackage(protocolHost(this), request);
    }

    /**
     * [ADR-0131 D6] The names an unmanaged import would take that something
     * already holds: an environment row of any package and any state, or an
     * item a managed package ships ({@link isArtifactBacked}). A view
     * container's expansion names are asked too, since the save door files
     * each of them.
     *
     * An unprovisioned `sys_metadata` holds no rows; any other read failure is
     * thrown (503), because "no collision" invented from an outage would let
     * the import write over rows it never saw.
     */
    private async unmanagedImportCollisions(
        items: ReadonlyArray<{ type: string; name: string; expands: readonly string[] }>,
    ): Promise<Array<{ type: string; name: string; heldBy: string }>> {
        // [#25467 cut 35] The body moved to `protocol-unmanaged-import.ts` (see `UnmanagedImportHost`).
        const host: ThisParameterType<typeof unmanagedImportCollisions> = {
            findEnvironmentRows: (...a) => this.findEnvironmentRows(...a),
            isArtifactBacked: (...a) => this.isArtifactBacked(...a),
            rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
        };
        return unmanagedImportCollisions.call(host, items);
    }

    /**
     * [ADR-0131 D6] Undo a failed unmanaged import: uninstall the base it was
     * writing into — its rows, its tables, its package record — and return the
     * error the import throws.
     *
     * The thrown error keeps the failed item's own `code` and `status` (the
     * closed vocabulary its refusal already declared), and its message says
     * what the rollback did. A rollback that could not finish is also logged at
     * `error`, once: the base and some of its rows are still there while the
     * import has answered failure, and on a 5xx a boundary withholds the
     * message that says so.
     */
    private async rollBackUnmanagedImport(
        cause: any,
        context: {
            sourcePackageId: string;
            targetPackageId: string;
            failed: { type: string; name: string };
            copiedCount: number;
            actor?: string;
        },
    ): Promise<Error> {
        // [#25467 cut 35] The body moved to `protocol-unmanaged-import.ts` (see `UnmanagedImportHost`).
        const host: ThisParameterType<typeof rollBackUnmanagedImport> = {
            deletePackage: (...a) => this.deletePackage(...a),
        };
        return rollBackUnmanagedImport.call(host, cause, context);
    }

    /**
     * ADR-0070 D5 — adopt orphaned (package-less) metadata into a base. The
     * pre-package-first stopgaps left runtime-authored items with
     * `package_id = null` (or the `sys_metadata` sentinel). This bulk-rebinds
     * every such orphan to `targetPackageId` so the env converges on the
     * package-first model and the "Local / Custom" migration scope can be
     * retired. Owned rows (already bound to a real package) are left untouched.
     *
     * ## [#23198] An overlay of an artifact item is not an orphan
     *
     * ADR-0070's kernel section: "Overlays of artifact items (`intent =
     * override-artifact`, `allowOrgOverride`) are **unchanged** — they keep
     * their binding to the packaged item they customise." An orphan is a
     * runtime-created item. So a package-less row for which
     * {@link isArtifactBacked} holds — the predicate {@link saveMetaItem} sets
     * `intent: 'override-artifact'` by — is not adopted, and it stays as
     * stored. Adopted, a package-less overlay of a packaged view container
     * expanded under its own name in the base, so the packaged view lost the
     * customisation and two views were added beside it; an overlay of one
     * packaged view was served twice under its name. Both took effect at the
     * next restart, and the registry kept the old answer until then.
     *
     * Each view row it does rebind goes through the write-through, with the
     * binding it left ({@link applyRegistryWriteThrough}, `reboundFrom`), so
     * the registry follows the row at once: a view container's expansions are
     * reconciled for the new binding, and the record of the old one moves
     * with it ({@link reconcileViewExpansions}).
     *
     * ## [#23646] …and so does each object row it rebinds
     *
     * An object row used to be rebound in storage only. The registry kept the
     * owner the package-less row had registered (the `'sys_metadata'`
     * sentinel) and the pre-adoption definition until the next restart, and
     * every save of the object naming the target package answered success
     * without going live: the write-through's `own` claim under the target met
     * the registry's single-owner rule (ADR-0029 D3) and landed in
     * {@link applyObjectRegistryMutation}'s best-effort warn. Measured over
     * `POST /api/v1/packages/:id/adopt-orphans` on a booted CRM example: the
     * data plane refused the saved object's new field with `400 INVALID_FIELD`.
     * So the sentinel's contribution leaves the registry first
     * ({@link releaseAdoptedObjectOwner}), and the row registers at its new
     * binding through the same write-through, in the same request; the next
     * boot registers the same owner. Only an ACTIVE object row is registered,
     * the rows the boot registers: an adopted draft is rebound in storage
     * only, because a draft never reaches the runtime. Rows of other types are
     * rebound in storage only, as before.
     *
     * ## [#23690] The active-only rule holds for a view too
     *
     * The view limb admitted a row by its type alone, so an adopted
     * package-less DRAFT view was registered as live (its draft body, at the
     * new binding) until the next boot dropped it again, against the
     * write-through's own rule that a draft never leaks into the runtime
     * (ADR-0048). One gate before both limbs now admits active rows only.
     *
     * ## [ADR-0146 D10, #28735] The `__c` reservation, judged against the target
     *
     * A package-unbound row is not judged by the reservation (it is the
     * environment's own), so the save door admits an object carrying `x__c`
     * into no package. Rebinding that row makes `x__c` a field the TARGET
     * package declares on its own object, which case (a) refuses outside a
     * `.custom` pair. So every active `object` row this adoption would rebind
     * is judged against the target id with the save door's judge
     * ({@link judgeExtensionFieldSuffix}) before the first storage update, and
     * any refused field refuses the adoption whole, with the save door's
     * envelope ({@link extensionFieldSuffixRefusalError}, `VALIDATION_ERROR` /
     * 400, `issues[]` locating each field): no row moves and nothing is
     * written through to the registry. An adopted draft is judged when it is
     * promoted (the promotion asks the same judge against its binding).
     *
     * ## [ADR-0029 D9.9, ADR-0086 D3, #28776] …and the owner judges, first
     *
     * The save door asks two owner judges before the suffix judge, and so
     * does this adoption, in the same order and with their own envelopes,
     * before the first storage update: any refusal refuses the adoption whole.
     *
     *  - An active `object` row whose name ANOTHER package owns in the
     *    registry ({@link classifyObjectContribution}'s `mismatch`) is refused
     *    with {@link overlayPackageMismatchError}
     *    (`OBJECT_OVERLAY_PACKAGE_MISMATCH` / 422). Adopted, it was rebound in
     *    storage while the registry kept the other owner
     *    ({@link releaseAdoptedObjectOwner} answers `false`): two rows for one
     *    object, the shape D9.9 exists to refuse. ⛔ Not the `'sys_metadata'`
     *    sentinel owner: an orphan object IS the sentinel's registration, the
     *    owner this adoption hands over, so asked unchanged the judge would
     *    refuse every object adoption.
     *  - An active `permission` row whose body `packageId` disagrees with the
     *    target is refused with {@link permissionSetOwnerBindingRefusal}
     *    (`VALIDATION_ERROR` / 400, the save door's words).
     *
     * The namespace-prefix judge is deliberately NOT asked here: every
     * installed package declares a namespace, so it would refuse nearly every
     * real orphan object, and whether an adoption refuses, renames or leaves
     * the prefix unjudged is the maintainer's question (#28776's ruling). A
     * draft is judged by both owner judges when it is promoted.
     */
    async reassignOrphanedMetadata(request: {
        targetPackageId: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        reassignedCount: number;
        reassigned: Array<{ type: string; name: string }>;
        targetPackageId: string;
    }> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.reassignOrphanedMetadata(protocolHost(this), request);
    }

    /**
     * [#23646, ADR-0070 D5] Hand an adopted object's registry name over to its
     * rebound row: answers whether {@link reassignOrphanedMetadata} registers
     * the row at its new binding through {@link applyRegistryWriteThrough}.
     *
     * An object has ONE owner per name in the registry (ADR-0029 D3), and a
     * package-less row registers as its owner under the `'sys_metadata'`
     * sentinel (the save's write-through and the boot's hydration both key a
     * package-less row so). A registration at the new binding while that owner
     * stands is a second package's `own` claim, which `registerObject` refuses.
     * So the sentinel's contribution leaves first, through
     * `SchemaRegistry.unregisterObject` — the verb
     * {@link restoreArtifactRegistryView} already hands an object's name to a
     * remaining row with — and the write-through then registers the row as a
     * save of it does. Both run before the adoption answers, with no `await`
     * between them, so no request sees the name unowned. No new registry verb
     * exists for this, and none is needed.
     *
     * | the name's registered owner | answer |
     * |:--|:--|
     * | the sentinel (the adopted row's own registration) | unregistered; `true` |
     * | none | `true`: the row registers as the next boot would register it |
     * | another package's row | `false`: the adopted row never held the name; the registry keeps that owner, as before, and the next boot judges both rows |
     *
     * A code-shipped object is never adopted ({@link isArtifactBacked} filters
     * it out first), so a packaged owner does not reach this table.
     *
     * `unregisterObject` refuses an object another package extends (its
     * ADR-0029 guard). The registry then keeps the sentinel's owner and the
     * pre-adoption definition until the next restart while storage says
     * otherwise, which is why that refusal is logged at `error`, once per
     * object, with the consequence and the remedy.
     *
     * `false` for a registry with no object half (a metadata-only double) and
     * for a body with no name, which register nothing.
     */
    private releaseAdoptedObjectOwner(name: string, item: unknown, targetPackageId: string): boolean {
        // [#25467 cut 17] The body moved to `protocol-object-owner.ts` (see `ObjectOwnerHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof releaseAdoptedObjectOwner> = {
            get engine() { return readEngine(); },
        };
        return releaseAdoptedObjectOwner.call(host, name, item, targetPackageId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADR-0067 — package-scoped commit history & rollback
    // ─────────────────────────────────────────────────────────────────────

    /**
     * [#9066] Has the "commit store is not provisioned" note already been
     * printed on this protocol instance?
     *
     * AGENTS.md's degradation rule says an operator-facing degradation is
     * stated ONCE, at the first occurrence, not once per failed write: a
     * deployment that never provisioned `sys_metadata_commit` would otherwise
     * repeat the same sentence on every publish for the life of the process.
     * Deliberately per-INSTANCE and not per-process (no module-level state):
     * two protocols in one process are two deployments' worth of composition,
     * and a module flag would silence the second one's first publish.
     *
     * The `error` branch below is NOT deduplicated, on purpose — each failed
     * call is a DIFFERENT turn whose revert plan was lost, and the packageId /
     * item count that identify it differ per line. Collapsing them would hide
     * how many turns are unrevertible.
     */
    private commitStoreUnprovisionedNoted = false;

    /**
     * The `sys_metadata_commit` INSERT, on its own so it has a NAME.
     *
     * Extracted for `scripts/check-durability-degradation-log-level.mjs`, whose
     * write rule matches declared callee names: `insert` is far too generic to
     * declare repo-wide, so a durability write only becomes protectable once it
     * has a wrapper of its own (the shape `persistAuditTrailRow` /
     * `dropPromotedDraftRow` already take in that vocabulary). With
     * `persistPackageCommitRow` declared there, the `catch` in
     * {@link recordPackageCommit} can never silently regress to a quiet log
     * again — which is precisely how the seam this repairs was born.
     */
    private async persistPackageCommitRow(row: Record<string, unknown>): Promise<void> {
        // [#25467 cut 33] The body moved to `protocol-package-commit-record.ts` (see `PackageCommitRecordHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof persistPackageCommitRow> = {
            get engine() { return readEngine(); },
        };
        return persistPackageCommitRow.call(host, row);
    }

    /**
     * Record one commit row grouping a turn's published artifacts. Returns the
     * commit id, or null if the commit row could not be written — recording
     * never blocks a publish (ADR-0067 D2's all-or-nothing rule is about the
     * ARTIFACTS; the commit row is not allowed to fail one).
     *
     * [#9066] "Never blocks a publish" is not the same as "never says
     * anything", and it used to be: the `catch` here returned `null` in
     * silence, for every reason. The row is not a grouping label — it is the
     * ONLY record of the turn's revert plan (`existedBefore` / `prevVersion`
     * per artifact) that {@link revertCommit} and
     * {@link rollbackToPackageCommit} can act on. Without it the artifacts are
     * live, `publishPackageDrafts` answers `success: true` with `commitId`
     * merely ABSENT, and the turn can never be reverted — the AGENTS.md
     * durability-degradation shape exactly: nothing looks broken from the
     * outside while something the system claims to persist did not land. A
     * failing commit store also stays failing, so every later publish lost its
     * plan the same silent way.
     *
     * The failure is now discriminated by error TYPE, the same way the read
     * seams in this file ask (#5532 / #5980 / #8896), through the shared
     * `isMissingTableError` predicate rather than a hand-rolled code test.
     */
    private async recordPackageCommit(args: {
        packageId: string;
        operation: 'apply' | 'revert';
        message?: string;
        actor?: string;
        aiModel?: string;
        parentCommitId?: string;
        items: CommitPlanItem[];
        eventSeqStart?: number;
        eventSeqEnd?: number;
    }): Promise<{ commitId: string } | null> {
        // [#25467 cut 33] The body moved to `protocol-package-commit-record.ts` (see `PackageCommitRecordHost`).
        const readCommitStoreUnprovisionedNoted = () => this.commitStoreUnprovisionedNoted;
        const writeCommitStoreUnprovisionedNoted = (value: ObjectStackProtocolImplementation['commitStoreUnprovisionedNoted']) => { this.commitStoreUnprovisionedNoted = value; };
        const host: ThisParameterType<typeof recordPackageCommit> = {
            get commitStoreUnprovisionedNoted() { return readCommitStoreUnprovisionedNoted(); },
            set commitStoreUnprovisionedNoted(value) { writeCommitStoreUnprovisionedNoted(value); },
            persistPackageCommitRow: (...a) => this.persistPackageCommitRow(...a),
        };
        return recordPackageCommit.call(host, args);
    }

    private parseCommitItems(
        raw: unknown,
    ): CommitPlanItem[] {
        // [#25467 cut 32] The body moved to `protocol-commit-items.ts`; it reads no member.
        return parseCommitItems(raw);
    }

    /**
     * List the commit timeline for a package, newest-first (ADR-0067).
     *
     * `[]` means ONE thing: this package genuinely has no commits — a first
     * boot before `sys_metadata_commit` is provisioned, or a package nobody has
     * applied yet. It does NOT mean "the commit store could not be read".
     *
     * [#5980] It used to mean both. The `catch` answered `[]` for every failure
     * and this JSDoc said so outright ("Returns [] if the commit store is
     * unavailable"), which is ADR-0110 D3 broken on the ADR-0067 timeline: a
     * miss and an outage are different facts with opposite meanings, and the
     * timeline is `revertCommit`'s selection surface. An unreachable store
     * rendered as "this package has no history", so the Studio offers nothing
     * to roll back at the exact moment an operator is trying to roll something
     * back — and {@link rollbackToPackageCommit}, which filters this list,
     * reported `success: true` for having reverted nothing. Not one line was
     * logged anywhere on the path.
     *
     * Classification is by error TYPE through
     * {@link rethrowUnlessMetadataStoreUnprovisioned} — the same guard the
     * `sys_metadata` overlay reads in this file already ask (#5532 / #5707) and
     * the same `isMissingTableError` predicate `DatabaseLoader` (#5108) and
     * `SysMetadataRepository` (#4867) ask, so a driver quirk is taught to the
     * platform once rather than re-spelled per seam.
     *
     * @throws {@link markedApplicationRefusalError} — [#12536] FIRST, when the
     *         failure carried a producer's `userMessage` mark (commit 79c46da90): an
     *         application refusal in the author's own words, classified at the
     *         producer and NOT the 503 below. See {@link
     *         metadataReadFailureError}.
     * @throws {@link metadataStoreUnavailableError} — a 503 carrying the driver
     *         error as `cause`, for every failure that is not an unprovisioned
     *         table.
     */
    async listCommits(request: {
        packageId: string;
        limit?: number;
    }): Promise<Array<{
        id: string;
        operation: 'apply' | 'revert';
        message?: string;
        actor?: string;
        aiModel?: string;
        parentCommitId?: string;
        itemCount: number;
        /**
         * [#23073] `member` — the bundle member the item is (`'zh-CN'`, the
         * canonical `'en-US'`), as the stored revert plan records it; absent
         * for a type with no members.
         */
        items: Array<{ type: string; name: string; member?: string; existedBefore: boolean; prevVersion: number | null }>;
        createdAt?: string;
    }>> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.listCommits(protocolHost(this), request);
    }

    /** Docblock and body: {@link ProtocolPackageCommitsFacet.readRevertableCommit} in `protocol-package-commits.ts` [#29985 codemod]. */
    private async readRevertableCommit(commitId: string, packageId?: string): Promise<any> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.readRevertableCommit(protocolHost(this), commitId, packageId);
    }

    /**
     * Revert a single commit (ADR-0067): undo exactly the artifacts it touched.
     * A created-by-this-commit artifact is soft-removed (metadata row deleted;
     * the data table is NOT dropped — recoverable, per ADR-0067 §5); a modified
     * artifact is restored to its pre-commit `prevVersion`. The revert is itself
     * recorded as a NEW commit (operation='revert'), so history stays
     * append-only and the revert is itself revertible.
     *
     * [#6621] BOTH limbs refresh the SchemaRegistry, so a revert that answers
     * `success: true` is one the running process has already acted on. The
     * restore limb writes the restored body through ({@link
     * applyRegistryWriteThrough}, the #4521 rule the sibling
     * {@link rollbackMetaItem} has always carried); the soft-remove limb runs
     * the same three-tier heal the sibling {@link deleteMetaItem} runs after
     * its own `repo.delete` ({@link restoreArtifactRegistryView}). Before
     * this, a batch revert persisted its change and left the runtime
     * dispatching the reverted-away body until restart —
     * {@link rollbackToPackageCommit} inherited it, so a whole-package
     * rollback could report success and change nothing the process could see.
     *
     * [#9174] An item whose STORED `type` is non-canonical
     * ({@link isNonCanonicalStoredType}) is REFUSED on the restore limb, into
     * `failed[]` with `code: 'STORED_TYPE_NOT_CANONICAL'` — the same wire-visible
     * verdict the sibling at-rest doors give (`publishPackageDrafts`, #8908;
     * `migrateStoredMetadata`, #8957), in place of the `console.warn` this door
     * degraded to. The soft-remove limb is deliberately outside the gate: it
     * performs its promise exactly, and the removal is the one action that
     * reduces the residue. The measurement and the refuse-vs-decline reasoning
     * are stated at the gate itself.
     *
     * [#29390, ADR-0146 D1, D11] The restore limb asks the #28905 close
     * ({@link namedBaseOverlayWriteRefusal}) on the binding it writes, as
     * {@link rollbackMetaItem} does: an item whose restore would land in a row
     * bound to the read-only base itself — a commit the base recorded before
     * the write naming it closed — goes into `failed[]` (`NOT_OVERRIDABLE`, the
     * rollback sentence naming the base's `.custom` pair) with nothing written,
     * and {@link rollbackToPackageCommit} reports it per item and continues.
     * The soft-remove limb stays open: removing such a row writes nothing.
     *
     * [#29414, ADR-0048] Both limbs address the committing package's own row
     * (`package_id` = the commit's), as the plan {@link publishPackageDrafts}
     * records describes it: a pair commit beside a row bound to its read-only
     * base removes or restores the pair's row and leaves the base's served.
     * The restore writes the committing package's row, in place or created
     * again when it was deleted since, so this door never writes the
     * package-less row; a commit of the read-only base itself is refused by
     * the #29390 close. A restore into the base's paired `.custom` row is judged
     * by the override write gate as {@link rollbackMetaItem} judges it
     * ({@link restoreWriteFor}): a version declaring no override is refused
     * into `failed[]`.
     */
    async revertCommit(request: {
        commitId: string;
        /**
         * The package the commit must belong to (ADR-0067): a commit of any
         * other package is refused `COMMIT_NOT_FOUND` (404) and nothing is
         * written. Optional for in-process callers that name no package.
         */
        packageId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        revertedCount: number;
        failedCount: number;
        reverted: Array<{ type: string; name: string; action: 'removed' | 'restored' }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
        revertCommitId?: string;
    }> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.revertCommit(protocolHost(this), request);
    }

    /**
     * Roll a package back THROUGH every `apply` commit newer than `commitId`
     * (newest first), leaving the package as it was at that commit. Each step is
     * an individual `revertCommit`, so the whole rollback is itself audited.
     *
     * `failed[]` carries both kinds of failure a step can have: a step that
     * THREW (one entry for the commit), and every item a step REFUSED and
     * reported in its own returned `failed[]` (one entry per item, its `error`
     * naming the item and quoting the step's client-facing text). Either makes
     * `success` false — the declared answer's "true exactly when nothing
     * failed". A refused item stops neither its commit nor the rollback: the
     * step still reverts the item's neighbours and records its revert commit,
     * so that commit is also listed in `revertedCommits`.
     */
    async rollbackToPackageCommit(request: {
        commitId: string;
        /**
         * The package being rolled back (ADR-0067): a target commit of any
         * other package is refused `COMMIT_NOT_FOUND` (404) and nothing is
         * written. Optional for in-process callers that name no package.
         */
        packageId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        revertedCommits: string[];
        failed: Array<{ commitId: string; error: string }>;
    }> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.rollbackToPackageCommit(protocolHost(this), request);
    }

    /**
     * Restore the body recorded at history `toVersion` as the new
     * live row. Writes a history event with `op='revert'`. 404
     * (`VERSION_NOT_FOUND`) when the target version doesn't exist;
     * 409 (`VERSION_NOT_RESTORABLE`) when the target is a delete
     * tombstone (no body to bring back).
     *
     * [#29848, ADR-0146 D8 item 2] The door names no package: it restores
     * into the row the by-name read naming no package serves, a `.custom`
     * pair's declared override over a row bound to its read-only base.
     */
    async rollbackMetaItem(request: RollbackMetaItemRequest): Promise<{
        success: boolean;
        version: string;
        seq: number;
        restoredFromVersion: number;
        message?: string;
    }> {
        // [#28355] A refusal that carries no row of its own leaves its `denied` row here.
        return withRefusalAudit((entry) => this.recordMetadataAudit(entry), {
            operation: 'rollback', type: request.type, name: request.name, actor: request.actor,
            source: 'protocol.rollbackMetaItem',
        }, () => this.rollbackMetaItemUnaudited(request));
    }

    /** Docblock and body: {@link ProtocolPackageCommitsFacet.rollbackMetaItemUnaudited} in `protocol-package-commits.ts` [#29985 codemod]. */
    private async rollbackMetaItemUnaudited(request: RollbackMetaItemRequest): Promise<{
        success: boolean;
        version: string;
        seq: number;
        restoredFromVersion: number;
        message?: string;
    }> {
        // [#29985 codemod] The body moved to `protocol-package-commits.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolPackageCommitsFacet.rollbackMetaItemUnaudited(protocolHost(this), request);
    }

    /**
     * Compute a shallow structural diff between two historical
     * versions of a metadata item. Either side may be omitted: when
     * `toVersion` is undefined the current active body is used, labelled
     * with that active row's own `version` (`null` when there is no active
     * row); when `fromVersion` is undefined the from side is the nearest
     * earlier history row whose body differs from the to side's by this
     * diff's own equality, a body-less (delete) row comparing as `{}`, and
     * absent (`null`) when no earlier row differs. An explicit version on
     * either side is used as named, and must have a history row of this
     * item (a delete tombstone counts, compared as `{}`). Returns `{ added, removed, changed }`
     * keyed by JSON pointer-style paths for primitive leaves; nested
     * objects/arrays are reported as a single change record.
     *
     * The `type` is folded to its canonical spelling at the boundary
     * ({@link canonicalizeMetaRequestType}), so the echoed `type` reports the
     * spelling the history read actually used, not the caller's.
     *
     * @throws `INVALID_REQUEST` — 400, when `type` is an unrecognised spelling
     *         of a type the platform DECLARES (`viewes`). Narrow by
     *         construction: a name that reaches for no declared type is a
     *         possible plugin kind and is served, not refused (#7894).
     * @throws {@link markedApplicationRefusalError} — [#12536] FIRST, when the
     *         failure carried a producer's `userMessage` mark (commit 79c46da90): an
     *         application refusal in the author's own words, classified at the
     *         producer and NOT the 503 below. See {@link
     *         metadataReadFailureError}.
     * @throws {@link versionNotFoundError} — 404 / `VERSION_NOT_FOUND`
     *         (#26462), when an explicit `fromVersion` or `toVersion` has no
     *         history row of this item, an item with no history at all
     *         included: the rollback door's refusal of the same number. A
     *         missing side compared as empty answered "no change" or
     *         "everything removed" (ADR-0110 D3). The default range is
     *         never refused.
     * @throws {@link metadataStoreUnavailableError} — 503 /
     *         `SERVICE_UNAVAILABLE` (#8833), when the `sys_metadata_history`
     *         read failed for any reason other than the table not being
     *         provisioned yet, carrying the driver error on `cause`. The one
     *         non-throwing failure is that unprovisioned table, where "no
     *         history rows" is the truth rather than an unknown, so a minimal
     *         deployment still gets its benign answer: the default range's
     *         empty diff, and for a named version the 404 miss above, as
     *         for any item with no history. Without that
     *         asymmetry an outage would be indistinguishable from "these two
     *         versions are identical" (ADR-0110 D3).
     */
    async diffMetaItem(request: {
        type: string;
        name: string;
        fromVersion?: number;
        toVersion?: number;
    }): Promise<{
        type: string;
        name: string;
        fromVersion: number | null;
        toVersion: number | null;
        added: Array<{ path: string; value: unknown }>;
        removed: Array<{ path: string; value: unknown }>;
        changed: Array<{ path: string; from: unknown; to: unknown }>;
    }> {
        // [#29985 codemod] The body moved to `protocol-diff-delete-load.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiffDeleteLoadFacet.diffMetaItem(protocolHost(this), request);
    }

    /**
     * Remove a customization overlay row for the given metadata item, so the
     * next read falls through to the artifact-loaded default. Implements the
     * "Reset to factory default" semantic from ADR-0005. Whitelist is shared
     * with {@link saveMetaItem}.
     */
    async deleteMetaItem(request: DeleteMetaItemRequest): Promise<{
        success: boolean;
        message?: string;
        reset?: boolean;
        seq?: number;
        /** [ADR-0094] Outcome of the awaited mutation projector, when one is registered. */
        projectionApplied?: MutationProjectionOutcome;
    }> {
        // [#28355] A refusal that carries no row of its own leaves its `denied` row here.
        return withRefusalAudit((entry) => this.recordMetadataAudit(entry), {
            operation: 'delete', type: request.type, name: request.name, actor: request.actor,
            source: 'protocol.deleteMetaItem',
        }, () => this.deleteMetaItemUnaudited(request));
    }

    /** Docblock and body: {@link ProtocolDiffDeleteLoadFacet.deleteMetaItemUnaudited} in `protocol-diff-delete-load.ts` [#29985 codemod]. */
    private async deleteMetaItemUnaudited(request: DeleteMetaItemRequest): Promise<{
        success: boolean;
        message?: string;
        reset?: boolean;
        seq?: number;
        /** [ADR-0094] Outcome of the awaited mutation projector, when one is registered. */
        projectionApplied?: MutationProjectionOutcome;
    }> {
        // [#29985 codemod] The body moved to `protocol-diff-delete-load.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiffDeleteLoadFacet.deleteMetaItemUnaudited(protocolHost(this), request);
    }

    /**
     * Hydrate SchemaRegistry from the database on startup.
     * Loads all active metadata records and registers them in the in-memory registry.
     * Safe to call repeatedly — idempotent (latest DB record wins).
     *
     * Per ADR-0005, environment-kernel mode ALSO hydrates from sys_metadata —
     * customization overlay rows must survive restart. The where-clause below
     * is `{ state: 'active' }`: every row is the environment's (ADR-0131
     * D6/D7 — the family declares no organization column, and the runtime
     * refuses to boot on a database still holding one). There is no
     * `environment_id` constraint — ADR-0005 (revised 2026-05) gave each
     * environment its own database.
     *
     * [#23298] The call is also how an environment kernel's protocol learns
     * that its registry is its own: from it on, a write registers the body it
     * made live as this load registers each row, so the registry never keeps a
     * boot-time body ({@link registryTakesStoredRows}).
     *
     * [ADR-0131 D6, triage ruling Q1 → C] An environment row that overlays
     * SEALED managed content ({@link isUnservedSealedOverlay}) is named by
     * {@link reportSealedOverlayRows} with its remedies. An `object` such row
     * is not loaded: it would register as a layer the engine resolves the
     * object through, so the package's definition stays the registered one.
     * Every other type's row still registers its bare, tenant-marked copy,
     * which the reads decline (#20913, {@link isStoredEntryOfDeclinedName}).
     *
     * #3903 — two contract duties run per row, and their split is deliberate:
     *
     *  1. **Convert** ({@link convertStoredItem}): the full ADR-0087 chain
     *     replays, so a row written under a past protocol registers in the
     *     canonical shape. Chain-owned history therefore stops presenting as
     *     "invalid metadata" at all.
     *  2. **Diagnose, never drop**: what still fails the type's current spec
     *     schema *after* conversion is a genuine contract violation — counted
     *     in `invalid`, warned with a stable `[metadata_spec_invalid]` marker,
     *     and STILL registered. Boot-time refusal would unhook the metadata
     *     from every serving surface (an object row backs live tables; an
     *     unregistered item cannot even be listed, opened, or fixed in
     *     Studio), turning an upgrade into a data outage. The enforcing gates
     *     live where an author is present to act: `saveMetaItem` rejects new
     *     writes (422), and the read surfaces badge the row via
     *     `_diagnostics`. This is that same read-side verdict, surfaced once
     *     at boot where operators look.
     *
     * [#20312] A stored `page` gets one more report-only check, after it has
     * loaded: a `requires` naming a plugin the deployment's SDUI manifest does
     * not carry is reported, page and plugin named — ADR-0080 §5's "validated
     * at save and load" — see {@link reportPageRequiresAbsentAtLoad}.
     *
     * #5897 / ADR-0110 D3 — the return value can now say **"the store was not
     * read at all"**. `loaded: 0` alone cannot: it is equally the truth for an
     * empty store, an un-provisioned store, and a database this process could
     * not reach, and the sole consumer
     * (`ObjectQLPlugin.restoreMetadataFromDb`) therefore logged an outage as
     * `debug` "No persisted metadata found in database" while the kernel went
     * on to report ready. `storeUnavailable` is that missing bit, set on
     * exactly the branch that already prints `DB hydration skipped` — i.e. the
     * outer read failed for a reason {@link isMissingTableError} does NOT call
     * benign.
     *
     * Three things it deliberately is **not**:
     *
     *  - **Not a superset of `errors`.** Per-row hydration failures already
     *    have their own counter and the rows around them did land. This bit
     *    means the row set itself never arrived, so the hydration is not
     *    partial — it is absent. (Named `storeUnavailable` rather than a bare
     *    `degraded` for that reason: the narrower word cannot be misread as
     *    "something, somewhere, went wrong".)
     *  - **Not set for an un-provisioned store.** A first boot before
     *    migrations genuinely holds no overlay rows (#5841), so `loaded: 0` IS
     *    the truth there and the bit stays `false`.
     *  - **Not a control-flow change.** Boot still degrades and continues; what
     *    changes is that the degradation can be *told apart* from health and is
     *    reported at the level AGENTS.md "Degradation log levels" prescribes
     *    for it — persisted state and runtime state disagreeing while the
     *    system keeps looking healthy is the `error` class.
     *
     * It is the boot-side spelling of the same fact `MetadataManager`'s
     * `loadDiagnosed` reports as `degraded` for the loader plane.
     */
    async loadMetaFromDb(): Promise<{ loaded: number; errors: number; invalid: number; storeUnavailable: boolean }> {
        // [#29985 codemod] The body moved to `protocol-diff-delete-load.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiffDeleteLoadFacet.loadMetaFromDb(protocolHost(this));
    }

    /**
     * [#20312] The load half of ADR-0080 §5's plugin-presence check: one line
     * for a stored page whose `requires` names a namespace no component in the
     * deployment's SDUI manifest carries — a plugin the console this
     * deployment serves does not load — naming the page and every such
     * namespace.
     *
     * A diagnostic, never a verdict on the page: it is called only for a page
     * that has already loaded, and it changes nothing about it. The page is
     * served; what its source draws from the absent plugin is what will not
     * render. That is a functional degradation visible to whoever opens the
     * page, so the line is `warn` (AGENTS.md, "Degradation log levels").
     *
     * How a stored page gets here: it was saved on a host with no manifest
     * (stored as written), or the plugin was removed from the console after
     * the page's `requires` was stamped. A host with a manifest refuses the
     * same page at save — the reason this is a report and not a refusal.
     *
     * `sduiManifest` is {@link resolveSduiManifest}'s answer for this load;
     * `undefined` judges nothing, which is the save door's posture on a host
     * that registered no manifest.
     */
    private reportPageRequiresAbsentAtLoad(name: string, body: unknown, sduiManifest: unknown): void {
        // [#25467 cut 33] The body moved to `protocol-sdui-manifest.ts`; it reads no member.
        return reportPageRequiresAbsentAtLoad(name, body, sduiManifest);
    }


    /**
     * [ADR-0131 D6, triage ruling Q1 → C] Say out loud which stored
     * ENVIRONMENT rows no read serves because they overlay sealed managed
     * content ({@link isUnservedSealedOverlay}): an overlay of an item a
     * managed package ships, on ANY type whose registry entry opens no
     * overlay channel ({@link isSealedManagedItem}: every type but the five
     * regime-O ones, so a merge-at-read `page` or `app` as much as a flow or
     * an object), `permission` excepted, written through the
     * `OS_METADATA_WRITABLE` hatch before D6 sealed it. The package's
     * definition wins; an `object` such row is not even loaded. A row under a
     * datasource name the host defines in code is not listed: the
     * datasource-admin boot restore names it, once ({@link isHostCodeDatasource}).
     *
     * Per type, a capped sample of names, and the two remedies the ruling
     * names. ⛔ Nothing here deletes or rewrites the row — its fate is the v18
     * migration ceremony's to name, as a reported population.
     *
     * `warn`: a functional degradation an operator can see (the customised
     * behaviour is gone, the package's is served), not a durability one.
     * Judged against the packages registered when boot hydrates; a package
     * registered later (a marketplace install) is not judged here, and its
     * sealed overlays are still not served.
     */
    private reportSealedOverlayRows(rows: ReadonlyArray<{ type: string; name: string }>): void {
        // [#25467 cut 21] The body moved to `protocol-sealed-overlay-report.ts`.
        return reportSealedOverlayRows(rows);
    }

    // ==========================================
    // Metadata References (Phase 3a-references)
    // ==========================================

    /**
     * Scan all loaded metadata for references pointing at the given
     * `{type, name}` target. Returns one row per referring artifact with
     * the path that produced the hit, so the admin UI can render an
     * "Used by" panel before destructive actions (rename / delete /
     * type-narrowing).
     *
     * [#9190] Coverage is DERIVED from the metadata type schemas
     * ({@link REFERENCE_SITES}), not curated. The table that used to drive this
     * had drifted until 34 of its 40 paths named properties no schema declares
     * and five of its seven target keys answered `{ references: [] }`
     * unconditionally — while this method's own doc called that a legitimate
     * no-hit. It is no longer legitimate and it is no longer what happens: an
     * empty answer now means the walk read every declared source type's shape
     * and found nothing that can name this target. A SOURCE type this
     * deployment does not declare still simply produces no hits, which is a
     * fact about the deployment rather than about the platform.
     *
     * ⚠️ What an empty answer still cannot promise is bounded and recorded
     * rather than implied: {@link REFERENCE_SITES.unwalkableSourceTypes} names
     * every declared type whose shape could not be read (pinned by
     * `reference-sites.derivation.test.ts`, so it cannot grow silently), and
     * `SEMANTIC_REFERENCE_SITES` carries the properties whose name does not
     * spell their target. Both are argued in `reference-sites.ts`.
     *
     * [#9327] A TARGET type that could never MATCH is a third fact, and it is
     * refused rather than answered. `field` items are addressed by the
     * composite key `<object>.<field>` while every property that names a field
     * holds the bare name, so the two sides are drawn from disjoint
     * vocabularies and `{ references: [] }` was returned for every field, on
     * every deployment, whatever was stored.
     * {@link REFERENCE_SITES.unanswerableTargetTypes} carries that set and this
     * method turns it into a `501 NOT_IMPLEMENTED` — the same code and envelope
     * the route's sibling refusal (#9326) already uses, so no response field
     * and no error code are added.
     *
     * [#8896] A source type that could not be READ is a different fact and is
     * no longer answered the same way. This list is what an admin consults
     * before a rename / delete / type-narrowing, so a silently short answer
     * reads as "nothing depends on this" and licenses the destructive action.
     * A `sys_metadata` outage therefore propagates as the 503 `getMetaItems`
     * already raises for it, rather than being swallowed per matcher.
     */
    async findReferencesToMeta(request: {
        type: string;
        name: string;
    }): Promise<{
        references: Array<{
            type: string;
            name: string;
            label?: string;
            path: string;
            kind: string;
        }>;
    }> {
        // [#29985 codemod] The body moved to `protocol-diff-delete-load.ts`; it reaches this class through `protocol-host.ts`.
        return ProtocolDiffDeleteLoadFacet.findReferencesToMeta(protocolHost(this), request);
    }

    /**
     * Install a package from a manifest — the single canonical write primitive
     * for the package subsystem (ADR-0033 consolidation).
     *
     * It writes BOTH stores that the runtime keeps for packages, so a package
     * surfaces consistently no matter which read path is used:
     *   1. the in-memory `SchemaRegistry` (what the dispatcher's
     *      `/api/v1/packages` list/detail and `getMetaItems({type:'package'})`
     *      read — i.e. what Studio's package selector shows), and
     *   2. the durable `sys_packages` table via the optional `package` service
     *      (so the package survives a restart; that service re-hydrates these
     *      rows back into the registry on boot).
     *
     * When the `package` service is ABSENT the package is still registered
     * in-memory and visible for the lifetime of the process — and that
     * in-memory-only branch STAYS, as the documented degraded path for reduced
     * hosts (#17676 ruling A' item 2, decision batch #125 item 2). ⛔ It is not
     * a bug to delete: a host that mounts no provider (`objectstack serve
     * --preset minimal`, a metadata-only embedding) must still be able to
     * install a package for the life of its process, and the `warn` below is
     * what keeps the degradation from being silent.
     *
     * [#21243] When the service is PRESENT and its write fails, the install
     * FAILS: the registry write is undone and the failure is thrown (see
     * {@link packagePersistFailureError}), so the process never holds a package
     * the store does not. It used to answer success with a `console.warn`, and
     * on MySQL — where `sys_packages` was never created — every install and
     * edit answered 201 / 200 and was gone after the next restart.
     *
     * Which capability OWNS the service is no longer `marketplace`: ruling A'
     * item 1 split the persistence half — the `sys_packages` container and the
     * boot hydration that replays it — out under its own always-on token
     * `package-registry` (`PLATFORM_ALWAYS_ON_CAPABILITIES`,
     * `packages/spec/src/kernel/platform-capabilities.ts`), leaving
     * `marketplace` naming only the optional catalogue / browsing half. The
     * runtime half of that split has landed (#19387): `objectstack serve` keys
     * `package-registry` in `Serve.CAPABILITY_PROVIDERS`
     * (`packages/cli/src/commands/serve.ts`) and mounts `PackageServicePlugin`
     * for it, so a stock boot — an app that declares neither token — composes
     * the `package` service and takes the `pkgSvc.publish` branch below. The
     * in-memory-only branch is reached only on a host that mounts no provider
     * (`objectstack serve --preset minimal`, a metadata-only embedding), the
     * degraded path described above. ⚠️ Still open: `marketplace` maps to the
     * same persistence provider today, and repointing it at the browse surface
     * is #17676's remaining half. That repoint does not change which branch
     * this primitive takes.
     *
     * [#19277] `request.enableOnInstall` is HONOURED here, under the same rule
     * the HTTP door implements — 「缺省 = 保持，有旗 = 设置」: `true` enables,
     * `false` disables, and an ABSENT key makes no lifecycle call at all. The
     * durable disabled-package FILE is not this seam's to write (it is keyed by
     * environment, which this request does not carry); see the comment on the
     * flag arms below.
     */
    installPackage(request: InstallPackageRequest): Promise<InstallPackageResponse> {
        // [#25467 cut 7] The body moved to `protocol-package-install.ts` (see `PackageInstallHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof installPackage> = {
            get engine() { return readEngine(); },
            packageInstallUndo: (...a) => this.packageInstallUndo(...a),
            packagePersistService: (...a) => this.packagePersistService(...a),
        };
        return installPackage.call(host, request);
    }

    /**
     * ADR-0146 D3 — ensure the paired customization package `<base>.custom` of
     * an installed, read-only base: answer it when it is installed, create it
     * when it is absent. The ONE creation path of the pair ("no second door
     * builds the pair"), served over HTTP as `POST
     * /api/v1/packages/:id/ensure-customization` and called in-process by the
     * doors that customize a base.
     *
     * The created pair is a writable package whose id, namespace
     * (`<base namespace>_custom`, set explicitly and never derived from the
     * pair's id) and dependency (`^<major>` of the base's version) are the
     * base's, through the pairing rules of `@objectstack/spec/kernel`; it is
     * installed through {@link installPackage}, so it lands in the registry
     * and in `sys_packages` together. An existing pair is returned unchanged,
     * or refused when it lacks the namespace or the dependency — never
     * adopted. Concurrent calls for one pair leave one pair: each waits for the
     * call in flight and judges afresh.
     *
     * Refused, before anything is written: a malformed request or a base id
     * with no pair (`400`), a base not installed (`404`), a writable base, a
     * base with no pair namespace or no SemVer version, an existing pair that
     * lacks the namespace or the dependency (`409`), and a pair namespace
     * another package owns (`422 NAMESPACE_CONFLICT`). The request and the
     * answer are `EnsureCustomizationPackageRequestSchema` /
     * `EnsureCustomizationPackageResponseSchema` (`@objectstack/spec/api`).
     */
    ensureCustomizationPackage(request: EnsureCustomizationPackageRequest): Promise<EnsureCustomizationPackageResponse> {
        // The body lives in `protocol-customization-package.ts` (see `CustomizationPackageHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof ensureCustomizationPackage> = {
            get engine() { return readEngine(); },
            installPackage: (...a) => this.installPackage(...a),
        };
        return ensureCustomizationPackage.call(host, request);
    }

    /**
     * Edit an installed package's manifest (name / description / version /
     * dependencies) — the durable half of `PATCH /packages/:id`. Merges the
     * patch into the registry (preserving lifecycle state — see
     * {@link SchemaRegistry.updatePackageManifest}; `dependencies` replaces the
     * stored row whole) then re-persists the merged manifest to `sys_packages`
     * via the `package` service so the edit survives a restart. The
     * `dependencies` row arrives judged by the door (`ManifestSchema`'s row).
     *
     * [#21243] A failed persist FAILS the edit, exactly as it fails
     * `installPackage`: the registry row is put back to what it held before the
     * patch, then the failure is thrown. It used to be logged and answered as
     * success, so the edit lived until the next restart and then vanished.
     *
     * The service-absent branch below is the same documented degraded path
     * #17676 ruling A' item 2 keeps — see `installPackage`'s note for which
     * capability owns the service and for the measured state of that split.
     */
    updatePackage(request: {
        packageId: string;
        patch: { name?: string; description?: string; version?: string; dependencies?: Record<string, string> };
    }): Promise<{ package: any; message: string }> {
        // [#25467 cut 7] The body moved to `protocol-package-install.ts` (see `PackageInstallHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof updatePackage> = {
            get engine() { return readEngine(); },
            packagePersistService: (...a) => this.packagePersistService(...a),
        };
        return updatePackage.call(host, request);
    }

    /**
     * [#21243] The `package` service's write half, or `undefined` when this
     * host composes none (the documented degraded path of
     * {@link installPackage}).
     */
    private packagePersistService(): PackagePersistService | undefined {
        // [#25467 cut 7] The body moved to `protocol-package-install.ts` (see `PackageInstallHost`).
        const readGetServicesRegistry = () => this.getServicesRegistry;
        const host: ThisParameterType<typeof packagePersistService> = {
            get getServicesRegistry() { return readGetServicesRegistry(); },
        };
        return packagePersistService.call(host);
    }

    /**
     * [#21243] Capture what the registry holds for `manifest.id` BEFORE
     * {@link installPackage} writes, and return the function that puts it back.
     *
     * Three facts are captured, because the registry's `installPackage` moves
     * three: the row (it REPLACES the row object, keeping only the lifecycle
     * fields of a prior one), the namespace ownership (it registers
     * `manifest.namespace` → `manifest.id`), and — through the `enableOnInstall`
     * arms — the lifecycle fields of the new row.
     *
     * The undo is precise rather than an uninstall. `uninstallPackage` also
     * withdraws every object and item registered under the id, and those can
     * exist without a package row — `sys_metadata` rows hydrate on their own,
     * which is exactly the state a database that never stored the package row
     * is left in. Undoing a failed install must not take them with it.
     *
     *  - **No prior row:** the row this install created is withdrawn.
     *  - **A prior row:** the row object the registry now holds gets the prior
     *    row's content back, field for field (the prior object itself is
     *    untouched — the install built a new one).
     *  - **The namespace:** released only when this install is what registered
     *    it; a namespace the id already owned stays owned.
     */
    private packageInstallUndo(manifest: { id: string; namespace?: unknown }): () => void {
        // [#25467 cut 7] The body moved to `protocol-package-install.ts` (see `PackageInstallHost`).
        const readEngine = () => this.engine;
        const host: ThisParameterType<typeof packageInstallUndo> = {
            get engine() { return readEngine(); },
        };
        return packageInstallUndo.call(host, manifest);
    }
}

/**
 * [#21243] The write half of the `package` service that
 * {@link ObjectStackProtocolImplementation.installPackage} and
 * {@link ObjectStackProtocolImplementation.updatePackage} call — named by
 * shape, because this package depends on no `service-package`.
 *
 * `publish` reports a failure on one of two channels
 * (`PackagePublishResult`, `packages/services/service-package/src/index.ts`):
 * RETURNED `{ success: false, driverFault }` when the INSERT broke, or THROWN
 * when the failure declared its own HTTP answer.
 */
export interface PackagePersistService {
    publish(data: { manifest: unknown; metadata: unknown }): Promise<unknown>;
}

/**
 * [#21243] The sentence a caller reads when a package write was refused by the
 * store and undone — or [#21276], for an uninstall, refused by the store before
 * anything else was removed. It quotes nothing but the caller's own package
 * id — the driver's words stay on `cause` and in the server log.
 */
function packagePersistFailureMessage(packageId: string, verb: 'install' | 'update' | 'delete'): string {
    if (verb === 'delete') {
        return `Package '${packageId}' was not uninstalled: the package registry could not delete its stored record, `
            + 'and a package whose record is kept comes back on the next restart, so its metadata, data and grants '
            + 'were left in place. The reason is in the server log.';
    }
    return verb === 'install'
        ? `Package '${packageId}' was not installed: the package registry could not store it, so it would `
            + 'not survive a restart, and nothing was registered. The reason is in the server log.'
        : `The edit to package '${packageId}' was not applied: the package registry could not store it, so it `
            + 'would not survive a restart, and the previous manifest is restored. The reason is in the server log.';
}

/**
 * [#21243] The error a package install or edit answers when its
 * `sys_packages` write failed — and [#21276] an uninstall, when its
 * `sys_packages` delete did. The vocabulary is this file's own, reused:
 *
 *  - **A declared 4xx is a refusal** and leaves untouched — the producer's own
 *    status, code and sentence (the #8016 rule every package door applies,
 *    and {@link declaresClientRefusal}'s reason for quoting a 4xx at all). Read
 *    through `resolveThrownHttpError`, so `status` and `statusCode` both count.
 *  - **Everything else is a store fault**, re-wrapped the way
 *    `deleteMetaItem` re-wraps a failed store write: `status` 500 (a 5xx the
 *    producer declared is kept), the producer's code only when it is
 *    catalogued ({@link carryCatalogedErrorCode}), the original on `cause`, and
 *    a sentence that quotes nothing. A live SQL driver stamps
 *    `DATABASE_ERROR` on a refused raw statement, so the door answers
 *    `500 DATABASE_ERROR`; a returned `driverFault` declares nothing, so the
 *    door derives `INTERNAL_ERROR` from the 500. No code is minted.
 */
export function packagePersistFailureError(cause: unknown, packageId: string, verb: 'install' | 'update' | 'delete'): Error {
    const { declaredStatus } = resolveThrownHttpError(cause);
    if (declaredStatus !== undefined && declaredStatus >= 400 && declaredStatus < 500) return cause as Error;
    const err = new Error(packagePersistFailureMessage(packageId, verb)) as Error & {
        status?: number;
        cause?: unknown;
    };
    err.status = declaredStatus !== undefined && declaredStatus >= 500 ? declaredStatus : 500;
    err.cause = cause;
    carryCatalogedErrorCode(err, cause);
    return err;
}

