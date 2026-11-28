// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type { Client, InArgs, InStatement, ResultSet, Transaction } from '@libsql/client';
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
  TRIGRAM_MIN_CHARS,
  type KeywordIndexShape,
  type TableShape,
  type VectorIndexShape,
  tableShape,
  assertSourceId,
  containsPattern,
  dropKeywordIndexDdl,
  ftsPhrase,
  generationDdl,
  generationTable,
  keywordIndexDdl,
  keywordIndexShape,
  keywordNames,
  keywordTerms,
  legacyTable,
  passageTableDdl,
  quoted,
  dropVectorIndexDdl,
  organizationIndexDdl,
  vectorBackfillSql,
  vectorIndexDdl,
  vectorIndexNames,
  vectorIndexShape,
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
  /**
   * The passage count at or above which a complete build of a source makes
   * its approximate vector index (a side table of one-bit vectors, a 32nd of
   * the float32 ones), so its vector leg ranks `topK × vectorIndexOverfetch`
   * candidates by that index and reads the float32 vector of those alone,
   * instead of every one. Counted when the build completes, on the generation it
   * completes; `Infinity` never makes one. A source whose passage table holds
   * more than one organization never gets one, and is never searched through
   * one. @default 20000
   */
  vectorIndexThreshold?: number;
  /**
   * How many candidates per hit the vector leg reads from the approximate
   * index before the organization, record-scope and metadata filter run: the
   * index ranks before the filter, so a filter that removes candidates is
   * answered from what is left, and a leg left with fewer than
   * {@link VECTOR_MIN_POOL} × `topK` candidates in scope is run again as the
   * exact scan. A whole number, {@link VECTOR_MIN_POOL} or more. @default 40
   */
  vectorIndexOverfetch?: number;
}

/** The passage count at or above which a complete build makes a source's approximate vector index. */
export const VECTOR_INDEX_THRESHOLD = 20_000;

/**
 * How many approximate-index candidates the vector leg reads per hit it
 * ranks. Measured at 200,000 passages of 1,536 dimensions (clustered, topK
 * 10): 10 candidates a hit gave a recall@10 of 0.90 against the exact scan,
 * 40 gave 0.99, 100 gave 1.00, at about the same cost — the one-bit scan
 * reads every row either way.
 */
export const VECTOR_INDEX_OVERFETCH = 40;

/**
 * How many in-scope candidates per hit the approximate vector leg must keep
 * after the filter for its answer to stand; below it the leg runs again as
 * the exact scan. The candidates are ranked before the filter, so a filter
 * that keeps a few percent of the passages leaves a pool from which the
 * float32 re-rank picks the wrong neighbours. Measured at 200,000 passages
 * of 1,536 dimensions (clustered, topK 10, 40 candidates a hit), a pool of
 * at least topK gave a recall@10 of 0.95 with 10% of the passages in scope,
 * 0.91 at 5% and 0.88 at 3%; a pool of at least 4 × topK still left a query
 * at 0.7 with 10% in scope. At 8 × topK alone a scope of 15% or less runs
 * exact; {@link VECTOR_RETRY_POOL} is what answers those first.
 */
const VECTOR_MIN_POOL = 8;

/**
 * How many times the first pass's candidates a second approximate pass
 * reads, when the first leaves fewer than {@link VECTOR_MIN_POOL} × topK in
 * scope: the same `WHERE` over the nearest `topK × vectorIndexOverfetch × 10`
 * by their one-bit vector, kept only if it clears the same floor; otherwise
 * the leg runs exact. It is tried only when the first pass's pool, scaled by
 * this factor, reaches the floor, so a scope too narrow for it goes to the
 * exact scan without a pass that could not answer; and never under a scope
 * of record terms alone, whose exact scan the record index serves from the
 * rows in scope. Measured at 200,000 passages of 1,536 dimensions
 * (clustered, topK 10, 40 candidates a hit), 50 queries a share: under a
 * parent (metadata) scope keeping 10%, 15% and 20% of the passages, the
 * exact scan's p95 was 848, 907 and 908 ms and the search's with this pass
 * 351, 328 and 337 ms, at the floor's recall; under a record scope the
 * exact scan's was 128, 207 and 265 ms, and the search's with this pass
 * 333, 313 and 407 ms.
 */
const VECTOR_RETRY_POOL = 10;

/**
 * How many times the floor ({@link VECTOR_MIN_POOL} × topK) the first
 * approximate pass must be expected to keep in scope for a scope of record
 * terms alone to take it: its `topK × vectorIndexOverfetch` candidates times
 * the share of the passages in scope. A narrower scope goes straight to the
 * exact scan, which the record index serves from the rows in scope; the
 * one-bit pass reads every row of the table, and under such a scope it often
 * leaves a pool under the floor, so the exact scan follows it anyway. With
 * the default 40 candidates a hit, the cut-over is 25% of the passages in
 * scope. Measured at 200,000 passages of 1,536 dimensions (clustered, topK
 * 10), 50 queries a share, the p95 of the exact scan and of the search
 * through the one-bit pass first: at 20% in scope 228 and 373 ms (48% of the
 * queries ran both), at 25% 308 and 200 ms (2% ran both), at 10% 133 and
 * 282, at 35% 435 and 188, at 50% 689 and 221.
 */
const VECTOR_RECORD_SCOPE_POOL = 1.25;

/** At most how many of a record scope's ids the estimate of its passages counts ({@link VECTOR_RECORD_SCOPE_POOL}). */
const VECTOR_SCOPE_SAMPLE = 256;

/** How many passages one batch of a vector index's copy writes: each batch is a transaction of its own, so a search waits at most one batch. */
const VECTOR_BACKFILL_BATCH = 2048;

/** The ADR-0112 code of a write or a search refused under another fingerprint (ADR-0161 K7, rules 4 and 5). */
export const KNOWLEDGE_REBUILD_REQUIRED = 'KNOWLEDGE_REBUILD_REQUIRED';

/** How many times {@link TursoKnowledgeAdapter.upsert} plans a batch again when a concurrent write removed a passage it meant to keep. */
const UPSERT_ATTEMPTS = 3;

/** How many times {@link TursoKnowledgeAdapter.search} runs again when the active generation was switched under it. */
const SEARCH_ATTEMPTS = 3;

/** The standard ADR-0112 code of a search whose source's index was switched under it on every attempt. */
const CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION';

/** The standard ADR-0112 code of a build's call refused because the generation it began is gone, as pgvector answers. */
const LOCK_CONFLICT = 'LOCK_CONFLICT';

/** The `k` of reciprocal rank fusion: a passage at rank `r` of a leg adds `1 / (k + r)` to its score. */
export const RRF_K = 60;

/** A generation row: one index of one source under one fingerprint. */
interface GenerationRow {
  generation: number;
  fingerprint: string | null;
  recipeHash: string | null;
  dim: number;
  state: 'active' | 'building';
  /** When the row was made (`created_at`): with the number, what tells a generation from a later one of that number. */
  createdAt: string;
}

/**
 * The generation a build began, as `beginBuild` read it. Generation numbers
 * are reused — the next one is the source's highest plus one, so after a drop
 * or a replaced build a new generation can take the number again — so the
 * build knows its generation by the number, the time its row was made and its
 * fingerprint.
 */
type BuildMark = Pick<GenerationRow, 'generation' | 'createdAt' | 'fingerprint'>;

/** Whether `g` is the generation `mark` names: the one the build began, not a later one under its number. */
function isBuildGeneration(g: GenerationRow | undefined, mark: BuildMark): g is GenerationRow {
  return (
    g !== undefined && g.generation === mark.generation && g.createdAt === mark.createdAt && g.fingerprint === mark.fingerprint
  );
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
 * Two legs, merged by reciprocal rank fusion (`k` = {@link RRF_K}) before the
 * knowledge service re-checks each hit as the caller. Each leg ranks at most
 * `topK` passages; a passage's score is the sum of `1 / (k + rank)` over the
 * legs that rank it, divided by the score of a passage first in both, so it
 * lies in `(0, 1]`.
 *
 * - The vector leg: by cosine distance to the stored float32 vector. A
 *   passage whose cosine similarity is not positive is not ranked by it. An
 *   exact scan of the rows in scope — or, for a generation with an
 *   approximate index ({@link buildVectorIndex}) and passages of one
 *   organization at most, the `topK × vectorIndexOverfetch` candidates
 *   nearest by their one-bit vector, of which those in scope are ranked by
 *   their float32 vector; a leg the filter leaves with fewer than
 *   {@link VECTOR_MIN_POOL} × `topK` candidates in scope, or short of
 *   `topK` hits, is run once more over {@link VECTOR_RETRY_POOL} times the
 *   candidates when its pool says that can clear the floor and its scope is
 *   not of record terms alone, and is run again exactly otherwise, or when
 *   that pass falls short too. A scope of record terms alone that keeps too
 *   few passages for the first pass to be expected to clear the floor
 *   ({@link VECTOR_RECORD_SCOPE_POOL}) goes straight to the exact scan.
 * - The keyword leg: the query's terms ({@link keywordTerms}). A term of three
 *   characters or more is matched as one FTS5 phrase in the passage table's
 *   trigram index (so `X-200` is a phrase, never FTS5 syntax); a shorter one
 *   (「出差」), which a trigram index cannot match, by `content LIKE` over the
 *   rows in scope. A passage's keyword score sums, over the terms it holds,
 *   the term's BM25 inverse document frequency among the rows in scope, so a
 *   term most passages hold weighs little.
 *
 * The organization filter (ADR-0161 K8, item 9), the record scope (item 17)
 * and the metadata-equality `filter` are one `WHERE`, run in both legs: before
 * the exact scan and the keyword leg rank, after the approximate index,
 * which ranks every passage of the table first — so that index is never used
 * over the passages of two organizations, and its candidates are over-fetched.
 *
 * The keyword index of a passage table is made with the table, and for a
 * table made before it existed, by the first search of that table, from the
 * rows it holds, in one transaction ({@link keywordIndexDdl}). Triggers keep
 * it in step with every write, removal and drop of the table's rows.
 *
 * ## Generations (ADR-0161 K7; K8, item 8)
 *
 * A source holds an active generation and, while a build under another
 * fingerprint runs, one generation under construction — at most one per
 * source, by a unique index on the generation table. That index does not
 * refuse a second builder: a second build under the same fingerprint joins
 * the one under way, and one under another fingerprint replaces it (the first
 * builder's writes are then refused). A build's writes, listing and
 * completion go to the generation that build began and to no other: when it
 * is gone — the source was dropped, in this process or another, or another
 * build replaced it — the build ends and the call is refused `LOCK_CONFLICT`
 * (409), so a build never opens a generation and never brings a dropped
 * source back. A write
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
  /**
   * The builds this adapter began and has not ended, by source id: the
   * generation each one builds into, as begun. A build's writes, listing and
   * completion go to that generation and to no other (`writeTarget`).
   */
  private readonly builds = new Map<string, BuildMark>();
  /** Sources whose legacy table is known to be absent. */
  private readonly noLegacy = new Set<string>();
  /** Passage tables whose keyword index is known to be complete. */
  private readonly keyed = new Set<string>();
  /**
   * Whether the approximate vector index of a generation instance (its
   * passage table and the time its generation row was made, {@link
   * vectorIndexKey}) is complete, as this process last found it: kept true by
   * the triggers while the instance lasts.
   */
  private readonly vectorIndexKnown = new Map<string, boolean>();
  /**
   * Sources whose last complete build did not make their approximate vector
   * index because the database refused it, with the reason: named by
   * {@link healthCheck} until a later build of the source makes it.
   */
  private readonly vectorIndexRefused = new Map<string, string>();
  private readonly vectorIndexThreshold: number;
  private readonly vectorIndexOverfetch: number;

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
    const threshold = opts.vectorIndexThreshold ?? VECTOR_INDEX_THRESHOLD;
    if (Number.isNaN(threshold) || threshold < 1) {
      throw new RangeError(`knowledge-turso: vectorIndexThreshold must be a number of passages, 1 or more, got ${String(threshold)}`);
    }
    this.vectorIndexThreshold = threshold;
    const overfetch = opts.vectorIndexOverfetch ?? VECTOR_INDEX_OVERFETCH;
    if (!Number.isInteger(overfetch) || overfetch < VECTOR_MIN_POOL) {
      throw new RangeError(
        `knowledge-turso: vectorIndexOverfetch must be a whole number, ${VECTOR_MIN_POOL} or more, got ${String(overfetch)}`,
      );
    }
    this.vectorIndexOverfetch = overfetch;
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
    assertSourceId(ctx.source.name);
    const embedder = this.requireEmbedder();
    await this.ready();
    // An unchanged passage is rewritten in place, keeping its vector. When its
    // row is gone by the time the write runs (a concurrent write of the same
    // document removed it), the write is rolled back and planned again, so the
    // passage is embedded and inserted rather than lost.
    for (let attempt = 1; ; attempt++) {
      const target = await this.queued(client, () => this.writeTarget(ctx, embedder, true));
      const missing = await this.writePassages(docs, ctx.source.name, target!, embedder);
      if (missing === undefined) return;
      if (attempt >= UPSERT_ATTEMPTS) {
        throw new Error(
          `knowledge-turso: a concurrent write to source '${ctx.source.name}' removed passages this write meant to keep, ` +
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
        // The generation may have been switched, abandoned or dropped while the
        // embedder answered: write only into the one that was planned, never a
        // later one under its number (its row made at another time).
        const still = await tx.execute({
          sql: `SELECT 1 FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ? AND generation = ? AND fingerprint IS ? AND dim = ? AND created_at = ?`,
          args: [sourceId, target.generation, target.fingerprint, target.dim, target.createdAt],
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
    assertSourceId(ctx.source.name);
    await this.ready();
    // From every generation of the source: a removed document leaves them all.
    await this.queued(client, async () => {
      const { active, building } = await this.generations(ctx.source.name);
      for (const g of [active, building]) {
        if (!g) continue;
        await client.execute({
          sql: `DELETE FROM ${quoted(generationTable(ctx.source.name, g.generation))} WHERE document_id IN (SELECT value FROM json_each(?))`,
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
    assertSourceId(ctx.source.name);
    // The embedder first, as on every other call: without one the service's
    // fingerprint carries no model or width, and comparing it would refuse a
    // healthy index as one to rebuild. No embedder is SERVICE_UNAVAILABLE.
    const embedder = this.requireEmbedder();
    await this.ready();
    return this.queued(client, async () => {
      // The generation the writes go to (ADR-0161 K8, item 1).
      const target = await this.writeTarget(ctx, embedder, false);
      if (!target) return { documents: [] };
      const table = quoted(generationTable(ctx.source.name, target.generation));
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
    assertSourceId(opts.source.name);
    // The embedder first: without one the service's fingerprint carries no
    // model or width, and comparing it would refuse a healthy index as one to
    // rebuild. No embedder is SERVICE_UNAVAILABLE, as on every other call.
    const embedder = this.requireEmbedder();
    await this.ready();
    const { active, building } = await this.queued(client, () => this.generations(opts.source.name));
    if (!active) {
      if (await this.queued(client, () => this.hasLegacy(opts.source.name))) {
        throw rebuildRequired(opts.source.name, building !== undefined);
      }
      return [];
    }
    // Vectors of two fingerprints are never ranked against each other (K7, rule 5).
    if (opts.index !== undefined && active.fingerprint !== opts.index.fingerprint) {
      throw rebuildRequired(opts.source.name, building?.fingerprint === opts.index.fingerprint);
    }
    if (embedder.dimensions !== active.dim) throw rebuildRequired(opts.source.name, false);
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
    const vectorLeg = !vector.every((x) => x === 0);
    const terms = keywordTerms(query);
    if (!vectorLeg && terms.length === 0) return [];

    // One WHERE for both legs: the organization filter, the record scope and
    // the metadata filter, each bound as values. ?1 is the query vector.
    const args: unknown[] = [vectorLiteral(vector)];
    const where: string[] = [];
    // Whether the record index can serve the exact scan: a scope of record terms alone.
    let recordScope = false;
    // The ids of the scope's record terms, term by term.
    const recordTerms: string[][] = [];
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
      const scopeTerms: string[] = [];
      let parentTerm = false;
      for (const term of opts.scope) {
        if (term.ids.length === 0) continue;
        args.push(JSON.stringify(term.ids));
        const ids = `(SELECT value FROM json_each(?${args.length}))`;
        if (term.kind === 'record') {
          scopeTerms.push(`source_record_id IN ${ids}`);
          recordTerms.push(term.ids);
          continue;
        }
        parentTerm = true;
        args.push(term.field);
        scopeTerms.push(
          `EXISTS (SELECT 1 FROM json_each(metadata) AS m WHERE m.key = ?${args.length} AND (` +
            `(m.type IN ${SCOPE_SCALAR_TYPES} AND CAST(m.value AS TEXT) IN ${ids}) OR ` +
            `(m.type = 'array' AND EXISTS (SELECT 1 FROM json_each(m.value) AS e ` +
            `WHERE e.type IN ${SCOPE_SCALAR_TYPES} AND CAST(e.value AS TEXT) IN ${ids}))))`,
        );
      }
      where.push(`(${scopeTerms.join(' OR ')})`);
      recordScope = !parentTerm;
    }
    for (const [key, value] of Object.entries(opts.filter ?? {})) {
      args.push(key, JSON.stringify(value === undefined ? null : value));
      where.push(
        `EXISTS (SELECT 1 FROM json_each(metadata) WHERE key = ?${args.length - 1} AND ${METADATA_VALUE_JSON} = json(?${args.length}))`,
      );
    }
    const inScope = where.length === 0 ? 'TRUE' : where.join(' AND ');
    args.push(topK);
    const limit = `?${args.length}`;
    const tableName = generationTable(opts.source.name, active.generation);
    const table = quoted(tableName);
    const vectorIndex = vectorIndexNames(tableName);

    const legs: string[] = [];
    const ctes: string[] = [];
    // The vector leg, exact or approximate: the same in-scope WHERE and the
    // same order by the stored vector's cosine distance, over every row in
    // scope, or over those of the approximate index's `candidates` nearest
    // that are in scope (`pool`) — that index ranks before the filter, so its
    // candidates are filtered after, and the statement answers how many were
    // left. Either way the leg's ranks 1…topK feed the fusion below as they are.
    const vectorCtes = (approximate: boolean): string[] => {
      // The candidate count is bound for the approximate statement alone, after every other value.
      const candidates = `?${args.length + 1}`;
      const pool = approximate
        ? `SELECT chunk_id, vector_distance_cos(embedding, vector32(?1)) AS distance FROM ${table} WHERE ${inScope}
             AND chunk_id IN (SELECT chunk_id FROM ${quoted(vectorIndex.side)}
               ORDER BY vector_distance_cos(embedding, vector1bit(?1)) LIMIT ${candidates})`
        : `SELECT chunk_id, vector_distance_cos(embedding, vector32(?1)) AS distance FROM ${table} WHERE ${inScope}`;
      const ranked = (from: string) => `vec AS (
        SELECT chunk_id, row_number() OVER (ORDER BY distance, chunk_id) AS pos FROM ${from}
         WHERE distance < 1 ORDER BY distance, chunk_id LIMIT ${limit})`;
      return approximate ? [`pool AS (${pool})`, ranked('pool')] : [ranked(`(${pool})`)];
    };
    if (vectorLeg) legs.push('SELECT chunk_id, pos AS vpos, NULL AS kpos FROM vec');
    if (terms.length > 0) {
      // A term's match: the trigram index for three characters or more, LIKE
      // over the rows in scope below that.
      const { map, fts } = keywordNames(tableName);
      const matches = terms.map((term) => {
        if ([...term].length >= TRIGRAM_MIN_CHARS) {
          args.push(ftsPhrase(term));
          return `(chunk_id IN (SELECT k.chunk_id FROM ${quoted(fts)} JOIN ${quoted(map)} k ON k.id = ${quoted(fts)}.rowid
                     WHERE ${quoted(fts)} MATCH ?${args.length}))`;
        }
        args.push(containsPattern(term));
        return `(content LIKE ?${args.length} ESCAPE '\\')`;
      });
      const idf = matches
        .map((_, i) => `h${i} * ln(1.0 + (stats.n - stats.d${i} + 0.5) / (stats.d${i} + 0.5))`)
        .join(' + ');
      // Passages of equal keyword score are ranked by cosine distance, so the
      // keyword leg never reorders by chunk id what the vector leg ranks.
      const distance = vectorLeg ? 'vector_distance_cos(embedding, vector32(?1))' : '0';
      ctes.push(
        `cand AS (SELECT chunk_id, ${distance} AS distance, ${matches.map((m, i) => `${m} AS h${i}`).join(', ')}
           FROM ${table} WHERE ${inScope} AND (${matches.join(' OR ')}))`,
        `stats AS (SELECT (SELECT count(*) FROM ${table} WHERE ${inScope}) AS n,
           ${matches.map((_, i) => `coalesce(sum(h${i}), 0) AS d${i}`).join(', ')} FROM cand)`,
        `kw AS (
          SELECT chunk_id, row_number() OVER (ORDER BY score DESC, distance, chunk_id) AS pos FROM (
            SELECT cand.chunk_id, cand.distance, ${idf} AS score FROM cand, stats
          ) ORDER BY score DESC, distance, chunk_id LIMIT ${limit})`,
      );
      legs.push('SELECT chunk_id, NULL AS vpos, pos AS kpos FROM kw');
    }
    // `candidates`: the approximate statement over that many one-bit candidates; absent, the exact one.
    const statement = (candidates?: number): InStatement => ({
      sql: `WITH ${[...(vectorLeg ? vectorCtes(candidates !== undefined) : []), ...ctes].join(',\n')}
              SELECT p.chunk_id, p.document_id, p.source_record_id, p.content, p.title, p.metadata, p.doc_hash,
                     p.heading_path, u.vpos, u.kpos${candidates !== undefined ? ', (SELECT count(*) FROM pool) AS pool' : ''}
                FROM (SELECT chunk_id, min(vpos) AS vpos, min(kpos) AS kpos FROM (${legs.join(' UNION ALL ')})
                       GROUP BY chunk_id) u
                JOIN ${table} p ON p.chunk_id = u.chunk_id`,
      args: (candidates !== undefined ? [...args, candidates] : args) as InArgs,
    });
    const result = await this.queued(client, async () => {
      // The generation may have been switched while the query was embedded.
      const now = await this.generations(opts.source.name);
      if (now.active?.generation !== active.generation) return undefined;
      if (terms.length > 0) await this.ensureKeywordIndex(tableName);
      const instance = now.active.createdAt;
      if (vectorLeg && (await this.approximateSearchable(tableName, instance))) {
        const candidates = topK * this.vectorIndexOverfetch;
        // A scope of record terms alone that the first pass is not expected
        // to answer goes straight to the exact scan, which the record index
        // serves from the rows in scope.
        if (recordScope && (await this.recordScopeUnderCut(client, tableName, recordTerms))) return client.execute(statement());
        // A failed approximate statement (its index gone under this process's
        // memory of it) forgets that memory and is answered by the exact scan.
        const approximate = (candidates: number) =>
          client.execute(statement(candidates)).catch(() => {
            this.vectorIndexKnown.delete(vectorIndexKey(tableName, instance));
            return undefined;
          });
        // A vector leg the filter left with fewer than VECTOR_MIN_POOL × topK
        // candidates in scope does not stand: the float32 re-rank of a thin
        // pool misses neighbours the one-bit ranking put past the cut, and an
        // answer of fewer than topK says the source holds no more, which the
        // candidates cannot say.
        const poolOf = (near: ResultSet) => Number(near.rows[0]?.pool ?? 0);
        const stands = (near: ResultSet) =>
          poolOf(near) >= VECTOR_MIN_POOL * topK && near.rows.filter((r) => r.vpos !== null).length >= topK;
        const near = await approximate(candidates);
        if (near === undefined) return client.execute(statement());
        if (stands(near)) return near;
        // Such a leg tries VECTOR_RETRY_POOL times the candidates once, under
        // the same floor, when the first pool says the wider one can reach it;
        // otherwise, or short again, the exact scan answers. Not under a scope
        // of record terms alone: the record index serves that exact scan from
        // the rows in scope, which costs less than the wider pass.
        if (!recordScope && poolOf(near) * VECTOR_RETRY_POOL >= VECTOR_MIN_POOL * topK) {
          const wide = await approximate(candidates * VECTOR_RETRY_POOL);
          if (wide !== undefined && stands(wide)) return wide;
        }
      }
      return client.execute(statement());
    });
    if (result === undefined) {
      // Switched while the query was embedded: searched again, a bounded number of times.
      if (attempt >= SEARCH_ATTEMPTS) {
        throw switchedDuringSearch(
          "its source's index was switched while it searched",
          `The active generation of source '${opts.source.name}' changed ${SEARCH_ATTEMPTS} times during one search; retry it.`,
        );
      }
      return this.searchAttempt(query, opts, attempt + 1);
    }
    return fuse(result.rows, topK).map(({ row: r, score }) => {
      const headingPath = parseJson(r.heading_path);
      return {
        chunkId: String(r.chunk_id),
        documentId: String(r.document_id),
        sourceId: opts.source.name,
        ...(r.source_record_id === null ? {} : { sourceRecordId: String(r.source_record_id) }),
        score,
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
    assertSourceId(ctx.source.name);
    await this.ready();
    const { active, building } = await this.queued(client, () => this.generations(ctx.source.name));
    const status: AdapterIndexStatus = {};
    if (active?.fingerprint != null) status.fingerprint = active.fingerprint;
    if (active?.recipeHash != null) status.recipeHash = active.recipeHash;
    if (building !== undefined) status.building = true;
    return status;
  }

  async beginBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'beginBuild');
    const client = this.requireClient();
    assertSourceId(ctx.source.name);
    const embedder = this.requireEmbedder();
    await this.ready();
    // The generation taken is the one this build writes into, lists and
    // completes; a build that does not begin ends any this adapter had.
    try {
      await this.queued(client, async () => {
        const legacy = await this.hasLegacy(ctx.source.name);
        const begun = await this.transaction(async (tx) => {
          const { active, building } = await this.generations(ctx.source.name, tx);
          const fits = (g: GenerationRow): boolean => g.fingerprint === index.fingerprint && g.dim === embedder.dimensions;
          // The build under way taken up, or rebuilt inside the active generation.
          if (building !== undefined && fits(building)) return { commit: true, value: building };
          if (active !== undefined && fits(active)) return { commit: true, value: active };
          if (building) {
            // A build of another fingerprint left unfinished: replaced, one per source.
            await this.dropGenerationTable(tx, ctx.source.name, building.generation);
            await tx.execute({
              sql: `DELETE FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ? AND generation = ?`,
              args: [ctx.source.name, building.generation],
            });
          }
          // A source that holds nothing takes the fingerprint as its active one;
          // beside an active generation, or a legacy table, it is built aside.
          const state = active === undefined && !legacy ? 'active' : 'building';
          return { commit: true, value: await this.openGeneration(tx, ctx.source.name, index.fingerprint, embedder, state) };
        });
        this.builds.set(ctx.source.name, {
          generation: begun.generation,
          createdAt: begun.createdAt,
          fingerprint: begun.fingerprint,
        });
      });
    } catch (err) {
      this.builds.delete(ctx.source.name);
      throw err;
    }
  }

  async completeBuild(ctx: AdapterContext): Promise<void> {
    const index = requireIndex(ctx, 'completeBuild');
    const client = this.requireClient();
    assertSourceId(ctx.source.name);
    await this.ready();
    // The approximate vector index of the generation this build completes,
    // made before that generation is switched to, a batch at a time.
    await this.buildVectorIndex(ctx.source.name, index.fingerprint);
    await this.queued(client, async () => {
      const legacy = await this.hasLegacy(ctx.source.name);
      await this.transaction(async (tx) => {
        const { active, building } = await this.generations(ctx.source.name, tx);
        const t = quoted(GENERATION_TABLE);
        // A build this adapter began completes the generation it began and no
        // other: gone (the source was dropped, in any process) or replaced by
        // another build, it switches, records and drops nothing.
        const mine = this.builds.get(ctx.source.name);
        const target =
          building?.fingerprint === index.fingerprint ? building : active?.fingerprint === index.fingerprint ? active : undefined;
        if (mine !== undefined && !isBuildGeneration(target, mine)) throw buildEnded(ctx.source.name);
        if (building?.fingerprint === index.fingerprint) {
          if (active) {
            await this.dropGenerationTable(tx, ctx.source.name, active.generation);
            await tx.execute({ sql: `DELETE FROM ${t} WHERE source_id = ? AND generation = ?`, args: [ctx.source.name, active.generation] });
          }
          await tx.execute({
            sql: `UPDATE ${t} SET state = 'active', recipe_hash = ? WHERE source_id = ? AND generation = ?`,
            args: [index.recipeHash, ctx.source.name, building.generation],
          });
        } else if (active?.fingerprint === index.fingerprint) {
          await tx.execute({
            sql: `UPDATE ${t} SET recipe_hash = ? WHERE source_id = ? AND generation = ?`,
            args: [index.recipeHash, ctx.source.name, active.generation],
          });
        } else {
          throw new Error(
            `completeBuild: source '${ctx.source.name}' holds no generation for this fingerprint; call beginBuild first.`,
          );
        }
        // The table of the store's earlier releases goes once a generation is active.
        if (legacy) await tx.execute(`DROP TABLE IF EXISTS ${quoted(legacyTable(ctx.source.name))}`);
        return { commit: true, value: undefined };
      });
      if (legacy) this.noLegacy.add(ctx.source.name);
    }).finally(() => this.builds.delete(ctx.source.name));
  }

  /**
   * Everything held for the source is removed (ADR-0161 K8, item 4), in one
   * write transaction: the table and the row of each generation — the active
   * one and one under construction — and the table of the store's earlier
   * releases, when the source still has one. A source it holds nothing for is
   * no error. A table the store did not make under a generation's name is
   * refused and nothing is removed (`dropGenerationTable`).
   *
   * A build of the source under way, in this process or another, does not
   * hold the drop back: its generation is dropped with the rest, and its next
   * write, listing or completion is refused `LOCK_CONFLICT` and ends it (see
   * `writeTarget`), so it never brings the source back. A build that begins
   * after the drop builds the source from nothing.
   */
  async dropSource(ctx: AdapterContext): Promise<void> {
    const client = this.requireClient();
    const sourceId = ctx.source.name;
    assertSourceId(sourceId);
    await this.ready();
    await this.queued(client, async () => {
      const legacy = await this.hasLegacy(sourceId);
      await this.transaction(async (tx) => {
        const { active, building } = await this.generations(sourceId, tx);
        for (const g of [active, building]) {
          if (g !== undefined) await this.dropGenerationTable(tx, sourceId, g.generation);
        }
        await tx.execute({ sql: `DELETE FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ?`, args: [sourceId] });
        if (legacy) await tx.execute(`DROP TABLE IF EXISTS ${quoted(legacyTable(sourceId))}`);
        return { commit: true, value: undefined };
      });
      if (legacy) this.noLegacy.add(sourceId);
      this.vectorIndexRefused.delete(sourceId);
    });
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      this.requireClient();
      await this.ready();
      // A refused approximate vector index is a speed-up lost, never a fault:
      // `ok` stays true, and the message names it for the operator.
      const notes: string[] = [];
      if (this.vectorIndexThreshold !== Infinity && !(await oneBitVectorsWork(this.requireClient()))) {
        notes.push(
          'this database does not compute one-bit vectors (vector1bit), so no source gets an approximate vector ' +
            'index and every search reads every vector in scope',
        );
      }
      for (const [sourceId, reason] of this.vectorIndexRefused) {
        notes.push(`the approximate vector index of source '${sourceId}' was not made: ${reason}`);
      }
      return { ok: true, message: ['libSQL vectors ready', ...notes].join('; ') };
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
   * then the generation table — made, or found with exactly its columns. A
   * table of that name the store did not make (in a database shared with
   * object tables, one an object of that name owns) is never taken for it and
   * never touched: the store is not ready, naming the table. Until that
   * succeeds the next call tries again.
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
      // `CREATE TABLE IF NOT EXISTS` passes over any table of the name, so the
      // shape is read first; its indexes would otherwise be added to that table.
      const shape = await this.shapeOf(client, GENERATION_TABLE);
      if (shape !== 'none' && shape !== 'generation') {
        throw notReady(
          `a table it did not make holds the name of its generation table, '${GENERATION_TABLE}'`,
          `The database holds a table '${GENERATION_TABLE}' whose columns are not those of this store's generation ` +
            'table, so the store cannot keep its index generations there; that table is left as it is. Rename or ' +
            'remove it, or keep the store in a database of its own.',
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
      sql: `SELECT generation, fingerprint, recipe_hash, dim, state, created_at FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ?`,
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
        createdAt: String(r.created_at),
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

  /**
   * Drops the passage table of one generation of a source, by the name its
   * generation row gives — only when that table is one of this store's
   * passage tables (or there is none). A table of any other shape under that
   * name, one the store did not make in a database shared with object tables,
   * is refused and never dropped; the transaction `tx` belongs to is rolled
   * back with the refusal, so nothing of the call is removed.
   */
  private async dropGenerationTable(tx: Transaction, sourceId: string, generation: number): Promise<void> {
    const table = generationTable(sourceId, generation);
    const shape = await this.shapeOf(tx, table);
    if (shape !== 'none' && shape !== 'passage') {
      throw notReady(
        `a table it did not make, '${table}', holds the name of generation ${generation} of source '${sourceId}'`,
        `The database holds a table '${table}' that is not one of this store's generation tables, so it is not ` +
          `dropped, and generation ${generation} of source '${sourceId}' cannot be replaced or removed. Rename or ` +
          'remove that table, or keep the store in a database of its own.',
      );
    }
    await this.assertKeywordIndexOurs(tx, table, sourceId, generation);
    await this.assertVectorIndexOurs(tx, table, sourceId, generation);
    await tx.execute(`DROP TABLE IF EXISTS ${quoted(table)}`);
    for (const statement of dropKeywordIndexDdl(table)) await tx.execute(statement);
    for (const statement of dropVectorIndexDdl(table)) await tx.execute(statement);
    this.keyed.delete(table);
    this.forgetVectorIndex(table);
  }

  /** The shape of the vector index of the passage table `table` (`vectorIndexShape`). */
  private async vectorShapeOf(db: Pick<Client, 'execute'>, table: string): Promise<VectorIndexShape> {
    const { side, org, triggers } = vectorIndexNames(table);
    const names = [side, org, ...triggers];
    const rows = await db.execute({
      sql: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name IN (${names.map(() => '?').join(', ')})`,
      args: names,
    });
    const columns = await db.execute({ sql: 'SELECT name, type FROM pragma_table_info(?)', args: [side] });
    return vectorIndexShape(table, rows.rows, columns.rows);
  }

  /**
   * Refuses, naming it, an object under one of the vector-index names of
   * `table` that this store did not make; the transaction is rolled back with
   * the refusal, so nothing of the call is removed.
   */
  private async assertVectorIndexOurs(db: Pick<Client, 'execute'>, table: string, sourceId: string, generation: number): Promise<void> {
    if ((await this.vectorShapeOf(db, table)) !== 'other') return;
    throw vectorIndexNotOurs(table, sourceId, generation);
  }

  /**
   * Whether a search of the passage table `table`, of the generation
   * instance whose row was made at `instance`, may rank its vector leg
   * through the approximate index: its side table and triggers are there and
   * hold every passage of the table (read from the catalog once per instance
   * and remembered, either way: the triggers keep a complete index complete,
   * a build of this process records what it found, and with a threshold of
   * `Infinity` nothing is read), and the table holds passages of one
   * organization at most — read at each search, from the organization index,
   * so a second organization written after the index was made turns the
   * table back to the exact scan at once. The index ranks before the
   * organization filter: over two organizations' passages, one
   * organization's candidates would crowd out the other's. Runs inside the
   * client's queue.
   */
  private async approximateSearchable(table: string, instance: string): Promise<boolean> {
    // `Infinity` never makes an index, and never reads the catalog for one.
    if (this.vectorIndexThreshold === Infinity) return false;
    const client = this.requireClient();
    const key = vectorIndexKey(table, instance);
    let complete = this.vectorIndexKnown.get(key);
    if (complete === undefined) {
      complete = (await this.vectorShapeOf(client, table)) === 'complete';
      if (complete) {
        const counts = await client.execute(
          `SELECT (SELECT count(*) FROM ${quoted(table)}) AS n, (SELECT count(*) FROM ${quoted(vectorIndexNames(table).side)}) AS v`,
        );
        complete = Number(counts.rows[0].n) === Number(counts.rows[0].v);
      }
      this.vectorIndexKnown.set(key, complete);
    }
    if (!complete) return false;
    return (await this.organizationsIn(client, table)) <= 1;
  }

  /**
   * Whether a scope of record terms alone, of the ids `terms` hold, keeps
   * fewer of the passages of `table` than the first approximate pass needs to
   * be expected to keep {@link VECTOR_RECORD_SCOPE_POOL} × the floor in scope:
   * a share under that many times {@link VECTOR_MIN_POOL} /
   * `vectorIndexOverfetch`. The passages in scope are estimated from those of
   * at most {@link VECTOR_SCOPE_SAMPLE} of the ids, spread evenly over them,
   * counted through the record index (exactly, for a scope of no more ids),
   * so a record of many passages counts as many and an id of no passage as
   * none (an id two terms name is one id to the count, and weighs twice in
   * the estimate of a sampled scope). The organization and metadata filters
   * are not counted: the exact scan reads every row the record index finds
   * for the scope. Runs inside the client's queue.
   */
  private async recordScopeUnderCut(db: Pick<Client, 'execute'>, table: string, terms: readonly (readonly string[])[]): Promise<boolean> {
    const total = terms.reduce((sum, ids) => sum + ids.length, 0);
    const sample: string[] = [];
    if (total <= VECTOR_SCOPE_SAMPLE) {
      for (const ids of terms) sample.push(...ids);
    } else {
      // The ids at evenly spread positions of the terms taken one after another.
      let term = 0;
      let before = 0;
      for (let i = 0; i < VECTOR_SCOPE_SAMPLE; i++) {
        const at = Math.floor((i * total) / VECTOR_SCOPE_SAMPLE);
        while (at >= before + terms[term].length) before += terms[term++].length;
        sample.push(terms[term][at - before]);
      }
    }
    const t = quoted(table);
    const counted = await db.execute({
      sql: `SELECT (SELECT count(*) FROM ${t}) AS n,
                   (SELECT count(*) FROM ${t} WHERE source_record_id IN (SELECT value FROM json_each(?1))) AS k`,
      args: [JSON.stringify(sample)],
    });
    const n = Number(counted.rows[0].n);
    const inScope = (Number(counted.rows[0].k) * total) / Math.max(1, sample.length);
    return inScope * this.vectorIndexOverfetch < VECTOR_RECORD_SCOPE_POOL * VECTOR_MIN_POOL * n;
  }

  /** Forgets what this process knew of the approximate vector index of every instance of the passage table `table`. */
  private forgetVectorIndex(table: string): void {
    const prefix = vectorIndexKey(table, '');
    for (const key of this.vectorIndexKnown.keys()) if (key.startsWith(prefix)) this.vectorIndexKnown.delete(key);
  }

  /**
   * How many organizations the passages of `table` belong to, counting
   * passages of no organization as one more, up to 2: three seeks of the
   * organization index when the table has one.
   */
  private async organizationsIn(db: Pick<Client, 'execute'>, table: string): Promise<number> {
    const t = quoted(table);
    const found = await db.execute(
      `SELECT (SELECT min(organization_id) FROM ${t}) AS lo, (SELECT max(organization_id) FROM ${t}) AS hi,
              EXISTS (SELECT 1 FROM ${t} WHERE organization_id IS NULL) AS anonymous`,
    );
    const { lo, hi, anonymous } = found.rows[0];
    const named = lo === null ? 0 : lo === hi ? 1 : 2;
    return Math.min(2, named + (Number(anonymous) === 1 ? 1 : 0));
  }

  /**
   * Makes the approximate vector index of the generation of `sourceId` a
   * build under `fingerprint` completes (ADR-0161 K7: the generation under
   * construction, or the active one rebuilt inside), when its passage table
   * holds {@link TursoKnowledgeAdapterOptions.vectorIndexThreshold} passages
   * or more, of one organization at most. The structure is made empty in one
   * transaction, then the table's rows are copied in, {@link
   * VECTOR_BACKFILL_BATCH} at a time, each batch a write transaction of its
   * own on the client's queue: a search waits at most one batch, and is
   * answered by the exact scan until the copy ends. A copy cut short (the
   * process ended) resumes at the next complete build; the triggers keep
   * every write in step meanwhile. A generation switched away or dropped
   * during the copy ends it.
   */
  private async buildVectorIndex(sourceId: string, fingerprint: string): Promise<void> {
    const client = this.requireClient();
    // Each complete build says anew whether the database refused the index.
    this.vectorIndexRefused.delete(sourceId);
    const planned = await this.queued(client, async () => {
      const { active, building } = await this.generations(sourceId);
      const target =
        building?.fingerprint === fingerprint ? building : active?.fingerprint === fingerprint ? active : undefined;
      // No generation of this fingerprint: completeBuild refuses the call.
      if (target === undefined) return undefined;
      const table = generationTable(sourceId, target.generation);
      // What this build finds is what a search of this generation instance would: no index is remembered as such.
      const none = () => {
        this.vectorIndexKnown.set(vectorIndexKey(table, target.createdAt), false);
        return undefined;
      };
      const shape = await this.vectorShapeOf(client, table);
      if (shape === 'other') throw vectorIndexNotOurs(table, sourceId, target.generation);
      if (shape !== 'complete') {
        const count = await client.execute(`SELECT count(*) AS n FROM ${quoted(table)}`);
        if (Number(count.rows[0].n) < this.vectorIndexThreshold) return none();
        // A database that refuses the one-bit vectors (a host whose libSQL
        // lacks them) or the index's DDL keeps the exact scan, and the build
        // completes: the index is a speed-up, never a condition of the build.
        // The probe comes first because a trigger naming an unknown function
        // is created without complaint and then fails every write of a passage.
        if (!(await oneBitVectorsWork(client))) {
          this.vectorIndexRefused.set(sourceId, 'this database does not compute one-bit vectors (vector1bit)');
          return none();
        }
        try {
          await this.transaction(async (tx) => {
            await tx.execute(organizationIndexDdl(table));
            // One organization at most, or no index: it ranks before the organization filter.
            if ((await this.organizationsIn(tx, table)) > 1) return { commit: true, value: undefined };
            for (const statement of vectorIndexDdl(table, target.dim)) await tx.execute(statement);
            return { commit: true, value: undefined };
          });
        } catch (err) {
          this.vectorIndexRefused.set(sourceId, `the database refused its DDL (${errorText(err)})`);
          return none();
        }
        if ((await this.vectorShapeOf(client, table)) !== 'complete') return none();
      }
      return { target, table };
    });
    if (planned === undefined) return;
    const { target, table } = planned;
    const { last, copy } = vectorBackfillSql(table);
    for (let cursor = ''; ; ) {
      // A batch the database refuses ends the copy, and the build completes:
      // a side table short of its passage table is never searched (its count
      // differs), the triggers keep the rows they hold in step, and the next
      // complete build resumes the copy.
      const step = await this.queued(client, () =>
        this.transaction(async (tx) => {
          const still = await tx.execute({
            sql: `SELECT 1 FROM ${quoted(GENERATION_TABLE)} WHERE source_id = ? AND generation = ? AND fingerprint IS ? AND created_at = ?`,
            args: [sourceId, target.generation, target.fingerprint, target.createdAt],
          });
          if (still.rows.length === 0) return { commit: false, value: undefined };
          const upTo = (await tx.execute({ sql: last, args: [cursor, VECTOR_BACKFILL_BATCH] })).rows[0]?.last;
          if (upTo === null || upTo === undefined) return { commit: false, value: undefined };
          await tx.execute({ sql: copy, args: [cursor, String(upTo)] });
          return { commit: true, value: String(upTo) };
        }),
      ).catch((err: unknown) => {
        this.vectorIndexRefused.set(sourceId, `the database refused its copy (${errorText(err)}); the next complete build resumes it`);
        return null;
      });
      if (step === null || step === undefined) {
        // The copy ended, was refused, or its generation went away: the next search reads the index anew.
        this.vectorIndexKnown.delete(vectorIndexKey(table, target.createdAt));
        return;
      }
      cursor = step;
    }
  }

  /** The shape of the keyword index of the passage table `table` (`keywordIndexShape`). */
  private async keywordShapeOf(db: Pick<Client, 'execute'>, table: string): Promise<KeywordIndexShape> {
    const { map, fts, triggers } = keywordNames(table);
    const names = [map, fts, ...triggers];
    const rows = await db.execute({
      sql: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name IN (${names.map(() => '?').join(', ')})`,
      args: names,
    });
    const columns = await db.execute({ sql: 'SELECT name FROM pragma_table_info(?)', args: [map] });
    return keywordIndexShape(table, rows.rows, columns.rows);
  }

  /**
   * Refuses, naming it, an object under one of the keyword-index names of
   * `table` that this store did not make; the transaction is rolled back with
   * the refusal, so nothing of the call is removed.
   */
  private async assertKeywordIndexOurs(db: Pick<Client, 'execute'>, table: string, sourceId: string, generation: number): Promise<void> {
    if ((await this.keywordShapeOf(db, table)) !== 'other') return;
    const { map, fts } = keywordNames(table);
    throw notReady(
      `an object it did not make holds a name of the keyword index of generation ${generation} of source '${sourceId}'`,
      `The database holds a table or trigger under '${map}', '${fts}' or a '${table}-kw-*' trigger that is not this ` +
        `store's keyword index, so it is not dropped, and generation ${generation} of source '${sourceId}' cannot be ` +
        'built, replaced or removed. Rename or remove it, or keep the store in a database of its own.',
    );
  }

  /**
   * Makes the keyword index of an active passage table made before the store
   * kept one, from the rows the table holds, in one write transaction, and
   * never touches an object of those names the store did not make. Runs inside
   * the client's queue; known complete tables are skipped.
   */
  private async ensureKeywordIndex(table: string): Promise<void> {
    if (this.keyed.has(table)) return;
    const client = this.requireClient();
    if ((await this.keywordShapeOf(client, table)) !== 'complete') {
      await this.transaction(async (tx) => {
        // Made by another process between the read and this transaction: kept.
        const shape = await this.keywordShapeOf(tx, table);
        if (shape === 'complete') return { commit: false, value: undefined };
        if (shape === 'other') {
          throw notReady(
            `an object it did not make holds a name of the keyword index of '${table}'`,
            `The database holds a table or trigger under a name of the keyword index of '${table}' that is not this ` +
              "store's, so the keyword index cannot be made and the table is not searched. Rename or remove it, or " +
              'keep the store in a database of its own.',
          );
        }
        for (const statement of keywordIndexDdl(table)) await tx.execute(statement);
        return { commit: true, value: undefined };
      });
    }
    this.keyed.add(table);
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
    if (shape !== 'none' && shape !== 'passage') {
      throw notReady(
        `a table it did not make holds the name of source '${sourceId}''s next index`,
        `The database holds a table '${table}' that is not one of this store's generation tables, so generation ` +
          `${generation} of source '${sourceId}' cannot be built under that name. Rename or remove that table, or keep ` +
          'the store in a database of its own.',
      );
    }
    await this.assertKeywordIndexOurs(tx, table, sourceId, generation);
    await this.assertVectorIndexOurs(tx, table, sourceId, generation);
    // A vector index left behind under this name (its side table outlives the
    // passage table's DROP) is dropped with it: the new table starts without one.
    for (const statement of dropVectorIndexDdl(table)) await tx.execute(statement);
    for (const statement of passageTableDdl(table, embedder.dimensions)) await tx.execute(statement);
    this.keyed.add(table);
    this.forgetVectorIndex(table);
    await tx.execute({
      sql: `INSERT INTO ${quoted(GENERATION_TABLE)} (source_id, generation, fingerprint, dim, model, state) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [sourceId, generation, fingerprint ?? null, embedder.dimensions, embedder.model ?? null, state],
    });
    // Read back, so the row carries the time it was made (`created_at`): the
    // unique indexes hold one row of each state per source, this one.
    return (await this.generations(sourceId, tx))[state]!;
  }

  /**
   * The generation a write carrying `ctx.index` goes to: the active one, when
   * its fingerprint is the one carried (or none is carried); the one under
   * construction, when it is that one's. Refused when it is neither, when the
   * embedder's width is not the generation's, or — outside a build — when the
   * source still has a legacy table. A source that holds nothing gets its first
   * generation (`create`), or none. Runs inside the client's queue.
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
      const mine = [building, active].find((g) => isBuildGeneration(g, build));
      if (mine === undefined) {
        this.builds.delete(sourceId);
        throw buildEnded(sourceId);
      }
      if (fingerprint !== undefined && mine.fingerprint !== fingerprint) throw rebuildRequired(sourceId, false);
      return checked(mine);
    }
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

/** The key of a generation instance in the memory of its approximate vector index: its passage table and the time its row was made. */
function vectorIndexKey(table: string, createdAt: string): string {
  return `${table} @ ${createdAt}`;
}

/**
 * Whether the database computes one-bit vectors and their distance, as the
 * approximate vector index needs (libSQL's `vector1bit`); a database that
 * refuses the probe gets no index.
 */
async function oneBitVectorsWork(db: Pick<Client, 'execute'>): Promise<boolean> {
  try {
    const probe = await db.execute(
      "SELECT vector_distance_cos(vector1bit(vector32('[1,-1,1,-1]')), vector1bit(vector32('[1,-1,1,-1]'))) AS d",
    );
    return Number(probe.rows[0]?.d) === 0;
  } catch {
    return false;
  }
}

/**
 * Reciprocal rank fusion of the two legs' rows (`vpos`, `kpos`: a row's rank
 * in each leg, or null): best first, at most `topK`; a tie goes to the better
 * vector rank, then to the chunk id. The score is the fused sum divided by
 * that of a row first in both legs.
 */
function fuse<R extends Record<string, unknown>>(
  rows: readonly R[],
  topK: number,
): Array<{ row: R; score: number }> {
  const best = 2 / (RRF_K + 1);
  const leg = (pos: unknown) => (pos === null || pos === undefined ? 0 : 1 / (RRF_K + Number(pos)));
  const vectorRank = (row: R) => (row.vpos === null || row.vpos === undefined ? Infinity : Number(row.vpos));
  return rows
    .map((row) => ({ row, score: (leg(row.vpos) + leg(row.kpos)) / best }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        vectorRank(a.row) - vectorRank(b.row) ||
        (String(a.row.chunk_id) < String(b.row.chunk_id) ? -1 : 1),
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
 * A build's write, listing or completion refused because the generation the
 * build began is gone: the source was dropped, or another build replaced it.
 * The same code and status as the pgvector store's.
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
        'The source was removed (its index dropped), or another build of it under another fingerprint replaced this ' +
        'one. Start a reindex again if the source is still served and no build of it is running.',
    },
  );
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

/** The refusal of an object under a vector-index name of `table` that the store did not make. */
function vectorIndexNotOurs(table: string, sourceId: string, generation: number): Error {
  const { side, org } = vectorIndexNames(table);
  return notReady(
    `an object it did not make holds a name of the vector index of generation ${generation} of source '${sourceId}'`,
    `The database holds a table, index or trigger under '${side}', '${org}' or a '${table}-vec-*' trigger ` +
      `that is not this store's vector index, so it is not dropped, and generation ${generation} of source ` +
      `'${sourceId}' cannot be built, replaced or removed. Rename or remove it, or keep the store in a database of its own.`,
  );
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
