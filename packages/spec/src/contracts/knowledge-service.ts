// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ExecutionContext } from '../kernel/execution-context.zod';
import type {
  KnowledgeDocument,
  KnowledgeHit,
} from '../ai/knowledge-document.zod';
import type { KnowledgeSource } from '../ai/knowledge-source.zod';
import type { IKnowledgeAdapter } from './knowledge-adapter';

/**
 * `IKnowledgeService` — orchestrator contract consumed by REST,
 * `service-ai`, Studio, and custom plugins. Implemented by
 * `@objectstack/service-knowledge`.
 *
 * The service routes requests to one of many `IKnowledgeAdapter`
 * plugins (RAGFlow, LlamaIndex, Dify, …), wraps search results with a
 * permission-aware filter that uses the caller's `ExecutionContext`,
 * and drives event-based sync from ObjectQL.
 *
 * See `content/docs/protocol/knowledge.mdx` for the architecture
 * rationale.
 */

/** Options accepted by `IKnowledgeService.search`. */
export interface KnowledgeSearchOptions {
  /**
   * Restrict the search to the given source ids. When omitted, every
   * source the caller is allowed to see is queried.
   */
  sourceIds?: string[];
  /** Max number of hits to return. Adapters may cap further. */
  topK?: number;
  /** Adapter-specific filter (passed opaquely). */
  filter?: Record<string, unknown>;
  /**
   * Execution context of the caller. **Required** for permission-aware
   * retrieval: hits whose `sourceRecordId` would be filtered out by
   * RLS are dropped before being returned. Internal callers may pass
   * an `isSystem: true` context to bypass — same convention as
   * `IDataEngine`.
   */
  executionContext?: ExecutionContext;
  /**
   * Search only inside these records (ADR-0161 K8, item 17, as its dated note
   * of 2026-11-25 shapes it). Each entry names an object and record ids of it:
   *
   * - **The object a source indexes**: only the documents of those records
   *   are searched in that source.
   * - **A parent object**: only the documents whose lookup to it holds one of
   *   those ids are searched, in a source that lists that lookup (a `lookup`
   *   or `master_detail` field pointing at the object) in its
   *   `metadataFields` — "the clauses of this policy". A source that lists no
   *   such field, or two or more of them, is not reached by the entry; a
   *   parent two hops away is not reached either.
   *
   * Several entries are a union: a document is searched when any entry holds
   * for it. A source no entry reaches is not searched, and a `file` / `http`
   * source answers nothing under a scope.
   *
   * - **Absent**: no scope, as before this option.
   * - **Empty** (`[]`), or an entry whose `ids` is empty: nothing is in scope,
   *   and the search answers no hits. Never read as "no scope".
   *
   * **Bounds.** At most 10 entries, each with at most 500 ids; `object` and
   * every id a non-empty string, and no other key on an entry. A scope past
   * them is refused before any adapter is called, with a coded error
   * (ADR-0112: `code: 'VALIDATION_ERROR'`, `status: 400`).
   *
   * A ranking scope, not the access decision: every hit is still re-read as
   * the caller, and an entry that reaches nothing answers the same empty
   * answer a source withheld from the caller gives.
   */
  scope?: Array<{ object: string; ids: string[] }>;
}

/** Options accepted by `IKnowledgeService.reindexSource`. */
export interface KnowledgeReindexOptions {
  /** When `true`, walk the source and count but do not call the adapter. */
  dryRun?: boolean;
  /** Cap on number of documents to reindex (mostly for tests / smoke runs). */
  limit?: number;
}

/** Result of a `reindexSource` call. */
export interface KnowledgeReindexResult {
  /** Number of documents pushed to the adapter (0 when dryRun). */
  indexed: number;
  /** Number of documents discovered (always populated). */
  discovered: number;
  /** When applicable, the underlying object's short name. */
  object?: string;
  /** When `false`, an adapter / source check prevented the run. */
  ok: boolean;
  /** Free-form diagnostics. */
  message?: string;
  /**
   * Documents the walk did not push because the adapter already holds them
   * with the same `docHash` (ADR-0161 K8, item 2). `0` when the adapter has
   * no `listDocuments`, whose walk pushes every document. Absent from a result
   * of an implementation that predates the field.
   */
  skipped?: number;
  /**
   * Documents deleted by the purge that follows a complete walk: listed by
   * the adapter before the walk, not seen in it, and confirmed gone by a
   * re-read of their row (ADR-0161 K8, item 1). `null` when no purge ran:
   * a source that is not an `object` source, no data engine bound, a refused
   * `limit`, a walk with `limit` or `dryRun`, a failed walk, a source with
   * `refresh.onRecordChange: false`, an adapter without `listDocuments`, or a
   * listing that failed. A number, with `ok: false`, when the purge stopped
   * part-way: the deletions made before it stopped. Absent from a result of an
   * implementation that predates the field.
   */
  purged?: number | null;
  /**
   * Documents removed from the index instead of written, because they cannot
   * be indexed as the source's split asks — today a `whole` document whose
   * token estimate is over the embedder's input budget, which is never
   * truncated. `0` when none was. Absent from a result of an implementation
   * that predates the field.
   */
  failed?: number;
  /**
   * Which documents those were and why, in walk order, bounded by the
   * service (`failed` counts them all). Absent when `failed` is absent.
   */
  failures?: Array<{ documentId: string; reason: string }>;
}

/**
 * Core service contract.
 *
 * Every adapter plugin calls `registerAdapter(id, this)` during its
 * `start()` hook. Sources reference adapters by id; unknown ids cause
 * `search` / `indexDocument` to throw early with a clear error.
 */
export interface IKnowledgeService {
  /** Register (or replace) an adapter under the given id. */
  registerAdapter(id: string, adapter: IKnowledgeAdapter): void;
  /** Resolve an adapter by id. Throws when unknown. */
  getAdapter(id: string): IKnowledgeAdapter;
  /** Enumerate registered adapter ids. */
  listAdapters(): string[];

  /** Register a logical knowledge source. */
  registerSource(source: KnowledgeSource): void;
  /** Remove a registered source. Does not delete underlying data. */
  unregisterSource(sourceId: string): void;
  /** Snapshot of registered sources (read-only). */
  listSources(): KnowledgeSource[];
  /** Look up a single source. Returns `undefined` when not registered. */
  getSource(sourceId: string): KnowledgeSource | undefined;

  /** Index (insert or replace) a document into the source's adapter. */
  indexDocument(sourceId: string, doc: KnowledgeDocument): Promise<void>;
  /** Remove a document from the source's adapter. */
  deleteDocument(sourceId: string, documentId: string): Promise<void>;

  /**
   * Bulk reindex a source from its declared origin. Object sources
   * walk the underlying object via `IDataEngine`; file / http sources
   * delegate to the adapter's own ingestion.
   */
  reindexSource(sourceId: string, opts?: KnowledgeReindexOptions): Promise<KnowledgeReindexResult>;

  /**
   * Run a search across one or more sources. Results are
   * permission-filtered before being returned (see
   * `KnowledgeSearchOptions.executionContext`).
   */
  search(query: string, opts?: KnowledgeSearchOptions): Promise<KnowledgeHit[]>;
}

/** Canonical service-registry id used by `IKnowledgeService` consumers. */
export const KNOWLEDGE_SERVICE = 'knowledge' as const;
