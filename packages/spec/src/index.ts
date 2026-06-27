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
  ObjectStackSchema,
  ObjectStackCapabilitiesSchema,
  ObjectQLCapabilitiesSchema,
  ObjectUICapabilitiesSchema,
  ObjectOSCapabilitiesSchema
} from './stack.zod';

export type { DefineStackOptions, ComposeStacksOptions, ConflictStrategy, ObjectStackDefinitionInput } from './stack.zod';

export * from './stack.zod';

// DX Helper Functions (re-exported for convenience)
export { defineView, defineForm, defineViewItem, isAggregatedViewContainer, expandViewContainer } from './ui/view.zod';
export type { ExpandedViewItem } from './ui/view.zod';
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
export { defineConnector } from './integration/connector.zod';
export { defineSharingRule } from './security/sharing.zod';
export { defineRole } from './identity/role.zod';
export { definePermissionSet } from './security/permission.zod';
export { defineEmailTemplateDefinition } from './system/email-template.zod';
export { defineReport } from './ui/report.zod';
export { defineWebhook } from './automation/webhook.zod';
export { defineObjectExtension } from './data/object.zod';
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
export type { MetadataCollectionInput, MapSupportedField } from './shared/metadata-collection.zod';

export { type PluginContext } from './kernel/plugin.zod';

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
  BUILTIN_ROLE_NAMES,
  BUILTIN_ROLE_METADATA,
  BUILTIN_ROLE_PLATFORM_ADMIN,
  BUILTIN_ROLE_ORG_OWNER,
  BUILTIN_ROLE_ORG_ADMIN,
  BUILTIN_ROLE_ORG_MEMBER,
  ADMIN_FULL_ACCESS,
} from './identity/eval-user.zod';
export type { EvalUser, EvalUserInput, BuiltinRoleName } from './identity/eval-user.zod';
