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
  WIDGET_LEGACY_ANALYTICS_SHAPE,
  WIDGET_LEGACY_ANALYTICS_UNRENDERABLE,
  DASHBOARD_FILTER_FIELD_UNKNOWN,
} from './validate-widget-bindings.js';
export type { WidgetBindingFinding, WidgetBindingSeverity } from './validate-widget-bindings.js';

export { validateStackExpressions } from './validate-expressions.js';
export type { ExprIssue } from './validate-expressions.js';

// #4763 — `has(x)` reads as a null guard and is not one. The decision procedure
// is exported on its own so other authoring surfaces (cloud graph-lint, the AI
// authoring path) reuse ONE verdict instead of re-deriving it.
export {
  findUnguardedNullableOperands,
  nullGuardMessage,
  NULL_GUARD_HINT,
} from './validate-null-guards.js';
export type { NullGuardFinding, NullGuardOptions } from './validate-null-guards.js';

// #4776 — "the provider is not registered YET" and "there is no provider" are
// the same value in a registry that is still filling, and a verdict recorded
// from that value is never retracted. Exported as a decision procedure over
// plugin SOURCE (not over a stack), for the same reason the null-guard one
// above is: cloud graph-lint, the AI authoring path and a plugin author outside
// this repo must reach ONE verdict rather than re-derive it. In-repo
// enforcement is `lint-startup-registry-verdict.corpus.test.ts`, which sweeps
// `packages/**` with it; the SERVICE-registry half of the same family stays
// with `pnpm check:startup-registry-verdict` (see the module note for the
// measured division of labour between the two).
export {
  findStartupRegistryVerdicts,
  OPEN_VOCABULARY_PROBES,
  PRE_SEAL_PHASES,
  SEAL_MARKERS,
  STARTUP_VERDICT_HINT,
  STARTUP_OPEN_VOCABULARY_VERDICT,
  STARTUP_VERDICT_ASSERTIVE_WORDING,
} from './lint-startup-registry-verdict.js';
export type {
  StartupRegistryVerdictFinding,
  StartupRegistryVerdictOptions,
  StartupRegistryVerdictSeverity,
} from './lint-startup-registry-verdict.js';

export { validateListViewMode, LIST_VIEW_FILTERS_IN_VIEWS_MODE } from './validate-list-view-mode.js';

// [ADR-0078] The functional-completeness gate. All judgement lives in the shared
// predicate in `@objectstack/spec/kernel` (sibling of `isIncoherentAggregate`),
// so cloud graph-lint can re-home its duplicate rules onto the same source and
// the AI-build path cannot drift from the framework.
export { validateFunctionalCompleteness } from './validate-functional-completeness.js';
export type {
  FunctionalCompletenessFinding,
  FunctionalCompletenessSeverity,
} from './validate-functional-completeness.js';
export type { ListViewModeFinding, ListViewModeSeverity } from './validate-list-view-mode.js';
export {
  validateFlowTriggerReadiness,
  FLOW_TRIGGER_UNKNOWN_OBJECT,
  FLOW_DRAFT_STATUS_AMBIGUOUS,
  FLOW_TRIGGER_UNKNOWN_EVENT,
  FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
  FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
  FLOW_TRIGGER_UNROUTABLE,
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
  REACT_CHART_DRILLDOWN_INVALID,
  REACT_BLOCK_NEEDS_RECORD_CONTEXT,
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
  FIELD_GROUP_SHADOWED,
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
  VISIBILITY_ROOT_MISLAYERED,
  VISIBILITY_BARE_IDENTIFIER,
  VISIBILITY_PREDICATE_SYNTAX,
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
  APPROVAL_APPROVER_TYPE_UNSUPPORTED,
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
  SECURITY_FLS_UNQUALIFIED_KEY,
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

// #4698 — "a key that nothing reads should not validate clean", for the one
// surface where "is it read?" is decidable: a sharing rule's `condition` is
// read ONLY through `compileCelToFilter`, so the lint calls that same compiler
// rather than modelling the consumer.
export {
  validateSharingRuleEnforceability,
  SHARING_RULE_UNLOWERABLE_CONDITION,
  SHARING_RULE_RUNTIME_VARIABLE_CONDITION,
} from './validate-sharing-rule-enforceability.js';
export type {
  SharingRuleEnforceabilityFinding,
  SharingRuleEnforceabilitySeverity,
} from './validate-sharing-rule-enforceability.js';

// #4983 — the sibling surface, and ADR-0056 D4's gate finally wired. An RLS
// `using` / `check` the runtime cannot compile is DROPPED (and, when it is the
// only applicable policy, replaced by the deny sentinel), so the policy reads
// as an authorization and behaves as a blanket refusal. The verdict is
// `isSupportedRlsExpression` — the runtime's own, hoisted into
// `@objectstack/formula` in the same change so lint can reach it.
export {
  validateRlsPredicateEnforceability,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNPARSEABLE,
  RLS_PREDICATE_OVER_BUDGET,
} from './validate-rls-predicate-enforceability.js';
export type {
  RlsPredicateFinding,
  RlsPredicateSeverity,
} from './validate-rls-predicate-enforceability.js';

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

// #5330 — the same subtree, judged for SHAPE rather than for its strings. The
// runtime meaning of an empty combinator is settled (#5322: boolean identity,
// one implementation in `@objectstack/spec`'s `reduceFilterVerdict`); this
// refuses the literal spellings at authoring time, with a prescription that is
// per shape because the identities disagree — `{$and: []}` / `{}` are match-ALL
// and `{$or: []}` / `{$not: {}}` are match-NONE.
export {
  validateEmptyCombinators,
  FILTER_EMPTY_COMBINATOR,
  FILTER_EMPTY_NODE,
} from './validate-empty-combinators.js';
export type {
  EmptyCombinatorFinding,
  EmptyCombinatorSeverity,
} from './validate-empty-combinators.js';

export {
  validateObjectReferences,
  OBJECT_REFERENCE_UNKNOWN,
  OBJECT_REFERENCE_UNREGISTERED_PLATFORM,
} from './validate-object-references.js';
export type { ObjectRefFinding, ObjectRefSeverity } from './validate-object-references.js';

// [ADR-0072] The non-object nav targets (page/report/dashboard). Restores the
// coverage `defineStack`'s cross-reference block switches off when the stack
// declares none of that collection. `action` and `component` are deliberately
// NOT members — see the module doc for the verification behind each.
export { validateNavTargetRefs, NAV_TARGET_UNRESOLVED } from './validate-nav-target-refs.js';
export type { NavTargetRefFinding, NavTargetRefSeverity } from './validate-nav-target-refs.js';

export {
  validateSearchableFields,
  SEARCHABLE_FIELD_UNKNOWN,
  SEARCHABLE_FIELD_UNSEARCHABLE,
} from './validate-searchable-fields.js';
export type {
  SearchableFieldFinding,
  SearchableFieldSeverity,
  SearchableFieldRole,
} from './validate-searchable-fields.js';

export { validateActionNameRefs, ACTION_NAME_UNDEFINED } from './validate-action-name-refs.js';
export type { ActionNameRefFinding, ActionNameRefSeverity } from './validate-action-name-refs.js';

export { validateActionLocations, ACTION_NO_PLACEMENT } from './validate-action-locations.js';
export type { ActionLocationsFinding, ActionLocationsSeverity } from './validate-action-locations.js';

export { validatePageFieldBindings, PAGE_FIELD_UNKNOWN } from './validate-page-field-bindings.js';
export type { PageFieldFinding, PageFieldSeverity } from './validate-page-field-bindings.js';

export {
  validateComponentProps,
  COMPONENT_PROPS_UNKNOWN_KEY,
  COMPONENT_PROPS_INVALID,
} from './validate-component-props.js';
export type { ComponentPropsFinding, ComponentPropsSeverity } from './validate-component-props.js';

export {
  validateChartBindings,
  CHART_DIMENSION_UNKNOWN,
  CHART_MEASURE_UNKNOWN,
  CHART_DATASET_UNKNOWN,
  CHART_AXIS_NOT_SELECTED,
} from './validate-chart-bindings.js';
export type { ChartBindingFinding, ChartBindingSeverity } from './validate-chart-bindings.js';

// #4762 — the two STATIC artifacts an object validation rule carries (a
// `format` rule's `regex`, a `json_schema` rule's `schema`) are fail-OPEN at
// runtime: one that does not compile is logged and skipped, so the rule is
// declared and enforces nothing. Both are decidable without a record, so they
// are rejected at authoring/publish time — with the REAL compilers, and for ajv
// with the runtime's own options.
export {
  validateRuleCompilability,
  RUNTIME_AJV_OPTIONS,
  VALIDATION_RULE_REGEX_UNCOMPILABLE,
  VALIDATION_RULE_SCHEMA_UNCOMPILABLE,
} from './validate-rule-compilability.js';
export type {
  RuleCompilabilityFinding,
  RuleCompilabilitySeverity,
  WalkedValidationRule,
} from './validate-rule-compilability.js';

// #5178 — the residual half #5029's `ajv-formats` registration does not close.
// Under `strict: false` an UNRECOGNISED format name is logged once and the
// keyword is DROPPED, so `format: 'emial'` leaves the rule declared, running on
// every write, and enforcing nothing — with the record ACCEPTED. Judged here
// against the names that ajv instance really has registered, beside the compile
// above rather than inside it, so the runtime/gate compile parity is untouched.
export {
  validateRuleSchemaFormats,
  nearestRegisteredFormat,
  MAX_SCHEMA_WALK_DEPTH,
  VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT,
} from './validate-rule-schema-formats.js';
export type {
  RuleSchemaFormatFinding,
  RuleSchemaFormatSeverity,
} from './validate-rule-schema-formats.js';

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

// The other end of the same question (#5417): a form section authored with a
// `label` and no `name` renders a heading `_sections` can never address — no
// orphan key to report, and nothing for the coverage walk to demand.
export {
  validateTranslatableSections,
  TRANSLATION_SECTION_NAME_MISSING,
} from './validate-translatable-sections.js';
export type {
  TranslatableSectionFinding,
  TranslatableSectionSeverity,
} from './validate-translatable-sections.js';

export {
  validateAiSurfaceAffinity,
  AI_SKILL_SURFACE_MISMATCH,
} from './validate-ai-surface-affinity.js';
export type {
  AiSurfaceAffinityFinding,
  AiSurfaceAffinitySeverity,
} from './validate-ai-surface-affinity.js';

export {
  validateAiToolReferences,
  AI_SKILL_TOOL_UNRESOLVED,
} from './validate-ai-tool-references.js';
export type {
  AiToolRefFinding,
  AiToolRefSeverity,
} from './validate-ai-tool-references.js';

export {
  validateAiAgentAuthoring,
  AGENT_AUTHORING_WITHDRAWN,
} from './validate-ai-agent-authoring.js';
export type {
  AiAgentAuthoringFinding,
  AiAgentAuthoringSeverity,
} from './validate-ai-agent-authoring.js';

export {
  validateHookBodyWrites,
  extractHookBodyWrites,
  extractHookBodyWriteSet,
  HOOK_BODY_WRITE_PATTERNS,
  HOOK_BODY_WRITE_PATTERN_IDS,
  HOOK_BODY_WRITE_EXCLUSIONS,
  HOOK_BODY_WRITE_UNKNOWN_FIELD,
} from './validate-hook-body-writes.js';
export type {
  HookBodyWriteFinding,
  HookBodyWriteSeverity,
  HookBodyWritePattern,
  BodyWritePatternExclusion,
  ExtractedHookBodyWrite,
  ExtractedHookBodyWriteSet,
} from './validate-hook-body-writes.js';

// The same write-set check on action bodies — same schema, same sandbox, same
// silent no-op. Its ledger is a declared partition of HOOK_BODY_WRITE_PATTERNS
// (only the `ctx.api` family survives the context change), so the two rules
// share one extractor rather than growing two.
export {
  validateActionBodyWrites,
  ACTION_BODY_WRITE_PATTERNS,
  ACTION_BODY_WRITE_PATTERN_IDS,
  ACTION_RECORD_WRITE_PATTERNS,
  ACTION_RECORD_WRITE_PATTERN_IDS,
  ACTION_BODY_WRITE_EXCLUSIONS,
  ACTION_BODY_WRITE_UNKNOWN_FIELD,
  ACTION_RECORD_WRITE_DISCARDED,
} from './validate-action-body-writes.js';
export type {
  ActionBodyWriteFinding,
  ActionBodyWriteSeverity,
  ActionBodyWriteExclusion,
} from './validate-action-body-writes.js';

// The same write-set question on the third surface — a flow `update_record`
// node's structural `config.fields`. Shares the hook rule's field index and
// implicit-field set so all three agree on what is writable without being
// authored; gates (`error`) rather than advising, because a literal key against
// a literal object name is a certainty the parsed-JS rules cannot claim.
export {
  validateFlowNodeWrites,
  FLOW_NODE_WRITE_UNKNOWN_FIELD,
  FLOW_WRITE_NODE_TYPES,
  FLOW_WRITE_NODE_TYPES_DEFERRED,
} from './validate-flow-node-writes.js';
export type {
  FlowNodeWriteFinding,
  FlowNodeWriteSeverity,
  FlowWriteNodeDeferral,
} from './validate-flow-node-writes.js';

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

// ─── Rules relocated from `@objectstack/cli` (#4463) ─────────────────
//
// These five lived in `packages/cli/src/{utils,lint}/` while the registry that
// runs them lived beside them. That was fine while the CLI was the only
// consumer; it stopped being fine the moment the runtime write path had to run
// the SAME table, because the kernel cannot depend on the CLI. They moved here
// — the package the rules always belonged in — so `authoring-rules.ts` can live
// here too and both surfaces read one array. The CLI now imports them from this
// barrel; no rule logic changed in the move.

export { lintFlowPatterns } from './lint-flow-patterns.js';
export type { FlowLintFinding } from './lint-flow-patterns.js';
export {
  FLOW_TIME_RELATIVE_ANTIPATTERN,
  FLOW_DATE_EQUALITY_FILTER,
  FLOW_PHANTOM_AGGREGATION,
  FLOW_DOUBLE_BRACE_INTERP,
  FLOW_BARE_DOLLAR_REF,
  FLOW_APPROVAL_REVISE_DEAD_END,
  FLOW_APPROVAL_REVISE_UNMARKED_BACKEDGE,
  FLOW_APPROVAL_REVISE_DISABLED,
  FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED,
  FLOW_RUNAS_UNSCOPED,
  FLOW_ERROR_LABEL_NOT_FAULT,
  FLOW_BRANCH_LABEL_UNMATCHED,
  FLOW_DECISION_UNCONDITIONAL_BRANCH,
  FLOW_DEFAULT_EDGE_WITH_CONDITION,
  FLOW_MULTIPLE_DEFAULT_EDGES,
  FLOW_INERT_NODE_CONDITION,
  FLOW_MULTI_WRITE_UNFILTERED,
} from './lint-flow-patterns.js';

export { lintLivenessProperties } from './lint-liveness-properties.js';
export type { LivenessLintFinding } from './lint-liveness-properties.js';
export { LIVENESS_DEAD_PROPERTY, LIVENESS_EXPERIMENTAL_PROPERTY } from './lint-liveness-properties.js';

export { lintAutonumberFormats } from './lint-autonumber-formats.js';
export type { AutonumberLintFinding } from './lint-autonumber-formats.js';
export {
  AUTONUMBER_UNKNOWN_FIELD,
  AUTONUMBER_OPTIONAL_FIELD,
  AUTONUMBER_SELF_REFERENCE,
  AUTONUMBER_LITERAL_TOKEN,
} from './lint-autonumber-formats.js';

export { lintViewRefs } from './lint-view-refs.js';
export type { ViewRefFinding } from './lint-view-refs.js';
export {
  VIEW_KEY_COLLISION,
  VIEW_REF_FORM_TARGET_MISSING,
  VIEW_REF_FORM_TARGET_KIND,
} from './lint-view-refs.js';

export {
  lintUniqueDeclarations,
  lintUnscopedDeclaredIndexes,
  lintLegacyOrganizationComposites,
  lintDataModel,
  UNIQUE_DOUBLE_DECLARATION,
  UNIQUE_UNSCOPED_DECLARED_INDEX,
  UNIQUE_LEGACY_ORGANIZATION_COMPOSITE,
} from './data-model-rules.js';
export type { LintIssue, Severity } from './data-model-rules.js';

// ─── The registry itself (#4409, relocated #4463) ────────────────────
//
// The single source of truth for WHICH rules run WHERE. `os validate`,
// `os build`, `os lint` and the runtime metadata publish gate all read this
// one array — see `authoring-rules.ts` for why any second list is a bug.

export {
  AUTHORING_RULES,
  AUTHORING_COMMANDS,
  AUTHORING_SURFACES,
  EXPRESSION_INVALID,
  authoringRulesFor,
  runAuthoringRules,
  splitBySeverity,
} from './authoring-rules.js';
export type {
  AuthoringCommand,
  AuthoringFinding,
  AuthoringRule,
  AuthoringRuleContext,
  AuthoringRuleInputTier,
  AuthoringRuleRun,
  AuthoringRuleTier,
  AuthoringSeverity,
  AuthoringSurface,
} from './authoring-rules.js';

// The runtime publish gate over that registry. Also published as the
// `@objectstack/lint/runtime` subpath — the entry the kernel boot path imports,
// so a consumer there never names the graph that reaches the source parsers.
export {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';
export type { RuntimeGateResult, RuntimeStackContext } from './runtime-gate.js';

// The shared page-component traversal every `properties`-inspecting rule is
// built on (#3583). Exported because the CLI's i18n walker needs the same
// traversal to find `record:details` sections — and this walk is the one whose
// duplication has already produced a dead rule, so a second copy in another
// package is exactly what the module exists to prevent (#5405).
export { walkPageComponents, isSourceAuthoredPage } from './page-walk.js';
export type { WalkedComponent } from './page-walk.js';
