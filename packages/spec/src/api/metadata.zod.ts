// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { ObjectSchema } from '../data/object.zod';
import { AppSchema } from '../ui/app.zod';
import { MetadataTypeSchema, MetadataQuerySchema, MetadataQueryResultSchema, MetadataValidationResultSchema, MetadataBulkResultSchema, MetadataDependencySchema } from '../kernel/metadata-plugin.zod';
import { ActionSchema } from '../ui/action.zod';
import { MetadataOverlaySchema } from '../kernel/metadata-customization.zod';

/**
 * Metadata Service Protocol
 *
 * Defines the standard API contracts for the **@objectstack/metadata** package.
 * This is the single authority for ALL metadata-related services and APIs across
 * the entire platform, including Hono, Next.js, and NestJS adapters.
 *
 * ## Architecture
 * ```
 * ┌──────────────────────────────────────────────────────────────────┐
 * │              @objectstack/metadata — API Contracts              │
 * │                                                                  │
 * │  CRUD        │ Query/Search │ Bulk Ops  │ Overlay   │ Watch     │
 * │  Import/Export│ Validation   │ Type Reg  │ Deps      │           │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  Hono Adapter │ Next.js Adapter │ NestJS Adapter │ CLI         │
 * └──────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Alignment
 * - **Salesforce**: Metadata API (deploy, retrieve, describe)
 * - **ServiceNow**: System Dictionary + Metadata API
 * - **Kubernetes**: API Server + CRD Registry
 */

// ==========================================
// 1. Legacy Responses (existing)
// ==========================================

/**
 * Single Object Definition Response
 * Returns the full JSON schema for an Entity (Fields, Actions, Config).
 */
import { lazySchema } from '../shared/lazy-schema';
export const ObjectDefinitionResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: ObjectSchema.describe('Full Object Schema'),
}));

/**
 * App Definition Response
 * Returns the navigation, branding, and layout for an App.
 */
export const AppDefinitionResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: AppSchema.describe('Full App Configuration'),
}));

/**
 * All Concepts Response
 * Bulk load lightweight definitions for autocomplete/pickers.
 */
export const ConceptListResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(z.object({
    name: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    description: z.string().optional(),
  })).describe('List of available concepts (Objects, Apps, Flows)'),
}));

// ==========================================
// 2. CRUD Request / Response Schemas
// ==========================================

/**
 * Register (Create/Update) Metadata Request
 * POST /api/meta/:type
 * PUT  /api/meta/:type/:name
 */
export const MetadataRegisterRequestSchema = lazySchema(() => z.object({
  type: MetadataTypeSchema.describe('Metadata type'),
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Item name (snake_case)'),
  data: z.record(z.string(), z.unknown()).describe('Metadata payload'),
  namespace: z.string().optional().describe('Optional namespace'),
}));

/**
 * Single Metadata Item Response
 * GET /api/meta/:type/:name
 */
export const MetadataItemResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    type: z.string().describe('Metadata type'),
    name: z.string().describe('Item name'),
    definition: z.record(z.string(), z.unknown()).describe('Metadata definition payload'),
  }).describe('Metadata item'),
}));

/**
 * Metadata List Response
 * GET /api/meta/:type
 */
export const MetadataListResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(z.record(z.string(), z.unknown())).describe('Array of metadata definitions'),
}));

/**
 * Metadata Names Response
 * GET /api/meta/:type/names
 */
export const MetadataNamesResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(z.string()).describe('Array of metadata item names'),
}));

/**
 * Metadata Exists Response
 * GET /api/meta/:type/:name/exists
 */
export const MetadataExistsResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    exists: z.boolean().describe('Whether the item exists'),
  }),
}));

/**
 * Metadata Delete Response
 * DELETE /api/meta/:type/:name
 */
export const MetadataDeleteResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    type: z.string().describe('Metadata type'),
    name: z.string().describe('Deleted item name'),
  }),
}));

// ==========================================
// 3. Query / Search
// ==========================================

/**
 * Metadata Query Request
 * POST /api/meta/query
 */
export const MetadataQueryRequestSchema = lazySchema(() => MetadataQuerySchema.describe(
  'Metadata query with filtering, sorting, and pagination',
));

/**
 * Metadata Query Response
 * POST /api/meta/query
 */
export const MetadataQueryResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: MetadataQueryResultSchema.describe('Paginated query result'),
}));

// ==========================================
// 4. Bulk Operations
// ==========================================

/**
 * Bulk Register Request
 * POST /api/meta/bulk/register
 */
export const MetadataBulkRegisterRequestSchema = lazySchema(() => z.object({
  items: z.array(z.object({
    type: z.string().describe('Metadata type'),
    name: z.string().describe('Item name'),
    data: z.record(z.string(), z.unknown()).describe('Metadata payload'),
  })).min(1).describe('Items to register'),
  continueOnError: z.boolean().default(false).describe('Continue on individual failure'),
  validate: z.boolean().default(true).describe('Validate before registering'),
}));

/**
 * Bulk Unregister Request
 * POST /api/meta/bulk/unregister
 */
export const MetadataBulkUnregisterRequestSchema = lazySchema(() => z.object({
  items: z.array(z.object({
    type: z.string().describe('Metadata type'),
    name: z.string().describe('Item name'),
  })).min(1).describe('Items to unregister'),
}));

/**
 * Bulk Operation Response
 * POST /api/meta/bulk/*
 */
export const MetadataBulkResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: MetadataBulkResultSchema.describe('Bulk operation result'),
}));

// ==========================================
// 5. Overlay / Customization
// ==========================================

/**
 * Get Overlay Response
 * GET /api/meta/:type/:name/overlay
 */
export const MetadataOverlayResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: MetadataOverlaySchema.optional().describe('Overlay definition, undefined if none'),
}));

/**
 * Save Overlay Request
 * PUT /api/meta/:type/:name/overlay
 */
export const MetadataOverlaySaveRequestSchema = lazySchema(() => MetadataOverlaySchema.describe(
  'Overlay to save',
));

/**
 * Get Effective (merged) Response
 * GET /api/meta/:type/:name/effective
 */
export const MetadataEffectiveResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.record(z.string(), z.unknown()).optional()
    .describe('Effective metadata with all overlays applied'),
}));

// ==========================================
// 6. Import / Export
// ==========================================

/**
 * Export Metadata Request
 * POST /api/meta/export
 */
export const MetadataExportRequestSchema = lazySchema(() => z.object({
  types: z.array(z.string()).optional().describe('Filter by metadata types'),
  namespaces: z.array(z.string()).optional().describe('Filter by namespaces'),
  format: z.enum(['json', 'yaml']).default('json').describe('Export format'),
}));

/**
 * Export Metadata Response
 * POST /api/meta/export
 */
export const MetadataExportResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.unknown().describe('Exported metadata bundle'),
}));

/**
 * Import Metadata Request
 * POST /api/meta/import
 */
export const MetadataImportRequestSchema = lazySchema(() => z.object({
  data: z.unknown().describe('Metadata bundle to import'),
  conflictResolution: z.enum(['skip', 'overwrite', 'merge']).default('skip')
    .describe('Conflict resolution strategy'),
  validate: z.boolean().default(true).describe('Validate before import'),
  dryRun: z.boolean().default(false).describe('Dry run (no save)'),
}));

/**
 * Import Metadata Response
 * POST /api/meta/import
 */
export const MetadataImportResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    total: z.number().int().min(0),
    imported: z.number().int().min(0),
    skipped: z.number().int().min(0),
    failed: z.number().int().min(0),
    errors: z.array(z.object({
      type: z.string(),
      name: z.string(),
      error: z.string(),
    })).optional(),
  }).describe('Import result'),
}));

// ==========================================
// 7. Validation
// ==========================================

/**
 * Validate Metadata Request
 * POST /api/meta/validate
 */
export const MetadataValidateRequestSchema = lazySchema(() => z.object({
  type: z.string().describe('Metadata type to validate against'),
  data: z.unknown().describe('Metadata payload to validate'),
}));

/**
 * Validate Metadata Response
 * POST /api/meta/validate
 */
export const MetadataValidateResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: MetadataValidationResultSchema.describe('Validation result'),
}));

// ==========================================
// 8. Type Registry
// ==========================================

/**
 * List Registered Types Response
 * GET /api/meta/types
 */
export const MetadataTypesResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(z.string()).describe('Registered metadata type identifiers'),
}));

/**
 * Type Info Response
 * GET /api/meta/types/:type
 */
export const MetadataTypeInfoResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    type: z.string().describe('Metadata type identifier'),
    label: z.string().describe('Display label'),
    description: z.string().optional().describe('Description'),
    filePatterns: z.array(z.string()).describe('File glob patterns'),
    supportsOverlay: z.boolean().describe('Overlay support'),
    domain: z.string().describe('Protocol domain'),
    actions: z.array(ActionSchema).optional().describe('Declarative type-level actions (buttons) the metadata-admin UI renders for this type'),
  }).optional().describe('Type info'),
}));

// ==========================================
// 9. Dependency Tracking
// ==========================================

/**
 * Dependencies Response
 * GET /api/meta/:type/:name/dependencies
 */
export const MetadataDependenciesResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(MetadataDependencySchema).describe('Items this item depends on'),
}));

/**
 * Dependents Response
 * GET /api/meta/:type/:name/dependents
 */
export const MetadataDependentsResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(MetadataDependencySchema).describe('Items that depend on this item'),
}));

// ==========================================
// Type Exports
// ==========================================

export type ObjectDefinitionResponse = z.input<typeof ObjectDefinitionResponseSchema>;
/** Post-parse shape of {@link ObjectDefinitionResponse} — defaults applied, transforms run (ADR-0122). */
export type ObjectDefinitionResponseParsed = z.infer<typeof ObjectDefinitionResponseSchema>;
export type AppDefinitionResponse = z.input<typeof AppDefinitionResponseSchema>;
/** Post-parse shape of {@link AppDefinitionResponse} — defaults applied, transforms run (ADR-0122). */
export type AppDefinitionResponseParsed = z.infer<typeof AppDefinitionResponseSchema>;
export type ConceptListResponse = z.input<typeof ConceptListResponseSchema>;
/** Post-parse shape of {@link ConceptListResponse} — defaults applied, transforms run (ADR-0122). */
export type ConceptListResponseParsed = z.infer<typeof ConceptListResponseSchema>;
export type MetadataRegisterRequest = z.input<typeof MetadataRegisterRequestSchema>;
export type MetadataItemResponse = z.input<typeof MetadataItemResponseSchema>;
/** Post-parse shape of {@link MetadataItemResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataItemResponseParsed = z.infer<typeof MetadataItemResponseSchema>;
export type MetadataListResponse = z.input<typeof MetadataListResponseSchema>;
/** Post-parse shape of {@link MetadataListResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataListResponseParsed = z.infer<typeof MetadataListResponseSchema>;
export type MetadataNamesResponse = z.input<typeof MetadataNamesResponseSchema>;
/** Post-parse shape of {@link MetadataNamesResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataNamesResponseParsed = z.infer<typeof MetadataNamesResponseSchema>;
export type MetadataExistsResponse = z.input<typeof MetadataExistsResponseSchema>;
/** Post-parse shape of {@link MetadataExistsResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataExistsResponseParsed = z.infer<typeof MetadataExistsResponseSchema>;
export type MetadataDeleteResponse = z.input<typeof MetadataDeleteResponseSchema>;
/** Post-parse shape of {@link MetadataDeleteResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataDeleteResponseParsed = z.infer<typeof MetadataDeleteResponseSchema>;
export type MetadataQueryResponse = z.input<typeof MetadataQueryResponseSchema>;
/** Post-parse shape of {@link MetadataQueryResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataQueryResponseParsed = z.infer<typeof MetadataQueryResponseSchema>;
/**
 * Authoring-side shape of the bulk register request (`continueOnError` /
 * `validate` stay optional — they carry defaults).
 *
 * v17 (#4587): this name moved here from `@objectstack/spec/kernel`, whose
 * copy of the schema was a dead duplicate (its extra per-item `namespace`
 * field matched no enforced write path). `./api` is the single owner of
 * `MetadataBulkRegisterRequest(Schema)` now.
 */
export type MetadataBulkRegisterRequest = z.input<typeof MetadataBulkRegisterRequestSchema>;
/** Post-parse shape of {@link MetadataBulkRegisterRequest} — defaults applied, transforms run (ADR-0122). */
export type MetadataBulkRegisterRequestParsed = z.infer<typeof MetadataBulkRegisterRequestSchema>;
export type MetadataBulkResponse = z.input<typeof MetadataBulkResponseSchema>;
/** Post-parse shape of {@link MetadataBulkResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataBulkResponseParsed = z.infer<typeof MetadataBulkResponseSchema>;
export type MetadataOverlayResponse = z.input<typeof MetadataOverlayResponseSchema>;
/** Post-parse shape of {@link MetadataOverlayResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataOverlayResponseParsed = z.infer<typeof MetadataOverlayResponseSchema>;
export type MetadataEffectiveResponse = z.input<typeof MetadataEffectiveResponseSchema>;
/** Post-parse shape of {@link MetadataEffectiveResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataEffectiveResponseParsed = z.infer<typeof MetadataEffectiveResponseSchema>;
export type MetadataExportResponse = z.input<typeof MetadataExportResponseSchema>;
/** Post-parse shape of {@link MetadataExportResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataExportResponseParsed = z.infer<typeof MetadataExportResponseSchema>;
export type MetadataImportResponse = z.input<typeof MetadataImportResponseSchema>;
/** Post-parse shape of {@link MetadataImportResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataImportResponseParsed = z.infer<typeof MetadataImportResponseSchema>;
export type MetadataValidateResponse = z.input<typeof MetadataValidateResponseSchema>;
/** Post-parse shape of {@link MetadataValidateResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataValidateResponseParsed = z.infer<typeof MetadataValidateResponseSchema>;
export type MetadataTypesResponse = z.input<typeof MetadataTypesResponseSchema>;
/** Post-parse shape of {@link MetadataTypesResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataTypesResponseParsed = z.infer<typeof MetadataTypesResponseSchema>;
export type MetadataTypeInfoResponse = z.input<typeof MetadataTypeInfoResponseSchema>;
/** Post-parse shape of {@link MetadataTypeInfoResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataTypeInfoResponseParsed = z.infer<typeof MetadataTypeInfoResponseSchema>;
export type MetadataDependenciesResponse = z.input<typeof MetadataDependenciesResponseSchema>;
/** Post-parse shape of {@link MetadataDependenciesResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataDependenciesResponseParsed = z.infer<typeof MetadataDependenciesResponseSchema>;
export type MetadataDependentsResponse = z.input<typeof MetadataDependentsResponseSchema>;
/** Post-parse shape of {@link MetadataDependentsResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataDependentsResponseParsed = z.infer<typeof MetadataDependentsResponseSchema>;
export type MetadataBulkUnregisterRequest = z.input<typeof MetadataBulkUnregisterRequestSchema>;
export type MetadataValidateRequest = z.input<typeof MetadataValidateRequestSchema>;
