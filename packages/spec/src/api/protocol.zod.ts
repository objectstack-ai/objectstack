// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ViewSchema } from '../ui/view.zod';
import { DiscoverySchema } from './discovery.zod';
import { BatchUpdateRequestSchema, BatchUpdateResponseSchema, BatchOptionsSchema } from './batch.zod';
import { MetadataCacheRequestSchema, MetadataCacheResponseSchema } from './http-cache.zod';
import { QuerySchema } from '../data/query.zod';
import { 
  AnalyticsQueryRequestSchema,  
  AnalyticsResultResponseSchema, 
  GetAnalyticsMetaRequestSchema, 
  AnalyticsMetadataResponseSchema 
} from './analytics.zod';
import { RealtimePresenceSchema, TransportProtocol } from './realtime.zod';
import { ObjectPermissionSchema, FieldPermissionSchema } from '../security/permission.zod';
import { StateMachineSchema } from '../automation/state-machine.zod';
import { ActionDescriptorSchema } from '../automation/node-executor.zod';
import { TranslationDataSchema } from '../system/translation.zod';
import type {
  GetFeedRequest,
  GetFeedResponse,
  CreateFeedItemRequest,
  CreateFeedItemResponse,
  UpdateFeedItemRequest,
  UpdateFeedItemResponse,
  DeleteFeedItemRequest,
  DeleteFeedItemResponse,
  AddReactionRequest,
  AddReactionResponse,
  RemoveReactionRequest,
  RemoveReactionResponse,
  PinFeedItemRequest,
  PinFeedItemResponse,
  UnpinFeedItemRequest,
  UnpinFeedItemResponse,
  StarFeedItemRequest,
  StarFeedItemResponse,
  UnstarFeedItemRequest,
  UnstarFeedItemResponse,
  SearchFeedRequest,
  SearchFeedResponse,
  GetChangelogRequest,
  GetChangelogResponse,
  SubscribeRequest,
  SubscribeResponse,
  FeedUnsubscribeRequest,
  UnsubscribeResponse,
} from './feed-api.zod';
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
 * @see DiscoverySchema in ./discovery.zod.ts — the canonical definition.
 */
export const GetDiscoveryResponseSchema = lazySchema(() => DiscoverySchema
  .partial()
  .required({ version: true })
  .extend({
    /** @deprecated Use `name` instead. Kept for backward compatibility. */
    apiName: z.string().optional().describe('API name (deprecated — use name)'),
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
    overrideSource: z.enum(['registry', 'env']).describe('Whether allowOrgOverride is set in the static registry or via OBJECTSTACK_METADATA_WRITABLE env var'),
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
 */
export const SaveMetaItemResponseSchema = lazySchema(() => z.object({
  success: z.boolean(),
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
  distinct: z.coerce.boolean().optional().describe('SELECT DISTINCT flag.'),
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
}));

/**
 * Update Many Data Request
 */
export const UpdateManyDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  records: z.array(z.object({
    id: z.string().describe('Record ID'),
    data: z.record(z.string(), z.unknown()).describe('Fields to update'),
  })).describe('Array of updates'),
  options: BatchOptionsSchema.optional().describe('Update options'),
}));

/**
 * Update Many Data Response
 * Uses BatchUpdateResponse for consistency
 */
export const UpdateManyDataResponseSchema = lazySchema(() => BatchUpdateResponseSchema);

/**
 * Delete Many Data Request
 */
export const DeleteManyDataRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  ids: z.array(z.string()).describe('Array of record IDs to delete'),
  options: BatchOptionsSchema.optional().describe('Delete options'),
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
  objects: z.record(z.string(), ObjectPermissionSchema).describe('Effective object permissions keyed by object name'),
  systemPermissions: z.array(z.string()).describe('Effective system-level permissions'),
}));

// ==========================================
// Workflow Operations
// ==========================================

export const GetWorkflowConfigRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name to get workflow config for'),
}));

export const GetWorkflowConfigResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  workflows: z.array(StateMachineSchema).describe('Active state-machine workflows for this object'),
}));

export const WorkflowStateSchema = lazySchema(() => z.object({
  currentState: z.string().describe('Current workflow state name'),
  availableTransitions: z.array(z.object({
    name: z.string().describe('Transition name'),
    targetState: z.string().describe('Target state after transition'),
    label: z.string().optional().describe('Display label'),
    requiresApproval: z.boolean().default(false).describe('Whether transition requires approval'),
  })).describe('Available transitions from current state'),
  history: z.array(z.object({
    fromState: z.string().describe('Previous state'),
    toState: z.string().describe('New state'),
    action: z.string().describe('Action that triggered the transition'),
    userId: z.string().describe('User who performed the action'),
    timestamp: z.string().datetime().describe('When the transition occurred'),
    comment: z.string().optional().describe('Optional comment'),
  })).optional().describe('State transition history'),
}));

export const GetWorkflowStateRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID to get workflow state for'),
}));

export const GetWorkflowStateResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID'),
  state: WorkflowStateSchema.describe('Current workflow state and available transitions'),
}));

export const WorkflowTransitionRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID'),
  transition: z.string().describe('Transition name to execute'),
  comment: z.string().optional().describe('Optional comment for the transition'),
  data: z.record(z.string(), z.unknown()).optional().describe('Additional data for the transition'),
}));

export const WorkflowTransitionResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID'),
  success: z.boolean().describe('Whether the transition succeeded'),
  state: WorkflowStateSchema.describe('New workflow state after transition'),
}));

export const WorkflowApproveRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID'),
  comment: z.string().optional().describe('Approval comment'),
  data: z.record(z.string(), z.unknown()).optional().describe('Additional data'),
}));

export const WorkflowApproveResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID'),
  success: z.boolean().describe('Whether the approval succeeded'),
  state: WorkflowStateSchema.describe('New workflow state after approval'),
}));

export const WorkflowRejectRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID'),
  reason: z.string().describe('Rejection reason'),
  comment: z.string().optional().describe('Additional comment'),
}));

export const WorkflowRejectResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name'),
  recordId: z.string().describe('Record ID'),
  success: z.boolean().describe('Whether the rejection succeeded'),
  state: WorkflowStateSchema.describe('New workflow state after rejection'),
}));

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

export const AiNlqRequestSchema = lazySchema(() => z.object({
  query: z.string().describe('Natural language query string'),
  object: z.string().optional().describe('Target object context'),
  conversationId: z.string().optional().describe('Conversation ID for multi-turn queries'),
}));

export const AiNlqResponseSchema = lazySchema(() => z.object({
  query: z.unknown().describe('Generated structured query (AST)'),
  explanation: z.string().optional().describe('Human-readable explanation of the query'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence score (0-1)'),
  suggestions: z.array(z.string()).optional().describe('Suggested follow-up queries'),
}));

// AiChatRequestSchema and AiChatResponseSchema have been removed.
// The AI chat wire protocol is now fully aligned with the Vercel AI SDK (`ai`).
// Frontend consumers should use `@ai-sdk/react/useChat` directly.
// See: https://ai-sdk.dev/docs

export const AiSuggestRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name for context'),
  field: z.string().optional().describe('Field to suggest values for'),
  recordId: z.string().optional().describe('Record ID for context'),
  partial: z.string().optional().describe('Partial input for completion'),
}));

export const AiSuggestResponseSchema = lazySchema(() => z.object({
  suggestions: z.array(z.object({
    value: z.unknown().describe('Suggested value'),
    label: z.string().describe('Display label'),
    confidence: z.number().min(0).max(1).optional().describe('Confidence score (0-1)'),
    reason: z.string().optional().describe('Reason for this suggestion'),
  })).describe('Suggested values'),
}));

export const AiInsightsRequestSchema = lazySchema(() => z.object({
  object: z.string().describe('Object name to analyze'),
  recordId: z.string().optional().describe('Specific record to analyze'),
  type: z.enum(['summary', 'trends', 'anomalies', 'recommendations']).optional().describe('Type of insight'),
}));

export const AiInsightsResponseSchema = lazySchema(() => z.object({
  insights: z.array(z.object({
    type: z.string().describe('Insight type'),
    title: z.string().describe('Insight title'),
    description: z.string().describe('Detailed description'),
    confidence: z.number().min(0).max(1).optional().describe('Confidence score (0-1)'),
    data: z.record(z.string(), z.unknown()).optional().describe('Supporting data'),
  })).describe('Generated insights'),
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

export const GetTranslationsRequestSchema = lazySchema(() => z.object({
  locale: z.string().describe('BCP-47 locale code'),
  namespace: z.string().optional().describe('Translation namespace (e.g., objects, apps, messages)'),
  keys: z.array(z.string()).optional().describe('Specific translation keys to fetch'),
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
 * ObjectStack Protocol Contract
 * 
 * This schema defines the complete API contract as a Zod schema.
 * Unlike the old TypeScript interface, this provides runtime validation
 * and can be used for:
 * - API Gateway validation
 * - RPC call validation
 * - Client SDK generation
 * - API documentation generation
 * 
 * Each method is defined with its request and response schemas.
 */
export const ObjectStackProtocolSchema = lazySchema(() => z.object({
  // Discovery & Metadata
  getDiscovery: z.function()
    .describe('Get API discovery information'),

  getMetaTypes: z.function()
    .describe('Get available metadata types'),

  getMetaItems: z.function()
    .describe('Get all items of a metadata type'),

  getMetaItem: z.function()
    .describe('Get a specific metadata item'),
  saveMetaItem: z.function()
    .describe('Save metadata item'),
  deleteMetaItem: z.function()
    .describe('Delete a customization overlay row (reset to artifact default — ADR-0005)'),
  getMetaItemCached: z.function()
    .describe('Get a metadata item with cache validation'),

  getUiView: z.function()
    .describe('Get UI view definition'),

  // Analytics Operations
  analyticsQuery: z.function()
    .describe('Execute analytics query'),

  getAnalyticsMeta: z.function()
    .describe('Get analytics metadata (cubes)'),

  // Automation Operations
  triggerAutomation: z.function()
    .describe('Trigger an automation flow or script'),

  // Package Management Operations
  listPackages: z.function()
    .describe('List installed packages with optional filters'),

  getPackage: z.function()
    .describe('Get a specific installed package by ID'),

  installPackage: z.function()
    .describe('Install a new package from manifest'),

  uninstallPackage: z.function()
    .describe('Uninstall a package by ID'),

  enablePackage: z.function()
    .describe('Enable a disabled package'),

  disablePackage: z.function()
    .describe('Disable an installed package'),

  // Data Operations
  findData: z.function()
    .describe('Find data records'),

  getData: z.function()
    .describe('Get single data record'),

  createData: z.function()
    .describe('Create a data record'),

  updateData: z.function()
    .describe('Update a data record'),

  deleteData: z.function()
    .describe('Delete a data record'),

  // Batch Operations
  batchData: z.function()
    .describe('Perform batch operations'),

  createManyData: z.function()
    .describe('Create multiple records'),

  updateManyData: z.function()
    .describe('Update multiple records'),

  deleteManyData: z.function()
    .describe('Delete multiple records'),

  // View Management Operations
  listViews: z.function()
    .describe('List views for an object'),
  getView: z.function()
    .describe('Get a specific view'),
  createView: z.function()
    .describe('Create a new view'),
  updateView: z.function()
    .describe('Update an existing view'),
  deleteView: z.function()
    .describe('Delete a view'),

  // Permission Operations
  checkPermission: z.function()
    .describe('Check if an action is permitted'),
  getObjectPermissions: z.function()
    .describe('Get permissions for an object'),
  getEffectivePermissions: z.function()
    .describe('Get effective permissions for current user'),

  // Workflow Operations
  getWorkflowConfig: z.function()
    .describe('Get workflow configuration for an object'),
  getWorkflowState: z.function()
    .describe('Get workflow state for a record'),
  workflowTransition: z.function()
    .describe('Execute a workflow state transition'),
  workflowApprove: z.function()
    .describe('Approve a workflow step'),
  workflowReject: z.function()
    .describe('Reject a workflow step'),

  // Realtime Operations
  realtimeConnect: z.function()
    .describe('Establish realtime connection'),
  realtimeDisconnect: z.function()
    .describe('Close realtime connection'),
  realtimeSubscribe: z.function()
    .describe('Subscribe to a realtime channel'),
  realtimeUnsubscribe: z.function()
    .describe('Unsubscribe from a realtime channel'),
  setPresence: z.function()
    .describe('Set user presence state'),
  getPresence: z.function()
    .describe('Get channel presence information'),

  // Notification Operations
  registerDevice: z.function()
    .describe('Register a device for push notifications'),
  unregisterDevice: z.function()
    .describe('Unregister a device'),
  getNotificationPreferences: z.function()
    .describe('Get notification preferences'),
  updateNotificationPreferences: z.function()
    .describe('Update notification preferences'),
  listNotifications: z.function()
    .describe('List notifications'),
  markNotificationsRead: z.function()
    .describe('Mark specific notifications as read'),
  markAllNotificationsRead: z.function()
    .describe('Mark all notifications as read'),

  // AI Operations
  aiNlq: z.function()
    .describe('Natural language query'),
  aiChat: z.function()
    .describe('AI chat interaction'),
  aiSuggest: z.function()
    .describe('Get AI-powered suggestions'),
  aiInsights: z.function()
    .describe('Get AI-generated insights'),

  // i18n Operations
  getLocales: z.function()
    .describe('Get available locales'),
  getTranslations: z.function()
    .describe('Get translations for a locale'),
  getFieldLabels: z.function()
    .describe('Get translated field labels for an object'),

  // Feed Operations
  listFeed: z.function()
    .describe('List feed items for a record'),
  createFeedItem: z.function()
    .describe('Create a new feed item'),
  updateFeedItem: z.function()
    .describe('Update an existing feed item'),
  deleteFeedItem: z.function()
    .describe('Delete a feed item'),
  addReaction: z.function()
    .describe('Add an emoji reaction to a feed item'),
  removeReaction: z.function()
    .describe('Remove an emoji reaction from a feed item'),
  pinFeedItem: z.function()
    .describe('Pin a feed item'),
  unpinFeedItem: z.function()
    .describe('Unpin a feed item'),
  starFeedItem: z.function()
    .describe('Star a feed item'),
  unstarFeedItem: z.function()
    .describe('Unstar a feed item'),
  searchFeed: z.function()
    .describe('Search feed items'),
  getChangelog: z.function()
    .describe('Get field-level changelog for a record'),
  feedSubscribe: z.function()
    .describe('Subscribe to record notifications'),
  feedUnsubscribe: z.function()
    .describe('Unsubscribe from record notifications'),
}));

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
export type GetUiViewRequest = z.infer<typeof GetUiViewRequestSchema>;
export type GetUiViewResponse = z.infer<typeof GetUiViewResponseSchema>;

type AnalyticsQueryRequest = z.infer<typeof AnalyticsQueryRequestSchema>;
type AnalyticsResultResponse = z.infer<typeof AnalyticsResultResponseSchema>;
type GetAnalyticsMetaRequest = z.infer<typeof GetAnalyticsMetaRequestSchema>;
type GetAnalyticsMetaResponse = z.infer<typeof AnalyticsMetadataResponseSchema>;

export type AutomationTriggerRequest = z.infer<typeof AutomationTriggerRequestSchema>;
export type AutomationTriggerResponse = z.infer<typeof AutomationTriggerResponseSchema>;
export type AutomationActionsResponse = z.infer<typeof AutomationActionsResponseSchema>;

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
export type CreateManyDataRequest = z.input<typeof CreateManyDataRequestSchema>;
export type CreateManyDataResponse = z.infer<typeof CreateManyDataResponseSchema>;
export type UpdateManyDataRequest = z.input<typeof UpdateManyDataRequestSchema>;
export type UpdateManyDataResponse = z.infer<typeof UpdateManyDataResponseSchema>;
export type DeleteManyDataRequest = z.input<typeof DeleteManyDataRequestSchema>;
export type DeleteManyDataResponse = z.infer<typeof DeleteManyDataResponseSchema>;

// View Management Types
export type ListViewsRequest = z.input<typeof ListViewsRequestSchema>;
export type ListViewsResponse = z.infer<typeof ListViewsResponseSchema>;
export type GetViewRequest = z.input<typeof GetViewRequestSchema>;
export type GetViewResponse = z.infer<typeof GetViewResponseSchema>;
export type CreateViewRequest = z.input<typeof CreateViewRequestSchema>;
export type CreateViewResponse = z.infer<typeof CreateViewResponseSchema>;
export type UpdateViewRequest = z.input<typeof UpdateViewRequestSchema>;
export type UpdateViewResponse = z.infer<typeof UpdateViewResponseSchema>;
export type DeleteViewRequest = z.input<typeof DeleteViewRequestSchema>;
export type DeleteViewResponse = z.infer<typeof DeleteViewResponseSchema>;

// Permission Types
export type CheckPermissionRequest = z.input<typeof CheckPermissionRequestSchema>;
export type CheckPermissionResponse = z.infer<typeof CheckPermissionResponseSchema>;
export type GetObjectPermissionsRequest = z.input<typeof GetObjectPermissionsRequestSchema>;
export type GetObjectPermissionsResponse = z.infer<typeof GetObjectPermissionsResponseSchema>;
export type GetEffectivePermissionsRequest = z.input<typeof GetEffectivePermissionsRequestSchema>;
export type GetEffectivePermissionsResponse = z.infer<typeof GetEffectivePermissionsResponseSchema>;

// Workflow Types
export type GetWorkflowConfigRequest = z.input<typeof GetWorkflowConfigRequestSchema>;
export type GetWorkflowConfigResponse = z.infer<typeof GetWorkflowConfigResponseSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type GetWorkflowStateRequest = z.input<typeof GetWorkflowStateRequestSchema>;
export type GetWorkflowStateResponse = z.infer<typeof GetWorkflowStateResponseSchema>;
export type WorkflowTransitionRequest = z.input<typeof WorkflowTransitionRequestSchema>;
export type WorkflowTransitionResponse = z.infer<typeof WorkflowTransitionResponseSchema>;
export type WorkflowApproveRequest = z.input<typeof WorkflowApproveRequestSchema>;
export type WorkflowApproveResponse = z.infer<typeof WorkflowApproveResponseSchema>;
export type WorkflowRejectRequest = z.input<typeof WorkflowRejectRequestSchema>;
export type WorkflowRejectResponse = z.infer<typeof WorkflowRejectResponseSchema>;

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
export type NotificationPreferencesInput = z.input<typeof NotificationPreferencesSchema>;
export type GetNotificationPreferencesRequest = z.input<typeof GetNotificationPreferencesRequestSchema>;
export type GetNotificationPreferencesResponse = z.infer<typeof GetNotificationPreferencesResponseSchema>;
export type UpdateNotificationPreferencesRequest = z.input<typeof UpdateNotificationPreferencesRequestSchema>;
export type UpdateNotificationPreferencesResponse = z.infer<typeof UpdateNotificationPreferencesResponseSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationInput = z.input<typeof NotificationSchema>;
export type ListNotificationsRequest = z.input<typeof ListNotificationsRequestSchema>;
export type ListNotificationsResponse = z.infer<typeof ListNotificationsResponseSchema>;
export type MarkNotificationsReadRequest = z.input<typeof MarkNotificationsReadRequestSchema>;
export type MarkNotificationsReadResponse = z.infer<typeof MarkNotificationsReadResponseSchema>;
export type MarkAllNotificationsReadRequest = z.input<typeof MarkAllNotificationsReadRequestSchema>;
export type MarkAllNotificationsReadResponse = z.infer<typeof MarkAllNotificationsReadResponseSchema>;

// AI Types
export type AiNlqRequest = z.input<typeof AiNlqRequestSchema>;
export type AiNlqResponse = z.infer<typeof AiNlqResponseSchema>;
export type AiSuggestRequest = z.input<typeof AiSuggestRequestSchema>;
export type AiSuggestResponse = z.infer<typeof AiSuggestResponseSchema>;
export type AiInsightsRequest = z.input<typeof AiInsightsRequestSchema>;
export type AiInsightsResponse = z.infer<typeof AiInsightsResponseSchema>;

// i18n Types
export type GetLocalesRequest = z.input<typeof GetLocalesRequestSchema>;
export type GetLocalesResponse = z.infer<typeof GetLocalesResponseSchema>;
export type GetTranslationsRequest = z.input<typeof GetTranslationsRequestSchema>;
export type GetTranslationsResponse = z.infer<typeof GetTranslationsResponseSchema>;
export type GetFieldLabelsRequest = z.input<typeof GetFieldLabelsRequestSchema>;
export type GetFieldLabelsResponse = z.infer<typeof GetFieldLabelsResponseSchema>;

// Feed Types (re-exported from feed-api.zod.ts for convenience)
export type {
  GetFeedRequest,
  GetFeedResponse,
  CreateFeedItemRequest,
  CreateFeedItemResponse,
  UpdateFeedItemRequest,
  UpdateFeedItemResponse,
  DeleteFeedItemRequest,
  DeleteFeedItemResponse,
  AddReactionRequest,
  AddReactionResponse,
  RemoveReactionRequest,
  RemoveReactionResponse,
  PinFeedItemRequest,
  PinFeedItemResponse,
  UnpinFeedItemRequest,
  UnpinFeedItemResponse,
  StarFeedItemRequest,
  StarFeedItemResponse,
  UnstarFeedItemRequest,
  UnstarFeedItemResponse,
  SearchFeedRequest,
  SearchFeedResponse,
  GetChangelogRequest,
  GetChangelogResponse,
  SubscribeRequest,
  SubscribeResponse,
  FeedUnsubscribeRequest,
  UnsubscribeResponse,
} from './feed-api.zod';

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
 * Use ObjectStackProtocol interface for implementation contracts.
 */
export type ObjectStackProtocolZod = z.infer<typeof ObjectStackProtocolSchema>;

/**
 * ObjectStack Protocol Interface
 * 
 * Properly typed interface for implementing the ObjectStack API protocol.
 * The Zod schema (ObjectStackProtocolSchema) is used for runtime validation,
 * while this interface provides compile-time type safety for implementations.
 */
export interface ObjectStackProtocol {
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
  
  // Analytics (optional)
  analyticsQuery?(request: AnalyticsQueryRequest): Promise<AnalyticsResultResponse>;
  getAnalyticsMeta?(request: GetAnalyticsMetaRequest): Promise<GetAnalyticsMetaResponse>;

  // Automation (optional)
  triggerAutomation?(request: AutomationTriggerRequest): Promise<AutomationTriggerResponse>;

  // Package Management (optional)
  listPackages?(request: ListPackagesRequest): Promise<ListPackagesResponse>;
  getPackage?(request: GetPackageRequest): Promise<GetPackageResponse>;
  installPackage?(request: InstallPackageRequest): Promise<InstallPackageResponse>;
  uninstallPackage?(request: UninstallPackageRequest): Promise<UninstallPackageResponse>;
  enablePackage?(request: EnablePackageRequest): Promise<EnablePackageResponse>;
  disablePackage?(request: DisablePackageRequest): Promise<DisablePackageResponse>;

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

  // View Management (optional)
  listViews?(request: ListViewsRequest): Promise<ListViewsResponse>;
  getView?(request: GetViewRequest): Promise<GetViewResponse>;
  createView?(request: CreateViewRequest): Promise<CreateViewResponse>;
  updateView?(request: UpdateViewRequest): Promise<UpdateViewResponse>;
  deleteView?(request: DeleteViewRequest): Promise<DeleteViewResponse>;

  // Permissions (optional)
  checkPermission?(request: CheckPermissionRequest): Promise<CheckPermissionResponse>;
  getObjectPermissions?(request: GetObjectPermissionsRequest): Promise<GetObjectPermissionsResponse>;
  getEffectivePermissions?(request: GetEffectivePermissionsRequest): Promise<GetEffectivePermissionsResponse>;

  // Workflows (optional)
  getWorkflowConfig?(request: GetWorkflowConfigRequest): Promise<GetWorkflowConfigResponse>;
  getWorkflowState?(request: GetWorkflowStateRequest): Promise<GetWorkflowStateResponse>;
  workflowTransition?(request: WorkflowTransitionRequest): Promise<WorkflowTransitionResponse>;
  workflowApprove?(request: WorkflowApproveRequest): Promise<WorkflowApproveResponse>;
  workflowReject?(request: WorkflowRejectRequest): Promise<WorkflowRejectResponse>;

  // Realtime (optional)
  realtimeConnect?(request: RealtimeConnectRequest): Promise<RealtimeConnectResponse>;
  realtimeDisconnect?(request: RealtimeDisconnectRequest): Promise<RealtimeDisconnectResponse>;
  realtimeSubscribe?(request: RealtimeSubscribeRequest): Promise<RealtimeSubscribeResponse>;
  realtimeUnsubscribe?(request: RealtimeUnsubscribeRequest): Promise<RealtimeUnsubscribeResponse>;
  setPresence?(request: SetPresenceRequest): Promise<SetPresenceResponse>;
  getPresence?(request: GetPresenceRequest): Promise<GetPresenceResponse>;

  // Notifications (optional)
  registerDevice?(request: RegisterDeviceRequest): Promise<RegisterDeviceResponse>;
  unregisterDevice?(request: UnregisterDeviceRequest): Promise<UnregisterDeviceResponse>;
  getNotificationPreferences?(request: GetNotificationPreferencesRequest): Promise<GetNotificationPreferencesResponse>;
  updateNotificationPreferences?(request: UpdateNotificationPreferencesRequest): Promise<UpdateNotificationPreferencesResponse>;
  listNotifications?(request: ListNotificationsRequest): Promise<ListNotificationsResponse>;
  markNotificationsRead?(request: MarkNotificationsReadRequest): Promise<MarkNotificationsReadResponse>;
  markAllNotificationsRead?(request: MarkAllNotificationsReadRequest): Promise<MarkAllNotificationsReadResponse>;

  // AI (optional — chat is now handled by Vercel AI SDK wire protocol)
  aiNlq?(request: AiNlqRequest): Promise<AiNlqResponse>;
  aiSuggest?(request: AiSuggestRequest): Promise<AiSuggestResponse>;
  aiInsights?(request: AiInsightsRequest): Promise<AiInsightsResponse>;

  // i18n (optional)
  getLocales?(request: GetLocalesRequest): Promise<GetLocalesResponse>;
  getTranslations?(request: GetTranslationsRequest): Promise<GetTranslationsResponse>;
  getFieldLabels?(request: GetFieldLabelsRequest): Promise<GetFieldLabelsResponse>;

  // Feed (optional)
  listFeed?(request: GetFeedRequest): Promise<GetFeedResponse>;
  createFeedItem?(request: CreateFeedItemRequest): Promise<CreateFeedItemResponse>;
  updateFeedItem?(request: UpdateFeedItemRequest): Promise<UpdateFeedItemResponse>;
  deleteFeedItem?(request: DeleteFeedItemRequest): Promise<DeleteFeedItemResponse>;
  addReaction?(request: AddReactionRequest): Promise<AddReactionResponse>;
  removeReaction?(request: RemoveReactionRequest): Promise<RemoveReactionResponse>;
  pinFeedItem?(request: PinFeedItemRequest): Promise<PinFeedItemResponse>;
  unpinFeedItem?(request: UnpinFeedItemRequest): Promise<UnpinFeedItemResponse>;
  starFeedItem?(request: StarFeedItemRequest): Promise<StarFeedItemResponse>;
  unstarFeedItem?(request: UnstarFeedItemRequest): Promise<UnstarFeedItemResponse>;
  searchFeed?(request: SearchFeedRequest): Promise<SearchFeedResponse>;
  getChangelog?(request: GetChangelogRequest): Promise<GetChangelogResponse>;
  feedSubscribe?(request: SubscribeRequest): Promise<SubscribeResponse>;
  feedUnsubscribe?(request: FeedUnsubscribeRequest): Promise<UnsubscribeResponse>;
}
