// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Type → Canonical Zod Schema map.
 *
 * Single source of truth used by:
 *
 *   1. Runtime validators (`MetadataManager.validate`) — already wired
 *      through the domain-specific overlay validator in `objectql/protocol`.
 *   2. The `/api/v1/meta/types/:type` endpoint, which converts each
 *      registered schema to JSON Schema (`z.toJSONSchema()`) and exposes
 *      it as `MetadataTypeInfo.schema`. Studio's metadata-admin engine
 *      renders the result with its generic `SchemaForm`, so adding a new
 *      writable metadata type now requires **zero** Studio-side code.
 *
 * The map intentionally only contains types that meaningfully round-trip
 * through the runtime metadata API. Code-only types whose entries cannot
 * be created via REST (`function`, `service`, `router`) are excluded —
 * `DEFAULT_METADATA_TYPE_REGISTRY` already marks them `allowRuntimeCreate:
 * false`, so the engine never tries to render a form for them.
 *
 * Profile shares `PermissionSetSchema` (a profile is a permission set
 * with `isProfile: true`); `validation` exposes the discriminated union
 * over all built-in rule variants. Custom plugin types can extend this
 * registry at runtime via `registerMetadataTypeSchema()`.
 */

import type { z } from 'zod';

import { FieldSchema } from '../data/field.zod';
import { ObjectSchema } from '../data/object.zod';
import { HookSchema } from '../data/hook.zod';
import { ValidationRuleSchema } from '../data/validation.zod';
import { DatasourceSchema } from '../data/datasource.zod';
import { SeedSchema } from '../data/seed.zod';

import { ViewSchema } from '../ui/view.zod';
import { PageSchema } from '../ui/page.zod';
import { DashboardSchema } from '../ui/dashboard.zod';
import { AppSchema } from '../ui/app.zod';
import { ActionSchema } from '../ui/action.zod';
import type { Action } from '../ui/action.zod';
import { ReportSchema } from '../ui/report.zod';
import { DatasetSchema } from '../ui/dataset.zod';

import { FlowSchema } from '../automation/flow.zod';

import { JobSchema } from '../system/job.zod';
import { EmailTemplateDefinitionSchema } from '../system/email-template.zod';
import { AppTranslationBundleSchema } from '../system/translation.zod';
import { DocSchema } from '../system/doc.zod';
import { BookSchema } from '../system/book.zod';

import { PermissionSetSchema } from '../security/permission.zod';
import { RoleSchema } from '../identity/role.zod';

import { AgentSchema } from '../ai/agent.zod';
import { ToolSchema } from '../ai/tool.zod';
import { SkillSchema } from '../ai/skill.zod';

import type { MetadataType } from './metadata-plugin.zod';
import { DEFAULT_METADATA_TYPE_REGISTRY } from './metadata-plugin.zod';

/**
 * Built-in mapping from metadata type identifier → its canonical Zod
 * schema. Types omitted here have no runtime-editable form (and are
 * marked `allowRuntimeCreate: false` in `DEFAULT_METADATA_TYPE_REGISTRY`).
 */
const BUILTIN_METADATA_TYPE_SCHEMAS: Partial<Record<MetadataType, z.ZodType>> = {
  // Data Protocol
  object: ObjectSchema,
  field: FieldSchema,
  hook: HookSchema,
  validation: ValidationRuleSchema,
  seed: SeedSchema, // fixture/init data; runtime-draftable, applied on publish
  // `trigger` — no standalone Zod schema yet; falls back to raw-JSON
  // editor until the data-trigger spec lands.

  // UI Protocol
  view: ViewSchema,
  page: PageSchema,
  dashboard: DashboardSchema,
  app: AppSchema,
  action: ActionSchema,
  report: ReportSchema,
  dataset: DatasetSchema, // ADR-0021: analytics semantic layer

  // Automation Protocol
  flow: FlowSchema,
  // ADR-0020: no `workflow` schema — record state machines are a
  // `state_machine` validation rule on the object (see ValidationRuleSchema).
  // ADR-0019: `approval` is no longer a standalone metadata type — approvals
  // are authored as Approval nodes inside a `flow`.
  job: JobSchema,

  // System Protocol
  datasource: DatasourceSchema,
  translation: AppTranslationBundleSchema,
  email_template: EmailTemplateDefinitionSchema,
  doc: DocSchema, // ADR-0046: flat Markdown package documentation
  book: BookSchema as unknown as z.ZodType, // ADR-0046 §6: documentation navigation spine
  // `router` / `function` / `service` are code-only (allowRuntimeCreate: false).

  // Security Protocol
  permission: PermissionSetSchema,
  profile: PermissionSetSchema, // profile = permission set with isProfile=true
  role: RoleSchema,

  // AI Protocol
  agent: AgentSchema,
  tool: ToolSchema,
  skill: SkillSchema,
};

/** Runtime-extensible overlay populated via `registerMetadataTypeSchema`. */
const EXTRA_METADATA_TYPE_SCHEMAS = new Map<string, z.ZodType>();

/**
 * Look up the canonical Zod schema for a metadata type.
 *
 * Returns the user-registered override if any, otherwise the built-in
 * schema. Returns `undefined` for types with no schema (e.g. `trigger`,
 * `function`, `service`, `router`).
 */
export function getMetadataTypeSchema(type: string): z.ZodType | undefined {
  return EXTRA_METADATA_TYPE_SCHEMAS.get(type) ?? BUILTIN_METADATA_TYPE_SCHEMAS[type as MetadataType];
}

/**
 * Register (or replace) the canonical Zod schema for a metadata type.
 *
 * Plugins that introduce custom metadata types — declared through
 * `additionalTypes` on `MetadataPluginConfig` — should call this from
 * their `onInstall` hook so the engine's `/meta/types/:type` endpoint
 * starts emitting a real JSON Schema for them. Idempotent.
 */
export function registerMetadataTypeSchema(type: string, schema: z.ZodType): void {
  EXTRA_METADATA_TYPE_SCHEMAS.set(type, schema);
}

/** Snapshot of every type that currently has a schema (built-in + extras). */
export function listMetadataTypeSchemaTypes(): string[] {
  const types = new Set<string>(Object.keys(BUILTIN_METADATA_TYPE_SCHEMAS));
  for (const t of EXTRA_METADATA_TYPE_SCHEMAS.keys()) types.add(t);
  return Array.from(types).sort();
}

// ==========================================
// Metadata Type Actions (type-level buttons)
// ==========================================

/**
 * Runtime-extensible overlay of plugin-contributed **type-level** actions,
 * keyed by metadata type. Mirrors `EXTRA_METADATA_TYPE_SCHEMAS` above.
 *
 * The merged view (built-in declarative actions from
 * `DEFAULT_METADATA_TYPE_REGISTRY` + these registered ones) is what the
 * `/api/v1/meta/types/:type` endpoint emits, so the Studio metadata-admin
 * engine renders one button mechanism — the same `ActionSchema` business
 * objects already use — for every metadata type.
 */
const EXTRA_METADATA_TYPE_ACTIONS = new Map<string, Action[]>();

/**
 * Register (or extend) the type-level actions for a metadata type.
 *
 * Plugins call this from `onInstall` to layer actions onto any type —
 * built-in or custom — without forking the registry. Actions merge by
 * `name`: a later registration with the same `name` replaces the earlier
 * one; new names append. Idempotent for identical input.
 *
 * Declarative actions baked into `DEFAULT_METADATA_TYPE_REGISTRY` are the
 * base layer; registered actions are merged on top by `getMetadataTypeActions`.
 */
export function registerMetadataTypeActions(type: string, actions: Action[]): void {
  const byName = new Map<string, Action>();
  for (const a of EXTRA_METADATA_TYPE_ACTIONS.get(type) ?? []) byName.set(a.name, a);
  for (const a of actions) byName.set(a.name, a);
  EXTRA_METADATA_TYPE_ACTIONS.set(type, Array.from(byName.values()));
}

/**
 * Resolve the full, merged list of type-level actions for a metadata type.
 *
 * Order: declarative actions from the registry entry first, then
 * plugin-registered actions (which override by `name`). Returns `[]` for a
 * type with no actions. This is the single accessor the metadata API layer
 * should call when emitting `MetadataTypeInfo.actions`.
 */
export function getMetadataTypeActions(type: string): Action[] {
  const declarative =
    (DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type)?.actions as Action[] | undefined) ?? [];
  const registered = EXTRA_METADATA_TYPE_ACTIONS.get(type) ?? [];
  if (declarative.length === 0 && registered.length === 0) return [];
  const byName = new Map<string, Action>();
  for (const a of declarative) byName.set(a.name, a);
  for (const a of registered) byName.set(a.name, a);
  return Array.from(byName.values());
}
