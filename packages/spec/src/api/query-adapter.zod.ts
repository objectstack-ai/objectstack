// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * API Query DSL Adapter Protocol
 * 
 * Defines mapping rules between the internal unified query DSL
 * (defined in `data/query.zod.ts`) and external API protocol formats:
 * REST and OData.
 * 
 * This enables ObjectStack to expose a single internal query representation
 * while supporting multiple API standards for external consumers.
 * 
 * @see data/query.zod.ts - Unified internal query DSL
 * @see api/rest-server.zod.ts - REST API configuration
 * @see api/odata.zod.ts - OData API configuration
 */

// ==========================================
// 1. Shared Adapter Types
// ==========================================

/**
 * Query Adapter Target Protocol
 */
import { lazySchema } from '../shared/lazy-schema';
export const QueryAdapterTargetSchema = lazySchema(() => z.enum([
  'rest',       // REST API (?filter[field][op]=value)
  'odata',      // OData ($filter=field op value)
]));

export type QueryAdapterTarget = z.input<typeof QueryAdapterTargetSchema>;

/**
 * Operator Mapping Entry
 * 
 * Maps a unified DSL operator to its protocol-specific syntax.
 */
export const OperatorMappingSchema = lazySchema(() => z.object({
  /** Unified DSL operator (e.g., 'eq', 'gt', 'contains') */
  operator: z.string().describe('Unified DSL operator'),

  /** REST query parameter format (e.g., 'filter[{field}][{op}]') */
  rest: z.string().optional().describe('REST query parameter template'),

  /** OData $filter expression format (e.g., '{field} {op} {value}') */
  odata: z.string().optional().describe('OData $filter expression template'),
}));

export type OperatorMapping = z.input<typeof OperatorMappingSchema>;

// ==========================================
// 2. REST Adapter Configuration
// ==========================================

/**
 * REST Query Adapter Configuration
 * 
 * Defines how unified query DSL maps to REST query parameters.
 * 
 * @example
 * Unified: { filters: [['status', '=', 'active']], top: 10 }
 * REST:    ?filter[status][eq]=active&limit=10
 */
export const RestQueryAdapterSchema = lazySchema(() => z.object({
  /** Filter parameter style */
  filterStyle: z.enum([
    'bracket',       // ?filter[field][op]=value  (JSON API style)
    'dot',           // ?filter.field.op=value
    'flat',          // ?field=value (simple equality)
    'rsql',          // ?filter=field==value;field=gt=10 (RSQL / FIQL)
  ]).default('bracket').describe('REST filter parameter encoding style'),

  /** Pagination parameter names */
  pagination: z.object({
    /** Page size parameter name */
    limitParam: z.string().default('limit').describe('Page size parameter name'),

    /** Offset parameter name */
    offsetParam: z.string().default('offset').describe('Offset parameter name'),

    /** Cursor parameter name (for cursor-based pagination) */
    cursorParam: z.string().default('cursor').describe('Cursor parameter name'),

    /** Page number parameter name (for page-based pagination) */
    pageParam: z.string().default('page').describe('Page number parameter name'),
  }).optional().describe('Pagination parameter name mappings'),

  /** Sort parameter name and format */
  sorting: z.object({
    /** Sort parameter name */
    param: z.string().default('sort').describe('Sort parameter name'),

    /** Sort format */
    format: z.enum([
      'comma',          // ?sort=field1,-field2
      'array',          // ?sort[]=field1&sort[]=-field2
      'pipe',           // ?sort=field1|asc,field2|desc
    ]).default('comma').describe('Sort parameter encoding format'),
  }).optional().describe('Sort parameter mapping'),

  /** Field selection parameter name */
  fieldsParam: z.string().default('fields').describe('Field selection parameter name'),
}));

export type RestQueryAdapter = z.input<typeof RestQueryAdapterSchema>;
/** Post-parse shape of {@link RestQueryAdapter} — defaults applied, transforms run (ADR-0122). */
export type RestQueryAdapterParsed = z.infer<typeof RestQueryAdapterSchema>;

// ==========================================
// 4. OData Adapter Configuration
// ==========================================

/**
 * OData Query Adapter Configuration
 * 
 * Defines how unified query DSL maps to OData system query options.
 * 
 * @example
 * Unified: { filters: [['status', '=', 'active']], top: 10, sort: [{ field: 'name', order: 'asc' }] }
 * OData:   ?$filter=status eq 'active'&$top=10&$orderby=name asc
 */
export const ODataQueryAdapterSchema = lazySchema(() => z.object({
  /** OData version */
  version: z.enum(['v2', 'v4']).default('v4').describe('OData version'),

  /** System query option prefixes */
  usePrefix: z.boolean().default(true).describe('Use $ prefix for system query options ($filter vs filter)'),

  /** String function support */
  stringFunctions: z.array(z.enum([
    'contains',
    'startswith',
    'endswith',
    'tolower',
    'toupper',
    'trim',
    'concat',
    'substring',
    'length',
  ])).optional().describe('Supported OData string functions'),

  /** Expand (nested resource) configuration */
  expand: z.object({
    enabled: z.boolean().default(true).describe('Enable $expand support'),
    maxDepth: z.number().int().min(1).default(3).describe('Maximum expand depth'),
  }).optional().describe('$expand configuration'),
}));

export type ODataQueryAdapter = z.input<typeof ODataQueryAdapterSchema>;
/** Post-parse shape of {@link ODataQueryAdapter} — defaults applied, transforms run (ADR-0122). */
export type ODataQueryAdapterParsed = z.infer<typeof ODataQueryAdapterSchema>;

// ==========================================
// 5. Complete Query Adapter Configuration
// ==========================================

/**
 * Query Adapter Configuration
 * 
 * Root configuration for query DSL adapters across all supported protocols.
 * Controls how the internal unified DSL is translated to external API formats.
 */
export const QueryAdapterConfigSchema = lazySchema(() => z.object({
  /** Default operator mappings */
  operatorMappings: z.array(OperatorMappingSchema).optional().describe('Custom operator mappings'),

  /** REST adapter configuration */
  rest: RestQueryAdapterSchema.optional().describe('REST query adapter configuration'),

  /** OData adapter configuration */
  odata: ODataQueryAdapterSchema.optional().describe('OData query adapter configuration'),
}));

export type QueryAdapterConfig = z.input<typeof QueryAdapterConfigSchema>;
/** Post-parse shape of {@link QueryAdapterConfig} — defaults applied, transforms run (ADR-0122). */
export type QueryAdapterConfigParsed = z.infer<typeof QueryAdapterConfigSchema>;
