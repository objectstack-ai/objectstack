// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { QuerySchema } from './query.zod';

/**
 * Transformation Logic
 * Built-in helpers for converting data during import.
 */
import { lazySchema } from '../shared/lazy-schema';
export const TransformType = z.enum([
  'none',         // Direct copy
  'constant',     // Use a hardcoded value
  'lookup',       // Resolve FK (Name -> ID)
  'split',        // "John Doe" -> ["John", "Doe"]
  'join',         // ["John", "Doe"] -> "John Doe"
  'javascript',   // Custom script (Review security!)
  'map'           // Value mapping (e.g. "Active" -> "active")
]);

/**
 * Field Mapping Item
 */
export const FieldMappingSchema = lazySchema(() => z.object({
  /** Source Column */
  source: z.union([z.string(), z.array(z.string())]).describe('Source column header(s)'),
  
  /** Target Field */
  target: z.union([z.string(), z.array(z.string())]).describe('Target object field(s)'),
  
  /** Transformation */
  transform: TransformType.default('none'),
  
  /** Configuration for transform */
  params: z.object({
    // Constant
    value: z.unknown().optional(),
    
    // Lookup
    object: z.string().optional(), // Lookup Object
    fromField: z.string().optional(), // Match on (e.g. "name")
    toField: z.string().optional(), // Value to take (e.g. "id")
    autoCreate: z.boolean().optional(), // Create if missing
    
    // Map
    valueMap: z.record(z.string(), z.unknown()).optional(), // { "Open": "draft" }
    
    // Split/Join
    separator: z.string().optional()
  }).optional()
}));

/**
 * Data Mapping Schema
 * Defines a reusable data mapping configuration for ETL operations.
 * 
 * **NAMING CONVENTION:**
 * Mapping names are machine identifiers and must be lowercase snake_case.
 * 
 * @example Good mapping names
 * - 'salesforce_to_crm'
 * - 'csv_import_contacts'
 * - 'api_sync_orders'
 * 
 * @example Bad mapping names (will be rejected)
 * - 'SalesforceToCRM' (PascalCase)
 * - 'CSV Import' (spaces)
 */
export const MappingSchema = lazySchema(() => z.object({
  /** Identity */
  name: SnakeCaseIdentifierSchema.describe('Mapping unique name (lowercase snake_case)'),
  label: z.string().optional(),
  
  /** Scope */
  sourceFormat: z.enum(['csv', 'json', 'xml', 'sql']).default('csv'),
  targetObject: z.string().describe('Target Object Name'),
  
  /** Column Mappings */
  fieldMapping: z.array(FieldMappingSchema),
  
  /** Upsert Logic */
  mode: z.enum(['insert', 'update', 'upsert']).default('insert'),
  upsertKey: z.array(z.string()).optional().describe('Fields to match for upsert (e.g. email)'),
  
  /** Extract Logic (For Export) */
  extractQuery: QuerySchema.optional().describe('Query to run for export only'),
  
  /** Error Handling */
  errorPolicy: z.enum(['skip', 'abort', 'retry']).default('skip'),
  batchSize: z.number().default(1000)
}));

export type Mapping = z.infer<typeof MappingSchema>;
/** Authoring input for {@link Mapping} — defaulted fields are optional. */
export type MappingInput = z.input<typeof MappingSchema>;

/**
 * Type-safe factory for a data import/export mapping. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Mapping` literal.
 */
export function defineMapping(config: z.input<typeof MappingSchema>): Mapping {
  return MappingSchema.parse(config);
}
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
