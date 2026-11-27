// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SQL of the libSQL store: its generation table, its passage tables (one
 * per source and generation), and the shapes of their names. SQLite cannot
 * bind an identifier, so every table name is built from a source id held to
 * {@link SAFE_SOURCE_ID} and a generation number, and is double-quoted; every
 * value is a bind parameter.
 */

/**
 * A source's index key this module puts into a table name: the string the
 * knowledge service hands over as `ctx.source.name` (a source's snake_case
 * name, or the service's spelling of a package's source — the same
 * alphabet). Anything else is refused before it reaches a string.
 */
export const SAFE_SOURCE_ID = /^[a-z_][a-z0-9_]*$/;

/** The generation table: one row per generation of a source. */
export const GENERATION_TABLE = 'knowledge_generation';

/** Refuses a source id that cannot be put into a table name. */
export function assertSourceId(sourceId: string): void {
  if (!SAFE_SOURCE_ID.test(sourceId)) {
    throw Object.assign(
      new Error(
        `knowledge-turso: source id '${sourceId}' cannot name a table (snake_case: lower-case letters, digits and ` +
          'underscores).',
      ),
      { code: 'VALIDATION_ERROR', status: 400 },
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

/** The columns of a table of the cloud-repo releases, exactly, in no order. */
const LEGACY_COLUMNS = ['chunk_id', 'content', 'document_id', 'embedding', 'metadata', 'source_record_id', 'title'];

/** The columns of a generation's passage table, exactly, in no order. */
const PASSAGE_COLUMNS = [
  'chunk_hash',
  'chunk_id',
  'content',
  'doc_hash',
  'document_id',
  'embedding',
  'heading_path',
  'metadata',
  'organization_id',
  'source_record_id',
  'title',
];

/** The columns of the generation table ({@link generationDdl}), exactly, in no order. */
const GENERATION_COLUMNS = ['created_at', 'dim', 'fingerprint', 'generation', 'model', 'recipe_hash', 'source_id', 'state'];

/** What a table found under a name is, read from `pragma_table_info` rows. */
export type TableShape = 'none' | 'legacy' | 'passage' | 'generation' | 'other';

/**
 * Reads a table's shape from its columns (`name`, `type`): `legacy` only for
 * the exact column set of the cloud-repo releases with an `F32_BLOB` vector,
 * `passage` only for the exact set this module makes, `generation` only for
 * the exact set of the generation table, `other` for anything else (a table
 * the store did not make, never dropped or served), `none` for no table.
 */
export function tableShape(columns: ReadonlyArray<{ name: unknown; type: unknown }>): TableShape {
  if (columns.length === 0) return 'none';
  const names = columns.map((c) => String(c.name)).sort();
  const vector = columns.find((c) => c.name === 'embedding');
  const isVector = vector !== undefined && /^F32_BLOB\(\d+\)$/i.test(String(vector.type).replace(/\s+/g, ''));
  const same = (want: string[]) => names.length === want.length && names.every((n, i) => n === want[i]);
  if (isVector && same(LEGACY_COLUMNS)) return 'legacy';
  if (isVector && same(PASSAGE_COLUMNS)) return 'passage';
  if (same(GENERATION_COLUMNS)) return 'generation';
  return 'other';
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
    // One active generation per source, and one under construction. The
    // second keeps one generation under construction, not one builder: a
    // second build joins it (same fingerprint) or replaces it (another).
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
    ...keywordIndexDdl(table),
  ];
}

/**
 * The names of a passage table's keyword index: a map table (`<table>-kw`, a
 * stable integer key per passage), an FTS5 table (`<table>-fts`, contentless,
 * trigram-tokenized, keyed by the map's integer) and the three triggers that
 * keep both in step with every write to the passage table. Each name holds a
 * hyphen, which no source id, no generation table and no object name can
 * hold, so none can collide with a table the store did not make.
 */
export function keywordNames(table: string): { map: string; fts: string; triggers: [string, string, string] } {
  return {
    map: `${table}-kw`,
    fts: `${table}-fts`,
    triggers: [`${table}-kw-insert`, `${table}-kw-delete`, `${table}-kw-update`],
  };
}

/**
 * The statements that make a passage table's keyword index ({@link
 * keywordNames}) and fill it from the rows the table already holds. The FTS5
 * table is contentless: the text stays in the passage table alone, and a
 * passage's entry is removed with the FTS5 `delete` command and the text as
 * it was indexed, which the triggers hold as `old.content`. The map's integer
 * key is an `INTEGER PRIMARY KEY`, so it survives a `VACUUM` (a passage row's
 * implicit rowid may not). The triggers fire inside the statement that writes
 * the passage, so the index never lags a committed write.
 */
export function keywordIndexDdl(table: string): string[] {
  const { map, fts, triggers } = keywordNames(table);
  const t = quoted(table);
  const m = quoted(map);
  const f = quoted(fts);
  const remove = (row: 'old') =>
    `INSERT INTO ${f} (${f}, rowid, content) SELECT 'delete', id, ${row}.content FROM ${m} WHERE chunk_id = ${row}.chunk_id;`;
  return [
    ...dropKeywordIndexDdl(table),
    `CREATE TABLE ${m} (id INTEGER PRIMARY KEY, chunk_id TEXT NOT NULL UNIQUE)`,
    `CREATE VIRTUAL TABLE ${f} USING fts5(content, content='', tokenize='trigram')`,
    `INSERT INTO ${m} (chunk_id) SELECT chunk_id FROM ${t} ORDER BY chunk_id`,
    `INSERT INTO ${f} (rowid, content) SELECT k.id, p.content FROM ${m} k JOIN ${t} p ON p.chunk_id = k.chunk_id`,
    `CREATE TRIGGER ${quoted(triggers[0])} AFTER INSERT ON ${t} BEGIN
  INSERT INTO ${m} (chunk_id) VALUES (new.chunk_id);
  INSERT INTO ${f} (rowid, content) SELECT id, new.content FROM ${m} WHERE chunk_id = new.chunk_id;
END`,
    `CREATE TRIGGER ${quoted(triggers[1])} AFTER DELETE ON ${t} BEGIN
  ${remove('old')}
  DELETE FROM ${m} WHERE chunk_id = old.chunk_id;
END`,
    `CREATE TRIGGER ${quoted(triggers[2])} AFTER UPDATE OF chunk_id, content ON ${t}
  WHEN old.chunk_id IS NOT new.chunk_id OR old.content IS NOT new.content BEGIN
  ${remove('old')}
  UPDATE ${m} SET chunk_id = new.chunk_id WHERE chunk_id = old.chunk_id;
  INSERT INTO ${f} (rowid, content) SELECT id, new.content FROM ${m} WHERE chunk_id = new.chunk_id;
END`,
  ];
}

/** The statements that drop a passage table's keyword index; its triggers go with the passage table or here. */
export function dropKeywordIndexDdl(table: string): string[] {
  const { map, fts, triggers } = keywordNames(table);
  return [
    ...triggers.map((name) => `DROP TRIGGER IF EXISTS ${quoted(name)}`),
    `DROP TABLE IF EXISTS ${quoted(fts)}`,
    `DROP TABLE IF EXISTS ${quoted(map)}`,
  ];
}

/** What is found under a passage table's keyword-index names, read from `sqlite_master` rows (`type`, `name`, `sql`). */
export type KeywordIndexShape = 'none' | 'complete' | 'partial' | 'other';

/**
 * Reads the shape of a passage table's keyword index: `complete` when the
 * map, the FTS5 table and the three triggers are all there and are this
 * module's; `none` when nothing is; `partial` when only some of this module's
 * are (never left by this module, whose statements run in one transaction,
 * but rebuilt rather than trusted); `other` when an object under one of those
 * names is not this module's — never dropped or used.
 */
export function keywordIndexShape(
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  mapColumns: ReadonlyArray<Record<string, unknown>>,
): KeywordIndexShape {
  const { map, fts, triggers } = keywordNames(table);
  const byName = new Map(
    rows.map((r) => [String(r.name), { type: String(r.type), on: String(r.tbl_name), sql: String(r.sql ?? '') }]),
  );
  const found = [map, fts, ...triggers].filter((n) => byName.has(n));
  if (found.length === 0) return 'none';
  const mapOk =
    !byName.has(map) ||
    (byName.get(map)!.type === 'table' &&
      mapColumns.map((c) => String(c.name)).sort().join(',') === 'chunk_id,id');
  const ftsOk = !byName.has(fts) || (byName.get(fts)!.type === 'table' && /USING\s+fts5\s*\(/i.test(byName.get(fts)!.sql));
  const triggersOk = triggers.every(
    (n) => !byName.has(n) || (byName.get(n)!.type === 'trigger' && byName.get(n)!.on === table),
  );
  if (!mapOk || !ftsOk || !triggersOk) return 'other';
  return found.length === 2 + triggers.length ? 'complete' : 'partial';
}

/**
 * The names of a passage table's approximate vector index: a side table
 * (`<table>-vec`: an integer key, the chunk id, and the passage's vector in
 * float8), libSQL's DiskANN index on it (`<table>$vec`, which libSQL keeps in
 * a shadow table `<table>$vec_shadow`), an index of the passage table's
 * organization column (`<table>-org`), and the three triggers that keep the
 * side table in step with every write to the passage table. A DiskANN index
 * name cannot hold a hyphen, so it holds a `$`, which no source id, generation
 * table or object name can hold either; the other names hold a hyphen.
 */
export function vectorIndexNames(table: string): {
  side: string;
  index: string;
  shadow: string;
  org: string;
  triggers: [string, string, string];
} {
  return {
    side: `${table}-vec`,
    index: `${table}$vec`,
    shadow: `${table}$vec_shadow`,
    org: `${table}-org`,
    triggers: [`${table}-vec-insert`, `${table}-vec-delete`, `${table}-vec-update`],
  };
}

/**
 * The settings of the DiskANN index, measured at 1,536 dimensions on 5,000
 * clustered vectors: neighbours compressed to one bit and at most 32 of them
 * cost about 3 ms a vector to insert and about 11 KB a vector on disk (with
 * the float8 side table), with a recall@10 of 0.998 against the exact scan;
 * float8 neighbours cost three times the time and size for no recall gain on
 * clustered vectors (on unstructured random vectors both fall short: 0.94 and
 * 0.75). libSQL's defaults (float32 neighbours) took 329 MB and 21.8 s for
 * 1,000 vectors.
 */
export const VECTOR_INDEX_SETTINGS = `'metric=cosine', 'compress_neighbors=float1bit', 'max_neighbors=32'`;

/**
 * The statements that make a passage table's approximate vector index ({@link
 * vectorIndexNames}), empty: the side table and its DiskANN index, the
 * organization index of the passage table, and the triggers. The rows the
 * passage table already holds are copied in afterwards, a batch at a time
 * ({@link vectorBackfillSql}); the triggers, made first, keep every row
 * written meanwhile in step, so the side table holds a subset of the passage
 * table's chunks at every moment, and all of them once the copy ends.
 */
export function vectorIndexDdl(table: string, dimensions: number): string[] {
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new RangeError(`knowledge-turso: vector dimensions must be a positive integer, got ${String(dimensions)}`);
  }
  const { side, index, org, triggers } = vectorIndexNames(table);
  const t = quoted(table);
  const s = quoted(side);
  return [
    // The organization index is kept: it may be there alone (made for a
    // table found to hold more than one organization), and serves as it is.
    ...dropVectorIndexDdl(table).filter((statement) => !statement.includes(quoted(org))),
    `CREATE TABLE ${s} (id INTEGER PRIMARY KEY, chunk_id TEXT NOT NULL UNIQUE, embedding F8_BLOB(${dimensions}) NOT NULL)`,
    `CREATE INDEX ${quoted(index)} ON ${s} (libsql_vector_idx(embedding, ${VECTOR_INDEX_SETTINGS}))`,
    organizationIndexDdl(table),
    `CREATE TRIGGER ${quoted(triggers[0])} AFTER INSERT ON ${t} BEGIN
  INSERT INTO ${s} (chunk_id, embedding) VALUES (new.chunk_id, vector8(new.embedding))
    ON CONFLICT (chunk_id) DO UPDATE SET embedding = excluded.embedding;
END`,
    `CREATE TRIGGER ${quoted(triggers[1])} AFTER DELETE ON ${t} BEGIN
  DELETE FROM ${s} WHERE chunk_id = old.chunk_id;
END`,
    `CREATE TRIGGER ${quoted(triggers[2])} AFTER UPDATE OF chunk_id, embedding ON ${t}
  WHEN old.chunk_id IS NOT new.chunk_id OR old.embedding IS NOT new.embedding BEGIN
  UPDATE ${s} SET chunk_id = new.chunk_id, embedding = vector8(new.embedding) WHERE chunk_id = old.chunk_id;
END`,
  ];
}

/** The statement that makes the organization index of a passage table, the first part of its vector index to be made. */
export function organizationIndexDdl(table: string): string {
  return `CREATE INDEX IF NOT EXISTS ${quoted(vectorIndexNames(table).org)} ON ${quoted(table)} (organization_id)`;
}

/**
 * One batch of the copy of a passage table's rows into its vector side table:
 * `last` reads the greatest chunk id of the next `?2` rows after the cursor
 * `?1` (null when none is left), and `copy` copies the rows after `?1` up to
 * and including `?2` that the side table does not hold yet.
 */
export function vectorBackfillSql(table: string): { last: string; copy: string } {
  const t = quoted(table);
  return {
    last: `SELECT max(chunk_id) AS last FROM (SELECT chunk_id FROM ${t} WHERE chunk_id > ?1 ORDER BY chunk_id LIMIT ?2)`,
    copy:
      `INSERT INTO ${quoted(vectorIndexNames(table).side)} (chunk_id, embedding) ` +
      `SELECT chunk_id, vector8(embedding) FROM ${t} WHERE chunk_id > ?1 AND chunk_id <= ?2 ORDER BY chunk_id ` +
      'ON CONFLICT (chunk_id) DO NOTHING',
  };
}

/** The statements that drop a passage table's vector index; libSQL drops the DiskANN index and its shadow with the side table. */
export function dropVectorIndexDdl(table: string): string[] {
  const { side, index, org, triggers } = vectorIndexNames(table);
  return [
    ...triggers.map((name) => `DROP TRIGGER IF EXISTS ${quoted(name)}`),
    `DROP INDEX IF EXISTS ${quoted(org)}`,
    `DROP INDEX IF EXISTS ${quoted(index)}`,
    `DROP TABLE IF EXISTS ${quoted(side)}`,
  ];
}

/** What is found under a passage table's vector-index names, read from `sqlite_master` rows (`type`, `name`, `tbl_name`, `sql`). */
export type VectorIndexShape = 'none' | 'complete' | 'partial' | 'other';

/**
 * Reads the shape of a passage table's vector index, as {@link
 * keywordIndexShape} reads its keyword index: `complete` when the side table
 * (exactly its three columns), its DiskANN index, the organization index and
 * the three triggers are all there and are this module's; `none` when nothing
 * is; `partial` when only some are; `other` when an object under one of those
 * names (or the DiskANN shadow's) is not this module's — never dropped or used.
 * `complete` says the structure is there, not that every row was copied in.
 */
export function vectorIndexShape(
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  sideColumns: ReadonlyArray<Record<string, unknown>>,
): VectorIndexShape {
  const { side, index, shadow, org, triggers } = vectorIndexNames(table);
  const byName = new Map(
    rows.map((r) => [String(r.name), { type: String(r.type), on: String(r.tbl_name), sql: String(r.sql ?? '') }]),
  );
  const own = [side, index, org, ...triggers];
  const found = own.filter((n) => byName.has(n));
  if (found.length === 0 && !byName.has(shadow)) return 'none';
  const is = (name: string, type: string, on: string) =>
    !byName.has(name) || (byName.get(name)!.type === type && byName.get(name)!.on === on);
  const sideOk =
    is(side, 'table', side) &&
    (!byName.has(side) || sideColumns.map((c) => String(c.name)).sort().join(',') === 'chunk_id,embedding,id');
  const indexOk = is(index, 'index', side) && (!byName.has(index) || /libsql_vector_idx\s*\(/i.test(byName.get(index)!.sql));
  // The shadow is libSQL's, made with the DiskANN index and dropped with it.
  const shadowOk = !byName.has(shadow) || (byName.has(index) && byName.get(shadow)!.type === 'table');
  const orgOk = is(org, 'index', table);
  const triggersOk = triggers.every((n) => is(n, 'trigger', table));
  if (!sideOk || !indexOk || !shadowOk || !orgOk || !triggersOk) return 'other';
  return found.length === own.length ? 'complete' : 'partial';
}

/** The most terms of one query the keyword leg matches; the rest are left to the vector leg. */
export const MAX_KEYWORD_TERMS = 16;

/** The shortest term (in characters) the trigram index can match; a shorter one is matched by `LIKE`. */
export const TRIGRAM_MIN_CHARS = 3;

/**
 * The terms of a query for the keyword leg: split at white space and at
 * punctuation that never sits inside a code (a hyphen, a dot, a slash, an
 * underscore, `#`, `@` and `+` stay inside one, so `X-200`, `v1.2` and
 * `a/b` are each one term), stripped of what is not a letter or a digit at
 * either end, compared case-insensitively, at most {@link MAX_KEYWORD_TERMS}.
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

/** A term as one FTS5 phrase: double-quoted, an inner double quote doubled, so no character of it is FTS5 syntax. */
export function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** A `LIKE … ESCAPE '\\'` pattern that holds `term` anywhere, its `%`, `_` and `\\` matched literally. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
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
