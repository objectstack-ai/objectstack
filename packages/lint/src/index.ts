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
} from './validate-widget-bindings.js';
export type { WidgetBindingFinding, WidgetBindingSeverity } from './validate-widget-bindings.js';

export { validateStackExpressions } from './validate-expressions.js';
export type { ExprIssue } from './validate-expressions.js';

export { validateListViewMode, LIST_VIEW_FILTERS_IN_VIEWS_MODE } from './validate-list-view-mode.js';
export type { ListViewModeFinding, ListViewModeSeverity } from './validate-list-view-mode.js';

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
export { validateReactPageProps } from './validate-react-page-props.js';
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
  APPROVAL_ROLE_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_UNKNOWN,
  APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
} from './validate-approval-approvers.js';
export type { ApprovalApproverFinding, ApprovalApproverSeverity } from './validate-approval-approvers.js';

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

export { buildAccessMatrix, diffAccessMatrix } from './build-access-matrix.js';
