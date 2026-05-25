// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type {
  IKnowledgeAdapter,
  IKnowledgeService,
  AdapterContext,
  AdapterSearchOptions,
} from '@objectstack/spec/contracts';
import type {
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeSource,
} from '@objectstack/spec/ai';
import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';

/**
 * Subset of `fetch` used by the adapter. Inject in tests; defaults to
 * the global `fetch`.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface KnowledgeRagflowAdapterOptions {
  /** RAGFlow endpoint, e.g. `http://localhost:9380`. */
  endpoint: string;
  /** RAGFlow API key (Bearer token). */
  apiKey: string;
  /** Adapter id. @default 'ragflow' */
  id?: string;
  /** Override `fetch` for tests. */
  fetch?: FetchLike;
  /** Request timeout in milliseconds. @default 30000 */
  timeoutMs?: number;
}

interface RagflowSourceOptions {
  datasetId: string;
  /** Optional rerank model id (overrides dataset default). */
  rerankModel?: string;
  /** Optional similarity threshold passed through to RAGFlow. */
  similarityThreshold?: number;
  /** Optional vector vs keyword weight in [0,1]. */
  vectorSimilarityWeight?: number;
}

function extractRagflowOptions(source: KnowledgeSource): RagflowSourceOptions {
  const opts = ((source as unknown as { options?: Record<string, unknown> }).options ?? {}) as
    Record<string, unknown>;
  const datasetId = opts.datasetId;
  if (typeof datasetId !== 'string' || !datasetId) {
    throw new Error(
      `RAGFlow adapter requires source.options.datasetId on source '${source.id}'`,
    );
  }
  return {
    datasetId,
    rerankModel: typeof opts.rerankModel === 'string' ? opts.rerankModel : undefined,
    similarityThreshold:
      typeof opts.similarityThreshold === 'number' ? opts.similarityThreshold : undefined,
    vectorSimilarityWeight:
      typeof opts.vectorSimilarityWeight === 'number'
        ? opts.vectorSimilarityWeight
        : undefined,
  };
}

/**
 * RAGFlow adapter. Maps {@link KnowledgeDocument} upserts to the
 * dataset's chunk API, delegates retrieval to `/api/v1/retrieval`, and
 * returns {@link KnowledgeHit}s with `sourceRecordId` preserved so the
 * orchestrator can run a permission re-check.
 */
export class KnowledgeRagflowAdapter implements IKnowledgeAdapter {
  readonly id: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: KnowledgeRagflowAdapterOptions) {
    if (!opts.endpoint) throw new Error('RAGFlow adapter: endpoint required');
    if (!opts.apiKey) throw new Error('RAGFlow adapter: apiKey required');
    this.id = opts.id ?? 'ragflow';
    this.endpoint = opts.endpoint.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 30000;
    if (!this.fetchImpl) {
      throw new Error('RAGFlow adapter: no fetch available; pass options.fetch');
    }
  }

  async upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void> {
    const { datasetId } = extractRagflowOptions(ctx.source);
    // RAGFlow models documents in two layers: documents (file-like) and
    // chunks (text blocks). We treat each KnowledgeDocument as a single
    // chunk-set: delete existing chunks with the same external id, then
    // upload as `content` chunks tagged with our document id.
    for (const doc of docs) {
      await this.deleteChunksByDocumentId(datasetId, doc.id);
      await this.request(`/api/v1/datasets/${datasetId}/chunks`, {
        method: 'POST',
        body: JSON.stringify({
          content: doc.content,
          // RAGFlow accepts arbitrary metadata used for filtering at
          // retrieval time. We always stamp `objectstack_doc_id` so
          // delete() can find these chunks again.
          important_keywords: doc.title ? [doc.title] : undefined,
          metadata: {
            ...(doc.metadata ?? {}),
            objectstack_doc_id: doc.id,
            objectstack_source_id: doc.sourceId,
            objectstack_record_id: doc.sourceRecordId,
            title: doc.title,
          },
        }),
      });
    }
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    const { datasetId } = extractRagflowOptions(ctx.source);
    for (const id of documentIds) {
      await this.deleteChunksByDocumentId(datasetId, id);
    }
  }

  async search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]> {
    const { datasetId, rerankModel, similarityThreshold, vectorSimilarityWeight } =
      extractRagflowOptions(opts.source);
    const body: Record<string, unknown> = {
      question: query,
      dataset_ids: [datasetId],
      top_k: opts.topK,
      keyword: true,
    };
    if (rerankModel) body.rerank_id = rerankModel;
    if (typeof similarityThreshold === 'number') body.similarity_threshold = similarityThreshold;
    if (typeof vectorSimilarityWeight === 'number')
      body.vector_similarity_weight = vectorSimilarityWeight;
    if (opts.filter) body.metadata_condition = { ...opts.filter };

    const res = await this.request('/api/v1/retrieval', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (res?.data ?? {}) as { chunks?: RagflowChunkHit[] };
    const chunks = data.chunks ?? [];
    return chunks.slice(0, opts.topK).map<KnowledgeHit>((c) => {
      const md = (c.metadata ?? {}) as Record<string, unknown>;
      const docId =
        (md.objectstack_doc_id as string | undefined) ??
        c.document_id ??
        c.doc_id ??
        c.id;
      const recordId = md.objectstack_record_id as string | undefined;
      return {
        chunkId: c.id ?? `${docId}#${c.position ?? 0}`,
        documentId: docId ?? c.id ?? 'unknown',
        sourceId: opts.source.id,
        sourceRecordId: recordId,
        score: c.similarity ?? c.score ?? 0,
        snippet: c.content ?? c.content_with_weight ?? '',
        title: (md.title as string | undefined) ?? c.document_name,
        metadata: md,
      };
    });
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.request('/api/v1/datasets?page=1&page_size=1', { method: 'GET' });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async deleteChunksByDocumentId(datasetId: string, docId: string): Promise<void> {
    // Find chunks with our stamped metadata, then delete by chunk id.
    const found = (await this.request(`/api/v1/retrieval`, {
      method: 'POST',
      body: JSON.stringify({
        question: docId,
        dataset_ids: [datasetId],
        top_k: 256,
        keyword: false,
        metadata_condition: { objectstack_doc_id: docId },
      }),
    })) as { data?: { chunks?: Array<{ id?: string }> } };
    const ids = (found.data?.chunks ?? [])
      .map((c) => c.id)
      .filter((x): x is string => typeof x === 'string');
    if (ids.length === 0) return;
    await this.request(`/api/v1/datasets/${datasetId}/chunks`, {
      method: 'DELETE',
      body: JSON.stringify({ chunk_ids: ids }),
    });
  }

  private async request(
    path: string,
    init: { method: string; body?: string },
  ): Promise<{ data?: unknown; code?: number; message?: string }> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.endpoint}${path}`, {
        method: init.method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: init.body,
        signal: controller.signal,
      });
      const raw = await res.text();
      let parsed: { data?: unknown; code?: number; message?: string } = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          if (!res.ok) {
            throw new Error(
              `RAGFlow ${init.method} ${path} → ${res.status} ${res.statusText}: ${raw.slice(0, 200)}`,
            );
          }
        }
      }
      if (!res.ok || (typeof parsed.code === 'number' && parsed.code !== 0 && parsed.code !== 200)) {
        throw new Error(
          `RAGFlow ${init.method} ${path} → ${res.status} ${res.statusText}${
            parsed.message ? ` (${parsed.message})` : ''
          }`,
        );
      }
      return parsed;
    } finally {
      clearTimeout(t);
    }
  }
}

interface RagflowChunkHit {
  id?: string;
  document_id?: string;
  doc_id?: string;
  document_name?: string;
  content?: string;
  content_with_weight?: string;
  similarity?: number;
  score?: number;
  position?: number;
  metadata?: Record<string, unknown>;
}

/* ---------------------------------------------------------------- */
/* Kernel plugin glue                                               */
/* ---------------------------------------------------------------- */

export interface KnowledgeRagflowPluginOptions extends KnowledgeRagflowAdapterOptions {}

export class KnowledgeRagflowPlugin implements Plugin {
  name = 'com.objectstack.plugin.knowledge-ragflow';
  version = '0.1.0';
  type = 'standard';

  private readonly adapter: KnowledgeRagflowAdapter;

  constructor(opts: KnowledgeRagflowPluginOptions) {
    this.adapter = new KnowledgeRagflowAdapter(opts);
  }

  async init(_ctx: PluginContext): Promise<void> {
    // No-op: actual registration happens in start() once service is available.
  }

  async start(ctx: PluginContext): Promise<void> {
    let svc: IKnowledgeService | undefined;
    try {
      svc = ctx.getService<IKnowledgeService>(KNOWLEDGE_SERVICE);
    } catch {
      ctx.logger.warn?.(
        'KnowledgeRagflowPlugin: IKnowledgeService not registered — install KnowledgeServicePlugin first.',
      );
      return;
    }
    svc.registerAdapter(this.adapter.id, this.adapter);
    ctx.logger.info?.(
      `KnowledgeRagflowPlugin: adapter '${this.adapter.id}' registered (endpoint=${(this.adapter as unknown as { endpoint: string }).endpoint}).`,
    );
  }
}
