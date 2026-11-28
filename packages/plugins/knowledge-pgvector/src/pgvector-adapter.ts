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
  type GenerationState,
  PASSAGE_TSVECTOR,
  SAFE_IDENTIFIER,
  TS_CONFIG,
  containsPattern,
  isWordTerm,
  keywordIndexDdl,
  keywordIndexName,
  keywordTerms,
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
  /**
   * A connection of its own, outside the pool, which `release` closes. A build
   * holds its source's builder lock (a session advisory lock) on one for as
   * long as it runs, so a long build never takes a pooled connection from the
   * writes. Absent: the lock is held on a pooled connection from `connect`.
   */
  connectSession?(): Promise<PgClientLike>;
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
  /**
   * How long a build may go without a call of its own (a call whose
   * `ctx.reason` is `'reindex'`: the listing, a page written, a removal)
   * before its builder lock is let go, so a build that stopped part-way on a
   * process that keeps running does not keep every other process from
   * building the source. Event-sync writes do not count as progress. A process
   * that stops lets go at once. @default 900000 (15 minutes)
   */
  buildLockIdleMs?: number;
  /** How many passage rows of a replaced generation one DELETE removes. @default 1000 */
  deleteBatchSize?: number;
  /** Where the adapter reports what it cannot hand to a caller: an old generation it could not delete. */
  logger?: { warn?(message: string): void };
}

/** The ADR-0112 code of a write or a search refused under another fingerprint (ADR-0161 K7, rules 4 and 5). */
export const KNOWLEDGE_REBUILD_REQUIRED = 'KNOWLEDGE_REBUILD_REQUIRED';

/** The standard ADR-0112 code of a build refused because another process is building the source. */
const LOCK_CONFLICT = 'LOCK_CONFLICT';

/** How many times {@link PgvectorKnowledgeAdapter.upsert} plans a batch again when a concurrent write removed a passage it meant to keep. */
const UPSERT_ATTEMPTS = 3;

/** How many times {@link PgvectorKnowledgeAdapter.search} runs again when the active generation was switched under it. */
const SEARCH_ATTEMPTS = 3;

/** The standard ADR-0112 code of a search whose source's index was switched under it on every attempt. */
const CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION';

/** The `k` of reciprocal rank fusion: a passage at rank `r` of a leg adds `1 / (k + r)` to its score. */
export const RRF_K = 60;

/** A generation row: one complete index of one source under one fingerprint. */
interface GenerationRow {
  generation: number;
  fingerprint: string | null;
  recipe_hash: string | null;
  dim: number;
  state: GenerationState;
}

/** A source's generations: the active one, the one under construction, and those being deleted. */
interface SourceGenerations {
  active?: GenerationRow;
  building?: GenerationRow;
  retired: GenerationRow[];
}

/** A source's builder lock this adapter holds: the session it is held on, its key, and its idle timer. */
interface BuilderLock {
  client: PgClientLike;
  key: string;
  timer?: ReturnType<typeof setTimeout>;
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
 * Two legs, merged by reciprocal rank fusion (`k` = {@link RRF_K}) before the
 * knowledge service re-checks each hit as the caller. Each leg ranks at most
 * `topK` passages; a passage's score is the sum of `1 / (k + rank)` over the
 * legs that rank it, divided by the score of a passage first in both, so it
 * lies in `(0, 1]`. Both legs run in one statement, so in one snapshot.
 *
 * - The vector leg: an exact scan by cosine distance — no approximate index,
 *   so a 3072-wide model works (pgvector's HNSW index stops at 2000
 *   dimensions; adding one is an operator's step, documented with the
 *   package). A passage whose cosine similarity is not positive is not ranked
 *   by it.
 * - The keyword leg: the query's terms (`keywordTerms`). A word of three
 *   characters or more is matched as a phrase (`phraseto_tsquery`) on the
 *   passage's `simple` `tsvector`, which a GIN expression index serves; a
 *   shorter term (「出差」), or one holding a Han, kana or Hangul character —
 *   which the parser never splits, so a `tsvector` holds the whole run as one
 *   word — by `ILIKE` over the rows in scope. A passage's keyword score sums,
 *   over the terms it holds, the term's BM25 inverse document frequency among
 *   the rows in scope, so a term most passages hold weighs little.
 *
 * The organization filter (ADR-0161 K8, item 9), the record scope (item 17)
 * and the metadata-equality `filter` are one `WHERE`, run in both legs before
 * either ranks. The keyword index of a passage table made before it existed
 * is made by the first call that writes or searches that table.
 *
 * ## Generations (ADR-0161 K7; K8, item 8)
 *
 * A generation row holds the fingerprint its passages were built under. A
 * source holds one `active` generation, the one searched, and, while a build
 * under another fingerprint runs, one `building` generation beside it — one
 * of each per source, by two unique indexes. A source that holds nothing
 * takes the first fingerprint it is handed as its active one, and passage
 * rows of the source left without a generation row are deleted as any
 * generation opens: a generation never adopts vectors of another fingerprint.
 *
 * - `beginBuild` takes the source's builder lock (below), then: under the
 *   active fingerprint it rebuilds inside the active generation; under the
 *   fingerprint of the generation under construction it takes that one up
 *   with what it already holds (a build is RESUMABLE: the walk skips every
 *   document whose hash the new generation already holds); under a third it
 *   retires the one under construction and opens a new one.
 * - A write carrying `ctx.index` goes to the generation of that fingerprint:
 *   during a build, event-sync writes carry the new fingerprint and land in
 *   the new generation only. A write whose fingerprint neither holds is
 *   refused `KNOWLEDGE_REBUILD_REQUIRED`, and nothing is written to the
 *   active generation under another fingerprint.
 * - A search carrying another fingerprint than the active one's is refused
 *   `KNOWLEDGE_REBUILD_REQUIRED` and never answered from the active
 *   generation; while the generation of the searched fingerprint is under
 *   construction, the refusal says the source is being rebuilt.
 * - `completeBuild`, after the walk and its purge, makes the generation under
 *   construction active and the old one `retired` in one transaction, then
 *   deletes the retired generation's passages in batches
 *   ({@link PgvectorKnowledgeAdapterOptions.deleteBatchSize} rows per
 *   statement) and its row last. A deletion that stops part-way is finished
 *   by the source's next build; a retired generation is never searched.
 *   Under the active fingerprint it records the recipe hash.
 *
 * ## One builder per source
 *
 * `beginBuild` takes a PostgreSQL session advisory lock on the source (a key
 * hashed from the schema and the source id), on a connection of its own
 * ({@link PgPoolLike.connectSession}), and holds it until `completeBuild`.
 * A second `beginBuild` from another process is refused `LOCK_CONFLICT`
 * (409) and its walk does not run. The lock goes when the build completes,
 * when the process or its connection dies (PostgreSQL frees it), or after
 * {@link PgvectorKnowledgeAdapterOptions.buildLockIdleMs} without a call of
 * the build (event-sync writes do not count), so a walk that failed on a
 * running process does not hold it. A session advisory lock belongs to one
 * server session: the store needs a direct or session-mode connection, never
 * a transaction-mode pooler; a release the session no longer held is logged.
 * The knowledge service runs one walk of a source at a time, so a lock this
 * adapter still holds when it begins a build again is the earlier build's,
 * and is kept for the new one.
 *
 * ## Writes
 *
 * The adapter takes the service's passages (`capabilities.chunks`) and hashes
 * the text of each (`chunk_hash`). A passage whose hash is already stored is
 * not embedded again: its row's metadata is rewritten; when that row is gone
 * by the time the write runs (a concurrent write removed it), the batch is
 * planned again, so the passage is embedded rather than lost. Every embed call
 * runs before a connection is taken for the write, so no pooled connection
 * waits on the embedder.
 *
 * ## When the database is not ready
 *
 * Without the `vector` extension (and the right to create it), or without the
 * right to create the schema, the adapter creates nothing; every call answers
 * `SERVICE_UNAVAILABLE`, `healthCheck` answers `ok: false` with the SQL to run
 * by hand, and the next call tries again. A database it cannot reach is
 * reported as unreachable, with no SQL.
 *
 * ## What a caller reads
 *
 * A refusal's message is one sentence: no driver text, no SQL, no schema
 * name. Operator text travels in the error's `remedy`, which `healthCheck`,
 * the plugin's boot warning and the knowledge service's reindex result and
 * log show.
 */
export class PgvectorKnowledgeAdapter implements IKnowledgeAdapter {
  readonly id: string;
  readonly capabilities = { chunks: true } as const;
  private readonly pool?: PgPoolLike;
  private readonly unavailable?: string;
  private readonly resolveEmbedder: () => IEmbedder | undefined;
  private readonly schema: string;
  private readonly queryPrefix: string;
  private readonly buildLockIdleMs: number;
  private readonly deleteBatchSize: number;
  private readonly logger?: { warn?(message: string): void };
  private readiness?: Readiness;
  /** Widths whose passage table this adapter has created or found. */
  private readonly tables = new Set<number>();
  /** Widths whose passage table's keyword index this adapter has created or found. */
  private readonly keyed = new Set<number>();
  /** The builder locks this adapter holds, by source id. */
  private readonly builders = new Map<string, BuilderLock>();
  /**
   * The builds this adapter began and has not ended, by source id: the
   * generation each one builds into. A build's writes, removals and
   * completion are refused once its lock is gone (the fence).
   */
  private readonly builds = new Map<string, number>();

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
    this.buildLockIdleMs = opts.buildLockIdleMs ?? 15 * 60 * 1000;
    this.deleteBatchSize = opts.deleteBatchSize ?? 1000;
    if (!Number.isInteger(this.deleteBatchSize) || this.deleteBatchSize < 1) {
      throw new RangeError(`knowledge-pgvector: deleteBatchSize must be a positive integer, got ${String(opts.deleteBatchSize)}`);
    }
    this.logger = opts.logger;
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
    this.requirePool();
    const readiness = await this.ready();
    const embedder = this.requireEmbedder();
    // A build's page is embedded only while its builder lock holds.
    await this.fenceBuild(ctx);
    this.touchBuilderLock(ctx);
    // An unchanged passage is rewritten in place, keeping its vector. When its
    // row is gone by the time the write runs (a concurrent rewrite of the same
    // document removed it), or its generation was switched or retired, the
    // write is rolled back and planned again, so the passage is embedded and
    // inserted, into the generation that holds the fingerprint now, rather
    // than lost.
    for (let attempt = 1; ; attempt++) {
      const generation = (await this.writeTarget(ctx, embedder, true))!;
      await this.ensureVectorTable(generation.dim, readiness);
      const missing = await this.writePassages(docs, ctx.source.name, generation, readiness, embedder);
      if (missing === undefined) return;
      if (attempt >= UPSERT_ATTEMPTS) {
        throw new Error(
          `knowledge-pgvector: ${missing} of source '${ctx.source.name}' was removed by a concurrent write ` +
            `${UPSERT_ATTEMPTS} times while this write ran; nothing of this batch was written. Retry the write.`,
        );
      }
    }
  }

  /**
   * One attempt of {@link upsert}: read the stored chunk hashes, embed what
   * changed, write in one transaction. Answers `undefined` when written, or
   * what was gone (the transaction is rolled back): an unchanged passage's
   * row, or the generation itself, retired or replaced while the embedder
   * answered. The generation row is share-locked for the transaction, so a
   * switch or a retirement waits for the write and the batched deletion that
   * follows it sees every row the write put there.
   */
  private async writePassages(
    docs: KnowledgeDocument[],
    sourceId: string,
    generation: GenerationRow,
    readiness: Readiness,
    embedder: IEmbedder,
  ): Promise<string | undefined> {
    const pool = this.requirePool();
    const table = qualified(this.schema, vectorTable(generation.dim));

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

    let missing: string | undefined;
    const written = await this.transaction(async (client) => {
      const target = await client.query(
        `SELECT 1 FROM ${qualified(this.schema, GENERATION_TABLE)}
          WHERE source_id = $1 AND generation = $2 AND fingerprint IS NOT DISTINCT FROM $3 AND dim = $4
            AND state IN ('active', 'building')
          FOR SHARE`,
        [sourceId, generation.generation, generation.fingerprint, generation.dim],
      );
      if (target.rows.length === 0) {
        missing = `generation ${generation.generation}`;
        return false;
      }
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
            const updated = await client.query(
              `UPDATE ${table} SET document_id = $4, source_record_id = $5, organization_id = $6, content = $7, title = $8,
                 doc_hash = $9, chunk_hash = $10, metadata = $11::jsonb, heading_path = $12::jsonb
               WHERE source_id = $1 AND generation = $2 AND chunk_id = $3 AND chunk_hash = $10
               RETURNING chunk_id`,
              common,
            );
            if (updated.rows.length === 0) {
              missing = `passage '${p.id}'`;
              return false;
            }
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
      return true;
    });
    return written ? undefined : missing;
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    if (documentIds.length === 0) return;
    const pool = this.requirePool();
    await this.ready();
    await this.fenceBuild(ctx);
    this.touchBuilderLock(ctx);
    // From every generation of the source: a removed document leaves them all.
    const widths = await pool.query<{ dim: number }>(
      `SELECT DISTINCT dim FROM ${qualified(this.schema, GENERATION_TABLE)} WHERE source_id = $1`,
      [ctx.source.name],
    );
    for (const { dim } of widths.rows) {
      if (!(await this.tableExists(Number(dim)))) continue;
      await pool.query(
        `DELETE FROM ${qualified(this.schema, vectorTable(Number(dim)))} WHERE source_id = $1 AND document_id = ANY($2::text[])`,
        [ctx.source.name, documentIds],
      );
    }
  }

  async listDocuments(ctx: AdapterContext, opts: AdapterListDocumentsOptions): Promise<AdapterListDocumentsPage> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new RangeError(`listDocuments: limit must be a positive integer, got ${String(opts.limit)}`);
    }
    const pool = this.requirePool();
    await this.ready();
    // The embedder first, as on every other call: without one the service's
    // fingerprint carries no model or width, and comparing it would refuse a
    // healthy index as one to rebuild. No embedder is SERVICE_UNAVAILABLE.
    const embedder = this.requireEmbedder();
    this.touchBuilderLock(ctx);
    // The generation the writes go to (ADR-0161 K8, item 1): during a build,
    // the one under construction, so the walk skips what it already holds.
    const generation = await this.writeTarget(ctx, embedder, false);
    if (!generation || !(await this.tableExists(generation.dim))) return { documents: [] };
    // In byte order ("C"), both the order and the cursor's comparison, so a
    // cursor stays valid whatever the database's collation.
    const params: unknown[] = [ctx.source.name, generation.generation, opts.limit + 1];
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
    // A record scope with no term that has ids ranks nothing (ADR-0161 K8, item 17).
    if (opts.scope !== undefined && !opts.scope.some((term) => term.ids.length > 0)) return [];
    for (let attempt = 1; ; attempt++) {
      const hits = await this.searchAttempt(query, opts);
      if (hits !== undefined) return hits;
      if (attempt >= SEARCH_ATTEMPTS) {
        throw Object.assign(
          new Error(
            `Knowledge source '${opts.source.name}' switched to a newly built index ${SEARCH_ATTEMPTS} times during one search; retry it.`,
          ),
          { code: CONCURRENT_MODIFICATION, status: 409 },
        );
      }
    }
  }

  /**
   * One attempt of {@link search}. Answers `undefined` when the generation it
   * ranked was switched out by a completed build between the read of the
   * generations and the ranking (the ranking statement holds only while its
   * generation is the active one, so it never reads a generation whose
   * passages are being deleted).
   */
  private async searchAttempt(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[] | undefined> {
    const pool = this.requirePool();
    const readiness = await this.ready();
    // The embedder first: without one the service's fingerprint carries no
    // model or width, and comparing it would refuse a healthy index as one to
    // rebuild. No embedder is SERVICE_UNAVAILABLE, as on every other call.
    const embedder = this.requireEmbedder();
    const { active: generation, building } = await this.generations(opts.source.name);
    if (!generation) return [];
    // Vectors of two fingerprints are never ranked against each other (K7,
    // rule 5); while the searched fingerprint's generation is being built, the
    // refusal says so.
    const searched = opts.index?.fingerprint;
    if (searched !== undefined && generation.fingerprint !== searched) {
      throw rebuildRequired(opts.source.name, building !== undefined && building.fingerprint === searched);
    }
    if (embedder.dimensions !== generation.dim) {
      throw rebuildRequired(opts.source.name, building !== undefined && building.dim === embedder.dimensions);
    }
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
    const vectorLeg = !vector.every((x) => x === 0);
    const terms = keywordTerms(query);
    if (!vectorLeg && terms.length === 0) return [];
    if (terms.length > 0) await this.ensureKeywordIndex(generation.dim);

    const ext = readiness.extensionSchema;
    const table = qualified(this.schema, vectorTable(generation.dim));
    // One WHERE for both legs: the source's active generation, the
    // organization filter, the record scope and the metadata filter, each
    // bound as values.
    const params: unknown[] = [opts.source.name, generation.generation];
    const where = [
      'source_id = $1',
      'generation = $2',
      // Holds only while the generation is the active one: a completed build
      // retires it and then deletes its passages, after this statement's
      // snapshot or before it, never inside it.
      `EXISTS (SELECT 1 FROM ${qualified(this.schema, GENERATION_TABLE)} g
                WHERE g.source_id = $1 AND g.generation = $2 AND g.state = 'active')`,
    ];
    if (opts.organizationIds !== undefined) {
      params.push(opts.organizationIds);
      where.push(`organization_id = ANY($${params.length}::text[])`);
    }
    if (opts.scope !== undefined) {
      // The record scope (ADR-0161 K8, item 17), a union of terms, beside the
      // organization filter so `topK` is filled from in-scope documents. Ids
      // and field names go as bound parameters. A `metadata` term holds for a
      // stored string or number equal to an id as text, or a list with such an
      // element; a missing value or any other kind holds for nothing.
      const scopeTerms: string[] = [];
      for (const term of opts.scope) {
        if (term.ids.length === 0) continue;
        params.push(term.ids);
        const ids = `$${params.length}::text[]`;
        if (term.kind === 'record') {
          scopeTerms.push(`source_record_id = ANY(${ids})`);
          continue;
        }
        params.push(term.field);
        const value = `(metadata -> $${params.length}::text)`;
        scopeTerms.push(
          `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE jsonb_typeof(${value}) WHEN 'array' THEN ${value} ` +
            `ELSE jsonb_build_array(${value}) END) AS e(v) ` +
            `WHERE jsonb_typeof(e.v) IN ('string', 'number') AND e.v #>> '{}' = ANY(${ids}))`,
        );
      }
      where.push(`(${scopeTerms.join(' OR ')})`);
    }
    for (const [key, value] of Object.entries(opts.filter ?? {})) {
      params.push(key, JSON.stringify(value === undefined ? null : value));
      where.push(`(metadata -> $${params.length - 1}) = $${params.length}::jsonb`);
    }
    const inScope = where.join(' AND ');
    params.push(topK);
    const limit = `$${params.length}`;

    const ctes: string[] = [];
    const legs: string[] = [];
    let vectorParam = 0;
    if (vectorLeg) {
      params.push(vectorLiteral(vector));
      vectorParam = params.length;
      ctes.push(`vec AS (
        SELECT chunk_id, row_number() OVER (ORDER BY distance, chunk_id) AS pos FROM (
          SELECT chunk_id, embedding OPERATOR(${ext}.<=>) $${params.length}::${ext}.vector AS distance
            FROM ${table} WHERE ${inScope}
        ) ranked WHERE distance < 1 ORDER BY distance, chunk_id LIMIT ${limit})`);
      legs.push('SELECT chunk_id, pos AS vpos, NULL::bigint AS kpos FROM vec');
    }
    if (terms.length > 0) {
      // A term's match, written twice: on the row's columns where the index
      // can serve it, and on the candidate's tsvector, computed once per row.
      const onRow: string[] = [];
      const onCandidate: string[] = [];
      for (const term of terms) {
        if (isWordTerm(term)) {
          params.push(term);
          const query = `phraseto_tsquery(${TS_CONFIG}, $${params.length}::text)`;
          onRow.push(`${PASSAGE_TSVECTOR} @@ ${query}`);
          onCandidate.push(`v.tsv @@ ${query}`);
        } else {
          params.push(containsPattern(term));
          onRow.push(`content ILIKE $${params.length}::text`);
          onCandidate.push(`c.content ILIKE $${params.length}::text`);
        }
      }
      const idf = onCandidate
        .map((_, i) => `h.h${i} * ln(1.0 + (s.n - s.d${i} + 0.5) / (s.d${i} + 0.5))`)
        .join(' + ');
      ctes.push(
        // Passages of equal keyword score are ranked by cosine distance, so the
        // keyword leg never reorders by chunk id what the vector leg ranks.
        `cand AS (SELECT chunk_id, content, ${vectorLeg ? `embedding OPERATOR(${ext}.<=>) $${vectorParam}::${ext}.vector` : '0'} AS distance
                    FROM ${table} WHERE ${inScope} AND (${onRow.join(' OR ')}))`,
        `hits AS (SELECT c.chunk_id, c.distance, ${onCandidate.map((m, i) => `(${m})::int AS h${i}`).join(', ')}
                    FROM cand c CROSS JOIN LATERAL (SELECT ${PASSAGE_TSVECTOR.replace('content', 'c.content')} AS tsv) v)`,
        `stats AS (SELECT (SELECT count(*) FROM ${table} WHERE ${inScope}) AS n,
                    ${onCandidate.map((_, i) => `coalesce(sum(h${i}), 0) AS d${i}`).join(', ')} FROM hits)`,
        `kw AS (
          SELECT chunk_id, row_number() OVER (ORDER BY score DESC, distance, chunk_id) AS pos FROM (
            SELECT h.chunk_id, h.distance, ${idf} AS score FROM hits h CROSS JOIN stats s
          ) scored ORDER BY score DESC, distance, chunk_id LIMIT ${limit})`,
      );
      legs.push('SELECT chunk_id, NULL::bigint AS vpos, pos AS kpos FROM kw');
    }
    const result = await pool.query<{
      chunk_id: string;
      document_id: string;
      source_record_id: string | null;
      content: string;
      title: string | null;
      metadata: Record<string, unknown> | null;
      doc_hash: string | null;
      heading_path: string[] | null;
      vpos: string | number | null;
      kpos: string | number | null;
    }>(
      `WITH ${ctes.join(',\n')}
       SELECT p.chunk_id, p.document_id, p.source_record_id, p.content, p.title, p.metadata, p.doc_hash,
              p.heading_path, u.vpos, u.kpos
         FROM (SELECT chunk_id, min(vpos) AS vpos, min(kpos) AS kpos FROM (${legs.join(' UNION ALL ')}) l
                GROUP BY chunk_id) u
         JOIN ${table} p ON p.source_id = $1 AND p.generation = $2 AND p.chunk_id = u.chunk_id`,
      params,
    );
    if (result.rows.length === 0) {
      // No hit, or a generation switched out meanwhile: read which.
      const now = await this.generations(opts.source.name);
      if (now.active?.generation !== generation.generation) return undefined;
    }
    return fuse(result.rows, topK).map(({ row: r, score }) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      sourceId: opts.source.name,
      ...(r.source_record_id === null ? {} : { sourceRecordId: r.source_record_id }),
      score,
      snippet: r.content,
      ...(r.title === null ? {} : { title: r.title }),
      metadata: r.metadata ?? {},
      // The stored hash, as given (ADR-0161 K8, item 3): the service's
      // record-level freshness check compares it with the record as it reads now.
      ...(r.doc_hash === null ? {} : { docHash: r.doc_hash }),
      // The passage's heading path, when the splitter gave it one (item 14).
      ...(Array.isArray(r.heading_path) ? { headingPath: r.heading_path } : {}),
    }));
  }

  async indexStatus(ctx: AdapterContext): Promise<AdapterIndexStatus> {
    this.requirePool();
    await this.ready();
    const { active, building } = await this.generations(ctx.source.name);
    const status: AdapterIndexStatus = {};
    if (active?.fingerprint != null) status.fingerprint = active.fingerprint;
    if (active?.recipe_hash != null) status.recipeHash = active.recipe_hash;
    if (building !== undefined) status.building = true;
    return status;
  }

  /**
   * The start of a complete build (ADR-0161 K7, rule 3). Takes the source's
   * builder lock — refused `LOCK_CONFLICT` while another process holds it —
   * then rebuilds inside the active generation, takes up the generation under
   * construction for this fingerprint (resumed: what it holds is kept), or
   * opens one beside the active generation. A generation under construction
   * for another fingerprint is abandoned: retired, and deleted in batches —
   * also when the fingerprint went back to the active one's, so a reverted
   * change leaves no generation behind. So is any generation a switch left
   * retired. The generation taken is the one this build writes into and
   * completes.
   */
  async beginBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'beginBuild');
    this.requirePool();
    const readiness = await this.ready();
    const embedder = this.requireEmbedder();
    const sourceId = ctx.source.name;
    await this.takeBuilderLock(sourceId);
    try {
      const target = await this.inTransaction(async (client) => {
        const { active, building } = await this.generations(sourceId, client, true);
        const fits = (g: GenerationRow | undefined): boolean =>
          g !== undefined && g.fingerprint === index.fingerprint && g.dim === embedder.dimensions;
        if (building !== undefined && fits(building)) return building;
        // A build of another fingerprint left unfinished: abandoned, one per source.
        if (building !== undefined) await this.retire(client, sourceId, building.generation);
        if (active !== undefined && fits(active)) return active;
        // A source that holds nothing takes the fingerprint as its active one;
        // beside an active generation, the new one is built aside.
        return this.openGeneration(client, sourceId, index.fingerprint, embedder, active === undefined ? 'active' : 'building');
      });
      await this.ensureVectorTable(target.dim, readiness);
      await this.sweepRetired(sourceId);
      this.builds.set(sourceId, target.generation);
    } catch (err) {
      this.builds.delete(sourceId);
      await this.releaseBuilderLock(sourceId);
      throw err;
    }
  }

  /**
   * The end of a complete build (ADR-0161 K8, item 8 c), called after the walk
   * and its purge. The generation built under `ctx.index.fingerprint` becomes
   * the active one and records the recipe hash; the generation it replaces is
   * retired in the same transaction, then its passages are deleted in batches
   * and its row last. Under the active fingerprint, the recipe hash is
   * recorded. The builder lock is let go either way.
   *
   * Only the build this adapter began completes, and only the generation it
   * began: a build whose builder lock is gone (let go after its idle time, or
   * its session ended), whose generation was dropped (`dropSource`, in any
   * process), or whose generation is no longer the one under this
   * fingerprint, is refused `LOCK_CONFLICT` (409) and switches, records and
   * deletes nothing — another process may have taken the source up since.
   */
  async completeBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'completeBuild');
    this.requirePool();
    await this.ready();
    const sourceId = ctx.source.name;
    try {
      const mine = this.builds.get(sourceId);
      if (mine === undefined || !(await this.holdsBuilderLock(sourceId))) throw builderLost(sourceId);
      await this.inTransaction(async (client) => {
        const { active, building } = await this.generations(sourceId, client, true);
        const t = qualified(this.schema, GENERATION_TABLE);
        // The generation this build began is gone (the source was dropped) or
        // is no longer the one under this fingerprint (another build replaced it).
        if (active?.generation !== mine && building?.generation !== mine) throw buildEnded(sourceId);
        const target =
          building !== undefined && building.fingerprint === index.fingerprint
            ? building
            : active !== undefined && active.fingerprint === index.fingerprint ? active : undefined;
        if (target !== undefined && target.generation !== mine) throw buildEnded(sourceId);
        if (building !== undefined && building.fingerprint === index.fingerprint) {
          // The switch: one statement retires the old generation, the next
          // makes the new one active (one active row per source at a time).
          if (active) await this.retire(client, sourceId, active.generation);
          await client.query(`UPDATE ${t} SET state = 'active', recipe_hash = $3 WHERE source_id = $1 AND generation = $2`, [
            sourceId,
            building.generation,
            index.recipeHash,
          ]);
          return;
        }
        if (active !== undefined && active.fingerprint === index.fingerprint) {
          await client.query(`UPDATE ${t} SET recipe_hash = $3 WHERE source_id = $1 AND generation = $2`, [
            sourceId,
            active.generation,
            index.recipeHash,
          ]);
          return;
        }
        throw new Error(
          `completeBuild: source '${sourceId}' holds no generation under this fingerprint; call beginBuild first.`,
        );
      });
      try {
        await this.sweepRetired(sourceId);
      } catch (err) {
        // The switch is recorded and the old generation is never searched
        // again; only its rows are left. Not the caller's failure.
        this.logger?.warn?.(
          `knowledge-pgvector: the replaced index of source '${sourceId}' was not fully deleted (${errorText(err)}); ` +
            'it is never searched, and the source\'s next build deletes the rest.',
        );
      }
    } finally {
      this.builds.delete(sourceId);
      await this.releaseBuilderLock(sourceId);
    }
  }

  /**
   * Everything held for the source is removed (ADR-0161 K8, item 4). Every
   * generation — the active one, and one under construction — is retired in
   * one transaction, so from its commit no search and no write finds one;
   * then the passages are deleted in batches and each generation row last, as
   * a replaced generation's are. A builder lock this adapter holds for the
   * source is let go. A source it holds nothing for is no error. A drop that
   * stops after the commit leaves retired generations: never searched, and
   * deleted by the next drop or the next build of that key.
   *
   * A build of the source running in another process, holding its builder
   * lock, does not hold the drop back: its generation is retired with the
   * rest, and its next write, listing or completion is refused
   * `LOCK_CONFLICT` and ends it (see `writeTarget`), so it never brings the
   * source back. The drop first locks the source's generation rows, waiting
   * for a transaction that holds them (a build opening or switching a
   * generation); the retirement is then one statement of its own, so it also
   * retires a generation that transaction opened, which the locking read
   * could not see.
   */
  async dropSource(ctx: AdapterContext): Promise<void> {
    this.requirePool();
    await this.ready();
    const sourceId = ctx.source.name;
    try {
      await this.inTransaction(async (client) => {
        await this.generations(sourceId, client, true);
        await client.query(
          `UPDATE ${qualified(this.schema, GENERATION_TABLE)} SET state = 'retired' WHERE source_id = $1 AND state <> 'retired'`,
          [sourceId],
        );
      });
      await this.sweepRetired(sourceId);
    } finally {
      await this.releaseBuilderLock(sourceId);
    }
  }

  /** Let go of every builder lock this adapter holds; the plugin calls it before it closes its pool. */
  async close(): Promise<void> {
    this.builds.clear();
    for (const sourceId of [...this.builders.keys()]) await this.releaseBuilderLock(sourceId);
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      this.requirePool();
      const r = await this.ready();
      return { ok: true, message: `pgvector ${r.version}, tables in schema '${this.schema}'` };
    } catch (err) {
      const remedy = remedyOf(err);
      return { ok: false, message: `${errorText(err)}${remedy === undefined ? '' : ` ${remedy}`}` };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private requirePool(): PgPoolLike {
    if (!this.pool) {
      throw notReady('it has no PostgreSQL database', this.unavailable ?? 'It was given no PostgreSQL connection.', []);
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
    } catch (err) {
      // The first query failed: the database is not reachable (or refuses this
      // role). Not a missing extension, and no SQL would fix it.
      throw notReady(
        'it cannot reach its PostgreSQL database',
        `The connection failed: ${errorText(err)}. Check the store's URL, the network and the role's access.`,
        [],
      );
    }
    if (!ext) {
      let refusal: unknown;
      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        ext = await this.findExtension(pool);
      } catch (err) {
        refusal = err;
        // Another session may have created it at the same moment: `IF NOT
        // EXISTS` does not hold between two concurrent CREATEs, and the loser
        // fails on the catalogue's unique key. What counts is whether it exists now.
        ext = await this.findExtension(pool).catch(() => undefined);
      }
      if (!ext) {
        throw notReady(
          "the PostgreSQL 'vector' extension (pgvector) is not installed in its database",
          `This connection could not install it${refusal === undefined ? '' : ` (${errorText(refusal)})`}.`,
          ['CREATE EXTENSION IF NOT EXISTS vector;', ...ddl.map((statement) => `${statement};`)],
        );
      }
    }
    try {
      for (const statement of ddl) await pool.query(statement);
    } catch (err) {
      throw notReady(
        'its schema and generation table could not be created',
        `Creating schema '${this.schema}' failed (${errorText(err)}).`,
        ddl.map((statement) => `${statement};`),
      );
    }
    this.readiness = { extensionSchema: quoteIdentifier(ext.schema), version: ext.version };
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
        `its ${dimensions}-wide passage table could not be created`,
        `Creating ${qualified(this.schema, vectorTable(dimensions))} failed (${errorText(err)}).`,
        ddl.map((statement) => `${statement};`),
      );
    }
    this.tables.add(dimensions);
    this.keyed.add(dimensions);
  }

  /**
   * Makes the keyword index of a passage table made before the store kept one
   * (`keywordIndexDdl`); a table this adapter made or already checked is
   * skipped. Two processes making it at once: the one that loses finds it made.
   */
  private async ensureKeywordIndex(dimensions: number): Promise<void> {
    if (this.keyed.has(dimensions)) return;
    const pool = this.requirePool();
    const statement = keywordIndexDdl(this.schema, dimensions);
    try {
      await pool.query(statement);
    } catch (err) {
      const found = await pool
        .query<{ present: string | null }>('SELECT to_regclass($1) AS present', [qualified(this.schema, keywordIndexName(dimensions))])
        .catch(() => undefined);
      if (found?.rows[0]?.present == null) {
        throw notReady(
          `the keyword index of its ${dimensions}-wide passage table could not be created`,
          `Creating ${keywordIndexName(dimensions)} failed (${errorText(err)}).`,
          [`${statement};`],
        );
      }
    }
    this.keyed.add(dimensions);
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

  /** The source's generations; `forUpdate` locks their rows for the transaction `client` runs. */
  private async generations(
    sourceId: string,
    client: Pick<PgClientLike, 'query'> = this.requirePool(),
    forUpdate = false,
  ): Promise<SourceGenerations> {
    const found = await client.query<GenerationRow>(
      `SELECT generation, fingerprint, recipe_hash, dim, state FROM ${qualified(this.schema, GENERATION_TABLE)}
        WHERE source_id = $1 ORDER BY generation${forUpdate ? ' FOR UPDATE' : ''}`,
      [sourceId],
    );
    const out: SourceGenerations = { retired: [] };
    for (const r of found.rows) {
      const state: GenerationState = r.state === 'building' ? 'building' : r.state === 'retired' ? 'retired' : 'active';
      const row: GenerationRow = { ...r, generation: Number(r.generation), dim: Number(r.dim), state };
      if (state === 'retired') out.retired.push(row);
      else out[state] = row;
    }
    return out;
  }

  /**
   * Open a generation of `sourceId` under `fingerprint`, numbered past every
   * generation the source has. Passage rows of the source left without a
   * generation row (a row deleted by hand, its passages not) are deleted
   * first, in the same transaction, so no generation ever adopts vectors
   * embedded under another fingerprint. When a concurrent call opened the
   * generation of that state first, that one is answered.
   */
  private async openGeneration(
    client: PgClientLike,
    sourceId: string,
    fingerprint: string | undefined,
    embedder: IEmbedder,
    state: 'active' | 'building',
  ): Promise<GenerationRow> {
    const t = qualified(this.schema, GENERATION_TABLE);
    for (const width of await this.passageWidths(client)) {
      const passages = qualified(this.schema, vectorTable(width));
      await client.query(
        `DELETE FROM ${passages} p WHERE p.source_id = $1
           AND NOT EXISTS (SELECT 1 FROM ${t} g WHERE g.source_id = p.source_id AND g.generation = p.generation)`,
        [sourceId],
      );
    }
    const opened = await client.query<GenerationRow>(
      `INSERT INTO ${t} (source_id, generation, fingerprint, dim, model, state)
       SELECT $1, COALESCE(max(generation), 0) + 1, $2, $3, $4, $5 FROM ${t} WHERE source_id = $1
       ON CONFLICT DO NOTHING
       RETURNING generation, fingerprint, recipe_hash, dim, state`,
      [sourceId, fingerprint ?? null, embedder.dimensions, embedder.model ?? null, state],
    );
    const row = opened.rows[0] ?? (await this.generations(sourceId, client))[state];
    if (row === undefined) {
      throw new Error(`knowledge-pgvector: no ${state} generation of source '${sourceId}' could be opened; retry.`);
    }
    return { ...row, generation: Number(row.generation), dim: Number(row.dim), state };
  }

  /** Mark a generation `retired`: held by no write and no search; {@link sweepRetired} deletes it. */
  private async retire(client: PgClientLike, sourceId: string, generation: number): Promise<void> {
    await client.query(`UPDATE ${qualified(this.schema, GENERATION_TABLE)} SET state = 'retired' WHERE source_id = $1 AND generation = $2`, [
      sourceId,
      generation,
    ]);
  }

  /**
   * Delete the retired generations of `sourceId`: their passages in batches of
   * {@link deleteBatchSize} rows, one statement and one short transaction
   * each, so no long lock is held over a large source; the generation row last,
   * so no passage is ever left without one.
   */
  private async sweepRetired(sourceId: string): Promise<void> {
    const pool = this.requirePool();
    const { retired } = await this.generations(sourceId);
    for (const g of retired) {
      if (await this.tableExists(g.dim)) {
        const table = qualified(this.schema, vectorTable(g.dim));
        for (;;) {
          const deleted = await pool.query<{ n: number }>(
            `WITH gone AS (
               DELETE FROM ${table} WHERE (source_id, generation, chunk_id) IN (
                 SELECT source_id, generation, chunk_id FROM ${table} WHERE source_id = $1 AND generation = $2 LIMIT $3)
               RETURNING 1)
             SELECT count(*)::int AS n FROM gone`,
            [sourceId, g.generation, this.deleteBatchSize],
          );
          if (Number(deleted.rows[0]?.n ?? 0) < this.deleteBatchSize) break;
        }
      }
      await pool.query(
        `DELETE FROM ${qualified(this.schema, GENERATION_TABLE)} WHERE source_id = $1 AND generation = $2 AND state = 'retired'`,
        [sourceId, g.generation],
      );
    }
  }

  /** The widths of the passage tables that exist in the store's schema. */
  private async passageWidths(client: Pick<PgClientLike, 'query'> = this.requirePool()): Promise<number[]> {
    const found = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name ~ '^knowledge_vec_d[0-9]+$' ORDER BY table_name`,
      [this.schema],
    );
    return found.rows.map((r) => Number(r.table_name.slice('knowledge_vec_d'.length)));
  }

  /**
   * The generation a call carrying `ctx.index` writes to or lists: the one
   * under construction when it holds that fingerprint, else the active one
   * when it holds it (or none is carried); refused when neither does, or when
   * the embedder's width is not the generation's. A source that holds nothing
   * gets its first generation (`create`), or none.
   *
   * A call of a build this adapter began (`ctx.reason === 'reindex'`) goes to
   * the generation that build began and to no other: when it is no longer
   * active or under construction — the source was dropped, by this process or
   * another, or another build replaced it — the build is ended and the call
   * refused `LOCK_CONFLICT`, so a build never opens a generation and never
   * brings a dropped source back.
   */
  private async writeTarget(
    ctx: AdapterContext,
    embedder: IEmbedder,
    create: boolean,
  ): Promise<GenerationRow | undefined> {
    const sourceId = ctx.source.name;
    const fingerprint = ctx.index?.fingerprint;
    const { active, building } = await this.generations(sourceId);
    const checked = (g: GenerationRow): GenerationRow => {
      if (embedder.dimensions !== g.dim) throw rebuildRequired(sourceId, false);
      return g;
    };
    const build = ctx.reason === 'reindex' ? this.builds.get(sourceId) : undefined;
    if (build !== undefined) {
      const mine = [building, active].find((g) => g !== undefined && g.generation === build);
      if (mine === undefined) {
        this.builds.delete(sourceId);
        await this.releaseBuilderLock(sourceId);
        throw buildEnded(sourceId);
      }
      if (fingerprint !== undefined && mine.fingerprint !== fingerprint) throw rebuildRequired(sourceId, false);
      return checked(mine);
    }
    if (building !== undefined && fingerprint !== undefined && building.fingerprint === fingerprint) return checked(building);
    if (active === undefined) {
      if (!create) return undefined;
      const opened = await this.inTransaction((client) => this.openGeneration(client, sourceId, fingerprint, embedder, 'active'));
      if (fingerprint !== undefined && opened.fingerprint !== fingerprint) throw rebuildRequired(sourceId, false);
      return checked(opened);
    }
    if (fingerprint === undefined || active.fingerprint === fingerprint) return checked(active);
    throw rebuildRequired(sourceId, false);
  }

  // ── The builder lock ──────────────────────────────────────────────

  /** The advisory lock key of a source: 64 bits of a hash of the schema and the source id. */
  private lockKey(sourceId: string): string {
    const digest = createHash('sha256').update(`knowledge-pgvector\u0000${this.schema}\u0000${sourceId}`).digest();
    return digest.readBigInt64BE(0).toString();
  }

  /**
   * Take the source's builder lock on a session of its own, or keep the one
   * this adapter already holds when its session still holds it (the
   * knowledge service runs one walk of a source at a time, so that one is an
   * earlier build's that ended without `completeBuild`). Refused
   * `LOCK_CONFLICT` while another session holds it.
   */
  private async takeBuilderLock(sourceId: string): Promise<void> {
    if (this.builders.has(sourceId)) {
      // Kept only while its session still holds it: a session that ended
      // took the lock with it, and another process may hold it now.
      if (await this.holdsBuilderLock(sourceId)) {
        this.restartIdleTimer(sourceId);
        return;
      }
      await this.releaseBuilderLock(sourceId);
    }
    const pool = this.requirePool();
    const client = pool.connectSession ? await pool.connectSession() : await pool.connect();
    const key = this.lockKey(sourceId);
    let locked: boolean;
    try {
      const got = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS locked', [key]);
      locked = got.rows[0]?.locked === true;
    } catch (err) {
      client.release(err instanceof Error ? err : true);
      throw err;
    }
    if (!locked) {
      client.release();
      throw builderBusy(sourceId, this.buildLockIdleMs);
    }
    this.builders.set(sourceId, { client, key });
    this.restartIdleTimer(sourceId);
  }

  /**
   * Whether the session this adapter holds the source's builder lock on
   * still holds it, read from `pg_locks` on that session. A session that
   * cannot answer holds nothing: PostgreSQL frees a lock with its session.
   */
  private async holdsBuilderLock(sourceId: string): Promise<boolean> {
    const held = this.builders.get(sourceId);
    if (!held) return false;
    // An advisory lock on one bigint key shows in pg_locks as its high 32
    // bits (classid) and low 32 bits (objid), objsubid 1.
    const key = BigInt.asUintN(64, BigInt(held.key));
    try {
      const found = await held.client.query<{ held: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_locks
                         WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted AND objsubid = 1
                           AND classid = $1::bigint::oid AND objid = $2::bigint::oid) AS held`,
        [(key >> 32n).toString(), (key & 0xffffffffn).toString()],
      );
      return found.rows[0]?.held === true;
    } catch {
      return false;
    }
  }

  /**
   * The fence of a build this adapter began (ADR-0161 K7, rule 2): a call of
   * the build (`ctx.reason === 'reindex'`) is refused `LOCK_CONFLICT` once the
   * source's builder lock is gone — let go after its idle time, or its
   * session ended — so a build that lost the lock embeds no further page and
   * removes nothing. The build is ended here; its completion is refused too.
   * A call outside a build this adapter began is not fenced.
   */
  private async fenceBuild(ctx: AdapterContext): Promise<void> {
    if (ctx.reason !== 'reindex') return;
    const sourceId = ctx.source.name;
    if (!this.builds.has(sourceId)) return;
    if (await this.holdsBuilderLock(sourceId)) return;
    this.builds.delete(sourceId);
    await this.releaseBuilderLock(sourceId);
    throw builderLost(sourceId);
  }

  /**
   * A call of the build (`ctx.reason === 'reindex'`: the walk's listing, its
   * pages, its removals) while this adapter holds the source's lock: the lock's
   * idle time starts again. An event-sync write does not, so a walk that failed
   * on a process that keeps receiving record events still lets go.
   */
  private touchBuilderLock(ctx: AdapterContext): void {
    if (ctx.reason !== 'reindex') return;
    this.restartIdleTimer(ctx.source.name);
  }

  private restartIdleTimer(sourceId: string): void {
    const held = this.builders.get(sourceId);
    if (!held) return;
    if (held.timer !== undefined) clearTimeout(held.timer);
    held.timer = setTimeout(() => void this.releaseBuilderLock(sourceId), this.buildLockIdleMs);
    held.timer.unref?.();
  }

  /** Let go of the source's builder lock, when this adapter holds it. */
  private async releaseBuilderLock(sourceId: string): Promise<void> {
    const held = this.builders.get(sourceId);
    if (!held) return;
    this.builders.delete(sourceId);
    if (held.timer !== undefined) clearTimeout(held.timer);
    try {
      const unlocked = await held.client.query<{ unlocked: boolean }>('SELECT pg_advisory_unlock($1::bigint) AS unlocked', [held.key]);
      if (unlocked.rows[0]?.unlocked !== true) {
        // The session that took the lock no longer holds it: a connection
        // pooler in transaction mode ran the two statements on different
        // server connections, or the session was replaced. The lock may stay
        // held elsewhere, or two builders may have run.
        this.logger?.warn?.(
          `knowledge-pgvector: the builder lock of source '${sourceId}' was not held by its session when released. ` +
            'The store needs a direct or session-mode PostgreSQL connection: a transaction-mode pooler breaks session advisory locks.',
        );
      }
      held.client.release();
    } catch (err) {
      // A session that is gone has let go of its lock already.
      held.client.release(err instanceof Error ? err : true);
    }
  }

  /** Run `work` in one transaction: committed when it resolves, rolled back when it throws. */
  private async inTransaction<T>(work: (client: PgClientLike) => Promise<T>): Promise<T> {
    let value: T | undefined;
    await this.transaction(async (client) => {
      value = await work(client);
      return true;
    });
    return value as T;
  }

  /** Run `work` in one transaction: committed when it answers `true`, rolled back when it answers `false` or throws. */
  private async transaction(work: (client: PgClientLike) => Promise<boolean>): Promise<boolean> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const commit = await work(client);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      client.release();
      return commit;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release(err instanceof Error ? err : true);
      throw err;
    }
  }
}

/**
 * Reciprocal rank fusion of the two legs' rows (`vpos`, `kpos`: a row's rank
 * in each leg, or null): best first, at most `topK`; a tie goes to the better
 * vector rank, then to the chunk id. The score is the fused sum divided by
 * that of a row first in both legs.
 */
function fuse<R extends { chunk_id: string; vpos: string | number | null; kpos: string | number | null }>(
  rows: readonly R[],
  topK: number,
): Array<{ row: R; score: number }> {
  const best = 2 / (RRF_K + 1);
  const leg = (pos: string | number | null) => (pos === null ? 0 : 1 / (RRF_K + Number(pos)));
  const vectorRank = (row: R) => (row.vpos === null ? Infinity : Number(row.vpos));
  return rows
    .map((row) => ({ row, score: (leg(row.vpos) + leg(row.kpos)) / best }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        vectorRank(a.row) - vectorRank(b.row) ||
        (a.row.chunk_id < b.row.chunk_id ? -1 : 1),
    )
    .slice(0, topK);
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

/**
 * A refusal under another fingerprint (ADR-0161 K7, rules 4 and 5): the
 * source needs a rebuild, or — `building` — the generation of the searched
 * fingerprint is under construction. Its message is one sentence a search
 * caller may read; what to do is operator text, carried in `remedy`.
 */
function rebuildRequired(sourceId: string, building: boolean): Error {
  const message = building
    ? `Knowledge source '${sourceId}' is being rebuilt under its new index fingerprint; it answers again when the ` +
      'rebuild completes.'
    : `Knowledge source '${sourceId}' needs a rebuild: its index was built under another embedding model, split or ` +
      'content recipe, and it is not searched until a complete reindex has rebuilt it.';
  return Object.assign(new Error(message), {
    code: KNOWLEDGE_REBUILD_REQUIRED,
    status: 409,
    remedy:
      'Run a complete reindex of the source. The store builds the new index beside the old one and switches to it ' +
      'when the reindex completes; the old index is then deleted.',
  });
}

/** A build refused because another process holds the source's builder lock. */
function builderBusy(sourceId: string, idleMs: number): Error {
  return Object.assign(
    new Error(`Knowledge source '${sourceId}' is being built by another process; this build did not start.`),
    {
      code: LOCK_CONFLICT,
      status: 409,
      remedy:
        'One process builds a source at a time. Start the reindex again once that build ends: a build whose process ' +
        `stopped lets go at once, and one that stopped part-way on a running process lets go after ${Math.round(idleMs / 60000)} ` +
        'minute(s) without progress.',
    },
  );
}

/** A build refused because it no longer holds the source's builder lock. */
function builderLost(sourceId: string): Error {
  return Object.assign(
    new Error(
      `This build of knowledge source '${sourceId}' no longer holds the source's builder lock; it writes and completes nothing more.`,
    ),
    {
      code: LOCK_CONFLICT,
      status: 409,
      remedy:
        'The lock was let go after the build made no progress for its idle time, or its database session ended, and ' +
        'another process may be building the source. What this build wrote is kept and skipped by the next build; ' +
        'start a reindex again if none is running. If every build stops this way at its first page, the store is ' +
        'behind a transaction-mode connection pooler (PgBouncer transaction pooling, or a hosted pooled URL): its ' +
        'session advisory lock does not stay with the session that took it, so the lock always reads as lost. Point ' +
        "the store's url at a direct or session-mode PostgreSQL endpoint.",
    },
  );
}

/**
 * A build's write, listing or completion refused because the generation the
 * build began is gone: the source was dropped, or another build replaced it.
 */
function buildEnded(sourceId: string): Error {
  return Object.assign(
    new Error(
      `The index this build of knowledge source '${sourceId}' began was dropped or replaced while it ran; this build writes and completes nothing more.`,
    ),
    {
      code: LOCK_CONFLICT,
      status: 409,
      remedy:
        'The source was removed (its index dropped), or another build took the source up after this one lost its builder ' +
        'lock. Start a reindex again if the source is still served and no build of it is running.',
    },
  );
}

/**
 * The store is not ready. The message is one sentence with no database
 * detail, as a search caller may read it; what went wrong and the SQL to run
 * are operator text in `remedy`, shown by `healthCheck`, the plugin's boot
 * warning and the knowledge service's log.
 */
function notReady(diagnosis: string, detail: string, sql: string[]): Error {
  const remedy = `${detail}${sql.length === 0 ? '' : ` Run as a database owner, then retry (no restart needed):\n${sql.join('\n')}`}`;
  return Object.assign(new Error(`The knowledge store (pgvector) is not ready: ${diagnosis}.`), {
    code: 'SERVICE_UNAVAILABLE',
    status: 503,
    remedy,
  });
}

/** The operator text an adapter error carries, if any. */
function remedyOf(err: unknown): string | undefined {
  const remedy = err !== null && typeof err === 'object' ? (err as { remedy?: unknown }).remedy : undefined;
  return typeof remedy === 'string' && remedy !== '' ? remedy : undefined;
}

/** A PostgreSQL identifier, double-quoted, an embedded quote doubled. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
