// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  KnowledgeDocument,
  KnowledgeHit,
} from '../ai/knowledge-document.zod';
import type { KnowledgeSource } from '../ai/knowledge-source.zod';

/**
 * `IKnowledgeAdapter` — plugin-side contract.
 *
 * Each backend (RAGFlow, LlamaIndex, Dify, Vectara, an in-memory
 * cosine adapter, a custom pgvector adapter, …) ships as its own
 * plugin package and implements this interface. The adapter is then
 * registered with the host's `IKnowledgeService` via
 * `registerAdapter(id, this)` during the plugin's `start()` hook.
 *
 * The surface is **deliberately minimal**: no chunk strategy, no
 * embedding configuration, no rerank toggles. Adapters that need
 * extra knobs expose them via their plugin options object.
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
  /** The source these documents belong to. */
  source: KnowledgeSource;
  /** Trace id for correlation across logs / metrics. */
  traceId?: string;
  /** Caller-supplied free-form diagnostics tag. */
  reason?: 'event-sync' | 'reindex' | 'manual' | 'tool-call' | (string & {});
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
   * The caller's organizations (ADR-0161 K8, item 9), computed by the knowledge
   * service from the caller's identity and the deployment's tenancy posture
   * (ADR-0105 D1) — never taken from a caller's input: under `isolated` the
   * caller's active organization, under `group` the organizations the caller
   * holds a membership in.
   *
   * - **Absent** (`undefined`): no organization filter — the `single` posture,
   *   the system identity, a `file` / `http` source, an object outside
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
  /** Trace id for correlation. */
  traceId?: string;
}

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
 * Plugin-implemented adapter. **One per backend**. Stateless across
 * source ids — the source is supplied per-call.
 *
 * Every member past `upsert` / `search` / `delete` is optional (ADR-0161 K8,
 * rule 2): an adapter that lacks one keeps working, and the service does what
 * it did before that member existed and says so where its result can carry it.
 * The contract test suite every adapter can run is exported by
 * `@objectstack/service-knowledge/testing`.
 */
export interface IKnowledgeAdapter {
  /** Stable adapter id used in `KnowledgeSource.adapter`. */
  readonly id: string;

  /** Insert or replace documents in the adapter's backend. */
  upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void>;

  /** Run a search query. Returns hits sorted by descending score. */
  search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]>;

  /** Remove documents by id. */
  delete(documentIds: string[], ctx: AdapterContext): Promise<void>;

  /**
   * List the documents the adapter holds for `ctx.source`, one page at a
   * time (ADR-0161 K8, item 1): each entry is a document id and the
   * `docHash` it was stored with. It lists the generation that writes go to.
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
   * Optional liveness probe. When implemented, used by the service's
   * health endpoint and Studio "test connection" actions.
   */
  healthCheck?(): Promise<{ ok: boolean; message?: string }>;
}
