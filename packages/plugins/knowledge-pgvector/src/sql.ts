// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SQL of the pgvector store: its schema, its two kinds of table, and the
 * statements the adapter runs. Identifiers are inlined (PostgreSQL cannot bind
 * one) and so are held to {@link SAFE_IDENTIFIER} before they reach a string;
 * every value is a bind parameter.
 */

/** A lower-case PostgreSQL identifier this module inlines: a schema name. */
export const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * The schema the store's tables live in, unless the plugin is given another.
 * A schema of its own, never the platform's: object tables live in the
 * connection's `search_path` schema (`current_schema()`), and the platform's
 * schema-drift readings (`os migrate plan`, the driver's introspection) read
 * that schema only — so a table here can neither collide with an object table
 * nor be reported as drift.
 */
export const DEFAULT_KNOWLEDGE_SCHEMA = 'os_knowledge';

/** The generation table: one row per generation of a source. */
export const GENERATION_TABLE = 'knowledge_generation';

/**
 * The state of a generation row: `active` (the one searched), `building` (the
 * one a build under a new fingerprint fills), `retired` (replaced, its
 * passages being deleted in batches).
 */
export type GenerationState = 'active' | 'building' | 'retired';

/** The passage table of one vector width: `knowledge_vec_d<dimensions>`. */
export function vectorTable(dimensions: number): string {
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new RangeError(`knowledge-pgvector: vector dimensions must be a positive integer, got ${String(dimensions)}`);
  }
  return `knowledge_vec_d${dimensions}`;
}

/** `"schema"."table"`, for an identifier already held to {@link SAFE_IDENTIFIER}. */
export function qualified(schema: string, table: string): string {
  return `"${schema}"."${table}"`;
}

/** The statements that make the store's schema and its generation table. */
export function schemaDdl(schema: string): string[] {
  return [
    `CREATE SCHEMA IF NOT EXISTS "${schema}"`,
    `CREATE TABLE IF NOT EXISTS ${qualified(schema, GENERATION_TABLE)} (
  source_id text NOT NULL,
  generation integer NOT NULL,
  fingerprint text,
  recipe_hash text,
  dim integer NOT NULL,
  model text,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, generation)
)`,
    // One active generation per source, and one under construction (ADR-0161
    // K7). A generation being deleted is `retired` and held by neither.
    `CREATE UNIQUE INDEX IF NOT EXISTS "${GENERATION_TABLE}_active" ON ${qualified(schema, GENERATION_TABLE)} (source_id) WHERE state = 'active'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "${GENERATION_TABLE}_building" ON ${qualified(schema, GENERATION_TABLE)} (source_id) WHERE state = 'building'`,
  ];
}

/**
 * The statements that make the passage table of one width. `vectorType` is
 * the extension's `vector` type, qualified with the schema the extension is
 * installed in.
 */
export function vectorTableDdl(schema: string, dimensions: number, vectorType: string): string[] {
  const table = vectorTable(dimensions);
  return [
    `CREATE TABLE IF NOT EXISTS ${qualified(schema, table)} (
  source_id text NOT NULL,
  generation integer NOT NULL,
  chunk_id text NOT NULL,
  document_id text NOT NULL,
  source_record_id text,
  organization_id text,
  content text NOT NULL,
  title text,
  heading_path jsonb,
  doc_hash text,
  chunk_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding ${vectorType}(${dimensions}) NOT NULL,
  PRIMARY KEY (source_id, generation, chunk_id)
)`,
    `CREATE INDEX IF NOT EXISTS "${table}_document" ON ${qualified(schema, table)} (source_id, generation, document_id)`,
  ];
}

/** The text a vector is bound as: pgvector's `[x,y,…]` literal. */
export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((x) => (Number.isFinite(x) ? String(x) : '0')).join(',')}]`;
}
