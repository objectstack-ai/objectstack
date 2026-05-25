// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IDataEngine,
  IKnowledgeAdapter,
  IKnowledgeService,
  KnowledgeReindexOptions,
  KnowledgeReindexResult,
  KnowledgeSearchOptions,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type {
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeSource,
  ObjectKnowledgeSource,
} from '@objectstack/spec/ai';

/**
 * Minimal logger shape; falls back to no-op when none is provided.
 */
export interface KnowledgeLogger {
  info?(msg: string, ...rest: unknown[]): void;
  warn?(msg: string, ...rest: unknown[]): void;
  error?(msg: string, ...rest: unknown[]): void;
  debug?(msg: string, ...rest: unknown[]): void;
}

/**
 * Constructor options for `KnowledgeService`.
 */
export interface KnowledgeServiceOptions {
  /** Data engine used for RLS re-checks and bulk reindex walks. Optional in tests. */
  dataEngine?: IDataEngine;
  /** Optional structured logger. */
  logger?: KnowledgeLogger;
  /**
   * Default top-K when callers don't specify. The adapter may cap
   * further; the service does not enforce an upper bound itself.
   * @default 10
   */
  defaultTopK?: number;
}

/**
 * `KnowledgeService` — production `IKnowledgeService` implementation.
 *
 * Responsibilities (the parts the framework owns):
 * - Routes search / index calls to the right `IKnowledgeAdapter`.
 * - Re-checks every hit's `sourceRecordId` against the caller's
 *   `ExecutionContext` so row-level security is preserved end-to-end.
 * - Walks ObjectQL when reindexing an `object` source.
 *
 * Non-responsibilities (the parts plugins own):
 * - Chunking, embedding, vector storage, hybrid retrieval, rerank.
 */
export class KnowledgeService implements IKnowledgeService {
  private readonly adapters = new Map<string, IKnowledgeAdapter>();
  private readonly sources = new Map<string, KnowledgeSource>();
  private readonly defaultTopK: number;

  constructor(private readonly options: KnowledgeServiceOptions = {}) {
    this.defaultTopK = options.defaultTopK ?? 10;
  }

  // ── Adapter registry ──────────────────────────────────────────────

  registerAdapter(id: string, adapter: IKnowledgeAdapter): void {
    this.adapters.set(id, adapter);
    this.options.logger?.info?.(`[knowledge] adapter registered: ${id}`);
  }

  getAdapter(id: string): IKnowledgeAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(
        `[knowledge] unknown adapter '${id}'. Registered: [${[...this.adapters.keys()].join(', ')}]`,
      );
    }
    return adapter;
  }

  listAdapters(): string[] {
    return [...this.adapters.keys()];
  }

  // ── Source registry ───────────────────────────────────────────────

  registerSource(source: KnowledgeSource): void {
    if (this.sources.has(source.id)) {
      this.options.logger?.warn?.(`[knowledge] source overwritten: ${source.id}`);
    }
    this.sources.set(source.id, source);
    this.options.logger?.info?.(
      `[knowledge] source registered: ${source.id} (adapter=${source.adapter}, kind=${source.source.kind})`,
    );
  }

  unregisterSource(sourceId: string): void {
    this.sources.delete(sourceId);
  }

  listSources(): KnowledgeSource[] {
    return [...this.sources.values()];
  }

  getSource(sourceId: string): KnowledgeSource | undefined {
    return this.sources.get(sourceId);
  }

  // ── Document mutations ────────────────────────────────────────────

  async indexDocument(sourceId: string, doc: KnowledgeDocument): Promise<void> {
    const source = this.requireSource(sourceId);
    const adapter = this.getAdapter(source.adapter);
    await adapter.upsert([doc], { source, reason: 'manual' });
  }

  async deleteDocument(sourceId: string, documentId: string): Promise<void> {
    const source = this.requireSource(sourceId);
    const adapter = this.getAdapter(source.adapter);
    await adapter.delete([documentId], { source, reason: 'manual' });
  }

  // ── Reindex ───────────────────────────────────────────────────────

  async reindexSource(
    sourceId: string,
    opts: KnowledgeReindexOptions = {},
  ): Promise<KnowledgeReindexResult> {
    const source = this.requireSource(sourceId);
    const adapter = this.getAdapter(source.adapter);

    if (source.source.kind !== 'object') {
      // File / HTTP sources delegate to adapter-internal ingestion.
      return {
        ok: false,
        discovered: 0,
        indexed: 0,
        message:
          `Reindex for kind=${source.source.kind} is not handled by KnowledgeService. ` +
          `Trigger ingestion through the adapter (${source.adapter}) directly.`,
      };
    }

    if (!this.options.dataEngine) {
      return {
        ok: false,
        discovered: 0,
        indexed: 0,
        message: 'KnowledgeService has no IDataEngine bound; cannot walk object source.',
      };
    }

    const objSource = source.source as ObjectKnowledgeSource;
    // RLS-bypassing system context — this is a server-side admin op.
    const adminCtx: ExecutionContext = { roles: [], permissions: [], isSystem: true };
    const records = (await this.options.dataEngine.find(objSource.object, {
      where: objSource.where,
      limit: opts.limit,
      context: adminCtx,
    } as never)) as Array<Record<string, unknown>>;

    if (opts.dryRun) {
      return {
        ok: true,
        object: objSource.object,
        discovered: records.length,
        indexed: 0,
        message: 'dryRun=true; no documents pushed.',
      };
    }

    const docs = records.map((rec) => recordToDocument(source, objSource, rec));
    if (docs.length > 0) {
      await adapter.upsert(docs, { source, reason: 'reindex' });
    }
    return {
      ok: true,
      object: objSource.object,
      discovered: records.length,
      indexed: docs.length,
    };
  }

  // ── Permission-aware search ───────────────────────────────────────

  async search(query: string, opts: KnowledgeSearchOptions = {}): Promise<KnowledgeHit[]> {
    const topK = opts.topK ?? this.defaultTopK;
    const sources = this.resolveSearchTargets(opts.sourceIds);
    if (sources.length === 0) return [];

    const rawHits: KnowledgeHit[] = [];
    for (const source of sources) {
      const adapter = this.adapters.get(source.adapter);
      if (!adapter) {
        this.options.logger?.warn?.(
          `[knowledge] source '${source.id}' references unknown adapter '${source.adapter}'; skipping.`,
        );
        continue;
      }
      try {
        const hits = await adapter.search(query, {
          source,
          topK,
          filter: opts.filter,
        });
        for (const hit of hits) rawHits.push(hit);
      } catch (err) {
        this.options.logger?.error?.(
          `[knowledge] adapter '${source.adapter}' search failed for source '${source.id}': ${(err as Error).message}`,
        );
      }
    }

    const filtered = await this.applyPermissionFilter(rawHits, opts.executionContext);
    filtered.sort((a, b) => b.score - a.score);
    return filtered.slice(0, topK);
  }

  // ── Sync entrypoints (called by the host plugin's event bridge) ───

  /**
   * Apply an ObjectQL `record.created` / `record.updated` event to
   * every `object` source bound to the matching object. Failures are
   * logged but never thrown — sync must not block writes.
   */
  async handleRecordUpsert(object: string, record: Record<string, unknown>): Promise<void> {
    const targets = this.sourcesForObject(object);
    for (const source of targets) {
      try {
        const objSource = source.source as ObjectKnowledgeSource;
        const doc = recordToDocument(source, objSource, record);
        const adapter = this.getAdapter(source.adapter);
        await adapter.upsert([doc], { source, reason: 'event-sync' });
      } catch (err) {
        this.options.logger?.warn?.(
          `[knowledge] event-sync upsert failed for source '${source.id}': ${(err as Error).message}`,
        );
      }
    }
  }

  /** Apply an ObjectQL `record.deleted` event. */
  async handleRecordDelete(object: string, recordId: string): Promise<void> {
    const targets = this.sourcesForObject(object);
    for (const source of targets) {
      try {
        const docId = documentIdFor(source.id, recordId);
        const adapter = this.getAdapter(source.adapter);
        await adapter.delete([docId], { source, reason: 'event-sync' });
      } catch (err) {
        this.options.logger?.warn?.(
          `[knowledge] event-sync delete failed for source '${source.id}': ${(err as Error).message}`,
        );
      }
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private requireSource(sourceId: string): KnowledgeSource {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(
        `[knowledge] unknown source '${sourceId}'. Registered: [${[...this.sources.keys()].join(', ')}]`,
      );
    }
    return source;
  }

  private resolveSearchTargets(sourceIds?: string[]): KnowledgeSource[] {
    if (!sourceIds || sourceIds.length === 0) {
      return [...this.sources.values()].filter((s) => s.aiExposed !== false);
    }
    const out: KnowledgeSource[] = [];
    for (const id of sourceIds) {
      const s = this.sources.get(id);
      if (s) out.push(s);
      else this.options.logger?.warn?.(`[knowledge] search target '${id}' not registered; skipping.`);
    }
    return out;
  }

  private sourcesForObject(object: string): KnowledgeSource[] {
    const out: KnowledgeSource[] = [];
    for (const source of this.sources.values()) {
      if (
        source.source.kind === 'object' &&
        (source.source as ObjectKnowledgeSource).object === object &&
        (source.refresh?.onRecordChange ?? true) !== false
      ) {
        out.push(source);
      }
    }
    return out;
  }

  /**
   * Drop hits whose underlying ObjectQL record the caller can't read.
   * For hits without a `sourceRecordId` (file/http sources) we keep
   * them — adapter is responsible for any ACL enforcement there.
   *
   * When the caller's context is `isSystem: true` or no context is
   * supplied, every hit passes through — preserves today's behaviour
   * for cron jobs / tests.
   */
  private async applyPermissionFilter(
    hits: KnowledgeHit[],
    ctx: ExecutionContext | undefined,
  ): Promise<KnowledgeHit[]> {
    if (!ctx || ctx.isSystem) return hits;
    if (!this.options.dataEngine) {
      this.options.logger?.warn?.(
        '[knowledge] no IDataEngine bound — dropping object-source hits to stay safe.',
      );
      return hits.filter((h) => !h.sourceRecordId);
    }

    // Group hits by object so we make one query per object.
    const byObject = new Map<string, KnowledgeHit[]>();
    for (const hit of hits) {
      if (!hit.sourceRecordId) continue;
      const source = this.sources.get(hit.sourceId);
      if (!source || source.source.kind !== 'object') continue;
      const objName = (source.source as ObjectKnowledgeSource).object;
      const bucket = byObject.get(objName) ?? [];
      bucket.push(hit);
      byObject.set(objName, bucket);
    }

    const allowed = new Set<string>(); // `${object}#${recordId}`
    for (const [object, group] of byObject) {
      const ids = [...new Set(group.map((h) => h.sourceRecordId!).filter(Boolean))];
      if (ids.length === 0) continue;
      try {
        const rows = (await this.options.dataEngine.find(object, {
          where: { id: { $in: ids } } as Record<string, unknown>,
          fields: ['id'],
          context: ctx,
        } as never)) as Array<{ id?: string }>;
        for (const row of rows) if (row?.id) allowed.add(`${object}#${row.id}`);
      } catch (err) {
        this.options.logger?.warn?.(
          `[knowledge] RLS lookup failed for object='${object}': ${(err as Error).message}; ` +
            'dropping that object\'s hits to stay safe.',
        );
      }
    }

    return hits.filter((hit) => {
      if (!hit.sourceRecordId) return true; // file / http hit
      const source = this.sources.get(hit.sourceId);
      if (!source || source.source.kind !== 'object') return true;
      const objName = (source.source as ObjectKnowledgeSource).object;
      return allowed.has(`${objName}#${hit.sourceRecordId}`);
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Deterministic document id derived from the source + record id. */
export function documentIdFor(sourceId: string, recordId: string): string {
  return `${sourceId}:${recordId}`;
}

/**
 * Project an ObjectQL record into a `KnowledgeDocument` per the
 * source's `contentFields` / `metadataFields` config. Pure function.
 */
export function recordToDocument(
  source: KnowledgeSource,
  objSource: ObjectKnowledgeSource,
  record: Record<string, unknown>,
): KnowledgeDocument {
  const recordId = String(record.id ?? (record as any)._id ?? '');
  const contentParts: string[] = [];
  for (const field of objSource.contentFields) {
    if (field === '*') {
      for (const [k, v] of Object.entries(record)) {
        if (typeof v === 'string' && v.length > 0 && k !== 'id') contentParts.push(v);
      }
    } else {
      const v = record[field];
      if (v != null) contentParts.push(String(v));
    }
  }
  const metadata: Record<string, unknown> = {};
  for (const field of objSource.metadataFields ?? []) {
    if (record[field] !== undefined) metadata[field] = record[field];
  }
  return {
    id: documentIdFor(source.id, recordId || `unknown-${Date.now()}`),
    sourceId: source.id,
    sourceRecordId: recordId || undefined,
    content: contentParts.join('\n\n'),
    title: typeof record.title === 'string' ? record.title : undefined,
    metadata,
  };
}
