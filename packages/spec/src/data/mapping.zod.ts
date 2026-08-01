// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { QuerySchema } from './query.zod';

/**
 * Shared history for this file (#4001).
 *
 * An import mapping is instructions for moving somebody's data. A dropped key
 * does not fail the import — it runs, to completion, with a "success" the
 * author reads as "the data arrived the way I described it". The rows land
 * untransformed, or unmatched, or duplicated, and the diagnosis starts from a
 * green run.
 */
const MAPPING_HISTORY =
  'Until #4001 closed this shape these were dropped silently — the mapping still ran to '
  + 'completion and reported success, minus whatever the key was meant to control.';

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
export const FieldMappingSchema = lazySchema(() => strictObject({
  surface: 'this field mapping',
  history: MAPPING_HISTORY,
  aliases: {
    from: 'source', sourceField: 'source', column: 'source', header: 'source',
    to: 'target', targetField: 'target', field: 'target',
    type: 'transform', operation: 'transform', fn: 'transform',
    config: 'params', options: 'params', args: 'params',
  },
}, {
  /** Source Column */
  source: z.union([z.string(), z.array(z.string())]).describe('Source column header(s)'),

  /** Target Field */
  target: z.union([z.string(), z.array(z.string())]).describe('Target object field(s)'),

  /** Transformation */
  transform: TransformType.default('none'),

  /** Configuration for transform */
  // One flat bag rather than a per-`transform` discriminated union, so which
  // keys are meaningful depends on `transform`. Closing it catches the spelling;
  // it does NOT catch `separator` on a `lookup` (a key that is real but inert
  // here). Narrowing per transform is a refinement, not a strictness question.
  params: strictObject({
    surface: 'this transform’s params',
    history: MAPPING_HISTORY,
    aliases: {
      default: 'value', defaultValue: 'value', constant: 'value',
      lookupObject: 'object', targetObject: 'object',
      match: 'fromField', matchOn: 'fromField', matchField: 'fromField', keyField: 'fromField',
      returnField: 'toField', valueField: 'toField',
      create: 'autoCreate', createIfMissing: 'autoCreate', upsert: 'autoCreate',
      map: 'valueMap', mapping: 'valueMap', values: 'valueMap', valueMapping: 'valueMap',
      delimiter: 'separator', splitOn: 'separator', joinWith: 'separator',
    },
  }, {
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
export const MappingSchema = lazySchema(() => strictObject({
  surface: 'this mapping',
  history: MAPPING_HISTORY,
  aliases: {
    object: 'targetObject', target: 'targetObject', to: 'targetObject',
    format: 'sourceFormat', source: 'sourceFormat', sourceType: 'sourceFormat',
    mappings: 'fieldMapping', fields: 'fieldMapping', columns: 'fieldMapping', fieldMappings: 'fieldMapping',
    key: 'upsertKey', matchOn: 'upsertKey', externalId: 'upsertKey', externalIdField: 'upsertKey',
    query: 'extractQuery',
    onError: 'errorPolicy', errorHandling: 'errorPolicy', errorMode: 'errorPolicy',
    batch: 'batchSize', chunkSize: 'batchSize',
  },
  guidance: {
    // `mode: 'upsert'` needs `upsertKey`; an author reaching for a
    // dedup/matching knob under another name is describing that pair.
    dedupe: 'deduplication is `mode: \'upsert\'` plus `upsertKey: [<field>]` — there is no separate dedupe switch',
    skipErrors: "`errorPolicy: 'skip'` is the default and already does this — remove the key",
  },
}, {
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
  batchSize: z.number().default(1000),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `mapping` is a registered metadata type, so `MetadataPlugin`'s loader
  // stamps `_packageId` / `_provenance` on it like every sibling. Undeclared,
  // they were dropped on every parse: protection metadata lost on round-trip,
  // and a hard 422 the day this shape closed — which is today.
  ...MetadataProtectionFields,
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
