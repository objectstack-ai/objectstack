// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ViewSchema } from '../ui/view.zod';
import { DiscoverySchema } from './discovery.zod';
import {
  BatchUpdateRequestSchema,
  BatchUpdateResponseSchema,
  UpdateManyRequestSchema,
  DeleteManyRequestSchema,
} from './batch.zod';
import { MetadataCacheRequestSchema, MetadataCacheResponseSchema } from './http-cache.zod';
import { QuerySchema, QUERY_DISTINCT_REMOVED } from '../data/query.zod';
import { retiredKey } from '../shared/retired-key';
import { DroppedFieldsEventSchema } from '../data/data-engine.zod';
import { 
  AnalyticsQueryRequestSchema,  
  AnalyticsResultResponseSchema, 
  GetAnalyticsMetaRequestSchema, 
  AnalyticsMetadataResponseSchema 
} from './analytics.zod';
import { RealtimePresenceSchema, TransportProtocol } from './realtime.zod';
import { ObjectPermissionSchema, EffectiveObjectPermissionSchema, FieldPermissionSchema } from '../security/permission.zod';
import { ActionDescriptorSchema } from '../automation/node-executor.zod';
import { TranslationDataSchema } from '../system/translation.zod';
import {
  ListPackagesRequestSchema,
  ListPackagesResponseSchema,
  GetPackageRequestSchema,
  GetPackageResponseSchema,
  InstallPackageRequestSchema,
  InstallPackageResponseSchema,
  UninstallPackageRequestSchema,
  UninstallPackageResponseSchema,
  EnablePackageRequestSchema,
  EnablePackageResponseSchema,
  DisablePackageRequestSchema,
  DisablePackageResponseSchema,
} from '../kernel/package-registry.zod';
import type {
  ListPackagesRequest,
  ListPackagesResponse,
  GetPackageRequest,
  GetPackageResponse,
  InstallPackageRequest,
  InstallPackageResponse,
  UninstallPackageRequest,
  UninstallPackageResponse,
  EnablePackageRequest,
  EnablePackageResponse,
  DisablePackageRequest,
  DisablePackageResponse,
  InstalledPackage,
  PackageStatus,
} from '../kernel/package-registry.zod';

import { lazySchema } from '../shared/lazy-schema';
export const AutomationTriggerRequestSchema = lazySchema(() => z.object({
  trigger: z.string(),
  payload: z.record(z.string(), z.unknown())
}));

export const AutomationTriggerResponseSchema = lazySchema(() => z.object({
  success: z.boolean(),
  jobId: z.string().optional(),
  result: z.unknown().optional()
}));

/**
 * Response for `GET /api/v1/automation/actions` (ADR-0018).
 *
 * Returns the live action/node registry — the platform's built-in actions plus
 * any plugin-contributed ones — backing the designer palette and flow
 * validation. Each entry is a canonical {@link ActionDescriptorSchema}.
 */
export const AutomationActionsResponseSchema = lazySchema(() => z.object({
  actions: z.array(ActionDescriptorSchema).describe('Registered action descriptors (built-in + plugin)'),
  total: z.number().int().nonnegative().describe('Number of descriptors returned (after any filters)'),
}));

/**
 * ObjectStack Protocol - Zod Schema Definitions
 * 
 * Defines the runtime-validated contract for interacting with ObjectStack metadata and data.
 * Used by API adapters (HTTP, WebSocket, gRPC) to fetch data/metadata without knowing engine internals.
 * 
 * This protocol enables:
 * - Runtime request/response validation at API gateway level
 * - Automatic API documentation generation
 * - Type-safe RPC communication between microservices
 * - Client SDK generation from schemas
 * 
 * Architecture Alignment:
 * - Salesforce: REST API Request/Response schemas
 * - Kubernetes: API Resource schemas with runtime validation
 * - GraphQL: Schema-first API design
 */

// ==========================================
// Discovery & Metadata Operations
// ==========================================

/**
 * Get API Discovery Request
 * No parameters needed
 */
export const GetDiscoveryRequestSchema = lazySchema(() => z.object({}));

/**
 * Get API Discovery Response
 * Derived from DiscoverySchema (single source of truth) for protocol-level use.
 * 
 * All fields from DiscoverySchema are available but made optional (except `version`)
 * to support progressive disclosure and backward compatibility with existing clients.
 * 
 * - `routes` provides a flat endpoint map for client routing.
 * - `services` is the single source of truth for service availability.
 * - `apiName` is kept as an optional alias for `name` for backward compatibility.
 *
 * ## This schema is the CLIENT's tolerance, never a producer's licence (#4828)
 *
 * `.partial()` exists so a client can parse an OLDER server's response without
 * exploding, and zod's default unknown-key strip lets it parse a NEWER one.
 * That tolerance is correct at this boundary and wrong as a producer contract —
 * and for a long time it was the only schema anything referenced, so it acted
 * as both. The result was `declared ≠ enforced` in both directions at once:
 * `getDiscovery()` never emitted the required `name`/`environment`/`locale` and
 * still parsed clean, while the runtime dispatcher emitted `features` and
 * `endpoints` — declared nowhere — and also parsed clean.
 *
 * So the two schemas now have separate jobs, and a gate compares them:
 *
 * - **{@link DiscoverySchema} is authoritative for PRODUCERS.** Every producer's
 *   live shape must satisfy it (`packages/metadata-protocol`, `packages/runtime`
 *   and `packages/rest` each carry a `discovery-schema-conformance.test.ts`).
 * - **This schema is the CONSUMER's parse**, and its key set is the allowance
 *   those producer gates check against — i.e. `DiscoverySchema`'s keys plus the
 *   declared deprecated aliases. `./discovery.test.ts` pins that equivalence, so
 *   a key can never again appear on one side only.
 *
 * ## `apiName` retirement schedule (ADR-0087)
 *
 * `apiName` is the sole surviving deprecated alias here. `name` is canonical and
 * REQUIRED by `DiscoverySchema`; as of protocol 17 every producer emits `name`,
 * and `getDiscovery()` additionally emits `apiName` with the identical value so
 * clients pinned to the alias keep working.
 *
 * - **Protocol 17 (now)**: both emitted; `name` canonical, `apiName` deprecated.
 * - **Protocol 18**: producers stop emitting `apiName` and it is removed from
 *   this schema. Consumers migrate to `name` — a pure rename with no semantic
 *   change, which is why it needs no D2 conversion entry (that table converts
 *   AUTHORED metadata at load; a response payload has no load seam).
 *
 * Consumers to migrate before 18 — measured 2026-08-05 across `objectstack`,
 * `objectui` and `cloud`: `packages/client/tests/integration/01-discovery.test.ts`
 * (TC-DISC-001/002). No product code in any of the three repos reads `apiName`.
 *
 * @see DiscoverySchema in ./discovery.zod.ts — the canonical definition.
 */
export const GetDiscoveryResponseSchema = lazySchema(() => DiscoverySchema
  .partial()
  .required({ version: true })
  .extend({
    /**
     * @deprecated Use `name` instead. Removed in protocol 18 — see the
     * retirement schedule above. Emitted alongside `name` until then.
     */
    apiName: z.string().optional().describe('API name (deprecated — use `name`; removed in protocol 18)'),
  }));

/**
 * Get Metadata Types Request
 */
export const GetMetaTypesRequestSchema = lazySchema(() => z.object({}));

/**
 * Get Metadata Types Response
 *
 * Phase 3a-1: returns the bare `types` array (for backwards compatibility)
 * plus rich per-type `entries` describing label, domain, file patterns, and
 * runtime capability flags. Admin UIs (Metadata Directory, Resource list,
 * Quick Find) consume `entries`; legacy code that only needs the type list
 * keeps using `types`.
 */
export const GetMetaTypesResponseSchema = lazySchema(() => z.object({
  types: z.array(z.string()).describe('Available metadata type names (e.g., "object", "plugin", "view")'),
  entries: z.array(z.object({
    type: z.string().describe('Singular type identifier'),
    label: z.string().describe('Human-readable label'),
    description: z.string().optional().describe('Brief description'),
    filePatterns: z.array(z.string()).describe('Glob patterns used to discover artifacts of this type'),
    supportsOverlay: z.boolean().describe('Loader can merge per-org overlays on top of artifact'),
    allowOrgOverride: z.boolean().describe('Per-org overlay writes accepted at runtime (may be env-elevated)'),
    allowRuntimeCreate: z.boolean().describe('New artifacts of this type can be created via runtime API'),
    supportsVersioning: z.boolean().describe('History is tracked for this type'),
    executionPinned: z.boolean().describe('Runtime transactions pin a specific historical version_hash (ADR-0009)'),
    loadOrder: z.number().int().describe('Loading priority (lower = earlier)'),
    domain: z.enum(['data', 'ui', 'automation', 'system', 'security', 'ai']).describe('Protocol domain'),
    overrideSource: z.enum(['registry', 'env']).describe('Whether allowOrgOverride is set in the static registry or via OS_METADATA_WRITABLE env var'),
    createSeed: z.unknown().optional().describe('Authoritative minimal valid create seed for this type — Studio/CLI/API derive create defaults from it (single source of truth in @objectstack/spec). Absent for canvas-create types whose shape is built interactively.'),
  })).optional().describe('Enriched per-type registry entries (Phase 3a)'),
}));

/**
 * Get Metadata Items Request
 * Get all items of a specific metadata type
 */
export const GetMetaItemsRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name (e.g., "object", "plugin")'),
  packageId: z.string().optional().describe('Optional package ID to filter items by'),
}));

/**
 * Get Metadata Items Response
 */
export const GetMetaItemsResponseSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  items: z.array(z.unknown()).describe('Array of metadata items'),
}));

/**
 * Get Metadata Item Request
 * Get a specific metadata item by type and name
 */
export const GetMetaItemRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name (snake_case identifier)'),
  packageId: z.string().optional().describe('Optional package ID to filter items by'),
}));

/**
 * Get Metadata Item Response
 */
export const GetMetaItemResponseSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
  item: z.unknown().describe('Metadata item definition'),
}));

/**
 * Save Metadata Item Request
 * Create or update a metadata item
 */
export const SaveMetaItemRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
  item: z.unknown().describe('Metadata item definition'),
}));

/**
 * Save Metadata Item Response
 *
 * Describes the FULL body `PUT /api/v1/meta/:type/:name` returns, not a subset
 * of it (#5745, settled by the #5563 maintainer ruling "补齐 spec 字段"). The
 * declaration previously stopped at `{ success, message }`, so a `.parse()` of
 * a real response silently STRIPPED `version` / `seq` / `state` — and
 * `SaveMetaItemResponse` could not even name them at the type level. `version`
 * in particular is the token the ADR-0008 optimistic-concurrency chain already
 * runs on (echo it back as `If-Match` on the next write to get a 409 instead of
 * a lost update), so leaving it undeclared meant the OCC carrier existed on the
 * wire with no contract behind it.
 *
 * Presence was measured against `origin/main`, not assumed: the sole producer is
 * `ObjectStackProtocolImplementation.saveMetaItem`, whose single success return
 * is the repository write path, and the REST route hands that object to
 * `res.json()` verbatim. That path always sets `version` / `seq` / `state`, so
 * the three are REQUIRED here; `projectionApplied` is conditional on an
 * ADR-0094 mutation projector being registered for the type, so it alone is
 * optional. (A second, receipt-less legacy return used to exist and would have
 * forced all three to be optional — it was proved unreachable and deleted in
 * #5264 / PR #5782, which is why `required` is safe to state.)
 */
export const SaveMetaItemResponseSchema = lazySchema(() => z.object({
  success: z.boolean(),
  version: z.string().describe(
    'Content hash of the just-committed body, and the token the ADR-0008 '
    + 'optimistic-concurrency chain runs on: send it back as the `If-Match` '
    + 'request header on the next write to that item and a concurrent edit is '
    + 'reported as 409 `metadata_conflict` instead of silently overwritten. '
    + 'Opaque to callers — echo it verbatim, never parse it. Currently emitted '
    + 'as `sha256:<64 hex chars>`, but the format is not part of this contract.',
  ),
  seq: z.number().int().describe(
    'Monotonic sequence number of the metadata event this write appended to '
    + 'the item history (sys_metadata_history.event_seq). Orders writes; unlike '
    + '`version` it is not an OCC token.',
  ),
  state: z.enum(['draft', 'active']).describe(
    'Lifecycle the body was written into: "draft" when the request asked for '
    + 'draft mode (`?mode=draft`), otherwise "active" (published and live). A '
    + 'draft is staged only — it is not served to the runtime until published.',
  ),
  projectionApplied: z.object({
    success: z.boolean().describe('False when the projector threw; the metadata write itself still succeeded.'),
    error: z.string().optional().describe('Projector failure message, present only when `success` is false.'),
  }).optional().describe(
    'Outcome of the awaited ADR-0094 mutation projector — the post-persist step '
    + 'that materializes this metadata into its derived data-plane read model '
    + '(e.g. `permission` → `sys_permission_set`). Present ONLY when a projector '
    + 'is registered for this metadata type, which is why it is optional: its '
    + 'absence means "no projector ran", never "the projection failed". '
    + 'Best-effort by design — a projector failure is reported here and logged, '
    + 'never thrown, so a caller that needs the read model to be live must check '
    + '`projectionApplied.success` rather than rely on the 200.',
  ),
  message: z.string().optional(),
}));

/**
 * Delete Metadata Item Request
 * Removes a customization overlay row from sys_metadata (ADR-0005).
 */
export const DeleteMetaItemRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
}));

/**
 * Delete Metadata Item Response
 * `reset === true` means a row was deleted (item is now at artifact default).
 * `reset === false` means no overlay row existed (already at artifact default).
 */
export const DeleteMetaItemResponseSchema = lazySchema(() => z.object({
  success: z.boolean(),
  reset: z.boolean().optional(),
  message: z.string().optional(),
}));

/**
 * Get Metadata Item with Cache Request
 * Get a specific metadata item with HTTP cache validation support
 */
export const GetMetaItemCachedRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type name'),
  name: z.string().describe('Item name'),
  cacheRequest: MetadataCacheRequestSchema.optional().describe('Cache validation parameters'),
  locale: z.string().optional().describe(
    'Resolved response locale. Folded into the ETag so a language switch '
    + 'never returns a stale-locale 304 — metadata is translated *after* the '
    + 'cache validator check (issue #1319).',
  ),
}));

/**
 * Get Metadata Item with Cache Response
 * Uses MetadataCacheResponse from http-cache.zod.ts
 */
export const GetMetaItemCachedResponseSchema = lazySchema(() => MetadataCacheResponseSchema);

/**
 * Get UI View Request
 * Resolves the appropriate UI view for an object based on context.
 * Unlike getMetaItem, this does not require a specific View ID.
 */
export const GetUiViewRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name (snake_case)'),
  type: z.enum(['list', 'form']).describe('View type'),
}));

/**
 * Get UI View Response
 */
export const GetUiViewResponseSchema = lazySchema(() => ViewSchema);

// ==========================================
// Data Operations
// ==========================================

/**
 * Find Data Request
 * Defines a query to retrieve records from a specific object.
 * Supports filtering, sorting, pagination, and field selection.
 * 
 * @example
 * {
 *   "object": "customers",
 *   "query": {
 *     "where": { "status": "active", "revenue": { "$gt": 10000 } },
 *     "orderBy": [{ "field": "name", "order": "desc" }],
 *     "limit": 10
 *   }
 * }
 */
export const FindDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The unique machine name of the object to query (e.g. "account").'),
  query: QuerySchema.optional().describe('Structured query definition (filter, sort, select, pagination).'),
}));

/**
 * Find Data Response
 * Returns a list of records matching the query criteria.
 */
export const FindDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name for the returned records.'),
  records: z.array(z.record(z.string(), z.unknown())).describe('The list of matching records.'),
  total: z.number().optional().describe('Total number of records matching the filter (if requested).'),
  nextCursor: z.string().optional().describe('Cursor for the next page of results (cursor-based pagination).'),
  hasMore: z.boolean().optional().describe('True if there are more records available (pagination).'),
}));

/**
 * HTTP Find Query Parameters
 * 
 * Canonical HTTP query parameter names for GET /data/:object list endpoints.
 * The canonical filter parameter is `filter` (singular). The plural `filters` is
 * accepted for backward compatibility but `filter` is the standard going forward.
 * 
 * This schema defines the allowlisted query parameters for HTTP GET list requests.
 * Server-side parsers (protocol.ts) should accept both `filter` and `filters` and
 * normalize to `filter` (singular) internally.
 * 
 * @example
 * GET /api/v1/data/contacts?filter={"status":"active"}&select=name,email&top=10&sort=name
 */
export const HttpFindQueryParamsSchema = lazySchema(() => z.object({
  /** @canonical Singular form — the standard going forward. JSON string of filter expression or AST. */
  filter: z.string().optional().describe('JSON-encoded filter expression (canonical, singular).'),
  /** @deprecated Use `filter` (singular). Accepted for backward compatibility. */
  filters: z.string().optional().describe('JSON-encoded filter expression (deprecated plural alias).'),
  select: z.string().optional().describe('Comma-separated list of fields to retrieve.'),
  sort: z.string().optional().describe('Sort expression (e.g. "name asc,created_at desc" or "-created_at").'),
  orderBy: z.string().optional().describe('Alias for sort (OData compatibility).'),
  top: z.coerce.number().optional().describe('Max records to return (limit).'),
  skip: z.coerce.number().optional().describe('Records to skip (offset).'),
  expand: z.string().optional().describe(
    'Comma-separated list of lookup/master_detail field names to expand. '
    + 'Resolved to populate array and passed to the engine for batch $in expansion.'
  ),
  search: z.string().optional().describe('Full-text search query.'),
  /** `?distinct` — REMOVED (#4286): the querystring spelling of `query.distinct`, same tombstone. */
  distinct: retiredKey(QUERY_DISTINCT_REMOVED),
  count: z.coerce.boolean().optional().describe('Include total count in response.'),
}));

/**
 * Get Data Request
 * Retrieval of a single record by its unique identifier.
 * Only `select` and `expand` are permitted as additional query parameters.
 * All other query parameters should be discarded to prevent parameter pollution.
 * 
 * @example
 * {
 *   "object": "contracts",
 *   "id": "cnt_123456",
 *   "select": ["name", "status", "amount"],
 *   "expand": ["owner", "account"]
 * }
 */
export const GetDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The unique record identifier (primary key).'),
  select: z.array(z.string()).optional().describe('Fields to include in the response (allowlisted query param).'),
  expand: z.array(z.string()).optional().describe(
    'Lookup/master_detail field names to expand. '
    + 'The engine resolves these via batch $in queries, replacing foreign key IDs with full objects.'
  ),
}));

/**
 * Get Data Response
 */
export const GetDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The record ID.'),
  record: z.record(z.string(), z.unknown()).describe('The complete record data.'),
}));

/**
 * Create Data Request
 * Creation of a new record.
 * 
 * @example
 * {
 *   "object": "leads",
 *   "data": {
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "company": "Acme Inc"
 *   }
 * }
 */
export const CreateDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  data: z.record(z.string(), z.unknown()).describe('The dictionary of field values to insert.'),
}));

/**
 * Create Data Response
 */
export const CreateDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The ID of the newly created record.'),
  record: z.record(z.string(), z.unknown()).describe('The created record, including server-generated fields (created_at, owner).'),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability (#3407/#3431): caller-supplied fields that were LEGALLY stripped ' +
    'before the record was written — a non-system create cannot seed a static `readonly` ' +
    'column (#3043 ingress strip), so those keys are dropped and the field re-derives its ' +
    'default. Present ONLY when ≥1 field was dropped; the create still succeeded without ' +
    'them (status/success semantics unchanged). REST additionally surfaces this as the ' +
    '`X-ObjectStack-Dropped-Fields` response header. Optional — omit-when-empty keeps the ' +
    'shape backward-compatible for existing clients.'
  ),
}));

/**
 * Update Data Request
 * Modification of an existing record.
 * 
 * @example
 * {
 *   "object": "tasks",
 *   "id": "tsk_001",
 *   "data": {
 *     "status": "completed",
 *     "percent_complete": 100
 *   }
 * }
 */
export const UpdateDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('The object name.'),
  id: z.string().describe('The ID of the record to update.'),
  data: z.record(z.string(), z.unknown()).describe('The fields to update (partial update).'),
  expectedVersion: z.string().optional().describe(
    'Optimistic concurrency token (typically the `updated_at` value the client read). ' +
    'When provided, the server compares it against the current record version and ' +
    'returns 409 CONCURRENT_UPDATE if they differ. Optional — omit to skip the check.'
  ),
}));

/**
 * Update Data Response
 */
export const UpdateDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  id: z.string().describe('Updated record ID'),
  record: z.record(z.string(), z.unknown()).describe('Updated record'),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability (#3407/#3431): caller-supplied fields the engine LEGALLY stripped ' +
    'from the write before persisting — static `readonly` (#2948) or a TRUE `readonlyWhen` ' +
    'predicate (#3042). Present ONLY when ≥1 field was dropped; the update still succeeded ' +
    'without them (status/success semantics unchanged — stripping is legitimate, not an ' +
    'error). REST additionally surfaces this as the `X-ObjectStack-Dropped-Fields` response ' +
    'header. Optional — omit-when-empty keeps the shape backward-compatible for existing ' +
    'clients that only read `record`.'
  ),
}));

/**
 * Delete Data Request
 */
export const DeleteDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  id: z.string().describe('Record ID to delete'),
  expectedVersion: z.string().optional().describe(
    'Optimistic concurrency token (typically the `updated_at` value the client read). ' +
    'When provided, the server compares it against the current record version and ' +
    'returns 409 CONCURRENT_UPDATE if they differ. Optional — omit to skip the check.'
  ),
}));

/**
 * Delete Data Response
 */
export const DeleteDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  id: z.string().describe('Deleted record ID'),
  success: z.boolean().describe('Whether deletion succeeded'),
}));

// ==========================================
// Batch Operations
// ==========================================

/**
 * Batch Data Request
 */
export const BatchDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  request: BatchUpdateRequestSchema.describe('Batch operation request'),
}));

/**
 * Batch Data Response
 * Uses BatchUpdateResponse from batch.zod.ts
 */
export const BatchDataResponseSchema = lazySchema(() => BatchUpdateResponseSchema);

/**
 * Create Many Data Request
 */
export const CreateManyDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  records: z.array(z.record(z.string(), z.unknown())).describe('Array of records to create'),
}));

/**
 * Create Many Data Response
 */
export const CreateManyDataResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  records: z.array(z.record(z.string(), z.unknown())).describe('Created records'),
  count: z.number().describe('Number of records created'),
  droppedFields: z.array(DroppedFieldsEventSchema).optional().describe(
    'Write-observability (#3407/#3431/#3455): caller-supplied `readonly` fields the #3043 ' +
    'create-ingress strip removed before the rows were written. AGGREGATED across the batch ' +
    '(one event per object/reason with the union of dropped field names) rather than per-row, ' +
    'because the insert-time strip is static-`readonly` only — schema-uniform, so every row ' +
    'drops the same set. Present ONLY when ≥1 field was dropped; the creates still succeeded ' +
    'without them (count/success unchanged). Optional — omit-when-empty keeps the shape ' +
    'backward-compatible. (The per-row `insertMany`/`batch` paths carry per-row `droppedFields` ' +
    'on each result instead — see BatchOperationResultSchema.)'
  ),
}));

/**
 * Update Many Data Request
 *
 * [#3939] The wire body IS {@link UpdateManyRequestSchema} — one Zod source per
 * contract (Prime Directive #7). This adds only `object`, which the REST route
 * takes from the URL path and never from the body (#3933). The two used to be
 * hand-maintained copies that had already drifted apart: the batch.zod one
 * accepted `{}` rows, this one required `id` + `data`, and only this one was
 * ever enforced.
 */
export const UpdateManyDataRequestSchema = lazySchema(() => UpdateManyRequestSchema.extend({
  object: z.string().describe('Object name'),
}));

/**
 * Update Many Data Response
 * Uses BatchUpdateResponse for consistency
 */
export const UpdateManyDataResponseSchema = lazySchema(() => BatchUpdateResponseSchema);

/**
 * Delete Many Data Request
 *
 * [#3939] The wire body IS {@link DeleteManyRequestSchema}; this adds only the
 * `object` the REST route takes from the URL path (#3933). See
 * {@link UpdateManyDataRequestSchema} for why the copies were merged.
 */
export const DeleteManyDataRequestSchema = lazySchema(() => DeleteManyRequestSchema.extend({
  object: z.string().describe('Object name'),
}));

/**
 * Delete Many Data Response
 */
export const DeleteManyDataResponseSchema = lazySchema(() => BatchUpdateResponseSchema);

// ==========================================
// Package Management Operations
// ==========================================

/**
 * Re-export Package Management Request/Response schemas from kernel.
 * These define the contract for package lifecycle management:
 * - List installed packages (with filters)
 * - Get a specific package by ID
 * - Install a new package (from manifest)
 * - Uninstall a package
 * - Enable/Disable a package
 * 
 * Key distinction: Package (ManifestSchema) is the unit of installation.
 * An App (AppSchema) is a UI navigation entity within a package.
 * A package may contain 0, 1, or many apps.
 */
export {
  ListPackagesRequestSchema,
  ListPackagesResponseSchema,
  GetPackageRequestSchema,
  GetPackageResponseSchema,
  InstallPackageRequestSchema,
  InstallPackageResponseSchema,
  UninstallPackageRequestSchema,
  UninstallPackageResponseSchema,
  EnablePackageRequestSchema,
  EnablePackageResponseSchema,
  DisablePackageRequestSchema,
  DisablePackageResponseSchema,
};

// ==========================================
// View Management Operations
// ==========================================

export const ListViewsRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name (snake_case)'),
  type: z.enum(['list', 'form']).optional().describe('Filter by view type'),
}));

export const ListViewsResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  views: z.array(ViewSchema).describe('Array of view definitions'),
}));

export const GetViewRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name (snake_case)'),
  viewId: z.string().describe('View identifier'),
}));

export const GetViewResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  view: ViewSchema.describe('View definition'),
}));

export const CreateViewRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name (snake_case)'),
  data: ViewSchema.describe('View definition to create'),
}));

export const CreateViewResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  viewId: z.string().describe('Created view identifier'),
  view: ViewSchema.describe('Created view definition'),
}));

export const UpdateViewRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name (snake_case)'),
  viewId: z.string().describe('View identifier'),
  data: ViewSchema.partial().describe('Partial view data to update'),
}));

export const UpdateViewResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  viewId: z.string().describe('Updated view identifier'),
  view: ViewSchema.describe('Updated view definition'),
}));

export const DeleteViewRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name (snake_case)'),
  viewId: z.string().describe('View identifier to delete'),
}));

export const DeleteViewResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  viewId: z.string().describe('Deleted view identifier'),
  success: z.boolean().describe('Whether deletion succeeded'),
}));

// ==========================================
// Permission Operations
// ==========================================

export const CheckPermissionRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name to check permissions for'),
  action: z.enum(['create', 'read', 'edit', 'delete', 'transfer', 'restore', 'purge']).describe('Action to check'),
  recordId: z.string().optional().describe('Specific record ID (for record-level checks)'),
  field: z.string().optional().describe('Specific field name (for field-level checks)'),
}));

export const CheckPermissionResponseSchema = lazySchema(() => z.object({
  allowed: z.boolean().describe('Whether the action is permitted'),
  reason: z.string().optional().describe('Reason if denied'),
}));

export const GetObjectPermissionsRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name to get permissions for'),
}));

export const GetObjectPermissionsResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  permissions: ObjectPermissionSchema.describe('Object-level permissions'),
  fieldPermissions: z.record(z.string(), FieldPermissionSchema).optional().describe('Field-level permissions keyed by field name'),
}));

export const GetEffectivePermissionsRequestSchema = lazySchema(() => z.object({}));

export const GetEffectivePermissionsResponseSchema = lazySchema(() => z.object({
  // [#3391] The effective response carries the server-resolved API operation set
  // per object (`apiOperations`) — the single "effective" channel the frontend
  // consumes. Authoring `ObjectPermissionSchema` stays unextended.
  objects: z.record(z.string(), EffectiveObjectPermissionSchema).describe('Effective object permissions keyed by object name'),
  systemPermissions: z.array(z.string()).describe('Effective system-level permissions'),
}));

// ==========================================
// Workflow Operations — REMOVED (#4451, v17)
// ==========================================
// The Get/WorkflowState/Config/Transition schemas and the `WorkflowProtocol`
// interface were deleted: no code ever implemented any of the three methods,
// nothing ever registered the `workflow` service slot they notionally fronted
// (ADR-0115 Evidence 5 — "no code in this repository resolves either slot",
// verified across both repositories), and no HTTP surface ever mounted
// `/api/v1/workflow` (the pre-#3586 DEFAULT_DISPATCHER_ROUTES listed it among
// routes that never existed). The capability the wrappers promised is live
// elsewhere: record state machines are enforced by the `state_machine`
// validation rule (`StateMachineSchema` stays authorable on the object),
// approvals are first-class flow nodes on the approvals runtime (ADR-0019 —
// decisions via `POST /approvals/requests/:id/{approve,reject}`), and
// record-triggered automation is lifecycle hooks + `record_change` flows.

// ==========================================
// Realtime Operations
// ==========================================

export const RealtimeConnectRequestSchema = lazySchema(() => z.object({
  transport: TransportProtocol.optional().describe('Preferred transport protocol'),
  channels: z.array(z.string()).optional().describe('Channels to subscribe to on connect'),
  token: z.string().optional().describe('Authentication token'),
}));

export const RealtimeConnectResponseSchema = lazySchema(() => z.object({
  connectionId: z.string().describe('Unique connection identifier'),
  transport: TransportProtocol.describe('Negotiated transport protocol'),
  url: z.string().optional().describe('WebSocket/SSE endpoint URL'),
}));

export const RealtimeDisconnectRequestSchema = lazySchema(() => z.object({
  connectionId: z.string().optional().describe('Connection ID to disconnect'),
}));

export const RealtimeDisconnectResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether disconnection succeeded'),
}));

export const RealtimeSubscribeRequestSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel name to subscribe to'),
  events: z.array(z.string()).optional().describe('Specific event types to listen for'),
  filter: z.record(z.string(), z.unknown()).optional().describe('Event filter criteria'),
}));

export const RealtimeSubscribeResponseSchema = lazySchema(() => z.object({
  subscriptionId: z.string().describe('Unique subscription identifier'),
  channel: z.string().describe('Subscribed channel name'),
}));

export const RealtimeUnsubscribeRequestSchema = lazySchema(() => z.object({
  subscriptionId: z.string().describe('Subscription ID to cancel'),
}));

export const RealtimeUnsubscribeResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether unsubscription succeeded'),
}));

export const SetPresenceRequestSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel to set presence in'),
  state: RealtimePresenceSchema.describe('Presence state to set'),
}));

export const SetPresenceResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether presence was set'),
}));

export const GetPresenceRequestSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel to get presence for'),
}));

export const GetPresenceResponseSchema = lazySchema(() => z.object({
  channel: z.string().describe('Channel name'),
  members: z.array(RealtimePresenceSchema).describe('Active members and their presence state'),
}));

// ==========================================
// Notification Operations
// ==========================================

export const RegisterDeviceRequestSchema = lazySchema(() => z.object({
  token: z.string().describe('Device push notification token'),
  platform: z.enum(['ios', 'android', 'web']).describe('Device platform'),
  deviceId: z.string().optional().describe('Unique device identifier'),
  name: z.string().optional().describe('Device friendly name'),
}));

export const RegisterDeviceResponseSchema = lazySchema(() => z.object({
  deviceId: z.string().describe('Registered device ID'),
  success: z.boolean().describe('Whether registration succeeded'),
}));

export const UnregisterDeviceRequestSchema = lazySchema(() => z.object({
  deviceId: z.string().describe('Device ID to unregister'),
}));

export const UnregisterDeviceResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether unregistration succeeded'),
}));

export const NotificationPreferencesSchema = lazySchema(() => z.object({
  email: z.boolean().default(true).describe('Receive email notifications'),
  push: z.boolean().default(true).describe('Receive push notifications'),
  inApp: z.boolean().default(true).describe('Receive in-app notifications'),
  digest: z.enum(['none', 'daily', 'weekly']).default('none').describe('Email digest frequency'),
  channels: z.record(z.string(), z.object({
    enabled: z.boolean().default(true).describe('Whether this channel is enabled'),
    email: z.boolean().optional().describe('Override email setting'),
    push: z.boolean().optional().describe('Override push setting'),
  })).optional().describe('Per-channel notification preferences'),
}));

export const GetNotificationPreferencesRequestSchema = lazySchema(() => z.object({}));

export const GetNotificationPreferencesResponseSchema = lazySchema(() => z.object({
  preferences: NotificationPreferencesSchema.describe('Current notification preferences'),
}));

export const UpdateNotificationPreferencesRequestSchema = lazySchema(() => z.object({
  preferences: NotificationPreferencesSchema.partial().describe('Preferences to update'),
}));

export const UpdateNotificationPreferencesResponseSchema = lazySchema(() => z.object({
  preferences: NotificationPreferencesSchema.describe('Updated notification preferences'),
}));

export const NotificationSchema = lazySchema(() => z.object({
  id: z.string().describe('Notification ID'),
  type: z.string().describe('Notification type'),
  title: z.string().describe('Notification title'),
  body: z.string().describe('Notification body text'),
  read: z.boolean().default(false).describe('Whether notification has been read'),
  data: z.record(z.string(), z.unknown()).optional().describe('Additional notification data'),
  actionUrl: z.string().optional().describe('URL to navigate to when clicked'),
  createdAt: z.string().datetime().describe('When notification was created'),
}));

export const ListNotificationsRequestSchema = lazySchema(() => z.object({
  read: z.boolean().optional().describe('Filter by read status'),
  type: z.string().optional().describe('Filter by notification type'),
  limit: z.number().default(20).describe('Maximum number of notifications to return'),
  cursor: z.string().optional().describe('Pagination cursor'),
}));

export const ListNotificationsResponseSchema = lazySchema(() => z.object({
  notifications: z.array(NotificationSchema).describe('List of notifications'),
  unreadCount: z.number().describe('Total number of unread notifications'),
  cursor: z.string().optional().describe('Next page cursor'),
}));

export const MarkNotificationsReadRequestSchema = lazySchema(() => z.object({
  ids: z.array(z.string()).describe('Notification IDs to mark as read'),
}));

export const MarkNotificationsReadResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  readCount: z.number().describe('Number of notifications marked as read'),
}));

export const MarkAllNotificationsReadRequestSchema = lazySchema(() => z.object({}));

export const MarkAllNotificationsReadResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  readCount: z.number().describe('Number of notifications marked as read'),
}));

// ==========================================
// AI Operations
// ==========================================
//
// THESE ARE THE SHAPES OF THE ROUTES THAT EXIST (#3718).
//
// What used to live here — `AiNlq*`, `AiSuggest*`, `AiInsights*` — described
// `/api/v1/ai/{nlq,suggest,insights}`, three endpoints **no repo has ever
// mounted**. They were declared here, registered in `DEFAULT_AI_ROUTES` (a
// table with no runtime consumer), typed as optional protocol methods nothing
// implements, and called by `client.ai.*`. Every call 404ed for the whole life
// of the namespace; the SDK's AI surface and the real one were disjoint sets.
//
// The AI service itself is a Cloud/EE package (`service-ai`, in the `cloud`
// repo) — this repo's dispatcher only proxies `/api/v1/ai/**` to whatever
// `buildAIRoutes()` mounted, or 404s "AI service is not configured". So these
// schemas deliberately describe **the wire**, not a protocol this repo serves:
// they are the one shape `client.ai.*` and cloud's route handlers both read.
// The mounted table's reviewed dispositions live in `cloud`
// (`packages/service-ai/src/ai-route-ledger.ts`), which drives this SDK
// against the routes it really returns.

/**
 * One conversation message on the wire.
 *
 * Deliberately permissive about `content`: the AI routes accept a plain string
 * (legacy), a content-part array, and the Vercel AI SDK v6 `parts` form where
 * `content` may be absent entirely. `role` is the part the routes actually
 * validate, so it is the part constrained here — narrowing `content` further
 * would reject payloads the server accepts.
 */
export const AiMessageSchema = lazySchema(() => z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']).describe('Message role'),
  content: z.unknown().optional().describe('Message content: a string, or an array of content parts'),
  parts: z.array(z.unknown()).optional().describe('Vercel AI SDK v6 message parts (alternative to `content`)'),
}).passthrough()); // adapters carry extra per-message fields (id, createdAt, …)

/**
 * `POST /api/v1/ai/chat` — dual-mode. `stream: false` returns
 * {@link AiChatResponseSchema} as JSON; anything else streams the Vercel UI
 * Message Stream Protocol (SSE with JSON payloads).
 *
 * Flat `model`/`temperature`/`maxTokens` are the Vercel `useChat` shape and
 * take precedence over the same keys nested under `options`.
 */
export const AiChatRequestSchema = lazySchema(() => z.object({
  messages: z.array(AiMessageSchema).min(1).describe('Conversation messages (at least one)'),
  system: z.string().optional().describe('System prompt, prepended as a system message'),
  model: z.string().optional().describe('Model id override'),
  temperature: z.number().optional().describe('Sampling temperature'),
  maxTokens: z.number().int().positive().optional().describe('Maximum tokens to generate'),
  stream: z.boolean().optional().describe('false → JSON response; otherwise the UI Message Stream Protocol'),
  conversationId: z.string().optional().describe('Conversation to persist this turn into (auto-created when omitted)'),
  turnId: z.string().optional().describe('Stable per-turn idempotency key (ADR-0013 D1)'),
  options: z.record(z.string(), z.unknown()).optional().describe('Legacy nested request options'),
}));

/** JSON body of a non-streaming chat/completion turn — the `AIResult` shape. */
export const AiChatResponseSchema = lazySchema(() => z.object({
  content: z.string().describe('Generated text'),
  model: z.string().optional().describe('Model that produced it'),
  toolCalls: z.array(z.unknown()).optional().describe('Tool calls the model requested (Vercel `ToolCallPart`)'),
  usage: z.object({
    promptTokens: z.number().describe('Tokens consumed by the prompt'),
    completionTokens: z.number().describe('Tokens generated'),
    totalTokens: z.number().describe('prompt + completion'),
  }).optional().describe('Token usage'),
  conversationId: z.string().optional().describe('Conversation the turn was persisted into'),
}));

/** `POST /api/v1/ai/complete` — single-shot text completion. */
export const AiCompleteRequestSchema = lazySchema(() => z.object({
  prompt: z.string().describe('Prompt text'),
  options: z.record(z.string(), z.unknown()).optional().describe('Request options (model, temperature, maxTokens, …)'),
}));

/** `GET /api/v1/ai/models` — the environment's plan-filtered picker list (ADR-0028). */
export const AiModelsResponseSchema = lazySchema(() => z.object({
  /**
   * Objects when the service exposes the ADR-0028 allowlist; bare ids when it
   * falls back to the adapter's `listModels()`. Both shapes are live, so both
   * are declared rather than one being asserted and the other 404-by-parse.
   */
  models: z.array(z.union([
    z.string(),
    z.object({
      id: z.string().describe('Model id'),
      label: z.string().describe('Display label for the picker'),
      default: z.boolean().describe('Whether this is the environment default'),
    }),
  ])).describe('Models this environment offers'),
  defaultModel: z.string().optional().describe('Default model id, when the service reports one'),
}));

/** A persisted AI conversation, as the `/ai/conversations` routes return it. */
export const AiConversationSchema = lazySchema(() => z.object({
  id: z.string().describe('Conversation id'),
  title: z.string().optional().describe('Title / summary'),
  agentId: z.string().optional().describe('Agent this conversation is bound to'),
  userId: z.string().optional().describe('Owning user'),
  messages: z.array(AiMessageSchema).describe('Message history'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  updatedAt: z.string().describe('Last update timestamp (ISO 8601)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Conversation metadata'),
}));

/**
 * `POST /api/v1/ai/conversations`. `userId` is NOT accepted from the caller —
 * the route overwrites it with the authenticated actor.
 */
export const CreateAiConversationRequestSchema = lazySchema(() => z.object({
  title: z.string().optional().describe('Initial title'),
  agentId: z.string().optional().describe('Agent to bind the conversation to'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Conversation metadata'),
}));

/** `GET /api/v1/ai/conversations` query — scoped to the authenticated user. */
export const ListAiConversationsRequestSchema = lazySchema(() => z.object({
  agentId: z.string().optional().describe('Filter by agent'),
  limit: z.number().int().positive().optional().describe('Maximum conversations to return'),
  cursor: z.string().optional().describe('Pagination cursor'),
}));

export const ListAiConversationsResponseSchema = lazySchema(() => z.object({
  conversations: z.array(AiConversationSchema).describe('Matching conversations'),
}));

/**
 * One frame of a streaming chat response.
 *
 * `POST /api/v1/ai/chat` (streaming mode) speaks the Vercel **UI Message
 * Stream Protocol**: SSE lines carrying JSON objects that always have a
 * `type` — `start`, `text-start`, `text-delta`, `tool-input-available`,
 * `tool-output-available`, `error`, `finish-step`, `finish` — terminated by a
 * literal `data: [DONE]`. `POST /api/v1/ai/chat/stream` uses the same SSE
 * envelope for raw `TextStreamPart` events. Only `type` is guaranteed across
 * both, so only `type` is declared; the rest of each frame passes through.
 */
export const AiStreamChunkSchema = lazySchema(() => z.object({
  type: z.string().describe('Frame type (text-delta, tool-input-available, finish, error, …)'),
}).passthrough());

/** `PATCH /api/v1/ai/conversations/:id` — at least one field is required. */
export const UpdateAiConversationRequestSchema = lazySchema(() => z.object({
  title: z.string().optional().describe('New title'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('New metadata'),
}).refine((p) => p.title !== undefined || p.metadata !== undefined, {
  message: 'at least one of title or metadata is required',
}));

// ── Named agents ──────────────────────────────────────────────────────────
//
// `/ai/agents` and `/ai/agents/:agentName/chat` were mounted long before the
// SDK could express them: `objectui` hand-built both URLs in five places
// because there was nothing to call. Typed from what the routes RETURN, not
// from what a client might like them to (#3718).

/** What an agent can do, derived server-side from its surface. */
export const AiAgentCapabilitiesSchema = lazySchema(() => z.object({
  authoring: z.boolean().describe('Authors app metadata (objects/views/flows)'),
  canvas: z.boolean().describe('Drives the Live Canvas split view (ADR-0037)'),
  debug: z.boolean().describe('Exposes the build-doctor debug drawer'),
  resume: z.boolean().describe('Turns resume durable multi-step runs (ADR-0013)'),
}));

/** One row of the `GET /api/v1/ai/agents` catalog. */
export const AiAgentSummarySchema = lazySchema(() => z.object({
  name: z.string().describe('Agent name — the `:agentName` path segment'),
  label: z.string().describe('Display label'),
  role: z.string().describe('Agent role'),
  capabilities: AiAgentCapabilitiesSchema.describe('Capability set implied by the agent surface'),
}));

/**
 * `GET /api/v1/ai/agents` — the **`data` payload**, not the whole body.
 *
 * The body is the platform envelope (`BaseResponseSchema`), and this schema is
 * what travels under `data`: `{ success: true, data: { agents: [...] } }`. It
 * was declared as the whole body until #4053 converted the route, and moving it
 * under `data` was a RELOCATION — the payload is unchanged, exactly as
 * `SettingsNamespacePayload` moved in #3843, not a flatten to the bare array the
 * way #3983 reshaped `/share-links`.
 *
 * That distinction is load-bearing, which is why it is recorded on the
 * declaration rather than only at the two producers. `unwrapResponse` returns
 * `data`, so `client.ai.agents.list()` reads `.agents` off this object; flattening
 * to `data: [...]` would make that read `undefined` → an empty catalog, which
 * `useAiSurfaceEnabled` turns into "hide the entire AI surface" — the same thing a
 * seat-less caller and a Community-Edition deployment correctly see, with no
 * error, no 403 and no log to tell them apart. `ai-agents-envelope.test.ts` pins
 * both halves.
 *
 * ACCESS-AWARE: the route returns only agents the CALLER may chat with
 * (ADR-0049), so an empty list is a legitimate answer for a seat-less user —
 * not an error, and not something to retry.
 */
export const AiAgentsResponseSchema = lazySchema(() => z.object({
  agents: z.array(AiAgentSummarySchema).describe('Agents this caller may chat with'),
}));

/**
 * `POST /api/v1/ai/agents/:agentName/chat`.
 *
 * Same dual-mode `stream` flag as `/ai/chat`: absent or `true` streams Vercel
 * Data Stream frames, `false` returns the JSON reply. The client sets it per
 * method rather than leaving it to the caller, so `agents.chat` cannot
 * accidentally return a stream body.
 */
export const AiAgentChatRequestSchema = lazySchema(() => z.object({
  messages: z.array(AiMessageSchema).min(1).describe('Conversation messages (at least one)'),
  context: z.record(z.string(), z.unknown()).optional().describe('Agent context (app, object, record, …)'),
  options: z.record(z.string(), z.unknown()).optional().describe('Request options (model, temperature, …)'),
}));

// ── HITL pending actions ──────────────────────────────────────────────────
//
// The approval queue an embedding app has to render. `objectui` ships a whole
// approval UI on these four routes over hand-built URLs.

/** Lifecycle of a proposed action. Mirrors `PendingActionStatus` in contracts. */
export const AiPendingActionStatusSchema = lazySchema(() =>
  z.enum(['pending', 'approved', 'executed', 'failed', 'rejected']));

/**
 * One queued action, as the routes return it — the persisted row, snake_case
 * because that is the wire shape, not a style choice.
 */
export const AiPendingActionSchema = lazySchema(() => z.object({
  id: z.string().describe('Pending action id'),
  object_name: z.string().describe('Object the action targets'),
  action_name: z.string().describe('Action name'),
  tool_name: z.string().describe('Tool that would execute it'),
  tool_input: z.string().describe('Serialized tool input'),
  status: AiPendingActionStatusSchema.describe('Lifecycle status'),
  result: z.string().optional().describe('Serialized result, once executed'),
  error: z.string().optional().describe('Failure message, when status is failed'),
  rejection_reason: z.string().optional().describe('Reason given at rejection'),
  conversation_id: z.string().optional().describe('Conversation that proposed it'),
  message_id: z.string().optional().describe('Message that proposed it'),
  proposed_by: z.string().optional().describe('Actor that proposed it'),
  decided_by: z.string().optional().describe('Actor that approved or rejected it'),
  proposed_at: z.string().describe('Proposal timestamp (ISO 8601)'),
  decided_at: z.string().optional().describe('Decision timestamp (ISO 8601)'),
}));

/**
 * `GET /api/v1/ai/pending-actions` query.
 *
 * Only the three the ROUTE reads. `AIService.listPendingActions` also accepts
 * `objectName`, but the route never forwards it, so declaring it here would
 * type a filter that silently does nothing.
 */
export const ListAiPendingActionsRequestSchema = lazySchema(() => z.object({
  status: AiPendingActionStatusSchema.optional().describe('Filter by status'),
  conversationId: z.string().optional().describe('Filter by proposing conversation'),
  limit: z.number().int().positive().optional().describe('Max rows (server default 100)'),
}));

export const ListAiPendingActionsResponseSchema = lazySchema(() => z.object({
  items: z.array(AiPendingActionSchema).describe('Queued actions, newest first'),
  total: z.number().describe('Number of rows returned (not a total across pages)'),
}));

/**
 * `POST /api/v1/ai/pending-actions/:id/approve` — approve AND execute.
 *
 * `status: 'failed'` is a 200 with a reason, not an HTTP error: the approval
 * succeeded, the execution did not. A caller that only checks `res.ok` will
 * report a failed write as a success.
 */
export const ApproveAiPendingActionResponseSchema = lazySchema(() => z.object({
  status: z.enum(['executed', 'failed']).describe('Outcome of executing the approved action'),
  result: z.unknown().optional().describe('Tool result, when executed'),
  error: z.string().optional().describe('Failure reason, when failed'),
}));

/** `POST /api/v1/ai/pending-actions/:id/reject` — never executes anything. */
export const RejectAiPendingActionResponseSchema = lazySchema(() => z.object({
  status: z.literal('rejected').describe('Always "rejected"'),
  id: z.string().describe('The rejected action id'),
}));

// ==========================================
// i18n Operations
// ==========================================

export const GetLocalesRequestSchema = lazySchema(() => z.object({}));

export const GetLocalesResponseSchema = lazySchema(() => z.object({
  locales: z.array(z.object({
    code: z.string().describe('BCP-47 locale code (e.g., en-US, zh-CN)'),
    label: z.string().describe('Display name of the locale'),
    isDefault: z.boolean().default(false).describe('Whether this is the default locale'),
  })).describe('Available locales'),
}));

/**
 * `locale` is the whole request — the endpoint returns that locale's full
 * bundle, and there is no server-side filter to ask for.
 *
 * This once declared `namespace` and `keys` filters. Neither serving surface
 * ever read them: the dispatcher domain body takes `parts[1]`/`query.locale`
 * and service-i18n takes `req.params.locale`, so both returned the whole
 * bundle while the SDK dutifully put both on the query string. A caller who
 * passed `keys` to shrink the payload shrank nothing and was told nothing —
 * Prime Directive #10's declared ≠ enforced, the shape #1475 trimmed out of
 * the validation-rule types. Removed rather than implemented (#3676): no
 * caller in this repo or objectui passed either one, `II18nService`
 * (`contracts/i18n-service.ts`) takes only `locale` so a filter could only be
 * a post-filter on an already-materialized bundle — which is precisely not
 * the server-side work `keys` reads as saving — and against the nested
 * `TranslationData` shape #3778 settled on, a flat `keys: string[]` has no
 * defined meaning at all. Re-adding an optional filter is additive and
 * non-breaking the day a consumer actually needs one; a declared-but-unread
 * field is the exemplar the next author copies.
 */
export const GetTranslationsRequestSchema = lazySchema(() => z.object({
  locale: z.string().describe('BCP-47 locale code'),
}));

export const GetTranslationsResponseSchema = lazySchema(() => z.object({
  locale: z.string().describe('Locale code'),
  translations: TranslationDataSchema.describe('Translation data'),
}));

export const GetFieldLabelsRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  locale: z.string().describe('BCP-47 locale code'),
}));

export const GetFieldLabelsResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  locale: z.string().describe('Locale code'),
  labels: z.record(z.string(), z.object({
    label: z.string().describe('Translated field label'),
    help: z.string().optional().describe('Translated help text'),
    options: z.record(z.string(), z.string()).optional().describe('Translated option labels'),
  })).describe('Field labels keyed by field name'),
}));

// ==========================================
// Protocol Interface Schema
// ==========================================


/**
 * TypeScript Types
 * Derived from Zod schemas using z.infer
 */
export type GetDiscoveryRequest = z.infer<typeof GetDiscoveryRequestSchema>;
export type GetDiscoveryResponse = z.infer<typeof GetDiscoveryResponseSchema>;
export type GetMetaTypesRequest = z.infer<typeof GetMetaTypesRequestSchema>;
export type GetMetaTypesResponse = z.infer<typeof GetMetaTypesResponseSchema>;
export type GetMetaItemsRequest = z.infer<typeof GetMetaItemsRequestSchema>;
export type GetMetaItemsResponse = z.infer<typeof GetMetaItemsResponseSchema>;
export type GetMetaItemRequest = z.infer<typeof GetMetaItemRequestSchema>;
export type GetMetaItemResponse = z.infer<typeof GetMetaItemResponseSchema>;
export type SaveMetaItemRequest = z.infer<typeof SaveMetaItemRequestSchema>;
export type SaveMetaItemResponse = z.infer<typeof SaveMetaItemResponseSchema>;
export type DeleteMetaItemRequest = z.infer<typeof DeleteMetaItemRequestSchema>;
export type DeleteMetaItemResponse = z.infer<typeof DeleteMetaItemResponseSchema>;
export type GetMetaItemCachedRequest = z.infer<typeof GetMetaItemCachedRequestSchema>;
export type GetMetaItemCachedResponse = z.infer<typeof GetMetaItemCachedResponseSchema>;
/** Post-parse shape of {@link GetMetaItemCachedResponse} — defaults applied, transforms run (ADR-0122). */
export type GetMetaItemCachedResponseParsed = z.infer<typeof GetMetaItemCachedResponseSchema>;
export type GetUiViewRequest = z.infer<typeof GetUiViewRequestSchema>;
export type GetUiViewResponse = z.infer<typeof GetUiViewResponseSchema>;
/** Post-parse shape of {@link GetUiViewResponse} — defaults applied, transforms run (ADR-0122). */
export type GetUiViewResponseParsed = z.infer<typeof GetUiViewResponseSchema>;

type AnalyticsQueryRequest = z.infer<typeof AnalyticsQueryRequestSchema>;
type AnalyticsResultResponse = z.infer<typeof AnalyticsResultResponseSchema>;
type GetAnalyticsMetaRequest = z.infer<typeof GetAnalyticsMetaRequestSchema>;
type GetAnalyticsMetaResponse = z.infer<typeof AnalyticsMetadataResponseSchema>;

export type AutomationTriggerRequest = z.infer<typeof AutomationTriggerRequestSchema>;
export type AutomationTriggerResponse = z.infer<typeof AutomationTriggerResponseSchema>;
export type AutomationActionsResponse = z.infer<typeof AutomationActionsResponseSchema>;
/** Post-parse shape of {@link AutomationActionsResponse} — defaults applied, transforms run (ADR-0122). */
export type AutomationActionsResponseParsed = z.infer<typeof AutomationActionsResponseSchema>;

export type FindDataRequest = z.input<typeof FindDataRequestSchema>;
export type FindDataResponse = z.infer<typeof FindDataResponseSchema>;
export type GetDataRequest = z.input<typeof GetDataRequestSchema>;
export type GetDataResponse = z.infer<typeof GetDataResponseSchema>;
export type CreateDataRequest = z.input<typeof CreateDataRequestSchema>;
export type CreateDataResponse = z.infer<typeof CreateDataResponseSchema>;
export type UpdateDataRequest = z.input<typeof UpdateDataRequestSchema>;
export type UpdateDataResponse = z.infer<typeof UpdateDataResponseSchema>;
export type DeleteDataRequest = z.input<typeof DeleteDataRequestSchema>;
export type DeleteDataResponse = z.infer<typeof DeleteDataResponseSchema>;

export type BatchDataRequest = z.input<typeof BatchDataRequestSchema>;
export type BatchDataResponse = z.infer<typeof BatchDataResponseSchema>;
/** Post-parse shape of {@link BatchDataResponse} — defaults applied, transforms run (ADR-0122). */
export type BatchDataResponseParsed = z.infer<typeof BatchDataResponseSchema>;
export type CreateManyDataRequest = z.input<typeof CreateManyDataRequestSchema>;
export type CreateManyDataResponse = z.infer<typeof CreateManyDataResponseSchema>;
export type UpdateManyDataRequest = z.input<typeof UpdateManyDataRequestSchema>;
export type UpdateManyDataResponse = z.infer<typeof UpdateManyDataResponseSchema>;
/** Post-parse shape of {@link UpdateManyDataResponse} — defaults applied, transforms run (ADR-0122). */
export type UpdateManyDataResponseParsed = z.infer<typeof UpdateManyDataResponseSchema>;
export type DeleteManyDataRequest = z.input<typeof DeleteManyDataRequestSchema>;
export type DeleteManyDataResponse = z.infer<typeof DeleteManyDataResponseSchema>;
/** Post-parse shape of {@link DeleteManyDataResponse} — defaults applied, transforms run (ADR-0122). */
export type DeleteManyDataResponseParsed = z.infer<typeof DeleteManyDataResponseSchema>;

// View Management Types
export type ListViewsRequest = z.input<typeof ListViewsRequestSchema>;
export type ListViewsResponse = z.infer<typeof ListViewsResponseSchema>;
/** Post-parse shape of {@link ListViewsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListViewsResponseParsed = z.infer<typeof ListViewsResponseSchema>;
export type GetViewRequest = z.input<typeof GetViewRequestSchema>;
export type GetViewResponse = z.infer<typeof GetViewResponseSchema>;
/** Post-parse shape of {@link GetViewResponse} — defaults applied, transforms run (ADR-0122). */
export type GetViewResponseParsed = z.infer<typeof GetViewResponseSchema>;
export type CreateViewRequest = z.input<typeof CreateViewRequestSchema>;
export type CreateViewResponse = z.infer<typeof CreateViewResponseSchema>;
/** Post-parse shape of {@link CreateViewResponse} — defaults applied, transforms run (ADR-0122). */
export type CreateViewResponseParsed = z.infer<typeof CreateViewResponseSchema>;
export type UpdateViewRequest = z.input<typeof UpdateViewRequestSchema>;
export type UpdateViewResponse = z.infer<typeof UpdateViewResponseSchema>;
/** Post-parse shape of {@link UpdateViewResponse} — defaults applied, transforms run (ADR-0122). */
export type UpdateViewResponseParsed = z.infer<typeof UpdateViewResponseSchema>;
export type DeleteViewRequest = z.input<typeof DeleteViewRequestSchema>;
export type DeleteViewResponse = z.infer<typeof DeleteViewResponseSchema>;

// Permission Types
export type CheckPermissionRequest = z.input<typeof CheckPermissionRequestSchema>;
export type CheckPermissionResponse = z.infer<typeof CheckPermissionResponseSchema>;
export type GetObjectPermissionsRequest = z.input<typeof GetObjectPermissionsRequestSchema>;
export type GetObjectPermissionsResponse = z.infer<typeof GetObjectPermissionsResponseSchema>;
/** Post-parse shape of {@link GetObjectPermissionsResponse} — defaults applied, transforms run (ADR-0122). */
export type GetObjectPermissionsResponseParsed = z.infer<typeof GetObjectPermissionsResponseSchema>;
export type GetEffectivePermissionsRequest = z.input<typeof GetEffectivePermissionsRequestSchema>;
export type GetEffectivePermissionsResponse = z.infer<typeof GetEffectivePermissionsResponseSchema>;

// Workflow Types — removed with the schemas (#4451, v17); see the block comment
// at "Workflow Operations — REMOVED" above.

// Realtime Types
export type RealtimeConnectRequest = z.input<typeof RealtimeConnectRequestSchema>;
export type RealtimeConnectResponse = z.infer<typeof RealtimeConnectResponseSchema>;
export type RealtimeDisconnectRequest = z.input<typeof RealtimeDisconnectRequestSchema>;
export type RealtimeDisconnectResponse = z.infer<typeof RealtimeDisconnectResponseSchema>;
export type RealtimeSubscribeRequest = z.input<typeof RealtimeSubscribeRequestSchema>;
export type RealtimeSubscribeResponse = z.infer<typeof RealtimeSubscribeResponseSchema>;
export type RealtimeUnsubscribeRequest = z.input<typeof RealtimeUnsubscribeRequestSchema>;
export type RealtimeUnsubscribeResponse = z.infer<typeof RealtimeUnsubscribeResponseSchema>;
export type SetPresenceRequest = z.input<typeof SetPresenceRequestSchema>;
export type SetPresenceResponse = z.infer<typeof SetPresenceResponseSchema>;
export type GetPresenceRequest = z.input<typeof GetPresenceRequestSchema>;
export type GetPresenceResponse = z.infer<typeof GetPresenceResponseSchema>;

// Notification Types
export type RegisterDeviceRequest = z.input<typeof RegisterDeviceRequestSchema>;
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponseSchema>;
export type UnregisterDeviceRequest = z.input<typeof UnregisterDeviceRequestSchema>;
export type UnregisterDeviceResponse = z.infer<typeof UnregisterDeviceResponseSchema>;
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
/** Post-parse shape of {@link NotificationPreferences} — defaults applied, transforms run (ADR-0122). */
export type NotificationPreferencesParsed = z.infer<typeof NotificationPreferencesSchema>;
export type NotificationPreferencesInput = z.input<typeof NotificationPreferencesSchema>;
export type GetNotificationPreferencesRequest = z.input<typeof GetNotificationPreferencesRequestSchema>;
export type GetNotificationPreferencesResponse = z.infer<typeof GetNotificationPreferencesResponseSchema>;
/** Post-parse shape of {@link GetNotificationPreferencesResponse} — defaults applied, transforms run (ADR-0122). */
export type GetNotificationPreferencesResponseParsed = z.infer<typeof GetNotificationPreferencesResponseSchema>;
export type UpdateNotificationPreferencesRequest = z.input<typeof UpdateNotificationPreferencesRequestSchema>;
export type UpdateNotificationPreferencesResponse = z.infer<typeof UpdateNotificationPreferencesResponseSchema>;
/** Post-parse shape of {@link UpdateNotificationPreferencesResponse} — defaults applied, transforms run (ADR-0122). */
export type UpdateNotificationPreferencesResponseParsed = z.infer<typeof UpdateNotificationPreferencesResponseSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
/** Post-parse shape of {@link Notification} — defaults applied, transforms run (ADR-0122). */
export type NotificationParsed = z.infer<typeof NotificationSchema>;
export type NotificationInput = z.input<typeof NotificationSchema>;
export type ListNotificationsRequest = z.input<typeof ListNotificationsRequestSchema>;
export type ListNotificationsResponse = z.infer<typeof ListNotificationsResponseSchema>;
/** Post-parse shape of {@link ListNotificationsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListNotificationsResponseParsed = z.infer<typeof ListNotificationsResponseSchema>;
export type MarkNotificationsReadRequest = z.input<typeof MarkNotificationsReadRequestSchema>;
export type MarkNotificationsReadResponse = z.infer<typeof MarkNotificationsReadResponseSchema>;
export type MarkAllNotificationsReadRequest = z.input<typeof MarkAllNotificationsReadRequestSchema>;
export type MarkAllNotificationsReadResponse = z.infer<typeof MarkAllNotificationsReadResponseSchema>;

// AI Types
export type AiMessage = z.input<typeof AiMessageSchema>;
export type AiChatRequest = z.input<typeof AiChatRequestSchema>;
export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;
export type AiStreamChunk = z.infer<typeof AiStreamChunkSchema>;
export type AiCompleteRequest = z.input<typeof AiCompleteRequestSchema>;
export type AiModelsResponse = z.infer<typeof AiModelsResponseSchema>;
export type AiConversation = z.infer<typeof AiConversationSchema>;
export type CreateAiConversationRequest = z.input<typeof CreateAiConversationRequestSchema>;
export type ListAiConversationsRequest = z.input<typeof ListAiConversationsRequestSchema>;
export type ListAiConversationsResponse = z.infer<typeof ListAiConversationsResponseSchema>;
export type UpdateAiConversationRequest = z.input<typeof UpdateAiConversationRequestSchema>;
export type AiAgentCapabilities = z.infer<typeof AiAgentCapabilitiesSchema>;
export type AiAgentSummary = z.infer<typeof AiAgentSummarySchema>;
export type AiAgentsResponse = z.infer<typeof AiAgentsResponseSchema>;
export type AiAgentChatRequest = z.input<typeof AiAgentChatRequestSchema>;
export type AiPendingActionStatus = z.infer<typeof AiPendingActionStatusSchema>;
export type AiPendingAction = z.infer<typeof AiPendingActionSchema>;
export type ListAiPendingActionsRequest = z.input<typeof ListAiPendingActionsRequestSchema>;
export type ListAiPendingActionsResponse = z.infer<typeof ListAiPendingActionsResponseSchema>;
export type ApproveAiPendingActionResponse = z.infer<typeof ApproveAiPendingActionResponseSchema>;
export type RejectAiPendingActionResponse = z.infer<typeof RejectAiPendingActionResponseSchema>;

// i18n Types
export type GetLocalesRequest = z.input<typeof GetLocalesRequestSchema>;
export type GetLocalesResponse = z.infer<typeof GetLocalesResponseSchema>;
/** Post-parse shape of {@link GetLocalesResponse} — defaults applied, transforms run (ADR-0122). */
export type GetLocalesResponseParsed = z.infer<typeof GetLocalesResponseSchema>;
export type GetTranslationsRequest = z.input<typeof GetTranslationsRequestSchema>;
export type GetTranslationsResponse = z.infer<typeof GetTranslationsResponseSchema>;
export type GetFieldLabelsRequest = z.input<typeof GetFieldLabelsRequestSchema>;
export type GetFieldLabelsResponse = z.infer<typeof GetFieldLabelsResponseSchema>;

// Package Management Types (re-exported from kernel for convenience)
export type { 
  ListPackagesRequest,
  ListPackagesResponse,
  GetPackageRequest,
  GetPackageResponse,
  InstallPackageRequest,
  InstallPackageResponse,
  UninstallPackageRequest,
  UninstallPackageResponse,
  EnablePackageRequest,
  EnablePackageResponse,
  DisablePackageRequest,
  DisablePackageResponse,
  InstalledPackage,
  PackageStatus,
};

/**
 * Zod-inferred protocol type (for runtime validation only).
 * Depend on the narrowest per-domain contract (e.g. `DataProtocol`).
 */

/**
 * ObjectStack Protocol Interface
 * 
 * Properly typed interface for implementing the ObjectStack API protocol.
 * Per-domain Zod schemas are used for runtime validation,
 * while this interface provides compile-time type safety for implementations.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Protocol contracts, segmented per domain (ADR-0076 D9).
//
// The historical `ObjectStackProtocol` union of these per-domain contracts was
// and is shape-identical to the historical flat interface — a back-compat alias.
// New code should depend on the narrowest slice it needs (e.g. `DataProtocol`).
// Per ADR-0076 D9 (rev.7) the union is transitional; the end-state dissolves it
// in favour of independent domain protocols + the discovery `services` registry.
// ─────────────────────────────────────────────────────────────────────────────

/** Business-data CRUD + batch operations (thin wire-normalizers over the engine). */
export interface DataProtocol {
  // Data Operations (core)
  findData(request: FindDataRequest): Promise<FindDataResponse>;
  getData(request: GetDataRequest): Promise<GetDataResponse>;
  createData(request: CreateDataRequest): Promise<CreateDataResponse>;
  updateData(request: UpdateDataRequest): Promise<UpdateDataResponse>;
  deleteData(request: DeleteDataRequest): Promise<DeleteDataResponse>;

  // Batch Operations (optional)
  batchData?(request: BatchDataRequest): Promise<BatchDataResponse>;
  createManyData?(request: CreateManyDataRequest): Promise<CreateManyDataResponse>;
  updateManyData?(request: UpdateManyDataRequest): Promise<UpdateManyDataResponse>;
  deleteManyData?(request: DeleteManyDataRequest): Promise<DeleteManyDataResponse>;
}

/** Discovery + metadata (sys_metadata) management. */
export interface MetadataProtocol {
  // Discovery & Metadata (core)
  getDiscovery(request?: GetDiscoveryRequest): Promise<GetDiscoveryResponse>;
  getMetaTypes(request?: GetMetaTypesRequest): Promise<GetMetaTypesResponse>;
  getMetaItems(request: GetMetaItemsRequest): Promise<GetMetaItemsResponse>;
  getMetaItem(request: GetMetaItemRequest): Promise<GetMetaItemResponse>;
  saveMetaItem(request: SaveMetaItemRequest): Promise<SaveMetaItemResponse>;
  /**
   * Delete a metadata customization overlay row. Per ADR-0005 this is the
   * "reset to artifact factory default" semantic — it removes a sys_metadata
   * row (if present) so subsequent reads fall through to the compiled
   * artifact. Whitelisted to view + dashboard in project-kernel mode.
   */
  deleteMetaItem?(request: DeleteMetaItemRequest): Promise<DeleteMetaItemResponse>;
  getMetaItemCached?(request: GetMetaItemCachedRequest): Promise<GetMetaItemCachedResponse>;
  getUiView?(request: GetUiViewRequest): Promise<GetUiViewResponse>;
}

/** Analytics (optional). */
export interface AnalyticsProtocol {
  analyticsQuery?(request: AnalyticsQueryRequest): Promise<AnalyticsResultResponse>;
  getAnalyticsMeta?(request: GetAnalyticsMetaRequest): Promise<GetAnalyticsMetaResponse>;
}

/** Automation (optional). */
export interface AutomationProtocol {
  triggerAutomation?(request: AutomationTriggerRequest): Promise<AutomationTriggerResponse>;
}

/** Package lifecycle (optional). */
export interface PackageProtocol {
  listPackages?(request: ListPackagesRequest): Promise<ListPackagesResponse>;
  getPackage?(request: GetPackageRequest): Promise<GetPackageResponse>;
  installPackage?(request: InstallPackageRequest): Promise<InstallPackageResponse>;
  uninstallPackage?(request: UninstallPackageRequest): Promise<UninstallPackageResponse>;
  enablePackage?(request: EnablePackageRequest): Promise<EnablePackageResponse>;
  disablePackage?(request: DisablePackageRequest): Promise<DisablePackageResponse>;
}

/** View management (optional). */
export interface ViewProtocol {
  listViews?(request: ListViewsRequest): Promise<ListViewsResponse>;
  getView?(request: GetViewRequest): Promise<GetViewResponse>;
  createView?(request: CreateViewRequest): Promise<CreateViewResponse>;
  updateView?(request: UpdateViewRequest): Promise<UpdateViewResponse>;
  deleteView?(request: DeleteViewRequest): Promise<DeleteViewResponse>;
}

/** Permissions (optional). */
export interface PermissionProtocol {
  checkPermission?(request: CheckPermissionRequest): Promise<CheckPermissionResponse>;
  getObjectPermissions?(request: GetObjectPermissionsRequest): Promise<GetObjectPermissionsResponse>;
  getEffectivePermissions?(request: GetEffectivePermissionsRequest): Promise<GetEffectivePermissionsResponse>;
}

// `WorkflowProtocol` (optional sub-protocol) was removed here (#4451, v17):
// no implementation of any of its three methods ever existed. See the
// "Workflow Operations — REMOVED" block comment above.

/** Realtime / presence (optional). */
export interface RealtimeProtocol {
  realtimeConnect?(request: RealtimeConnectRequest): Promise<RealtimeConnectResponse>;
  realtimeDisconnect?(request: RealtimeDisconnectRequest): Promise<RealtimeDisconnectResponse>;
  realtimeSubscribe?(request: RealtimeSubscribeRequest): Promise<RealtimeSubscribeResponse>;
  realtimeUnsubscribe?(request: RealtimeUnsubscribeRequest): Promise<RealtimeUnsubscribeResponse>;
  setPresence?(request: SetPresenceRequest): Promise<SetPresenceResponse>;
  getPresence?(request: GetPresenceRequest): Promise<GetPresenceResponse>;
}

/** Notifications (optional). */
export interface NotificationProtocol {
  registerDevice?(request: RegisterDeviceRequest): Promise<RegisterDeviceResponse>;
  unregisterDevice?(request: UnregisterDeviceRequest): Promise<UnregisterDeviceResponse>;
  getNotificationPreferences?(request: GetNotificationPreferencesRequest): Promise<GetNotificationPreferencesResponse>;
  updateNotificationPreferences?(request: UpdateNotificationPreferencesRequest): Promise<UpdateNotificationPreferencesResponse>;
  listNotifications?(request: ListNotificationsRequest): Promise<ListNotificationsResponse>;
  markNotificationsRead?(request: MarkNotificationsReadRequest): Promise<MarkNotificationsReadResponse>;
  markAllNotificationsRead?(request: MarkAllNotificationsReadRequest): Promise<MarkAllNotificationsReadResponse>;
}

// `AiProtocol` is GONE (#3718).
//
// It declared exactly three optional methods — `aiNlq?` / `aiSuggest?` /
// `aiInsights?` — and no service in any repo implemented one. Nothing
// dispatched through it either: `/api/v1/ai/**` is proxied straight to the
// route handlers `service-ai` (Cloud/EE, in the `cloud` repo) builds, never
// through a protocol object. An interface whose every member is optional and
// unimplemented does not describe a server — it only makes one look declared.
//
// The real server-side contract for AI is `IAIService` +
// `IAIConversationService` in `@objectstack/spec/contracts` (`ai-service.ts`),
// which `service-ai` actually implements. The wire shapes those routes speak
// are the `Ai*` schemas above.

/** Localization (optional). */
export interface I18nProtocol {
  getLocales?(request: GetLocalesRequest): Promise<GetLocalesResponse>;
  getTranslations?(request: GetTranslationsRequest): Promise<GetTranslationsResponse>;
  getFieldLabels?(request: GetFieldLabelsRequest): Promise<GetFieldLabelsResponse>;
}

