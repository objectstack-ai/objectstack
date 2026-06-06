// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Data Import Strategy
 * Defines how the engine handles existing records.
 */
import { lazySchema } from '../shared/lazy-schema';
export const DatasetMode = z.enum([
  'insert',    // Try to insert, fail on duplicate
  'update',    // Only update found records, ignore new
  'upsert',    // Create new or Update existing (Standard)
  'replace',   // Delete ALL records in object then insert (Dangerous - use for cache tables)
  'ignore'     // Try to insert, silently skip duplicates
]);

/**
 * Dataset Schema (Seed Data / Fixtures)
 * 
 * Standardized format for transporting data.
 * Used for:
 * 1. System Bootstrapping (Admin accounts, Standard Roles)
 * 2. Reference Data (Countries, Currencies)
 * 3. Demo/Test Data
 */
export const DatasetSchema = lazySchema(() => z.object({
  /** 
   * Target Object 
   * The machine name of the object to populate.
   */
  object: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Target Object Name'),

  /** 
   * Idempotency Key (The "Upsert" Key)
   * The field used to check if a record already exists.
   * Best Practice: Use a natural key like 'code', 'slug', 'username' or 'external_id'.
   * Standard: 'id' is rarely used for portable seed data — prefer natural keys.
   */
  externalId: z.string().default('name').describe('Field match for uniqueness check'),

  /** 
   * Import Strategy
   */
  mode: DatasetMode.default('upsert').describe('Conflict resolution strategy'),

  /**
   * Environment Scope
   * - 'all': Always load
   * - 'dev': Only for development/demo
   * - 'test': Only for CI/CD tests
   */
  env: z.array(z.enum(['prod', 'dev', 'test'])).default(['prod', 'dev', 'test']).describe('Applicable environments'),

  /** 
   * The Payload
   * Array of raw JSON objects matching the Object Schema.
   */
  records: z.array(z.record(z.string(), z.unknown())).describe('Data records'),
}));

/**
 * Seed metadata-type schema — the runtime-draftable, publishable form of
 * fixture / initialization data (the `seed` metadata type).
 *
 * It shares the {@link DatasetSchema} shape today (object + externalId + mode +
 * env + records), but is exported under its own name so the `seed` metadata
 * type can evolve independently of the `dataset` name, which ADR reserves for a
 * future data-analysis capability. Authoring tools (incl. the AI metadata
 * assistant) stage `type: 'seed'` drafts against this schema; publishing the
 * draft is what applies the rows (runtime SeedLoaderService).
 */
export const SeedSchema = DatasetSchema;

/** A seed metadata item (same shape as {@link Dataset}). */
export type Seed = z.infer<typeof SeedSchema>;
export type SeedInput = z.input<typeof SeedSchema>;

/** Parsed/output type — all defaults are applied (env, mode, externalId always present) */
export type Dataset = z.infer<typeof DatasetSchema>;

/** Input type — fields with defaults (env, mode, externalId) are optional */
export type DatasetInput = z.input<typeof DatasetSchema>;

export type DatasetImportMode = z.infer<typeof DatasetMode>;

/**
 * Per-field value type for a seed record.
 *
 * Reference fields (`lookup` / `master_detail`) are resolved during seeding by
 * matching the value against the target record's externalId — so the value MUST
 * be the plain natural-key string (e.g. `account: 'Acme Corp'`), or `null`.
 * Passing a wrapper object like `account: { externalId: 'Acme Corp' }` does NOT
 * resolve: the loader skips non-string reference values, the raw object reaches
 * the SQL driver, and on update it crashes with "SQLite3 can only bind numbers,
 * strings, bigints, buffers, and null" (silently masked on an always-empty
 * `:memory:` DB, fatal-looking on a persistent one). Constrain those fields to
 * `string | null` at compile time; every other field stays `unknown`.
 */
type SeedFieldValue<TFieldDef> =
  TFieldDef extends { type: 'lookup' | 'master_detail' } ? string | null : unknown;

/** Shape of a single seed record, derived from the object's field definitions. */
type SeedRecord<TFields> = {
  [K in keyof TFields]?: SeedFieldValue<TFields[K]>;
};

/**
 * Type-safe factory for creating seed dataset definitions.
 * Infers valid field keys from the object definition passed in,
 * so typos in record field names are caught at compile time. Reference
 * fields (lookup/master_detail) are additionally constrained to the
 * natural-key string the loader resolves — see {@link SeedFieldValue}.
 *
 * @example
 * ```ts
 * export const leadSeed = defineDataset(Lead, {
 *   externalId: 'email',
 *   records: [
 *     { first_name: 'Alice', lead_source: 'web' },   // ✅ type-checked
 *     { source: 'web' },                              // ❌ compile error (unknown field)
 *     { first_name: 'Bob', account: 'Acme Corp' },   // ✅ reference by natural key
 *     { first_name: 'Bob', account: { externalId: 'Acme Corp' } }, // ❌ object not allowed
 *   ],
 * });
 * ```
 */
export function defineDataset<
  const TObj extends { name: string; fields: Record<string, unknown> }
>(
  objectDef: TObj,
  config: Omit<DatasetInput, 'object' | 'records'> & {
    records: Array<SeedRecord<TObj['fields']>>;
  }
): Dataset {
  return DatasetSchema.parse({ ...config, object: objectDef.name });
}
