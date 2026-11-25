// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type {
  AdapterContext,
  AdapterEmbeddingDescriptor,
  AdapterIndexStatus,
  AdapterListDocumentsOptions,
  AdapterListDocumentsPage,
  AdapterSearchOptions,
  IEmbedder,
  IKnowledgeAdapter,
} from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit } from '@objectstack/spec/ai';
import {
  DEFAULT_KNOWLEDGE_SCHEMA,
  GENERATION_TABLE,
  SAFE_IDENTIFIER,
  qualified,
  schemaDdl,
  vectorLiteral,
  vectorTable,
  vectorTableDdl,
} from './sql.js';

/** One answer of a query: its rows. */
export interface PgQueryResult<R = Record<string, unknown>> {
  rows: R[];
}

/** What the adapter needs of a checked-out connection: a query, and its release. */
export interface PgClientLike {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<PgQueryResult<R>>;
  release(err?: Error | boolean): void;
}

/**
 * What the adapter needs of a connection pool (`pg.Pool` has it — see
 * `poolFromPg`): a one-shot query, which takes a connection and gives it back,
 * and a checkout for a transaction.
 */
export interface PgPoolLike {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<PgQueryResult<R>>;
  connect(): Promise<PgClientLike>;
}

/** Options of {@link PgvectorKnowledgeAdapter}. */
export interface PgvectorKnowledgeAdapterOptions {
  /** Adapter id, the value of `KnowledgeSource.adapter`. @default 'pgvector' */
  id?: string;
  /**
   * The pool the store queries through. Absent: the store has no database,
   * and every call answers `SERVICE_UNAVAILABLE` naming `unavailable`.
   */
  pool?: PgPoolLike;
  /** Why there is no pool, said by every call when `pool` is absent. */
  unavailable?: string;
  /**
   * The embedder the store calls, or a getter read at each call (the kernel's
   * `embedder` service may register after this adapter). Its `dimensions`
   * choose the passage table; its `model` and `dimensions` are what the
   * adapter reports to the knowledge service's index fingerprint.
   */
  embedder: IEmbedder | (() => IEmbedder | undefined);
  /**
   * The schema the store's tables live in.
   * @default 'os_knowledge'
   */
  schema?: string;
  /**
   * Text put before every QUERY before it is embedded, for an asymmetric
   * model that embeds questions and passages differently (BGE's
   * `'Represent this sentence for searching relevant passages: '`). Passages
   * are embedded as they are. It changes no stored vector, so it is not part
   * of the index fingerprint (ADR-0161 K8, item 15).
   */
  queryPrefix?: string;
}

/** The ADR-0112 code of a write or a search refused under another fingerprint (ADR-0161 K7, rules 4 and 5). */
export const KNOWLEDGE_REBUILD_REQUIRED = 'KNOWLEDGE_REBUILD_REQUIRED';

/** A generation row: one complete index of one source under one fingerprint. */
interface GenerationRow {
  generation: number;
  fingerprint: string | null;
  recipe_hash: string | null;
  dim: number;
}

/** What the store learned when it became ready. */
interface Readiness {
  /** The schema the `vector` extension is installed in, quoted for SQL. */
  extensionSchema: string;
  /** The extension's version. */
  version: string;
}

/**
 * `PgvectorKnowledgeAdapter` — an `IKnowledgeAdapter` on PostgreSQL with the
 * pgvector extension: the open vector store for self-hosted deployments
 * (cloud ADR-0119 D5; ADR-0161 Execution, row 8a).
 *
 * ## Storage
 *
 * In its own schema ({@link DEFAULT_KNOWLEDGE_SCHEMA}, outside the
 * connection's `search_path`, so no table can collide with an object table or
 * be read as schema drift): a generation table, `knowledge_generation` (source,
 * generation, fingerprint, recipe hash, vector width, model, state), and one
 * passage table per vector width, `knowledge_vec_d<width>`, created the first
 * time a width is written. A passage row holds its source, generation, chunk
 * and document ids, record id, organization, text, title, heading path,
 * document hash, chunk hash, metadata and vector. The text is stored: it is
 * as sensitive as the record it came from, and it is in every backup of the database.
 *
 * ## Search
 *
 * An exact scan by cosine distance — no approximate index, so a 3072-wide
 * model works (pgvector's HNSW index stops at 2000 dimensions; adding one is an
 * operator's step, documented with the package). The organization filter
 * (ADR-0161 K8, item 9) and the metadata-equality `filter` run in the same
 * `WHERE`, before ranking. A passage whose cosine similarity is not positive is
 * not a hit.
 *
 * ## The index fingerprint (ADR-0161 K7; K8, item 8)
 *
 * The generation row holds the fingerprint the source was built under. A write
 * or a search carrying another is refused `KNOWLEDGE_REBUILD_REQUIRED` and is
 * never served from the stored generation. A source that holds nothing takes
 * the first fingerprint it is handed. `beginBuild` under the stored fingerprint
 * rebuilds inside the generation; under another it is refused, with the SQL
 * that drops the source's index so it can be built afresh — this store does
 * not yet build a second generation beside the first. `completeBuild` records
 * the recipe hash; `indexStatus` answers both.
 *
 * ## Writes
 *
 * The adapter takes the service's passages (`capabilities.chunks`) and hashes
 * the text of each (`chunk_hash`). A passage whose hash is already stored is
 * not embedded again: its row's metadata is rewritten. Every embed call runs
 * before a connection is taken for the write, so no pooled connection waits on
 * the embedder.
 *
 * ## When the database is not ready
 *
 * Without the `vector` extension (and the right to create it), or without the
 * right to create the schema, the adapter creates nothing; every call answers
 * `SERVICE_UNAVAILABLE` with the SQL to run by hand, `healthCheck` answers
 * `ok: false`, and the next call tries again.
 */
export class PgvectorKnowledgeAdapter implements IKnowledgeAdapter {
  readonly id: string;
  readonly capabilities = { chunks: true } as const;
  private readonly pool?: PgPoolLike;
  private readonly unavailable?: string;
  private readonly resolveEmbedder: () => IEmbedder | undefined;
  private readonly schema: string;
  private readonly queryPrefix: string;
  private readiness?: Readiness;
  /** Widths whose passage table this adapter has created or found. */
  private readonly tables = new Set<number>();

  constructor(opts: PgvectorKnowledgeAdapterOptions) {
    this.id = opts.id ?? 'pgvector';
    this.pool = opts.pool;
    this.unavailable = opts.unavailable;
    const embedder = opts.embedder;
    this.resolveEmbedder = typeof embedder === 'function' ? embedder : () => embedder;
    this.schema = opts.schema ?? DEFAULT_KNOWLEDGE_SCHEMA;
    if (!SAFE_IDENTIFIER.test(this.schema)) {
      throw new Error(
        `knowledge-pgvector: schema '${this.schema}' is not a lower-case identifier (letters, digits, underscores).`,
      );
    }
    this.queryPrefix = opts.queryPrefix ?? '';
  }

  /** What the adapter reports about its embedder (ADR-0161 K8, item 6), read now. */
  get embedding(): AdapterEmbeddingDescriptor | undefined {
    const embedder = this.resolveEmbedder();
    if (!embedder) return undefined;
    return {
      dimensions: embedder.dimensions,
      ...(embedder.model === undefined ? {} : { model: embedder.model }),
      ...(embedder.maxInputTokens === undefined ? {} : { maxInputTokens: embedder.maxInputTokens }),
    };
  }

  async upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void> {
    if (docs.length === 0) return;
    const pool = this.requirePool();
    const readiness = await this.ready();
    const embedder = this.requireEmbedder();
    const generation = (await this.writeTarget(ctx, embedder, true))!;
    await this.ensureVectorTable(generation.dim, readiness);
    const table = qualified(this.schema, vectorTable(generation.dim));
    const sourceId = ctx.source.id;

    const planned = docs.map((doc) => ({
      doc,
      passages: passagesOf(doc).map((p) => ({ ...p, hash: chunkHash(p.content) })),
    }));
    const stored = new Map<string, string>();
    const existing = await pool.query<{ chunk_id: string; chunk_hash: string }>(
      `SELECT chunk_id, chunk_hash FROM ${table} WHERE source_id = $1 AND generation = $2 AND document_id = ANY($3::text[])`,
      [sourceId, generation.generation, docs.map((d) => d.id)],
    );
    for (const row of existing.rows) stored.set(row.chunk_id, row.chunk_hash);

    // Embed what changed, before any connection is taken for the write.
    const toEmbed = planned.flatMap((p) => p.passages).filter((p) => stored.get(p.id) !== p.hash);
    const vectors = toEmbed.length === 0 ? [] : await embedder.embed(toEmbed.map((p) => p.content));
    if (vectors.length !== toEmbed.length) {
      throw new Error(
        `knowledge-pgvector: the embedder answered ${vectors.length} vector(s) for ${toEmbed.length} passage(s); nothing was written.`,
      );
    }
    const vectorOf = new Map<string, number[]>();
    toEmbed.forEach((p, i) => {
      const v = vectors[i];
      if (!Array.isArray(v) || v.length !== generation.dim) {
        throw new Error(
          `knowledge-pgvector: the embedder answered a ${Array.isArray(v) ? v.length : 'missing'}-wide vector for ` +
            `passage '${p.id}', and this source's index holds ${generation.dim}-wide vectors; nothing was written.`,
        );
      }
      vectorOf.set(p.id, v);
    });

    await this.transaction(async (client) => {
      for (const { doc, passages } of planned) {
        await client.query(
          `DELETE FROM ${table} WHERE source_id = $1 AND generation = $2 AND document_id = $3 AND NOT (chunk_id = ANY($4::text[]))`,
          [sourceId, generation.generation, doc.id, passages.map((p) => p.id)],
        );
        for (const p of passages) {
          const common = [
            sourceId,
            generation.generation,
            p.id,
            doc.id,
            doc.sourceRecordId ?? null,
            doc.organizationId ?? null,
            p.content,
            doc.title ?? null,
            doc.docHash ?? null,
            p.hash,
            JSON.stringify(doc.metadata ?? {}),
            p.headingPath === undefined ? null : JSON.stringify(p.headingPath),
          ];
          const vector = vectorOf.get(p.id);
          if (vector === undefined) {
            // Unchanged text: the stored vector stands; the rest of the row is rewritten.
            await client.query(
              `UPDATE ${table} SET document_id = $4, source_record_id = $5, organization_id = $6, content = $7, title = $8,
                 doc_hash = $9, chunk_hash = $10, metadata = $11::jsonb, heading_path = $12::jsonb
               WHERE source_id = $1 AND generation = $2 AND chunk_id = $3`,
              common,
            );
          } else {
            await client.query(
              `INSERT INTO ${table} (source_id, generation, chunk_id, document_id, source_record_id, organization_id, content,
                 title, doc_hash, chunk_hash, metadata, heading_path, embedding)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::${readiness.extensionSchema}.vector)
               ON CONFLICT (source_id, generation, chunk_id) DO UPDATE SET document_id = EXCLUDED.document_id,
                 source_record_id = EXCLUDED.source_record_id, organization_id = EXCLUDED.organization_id,
                 content = EXCLUDED.content, title = EXCLUDED.title, doc_hash = EXCLUDED.doc_hash,
                 chunk_hash = EXCLUDED.chunk_hash, metadata = EXCLUDED.metadata, heading_path = EXCLUDED.heading_path,
                 embedding = EXCLUDED.embedding`,
              [...common, vectorLiteral(vector)],
            );
          }
        }
      }
    });
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    if (documentIds.length === 0) return;
    const pool = this.requirePool();
    await this.ready();
    // From every generation of the source: a removed document leaves them all.
    const widths = await pool.query<{ dim: number }>(
      `SELECT DISTINCT dim FROM ${qualified(this.schema, GENERATION_TABLE)} WHERE source_id = $1`,
      [ctx.source.id],
    );
    for (const { dim } of widths.rows) {
      if (!(await this.tableExists(Number(dim)))) continue;
      await pool.query(
        `DELETE FROM ${qualified(this.schema, vectorTable(Number(dim)))} WHERE source_id = $1 AND document_id = ANY($2::text[])`,
        [ctx.source.id, documentIds],
      );
    }
  }

  async listDocuments(ctx: AdapterContext, opts: AdapterListDocumentsOptions): Promise<AdapterListDocumentsPage> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new RangeError(`listDocuments: limit must be a positive integer, got ${String(opts.limit)}`);
    }
    const pool = this.requirePool();
    await this.ready();
    // The generation the writes go to (ADR-0161 K8, item 1).
    const generation = await this.writeTarget(ctx, undefined, false);
    if (!generation || !(await this.tableExists(generation.dim))) return { documents: [] };
    // In byte order ("C"), both the order and the cursor's comparison, so a
    // cursor stays valid whatever the database's collation.
    const params: unknown[] = [ctx.source.id, generation.generation, opts.limit + 1];
    const after = opts.cursor === undefined ? '' : `AND document_id COLLATE "C" > $4`;
    if (opts.cursor !== undefined) params.push(opts.cursor);
    const page = await pool.query<{ document_id: string; doc_hash: string | null }>(
      `SELECT document_id, max(doc_hash) AS doc_hash FROM ${qualified(this.schema, vectorTable(generation.dim))}
        WHERE source_id = $1 AND generation = $2 ${after}
        GROUP BY document_id ORDER BY document_id COLLATE "C" LIMIT $3`,
      params,
    );
    const rows = page.rows.slice(0, opts.limit);
    return {
      documents: rows.map((r) => (r.doc_hash === null ? { documentId: r.document_id } : { documentId: r.document_id, docHash: r.doc_hash })),
      ...(page.rows.length > opts.limit ? { nextCursor: rows[rows.length - 1].document_id } : {}),
    };
  }

  async search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]> {
    // An empty organization set ranks nothing (ADR-0161 K8, item 9).
    if (opts.organizationIds !== undefined && opts.organizationIds.length === 0) return [];
    const pool = this.requirePool();
    const readiness = await this.ready();
    const generation = await this.activeGeneration(opts.source.id);
    if (!generation) return [];
    // Vectors of two fingerprints are never ranked against each other (K7, rule 5).
    if (opts.index !== undefined && generation.fingerprint !== opts.index.fingerprint) {
      throw rebuildRequired(opts.source.id, this.dropSql(opts.source.id));
    }
    const embedder = this.requireEmbedder();
    if (embedder.dimensions !== generation.dim) throw rebuildRequired(opts.source.id, this.dropSql(opts.source.id));
    if (!(await this.tableExists(generation.dim))) return [];
    const topK = Math.max(0, Math.floor(opts.topK));
    if (topK === 0) return [];

    // The query is embedded before a connection is taken.
    const [vector] = await embedder.embed([`${this.queryPrefix}${query}`]);
    if (!Array.isArray(vector) || vector.length !== generation.dim) {
      throw new Error(
        `knowledge-pgvector: the embedder answered a ${Array.isArray(vector) ? vector.length : 'missing'}-wide query ` +
          `vector, and this source's index holds ${generation.dim}-wide vectors.`,
      );
    }
    if (vector.every((x) => x === 0)) return [];

    const ext = readiness.extensionSchema;
    const params: unknown[] = [opts.source.id, generation.generation, vectorLiteral(vector), topK];
    const where = ['source_id = $1', 'generation = $2'];
    if (opts.organizationIds !== undefined) {
      params.push(opts.organizationIds);
      where.push(`organization_id = ANY($${params.length}::text[])`);
    }
    for (const [key, value] of Object.entries(opts.filter ?? {})) {
      params.push(key, JSON.stringify(value === undefined ? null : value));
      where.push(`(metadata -> $${params.length - 1}) = $${params.length}::jsonb`);
    }
    const result = await pool.query<{
      chunk_id: string;
      document_id: string;
      source_record_id: string | null;
      content: string;
      title: string | null;
      metadata: Record<string, unknown> | null;
      distance: number;
    }>(
      `SELECT * FROM (
         SELECT chunk_id, document_id, source_record_id, content, title, metadata,
                embedding OPERATOR(${ext}.<=>) $3::${ext}.vector AS distance
           FROM ${qualified(this.schema, vectorTable(generation.dim))}
          WHERE ${where.join(' AND ')}
       ) ranked
       WHERE distance < 1
       ORDER BY distance, chunk_id
       LIMIT $4`,
      params,
    );
    return result.rows.map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      sourceId: opts.source.id,
      ...(r.source_record_id === null ? {} : { sourceRecordId: r.source_record_id }),
      score: 1 - Number(r.distance),
      snippet: r.content,
      ...(r.title === null ? {} : { title: r.title }),
      metadata: r.metadata ?? {},
    }));
  }

  async indexStatus(ctx: AdapterContext): Promise<AdapterIndexStatus> {
    this.requirePool();
    await this.ready();
    const generation = await this.activeGeneration(ctx.source.id);
    const status: AdapterIndexStatus = {};
    if (generation?.fingerprint != null) status.fingerprint = generation.fingerprint;
    if (generation?.recipe_hash != null) status.recipeHash = generation.recipe_hash;
    return status;
  }

  async beginBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'beginBuild');
    this.requirePool();
    await this.ready();
    const embedder = this.requireEmbedder();
    const generation = (await this.activeGeneration(ctx.source.id))
      ?? (await this.openFirstGeneration(ctx.source.id, index.fingerprint, embedder));
    if (generation.fingerprint === index.fingerprint && generation.dim === embedder.dimensions) return;
    throw Object.assign(
      new Error(
        `Knowledge source '${ctx.source.id}' was indexed under another fingerprint (embedding model, dimensions, ` +
          'split or content recipe changed), and this store does not yet build a second generation beside the ' +
          'first. Either restore the earlier embedding and split configuration, or drop the source\'s index and ' +
          `reindex it: ${this.dropSql(ctx.source.id)}`,
      ),
      { code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 },
    );
  }

  async completeBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'completeBuild');
    const pool = this.requirePool();
    await this.ready();
    const updated = await pool.query(
      `UPDATE ${qualified(this.schema, GENERATION_TABLE)} SET recipe_hash = $3
        WHERE source_id = $1 AND state = 'active' AND fingerprint = $2 RETURNING generation`,
      [ctx.source.id, index.fingerprint, index.recipeHash],
    );
    if (updated.rows.length === 0) {
      throw new Error(
        `completeBuild: source '${ctx.source.id}' holds no active generation under this fingerprint; call beginBuild first.`,
      );
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      this.requirePool();
      const r = await this.ready();
      return { ok: true, message: `pgvector ${r.version}, tables in schema '${this.schema}'` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private requirePool(): PgPoolLike {
    if (!this.pool) {
      throw notReady(this.unavailable ?? 'it has no PostgreSQL connection.', []);
    }
    return this.pool;
  }

  private requireEmbedder(): IEmbedder {
    const embedder = this.resolveEmbedder();
    if (!embedder) {
      throw Object.assign(
        new Error(
          'knowledge-pgvector has no embedder: register an embedder service (Settings → AI & Embedder) or pass ' +
            '`embedder` to the plugin. Passages are sent to that embedder\'s provider.',
        ),
        { code: 'SERVICE_UNAVAILABLE', status: 503 },
      );
    }
    return embedder;
  }

  /**
   * Make the store ready once: the `vector` extension (created when it is
   * missing and the connection may), then the schema and the generation
   * table. Until that succeeds nothing is created past the step that failed,
   * and the refusal carries the SQL to run by hand; the next call tries again.
   */
  private async ready(): Promise<Readiness> {
    if (this.readiness) return this.readiness;
    const pool = this.requirePool();
    const ddl = schemaDdl(this.schema);
    let ext: { schema: string; version: string } | undefined;
    try {
      ext = await this.findExtension(pool);
      if (!ext) {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        ext = await this.findExtension(pool);
      }
    } catch (err) {
      throw notReady(
        `the PostgreSQL 'vector' extension (pgvector) is not installed in this database, and this connection could not ` +
          `install it (${errorText(err)}).`,
        ['CREATE EXTENSION IF NOT EXISTS vector;', ...ddl.map((s) => `${s};`)],
      );
    }
    if (!ext) {
      throw notReady("the PostgreSQL 'vector' extension (pgvector) is not installed in this database.", [
        'CREATE EXTENSION IF NOT EXISTS vector;',
        ...ddl.map((s) => `${s};`),
      ]);
    }
    try {
      for (const statement of ddl) await pool.query(statement);
    } catch (err) {
      throw notReady(
        `its schema '${this.schema}' and generation table could not be created (${errorText(err)}).`,
        ddl.map((s) => `${s};`),
      );
    }
    this.readiness = { extensionSchema: `"${ext.schema}"`, version: ext.version };
    return this.readiness;
  }

  private async findExtension(pool: PgPoolLike): Promise<{ schema: string; version: string } | undefined> {
    const found = await pool.query<{ schema: string; version: string }>(
      `SELECT n.nspname AS schema, e.extversion AS version
         FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'vector'`,
    );
    return found.rows[0];
  }

  private async ensureVectorTable(dimensions: number, readiness: Readiness): Promise<void> {
    if (this.tables.has(dimensions)) return;
    const pool = this.requirePool();
    const ddl = vectorTableDdl(this.schema, dimensions, `${readiness.extensionSchema}.vector`);
    try {
      for (const statement of ddl) await pool.query(statement);
    } catch (err) {
      throw notReady(
        `its ${dimensions}-wide passage table could not be created (${errorText(err)}).`,
        ddl.map((s) => `${s};`),
      );
    }
    this.tables.add(dimensions);
  }

  private async tableExists(dimensions: number): Promise<boolean> {
    if (this.tables.has(dimensions)) return true;
    const found = await this.requirePool().query<{ present: string | null }>(
      'SELECT to_regclass($1) AS present',
      [qualified(this.schema, vectorTable(dimensions))],
    );
    const present = found.rows[0]?.present != null;
    if (present) this.tables.add(dimensions);
    return present;
  }

  private async activeGeneration(sourceId: string): Promise<GenerationRow | undefined> {
    const found = await this.requirePool().query<GenerationRow>(
      `SELECT generation, fingerprint, recipe_hash, dim FROM ${qualified(this.schema, GENERATION_TABLE)}
        WHERE source_id = $1 AND state = 'active' ORDER BY generation DESC LIMIT 1`,
      [sourceId],
    );
    const row = found.rows[0];
    return row === undefined ? undefined : { ...row, generation: Number(row.generation), dim: Number(row.dim) };
  }

  /** A source that holds nothing takes the first fingerprint it is handed (there is nothing to mix with). */
  private async openFirstGeneration(sourceId: string, fingerprint: string | undefined, embedder: IEmbedder): Promise<GenerationRow> {
    await this.requirePool().query(
      `INSERT INTO ${qualified(this.schema, GENERATION_TABLE)} (source_id, generation, fingerprint, dim, model, state)
       VALUES ($1, 1, $2, $3, $4, 'active') ON CONFLICT (source_id, generation) DO NOTHING`,
      [sourceId, fingerprint ?? null, embedder.dimensions, embedder.model ?? null],
    );
    return (await this.activeGeneration(sourceId))!;
  }

  /**
   * The generation a write carrying `ctx.index` goes to: the active one, when
   * its fingerprint is the one carried (or none is carried); refused when it is
   * another, or when the embedder's width is not the generation's. A source
   * that holds nothing gets its first generation (`create`), or none.
   */
  private async writeTarget(
    ctx: AdapterContext,
    embedder: IEmbedder | undefined,
    create: boolean,
  ): Promise<GenerationRow | undefined> {
    const active = await this.activeGeneration(ctx.source.id);
    if (!active) {
      if (!create || !embedder) return undefined;
      const opened = await this.openFirstGeneration(ctx.source.id, ctx.index?.fingerprint, embedder);
      return this.checkTarget(ctx, opened, embedder);
    }
    return this.checkTarget(ctx, active, embedder);
  }

  private checkTarget(ctx: AdapterContext, generation: GenerationRow, embedder: IEmbedder | undefined): GenerationRow {
    const fingerprint = ctx.index?.fingerprint;
    if (fingerprint !== undefined && generation.fingerprint !== fingerprint) {
      throw rebuildRequired(ctx.source.id, this.dropSql(ctx.source.id));
    }
    if (embedder !== undefined && embedder.dimensions !== generation.dim) {
      throw rebuildRequired(ctx.source.id, this.dropSql(ctx.source.id));
    }
    return generation;
  }

  /** The SQL that drops everything this store holds for a source, so it can be built afresh. */
  private dropSql(sourceId: string): string {
    const literal = `'${sourceId.replace(/'/g, "''")}'`;
    return (
      `DELETE FROM ${qualified(this.schema, GENERATION_TABLE)} WHERE source_id = ${literal}; ` +
      `and from each ${qualified(this.schema, 'knowledge_vec_d<width>')} table, DELETE ... WHERE source_id = ${literal};`
    );
  }

  private async transaction(work: (client: PgClientLike) => Promise<void>): Promise<void> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
      client.release();
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release(err instanceof Error ? err : true);
      throw err;
    }
  }
}

/** The passages of a document: the service's `chunks`, or the whole text as one. Empty passages are not stored. */
function passagesOf(doc: KnowledgeDocument): Array<{ id: string; content: string; headingPath?: string[] }> {
  const passages: Array<{ id: string; content: string; headingPath?: string[] }> =
    doc.chunks ?? [{ id: `${doc.id}#0`, content: doc.content }];
  return passages
    .filter((p) => p.content.trim() !== '')
    .map((p) => ({ id: p.id, content: p.content, ...(p.headingPath === undefined ? {} : { headingPath: p.headingPath }) }));
}

/** The hash of the text the adapter embeds for a passage. */
function chunkHash(text: string): string {
  return `c1:${createHash('sha256').update(text).digest('hex')}`;
}

function requireIndex(ctx: AdapterContext, member: string): NonNullable<AdapterContext['index']> {
  if (ctx.index === undefined) {
    throw new Error(`${member}: the call carries no index fingerprint (ctx.index); it is made by the knowledge service.`);
  }
  return ctx.index;
}

function rebuildRequired(sourceId: string, dropSql: string): Error {
  return Object.assign(
    new Error(
      `Knowledge source '${sourceId}' needs a rebuild: its index was built under another fingerprint (embedding ` +
        'model, dimensions, split or content recipe changed), and its stored vectors are not compared with new ' +
        `ones. Run a complete reindex of the source; if the store refuses to begin it, drop its index first: ${dropSql}`,
    ),
    { code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 },
  );
}

function notReady(reason: string, sql: string[]): Error {
  const remedy = sql.length === 0 ? '' : ` Run as a database owner, then retry (no restart needed):\n${sql.join('\n')}`;
  return Object.assign(new Error(`knowledge-pgvector is not ready: ${reason}${remedy}`), {
    code: 'SERVICE_UNAVAILABLE',
    status: 503,
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
