// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IKnowledgeAdapter,
  IKnowledgeService,
  AdapterContext,
  AdapterSearchOptions,
} from '@objectstack/spec/contracts';
import type {
  KnowledgeDocument,
  KnowledgeHit,
} from '@objectstack/spec/ai';
import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';

/**
 * In-memory knowledge adapter. Stores per-source document maps,
 * chunks documents naively on paragraph boundaries (with a soft 800-char
 * cap), embeds each chunk as a sparse token-frequency vector, and
 * answers `search()` via brute-force cosine similarity.
 *
 * Deterministic — same input always produces the same hits — so it's
 * great for tests and reference implementations. **Don't use in prod.**
 */
export class KnowledgeMemoryAdapter implements IKnowledgeAdapter {
  readonly id: string;
  private readonly store = new Map<string, ChunkRecord[]>();

  constructor(id = 'memory') {
    this.id = id;
  }

  async upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void> {
    const sourceId = ctx.source.id;
    const existing = this.store.get(sourceId) ?? [];
    const byDoc = new Map<string, ChunkRecord[]>();
    for (const c of existing) {
      const arr = byDoc.get(c.documentId) ?? [];
      arr.push(c);
      byDoc.set(c.documentId, arr);
    }
    for (const doc of docs) {
      byDoc.set(doc.id, chunkAndEmbed(doc));
    }
    this.store.set(sourceId, Array.from(byDoc.values()).flat());
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    const sourceId = ctx.source.id;
    const chunks = this.store.get(sourceId);
    if (!chunks) return;
    const dropSet = new Set(documentIds);
    this.store.set(
      sourceId,
      chunks.filter((c) => !dropSet.has(c.documentId)),
    );
  }

  async search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]> {
    const chunks = this.store.get(opts.source.id) ?? [];
    if (chunks.length === 0) return [];
    const qVec = embedTokens(tokenize(query));
    const qNorm = vectorNorm(qVec);
    if (qNorm === 0) return [];

    const filter = opts.filter ?? {};
    const filtered = Object.keys(filter).length
      ? chunks.filter((c) => matchesFilter(c.metadata, filter))
      : chunks;

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
    }));
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: `memory adapter (${this.store.size} sources)` };
  }
}

interface ChunkRecord {
  chunkId: string;
  documentId: string;
  sourceRecordId?: string;
  content: string;
  title?: string;
  metadata: Record<string, unknown>;
  vector: Map<string, number>;
  vectorNorm: number;
}

const CHUNK_TARGET = 800;

function chunkAndEmbed(doc: KnowledgeDocument): ChunkRecord[] {
  const paragraphs = doc.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paragraphs.length ? paragraphs : [doc.content]) {
    if (buf && buf.length + p.length + 2 > CHUNK_TARGET) {
      chunks.push(buf);
      buf = '';
    }
    if (p.length > CHUNK_TARGET) {
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      for (let i = 0; i < p.length; i += CHUNK_TARGET) {
        chunks.push(p.slice(i, i + CHUNK_TARGET));
      }
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.map((content, idx) => {
    const vec = embedTokens(tokenize(content));
    return {
      chunkId: `${doc.id}#${idx}`,
      documentId: doc.id,
      sourceRecordId: doc.sourceRecordId,
      content,
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
  type = 'standard';

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
