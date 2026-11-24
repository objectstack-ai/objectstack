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
import {
  collectCredentialWriteResponseFields,
  collectInternalWriteResponseFields,
  registryObjectPackageDisabled,
} from '@objectstack/core';
import {
  admitObject,
  admitSourceFields,
  type KnowledgeFieldSecurity,
  type KnowledgeSourceAdmission,
  type ObjectAdmission,
} from './knowledge-source-admission.js';

/**
 * Minimal logger shape; falls back to no-op when none is provided.
 */
export interface KnowledgeLogger {
  info?(msg: string, ...rest: unknown[]): void;
  /**
   * The GUARANTEED fallback channel (#9754). `error` stays optional — hosts do
   * inject reduced sinks — so `warn` is where a durability report lands when
   * `error` is absent, and a fallback that may itself be missing is not a
   * fallback. Call sites keep the `logger?.warn?.(…)` spelling as the backstop
   * for hosts the TYPE cannot reach; `SweepLogger` in plugin-email's
   * `outbox-sweep.ts` carries the full reasoning and the measurement.
   */
  warn(msg: string, ...rest: unknown[]): void;
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
   * The `security` service, resolved at search time, for the field gate
   * (`knowledge-source-admission.ts`). Answers `undefined` when the host
   * registers none: the contract's fallback then applies (every field
   * declaring a `maskingRule` is not queryable). `KnowledgeServicePlugin`
   * always wires it; omitted, the service reads as a host with no security
   * service.
   */
  resolveSecurity?: () => KnowledgeFieldSecurity | undefined;
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
 * - Searches an `object` source for a caller only when the caller's exposure
 *   decision serves its object and every field it serves is one the caller
 *   may query (`knowledge-source-admission.ts`), so field-level security and
 *   the object's API exposure hold for passages too.
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
    const adminCtx: ExecutionContext = { positions: [], permissions: [], systemPermissions: [], isSystem: true };
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

    const schema = this.schemaFor(objSource.object);
    const docs = records.map((rec) => recordToDocument(source, objSource, rec, schema));
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
    const sources = await this.admitSources(this.resolveSearchTargets(opts.sourceIds), opts.executionContext);
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
        // A hit is served as the source it was searched for. One whose
        // `sourceId` names another source (an adapter answering from a store
        // two sources share) is dropped: that source's admission was never
        // asked for this hit, so serving it would skip the gates above.
        let foreign = 0;
        for (const hit of hits) {
          if (hit.sourceId === source.id) rawHits.push(hit);
          else foreign++;
        }
        if (foreign > 0) {
          this.options.logger?.warn?.(
            `[knowledge] adapter '${source.adapter}' answered ${foreign} hit(s) for source '${source.id}' that name ` +
              'another source; dropped — a hit is served only as the source it was searched for.',
          );
        }
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
   * Apply an ObjectQL `data.record.created` / `data.record.updated` event
   * (the record body is the event payload's `after`) to every `object`
   * source bound to the matching object. Failures are logged but never
   * thrown — sync must not block writes.
   */
  async handleRecordUpsert(object: string, record: Record<string, unknown>): Promise<void> {
    const targets = this.sourcesForObject(object);
    for (const source of targets) {
      try {
        const objSource = source.source as ObjectKnowledgeSource;
        const doc = recordToDocument(source, objSource, record, this.schemaFor(object));
        const adapter = this.getAdapter(source.adapter);
        await adapter.upsert([doc], { source, reason: 'event-sync' });
      } catch (err) {
        this.options.logger?.warn?.(
          `[knowledge] event-sync upsert failed for source '${source.id}': ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * The registered object definition, when the bound engine exposes one
   * (`getSchema` is not on the `IDataEngine` contract; the ObjectQL engine
   * carries it). `undefined` — nothing to withhold by — otherwise.
   */
  private schemaFor(object: string): unknown {
    try {
      return (this.options.dataEngine as { getSchema?: (name: string) => unknown } | undefined)
        ?.getSchema?.(object);
    } catch {
      return undefined;
    }
  }

  /** Apply an ObjectQL `data.record.deleted` event (the id is the payload's `recordId`). */
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

  /**
   * [ADR-0090 D10 rule 1] The sources this caller's search may reach: an
   * `object` source over an object the caller's exposure decision refuses, or
   * one serving a field the caller may not query, is not searched for that
   * caller — see `knowledge-source-admission.ts` for the gates and why they are
   * asked at source granularity. Computed once per (caller, object) per search.
   *
   * The system context bypasses, as it bypasses the row re-check. A caller
   * with NO context, or a service with no data engine bound, cannot be judged
   * and is served no `object` source at all — never searched, so no passage of
   * one can reach the caller through a hit the row re-check cannot place (a
   * hit with no `sourceRecordId`). Fails CLOSED: a gate that throws refuses
   * every source over that object, reported once at `error`. The objects'
   * admissions are asked concurrently.
   */
  private async admitSources(
    sources: KnowledgeSource[],
    ctx: ExecutionContext | undefined,
  ): Promise<KnowledgeSource[]> {
    if (ctx?.isSystem) return sources;
    const engine = this.options.dataEngine;
    if (!ctx || !engine) {
      const kept = sources.filter((source) => source.source.kind !== 'object');
      if (kept.length < sources.length) {
        this.options.logger?.warn?.(
          !ctx
            ? '[knowledge] retrieval with no ExecutionContext — object sources are not searched: a missing ' +
                'identity is not a grant of authority, so retrieval fails closed rather than searching the whole corpus unscoped. ' +
                'Pass the caller identity (or an explicit system context) to retrieve object-backed knowledge.'
            : '[knowledge] no IDataEngine bound — object sources are not searched, to stay safe.',
        );
      }
      return kept;
    }
    const deps = {
      readSchema: (object: string): unknown => {
        const getSchema = (engine as { getSchema?: (name: string) => unknown }).getSchema;
        return typeof getSchema === 'function' ? getSchema.call(engine, object) : undefined;
      },
      isObjectPackageDisabled: (object: string): boolean =>
        registryObjectPackageDisabled((engine as { registry?: unknown }).registry)(object),
      resolveSecurity: (): KnowledgeFieldSecurity | undefined => this.options.resolveSecurity?.(),
    };
    const byObject = new Map<string, Promise<ObjectAdmission | undefined>>();
    for (const source of sources) {
      if (source.source.kind !== 'object') continue;
      const object = (source.source as ObjectKnowledgeSource).object;
      if (byObject.has(object)) continue;
      byObject.set(
        object,
        admitObject(object, ctx, deps).catch((err: unknown) => {
          this.reportGateFailure(object, err instanceof Error ? err : new Error(String(err)));
          return undefined;
        }),
      );
    }
    const out: KnowledgeSource[] = [];
    for (const source of sources) {
      if (source.source.kind !== 'object') {
        out.push(source);
        continue;
      }
      const objSource = source.source as ObjectKnowledgeSource;
      const objectAdmission = await byObject.get(objSource.object);
      if (!objectAdmission) continue; // the gate threw: reported once, refused.
      const verdict: KnowledgeSourceAdmission = objectAdmission.refused
        ? { admitted: false, reason: objectAdmission.refused, object: objSource.object }
        : admitSourceFields(objSource, objectAdmission);
      if (verdict.admitted) {
        out.push(source);
      } else {
        this.options.logger?.debug?.(
          `[knowledge] source '${source.id}' not searched for this caller: ${verdict.reason} ` +
            `(object='${verdict.object}'${verdict.field ? `, field='${verdict.field}'` : ''}).`,
        );
      }
    }
    return out;
  }

  /** A gate lookup threw: every source over `object` is refused (fail-closed), reported once at `error`, `warn` as the fallback. */
  private reportGateFailure(object: string, err: Error): void {
    const report =
      `[knowledge] the exposure or field-level read rules of object '${object}' could not be resolved ` +
      `(${err.message}); no source over it is searched for this caller (fail-closed).`;
    if (this.options.logger?.error) this.options.logger.error(report);
    else this.options.logger?.warn?.(report);
  }

  private sourcesForObject(object: string): KnowledgeSource[] {
    return objectSourcesFor([...this.sources.values()], object);
  }

  /**
   * Drop hits whose underlying ObjectQL record the caller can't read.
   * Hits of a registered file / http source are kept — the adapter is
   * responsible for any ACL enforcement there; an object-source hit with no
   * `sourceRecordId` cannot be re-checked and is dropped.
   *
   * Identity handling (#2981): an **explicit** `isSystem` context (indexing /
   * trusted server jobs) passes every hit through — it is a deliberate,
   * authored elevation. A **missing** context, however, is NOT a grant of
   * authority: with no identity we cannot prove the caller may read the
   * object-backed rows, so we FAIL CLOSED and drop object-source hits (the
   * same conservative posture as a missing data engine). This closes the
   * agent/RAG fall-open where an omitted `ToolExecutionContext.actor` used to
   * return unfiltered semantic search over the whole corpus.
   */
  private async applyPermissionFilter(
    hits: KnowledgeHit[],
    ctx: ExecutionContext | undefined,
  ): Promise<KnowledgeHit[]> {
    // Explicit elevation → pass through (indexing / trusted jobs).
    if (ctx?.isSystem) return hits;
    // No identity, or no engine to re-check with → keep only hits of a
    // registered file / http source. `admitSources` already kept object
    // sources out of the search; this holds the same line for any hit that
    // still claims one (or claims no registered source at all).
    if (!ctx || !this.options.dataEngine) {
      return hits.filter((h) => this.isNonObjectSourceHit(h));
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
      if (this.isNonObjectSourceHit(hit)) return true; // file / http hit
      // An object-source hit the re-check cannot place — no record id, or a
      // source nobody registered — is not provably readable: dropped.
      const source = this.sources.get(hit.sourceId);
      if (!source || !hit.sourceRecordId) return false;
      const objName = (source.source as ObjectKnowledgeSource).object;
      return allowed.has(`${objName}#${hit.sourceRecordId}`);
    });
  }

  /** A hit of a REGISTERED source that is not an `object` source (file / http): the adapter owns its ACL. */
  private isNonObjectSourceHit(hit: KnowledgeHit): boolean {
    const source = this.sources.get(hit.sourceId);
    return source !== undefined && source.source.kind !== 'object';
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * The `object` sources whose per-record projection of `object` is kept in step
 * with row changes — i.e. those the service may upsert into, delete from, or
 * (since #4672) de-index on behalf of, in reaction to a row's lifecycle.
 *
 * One definition, deliberately: the event-sync path
 * (`handleRecordUpsert` / `handleRecordDelete`) and the lifecycle reap guard
 * (`knowledge-reap-guard.ts`) are the two halves of one responsibility, and a
 * second copy of this predicate is exactly how they would drift into disagreeing
 * about which sources a row's disappearance concerns.
 *
 * `refresh.onRecordChange: false` opts a source out of both halves: it declares
 * that an external indexer owns the index, and the reap guard vetoes rows whose
 * de-index fails — so honouring it here is also what keeps an opted-out source
 * from ever holding up another package's retention.
 */
export function objectSourcesFor(sources: KnowledgeSource[], object: string): KnowledgeSource[] {
  return sources.filter(
    (source) =>
      source.source.kind === 'object' &&
      (source.source as ObjectKnowledgeSource).object === object &&
      (source.refresh?.onRecordChange ?? true) !== false,
  );
}

/** Deterministic document id derived from the source + record id. */
export function documentIdFor(sourceId: string, recordId: string): string {
  return `${sourceId}:${recordId}`;
}

/**
 * Project an ObjectQL record into a `KnowledgeDocument` per the
 * source's `contentFields` / `metadataFields` config. Pure function.
 *
 * `schema` (the record's registered object definition) names the fields an
 * index never carries: credential-class fields (the set the engine masks on
 * read) and `internal: true` fields (the set it omits), asked through the same
 * collectors the write-response helper uses (`@objectstack/core`). They are
 * SKIPPED — under `'*'`, and when a source names one explicitly as content or
 * metadata — rather than indexed masked: an index document is searchable text
 * served to every reader the source admits, and a mask placeholder is no
 * content. Without a schema nothing is withheld here (the engine's event body
 * and read path still apply their own projection upstream).
 */
export function recordToDocument(
  source: KnowledgeSource,
  objSource: ObjectKnowledgeSource,
  record: Record<string, unknown>,
  schema?: unknown,
): KnowledgeDocument {
  const withheld = new Set<string>([
    ...collectCredentialWriteResponseFields(schema),
    ...collectInternalWriteResponseFields(schema),
  ]);
  const recordId = String(record.id ?? (record as any)._id ?? '');
  const contentParts: string[] = [];
  for (const field of objSource.contentFields) {
    if (field === '*') {
      for (const [k, v] of Object.entries(record)) {
        if (withheld.has(k)) continue;
        if (typeof v === 'string' && v.length > 0 && k !== 'id') contentParts.push(v);
      }
    } else {
      if (withheld.has(field)) continue;
      const v = record[field];
      if (v != null) contentParts.push(String(v));
    }
  }
  const metadata: Record<string, unknown> = {};
  for (const field of objSource.metadataFields ?? []) {
    if (withheld.has(field)) continue;
    if (record[field] !== undefined) metadata[field] = record[field];
  }
  return {
    id: documentIdFor(source.id, recordId || `unknown-${Date.now()}`),
    sourceId: source.id,
    sourceRecordId: recordId || undefined,
    content: contentParts.join('\n\n'),
    title: typeof record.title === 'string' && !withheld.has('title') ? record.title : undefined,
    metadata,
  };
}
