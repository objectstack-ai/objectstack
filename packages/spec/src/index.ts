// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec
 * 
 * ObjectStack Protocol & Specification
 * 
 * This package does NOT export types at the root level to prevent naming conflicts.
 * Please use namespaced imports or subpath imports.
 * 
 * ## Import Styles
 * 
 * ### Style 1: Namespace Imports from Root
 * ```typescript
 * import { Data, UI, System, Auth, AI, API } from '@objectstack/spec';
 * 
 * const field: Data.Field = { name: 'task_name', type: 'text' };
 * const user: Auth.User = { id: 'u1', email: 'user@example.com' };
 * ```
 * 
 * ### Style 2: Namespace Imports via Subpath
 * ```typescript
 * import * as Data from '@objectstack/spec/data';
 * import * as UI from '@objectstack/spec/ui';
 * import * as System from '@objectstack/spec/system';
 * import * as Auth from '@objectstack/spec/auth';
 * 
 * const field: Data.Field = { name: 'task_name', type: 'text' };
 * const user: Auth.User = { id: 'u1', email: 'user@example.com' };
 * ```
 * 
 * ### Style 3: Direct Subpath Imports
 * ```typescript
 * import { Field, FieldType } from '@objectstack/spec/data';
 * import { User, Session } from '@objectstack/spec/auth';
 * 
 * const field: Field = { name: 'task_name', type: 'text' };
 * const user: User = { id: 'u1', email: 'user@example.com' };
 * ```
 */

// ============================================================================
// NAMESPACE EXPORTS — REMOVED
// ============================================================================
// `export * as Namespace from './sub'` is NOT tree-shakeable in Node ESM —
// every subdomain (16 of them, ~400 Zod schema closures) is force-evaluated
// on the first `import` of `@objectstack/spec`, even when consumers only
// touch one namespace. This caused ~1.2GB RSS bloat in `@objectstack/objectos`.
//
// Use subpath imports instead:
//   import * as Data from '@objectstack/spec/data';
//   import { Field } from '@objectstack/spec/data';
//
// Enforced by the `no-restricted-imports` ESLint rule.

export {
  defineStack,
  composeStacks,
  ComposeStacksOptionsSchema,
  ConflictStrategySchema,
  ObjectStackDefinitionSchema,
  ObjectStackSchema
} from './stack.zod';

export type { DefineStackOptions, ComposeStacksOptions, ConflictStrategy, ObjectStackDefinitionInput } from './stack.zod';

export * from './stack.zod';

// DX Helper Functions (re-exported for convenience)
export { defineView, defineForm, defineViewItem, isAggregatedViewContainer, expandViewContainer, expandViewContainerWithDiagnostics } from './ui/view.zod';
// [#5320] The assembled-manifest view channel: the `viewItems:` vocabulary, its
// producer-side partition, and the shared container classifier the registration
// loop's `views:` tighten judges by.
export {
  ASSEMBLED_VIEW_ITEMS_KEY,
  AssembledViewArtifactSchema,
  isViewContainerShaped,
  partitionAssembledViewArtifacts,
} from './ui/assembled-views.zod';
export type { AssembledViewArtifact, AssembledViewArtifactParsed, AssembledViewPartition } from './ui/assembled-views.zod';
export type { ExpandedViewItem, ViewKeyCollision, ExpandViewResult } from './ui/view.zod';
export { defineApp } from './ui/app.zod';
export { defineFlow } from './automation/flow.zod';
export { defineJob } from './system/job.zod';
export { defineBook } from './system/book.zod';
export { defineAgent } from './ai/agent.zod';
export { defineTool } from './ai/tool.zod';
export { defineSkill } from './ai/skill.zod';

// DX factories for the remaining authoring domains (issue #2035) — one type-safe
// entry per writable domain, mirroring the 19 factories above. `defineX` is a
// *value* import: a broken import hard-errors instead of silently degrading to
// `any` (the #2023 failure mode). Input-shape config + runtime `.parse()`.
export { defineDatasource } from './data/datasource.zod';
export { defineHook } from './data/hook.zod';
export { defineConnector } from './integration/connector.zod';
export { defineSharingRule } from './security/sharing.zod';
export { definePosition, EVERYONE_POSITION, GUEST_POSITION, AUDIENCE_ANCHOR_POSITIONS } from './identity/position.zod';
export { definePermissionSet } from './security/permission.zod';
export { defineCapability } from './security/capabilities';
export { defineEmailTemplateDefinition } from './system/email-template.zod';
export { defineReport } from './ui/report.zod';
export { defineWebhook } from './automation/webhook.zod';
export { defineObjectExtension } from './data/object.zod';
// Pre-parse report of authored keys the metadata schemas would strip (#3786).
// Exported from the ROOT: `defineStack` (this package) and the CLI's
// `os validate`/`os build` are the callers, and all import from the root. The
// walker lives in kernel/ (it imports every schema); the comparator, guidance
// tables and finding shape stay in data/ (frontend-safe).
export {
  lintUnknownAuthoringKeys,
  lintUnknownKeysAgainstSchema,
  lintUnknownStackKeys,
  listLintableAuthoringCollections,
} from './kernel/metadata-authoring-lint';
export type { LintableAuthoringCollection } from './kernel/metadata-authoring-lint';
export {
  formatUnknownAuthoringKey,
  FIELD_KEY_GUIDANCE,
  OBJECT_KEY_GUIDANCE,
  STACK_KEY_GUIDANCE,
  STACK_RUNTIME_MEMBERS,
} from './data/authoring-key-lint';
export type {
  UnknownAuthoringKeyFinding,
  AuthoringKeySurface,
} from './data/authoring-key-lint';
export { defineCube } from './data/analytics.zod';
export { defineMapping } from './data/mapping.zod';
export { defineTheme } from './ui/theme.zod';
export { defineTranslationBundle } from './system/translation.zod';
export { definePage } from './ui/page.zod';
export { defineAction } from './ui/action.zod';
export type { Agent } from './ai/agent.zod';
export type { Tool } from './ai/tool.zod';
export type { Skill } from './ai/skill.zod';

// DX Validation Utilities (re-exported for convenience)
export { objectStackErrorMap, formatZodError, formatZodIssue, safeParsePretty } from './shared/error-map.zod';
export { suggestFieldType, findClosestMatches, formatSuggestion } from './shared/suggestions.zod';
export { normalizeMetadataCollection, normalizeStackInput, normalizePluginMetadata, MAP_SUPPORTED_FIELDS, METADATA_ALIASES } from './shared/metadata-collection.zod';
export type { MetadataCollectionInput, MapSupportedField, NormalizeStackInputOptions } from './shared/metadata-collection.zod';

// Metadata conversion layer (ADR-0087 D2) — old-shape → canonical-shape transforms applied at load.
export * from './conversions/index.js';

// Metadata migration chain + change manifest (ADR-0087 D3/D4).
export * from './migrations/index.js';

export { type PluginContext } from './kernel/plugin.zod';

// Platform SERVICE capability vocabulary for `requires: [...]` (framework#3265),
// plus the provider/edition registry + classifier behind the installable-provider
// preflight (framework#3366).
export {
  PLATFORM_CAPABILITY_TOKENS,
  isKnownPlatformCapability,
  PLATFORM_CAPABILITY_PROVIDERS,
  // The foundational slate every server-side runtime mounts (cloud#925, #3786) —
  // one declaration for `objectstack serve` and cloud's per-tenant runtime alike.
  PLATFORM_ALWAYS_ON_CAPABILITIES,
  classifyRequiredCapability,
  type CapabilityEdition,
  type PlatformCapabilityProvider,
  type CapabilityProviderStatus,
  type CapabilityClassification,
} from './kernel/platform-capabilities';

// Expression Protocol (M9 — canonical wire format for formulas / predicates / conditions)
export {
  ExpressionDialect,
  ExpressionMetaSchema,
  ExpressionSchema,
  ExpressionInputSchema,
  CronExpressionInputSchema,
  TemplateExpressionInputSchema,
  PredicateSchema,
  PredicateInputSchema,
  expression,
  cel,
  cron,
  tmpl,
  F,
  P,
} from './shared/expression.zod';
export type {
  Expression,
  ExpressionMeta,
  ExpressionInput,
  Predicate,
  PredicateInput,
} from './shared/expression.zod';


// ADR-0068: unified user-context contract (EvalUser) + built-in identity roles.
export {
  createEvalUser,
  mapMembershipRole,
  EvalUserSchema,
  BUILTIN_IDENTITY_NAMES,
  BUILTIN_IDENTITY_METADATA,
  BUILTIN_IDENTITY_PLATFORM_ADMIN,
  BUILTIN_IDENTITY_ORG_OWNER,
  BUILTIN_IDENTITY_ORG_ADMIN,
  BUILTIN_IDENTITY_ORG_MEMBER,
  ADMIN_FULL_ACCESS,
  ORGANIZATION_ADMIN,
  ORGANIZATION_ADMIN_NO_BYPASS,
  ORGANIZATION_ADMIN_GRANTS,
} from './identity/eval-user.zod';
export type { EvalUser, BuiltinIdentityName } from './identity/eval-user.zod';

// #3723 / ADR-0108: organization membership roles — the closed, framework-owned
// vocabulary behind better-auth's role registry AND the `sys_invitation` /
// `sys_member` role selects. Capability travels through positions, never here.
export {
  MEMBERSHIP_ROLE_OWNER,
  MEMBERSHIP_ROLE_ADMIN,
  MEMBERSHIP_ROLE_MEMBER,
  MEMBERSHIP_ROLE_DELEGATED_ADMIN,
  BUILTIN_MEMBERSHIP_ROLES,
  BUILTIN_MEMBERSHIP_ROLE_OPTIONS,
} from './identity/membership-role';
export type { BuiltinMembershipRole } from './identity/membership-role';
