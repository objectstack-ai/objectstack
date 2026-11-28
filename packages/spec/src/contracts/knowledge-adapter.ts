// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  KnowledgeDocument,
  KnowledgeHit,
} from '../ai/knowledge-document.zod';
import type { KnowledgeSource } from '../ai/knowledge-source.zod';

/**
 * `IKnowledgeAdapter` — plugin-side contract.
 *
 * Each backend (an in-memory cosine adapter, PostgreSQL + pgvector, a
 * libSQL file, an adapter over an external engine, …) ships as its own
 * plugin package and implements this interface. The adapter is then
 * registered with the host's `IKnowledgeService` via
 * `registerAdapter(id, this)` during the plugin's `start()` hook.
 *
 * The contract carries what an adapter REPORTS, never how it is configured
 * (ADR-0161 K8, rule 4): no embedding configuration, no rerank toggles.
 * Adapters that need extra knobs expose them via their plugin options
 * object. The split belongs to the service (ADR-0161 K1): an adapter that
 * declares `capabilities.chunks` receives the service's passages.
 *
 * See `content/docs/protocol/knowledge.mdx`.
 */

/**
 * Context passed to every adapter call. Carries the resolved source
 * (so the adapter can locate its dataset / collection / table) and
 * optional trace metadata. Adapters MUST treat unknown fields as
 * forwards-compatible.
 */
export interface AdapterContext {
  /**
   * The source these documents belong to, as the service hands it over.
   *
   * `source.name` is the source's **index key**: the one string an adapter
   * keys everything it holds for the source by, and the string
   * `KnowledgeDocument.sourceId` carries. For a source no package holds it is
   * the name as authored. For a source a package ships it also carries that
   * package (ADR-0150 D4), spelled by the service, so two packages' sources of
   * one name are two keys. An adapter never derives the key, parses it or
   * shows it to a person; it stores and compares it.
   */
  source: KnowledgeSource;
  /** Trace id for correlation across logs / metrics. */
  traceId?: string;
  /** Caller-supplied free-form diagnostics tag. */
  reason?: 'event-sync' | 'reindex' | 'manual' | 'tool-call' | (string & {});
  /**
   * What the knowledge service expects of the source's index (ADR-0161 K8,
   * item 8 a), set by the service on every call it makes. Absent on a call
   * that does not come through the service; an adapter then checks nothing
   * against it.
   */
  index?: AdapterIndexExpectation;
}

/**
 * The fingerprint and the recipe hash the knowledge service expects of a
 * source's index (ADR-0161 K7; K8, item 8 a). Both are computed by the
 * service, in one function each, over values: opaque to the adapter, which
 * only compares and stores them.
 */
export interface AdapterIndexExpectation {
  /**
   * The index fingerprint: the embedding model (and any option of the adapter
   * that changes the vectors it stores), the dimensions, the split
   * configuration, the split algorithm version and the content recipe. Two
   * vectors are comparable only under one fingerprint: a write or a search
   * whose fingerprint differs from the active generation's is never served
   * from it (K7, rules 1, 4 and 5).
   */
  fingerprint: string;
  /**
   * The recipe hash: what assembly reads that the fingerprint leaves out —
   * the source's `where`, its `metadataFields`, the title rule and the fields
   * an index may not carry. A changed recipe hash is repaired by a complete
   * rebuild inside the same generation; the adapter records it only at the
   * end of a complete build (`completeBuild`).
   */
  recipeHash: string;
}

/**
 * What an adapter holds for a source (ADR-0161 K8, item 8 b), as
 * `indexStatus` answers it. Every member absent: the adapter holds nothing
 * for the source.
 */
export interface AdapterIndexStatus {
  /** The fingerprint of the active generation, when it has one. */
  fingerprint?: string;
  /** The recipe hash recorded by the last complete build of the active generation. */
  recipeHash?: string;
  /** `true` while a generation opened by `beginBuild` is under construction. */
  building?: boolean;
}

/** Options accepted by `IKnowledgeAdapter.search`. */
export interface AdapterSearchOptions {
  /** The source the search is scoped to. */
  source: KnowledgeSource;
  /** Max hits to return. */
  topK: number;
  /** Adapter-specific filter (e.g. `{ status: 'active' }`). */
  filter?: Record<string, unknown>;
  /**
   * The record scope of this search (ADR-0161 K8, item 17, as its dated note
   * of 2026-11-25 shapes it): a list of {@link AdapterScopeTerm}s the knowledge
   * service builds from `KnowledgeSearchOptions.scope` for this source. The
   * term's shape is the service's, never the caller's `{ object, ids }`:
   * turning an object into a field needs the object's registered definition,
   * which is the platform's. A `metadata` term's `field` is a name from the
   * source's `metadataFields`. A term's `ids` are the caller's strings as
   * given, checked only against the bounds below, so an adapter binds them as
   * query parameters and never splices them into a query's text.
   *
   * - **Absent** (`undefined`): no scope. Rank every document of the source,
   *   as before this member.
   * - **Present**: rank only the documents some term holds for, and filter
   *   BEFORE ranking, so `topK` is filled from in-scope documents alone. The
   *   terms are a union: a document is in scope when any one of them holds.
   * - **Empty** (`[]`), or a term whose `ids` is empty: that holds for no
   *   document. Never read as "no filter".
   *
   * `organizationIds`, `scope` and the opaque `filter` all apply: a document is
   * ranked only when it passes each one that is present.
   *
   * **Bounds an adapter can rely on.** The service refuses a scope past its
   * bounds before any adapter is called, so a search hands at most 10 terms,
   * each with at most 500 ids, every id a non-empty string. A `metadata` term's
   * ids can go into one `IN` list on a stored column.
   *
   * **The service checks every hit after the adapter answers**, whatever the
   * adapter did: a `record` term on `KnowledgeHit.sourceRecordId`, a `metadata`
   * term on `KnowledgeHit.metadata[field]`, and a hit that does not carry the
   * value is dropped (fail closed). So an adapter returns the document's
   * `metadata` on its hits. An adapter that ignores this member keeps working:
   * out-of-scope documents then take ranking places the check empties, so its
   * scoped searches may answer fewer than `topK`, and the service logs that
   * once for the adapter.
   *
   * A ranking scope, not the access decision: the service still re-reads every
   * object-source hit as the caller.
   */
  scope?: AdapterScopeTerm[];
  /**
   * The caller's organizations (ADR-0161 K8, item 9), computed by the knowledge
   * service from the caller's identity and the deployment's tenancy posture
   * (ADR-0105 D1) — never taken from a caller's input: under `isolated` the
   * caller's active organization, under `group` the organizations the caller
   * holds a membership in.
   *
   * - **Absent** (`undefined`): no organization filter — the `single` posture,
   *   the system identity, an object outside
   *   tenancy. Rank every document of the source, as before this member.
   * - **Present**: rank only the documents whose
   *   `KnowledgeDocument.organizationId` is in the set, and filter BEFORE
   *   ranking, so `topK` is filled from those documents alone. A document
   *   stored without an `organizationId` (one indexed before this member
   *   existed, until a complete reindex writes it again) is not ranked.
   * - **Empty** (`[]`): rank nothing — a caller with no organization behind a
   *   wall. Never read as "no filter".
   *
   * A ranking scope, not the access decision: the service still re-reads every
   * object-source hit as the caller. An adapter that ignores this member keeps
   * working; other organizations' documents then take ranking places that the
   * re-read empties.
   */
  organizationIds?: string[];
  /**
   * What the knowledge service expects of the source's index (ADR-0161 K8,
   * item 8 a): the fingerprint the query is embedded under. An adapter whose
   * active generation holds another fingerprint refuses the search with the
   * coded refusal `KNOWLEDGE_REBUILD_REQUIRED` (ADR-0161 K7, rule 5) and never
   * answers it from that generation. Absent: no check.
   */
  index?: { fingerprint: string };
  /** Trace id for correlation. */
  traceId?: string;
}

/**
 * One term of `AdapterSearchOptions.scope` (ADR-0161 K8, item 17). Values are
 * compared as strings: a stored string or number `v` matches when `String(v)`
 * is one of `ids` (a record id stored as the number `7` matches the id `'7'`).
 * Any other stored value (an object, `null`, a boolean) matches no id.
 *
 * - `record`: holds for a document whose `sourceRecordId` is in `ids` — a
 *   scope entry that names the object the source indexes.
 * - `metadata`: holds for a document whose `metadata[field]` is in `ids`, or
 *   is a list with an element in `ids` (a lookup declared `multiple: true` is
 *   stored as a list of record ids) — a scope entry that names a parent object
 *   the source reaches through `field`, a lookup it lists in `metadataFields`.
 */
export type AdapterScopeTerm =
  | { kind: 'record'; ids: string[] }
  | { kind: 'metadata'; field: string; ids: string[] };

/** Options accepted by `IKnowledgeAdapter.listDocuments`. */
export interface AdapterListDocumentsOptions {
  /**
   * Where to continue: the `nextCursor` of the page before. Omitted for the
   * first page. Opaque to the service — the adapter alone gives it meaning.
   */
  cursor?: string;
  /** Most entries this page may hold. A positive integer. */
  limit: number;
}

/** One entry of a `listDocuments` page. */
export interface AdapterListedDocument {
  /** The stored document's id (`KnowledgeDocument.id`). */
  documentId: string;
  /**
   * The `docHash` the document was stored with, returned as stored. An entry
   * without one reads as changed: the next complete reindex writes it again.
   */
  docHash?: string;
  /**
   * The `sourceRecordIdType` the document was stored with, returned as stored
   * (`KnowledgeDocument.sourceRecordIdType`). The purge of a complete reindex
   * re-reads a candidate's record by the number when the entry says
   * `'number'`, and by the id's text otherwise — an entry without one (a
   * document stored before the field, or by an adapter that does not store
   * it) is re-read by text.
   */
  sourceRecordIdType?: 'number';
}

/** One page of `IKnowledgeAdapter.listDocuments`. */
export interface AdapterListDocumentsPage {
  /** This page's entries; empty when the source holds nothing past `cursor`. */
  documents: AdapterListedDocument[];
  /**
   * Pass back as `cursor` for the next page. Absent when the listing is
   * complete. A page may be followed by an empty one.
   */
  nextCursor?: string;
}

/**
 * What an adapter declares it accepts beyond whole documents (ADR-0161 K8,
 * item 5). A method that is absent is the capability signal for everything
 * else; this covers what a method cannot say.
 */
export interface AdapterCapabilities {
  /**
   * `true`: the adapter accepts the service's passages. Every document the
   * service hands it carries `chunks`, cut once by the service's splitter,
   * and the adapter indexes those passages as given — it does not split
   * them again. Absent or `false`: it receives whole documents, without
   * `chunks`, and splits them itself.
   */
  chunks?: boolean;
}

/**
 * What an adapter reports about the embedder it calls (ADR-0161 K8, item 6).
 * A report, not configuration. The service reads it each time it needs it
 * and never keeps an answer taken during `init`, because the embedder may
 * register later — so an adapter that resolves its embedder late serves it
 * from a getter.
 */
export interface AdapterEmbeddingDescriptor {
  /**
   * Longest single input the adapter's embedder accepts, in tokens
   * (`IEmbedder.maxInputTokens`). The service's splitter keeps every passage
   * within 80% of it by the shared `estimateTokens`, and removes and reports
   * a `whole` document over that budget. Absent: no limit is known, and none
   * is checked.
   */
  maxInputTokens?: number;
  /**
   * The identity of the model whose vectors the adapter stores, as the
   * provider names it (`IEmbedder.model`). Read by the service's index
   * fingerprint (ADR-0161 K7): a changed model is a new generation. Absent:
   * a change of model cannot be seen for this adapter (K7, rule 8).
   */
  model?: string;
  /**
   * The width of the vectors the adapter stores (`IEmbedder.dimensions`).
   * Read by the index fingerprint, as `model` is.
   */
  dimensions?: number;
  /**
   * An opaque string for an option of the adapter that changes the vectors it
   * stores (a document-side prefix, a normalisation). Read by the index
   * fingerprint, as `model` is. A query-side option (a query prefix) changes
   * no stored vector and is not reported here.
   */
  variant?: string;
}

/**
 * Plugin-implemented adapter. **One per backend**. Stateless across
 * source ids — the source is supplied per-call.
 *
 * Every member past `upsert` / `search` / `delete` is optional (ADR-0161 K8,
 * rule 2): an adapter that lacks one keeps working, and the service does what
 * it did before that member existed and says so where its result can carry it.
 * The contract test suite every adapter can run is exported by
 * `@objectstack/service-knowledge/testing`.
 *
 * ## Coded refusals and their `remedy`
 *
 * Any member may refuse with an ADR-0112 coded error (`code`, `status`) —
 * `KNOWLEDGE_REBUILD_REQUIRED` (409) under another fingerprint,
 * `SERVICE_UNAVAILABLE` (503) when the backend is not ready. Its `message` is
 * one sentence a search caller may read: no driver text, no SQL, no schema
 * name. Operator text — what went wrong in the backend, the SQL to run — goes
 * in the error's `remedy` string, which the service shows in a reindex result
 * and its log, and never to a search caller.
 */
export interface IKnowledgeAdapter {
  /** Stable adapter id used in `KnowledgeSource.adapter`. */
  readonly id: string;

  /**
   * What the adapter accepts beyond whole documents (ADR-0161 K8, item 5).
   * Absent: whole documents only.
   */
  readonly capabilities?: AdapterCapabilities;

  /**
   * What the adapter reports about the embedder it calls (ADR-0161 K8,
   * item 6). Read by the service at use, never cached from `init`. It may be
   * absent for a moment — an embedder service not yet registered — and the
   * fingerprint the service computes then carries no model or dimensions; an
   * adapter that needs an embedder answers `SERVICE_UNAVAILABLE` in that
   * window rather than comparing that fingerprint with its index's.
   */
  readonly embedding?: AdapterEmbeddingDescriptor;

  /** Insert or replace documents in the adapter's backend. */
  upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void>;

  /** Run a search query. Returns hits sorted by descending score. */
  search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]>;

  /** Remove documents by id. */
  delete(documentIds: string[], ctx: AdapterContext): Promise<void>;

  /**
   * List the documents the adapter holds for `ctx.source`, one page at a
   * time (ADR-0161 K8, item 1): each entry is a document id and the
   * `docHash` (and `sourceRecordIdType`) it was stored with. It lists the
   * generation that writes go to.
   * A document written while a listing runs may be missing from it — the
   * safe direction, because a missing entry is never a purge candidate.
   *
   * The service reads it before a complete reindex: an unchanged document
   * (same `docHash`) is not written again, and a listed document the walk did
   * not see is a purge candidate. An adapter without it gets no skip and no
   * purge, and the reindex result says `purged: null`.
   */
  listDocuments?(ctx: AdapterContext, opts: AdapterListDocumentsOptions): Promise<AdapterListDocumentsPage>;

  /**
   * What the adapter holds for `ctx.source` (ADR-0161 K8, item 8 b): the
   * active generation's fingerprint, the recipe hash its last complete build
   * recorded, and whether a build is under construction. Read by the service
   * at boot and when a source's definition is reloaded, to decide whether
   * the source is built, rebuilt inside its generation, or built anew
   * (ADR-0161 K7, "What starts a rebuild").
   */
  indexStatus?(ctx: AdapterContext): Promise<AdapterIndexStatus>;

  /**
   * The start of a complete build (ADR-0161 K8, item 8 c; K7, rule 3). The
   * service calls it before a complete walk of `ctx.source`, never before a
   * walk with a `limit` or a `dryRun`. When `ctx.index.fingerprint` is the
   * active generation's (or the adapter holds nothing for the source), nothing
   * opens and the walk rebuilds inside that generation; when it differs, the
   * adapter opens a generation for it, or takes up the one it already has
   * under construction for that fingerprint — or, when it cannot, refuses
   * with a coded refusal and the walk does not run. An adapter that opens
   * generations keeps one builder per source; one that does not build a
   * second generation beside the first refuses a new fingerprint here, with
   * a `remedy` (see "Coded refusals" above).
   */
  beginBuild?(ctx: AdapterContext): Promise<void>;

  /**
   * The end of a complete build (ADR-0161 K8, item 8 c). The service calls it
   * once, after the walk and its purge, and never after a walk that failed.
   * The adapter records `ctx.index` (fingerprint and recipe hash) as what it
   * holds for the source, and makes a generation it built the active one.
   */
  completeBuild?(ctx: AdapterContext): Promise<void>;

  /**
   * Remove everything the adapter holds for `ctx.source` (ADR-0161 K8,
   * item 4): every document, passage and vector of every generation, the one
   * under construction included, and whatever it recorded about the index.
   * After it `indexStatus` answers as for a source it has never seen, and a
   * source registered again under the same key is built from nothing.
   *
   * The service calls it when a source stops being served: its metadata item
   * was removed, or a package now holds its name. Calling it for a source the
   * adapter holds nothing for is not an error. An adapter without it keeps
   * what it holds, and the service says so once in its log, naming the source.
   */
  dropSource?(ctx: AdapterContext): Promise<void>;

  /**
   * Optional liveness probe. When implemented, used by the service's
   * health endpoint and Studio "test connection" actions.
   */
  healthCheck?(): Promise<{ ok: boolean; message?: string }>;
}
