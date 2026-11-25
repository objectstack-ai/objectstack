// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IKnowledgeAdapter,
  IKnowledgeService,
  AdapterContext,
  AdapterListDocumentsOptions,
  AdapterListDocumentsPage,
  AdapterSearchOptions,
} from '@objectstack/spec/contracts';
import type {
  KnowledgeDocument,
  KnowledgeHit,
} from '@objectstack/spec/ai';
import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';

/**
 * In-memory knowledge adapter. Stores per-source document maps, embeds each
 * passage as a sparse token-frequency vector, and answers `search()` via
 * brute-force cosine similarity.
 *
 * It does not split: it declares `capabilities.chunks` (ADR-0161 K8, item 5),
 * so the knowledge service hands it every document already cut into passages
 * by the service's one splitter, and it indexes each passage as given — one
 * hit per passage, its `chunkId` the service's. A document handed to it
 * without `chunks` (a direct call, not through the service) is indexed as one
 * passage holding the whole text.
 *
 * Deterministic — same input always produces the same hits — so it's
 * great for tests and reference implementations. **Don't use in prod.**
 *
 * The reference implementation of `listDocuments` (ADR-0161 K8, item 1): it
 * stores each document's `docHash` as given and lists it back as stored, in
 * document-id order, the cursor being the last id of the page before. It runs
 * the contract suite of `@objectstack/service-knowledge/testing`.
 *
 * The first reader of the organization filter (ADR-0161 K8, item 9): it
 * stores each document's `organizationId` as given and, when a search is
 * handed `organizationIds`, ranks only the documents whose organization is in
 * that set — the filter runs before the scoring, so `topK` is filled from them
 * alone. An empty set ranks nothing; a document stored without an
 * organization is not ranked by a filtered search.
 *
 * Each hit carries its document's stored `docHash` (ADR-0161 K8, item 3),
 * which the service's record-level freshness check compares, and the heading
 * path of its passage when the passage has one (item 14).
 */
export class KnowledgeMemoryAdapter implements IKnowledgeAdapter {
  readonly id: string;
  readonly capabilities = { chunks: true } as const;
  /** source id → document id → the stored document. */
  private readonly store = new Map<string, Map<string, StoredDocument>>();

  constructor(id = 'memory') {
    this.id = id;
  }

  async upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void> {
    const byDoc = this.store.get(ctx.source.id) ?? new Map<string, StoredDocument>();
    for (const doc of docs) byDoc.set(doc.id, { docHash: doc.docHash, chunks: embedPassages(doc) });
    this.store.set(ctx.source.id, byDoc);
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    const byDoc: Map<string, StoredDocument> | undefined = this.store.get(ctx.source.id);
    if (!byDoc) return;
    for (const id of documentIds) byDoc.delete(id);
  }

  async listDocuments(ctx: AdapterContext, opts: AdapterListDocumentsOptions): Promise<AdapterListDocumentsPage> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new RangeError(`listDocuments: limit must be a positive integer, got ${String(opts.limit)}`);
    }
    // In id order, so a cursor stays valid across writes.
    const byDoc = this.store.get(ctx.source.id) ?? new Map<string, StoredDocument>();
    const ids = [...byDoc.keys()]
      .filter((id) => opts.cursor === undefined || id > opts.cursor)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const page = ids.slice(0, opts.limit);
    return {
      documents: page.map((documentId) => {
        const docHash = byDoc.get(documentId)?.docHash;
        return docHash === undefined ? { documentId } : { documentId, docHash };
      }),
      ...(ids.length > page.length ? { nextCursor: page[page.length - 1] } : {}),
    };
  }

  async search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]> {
    const chunks = [...(this.store.get(opts.source.id)?.values() ?? [])].flatMap((d) => d.chunks);
    if (chunks.length === 0) return [];
    const qVec = embedTokens(tokenize(query));
    const qNorm = vectorNorm(qVec);
    if (qNorm === 0) return [];

    // The organization filter first (ADR-0161 K8, item 9): absent → every
    // document; present → only the documents of those organizations, so a
    // document with none is out, and `[]` leaves nothing to rank.
    const organizations = opts.organizationIds === undefined ? undefined : new Set(opts.organizationIds);
    const inScope = organizations === undefined
      ? chunks
      : chunks.filter((c) => c.organizationId !== undefined && organizations.has(c.organizationId));
    const filter = opts.filter ?? {};
    const filtered = Object.keys(filter).length
      ? inScope.filter((c) => matchesFilter(c.metadata, filter))
      : inScope;

    const scored = filtered.map((c) => ({
      chunk: c,
      score: cosineSimilarity(qVec, c.vector, qNorm, c.vectorNorm),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, opts.topK).filter((s) => s.score > 0);
    return top.map<KnowledgeHit>(({ chunk, score }) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      sourceId: opts.source.id,
      sourceRecordId: chunk.sourceRecordId,
      score,
      snippet: chunk.content,
      title: chunk.title,
      metadata: chunk.metadata,
      ...(chunk.docHash === undefined ? {} : { docHash: chunk.docHash }),
      ...(chunk.headingPath === undefined ? {} : { headingPath: [...chunk.headingPath] }),
    }));
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: `memory adapter (${this.store.size} sources)` };
  }
}

interface StoredDocument {
  /** The document's `docHash`, stored as given (ADR-0161 K8, item 2). */
  docHash?: string;
  chunks: ChunkRecord[];
}

interface ChunkRecord {
  chunkId: string;
  documentId: string;
  sourceRecordId?: string;
  /** The document's `organizationId`, stored as given (ADR-0161 K8, item 9). */
  organizationId?: string;
  /** The document's `docHash`, returned on each hit as stored (ADR-0161 K8, item 3). */
  docHash?: string;
  /** The passage's heading path, returned on its hits (ADR-0161 K8, item 14). */
  headingPath?: string[];
  content: string;
  title?: string;
  metadata: Record<string, unknown>;
  vector: Map<string, number>;
  vectorNorm: number;
}

/**
 * One record per passage the service cut (`doc.chunks`), as given; without
 * `chunks`, one passage holding the whole text. Never split here.
 */
function embedPassages(doc: KnowledgeDocument): ChunkRecord[] {
  const passages: Array<{ id: string; content: string; headingPath?: string[] }> =
    doc.chunks ?? [{ id: `${doc.id}#0`, content: doc.content }];
  return passages
    .filter((p) => p.content.trim() !== '')
    .map((p) => {
      const vec = embedTokens(tokenize(p.content));
      return {
        chunkId: p.id,
        documentId: doc.id,
        sourceRecordId: doc.sourceRecordId,
        organizationId: doc.organizationId,
        docHash: doc.docHash,
        headingPath: p.headingPath,
        content: p.content,
        title: doc.title,
        metadata: doc.metadata ?? {},
        vector: vec,
        vectorNorm: vectorNorm(vec),
      };
    });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length > 1);
}

function embedTokens(tokens: string[]): Map<string, number> {
  const vec = new Map<string, number>();
  for (const t of tokens) vec.set(t, (vec.get(t) ?? 0) + 1);
  return vec;
}

function vectorNorm(v: Map<string, number>): number {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s);
}

function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
  aNorm = vectorNorm(a),
  bNorm = vectorNorm(b),
): number {
  if (aNorm === 0 || bNorm === 0) return 0;
  // iterate smaller map
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w) dot += v * w;
  }
  return dot / (aNorm * bNorm);
}

function matchesFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (metadata[k] !== v) return false;
  }
  return true;
}

/* ---------------------------------------------------------------- */
/* Kernel plugin glue                                               */
/* ---------------------------------------------------------------- */

import type { Plugin, PluginContext } from '@objectstack/core';

export interface KnowledgeMemoryPluginOptions {
  /** Adapter id. @default 'memory' */
  id?: string;
}

/**
 * `KnowledgeMemoryPlugin` — registers a `KnowledgeMemoryAdapter` with
 * the host's `IKnowledgeService` during `start()`.
 */
export class KnowledgeMemoryPlugin implements Plugin {
  name = 'com.objectstack.plugin.knowledge-memory';
  version = '0.1.0';
  type = 'standard' as const;

  private readonly adapter: KnowledgeMemoryAdapter;

  constructor(opts: KnowledgeMemoryPluginOptions = {}) {
    this.adapter = new KnowledgeMemoryAdapter(opts.id ?? 'memory');
  }

  async init(_ctx: PluginContext): Promise<void> {
    // No-op: registration happens in start() once IKnowledgeService is up.
  }

  async start(ctx: PluginContext): Promise<void> {
    let svc: IKnowledgeService | undefined;
    try {
      svc = ctx.getService<IKnowledgeService>(KNOWLEDGE_SERVICE);
    } catch {
      ctx.logger.warn?.(
        'KnowledgeMemoryPlugin: IKnowledgeService not registered — install KnowledgeServicePlugin first.',
      );
      return;
    }
    svc.registerAdapter(this.adapter.id, this.adapter);
    ctx.logger.info?.(`KnowledgeMemoryPlugin: adapter '${this.adapter.id}' registered.`);
  }
}
