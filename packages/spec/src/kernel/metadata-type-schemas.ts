// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Type → Canonical Zod Schema map.
 *
 * Single source of truth used by:
 *
 *   1. Runtime validators (`MetadataManager.validate`) — already wired
 *      through the domain-specific overlay validator in `objectql/protocol`.
 *   2. `GET /api/v1/meta` (and the richer server-only `GET /meta/types`),
 *      which converts each registered schema to JSON Schema
 *      (`z.toJSONSchema()`) and exposes it as `MetadataTypeInfo.schema`.
 *      Studio's metadata-admin engine renders the result with its generic
 *      `SchemaForm`, so adding a new writable metadata type now requires
 *      **zero** Studio-side code. Both are served from
 *      `ObjectStackProtocolImplementation.getMetaTypes()`, which reads this
 *      registry at REQUEST time — a type registered after boot is picked up
 *      on the next call.
 *
 * The map intentionally only contains types that meaningfully round-trip
 * through the runtime metadata API. (The former code-only placeholder kinds
 * `function`/`service`/`router` — and `trigger` — were retired from the
 * registry entirely by ADR-0088.)
 *
 * `validation` exposes the discriminated union
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
import { MappingSchema } from '../data/mapping.zod';

import { ViewMetadataSchema } from '../ui/view.zod';
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
import { TranslationItemSchema } from '../system/translation.zod';
import { DocSchema } from '../system/doc.zod';
import { BookSchema } from '../system/book.zod';

import { PermissionSetSchema } from '../security/permission.zod';
import { PositionSchema } from '../identity/position.zod';

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
  mapping: MappingSchema as unknown as z.ZodType, // #2611: reusable import mapping; runtime-creatable so the wizard can save one

  // UI Protocol
  // #3095 — a union over the three runtime `view` shapes (defineView container,
  // standalone ViewItem record, flattened personalization overlay). The bare
  // container `ViewSchema` strip-parsed ViewItem/personalization bodies to `{}`,
  // making save-time 422 validation and read-time diagnostics a no-op for them.
  view: ViewMetadataSchema,
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
  translation: TranslationItemSchema,
  email_template: EmailTemplateDefinitionSchema,
  doc: DocSchema, // ADR-0046: flat Markdown package documentation
  book: BookSchema as unknown as z.ZodType, // ADR-0046 §6: documentation navigation spine

  // Security Protocol
  permission: PermissionSetSchema,
  position: PositionSchema, // flat capability-distribution group (ADR-0090 D3)

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
 * schema. Returns `undefined` for types with no schema (e.g. `external_catalog`,
 * which is runtime-created by the datasource Sync wizard — ADR-0062/0088).
 */
export function getMetadataTypeSchema(type: string): z.ZodType | undefined {
  return EXTRA_METADATA_TYPE_SCHEMAS.get(type) ?? BUILTIN_METADATA_TYPE_SCHEMAS[type as MetadataType];
}

/**
 * Register (or replace) the canonical Zod schema for a metadata type.
 *
 * Plugins that introduce custom metadata types — declared through
 * `additionalTypes` on `MetadataPluginConfig` — should call this from their
 * plugin's **`init(ctx)`**, so `GET /api/v1/meta` starts emitting a real JSON
 * Schema for them. Idempotent.
 *
 * This used to say "from their `onInstall` hook", pointing at a hook that does
 * not run (#4212). The kernel's `Plugin` contract is `init` / `start` /
 * `destroy` (`packages/core/src/types.ts`); the `onInstall` / `onEnable` /
 * `onDisable` / `onUninstall` / `onUpgrade` family declared on
 * `PluginLifecycleSchema` has no invocation site anywhere in the runtime, so a
 * plugin that followed the old advice registered nothing and got no error.
 * `init` is what the one real caller of the sibling
 * {@link registerMetadataTypeActions} uses — see
 * `DatasourceAdminServicePlugin.init`.
 *
 * NOTE — registering a schema alone does not make a type appear in the
 * listing. `getMetaTypes()` enumerates types from the engine registry and the
 * metadata service, then decorates each with its schema; a type present here
 * but in neither of those is not reached. Register the type as well as its
 * schema.
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
 * `DEFAULT_METADATA_TYPE_REGISTRY` + these registered ones) is what
 * `GET /api/v1/meta` emits, so the Studio metadata-admin engine renders one
 * button mechanism — the same `ActionSchema` business objects already use —
 * for every metadata type.
 */
const EXTRA_METADATA_TYPE_ACTIONS = new Map<string, Action[]>();

/**
 * Register (or extend) the type-level actions for a metadata type.
 *
 * Plugins call this from their `init(ctx)` to layer actions onto any type —
 * built-in or custom — without forking the registry. `DatasourceAdminServicePlugin`
 * is the worked example: it registers the datasource "Test connection" button
 * as the first statement of `init`, co-located with the route that serves it.
 * (This said `onInstall` until #4212 — a hook nothing calls.) Actions merge by
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
