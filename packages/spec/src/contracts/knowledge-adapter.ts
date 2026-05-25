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
  /** Trace id for correlation. */
  traceId?: string;
}

/**
 * Plugin-implemented adapter. **One per backend**. Stateless across
 * source ids — the source is supplied per-call.
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
   * Optional liveness probe. When implemented, used by the service's
   * health endpoint and Studio "test connection" actions.
   */
  healthCheck?(): Promise<{ ok: boolean; message?: string }>;
}
