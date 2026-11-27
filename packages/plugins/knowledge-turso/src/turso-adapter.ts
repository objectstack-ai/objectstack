// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type { Client, InArgs, InStatement, Transaction } from '@libsql/client';
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
  GENERATION_TABLE,
  METADATA_VALUE_JSON,
  SCOPE_SCALAR_TYPES,
  type TableShape,
  tableShape,
  assertSourceId,
  generationDdl,
  generationTable,
  legacyTable,
  passageTableDdl,
  quoted,
  vectorLiteral,
} from './sql.js';

/** Options of {@link TursoKnowledgeAdapter}. */
export interface TursoKnowledgeAdapterOptions {
  /** Adapter id, the value of `KnowledgeSource.adapter`. @default 'turso' */
  id?: string;
  /**
   * The libSQL client of the store's own database (a `file:` URL, `:memory:`
   * or `libsql://`). Absent: the store has no database, and every call
   * answers `SERVICE_UNAVAILABLE` naming `unavailable`.
   */
  client?: Client;
  /** Why there is no client, said by every call when `client` is absent. */
  unavailable?: string;
  /**
   * The embedder the store calls, or a getter read at each call (the kernel's
   * `embedder` service may register after this adapter). Its `dimensions`
   * size a new generation's vector column; its `model` and `dimensions` are
   * what the adapter reports to the knowledge service's index fingerprint.
   */
  embedder: IEmbedder | (() => IEmbedder | undefined);
  /**
   * Text put before every QUERY before it is embedded, for an asymmetric
   * model that embeds questions and passages differently. Passages are
   * embedded as they are. It changes no stored vector, so it is not part of
   * the index fingerprint (ADR-0161 K8, item 15).
   */
  queryPrefix?: string;
  /**
   * The longest one request to the database may take, in milliseconds — each
   * statement, and each commit or rollback, on its own — before the call
   * answers `SERVICE_UNAVAILABLE` and the queue moves on. For a remote
   * database (`libsql://`), whose requests have no bound of their own: one
   * stalled request would otherwise hold every source of the client, and the
   * boot that awaits the health check. A write of many passages makes many
   * requests, so the bound never grows with the size of a page. Absent: no
   * bound (a `file:` store waits only for the busy timeout).
   */
  requestTimeoutMs?: number;
}

/** The ADR-0112 code of a write or a search refused under another fingerprint (ADR-0161 K7, rules 4 and 5). */
export const KNOWLEDGE_REBUILD_REQUIRED = 'KNOWLEDGE_REBUILD_REQUIRED';

/** How many times {@link TursoKnowledgeAdapter.upsert} plans a batch again when a concurrent write removed a passage it meant to keep. */
const UPSERT_ATTEMPTS = 3;

/** How many times {@link TursoKnowledgeAdapter.search} runs again when the active generation was switched under it. */
const SEARCH_ATTEMPTS = 3;

/** The standard ADR-0112 code of a search whose source's index was switched under it on every attempt. */
const CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION';

/** A generation row: one index of one source under one fingerprint. */
interface GenerationRow {
  generation: number;
  fingerprint: string | null;
  recipeHash: string | null;
  dim: number;
  state: 'active' | 'building';
}

/** A source's generations: the active one, and the one under construction. */
interface SourceGenerations {
  active?: GenerationRow;
  building?: GenerationRow;
}

/**
 * Every call of every adapter on one libSQL client runs its database work one
 * at a time. A transaction holds its connection across awaits, and a second
 * writer on another connection of the same process would wait in SQLite's
 * busy handler — synchronously, on the thread the holder needs to commit — so
 * in-process work is queued here instead; other processes are kept apart by
 * SQLite's own lock and the busy timeout.
 */
const queues = new WeakMap<Client, Promise<unknown>>();

function serial<T>(client: Client, work: () => Promise<T>): Promise<T> {
  const before = queues.get(client) ?? Promise.resolve();
  const run = before.then(work, work);
  queues.set(client, run.then(() => undefined, () => undefined));
  return run;
}

/**
 * A view of `client` whose every request — `execute`, `batch`, opening a
 * transaction, and a transaction's `execute`, `batch`, `commit` and
 * `rollback` — is bounded by `ms` on its own. Everything else is the client's.
 */
function boundedClient(client: Client, ms: number): Client {
  const bound = <T extends object>(target: T, methods: readonly string[], wrap?: (answered: unknown) => unknown): T =>
    new Proxy(target, {
      get(t, key) {
        const value = Reflect.get(t, key, t) as unknown;
        if (typeof value !== 'function') return value;
        const fn = (value as (...a: unknown[]) => unknown).bind(t);
        if (typeof key !== 'string' || !methods.includes(key)) return fn;
        return async (...args: unknown[]) => {
          const answered = await withTimeout(fn(...args) as Promise<unknown>, ms, key === 'commit');
          return wrap && key === 'transaction' ? wrap(answered) : answered;
        };
      },
    });
  return bound(client, ['execute', 'batch', 'transaction'], (tx) =>
    bound(tx as Transaction, ['execute', 'batch', 'commit', 'rollback']),
  );
}

/**
 * `work`, or `SERVICE_UNAVAILABLE` when it has not settled within `ms`. A
 * statement that times out inside a transaction is followed by a rollback,
 * never a commit, so nothing it began lands; only a COMMIT that times out
 * (`commit`) may still land, and its refusal says so.
 */
function withTimeout<T>(work: Promise<T>, ms: number, commit = false): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          notReady(
            'its database did not answer in time',
            `A request to the libSQL database took longer than ${ms} ms (the store's \`requestTimeoutMs\`); check that ` +
              'the database is reachable, or raise the bound.' +
              (commit
                ? ' It was the commit of a write: that write may still be applied. Writes are idempotent, so retry it.'
                : ''),
          ),
        ),
      ms,
    );
  });
  // The stalled request settles on its own later; nothing waits for it.
  work.catch(() => undefined);
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * `TursoKnowledgeAdapter` — an `IKnowledgeAdapter` on libSQL's native vectors
 * (`F32_BLOB` columns, `vector32`, `vector_distance_cos`): the open vector
 * store for local development and for deployments not on PostgreSQL (cloud
 * ADR-0119 D5; ADR-0161 Execution, row 7).
 *
 * ## Storage
 *
 * In a libSQL database of its own — never the platform's database file: two
 * engines writing one SQLite file in one process lose rows. A generation
 * table, `knowledge_generation` (source, generation, fingerprint, recipe hash,
 * vector width, model, state), and one passage table per source and
 * generation, `knowledge_<source>_g<n>`, whose vector column is sized for that
 * generation's width. A passage row holds its chunk and document ids, record
 * id, organization, text, title, heading path, document hash, chunk hash,
 * metadata and vector. The text is stored: it is as sensitive as the record it
 * came from, and it is in every copy of the file.
 *
 * ## Search
 *
 * An exact scan by cosine distance, no approximate index: the organization
 * filter (ADR-0161 K8, item 9) and the metadata-equality `filter` run in the
 * same `WHERE`, before ranking, which libSQL's DiskANN index (`vector_top_k`)
 * cannot do — it ranks first. A passage whose cosine similarity is not
 * positive is not a hit.
 *
 * ## Generations (ADR-0161 K7; K8, item 8)
 *
 * A source holds an active generation and, while a build under another
 * fingerprint runs, one generation under construction — at most one per
 * source, by a unique index on the generation table. That index does not
 * refuse a second builder: a second build under the same fingerprint joins
 * the one under way, and one under another fingerprint replaces it (the first
 * builder's writes are then refused). A write
 * carrying `ctx.index` goes to the generation of that fingerprint and is
 * refused `KNOWLEDGE_REBUILD_REQUIRED` when neither holds it; a search
 * carrying another fingerprint than the active one's is refused the same way
 * and never answered from it. A source that holds nothing takes the first
 * fingerprint it is handed. `beginBuild` under a new fingerprint opens a
 * generation table beside the active one (or takes up the one under
 * construction for it; one under construction for a third fingerprint is
 * abandoned and dropped); `completeBuild` makes it the active one, records the
 * recipe hash, and drops the old table.
 *
 * A table the store's earlier releases wrote (`knowledge_<source>`, no
 * generation) is never served: a search answers "reindex needed", a write
 * outside a build is refused, and the table is dropped when the first build's
 * generation becomes active.
 *
 * ## Writes
 *
 * The adapter takes the service's passages (`capabilities.chunks`) and hashes
 * the text of each (`chunk_hash`). A passage whose hash is already stored is
 * not embedded again: its row is rewritten around the stored vector; when that
 * row is gone by the time the write runs, the batch is planned again. Every
 * embed call runs before the write transaction opens, so the database is never
 * locked while the embedder answers.
 *
 * ## What a caller reads
 *
 * A refusal's message is one sentence: no driver text, no SQL, no file path.
 * Operator text travels in the error's `remedy`, which `healthCheck`, the
 * plugin's boot warning and the knowledge service's reindex result and log
 * show.
 */
export class TursoKnowledgeAdapter implements IKnowledgeAdapter {
  readonly id: string;
  readonly capabilities = { chunks: true } as const;
  /** The client every request goes through: the one given, bounded when `requestTimeoutMs` is set. */
  private readonly client?: Client;
  /** The client as given, which keys the in-process queue shared by every adapter on it. */
  private readonly queueKey?: Client;
  private readonly unavailable?: string;
  private readonly resolveEmbedder: () => IEmbedder | undefined;
  private readonly queryPrefix: string;
  private isReady = false;
  /** Sources whose legacy table is known to be absent. */
  private readonly noLegacy = new Set<string>();

  constructor(opts: TursoKnowledgeAdapterOptions) {
    this.id = opts.id ?? 'turso';
    this.queueKey = opts.client;
    this.unavailable = opts.unavailable;
    const embedder = opts.embedder;
    this.resolveEmbedder = typeof embedder === 'function' ? embedder : () => embedder;
    this.queryPrefix = opts.queryPrefix ?? '';
    if (opts.requestTimeoutMs !== undefined && (!Number.isFinite(opts.requestTimeoutMs) || opts.requestTimeoutMs <= 0)) {
      throw new RangeError(`knowledge-turso: requestTimeoutMs must be a positive number, got ${String(opts.requestTimeoutMs)}`);
    }
    this.client =
      opts.client === undefined || opts.requestTimeoutMs === undefined
        ? opts.client
        : boundedClient(opts.client, opts.requestTimeoutMs);
  }

  /** `work` on the queue of the client as given, shared with every adapter on that client. */
  private queued<T>(_client: Client, work: () => Promise<T>): Promise<T> {
    return serial(this.queueKey ?? _client, work);
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
    const client = this.requireClient();
    assertSourceId(ctx.source.id);
    const embedder = this.requireEmbedder();
    await this.ready();
    // An unchanged passage is rewritten in place, keeping its vector. When its
    // row is gone by the time the write runs (a concurrent write of the same
    // document removed it), the write is rolled back and planned again, so the
    // passage is embedded and inserted rather than lost.
    for (let attempt = 1; ; attempt++) {
      const target = await this.queued(client, () => this.writeTarget(ctx, embedder, true));
      const missing = await this.writePassages(docs, ctx.source.id, target!, embedder);
      if (missing === undefined) return;
      if (attempt >= UPSERT_ATTEMPTS) {
        throw new Error(
          `knowledge-turso: a concurrent write to source '${ctx.source.id}' removed passages this write meant to keep, ` +
            `${UPSERT_ATTEMPTS} times while it ran; nothing of this batch was written. Retry the write.`,
        );
      }
    }
  }

  /**
   * One attempt of {@link upsert}: read the stored chunk hashes, embed what
   * changed, write in one transaction. Answers `undefined` when written, or the
   * id of an unchanged passage whose row was gone (the transaction is rolled
   * back).
   */
  private async writePassages(
    docs: KnowledgeDocument[],
    sourceId: string,
    target: GenerationRow,
    embedder: IEmbedder,
  ): Promise<string | undefined> {
    const client = this.requireClient();
    const table = quoted(generationTable(sourceId, target.generation));
    const planned = docs.map((doc) => ({
      doc,
      passages: passagesOf(doc).map((p) => ({ ...p, hash: chunkHash(p.content) })),
    }));
    const ids = docs.map((d) => d.id);
    const stored = new Map<string, string>();
    const existing = await this.queued(client, () =>
      client.execute({
        sql: `SELECT chunk_id, chunk_hash FROM ${table} WHERE document_id IN (SELECT value FROM json_each(?))`,
        args: [JSON.stringify(ids)],
      }),
    );
    for (const row of existing.rows) stored.set(String(row.chunk_id), String(row.chunk_hash));

    // Embed what changed, before the write transaction opens.
    const toEmbed = planned.flatMap((p) => p.passages).filter((p) => stored.get(p.id) !== p.hash);
    const vectors = toEmbed.length === 0 ? [] : await embedder.embed(toEmbed.map((p) => p.content));
    if (vectors.length !== toEmbed.length) {
      throw new Error(
        `knowledge-turso: the embedder answered ${vectors.length} vector(s) for ${toEmbed.length} passage(s); nothing was written.`,
      );
    }
    const vectorOf = new Map<string, number[]>();
    toEmbed.forEach((p, i) => {
      const v = vectors[i];
      if (!Array.isArray(v) || v.length !== target.dim) {
        throw new Error(
          `knowledge-turso: the embedder answered a ${Array.isArray(v) ? v.length : 'missing'}-wide vector for ` +
            `passage '${p.id}', and this source's index holds ${target.dim}-wide vectors; nothing was written.`,
        );
      }
      vectorOf.set(p.id, v);
    });

    return this.queued(client, () =>
      this.transaction(async (tx) => {
        // The generation may have been switched or abandoned while the embedder
        // answered: write only into the one that was planned.
        const still = await tx.execute({
          sql: `SELECT 1 FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ? AND generation = ? AND fingerprint IS ? AND dim = ?`,
          args: [sourceId, target.generation, target.fingerprint, target.dim],
        });
        if (still.rows.length === 0) return { commit: false, value: `${sourceId}#generation-${target.generation}` };
        // One request per document (its DELETE and its passages, as one batch
        // inside the transaction): the request bound never meets a page's size.
        for (const { doc, passages } of planned) {
          const statements: InStatement[] = [
            {
              sql: `DELETE FROM ${table} WHERE document_id = ? AND chunk_id NOT IN (SELECT value FROM json_each(?))`,
              args: [doc.id, JSON.stringify(passages.map((p) => p.id))],
            },
          ];
          const kept: Array<string | undefined> = [undefined];
          for (const p of passages) {
            const common: InArgs = [
              p.id,
              doc.id,
              doc.sourceRecordId ?? null,
              doc.organizationId ?? null,
              p.content,
              doc.title ?? null,
              p.headingPath === undefined ? null : JSON.stringify(p.headingPath),
              doc.docHash ?? null,
              p.hash,
              JSON.stringify(doc.metadata ?? {}),
            ];
            const vector = vectorOf.get(p.id);
            if (vector === undefined) {
              // Unchanged text: the stored vector stands; the rest of the row is rewritten.
              statements.push({
                sql: `UPDATE ${table} SET document_id = ?2, source_record_id = ?3, organization_id = ?4, content = ?5,
                        title = ?6, heading_path = ?7, doc_hash = ?8, metadata = ?10
                      WHERE chunk_id = ?1 AND chunk_hash = ?9`,
                args: common,
              });
              kept.push(p.id);
            } else {
              statements.push({
                sql: `INSERT INTO ${table} (chunk_id, document_id, source_record_id, organization_id, content, title,
                        heading_path, doc_hash, chunk_hash, metadata, embedding)
                      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, vector32(?11))
                      ON CONFLICT (chunk_id) DO UPDATE SET document_id = excluded.document_id,
                        source_record_id = excluded.source_record_id, organization_id = excluded.organization_id,
                        content = excluded.content, title = excluded.title, heading_path = excluded.heading_path,
                        doc_hash = excluded.doc_hash, chunk_hash = excluded.chunk_hash, metadata = excluded.metadata,
                        embedding = excluded.embedding`,
                args: [...(common as unknown[]), vectorLiteral(vector)] as InArgs,
              });
              kept.push(undefined);
            }
          }
          const results = await tx.batch(statements);
          // An unchanged passage whose row is gone: rolled back, and planned again.
          const gone = results.findIndex((r, i) => kept[i] !== undefined && r.rowsAffected === 0);
          if (gone !== -1) return { commit: false, value: kept[gone]! };
        }
        return { commit: true, value: undefined };
      }),
    );
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    if (documentIds.length === 0) return;
    const client = this.requireClient();
    assertSourceId(ctx.source.id);
    await this.ready();
    // From every generation of the source: a removed document leaves them all.
    await this.queued(client, async () => {
      const { active, building } = await this.generations(ctx.source.id);
      for (const g of [active, building]) {
        if (!g) continue;
        await client.execute({
          sql: `DELETE FROM ${quoted(generationTable(ctx.source.id, g.generation))} WHERE document_id IN (SELECT value FROM json_each(?))`,
          args: [JSON.stringify(documentIds)],
        });
      }
    });
  }

  async listDocuments(ctx: AdapterContext, opts: AdapterListDocumentsOptions): Promise<AdapterListDocumentsPage> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new RangeError(`listDocuments: limit must be a positive integer, got ${String(opts.limit)}`);
    }
    const client = this.requireClient();
    assertSourceId(ctx.source.id);
    // The embedder first, as on every other call: without one the service's
    // fingerprint carries no model or width, and comparing it would refuse a
    // healthy index as one to rebuild. No embedder is SERVICE_UNAVAILABLE.
    const embedder = this.requireEmbedder();
    await this.ready();
    return this.queued(client, async () => {
      // The generation the writes go to (ADR-0161 K8, item 1).
      const target = await this.writeTarget(ctx, embedder, false);
      if (!target) return { documents: [] };
      const table = quoted(generationTable(ctx.source.id, target.generation));
      // SQLite compares TEXT by bytes (BINARY), both the order and the cursor.
      const page = await client.execute({
        sql: `SELECT document_id, max(doc_hash) AS doc_hash FROM ${table}
               WHERE ?1 IS NULL OR document_id > ?1
               GROUP BY document_id ORDER BY document_id LIMIT ?2`,
        args: [opts.cursor ?? null, opts.limit + 1],
      });
      const rows = page.rows.slice(0, opts.limit).map((r) => ({
        documentId: String(r.document_id),
        docHash: r.doc_hash === null ? undefined : String(r.doc_hash),
      }));
      return {
        documents: rows.map((r) => (r.docHash === undefined ? { documentId: r.documentId } : r)),
        ...(page.rows.length > opts.limit ? { nextCursor: rows[rows.length - 1].documentId } : {}),
      };
    });
  }

  async search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]> {
    return this.searchAttempt(query, opts, 1);
  }

  /** One attempt of {@link search}; `attempt` counts the generation switches met so far. */
  private async searchAttempt(query: string, opts: AdapterSearchOptions, attempt: number): Promise<KnowledgeHit[]> {
    // An empty organization set ranks nothing (ADR-0161 K8, item 9).
    if (opts.organizationIds !== undefined && opts.organizationIds.length === 0) return [];
    // A record scope with no term that has ids ranks nothing (ADR-0161 K8, item 17).
    if (opts.scope !== undefined && !opts.scope.some((term) => term.ids.length > 0)) return [];
    const client = this.requireClient();
    assertSourceId(opts.source.id);
    // The embedder first: without one the service's fingerprint carries no
    // model or width, and comparing it would refuse a healthy index as one to
    // rebuild. No embedder is SERVICE_UNAVAILABLE, as on every other call.
    const embedder = this.requireEmbedder();
    await this.ready();
    const { active, building } = await this.queued(client, () => this.generations(opts.source.id));
    if (!active) {
      if (await this.queued(client, () => this.hasLegacy(opts.source.id))) {
        throw rebuildRequired(opts.source.id, building !== undefined);
      }
      return [];
    }
    // Vectors of two fingerprints are never ranked against each other (K7, rule 5).
    if (opts.index !== undefined && active.fingerprint !== opts.index.fingerprint) {
      throw rebuildRequired(opts.source.id, building?.fingerprint === opts.index.fingerprint);
    }
    if (embedder.dimensions !== active.dim) throw rebuildRequired(opts.source.id, false);
    const topK = Math.max(0, Math.floor(opts.topK));
    if (topK === 0) return [];

    // The query is embedded before the database is read.
    const [vector] = await embedder.embed([`${this.queryPrefix}${query}`]);
    if (!Array.isArray(vector) || vector.length !== active.dim) {
      throw new Error(
        `knowledge-turso: the embedder answered a ${Array.isArray(vector) ? vector.length : 'missing'}-wide query ` +
          `vector, and this source's index holds ${active.dim}-wide vectors.`,
      );
    }
    if (vector.every((x) => x === 0)) return [];

    const args: unknown[] = [vectorLiteral(vector)];
    const where: string[] = [];
    if (opts.organizationIds !== undefined) {
      args.push(JSON.stringify(opts.organizationIds));
      where.push(`organization_id IN (SELECT value FROM json_each(?${args.length}))`);
    }
    if (opts.scope !== undefined) {
      // The record scope (ADR-0161 K8, item 17), a union of terms, beside the
      // organization filter so `topK` is filled from in-scope documents. Each
      // term's ids go as one bound JSON array, a field name as a bound value
      // compared with the stored keys (never put into a JSON path). A
      // `metadata` term holds for a stored string or number equal to an id as
      // text, or a list with such an element; any other value holds for nothing.
      const terms: string[] = [];
      for (const term of opts.scope) {
        if (term.ids.length === 0) continue;
        args.push(JSON.stringify(term.ids));
        const ids = `(SELECT value FROM json_each(?${args.length}))`;
        if (term.kind === 'record') {
          terms.push(`source_record_id IN ${ids}`);
          continue;
        }
        args.push(term.field);
        terms.push(
          `EXISTS (SELECT 1 FROM json_each(metadata) AS m WHERE m.key = ?${args.length} AND (` +
            `(m.type IN ${SCOPE_SCALAR_TYPES} AND CAST(m.value AS TEXT) IN ${ids}) OR ` +
            `(m.type = 'array' AND EXISTS (SELECT 1 FROM json_each(m.value) AS e ` +
            `WHERE e.type IN ${SCOPE_SCALAR_TYPES} AND CAST(e.value AS TEXT) IN ${ids}))))`,
        );
      }
      where.push(`(${terms.join(' OR ')})`);
    }
    for (const [key, value] of Object.entries(opts.filter ?? {})) {
      args.push(key, JSON.stringify(value === undefined ? null : value));
      where.push(
        `EXISTS (SELECT 1 FROM json_each(metadata) WHERE key = ?${args.length - 1} AND ${METADATA_VALUE_JSON} = json(?${args.length}))`,
      );
    }
    args.push(topK);
    const table = quoted(generationTable(opts.source.id, active.generation));
    const result = await this.queued(client, async () => {
      // The generation may have been switched while the query was embedded.
      const now = await this.generations(opts.source.id);
      if (now.active?.generation !== active.generation) return undefined;
      return client.execute({
        sql: `SELECT * FROM (
                SELECT chunk_id, document_id, source_record_id, content, title, metadata, doc_hash, heading_path,
                       vector_distance_cos(embedding, vector32(?1)) AS distance
                  FROM ${table}
                 ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
              ) ranked
              WHERE distance < 1
              ORDER BY distance, chunk_id
              LIMIT ?${args.length}`,
        args: args as InArgs,
      });
    });
    if (result === undefined) {
      // Switched while the query was embedded: searched again, a bounded number of times.
      if (attempt >= SEARCH_ATTEMPTS) {
        throw switchedDuringSearch(
          "its source's index was switched while it searched",
          `The active generation of source '${opts.source.id}' changed ${SEARCH_ATTEMPTS} times during one search; retry it.`,
        );
      }
      return this.searchAttempt(query, opts, attempt + 1);
    }
    return result.rows.map((r) => {
      const headingPath = parseJson(r.heading_path);
      return {
        chunkId: String(r.chunk_id),
        documentId: String(r.document_id),
        sourceId: opts.source.id,
        ...(r.source_record_id === null ? {} : { sourceRecordId: String(r.source_record_id) }),
        score: 1 - Number(r.distance),
        snippet: String(r.content),
        ...(r.title === null ? {} : { title: String(r.title) }),
        metadata: asRecord(parseJson(r.metadata)),
        // The stored hash, as given (ADR-0161 K8, item 3): the service's
        // record-level freshness check compares it with the record as it reads now.
        ...(r.doc_hash === null ? {} : { docHash: String(r.doc_hash) }),
        // The passage's heading path, when the splitter gave it one (item 14).
        ...(Array.isArray(headingPath) ? { headingPath: headingPath.map(String) } : {}),
      };
    });
  }

  async indexStatus(ctx: AdapterContext): Promise<AdapterIndexStatus> {
    const client = this.requireClient();
    assertSourceId(ctx.source.id);
    await this.ready();
    const { active, building } = await this.queued(client, () => this.generations(ctx.source.id));
    const status: AdapterIndexStatus = {};
    if (active?.fingerprint != null) status.fingerprint = active.fingerprint;
    if (active?.recipeHash != null) status.recipeHash = active.recipeHash;
    if (building !== undefined) status.building = true;
    return status;
  }

  async beginBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'beginBuild');
    const client = this.requireClient();
    assertSourceId(ctx.source.id);
    const embedder = this.requireEmbedder();
    await this.ready();
    await this.queued(client, async () => {
      const legacy = await this.hasLegacy(ctx.source.id);
      await this.transaction(async (tx) => {
        const { active, building } = await this.generations(ctx.source.id, tx);
        const fits = (g: GenerationRow | undefined) =>
          g !== undefined && g.fingerprint === index.fingerprint && g.dim === embedder.dimensions;
        // Rebuilt inside the active generation, or the build under way taken up.
        if (fits(active) || fits(building)) return { commit: true, value: undefined };
        if (building) {
          // A build of another fingerprint left unfinished: replaced, one per source.
          await tx.execute(`DROP TABLE IF EXISTS ${quoted(generationTable(ctx.source.id, building.generation))}`);
          await tx.execute({
            sql: `DELETE FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ? AND generation = ?`,
            args: [ctx.source.id, building.generation],
          });
        }
        // A source that holds nothing takes the fingerprint as its active one;
        // beside an active generation, or a legacy table, it is built aside.
        const state = active === undefined && !legacy ? 'active' : 'building';
        await this.openGeneration(tx, ctx.source.id, index.fingerprint, embedder, state);
        return { commit: true, value: undefined };
      });
    });
  }

  async completeBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'completeBuild');
    const client = this.requireClient();
    assertSourceId(ctx.source.id);
    await this.ready();
    await this.queued(client, async () => {
      const legacy = await this.hasLegacy(ctx.source.id);
      await this.transaction(async (tx) => {
        const { active, building } = await this.generations(ctx.source.id, tx);
        const t = quoted(GENERATION_TABLE);
        if (building?.fingerprint === index.fingerprint) {
          if (active) {
            await tx.execute(`DROP TABLE IF EXISTS ${quoted(generationTable(ctx.source.id, active.generation))}`);
            await tx.execute({ sql: `DELETE FROM ${t} WHERE source_id = ? AND generation = ?`, args: [ctx.source.id, active.generation] });
          }
          await tx.execute({
            sql: `UPDATE ${t} SET state = 'active', recipe_hash = ? WHERE source_id = ? AND generation = ?`,
            args: [index.recipeHash, ctx.source.id, building.generation],
          });
        } else if (active?.fingerprint === index.fingerprint) {
          await tx.execute({
            sql: `UPDATE ${t} SET recipe_hash = ? WHERE source_id = ? AND generation = ?`,
            args: [index.recipeHash, ctx.source.id, active.generation],
          });
        } else {
          throw new Error(
            `completeBuild: source '${ctx.source.id}' holds no generation for this fingerprint; call beginBuild first.`,
          );
        }
        // The table of the store's earlier releases goes once a generation is active.
        if (legacy) await tx.execute(`DROP TABLE IF EXISTS ${quoted(legacyTable(ctx.source.id))}`);
        return { commit: true, value: undefined };
      });
      if (legacy) this.noLegacy.add(ctx.source.id);
    });
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      this.requireClient();
      await this.ready();
      return { ok: true, message: 'libSQL vectors ready' };
    } catch (err) {
      const remedy = remedyOf(err);
      return { ok: false, message: `${errorText(err)}${remedy === undefined ? '' : ` ${remedy}`}` };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private requireClient(): Client {
    if (!this.client) {
      throw notReady('it has no libSQL database', this.unavailable ?? 'It was given no libSQL client.');
    }
    return this.client;
  }

  private requireEmbedder(): IEmbedder {
    const embedder = this.resolveEmbedder();
    if (!embedder) {
      throw Object.assign(
        new Error(
          'knowledge-turso has no embedder: register an embedder service (Settings → AI & Embedder) or pass ' +
            '`embedder` to the plugin. Passages are sent to that embedder\'s provider.',
        ),
        { code: 'SERVICE_UNAVAILABLE', status: 503 },
      );
    }
    return embedder;
  }

  /**
   * Make the store ready once: WAL on a file (a store written by two
   * processes without it loses writes), the vector functions proven present,
   * then the generation table. Until that succeeds the next call tries again.
   */
  private async ready(): Promise<void> {
    if (this.isReady) return;
    const client = this.requireClient();
    await this.queued(client, async () => {
      if (this.isReady) return;
      try {
        await client.execute('SELECT 1');
      } catch (err) {
        throw notReady(
          'it cannot open its libSQL database',
          `Opening the database failed: ${errorText(err)}. Check the store's URL, that its directory exists and is writable.`,
        );
      }
      try {
        // A remote database or `:memory:` keeps its own journal; only a file takes WAL.
        await client.execute('PRAGMA journal_mode = WAL');
      } catch {
        /* not a local file: the server decides its journal */
      }
      try {
        await client.execute("SELECT vector_distance_cos(vector32('[1,0]'), vector32('[1,0]'))");
      } catch (err) {
        throw notReady(
          'its database has no vector functions',
          `The database answered: ${errorText(err)}. The store needs libSQL (vector32, vector_distance_cos); ` +
            'a plain SQLite build has neither.',
        );
      }
      try {
        for (const statement of generationDdl()) await client.execute(statement);
      } catch (err) {
        throw notReady(
          'its generation table could not be created',
          `Creating ${GENERATION_TABLE} failed (${errorText(err)}). Check that the database is writable.`,
        );
      }
      this.isReady = true;
    });
  }

  /** The active generation of a source and the one under construction. */
  private async generations(sourceId: string, tx?: Transaction): Promise<SourceGenerations> {
    const found = await (tx ?? this.requireClient()).execute({
      sql: `SELECT generation, fingerprint, recipe_hash, dim, state FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ?`,
      args: [sourceId],
    });
    const out: SourceGenerations = {};
    for (const r of found.rows) {
      const row: GenerationRow = {
        generation: Number(r.generation),
        fingerprint: r.fingerprint === null ? null : String(r.fingerprint),
        recipeHash: r.recipe_hash === null ? null : String(r.recipe_hash),
        dim: Number(r.dim),
        state: r.state === 'building' ? 'building' : 'active',
      };
      out[row.state === 'active' ? 'active' : 'building'] = row;
    }
    return out;
  }

  /**
   * Whether the source still has a table of the store's earlier releases: a
   * `knowledge_<source>` table with exactly their columns (`tableShape`).
   * Any other table under that name, the store's own generation table or a
   * table the store did not make, is never taken for one, so never dropped.
   */
  private async hasLegacy(sourceId: string): Promise<boolean> {
    if (this.noLegacy.has(sourceId)) return false;
    const table = legacyTable(sourceId);
    const legacy = table !== GENERATION_TABLE && (await this.shapeOf(this.requireClient(), table)) === 'legacy';
    if (!legacy) this.noLegacy.add(sourceId);
    return legacy;
  }

  /** The shape of the table under `table`, if any (`tableShape`). */
  private async shapeOf(db: Pick<Client, 'execute'>, table: string): Promise<TableShape> {
    const columns = await db.execute({ sql: 'SELECT name, type FROM pragma_table_info(?)', args: [table] });
    return tableShape(columns.rows.map((r) => ({ name: r.name, type: r.type })));
  }

  /** Opens the next generation of a source: its row, and its table made afresh. */
  private async openGeneration(
    tx: Transaction,
    sourceId: string,
    fingerprint: string | undefined,
    embedder: IEmbedder,
    state: 'active' | 'building',
  ): Promise<GenerationRow> {
    const next = await tx.execute({
      sql: `SELECT coalesce(max(generation), 0) + 1 AS n FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ?`,
      args: [sourceId],
    });
    const generation = Number(next.rows[0].n);
    const table = generationTable(sourceId, generation);
    // A table already under this name is made afresh only when it is one of
    // this store's passage tables (left behind by a generation row deleted
    // by hand). Anything else is never dropped: a legacy table of another
    // source can share the name (`knowledge_<a>_g1` is source `a_g1`'s), and
    // so can a table the store did not make, in a shared database.
    const shape = await this.shapeOf(tx, table);
    if (shape === 'legacy' || shape === 'other') {
      throw notReady(
        `a table it did not make holds the name of source '${sourceId}''s next index`,
        `The database holds a table '${table}' that is not one of this store's generation tables, so generation ` +
          `${generation} of source '${sourceId}' cannot be built under that name. Rename or remove that table, or keep ` +
          'the store in a database of its own.',
      );
    }
    for (const statement of passageTableDdl(table, embedder.dimensions)) await tx.execute(statement);
    await tx.execute({
      sql: `INSERT INTO ${quoted(GENERATION_TABLE)} (source_id, generation, fingerprint, dim, model, state) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [sourceId, generation, fingerprint ?? null, embedder.dimensions, embedder.model ?? null, state],
    });
    return { generation, fingerprint: fingerprint ?? null, recipeHash: null, dim: embedder.dimensions, state };
  }

  /**
   * The generation a write carrying `ctx.index` goes to: the active one, when
   * its fingerprint is the one carried (or none is carried); the one under
   * construction, when it is that one's. Refused when it is neither, when the
   * embedder's width is not the generation's, or — outside a build — when the
   * source still has a legacy table. A source that holds nothing gets its first
   * generation (`create`), or none. Runs inside the client's queue.
   */
  private async writeTarget(
    ctx: AdapterContext,
    embedder: IEmbedder,
    create: boolean,
  ): Promise<GenerationRow | undefined> {
    const sourceId = ctx.source.id;
    const fingerprint = ctx.index?.fingerprint;
    const { active, building } = await this.generations(sourceId);
    const checked = (g: GenerationRow): GenerationRow => {
      if (embedder.dimensions !== g.dim) throw rebuildRequired(sourceId, false);
      return g;
    };
    if (building !== undefined && fingerprint !== undefined && building.fingerprint === fingerprint) return checked(building);
    if (active === undefined) {
      if (await this.hasLegacy(sourceId)) throw rebuildRequired(sourceId, building !== undefined);
      if (!create) return undefined;
      const opened = await this.transaction(async (tx) => {
        // Opened by a concurrent call between the read and this transaction: use it.
        const again = await this.generations(sourceId, tx);
        if (again.active) return { commit: true, value: again.active };
        return { commit: true, value: await this.openGeneration(tx, sourceId, fingerprint, embedder, 'active') };
      });
      if (fingerprint !== undefined && opened.fingerprint !== fingerprint) throw rebuildRequired(sourceId, false);
      return checked(opened);
    }
    if (fingerprint === undefined || active.fingerprint === fingerprint) return checked(active);
    throw rebuildRequired(sourceId, false);
  }

  /**
   * Run `work` in one write transaction (`BEGIN IMMEDIATE`): committed when it
   * answers `commit: true`, rolled back when it answers `commit: false` or
   * throws. Called inside the client's queue.
   */
  private async transaction<T>(work: (tx: Transaction) => Promise<{ commit: boolean; value: T }>): Promise<T> {
    const tx = await this.requireClient().transaction('write');
    try {
      const { commit, value } = await work(tx);
      if (commit) await tx.commit();
      else await tx.rollback();
      return value;
    } catch (err) {
      await tx.rollback().catch(() => undefined);
      throw err;
    } finally {
      tx.close();
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

/**
 * A refusal under another fingerprint (ADR-0161 K7, rules 4 and 5), or of a
 * source whose only index is a table of the store's earlier releases. Its
 * message is one sentence a search caller may read; what to do is operator
 * text, carried in `remedy`.
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
      'when the reindex completes; the old index is then dropped.',
  });
}

/**
 * A search whose source's index was switched under it on every attempt: the
 * store is ready, the search lost a race with a rebuild, and the same search
 * run again answers. The same coded answer as the pgvector store's; the
 * message names the source and says to retry, as a search caller reads it.
 */
function switchedDuringSearch(diagnosis: string, detail: string): Error {
  return Object.assign(new Error(`The knowledge search was not answered: ${diagnosis}. ${detail}`), {
    code: CONCURRENT_MODIFICATION,
    status: 409,
  });
}

/**
 * The store is not ready. The message is one sentence with no database
 * detail, as a search caller may read it; what went wrong and what to do are
 * operator text in `remedy`, shown by `healthCheck`, the plugin's boot warning
 * and the knowledge service's log.
 */
export function notReady(diagnosis: string, detail: string): Error {
  return Object.assign(new Error(`The knowledge store (libSQL) is not ready: ${diagnosis}.`), {
    code: 'SERVICE_UNAVAILABLE',
    status: 503,
    remedy: detail,
  });
}

/** The operator text an adapter error carries, if any. */
function remedyOf(err: unknown): string | undefined {
  const remedy = err !== null && typeof err === 'object' ? (err as { remedy?: unknown }).remedy : undefined;
  return typeof remedy === 'string' && remedy !== '' ? remedy : undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
