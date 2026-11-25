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
  /**
   * Max number of hits to return. Adapters may cap further. Under
   * `granularity: 'record'` it counts records (or `groupBy` groups), not
   * passages.
   */
  topK?: number;
  /**
   * What one hit stands for (ADR-0161 K1, record-level return).
   *
   * - `'chunk'` (the default): one hit per matching passage, as before.
   * - `'record'`: one hit per record — the best-scoring passage of the
   *   record, so `topK` counts records. Each hit returned is checked against
   *   the record as it reads now: a record that was deleted, left the
   *   source's `where`, or changed since it was indexed is not returned, and
   *   its document is repaired in the background — except in a source with
   *   `refresh.onRecordChange: false`, whose index an external indexer owns:
   *   there the hit is only not returned. A `file` / `http` hit is grouped by
   *   its document.
   *
   * The return type does not change: still `KnowledgeHit[]`.
   */
  granularity?: 'chunk' | 'record';
  /**
   * Group record-level hits by the value of this metadata field instead of by
   * record — "which policies", not "which clauses" — keeping the best hit of
   * each group; the group value is the hit's `metadata[groupBy]`, and hits
   * with the same value form one group whichever source they come from. Implies
   * `granularity: 'record'`; passing it with `granularity: 'chunk'` (or
   * passing an empty name, or an unknown `granularity`) is refused with
   * `code: 'VALIDATION_ERROR'`, `status: 400`. An `object` source that does not list the field in its
   * `metadataFields` answers no hits for this search (never ungrouped), and
   * neither does a record with no value for it; a `file` / `http` source
   * groups by its document.
   */
  groupBy?: string;
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
