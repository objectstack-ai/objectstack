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
 * `function`/`service`/`router` — and `trigger`, then `validation` — were
 * retired from the registry entirely by ADR-0088.)
 *
 * Custom plugin types can extend this registry at runtime via
 * `registerMetadataTypeSchema()`.
 */

import type { z } from 'zod';

import { FieldSchema } from '../data/field.zod';
import { ObjectSchema } from '../data/object.zod';
import { HookSchema } from '../data/hook.zod';
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
import { WebhookSchema } from '../automation/webhook.zod';

import { DeclarativeConnectorEntrySchema } from '../integration/connector.zod';

import { SharingRuleSchema } from '../security/sharing.zod';

import { ApiEndpointSchema } from '../api/endpoint.zod';

import { JobSchema } from '../system/job.zod';
import { EmailTemplateDefinitionSchema } from '../system/email-template.zod';
import { TranslationItemSchema } from '../system/translation.zod';
import { DocSchema } from '../system/doc.zod';
import { BookSchema } from '../system/book.zod';

import { PermissionSetSchema } from '../security/permission.zod';
import { CapabilityDeclarationSchema } from '../security/capabilities';
import { PositionSchema } from '../identity/position.zod';

import { AgentSchema } from '../ai/agent.zod';
import { ToolSchema } from '../ai/tool.zod';
import { SkillSchema } from '../ai/skill.zod';

import type { MetadataType } from './metadata-plugin.zod';
import { DEFAULT_METADATA_TYPE_REGISTRY } from './metadata-plugin.zod';

/**
 * Built-in mapping from metadata type identifier → its canonical Zod
 * schema. A type omitted here has no runtime-editable form.
 *
 * The converse does NOT hold: presence here is about schema RESOLUTION
 * (validation, diagnostics, generated docs), not about the runtime-create
 * door. `agent` (ADR-0063 §2), `job` (#4509), `capability` (#5961) and `api`
 * (#5488) are all listed and all carry `allowRuntimeCreate: false` in
 * `DEFAULT_METADATA_TYPE_REGISTRY` — they are authored in code and still need
 * their schema resolvable. That registry is the authority on who may write at
 * runtime; this map only says what shape a given type has.
 */
const BUILTIN_METADATA_TYPE_SCHEMAS: Partial<Record<MetadataType, z.ZodType>> = {
  // Data Protocol
  object: ObjectSchema,
  field: FieldSchema,
  hook: HookSchema,
  // ADR-0088 (#4509): no `validation` entry — the kind is retired. Rules are
  // authored inline as `object.validations[]`, where `ObjectSchema` already
  // carries `ValidationRuleSchema`, so the shape stays resolvable through its
  // owning object.
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
  // [#5271, part of #5206] Declarative HTTP endpoints (ADR-0121). The kind was
  // produced and consumed long before it resolved a schema: artifact ingest
  // maps `defineStack({ apis })` → `api` items and the endpoint matcher indexes
  // them. Without this entry `resolveOverlaySchema('api', …)` returned
  // `undefined`, so `saveMetaItem` took its documented "unregistered type →
  // store without validation" branch and `PUT /meta/api/:name` accepted ANY
  // JSON.
  //
  // ⚠️ [#5488] WHICH DOOR THIS SCHEMA NOW STANDS IN. The paragraph above used
  // to continue "…and `/meta/types` emits a real JSON Schema so the
  // metadata-admin engine renders a form instead of a raw-JSON textarea".
  // That is no longer the point of the binding: `api` is CODE-ONLY as of #5488
  // (`allowRuntimeCreate: false` + `allowOrgOverride: false`, maintainer ruling
  // 2026-08-07), because a runtime-created endpoint was never served — the
  // matcher reads `listForIndex('api')`, and a runtime write lands in
  // `sys_metadata`, which it does not read. So `PUT /meta/api/:name` is refused
  // by the #5086 inlet with 403 `NOT_CREATABLE` BEFORE any body validation, and
  // the 422 `invalid_metadata` path is no longer reachable for this kind from
  // the runtime write door. The entry stays, and is still load-bearing, for the
  // reason the header docblock gives: schema RESOLUTION is not the write door.
  // `api` items are validated on the ARTIFACT route — stack compile, loader
  // ingest, `publishPackage` — exactly like `job` and `agent`, which are listed
  // here and code-only for their own reasons.
  //
  // This is a SHAPE check only. Whether a well-shaped endpoint is SERVABLE
  // (ADR-0121 D1/D2 namespace carve-out, D6 anonymous-needs-armed-budget,
  // supported target subset, mapping/policy rules) is judged by
  // `validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure` at
  // publish and again at load — one judge, not two.
  api: ApiEndpointSchema,
  translation: TranslationItemSchema,
  email_template: EmailTemplateDefinitionSchema,
  doc: DocSchema, // ADR-0046: flat Markdown package documentation
  book: BookSchema as unknown as z.ZodType, // ADR-0046 §6: documentation navigation spine

  // Security Protocol
  permission: PermissionSetSchema,
  position: PositionSchema, // flat capability-distribution group (ADR-0090 D3)
  // [#5961, the same shape #5271 closed for `api`] Package-declared
  // authorization capabilities (ADR-0066 D1). The kind was produced and read
  // back long before it resolved a schema: `PLURAL_TO_SINGULAR` maps
  // `capabilities` → `capability` (#5870), `AppPlugin` registers stack-declared
  // ones under that name, and `bootstrapDeclaredCapabilities` reads them back to
  // seed `sys_capability`. Yet `getMetadataTypeSchema('capability')` answered
  // `undefined`, so `saveMetaItem` took its documented "unregistered type →
  // store without validation" branch and `PUT /meta/capability/:name` accepted
  // ANY JSON — on an AUTHORIZATION surface, where `systemPermissions` /
  // `requiredPermissions` resolve capabilities by NAME STRING, so an
  // arbitrary-JSON row lands in the same namespace a permission set grants
  // from. `/meta/types` compounded it by synthesising a fake descriptor
  // (`allowRuntimeCreate: true`, no schema ⇒ a raw-JSON textarea form) for a
  // kind the registry never declared.
  //
  // With this entry the existing 422 `invalid_metadata` path applies to
  // `capability` like every other kind, and the registry entry next to it
  // (`allowRuntimeCreate: false`) closes the runtime write door outright.
  capability: CapabilityDeclarationSchema,

  // AI Protocol
  agent: AgentSchema,
  tool: ToolSchema,
  skill: SkillSchema,
};

/**
 * Schema bindings for stack collections that are **not** metadata KINDS.
 *
 * [#6245, the same shape #5271 closed for `api`] `webhook`, `connector` and
 * `sharing_rule` are produced and consumed today — artifact ingest maps
 * `defineStack({ webhooks, connectors, sharingRules })` onto items of exactly
 * these three type names (`ARTIFACT_FIELD_TO_TYPE`) — yet none of them is a
 * member of `MetadataTypeSchema`. `getMetadataTypeSchema()` therefore answered
 * `undefined`, `resolveOverlaySchema()` answered `null`, and `saveMetaItem`
 * took its documented "unregistered type → store without validation" branch:
 * `PUT /api/v1/meta/webhook/:name` accepted ANY JSON and returned
 * `success: true`. Enforced but undeclared — the mirror of declared-but-
 * unenforced, and the same hole, three more doors.
 *
 * This map is separate from `BUILTIN_METADATA_TYPE_SCHEMAS` above because that
 * one is keyed by `MetadataType`, and these three are deliberately NOT that.
 * Binding a schema here is a SHAPE check and nothing else:
 *   - no `MetadataTypeSchema` enum member;
 *   - no `DEFAULT_METADATA_TYPE_REGISTRY` entry — so every authorization
 *     verdict (`isRuntimeCreateAllowed` and friends) keeps taking the very same
 *     "no static entry ⇒ synthesised `allowRuntimeCreate: true`" branch it takes
 *     today. The write DOOR is byte-identical; only the 422 for a malformed
 *     body is new;
 *   - no new capability surface, no permission change.
 * #2657's B/C decision on whether these should become kinds is untouched and
 * unprejudged — this is the enforce-what-we-already-accept half only.
 *
 * Each entry binds the SAME schema its stack collection is validated against in
 * `stack.zod.ts`, so no body can be legal in a stack and illegal through `/meta`
 * or the reverse.
 */
const UNREGISTERED_KIND_SCHEMAS: Record<string, z.ZodType> = {
  // `stack.zod.ts`: `webhooks: z.array(WebhookSchema)`
  webhook: WebhookSchema,

  // `stack.zod.ts`: `connectors: z.array(DeclarativeConnectorEntrySchema)`.
  //
  // Bound to the DECLARATIVE ENTRY schema, not the bare `ConnectorSchema`. The
  // base is a plain object so connector subtypes can `.extend()` it; the entry
  // schema adds the ADR-0097 cross-field rules that apply to an AUTHORED
  // connector — a provider-bound instance may not inline credentials via
  // `authentication` (§3), nor author `actions`/`triggers` the provider derives
  // (§5). `PUT /meta/connector/:name` is an authoring door in exactly the sense
  // `connectors:` is, and those rules are the ones a second door must not
  // reopen: binding the base here would leave the inline-secret shape ADR-0097
  // forbids in a stack reachable through `/meta`, which is this very bug class
  // wearing a different key. The rules fire only for provider-bound instances,
  // so catalog descriptors are unaffected.
  connector: DeclarativeConnectorEntrySchema as unknown as z.ZodType,

  // `stack.zod.ts`: `sharingRules: z.array(SharingRuleSchema)`.
  //
  // This shape is `.strict()` with no stored/stamped envelope, so it is an
  // AUTHOR-shape check and is applied only where author shapes are submitted:
  // the write door. It is not a filter on rows already in `sys_sharing_rule`.
  // Nothing re-parses stored rows through this registry — the read path only
  // DECORATES a document with `_diagnostics` (`computeMetadataDiagnostics`) and
  // never refuses one. Same treatment #5271/#5312 gave their strict surfaces.
  sharing_rule: SharingRuleSchema,
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
  return EXTRA_METADATA_TYPE_SCHEMAS.get(type)
    ?? BUILTIN_METADATA_TYPE_SCHEMAS[type as MetadataType]
    // #6245 — last, so a plugin's `registerMetadataTypeSchema()` override still
    // wins over a built-in binding here, exactly as it does over the map above.
    ?? UNREGISTERED_KIND_SCHEMAS[type];
}

/**
 * Register (or replace) the canonical Zod schema for a metadata type.
 *
 * Plugins that introduce custom metadata types — declared through
 * `additionalTypes` on `MetadataPluginConfig` — should call this from their
 * plugin's **`init(ctx)`**, so `GET /api/v1/meta` starts emitting a real JSON
 * Schema for them. Idempotent.
 *
 * This used to say "from their `onInstall` hook", pointing at a hook that
 * never ran (#4212). The kernel's `Plugin` contract is `init` / `start` /
 * `destroy` (`packages/core/src/types.ts`); the `onInstall` / `onEnable` /
 * `onDisable` / `onUninstall` / `onUpgrade` family had no invocation site
 * anywhere in the runtime and was retired from the protocol by #4212, so a
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
// [#6245] `UNREGISTERED_KIND_SCHEMAS` is deliberately NOT enumerated here.
// This list is the REGISTERED METADATA TYPE set, and the repo treats it as a
// contract surface, not a convenience index: `metadata-type-schemas.test.ts`
// walks it to enforce the #4001 unknown-key closure campaign and the ADR-0010
// protection-envelope declaration on every member, `metadata-create-seeds`
// requires a create seed per member, and the campaign count is asserted against
// it. Those are obligations of being a KIND. webhook/connector/sharing_rule are
// bound above for SHAPE VALIDATION precisely because they are not kinds, so
// enrolling them here would claim a status this change is careful not to grant
// (and #2657's B/C decision is exactly the one left open).

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
