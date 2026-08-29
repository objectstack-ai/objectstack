// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec
 * 
 * ObjectStack Protocol & Specification
 * 
 * This package does NOT export type namespaces at the root level, to prevent
 * naming conflicts — `import { Data, UI, System } from '@objectstack/spec'`
 * names nothing the root exports. The root DOES export a curated set of
 * authoring `defineX` factory functions (`defineStack`, `defineView`,
 * `defineApp`, `defineFlow`, `defineAgent`, `defineTool`, `defineSkill`, …)
 * for direct top-level use. Every domain's TYPES, and its `*Schema` values,
 * are reached through that domain's own subpath instead
 * (`@objectstack/spec/data`, `@objectstack/spec/identity`, …).
 *
 * ## Import Styles
 *
 * ### Style 1: Root-Level Factory Imports
 * <!-- os:check -->
 * ```typescript
 * import { defineSkill } from '@objectstack/spec';
 *
 * const skill = defineSkill({
 *   name: 'case_management',
 *   label: 'Case Management',
 *   description: 'Handles support case lifecycle',
 *   instructions: 'Use these tools to create, update, and resolve support cases.',
 *   tools: ['create_case', 'update_case', 'resolve_case'],
 * });
 * ```
 *
 * ### Style 2: Namespace Imports via Subpath
 * <!-- os:check -->
 * ```typescript
 * import * as Data from '@objectstack/spec/data';
 * import * as UI from '@objectstack/spec/ui';
 * import * as System from '@objectstack/spec/system';
 * import * as Identity from '@objectstack/spec/identity';
 *
 * const field: Data.Field = { name: 'task_name', type: 'text' };
 * const user: Identity.User = {
 *   id: 'u1',
 *   email: 'user@example.com',
 *   createdAt: '2026-01-01T00:00:00.000Z',
 *   updatedAt: '2026-01-01T00:00:00.000Z',
 * };
 * ```
 *
 * ### Style 3: Direct Subpath Imports
 * <!-- os:check -->
 * ```typescript
 * import { Field, FieldType } from '@objectstack/spec/data';
 * import { User } from '@objectstack/spec/identity';
 *
 * const field: Field = { name: 'task_name', type: 'text' };
 * const user: User = {
 *   id: 'u1',
 *   email: 'user@example.com',
 *   createdAt: '2026-01-01T00:00:00.000Z',
 *   updatedAt: '2026-01-01T00:00:00.000Z',
 * };
 * ```
 *
 * ## Standing principle for export surfaces (#10096, maintainer ruling 2026-08-20)
 *
 * > **浏览器可达的 spec 导出面必须 schema-free。** A `@objectstack/spec` export
 * > surface that browser/client consumers reach must carry vocabulary — maps,
 * > folds, enums, pure predicates — without linking the zod schema/validation
 * > machinery. The schema graph is the server/publish side's dependency, never
 * > the price of spelling a URL segment or reading a posture predicate.
 *
 * Every subpath entry is a self-contained bundle, so a vocabulary symbol that
 * shares an entry with schema modules costs its consumers the whole schema
 * closure (measured on #10096: one string fold through `/shared` cost
 * +60.1 KB gzipped). When adding an export a browser consumer will reach,
 * either put it on a schema-free entry (`/meta-spelling` is the reference:
 * heavy derivation happens at BUILD time via a generator + check gate, the
 * entry ships pure data and functions) or verify the entry's module graph
 * stays schema-free. Mechanizing this principle as a gate is a welcome
 * follow-up; until then it binds as a stated rule.
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

// [#11350] Root-entry nameability of the root's own inferred types. `defineStack`
// returns `ObjectStackDefinition`, which is declared `z.input<typeof
// ObjectStackDefinitionSchema>` — a generic instantiation the declaration
// emitter does not preserve as an alias — so an un-annotated
// `export default defineStack(...)` is emitted as the STRUCTURAL expansion,
// and that expansion mentions these three types. Without root re-exports, tsc
// can only name them through the hash-named internal dist chunk that declares
// them (unaddressable through the package's `exports` map → TS2883 in every
// consumer inferring through a root-entry function). All three are already
// public on their domain subpaths (`/ui`, `/automation`); this block makes the
// root entry self-consistent. Invariant (maintainer ruling 2026-08-23,
// recorded on #11350): a type that appears structurally in an entry's public
// declarations must be nameable from that same entry.
export type { FormFieldInput } from './ui/view.zod';
export type { NavigationItemInput } from './ui/app.zod';
export type { StateNodeConfig } from './automation/state-machine.zod';
// [#11709] #11350's recorded premise delta, ruled the same way (maintainer
// decision 2026-08-25, recorded on #11709): the MINIMAL one-file consumer —
// no `/data` subpath import anywhere in its program — leaks two more
// structural mentions of `defineStack`'s return type that the three lines
// above do not cover. Same invariant, same fix shape: re-export from the
// declaring module (both already public on `/data`).
export type { BaseValidationRuleShape } from './data/validation.zod';
export type { FilterCondition } from './data/filter.zod';
// [#12414] The invariant generalized to every public entry, not just the root:
// probing every `define*` factory across all 17 subpaths found the class was
// never closed by #11350/#11709 — four more entries leak a structurally-
// mentioned type through a factory return value. Same invariant (maintainer
// ruling recorded on #11350), same one-line-per-name repair: re-export from
// the declaring module. All three are already public on their own subpaths
// (`/system`, `/ui`).
export type { Book } from './system/book.zod';
export type { FormField } from './ui/view.zod';
export type { NavigationItem } from './ui/app.zod';

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
// `defineTheme` was removed at #10485 with `ui/theme.zod.ts` (ADR-0049) — see
// the block in `./ui/index.ts`; `app.branding` is the one colour surface.
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
  // The `plugins[]`-wired out-of-repo runtimes the token-keyed map structurally
  // cannot describe (no `requires` token to key a row by) — provenance only,
  // never resolution (#10921, #11263).
  PLATFORM_PLUGIN_WIRED_RUNTIMES,
  // The foundational slate every server-side runtime mounts (cloud#925, #3786) —
  // one declaration for `objectstack serve` and cloud's per-tenant runtime alike.
  PLATFORM_ALWAYS_ON_CAPABILITIES,
  classifyRequiredCapability,
  type CapabilityEdition,
  type PlatformCapabilityProvider,
  type PlatformPluginWiredRuntime,
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
  ADMIN_FULL_ACCESS_CAPABILITIES,
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
