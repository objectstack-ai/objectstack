// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Seed Import Strategy
 * Defines how the engine handles existing records when a seed is applied.
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
export const SeedMode = z.enum([
  'insert',    // Try to insert, fail on duplicate
  'update',    // Only update found records, ignore new
  'upsert',    // Create new or Update existing (Standard)
  'replace',   // Delete ALL records in object then insert (Dangerous - use for cache tables)
  'ignore'     // Try to insert, silently skip duplicates
]);

/**
 * Seed Schema (Seed Data / Fixtures)
 *
 * Standardized format for transporting initialization data. Used for:
 * 1. System Bootstrapping (Admin accounts, Standard Roles)
 * 2. Reference Data (Countries, Currencies)
 * 3. Demo / sample data (incl. AI-authored, applied on publish)
 *
 * This is the shape of the runtime-draftable `seed` metadata type: an author
 * (or the AI metadata assistant) stages a `seed` draft against this schema and
 * its rows load when the draft is published. Named `Seed` (not `Dataset`) so
 * the `dataset` name stays reserved for the ADR-0021 analytics semantic layer.
 */
export const SeedSchema = lazySchema(() => strictObject({
  surface: 'this seed',
  history:
    'Until this shape was closed, these were dropped silently — the seed still applied, on the defaults '
    + '(`mode: upsert`, `externalId: name`) rather than what was written.',
  aliases: {
    objectname: 'object',
    target: 'object',
    data: 'records',
    rows: 'records',
    values: 'records',
    key: 'externalId',
    externalkey: 'externalId',
    naturalkey: 'externalId',
    strategy: 'mode',
    conflict: 'mode',
    environment: 'env',
    environments: 'env',
  },
}, {
  /**
   * Target Object
   * The machine name of the object to populate.
   */
  object: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Target Object Name'),

  /**
   * Idempotency Key (The "Upsert" Key)
   * The field (or fields) used to check if a record already exists.
   * Best Practice: Use a natural key like 'code', 'slug', 'username' or 'external_id'.
   * Standard: 'id' is rarely used for portable seed data — prefer natural keys.
   *
   * A single field name matches on that one column. A **composite** natural key
   * — a list of field names — is required for objects with no single-field
   * natural key, most commonly a **join / junction table** keyed by both of its
   * foreign keys (e.g. `externalId: ['team', 'project']`). Without it such a
   * dataset can only run `mode: 'insert'`, which re-inserts every row on each
   * replay boot and duplicates the table (framework#3434). The reference fields
   * are matched by their RESOLVED ids, so a composite of foreign keys dedupes
   * correctly across restarts.
   */
  externalId: z
    .union([z.string(), z.array(z.string()).min(1)])
    .default('name')
    .describe('Field (or composite list of fields) matched for the uniqueness check'),

  /**
   * Import Strategy
   */
  mode: SeedMode.default('upsert').describe('Conflict resolution strategy'),

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

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `seed` is a registered metadata type, so `MetadataPlugin`'s artifact loader
  // stamps `_packageId` / `_provenance` on it like every sibling, and
  // `getMetaItemLayered` → `saveMetaItem` round-trips a body carrying them.
  // Undeclared, those were stripped on every parse — the same inverse drift
  // that made `permission` 422 on the ADR-0094 overlay path when it went strict
  // (#4001 findings log, entry 2). Declared here so closing the shape cannot
  // repeat it.
  ...MetadataProtectionFields,
}));

/** Parsed/output type — all defaults are applied (env, mode, externalId always present) */
export type Seed = z.input<typeof SeedSchema>;
/** Post-parse shape of {@link Seed} — defaults applied, transforms run (ADR-0122). */
export type SeedParsed = z.infer<typeof SeedSchema>;

export type SeedImportMode = z.input<typeof SeedMode>;

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
 *
 * A `multiple: true` lookup is the one exception: it stores an ARRAY of ids, so
 * it is seeded from an ARRAY of natural keys — one per element (framework#3911).
 * A lone string stays legal there because the loader accepts it as one-element
 * shorthand for the array shape the field stores. `master_detail` is inherently
 * single-valued and so is never widened.
 */
type SeedFieldValue<TFieldDef> =
  TFieldDef extends { type: 'lookup' | 'master_detail' }
    ? TFieldDef extends { multiple: true }
      ? string | string[] | null
      : string | null
    : unknown;

/** Shape of a single seed record, derived from the object's field definitions. */
type SeedRecord<TFields> = {
  [K in keyof TFields]?: SeedFieldValue<TFields[K]>;
};

/**
 * Type-safe factory for creating seed definitions.
 * Infers valid field keys from the object definition passed in,
 * so typos in record field names are caught at compile time. Reference
 * fields (lookup/master_detail) are additionally constrained to the
 * natural-key string the loader resolves — see {@link SeedFieldValue}.
 *
 * @example
 * ```ts
 * export const leadSeed = defineSeed(Lead, {
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
export function defineSeed<
  const TObj extends { name: string; fields: Record<string, unknown> }
>(
  objectDef: TObj,
  config: Omit<Seed, 'object' | 'records'> & {
    records: Array<SeedRecord<TObj['fields']>>;
  }
): Seed {
  return SeedSchema.parse({ ...config, object: objectDef.name });
}
