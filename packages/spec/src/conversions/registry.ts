// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata conversion table (ADR-0087 D2).
 *
 * Seeded with the **retroactive protocol-11 renames** — the calibration set the
 * ADR names: had this layer existed, protocol 11 would have needed *zero*
 * consumer action for these. Each entry is lossless, declared, loud, tested, and
 * expiring (see {@link MetadataConversion}).
 *
 * Entries are grouped by the major that introduced the canonical shape
 * (`toMajor`): a runtime on major N applies every conversion with
 * `toMajor === N` (it accepts the N−1 shape at load), and the N+1 loader retires
 * them — graduating them into the P2 migration chain rather than deleting them.
 * Until P2 exists these remain the permanent, replayable transform history.
 */

import type { MetadataConversion } from './types.js';

// [#29987 codemod] Every conversion below moved to a module of its own under
// `./entries/` (`scripts/codemod-split-conversions-registry.mjs`). Imported in
// the order the definitions stood in this file, and listed in the tables below
// exactly as before.
import { flowNodeHttpRename } from './entries/11/flow-node-http-callout-rename.js';
import { pageKindJsxToHtml } from './entries/11/page-kind-jsx-to-html.js';
import { flowNodeFilterAlias } from './entries/11/flow-node-crud-filter-alias.js';
import { viewVisibleOnToVisibleWhen } from './entries/15/view-visibleOn-to-visibleWhen.js';
import { pageComponentVisibilityToVisibleWhen } from './entries/15/page-component-visibility-to-visibleWhen.js';
import { sharingRuleAccessLevelFullToEdit } from './entries/17/sharing-rule-access-level-full-to-edit.js';
import { flowNodeCrudObjectAlias } from './entries/17/flow-node-crud-object-alias.js';
import { flowNodeNotifyConfigAliases } from './entries/17/flow-node-notify-config-aliases.js';
import { flowNodeWaitEventConfigLift } from './entries/17/flow-node-wait-event-config-lift.js';
import { flowNodeMapFlowAlias } from './entries/17/flow-node-map-flow-alias.js';
import { flowNodeSubflowFlowAlias } from './entries/17/flow-node-subflow-flow-alias.js';
import { flowNodeConnectorConfigLift } from './entries/17/flow-node-connector-config-lift.js';
import { flowNodeScriptConfigAliases } from './entries/17/flow-node-script-config-aliases.js';
import { datasourceDriverMongoToMongodb } from './entries/17/datasource-driver-mongo-to-mongodb.js';
import { retryPolicyConverged } from './entries/17/retry-policy-converged.js';
import { pageHeaderSubtitleAlias } from './entries/17/page-header-subtitle-alias.js';
import { inlineActionApiParamsToBodyExtra } from './entries/17/inline-action-api-params-to-body-extra.js';
import { fieldMalformedScalePrecisionRemoved } from './entries/18/field-malformed-scale-precision-removed.js';
import { permissionSetManagedByRemoved } from './entries/18/permission-set-managed-by-removed.js';
import { personalViewDeclarationsRemoved } from './entries/18/view-personal-declarations-removed.js';
import { recordChatterPositionVocabulary } from './entries/18/record-chatter-position-vocabulary.js';
import { elementInputTargetVariableRemoved } from './entries/18/element-input-target-variable-removed.js';
import { datasetCountMeasureEmptyFieldRemoved } from './entries/18/dataset-count-measure-empty-field-removed.js';
import { declaredIndexUniqueScope } from './entries/18/declared-index-unique-scope.js';
import { elementFilterRemoved } from './entries/18/element-filter-removed.js';
import { elementFlatDataBindingToDataSource } from './entries/18/element-flat-data-binding-to-data-source.js';
import { elementFormRemoved } from './entries/18/element-form-removed.js';
import { translationLocaleTagCanonicalized } from './entries/18/translation-locale-tag-canonicalized.js';
import { translationLocaleTagCaseFolded } from './entries/18/translation-locale-tag-case-folded.js';
import { translationPerAppSettingsRemoved } from './entries/18/translation-per-app-settings-removed.js';
import { timeDefaultUtcSuffixDropped } from './entries/18/time-default-utc-suffix-dropped.js';
import { translationComponentSubmitLabelRemoved } from './entries/18/translation-component-submit-label-removed.js';
import { elementTextVariantHeadingLevels } from './entries/18/element-text-variant-heading-levels.js';
import { emailTemplateCategoryIsSystemRemoved } from './entries/18/email-template-category-is-system-removed.js';
import { fieldColumnListsCanonicalized } from './entries/18/field-column-lists-canonicalized.js';
import { metricFiltersRemoved } from './entries/18/metric-filters-removed.js';
import { cubeRefreshKeyRemoved } from './entries/18/cube-refresh-key-removed.js';
import { cubeSubDayGranularitiesRemoved } from './entries/18/cube-sub-day-granularities-removed.js';
import { cubeJoinSqlAndRelationshipRemoved } from './entries/18/cube-join-sql-and-relationship-removed.js';
import { cubeMemberInnerNameRemoved } from './entries/18/cube-member-inner-name-removed.js';
import { recordHighlightsFieldIconRemoved } from './entries/18/record-highlights-field-icon-removed.js';
import { manifestPackagingManifestDepsRemoved } from './entries/18/manifest-packaging-manifest-deps-removed.js';
import { manifestPermissionsStringListRemoved } from './entries/18/manifest-permissions-string-list-removed.js';
import { mappingLookupParamsRemoved } from './entries/18/mapping-lookup-params-removed.js';
import { pageComponentResponsiveRemoved } from './entries/18/page-component-responsive-removed.js';
import { navigationModeOverlayValuesRemoved } from './entries/18/navigation-mode-overlay-values-removed.js';
import { objectExternalSharingModelRemoved } from './entries/18/object-external-sharing-model-removed.js';
import { objectGridDefaultFiltersRemoved } from './entries/18/object-grid-default-filters-removed.js';
import { objectGridDefaultSortRemoved } from './entries/18/object-grid-default-sort-removed.js';
import { objectGridResizableColumnsRemoved } from './entries/18/object-grid-resizable-columns-removed.js';
import { objectKanbanQuickAddRemoved } from './entries/18/object-kanban-quick-add-removed.js';
import { pageHeaderBreadcrumbRemoved } from './entries/18/page-header-breadcrumb-removed.js';
import { pageHeaderShowStarRemoved } from './entries/18/page-header-show-star-removed.js';
import { pageIsDefaultOffRecordPageRemoved } from './entries/18/page-is-default-off-record-page-removed.js';
import { pageListViewObjectNameViewTypeToDataType } from './entries/18/page-list-view-object-name-view-type-to-data-type.js';
import { pageMainRegionWidthRemoved } from './entries/18/page-main-region-width-removed.js';
import { pageRequiresNonCompiledKindRemoved } from './entries/18/page-requires-non-compiled-kind-removed.js';
import { pageSlotsTabsRemoved } from './entries/18/page-slots-tabs-removed.js';
import { pageTemplateFullWidthToDefault } from './entries/18/page-template-full-width-to-default.js';
import { permissionAdminScopeBindingAuthoringRemoved } from './entries/18/permission-admin-scope-binding-authoring-removed.js';
import { permissionAllowRestorePurgeRemoved } from './entries/18/permission-allow-restore-purge-removed.js';
import { formViewButtonsResetRemoved } from './entries/18/form-view-buttons-reset-removed.js';
import { formViewDrawerKeysRemoved } from './entries/18/form-view-drawer-keys-removed.js';
import { formViewOptionDefaultRemoved } from './entries/18/form-view-option-default-removed.js';
import { fieldReferenceToAlias } from './entries/18/field-reference-to-alias.js';
import { connectorErrorMappingRemoved } from './entries/18/connector-error-mapping-removed.js';
import { connectorConnectionTimeoutMsRemoved } from './entries/18/connector-connection-timeout-ms-removed.js';
import { formViewPresentationTypesRemoved } from './entries/18/form-view-presentation-types-removed.js';
import { formViewSubformColumnsCanonicalized } from './entries/18/form-view-subform-columns-canonicalized.js';
import { hookTimeoutToTimeoutMs } from './entries/18/hook-timeout-to-timeout-ms.js';
import { jobTimeoutToTimeoutMs } from './entries/18/job-timeout-to-timeout-ms.js';
import { actionBlockEndpointToTarget } from './entries/18/action-block-endpoint-to-target.js';
import { addRecordEnabledDefaulted } from './entries/18/add-record-enabled-defaulted.js';
import { addRecordModeFormViewRemoved } from './entries/18/add-record-mode-form-view-removed.js';
import { agentLifecycleRemoved } from './entries/18/agent-lifecycle-removed.js';
import { agentMemoryLongTermStoreRemoved } from './entries/18/agent-memory-long-term-store-removed.js';
import { agentStructuredOutputRefusedMembersRemoved } from './entries/18/agent-structured-output-refused-members-removed.js';
import { apiEndpointCacheTtlToCacheTtlSeconds } from './entries/18/api-endpoint-cache-ttl-to-cache-ttl-seconds.js';
import { dashboardRefreshIntervalToRefreshIntervalSeconds } from './entries/18/dashboard-refresh-interval-to-refresh-interval-seconds.js';
import { connectorResilienceKeysRemoved } from './entries/18/connector-resilience-keys-removed.js';
import { connectorSyncKeysRemoved } from './entries/18/connector-sync-keys-removed.js';
import { connectorTriggersRemoved } from './entries/18/connector-triggers-removed.js';
import { memoryPersistenceAutoSaveIntervalToMs } from './entries/18/memory-persistence-auto-save-interval-to-ms.js';
import { translationWidgetSubCaptionRemoved } from './entries/18/translation-widget-sub-caption-removed.js';
import { tursoConfigEncryptionKeyRemoved } from './entries/18/turso-config-encryption-key-removed.js';
import { tursoConfigTimeoutToTimeoutMs } from './entries/18/turso-config-timeout-to-timeout-ms.js';
import { viewPageMountRemoved } from './entries/18/view-page-mount-removed.js';
import { listViewOptionsBagFolded } from './entries/18/list-view-options-bag-folded.js';
import { listViewSortStringClauseToArray } from './entries/18/list-view-sort-string-clause-to-array.js';
import { pageActionBlockVariantDestructiveToDanger } from './entries/18/page-action-block-variant-destructive-to-danger.js';
import { pageActionRowNavigationExecutorToUrl } from './entries/18/page-action-row-navigation-executor-to-url.js';
import { pageActionRowPatchRemoved } from './entries/18/page-action-row-patch-removed.js';
import { pageAssignedProfilesRemoved } from './entries/18/page-assigned-profiles-removed.js';
import { cbpMasterDetailRequiredDefaulted } from './entries/18/cbp-master-detail-required-defaulted.js';
import { chartConfigAriaRemoved } from './entries/18/chart-config-aria-removed.js';
import { actionAriaRemoved } from './entries/18/action-aria-removed.js';
import { dashboardWidgetChartConfigStructureRemoved } from './entries/18/dashboard-widget-chart-config-structure-removed.js';
import { objectMasterDetailFormDetailSortFieldRemoved } from './entries/18/object-master-detail-form-detail-sort-field-removed.js';
import { objectTenancyOrganizationFieldRemoved } from './entries/18/object-tenancy-organization-field-removed.js';
import { viewItemOwnerHiddenRemoved } from './entries/18/view-item-owner-hidden-removed.js';
import { viewOverlayOwnerHiddenRemoved } from './entries/18/view-overlay-owner-hidden-removed.js';
import { viewListFilterableFieldsRemoved } from './entries/18/view-list-filterable-fields-removed.js';
import { viewListTabsRemoved } from './entries/18/view-list-tabs-removed.js';
import { pageComponentFilterRecordToRuleArray } from './entries/18/page-component-filter-record-to-rule-array.js';
import { reportJoinedChartRemoved } from './entries/18/report-joined-chart-removed.js';
import { formFieldPublicPickerRemoved } from './entries/18/form-field-public-picker-removed.js';
import { formLayoutInlineGridToVertical } from './entries/18/form-layout-inline-grid-to-vertical.js';
import { currencyConfigDynamicDefaultCurrencyRemoved } from './entries/18/currency-config-dynamic-default-currency-removed.js';
import { currencyConfigPrecisionRemoved } from './entries/18/currency-config-precision-removed.js';
import { permissionModifyAllAllowDeleteFalseToTrue } from './entries/18/permission-modify-all-allow-delete-false-to-true.js';
import { permissionRlsTagsRemoved } from './entries/18/permission-rls-tags-removed.js';
import { flowDecisionModeInclusiveExplicit } from './entries/18/flow-decision-mode-inclusive-explicit.js';

/**
 * One conversion of an OPEN major, with its place in that major's application
 * order (#20574).
 *
 * A major's list is APPLICATION order — the loader runs the conversions in
 * sequence — but the major that retirements still add to is authored as
 * entries, because a list appended at its end does not merge: every retirement
 * PR inserted into the same gap, so any two in flight conflicted.
 */
interface OrderedConversion {
  /** The conversion. Its IDENTIFIER is the key the list is kept sorted by. */
  readonly conversion: MetadataConversion;
  /** Where it applies within its major: ascending `order`, ties broken by the conversion's `id`. */
  readonly order: number;
}

/** A major's conversions in application order: ascending `order`, ties by the conversion's `id`. */
function inApplicationOrder(entries: readonly OrderedConversion[]): readonly MetadataConversion[] {
  return [...entries]
    .sort((a, b) => a.order - b.order || (a.conversion.id < b.conversion.id ? -1 : a.conversion.id > b.conversion.id ? 1 : 0))
    .map((e) => e.conversion);
}

/**
 * Major 18's conversions, one entry per conversion.
 *
 * ⚠️ SORTED BY THE CONVERSION'S IDENTIFIER, NOT BY APPLICATION ORDER — that is
 * the point of the shape. Git reports a conflict whenever two branches insert
 * into the SAME gap between two unchanged lines, whatever they insert, and
 * GitHub's server-side merge runs no driver that could say otherwise. A list
 * appended at its end is one gap, so any two retirements in flight conflicted
 * here. Kept sorted by identifier, two retirements insert into different gaps
 * and merge clean — one existing entry between them is enough. `order`, not the
 * position in this list, says where a conversion applies: `ALL_CONVERSIONS`,
 * which the loader runs in sequence, and step 18's `conversionIds` both read
 * `CONVERSIONS_BY_MAJOR[18]`, which is this list in `order`.
 *
 * To add a conversion:
 * - Insert `{ conversion: <identifier>, order: <n> }` where its identifier
 *   sorts (code-unit order, as `<` compares two strings) — never at the end.
 * - `order` is one more than the highest here. Two retirements in flight may
 *   take the same number; they then apply in `id` order. One that must apply
 *   BEFORE an existing entry takes a number between its neighbours' (`23.5`)
 *   instead of renumbering them.
 * - DEFINE it in a module of its own, `./entries/18/<id>.ts`, the file named for
 *   the conversion's `id` and exporting it by name (`export { <identifier> };`).
 *   A new file never conflicts.
 * - IMPORT it directly above the import of the entry that follows it in this
 *   list, so the conversion imported next after it is that entry. One that
 *   sorts last is imported after every other `./entries/18/` import. The
 *   imports stand where the definitions stood before the split, and their end
 *   is one gap too: importing every new conversion there conflicts exactly as
 *   appending here did.
 *
 * `scripts/conversions-major18-merge.test.ts` holds both rules for every entry
 * added after this shape, and proves the merge.
 */
const MAJOR_18_CONVERSIONS: readonly OrderedConversion[] = [
  { conversion: actionAriaRemoved, order: 43 },
  { conversion: actionBlockEndpointToTarget, order: 52 },
  { conversion: addRecordEnabledDefaulted, order: 73 },
  { conversion: addRecordModeFormViewRemoved, order: 72 },
  { conversion: agentLifecycleRemoved, order: 57 },
  { conversion: agentMemoryLongTermStoreRemoved, order: 56 },
  { conversion: agentStructuredOutputRefusedMembersRemoved, order: 55 },
  { conversion: apiEndpointCacheTtlToCacheTtlSeconds, order: 23 },
  { conversion: cbpMasterDetailRequiredDefaulted, order: 63 },
  { conversion: chartConfigAriaRemoved, order: 32 },
  { conversion: connectorConnectionTimeoutMsRemoved, order: 20 },
  { conversion: connectorErrorMappingRemoved, order: 19 },
  // The connector duration rename that applied just before these two
  // (`connector-health-and-trigger-durations-unit-in-key`, between orders 24
  // and 25) was absorbed by the two removals below, each of which strips the
  // container a renamed key lived in — see its ABSORBED note.
  { conversion: connectorResilienceKeysRemoved, order: 25 },
  { conversion: connectorSyncKeysRemoved, order: 50 },
  { conversion: connectorTriggersRemoved, order: 26 },
  { conversion: cubeJoinSqlAndRelationshipRemoved, order: 9 },
  { conversion: cubeMemberInnerNameRemoved, order: 44 },
  { conversion: cubeRefreshKeyRemoved, order: 47 },
  { conversion: cubeSubDayGranularitiesRemoved, order: 8 },
  { conversion: currencyConfigDynamicDefaultCurrencyRemoved, order: 78 },
  { conversion: currencyConfigPrecisionRemoved, order: 41 },
  { conversion: dashboardRefreshIntervalToRefreshIntervalSeconds, order: 24 },
  { conversion: dashboardWidgetChartConfigStructureRemoved, order: 33 },
  { conversion: datasetCountMeasureEmptyFieldRemoved, order: 54 },
  { conversion: declaredIndexUniqueScope, order: 61 },
  { conversion: elementFilterRemoved, order: 4 },
  { conversion: elementFlatDataBindingToDataSource, order: 35.5 },
  { conversion: elementFormRemoved, order: 5 },
  { conversion: elementInputTargetVariableRemoved, order: 3 },
  { conversion: elementTextVariantHeadingLevels, order: 59 },
  { conversion: emailTemplateCategoryIsSystemRemoved, order: 62 },
  { conversion: fieldColumnListsCanonicalized, order: 6 },
  { conversion: fieldMalformedScalePrecisionRemoved, order: 1 },
  { conversion: fieldReferenceToAlias, order: 18 },
  { conversion: flowDecisionModeInclusiveExplicit, order: 45 },
  { conversion: formFieldPublicPickerRemoved, order: 53 },
  { conversion: formLayoutInlineGridToVertical, order: 40 },
  { conversion: formViewButtonsResetRemoved, order: 79 },
  { conversion: formViewDrawerKeysRemoved, order: 81 },
  { conversion: formViewOptionDefaultRemoved, order: 17 },
  { conversion: formViewPresentationTypesRemoved, order: 78 },
  { conversion: formViewSubformColumnsCanonicalized, order: 51 },
  { conversion: hookTimeoutToTimeoutMs, order: 21 },
  { conversion: jobTimeoutToTimeoutMs, order: 22 },
  { conversion: listViewOptionsBagFolded, order: 78 },
  { conversion: listViewSortStringClauseToArray, order: 30 },
  { conversion: manifestPackagingManifestDepsRemoved, order: 80 },
  { conversion: manifestPermissionsStringListRemoved, order: 61 },
  { conversion: mappingLookupParamsRemoved, order: 11 },
  { conversion: memoryPersistenceAutoSaveIntervalToMs, order: 27 },
  { conversion: metricFiltersRemoved, order: 7 },
  { conversion: navigationModeOverlayValuesRemoved, order: 77 },
  { conversion: objectExternalSharingModelRemoved, order: 64 },
  { conversion: objectGridDefaultFiltersRemoved, order: 35.5 },
  { conversion: objectGridDefaultSortRemoved, order: 14 },
  { conversion: objectGridResizableColumnsRemoved, order: 57 },
  { conversion: objectKanbanQuickAddRemoved, order: 15 },
  { conversion: objectMasterDetailFormDetailSortFieldRemoved, order: 60 },
  { conversion: objectTenancyOrganizationFieldRemoved, order: 35 },
  { conversion: pageActionBlockVariantDestructiveToDanger, order: 77 },
  { conversion: pageActionRowNavigationExecutorToUrl, order: 63 },
  { conversion: pageActionRowPatchRemoved, order: 70 },
  { conversion: pageAssignedProfilesRemoved, order: 31 },
  { conversion: pageComponentFilterRecordToRuleArray, order: 36 },
  { conversion: pageComponentResponsiveRemoved, order: 13 },
  { conversion: pageHeaderBreadcrumbRemoved, order: 49 },
  { conversion: pageHeaderShowStarRemoved, order: 66 },
  { conversion: pageIsDefaultOffRecordPageRemoved, order: 67 },
  { conversion: pageListViewObjectNameViewTypeToDataType, order: 68 },
  { conversion: pageMainRegionWidthRemoved, order: 69 },
  { conversion: pageRequiresNonCompiledKindRemoved, order: 58 },
  { conversion: pageSlotsTabsRemoved, order: 78 },
  { conversion: pageTemplateFullWidthToDefault, order: 67 },
  { conversion: permissionAdminScopeBindingAuthoringRemoved, order: 65 },
  { conversion: permissionAllowRestorePurgeRemoved, order: 16 },
  { conversion: permissionModifyAllAllowDeleteFalseToTrue, order: 75 },
  { conversion: permissionRlsTagsRemoved, order: 42 },
  { conversion: permissionSetManagedByRemoved, order: 67 },
  { conversion: personalViewDeclarationsRemoved, order: 82 },
  { conversion: recordChatterPositionVocabulary, order: 2 },
  { conversion: recordHighlightsFieldIconRemoved, order: 10 },
  { conversion: reportJoinedChartRemoved, order: 38 },
  { conversion: timeDefaultUtcSuffixDropped, order: 48 },
  { conversion: translationComponentSubmitLabelRemoved, order: 12 },
  { conversion: translationLocaleTagCanonicalized, order: 76 },
  // AFTER `translationLocaleTagCanonicalized`: an `_` or padded spelling is made a
  // tag there, and only a tag's case is folded here (`zh_cn` → `zh-cn` → `zh-CN`).
  { conversion: translationLocaleTagCaseFolded, order: 76.5 },
  { conversion: translationPerAppSettingsRemoved, order: 34 },
  { conversion: translationWidgetSubCaptionRemoved, order: 55 },
  { conversion: tursoConfigEncryptionKeyRemoved, order: 74 },
  { conversion: tursoConfigTimeoutToTimeoutMs, order: 28 },
  { conversion: viewItemOwnerHiddenRemoved, order: 37 },
  { conversion: viewListFilterableFieldsRemoved, order: 71 },
  { conversion: viewListTabsRemoved, order: 46 },
  { conversion: viewOverlayOwnerHiddenRemoved, order: 39 },
  { conversion: viewPageMountRemoved, order: 29 },
];

/**
 * Every conversion, grouped by the major that introduced its canonical shape
 * (`toMajor`), each major's list in APPLICATION order: {@link ALL_CONVERSIONS}
 * concatenates them by ascending major and the loader runs it in sequence.
 *
 * A released major's list is a plain array, closed with its release. The major
 * that retirements still add to is authored as sorted entries with an explicit
 * `order` ({@link MAJOR_18_CONVERSIONS}), so two retirements in flight do not
 * conflict here; the next major takes the same shape when it opens.
 *
 * ⚠️ EVERY CALL THIS TABLE AND {@link ALL_CONVERSIONS} MAKE AT MODULE LOAD
 * CARRIES AN `@__PURE__` ANNOTATION — a major's `inApplicationOrder(…)` and
 * the flattening below, and the next major's when it opens. The entries share
 * one module graph (`tsup.config.ts`, `oneModuleGraph`), and every entry whose
 * graph reaches this module links the chunk it ships in, so a consumer's
 * bundler keeps every top-level call it cannot prove pure, together with
 * everything that call references. Unmarked, these two initializers kept
 * the whole table in every bundle of every entry whose graph reaches this
 * module — every conversion, and the view, field, page-component, dashboard,
 * chart and report schemas the conversions read. `./shared` is one of those
 * entries: it reaches here only through `normalizeStackInput`
 * (`shared/metadata-collection.zod.ts`), so a console importing an expression
 * schema from it carried the table too (#22044). Marked, a bundle keeps the
 * table only when something it keeps reads it. Both calls only sort, map and
 * concatenate arrays this module owns.
 * `packages/spec/scripts/pure-schema-construction.test.ts` holds the effect on
 * the built `./shared` entry.
 */
export const CONVERSIONS_BY_MAJOR: Readonly<Record<number, readonly MetadataConversion[]>> = {
  11: [flowNodeHttpRename, pageKindJsxToHtml, flowNodeFilterAlias],
  15: [viewVisibleOnToVisibleWhen, pageComponentVisibilityToVisibleWhen],
  17: [
    sharingRuleAccessLevelFullToEdit,
    flowNodeCrudObjectAlias,
    flowNodeNotifyConfigAliases,
    flowNodeWaitEventConfigLift,
    flowNodeConnectorConfigLift,
    flowNodeMapFlowAlias,
    flowNodeSubflowFlowAlias,
    flowNodeScriptConfigAliases,
    // Ordered after `datasource-config-driver-key-aliases` while that entry
    // existed (retired with the protocol-16.x kits, #25767): config keys were
    // fixed under the driver they were written for before the id converged.
    datasourceDriverMongoToMongodb,
    // AFTER `flowNodeScriptConfigAliases`: the shorthand-`actionType` rule asks
    // whether `config.function` is set, and that rename is what sets it.
    retryPolicyConverged,
    pageHeaderSubtitleAlias,
    inlineActionApiParamsToBodyExtra,
  ],
  18: /* @__PURE__ */ inApplicationOrder(MAJOR_18_CONVERSIONS),
};

/**
 * Flattened, deterministic list of every conversion the loader knows about.
 * `@__PURE__` for the reason {@link CONVERSIONS_BY_MAJOR} gives.
 */
export const ALL_CONVERSIONS: readonly MetadataConversion[] = /* @__PURE__ */ Object.keys(CONVERSIONS_BY_MAJOR)
  .map(Number)
  .sort((a, b) => a - b)
  .flatMap((major) => CONVERSIONS_BY_MAJOR[major]!);
