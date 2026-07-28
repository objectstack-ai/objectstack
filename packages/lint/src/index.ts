// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/lint — public API.
//
// Static, build-time validation over an ObjectStack metadata graph. Every rule
// is a pure `(stack) => Finding[]` function: no I/O, no runtime, no filesystem
// — it operates on an in-memory, schema-parsed stack object. Shared by the
// CLI's `os validate`/`compile` AND any other consumer (e.g. AI authoring) so
// hand-authored and generated apps are held to the same bar (ADR-0019).
//
// Dependency direction is one-way: lint → @objectstack/spec (the contract).
// It never depends on a runtime, and it is never bundled into a frontend.

export {
  validateWidgetBindings,
  WIDGET_DATASET_UNKNOWN,
  WIDGET_DIMENSION_UNKNOWN,
  WIDGET_MEASURE_UNKNOWN,
  CHART_FIELD_UNKNOWN,
  CHART_CONFIG_MISSING,
  TABLE_COUNT_ONLY,
  MEASURE_AGGREGATE_INCOHERENT,
  DASHBOARD_FILTER_FIELD_UNKNOWN,
} from './validate-widget-bindings.js';
export type { WidgetBindingFinding, WidgetBindingSeverity } from './validate-widget-bindings.js';

export { validateStackExpressions } from './validate-expressions.js';
export type { ExprIssue } from './validate-expressions.js';

export { validateListViewMode, LIST_VIEW_FILTERS_IN_VIEWS_MODE } from './validate-list-view-mode.js';
export type { ListViewModeFinding, ListViewModeSeverity } from './validate-list-view-mode.js';
export {
  validateFlowTriggerReadiness,
  FLOW_TRIGGER_UNKNOWN_OBJECT,
  FLOW_DRAFT_STATUS_AMBIGUOUS,
} from './validate-flow-trigger-readiness.js';
export type {
  FlowTriggerReadinessFinding,
  FlowTriggerReadinessSeverity,
} from './validate-flow-trigger-readiness.js';

export {
  validateFlowTemplatePaths,
  FLOW_TEMPLATE_UNKNOWN_FIELD,
  FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
} from './validate-flow-template-paths.js';
export type {
  FlowTemplatePathFinding,
  FlowTemplatePathSeverity,
} from './validate-flow-template-paths.js';

export {
  validateReadonlyFlowWrites,
  FLOW_UPDATE_READONLY_FIELD,
  FLOW_UPDATE_READONLY_WHEN_FIELD,
} from './validate-readonly-flow-writes.js';
export type {
  ReadonlyFlowWriteFinding,
  ReadonlyFlowWriteSeverity,
} from './validate-readonly-flow-writes.js';

export { validateViewContainers, VIEW_CONTAINER_SHAPE } from './validate-view-containers.js';
export type { ViewContainerFinding, ViewContainerSeverity } from './validate-view-containers.js';

export {
  validateResponsiveStyles,
  STYLE_NODE_MISSING_ID,
  STYLE_CLASSNAME_TAILWIND,
  STYLE_RESPONSIVE_NO_BASE,
  STYLE_UNKNOWN_CSS_PROPERTY,
  STYLE_UNKNOWN_TOKEN,
} from './validate-responsive-styles.js';
export type { StyleFinding, StyleSeverity } from './validate-responsive-styles.js';
export { validateJsxPages } from './validate-jsx-pages.js';
export type { JsxPageFinding, JsxPageSeverity } from './validate-jsx-pages.js';
export { validateReactPages } from './validate-react-pages.js';
export type { ReactPageFinding, ReactPageSeverity } from './validate-react-pages.js';
export {
  validateReactPageProps,
  REACT_CHART_FIELD_UNKNOWN,
  REACT_CHART_AGGREGATE_INVALID,
  REACT_CHART_AXIS_UNKNOWN,
} from './validate-react-page-props.js';
export type { ReactPropFinding, ReactPropSeverity } from './validate-react-page-props.js';
export { validatePageSourceStyling, PAGE_SOURCE_CLASSNAME } from './validate-page-source-styling.js';
export type { SourceStyleFinding, SourceStyleSeverity } from './validate-page-source-styling.js';

export {
  validateRecordTitle,
  TITLE_FORMAT_RETIRED,
  TITLE_UNRESOLVABLE,
} from './validate-record-title.js';
export type { RecordTitleFinding, RecordTitleSeverity } from './validate-record-title.js';

export {
  validateSemanticRoles,
  FIELD_GROUP_UNDECLARED,
  FIELD_GROUP_EMPTY,
  SEMANTIC_ROLE_FIELD_UNKNOWN,
} from './validate-semantic-roles.js';
export type { SemanticRoleFinding, SemanticRoleSeverity } from './validate-semantic-roles.js';

export {
  validateFormLayout,
  FORM_FIELD_UNKNOWN,
  FORM_COLSPAN_ABSOLUTE,
} from './validate-form-layout.js';
export type { FormLayoutFinding, FormLayoutSeverity } from './validate-form-layout.js';

export {
  validateVisibilityPredicates,
  VISIBILITY_ALIAS_DEPRECATED,
  VISIBILITY_ROOT_MISLAYERED,
} from './validate-visibility-predicates.js';
export type {
  VisibilityFinding,
  VisibilitySeverity,
  VisibilityLayer,
  VisibilityOptions,
} from './validate-visibility-predicates.js';

export {
  validateCapabilityReferences,
  CAPABILITY_REFERENCE_UNKNOWN,
} from './validate-capability-references.js';
export type { CapabilityRefFinding, CapabilityRefSeverity } from './validate-capability-references.js';

export {
  validateApprovalApprovers,
  APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_DEPRECATED,
  APPROVAL_APPROVER_TYPE_UNKNOWN,
  APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
  APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
  APPROVAL_EXPRESSION_INVALID,
  APPROVAL_EXPRESSION_NO_EMPTY_POLICY,
  APPROVAL_DECISION_OUTPUTS_RESERVED,
  APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED,
} from './validate-approval-approvers.js';
export type { ApprovalApproverFinding, ApprovalApproverSeverity } from './validate-approval-approvers.js';

export {
  validateSeedReplaySafety,
  SEED_INSERT_MODE_DUPLICATES_ON_REPLAY,
} from './validate-seed-replay-safety.js';
export type { SeedReplaySafetyFinding, SeedReplaySafetySeverity } from './validate-seed-replay-safety.js';

export {
  validateSeedStateMachine,
  SEED_VALUE_OUTSIDE_STATE_MACHINE,
} from './validate-seed-state-machine.js';
export type { SeedStateMachineFinding, SeedStateMachineSeverity } from './validate-seed-state-machine.js';

export {
  validateSecurityPosture,
  SECURITY_OWD_UNSET,
  SECURITY_OWD_ALIAS,
  SECURITY_EXTERNAL_WIDER,
  SECURITY_WILDCARD_VAMA,
  SECURITY_ANCHOR_HIGH_PRIVILEGE,
  SECURITY_ROLE_WORD,
  SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_GRANT_EXPIRED_AT_AUTHORING,
  SECURITY_DELEGATION_MISSING_REASON,
} from './validate-security-posture.js';
export type { SecurityFinding, SecuritySeverity } from './validate-security-posture.js';

export {
  validateOrgAxisRedLines,
  ORG_AXIS_PERMISSION_INHERITANCE,
  ORG_AXIS_CROSS_ORG_BU_GRANT,
} from './validate-org-axis-red-lines.js';
export type { OrgAxisFinding, OrgAxisSeverity } from './validate-org-axis-red-lines.js';

export {
  validateDashboardActionRefs,
  DASHBOARD_ACTION_TARGET_UNDEFINED,
  DASHBOARD_ACTION_ROUTE_UNRESOLVED,
} from './validate-dashboard-action-refs.js';
export type {
  DashboardActionRefFinding,
  DashboardActionRefSeverity,
} from './validate-dashboard-action-refs.js';

export { validateFilterTokens, FILTER_TOKEN_UNKNOWN } from './validate-filter-tokens.js';
export type { FilterTokenFinding, FilterTokenSeverity } from './validate-filter-tokens.js';

export {
  validateObjectReferences,
  OBJECT_REFERENCE_UNKNOWN,
  OBJECT_REFERENCE_UNREGISTERED_PLATFORM,
} from './validate-object-references.js';
export type { ObjectRefFinding, ObjectRefSeverity } from './validate-object-references.js';

export { validateActionNameRefs, ACTION_NAME_UNDEFINED } from './validate-action-name-refs.js';
export type { ActionNameRefFinding, ActionNameRefSeverity } from './validate-action-name-refs.js';

export { validatePageFieldBindings, PAGE_FIELD_UNKNOWN } from './validate-page-field-bindings.js';
export type { PageFieldFinding, PageFieldSeverity } from './validate-page-field-bindings.js';

export {
  validateChartBindings,
  CHART_DIMENSION_UNKNOWN,
  CHART_MEASURE_UNKNOWN,
  CHART_DATASET_UNKNOWN,
  CHART_AXIS_NOT_SELECTED,
} from './validate-chart-bindings.js';
export type { ChartBindingFinding, ChartBindingSeverity } from './validate-chart-bindings.js';

export { validateNavAccess, NAV_OBJECT_UNGRANTED } from './validate-nav-access.js';
export type { NavAccessFinding, NavAccessSeverity } from './validate-nav-access.js';

export {
  validateTranslationReferences,
  TRANSLATION_TARGET_UNKNOWN,
  TRANSLATION_OPTION_KEY_UNKNOWN,
} from './validate-translation-references.js';
export type {
  TranslationRefFinding,
  TranslationRefSeverity,
} from './validate-translation-references.js';

export {
  validateAiSurfaceAffinity,
  AI_SKILL_SURFACE_MISMATCH,
} from './validate-ai-surface-affinity.js';
export type {
  AiSurfaceAffinityFinding,
  AiSurfaceAffinitySeverity,
} from './validate-ai-surface-affinity.js';

// One entry point for the reference-resolution rules above (#3583 §5 D5).
// Adding a rule to `REFERENCE_INTEGRITY_RULES` runs it on `validate`, `lint`
// and `compile` at once — the CLI call sites do not change.
export {
  validateReferenceIntegrity,
  REFERENCE_INTEGRITY_RULES,
} from './reference-integrity-suite.js';
export type {
  ReferenceIntegrityFinding,
  ReferenceIntegrityRule,
  ReferenceIntegritySeverity,
} from './reference-integrity-suite.js';

export { buildAccessMatrix, diffAccessMatrix } from './build-access-matrix.js';
