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
    // A search narrowed to the records its caller may read (a `record` scope
    // term) reads only those records' passages of the generation.
    `CREATE INDEX IF NOT EXISTS "${table}_record" ON ${qualified(schema, table)} (source_id, generation, source_record_id)`,
    keywordIndexDdl(schema, dimensions),
  ];
}

/**
 * The text-search configuration of the keyword leg: `simple` — lower-cased
 * words, no stemming and no stop words, so a code or a name is matched as it
 * is written, in any language the parser splits into words.
 */
export const TS_CONFIG = `'simple'::regconfig`;

/** The `tsvector` of a passage the keyword leg matches, the expression its GIN index is built on. */
export const PASSAGE_TSVECTOR = `to_tsvector(${TS_CONFIG}, content)`;

/** The name of the keyword index of the passage table of one width. */
export function keywordIndexName(dimensions: number): string {
  return `${vectorTable(dimensions)}_content_tsv`;
}

/**
 * The statement that makes the keyword index of the passage table of one
 * width: a GIN index on {@link PASSAGE_TSVECTOR}. An expression index, so no
 * column is added and no row is rewritten; PostgreSQL keeps it in step with
 * every write, delete and drop of the table's rows.
 */
export function keywordIndexDdl(schema: string, dimensions: number): string {
  return `CREATE INDEX IF NOT EXISTS "${keywordIndexName(dimensions)}" ON ${qualified(schema, vectorTable(dimensions))} USING gin (${PASSAGE_TSVECTOR})`;
}

/** The most terms of one query the keyword leg matches; the rest are left to the vector leg. */
export const MAX_KEYWORD_TERMS = 16;

/** The shortest term (in characters) matched on the `tsvector`; a shorter one is matched by `ILIKE`. */
export const WORD_MIN_CHARS = 3;

/**
 * A character the `simple` parser does not split a run of text at: Han,
 * Hiragana, Katakana and Hangul. A run of them is one `tsvector` word, so a
 * term holding one is matched by `ILIKE`, as a substring, never as a word.
 */
export const UNSEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * The terms of a query for the keyword leg: split at white space and at
 * punctuation that never sits inside a code (a hyphen, a dot, a slash, an
 * underscore, `#`, `@` and `+` stay inside one, so `X-200`, `v1.2` and
 * `a/b` are each one term), stripped of what is not a letter or a digit at
 * either end, compared case-insensitively, at most {@link MAX_KEYWORD_TERMS}.
 * The same rule as the libSQL store's.
 */
export function keywordTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.split(/[\s,;:!?()[\]{}<>"'`|\\=*~^$%&\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\u2018-\u201f\u2026]+/u)) {
    const term = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (term === '') continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === MAX_KEYWORD_TERMS) break;
  }
  return terms;
}

/** Whether a term is matched on the `tsvector` (a word of three characters or more the parser splits), not by `ILIKE`. */
export function isWordTerm(term: string): boolean {
  return [...term].length >= WORD_MIN_CHARS && !UNSEGMENTED.test(term);
}

/** An `ILIKE` pattern that holds `term` anywhere, its `%`, `_` and `\\` matched literally (the default escape). */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The text a vector is bound as: pgvector's `[x,y,…]` literal. */
export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((x) => (Number.isFinite(x) ? String(x) : '0')).join(',')}]`;
}
