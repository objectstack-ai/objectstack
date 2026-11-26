// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SQL of the libSQL store: its generation table, its passage tables (one
 * per source and generation), and the shapes of their names. SQLite cannot
 * bind an identifier, so every table name is built from a source id held to
 * {@link SAFE_SOURCE_ID} and a generation number, and is double-quoted; every
 * value is a bind parameter.
 */

/**
 * A source id this module puts into a table name: the spec's snake_case
 * source id (`KnowledgeSource.id`), at most 48 characters. Anything else is
 * refused before it reaches a string.
 */
export const SAFE_SOURCE_ID = /^[a-z_][a-z0-9_]{0,47}$/;

/** The generation table: one row per generation of a source. */
export const GENERATION_TABLE = 'knowledge_generation';

/** Refuses a source id that cannot be put into a table name. */
export function assertSourceId(sourceId: string): void {
  if (!SAFE_SOURCE_ID.test(sourceId)) {
    throw new Error(
      `knowledge-turso: source id '${sourceId}' cannot name a table (snake_case: lower-case letters, digits and ` +
        'underscores, at most 48 characters).',
    );
  }
}

/** The passage table of one generation of one source: `knowledge_<source>_g<generation>`. */
export function generationTable(sourceId: string, generation: number): string {
  assertSourceId(sourceId);
  if (!Number.isInteger(generation) || generation < 1) {
    throw new RangeError(`knowledge-turso: a generation is a positive integer, got ${String(generation)}`);
  }
  return `knowledge_${sourceId}_g${generation}`;
}

/**
 * The table the store held a source in before it kept generations
 * (`knowledge_<source>`, written by the adapter's cloud-repo releases). It is
 * never served: a source that still has one answers "reindex needed", and it
 * is dropped when the source's first generation becomes active.
 */
export function legacyTable(sourceId: string): string {
  assertSourceId(sourceId);
  return `knowledge_${sourceId}`;
}

/** `"name"`, for a name built by this module. */
export function quoted(table: string): string {
  return `"${table}"`;
}

/** The statements that make the generation table and its two one-row-per-source rules. */
export function generationDdl(): string[] {
  const t = quoted(GENERATION_TABLE);
  return [
    `CREATE TABLE IF NOT EXISTS ${t} (
  source_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  fingerprint TEXT,
  recipe_hash TEXT,
  dim INTEGER NOT NULL,
  model TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'building')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (source_id, generation)
)`,
    // One active generation per source, and one under construction: the
    // second index is the lock row that keeps one builder per source (libSQL
    // has no advisory locks).
    `CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_generation_active" ON ${t} (source_id) WHERE state = 'active'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_generation_building" ON ${t} (source_id) WHERE state = 'building'`,
  ];
}

/**
 * The statements that make a generation's passage table afresh. The DROP
 * first: a table left behind by a generation row deleted by hand is never
 * adopted by a new generation of the same number.
 */
export function passageTableDdl(table: string, dimensions: number): string[] {
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new RangeError(`knowledge-turso: vector dimensions must be a positive integer, got ${String(dimensions)}`);
  }
  return [
    `DROP TABLE IF EXISTS ${quoted(table)}`,
    `CREATE TABLE ${quoted(table)} (
  chunk_id TEXT NOT NULL PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_record_id TEXT,
  organization_id TEXT,
  content TEXT NOT NULL,
  title TEXT,
  heading_path TEXT,
  doc_hash TEXT,
  chunk_hash TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  embedding F32_BLOB(${dimensions}) NOT NULL
)`,
    `CREATE INDEX ${quoted(`${table}_document`)} ON ${quoted(table)} (document_id)`,
  ];
}

/** The text a vector is bound as, for `vector32(?)`: `[x,y,…]`. */
export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((x) => (Number.isFinite(x) ? String(x) : '0')).join(',')}]`;
}

/**
 * The canonical JSON text of the value at one top-level key of a row's
 * `metadata`, for an equality filter: the right-hand side is the filter
 * value's `JSON.stringify`, passed through `json()`. `json_each` gives SQL
 * values; booleans and null come back as their JSON spelling, objects and
 * arrays as their minified text, everything else as `json_quote(value)`.
 */
export const METADATA_VALUE_JSON = `CASE type
  WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null'
  WHEN 'object' THEN json(value) WHEN 'array' THEN json(value)
  ELSE json_quote(value) END`;

/**
 * The `json_each` types a record-scope `metadata` term compares (ADR-0161 K8,
 * item 17): a string, or a number read as its text, so the stored number 7
 * matches the id `'7'`. Booleans, null and objects match no id.
 */
export const SCOPE_SCALAR_TYPES = `('text', 'integer', 'real')`;
