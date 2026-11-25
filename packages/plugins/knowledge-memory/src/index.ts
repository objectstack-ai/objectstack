// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IKnowledgeAdapter,
  IKnowledgeService,
  AdapterContext,
  AdapterIndexStatus,
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
 * The reference implementation of the index fingerprint's members (ADR-0161
 * K8, item 8; K7, rules 1 to 5). Per source it holds an ACTIVE generation and,
 * while a build for another fingerprint runs, one generation UNDER
 * CONSTRUCTION, each under one fingerprint:
 *
 * - A write (`upsert`, `listDocuments`) carrying `ctx.index` goes to the
 *   generation of that fingerprint — the active one, or the one under
 *   construction — and is refused `KNOWLEDGE_REBUILD_REQUIRED` when neither
 *   holds it: never written into a generation of another fingerprint. A
 *   source that holds nothing takes the first fingerprint it is handed as its
 *   active one (there is nothing to mix with). A call without `ctx.index`
 *   (not through the service) checks nothing and writes the active
 *   generation. A `delete` removes the document from every generation.
 * - A search carrying `index` whose fingerprint is not the active
 *   generation's is refused `KNOWLEDGE_REBUILD_REQUIRED` ("needs a rebuild",
 *   or "is being rebuilt" while a build for that fingerprint runs) and never
 *   answered from the active generation.
 * - `beginBuild` opens a generation for a new fingerprint, takes up the one
 *   already under construction for it, or opens nothing when the fingerprint
 *   is the active one. A build of another fingerprint left unfinished is
 *   dropped: a process holds one builder per source, and the knowledge
 *   service runs one walk of a source at a time.
 * - `completeBuild` makes the generation it built the active one (the old one
 *   is dropped) and records the recipe hash; `indexStatus` answers both.
 *
 * It reports no `embedding` descriptor: its vectors are token counts, and its
 * index does not outlive the process (K7, rule 8).
 */
export class KnowledgeMemoryAdapter implements IKnowledgeAdapter {
  readonly id: string;
  readonly capabilities = { chunks: true } as const;
  /** source id → its generations. */
  private readonly store = new Map<string, SourceIndex>();

  constructor(id = 'memory') {
    this.id = id;
  }

  async upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void> {
    const byDoc = this.writeTarget(ctx, true)!.docs;
    for (const doc of docs) byDoc.set(doc.id, { docHash: doc.docHash, chunks: embedPassages(doc) });
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    const index = this.store.get(ctx.source.id);
    for (const generation of [index?.active, index?.building]) {
      if (!generation) continue;
      for (const id of documentIds) generation.docs.delete(id);
    }
  }

  async indexStatus(ctx: AdapterContext): Promise<AdapterIndexStatus> {
    const index = this.store.get(ctx.source.id);
    const status: AdapterIndexStatus = {};
    if (index?.active?.fingerprint !== undefined) status.fingerprint = index.active.fingerprint;
    if (index?.active?.recipeHash !== undefined) status.recipeHash = index.active.recipeHash;
    if (index?.building !== undefined) status.building = true;
    return status;
  }

  async beginBuild(ctx: AdapterContext): Promise<void> {
    const fingerprint = requireIndex(ctx, 'beginBuild').fingerprint;
    const index = this.sourceIndex(ctx.source.id);
    if (index.active === undefined) {
      index.active = { fingerprint, docs: new Map() };
      return;
    }
    if (index.active.fingerprint === fingerprint) return;
    if (index.building?.fingerprint === fingerprint) return;
    index.building = { fingerprint, docs: new Map() };
  }

  async completeBuild(ctx: AdapterContext): Promise<void> {
    const { fingerprint, recipeHash } = requireIndex(ctx, 'completeBuild');
    const index = this.sourceIndex(ctx.source.id);
    if (index.building?.fingerprint === fingerprint) {
      index.active = { ...index.building, recipeHash };
      index.building = undefined;
      return;
    }
    if (index.active?.fingerprint === fingerprint) {
      index.active.recipeHash = recipeHash;
      return;
    }
    throw new Error(
      `completeBuild: source '${ctx.source.id}' holds no generation for this fingerprint; call beginBuild first.`,
    );
  }

  private sourceIndex(sourceId: string): SourceIndex {
    let index = this.store.get(sourceId);
    if (!index) {
      index = {};
      this.store.set(sourceId, index);
    }
    return index;
  }

  /**
   * The generation a write carrying `ctx.index` goes to. A source that holds
   * nothing gets an active generation under that fingerprint (`create`), or
   * none (a listing of nothing). Refused when the fingerprint is neither the
   * active generation's nor the one under construction.
   */
  private writeTarget(ctx: AdapterContext, create: boolean): Generation | undefined {
    const fingerprint = ctx.index?.fingerprint;
    const index = this.sourceIndex(ctx.source.id);
    if (index.active === undefined) {
      if (!create) return undefined;
      index.active = { fingerprint, docs: new Map() };
      return index.active;
    }
    if (fingerprint === undefined || index.active.fingerprint === fingerprint) return index.active;
    if (index.building?.fingerprint === fingerprint) return index.building;
    throw rebuildRequired(ctx.source.id, false);
  }

  async listDocuments(ctx: AdapterContext, opts: AdapterListDocumentsOptions): Promise<AdapterListDocumentsPage> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new RangeError(`listDocuments: limit must be a positive integer, got ${String(opts.limit)}`);
    }
    // In id order, so a cursor stays valid across writes. The generation the
    // writes go to (ADR-0161 K8, item 1).
    const byDoc = this.writeTarget(ctx, false)?.docs ?? new Map<string, StoredDocument>();
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
    const index = this.store.get(opts.source.id);
    const active = index?.active;
    // Vectors of two fingerprints are never ranked against each other
    // (ADR-0161 K7, rule 5): refused, never answered from the other generation.
    if (active !== undefined && opts.index !== undefined && active.fingerprint !== opts.index.fingerprint) {
      throw rebuildRequired(opts.source.id, index?.building?.fingerprint === opts.index.fingerprint);
    }
    const chunks = [...(active?.docs.values() ?? [])].flatMap((d) => d.chunks);
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
    }));
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: `memory adapter (${this.store.size} sources)` };
  }
}

/** One source's generations (ADR-0161 K7, rule 1): the active one, and one under construction. */
interface SourceIndex {
  active?: Generation;
  building?: Generation;
}

/** One complete index of one source under one fingerprint. */
interface Generation {
  /** Absent for a generation written by calls that carried no `index`. */
  fingerprint?: string;
  /** Recorded by `completeBuild`. */
  recipeHash?: string;
  /** document id → the stored document. */
  docs: Map<string, StoredDocument>;
}

/** The ADR-0112 code a refused write or search carries (ADR-0161 K7, rules 4 and 5). */
export const KNOWLEDGE_REBUILD_REQUIRED = 'KNOWLEDGE_REBUILD_REQUIRED';

function rebuildRequired(sourceId: string, building: boolean): Error {
  const message = building
    ? `Knowledge source '${sourceId}' is being rebuilt under its new index fingerprint; it answers again when ` +
      'the rebuild completes.'
    : `Knowledge source '${sourceId}' needs a rebuild: its index was built under another fingerprint (embedding ` +
      'model, dimensions, split or content recipe changed). Run a complete reindex of the source.';
  return Object.assign(new Error(message), { code: KNOWLEDGE_REBUILD_REQUIRED, status: 409 });
}

function requireIndex(ctx: AdapterContext, member: string): NonNullable<AdapterContext['index']> {
  if (ctx.index === undefined) {
    throw new Error(`${member}: the call carries no index fingerprint (ctx.index); it is made by the knowledge service.`);
  }
  return ctx.index;
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
  const passages = doc.chunks ?? [{ id: `${doc.id}#0`, content: doc.content }];
  return passages
    .filter((p) => p.content.trim() !== '')
    .map((p) => {
      const vec = embedTokens(tokenize(p.content));
      return {
        chunkId: p.id,
        documentId: doc.id,
        sourceRecordId: doc.sourceRecordId,
        organizationId: doc.organizationId,
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
