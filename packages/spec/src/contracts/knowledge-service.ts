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
