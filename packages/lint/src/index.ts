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
