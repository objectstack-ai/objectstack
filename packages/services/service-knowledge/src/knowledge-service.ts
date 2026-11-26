// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type {
  AdapterContext,
  AdapterIndexExpectation,
  AdapterScopeTerm,
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
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { createKnowledgeTools, refusal, type KnowledgeTools } from './knowledge-tools.js';
import { resolveSplit, splitDocument, type ResolvedSplit } from './split/index.js';
import { indexExpectation } from './knowledge-index-fingerprint.js';
import {
  documentOrganizationId,
  searchOrganizationIds,
  type KnowledgeTenancyPostureResolver,
} from './knowledge-organization-scope.js';
import {
  admitObject,
  admitSourceFields,
  declaredFields,
  documentTitleField,
  type KnowledgeFieldSecurity,
  type KnowledgeSourceAdmission,
  type ObjectAdmission,
} from './knowledge-source-admission.js';
import { readSearchScope, scopeCheck, scopeTermsFor, type SearchScopeEntry } from './knowledge-search-scope.js';

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
   * The settings page's `knowledge.chunk_target`, read each time the service
   * splits a batch of documents — never once at boot, so a value saved later
   * applies to the next write. Answers `undefined` when nothing is stored or
   * no settings service serves the namespace; the splitter then uses a
   * source's own `split.maxChars`, else 800. A rejection is reported at `warn`
   * and read as `undefined`. `KnowledgeServicePlugin` wires it to the
   * `settings` service.
   */
  resolveChunkTarget?: () => Promise<number | undefined>;
  /**
   * The deployment's effective tenancy posture (ADR-0105 D1), read at each
   * assembly and each search (ADR-0161 K8, item 9): under `group` and
   * `isolated` a document assembled from a record carries the record's
   * organization, and a search hands the adapter the caller's organizations
   * (`knowledge-organization-scope.ts`). Answers `undefined` where no
   * `tenancy` service is composed, and throws where one is registered but
   * cannot be read. `KnowledgeServicePlugin` always wires it; omitted, the
   * service reads as a `single`-posture deployment.
   */
  resolveTenancyPosture?: KnowledgeTenancyPostureResolver;
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
  /** Adapters whose answer the scope check has already dropped a hit from — reported once each ({@link searchRound}). */
  private readonly scopeIgnoredReported = new Set<string>();
  /** `${source id}\u0000${object}` pairs a scope entry did not reach for two or more parent links — reported once each. */
  private readonly scopeAmbiguousReported = new Set<string>();
  /**
   * The tail of each document's record-sync chain, keyed by document id
   * (`${source.id}:${recordId}`) — see {@link serializeRecordSync}. A key
   * lives only while a sync for it is pending.
   */
  private readonly recordSyncTails = new Map<string, Promise<void>>();
  /**
   * The tail of each source's reindex chain, keyed by source id — see
   * {@link reindexSource}. A key lives only while a walk of it is pending.
   */
  private readonly reindexTails = new Map<string, Promise<void>>();
  /** Sources whose `where` the no-engine sync path has already reported it cannot enforce. */
  private readonly whereUnenforceableReported = new Set<string>();
  /**
   * Documents a record-level search found stale and handed to a background
   * repair ({@link repairStale}): one repair per document until a later
   * search finds its hash matching, which clears the entry.
   */
  private readonly freshnessRepairs = new Set<string>();

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
    if (!adapter) throw unmountedAdapterError(id, this.listAdapters());
    return adapter;
  }

  /**
   * Say once, at `error`, which registered sources name an adapter nothing
   * registered — the boot's reading, taken by the plugin at
   * `kernel:bootstrapped`, once every plugin has started and registered its
   * store. Indexing and searching such a source answer the same refusal
   * ({@link getAdapter}); the boot itself goes on. Answers the sources named.
   */
  reportUnmountedAdapters(): string[] {
    const mounted = this.listAdapters();
    const unmounted = this.listSources().filter((source) => !this.adapters.has(source.adapter));
    for (const source of unmounted) {
      this.options.logger?.error?.(
        `[knowledge] source '${source.id}' names adapter '${source.adapter}', which is not mounted ` +
          `(mounted: ${mounted.length === 0 ? 'none' : mounted.join(', ')}). Indexing and searching it answer ` +
          `${UNMOUNTED_ADAPTER_CODE} until its adapter is one of those, or the '${source.adapter}' store is mounted.`,
      );
    }
    return unmounted.map((source) => source.id);
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

  /**
   * Write one caller-built document. An adapter that declares
   * `capabilities.chunks` receives it with the service's passages, split the
   * way every other path splits ({@link prepareDocuments}). A `whole`
   * document over the embedder's input budget is removed from the index and
   * the call throws, naming the estimate and the budget.
   */
  async indexDocument(sourceId: string, doc: KnowledgeDocument): Promise<void> {
    const source = this.requireSource(sourceId);
    const adapter = this.getAdapter(source.adapter);
    // `docHash` is the service's to compute (ADR-0161 K8, item 2). A caller's
    // own value is refused, never replaced in silence: a door that accepted it
    // and stored something else would answer as if it had been honoured.
    if (doc.docHash !== undefined) {
      throw new Error(
        `[knowledge] indexDocument refused document '${doc.id}': docHash is computed by the knowledge service ` +
          'from the content, title and metadata; omit it.',
      );
    }
    // `organizationId` is the service's too (ADR-0161 K8, item 9): it is the
    // organization of the record a document was assembled from. A caller's own
    // value would place a document inside an organization's ranking scope on
    // the caller's word alone.
    if (doc.organizationId !== undefined) {
      throw new Error(
        `[knowledge] indexDocument refused document '${doc.id}': organizationId is set by the knowledge service ` +
          "from the record a document is assembled from; omit it.",
      );
    }
    // The passages are the service's too (ADR-0161 K1): one splitter cuts
    // every document, so a caller's own `chunks` are refused the same way.
    if (doc.chunks !== undefined) {
      throw new Error(
        `[knowledge] indexDocument refused document '${doc.id}': chunks are cut by the knowledge service's ` +
          "splitter from the content, by the source's split; omit them.",
      );
    }
    const plan = await this.planIndex(source, adapter);
    const ctx = plan.context('manual');
    const prepared = this.prepareDocuments(plan, [{ ...doc, docHash: computeDocHash(doc) }]);
    if (prepared.failed.length > 0) {
      const failure = prepared.failed[0];
      await adapter.delete([doc.id], ctx);
      throw new Error(
        `[knowledge] indexDocument did not index document '${doc.id}' and removed it from the index: ${failure.reason}`,
      );
    }
    await adapter.upsert(prepared.ready, ctx);
  }

  /**
   * What every adapter call for `source` carries, read now (ADR-0161 K7; K8,
   * item 8): the split the service applies for this adapter — resolved from
   * the source's `split`, the settings page's `knowledge.chunk_target` and the
   * adapter's reported `embedding.maxInputTokens`, absent for an adapter that
   * does not take chunks — and the index fingerprint and recipe hash computed
   * over that same split, the adapter's descriptor and the source. One read
   * feeds both, so the fingerprint is always the fingerprint of the split the
   * documents were cut by. Never cached: the settings, the descriptor and the
   * object definition may each change between two calls.
   */
  private async planIndex(
    source: KnowledgeSource,
    adapter: IKnowledgeAdapter,
    chunkTarget: () => Promise<number | undefined> = () => this.readChunkTarget(),
  ): Promise<IndexPlan> {
    const split = adapter.capabilities?.chunks === true
      ? resolveSplit({
        split: source.source.kind === 'object' ? (source.source as ObjectKnowledgeSource).split : undefined,
        chunkTarget: await chunkTarget(),
        maxInputTokens: adapter.embedding?.maxInputTokens,
      })
      : undefined;
    const index = indexExpectation(
      { source, embedding: adapter.embedding, ...(split === undefined ? {} : { split }) },
      { source, schema: source.source.kind === 'object' ? this.schemaFor((source.source as ObjectKnowledgeSource).object) : undefined },
    );
    return {
      source,
      adapter,
      ...(split === undefined ? {} : { split }),
      index,
      context: (reason) => ({ source, reason, index }),
    };
  }

  /**
   * The ONE place documents are split before an adapter sees them (ADR-0161
   * K1). An adapter that does not declare `capabilities.chunks` gets the
   * documents as they are, without `chunks` — it splits them itself, as
   * before. One that does gets each document with the passages of
   * {@link splitDocument}, under the split {@link planIndex} resolved for
   * this call: the source's `split` (an object source's key; any other source
   * splits `recursive`), the settings page's `knowledge.chunk_target`, and the
   * adapter's reported `embedding.maxInputTokens` — read for this call, never
   * cached. A document the split cannot index (a `whole` document over the
   * budget) is answered in `failed`, never truncated; the caller removes it.
   */
  private prepareDocuments(
    plan: IndexPlan,
    docs: KnowledgeDocument[],
  ): {
    ready: KnowledgeDocument[];
    failed: Array<{ documentId: string; reason: string; estimate: number; budget: number }>;
  } {
    const split = plan.split;
    if (split === undefined || docs.length === 0) return { ready: docs, failed: [] };
    const ready: KnowledgeDocument[] = [];
    const failed: Array<{ documentId: string; reason: string; estimate: number; budget: number }> = [];
    for (const doc of docs) {
      const out = splitDocument(doc, split);
      if (out.ok) ready.push({ ...doc, chunks: out.chunks });
      else failed.push({ documentId: doc.id, reason: out.reason, estimate: out.estimate, budget: out.budget });
    }
    return { ready, failed };
  }

  /** The settings page's `knowledge.chunk_target`, read now; `undefined` when unset or unreadable. */
  private async readChunkTarget(): Promise<number | undefined> {
    const resolve = this.options.resolveChunkTarget;
    if (!resolve) return undefined;
    try {
      return await resolve();
    } catch (err) {
      this.options.logger?.warn?.(
        `[knowledge] the settings page's knowledge.chunk_target could not be read (${errorText(err)}); ` +
          "splitting by the source's own split.maxChars, else 800.",
      );
      return undefined;
    }
  }

  async deleteDocument(sourceId: string, documentId: string): Promise<void> {
    const source = this.requireSource(sourceId);
    const adapter = this.getAdapter(source.adapter);
    await adapter.delete([documentId], (await this.planIndex(source, adapter)).context('manual'));
  }

  // ── Reindex ───────────────────────────────────────────────────────

  /**
   * Walk an `object` source and push its documents to the adapter.
   *
   * ## Paging
   *
   * The walk reads at most `REINDEX_PAGE_SIZE` (100) rows per `find`, in
   * `id` order, each page continuing after the last id of the one before
   * (`where AND id > cursor` — a keyset walk, so a page never re-reads or skips
   * a row the way an offset does when rows land meanwhile), and upserts each
   * page in its own adapter call before reading the next. Every `find` carries
   * a `limit`, and no `upsert` holds more than one page. Each row goes through
   * the same {@link recordToDocument} gate as the event sync.
   *
   * Only an EMPTY page ends the walk: a page may come back short of its
   * `limit` with rows still after it (an `afterFind` hook may drop rows).
   *
   * `opts.limit` caps the TOTAL number of rows the walk reads (the last page is
   * shortened to it; a fractional cap is floored, a negative or non-finite one
   * is refused with `ok: false`); `opts.dryRun` asks `count` under the
   * source's `where` instead of reading rows, and reports that count (capped
   * by `limit`).
   *
   * ## Failure
   *
   * A page whose read, document build or upsert fails ends the walk: the
   * result is `ok: false`, its `message` names the page (1-based) and the id
   * it continued after, and `discovered` / `indexed` count the pages done
   * before it. Pages already upserted stay in the index; nothing is rolled
   * back.
   *
   * ## What is serialized, and what is not
   *
   * Walks of one source run one after another in this process (a per-source
   * `chainAfter` chain): a second `reindexSource` of a source waits until the
   * first has finished, so the two walks' pages never interleave. Walks of
   * different sources run concurrently.
   *
   * Record events do NOT wait for a walk: the record sync has its own
   * per-document chain. A row updated or deleted between a page's read and
   * that page's upsert is written back from the older read — a deleted row's
   * document then stays in the index as a ghost until the next complete walk
   * purges it (below), or the row's next event repairs it.
   *
   * ## Skip and purge (ADR-0161 K8, items 1–2)
   *
   * When the adapter implements `listDocuments`, the walk first lists what the
   * adapter holds for the source (document id → stored `docHash`). A row whose
   * document's computed `docHash` equals the listed one is not upserted again
   * (`skipped`); every other document is (`indexed`).
   *
   * After a COMPLETE walk — no `limit`, no `dryRun`, every page done — the
   * documents listed before the walk that the walk did not see are purge
   * candidates, handed to {@link purgeDocuments}: each is confirmed by the
   * same re-read the event sync makes (`where` AND id) and deleted only when
   * that re-read finds no row, so a row created or restored meanwhile keeps its
   * document. A document written during the walk was not listed, and so is
   * never a candidate. `purged` counts the deletions.
   *
   * `purged` is `null` when no purge ran: a walk with a `limit` or a `dryRun`,
   * a failed walk, a source with `refresh.onRecordChange: false` (an external
   * indexer owns its index), or an adapter without `listDocuments` — which
   * also skips nothing, the walk otherwise as before. A listing that fails
   * skips and purges nothing either; the result's `message` says so.
   *
   * ## The build (ADR-0161 K7, rule 3; K8, item 8)
   *
   * Every adapter call of the walk carries the index fingerprint and recipe
   * hash ({@link planIndex}), computed once per walk. A COMPLETE walk is a
   * build: before it the service calls the adapter's `beginBuild`, and after
   * the walk and its purge it calls `completeBuild` once, so the adapter
   * records what it now holds. A walk with a `limit` or a `dryRun` is not a
   * build and makes neither call. `beginBuild` refusing stops the walk before
   * any write (`ok: false`, its message carried). A walk that fails, a purge
   * that stops, or a listing that failed (the purge could not run, so stale
   * documents may remain) is not completed: the adapter keeps what it held,
   * and the next complete walk builds again.
   */
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
        skipped: 0,
        purged: null,
        failed: 0,
        failures: [],
        message:
          `Reindex for kind=${source.source.kind} is not handled by KnowledgeService. ` +
          `Trigger ingestion through the adapter (${source.adapter}) directly.`,
      };
    }

    const engine = this.options.dataEngine;
    if (!engine) {
      return {
        ok: false,
        discovered: 0,
        indexed: 0,
        skipped: 0,
        purged: null,
        failed: 0,
        failures: [],
        message: 'KnowledgeService has no IDataEngine bound; cannot walk object source.',
      };
    }

    return chainAfter(this.reindexTails, source.id, () =>
      this.walkObjectSource(source, source.source as ObjectKnowledgeSource, adapter, engine, opts),
    );
  }

  /** The paged walk of {@link reindexSource}; runs inside that source's chain. */
  private async walkObjectSource(
    source: KnowledgeSource,
    objSource: ObjectKnowledgeSource,
    adapter: IKnowledgeAdapter,
    engine: IDataEngine,
    opts: KnowledgeReindexOptions,
  ): Promise<KnowledgeReindexResult> {
    const object = objSource.object;
    // `limit` keeps its meaning: a cap on the TOTAL rows the walk takes. A
    // fractional cap is floored; a negative or non-finite one is refused
    // rather than read as "nothing to do".
    if (opts.limit !== undefined && !(typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit >= 0)) {
      return {
        ok: false,
        object,
        discovered: 0,
        indexed: 0,
        skipped: 0,
        purged: null,
        failed: 0,
        failures: [],
        message: `reindex of source '${source.id}' refused: limit must be a non-negative finite number, got ${String(opts.limit)}.`,
      };
    }
    const cap = opts.limit === undefined ? undefined : Math.floor(opts.limit);
    // RLS-bypassing system context — this is a server-side admin op.
    const context = systemContext();

    if (opts.dryRun) {
      const total = await engine.count(object, { where: objSource.where }, { context });
      return {
        ok: true,
        object,
        discovered: cap === undefined ? total : Math.min(total, cap),
        indexed: 0,
        skipped: 0,
        purged: null,
        failed: 0,
        failures: [],
        message: 'dryRun=true; no documents pushed.',
      };
    }

    // The posture decides whether each document carries its record's
    // organization (ADR-0161 K8, item 9); read once per walk. A posture that
    // cannot be read stops the walk before any write: a document assembled
    // without its organization would drop out of every walled search.
    let posture: TenancyPosture | undefined;
    try {
      posture = await this.readTenancyPosture();
    } catch (err) {
      return {
        ok: false,
        object,
        discovered: 0,
        indexed: 0,
        skipped: 0,
        purged: null,
        message: `reindex of source '${source.id}' refused: the tenancy posture could not be read (${errorText(err)}); nothing was written.`,
      };
    }

    // One plan for the whole walk: the split every page is cut by, and the
    // fingerprint and recipe hash every adapter call carries.
    const plan = await this.planIndex(source, adapter);
    const ctx = plan.context('reindex');

    // A complete walk is a build (K7, rule 3): the adapter is told before the
    // first write, and may open a generation for a new fingerprint — or refuse.
    const build = cap === undefined;
    if (build && typeof adapter.beginBuild === 'function') {
      try {
        await adapter.beginBuild(ctx);
      } catch (err) {
        return {
          ok: false,
          object,
          discovered: 0,
          indexed: 0,
          skipped: 0,
          purged: null,
          failed: 0,
          failures: [],
          message: `reindex of source '${source.id}' refused: the adapter did not begin the build, and nothing was written. ${operatorText(err)}`,
        };
      }
    }

    // What the adapter holds before the walk: the skip's hashes, and the
    // purge's candidates once the walk is complete.
    const listing = await listAdapterDocuments(source, adapter, plan.index);
    const listed = listing.ok ? listing.documents : undefined;
    const listingNote = listing.ok || listing.reason === undefined
      ? undefined
      : `the adapter's document listing failed (${listing.reason}), so no document was skipped and none was purged.`;
    if (listingNote) this.options.logger?.warn?.(`[knowledge] reindex of source '${source.id}': ${listingNote}`);

    const schema = this.schemaFor(object);
    const seen = new Set<string>();
    let discovered = 0;
    let indexed = 0;
    let skipped = 0;
    // Documents the split could not index (a `whole` document over the
    // embedder's budget): removed from the index, counted, and the first
    // MAX_REINDEX_FAILURES named.
    let failed = 0;
    const failures: Array<{ documentId: string; reason: string }> = [];
    let cursor: string | number | undefined;
    for (let page = 1; ; page++) {
      const want = cap === undefined ? REINDEX_PAGE_SIZE : Math.min(REINDEX_PAGE_SIZE, cap - discovered);
      if (!(want > 0)) break;
      const after = cursor === undefined ? '' : ` (after id '${cursor}')`;
      const stopped = (what: string): KnowledgeReindexResult => ({
        ok: false,
        object,
        discovered,
        indexed,
        skipped,
        purged: null,
        failed,
        failures: [...failures],
        message: `reindex of source '${source.id}' stopped at page ${page}${after}: ${what}`,
      });

      const byCursor = cursor === undefined ? undefined : { id: { $gt: cursor } };
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await engine.find(
          object,
          {
            where:
              byCursor === undefined
                ? objSource.where
                : objSource.where === undefined ? byCursor : { $and: [objSource.where, byCursor] },
            orderBy: [{ field: 'id', order: 'asc' }],
            limit: want,
          },
          { context },
        );
      } catch (err) {
        return stopped(`the read failed: ${errorText(err)}`);
      }
      // Only an EMPTY page ends the walk. A short page does not: `find` does
      // not promise `min(limit, remaining)` rows — an `afterFind` hook may drop
      // rows from a page — so rows after a short page can still exist.
      // A read that answers no list is a failed read, never the end of the
      // source: read as an empty page it would make a complete walk of nothing
      // and hand every listed document to the purge.
      if (!Array.isArray(rows)) {
        return stopped(`the read answered ${describeValue(rows)} instead of a list of rows.`);
      }
      if (rows.length === 0) break;

      let docs: KnowledgeDocument[];
      try {
        docs = rows.map((row) => recordToDocument(source, objSource, row, schema, posture));
      } catch (err) {
        return stopped(`building the page's documents failed: ${errorText(err)}`);
      }
      // A document whose computed hash equals the one the adapter listed for it
      // is unchanged: it is not written again.
      const changed = listed === undefined
        ? docs
        : docs.filter((doc) => {
          const stored = listed.get(doc.id);
          return stored === undefined || stored !== doc.docHash;
        });
      // One split per changed document, for an adapter that takes chunks.
      const prepared = this.prepareDocuments(plan, changed);
      if (prepared.ready.length > 0) {
        try {
          await adapter.upsert(prepared.ready, ctx);
        } catch (err) {
          return stopped(`the adapter upsert failed: ${operatorText(err)}`);
        }
      }
      // A document the split cannot index is removed — an older passage of it
      // must not keep answering for text the index no longer holds — and
      // reported, never truncated.
      if (prepared.failed.length > 0) {
        try {
          await adapter.delete(prepared.failed.map((f) => f.documentId), ctx);
        } catch (err) {
          return stopped(`removing the page's documents that cannot be indexed failed: ${operatorText(err)}`);
        }
        for (const f of prepared.failed) {
          failed += 1;
          if (failures.length < MAX_REINDEX_FAILURES) failures.push({ documentId: f.documentId, reason: f.reason });
        }
      }
      for (const doc of docs) seen.add(doc.id);
      discovered += rows.length;
      indexed += prepared.ready.length;
      skipped += docs.length - changed.length;

      // The next page continues after this page's last id. A last row with no
      // id, or one that did not move past the cursor (an engine that ignored
      // the `id > cursor` condition), ends the walk rather than looping on it.
      const lastId = rows[rows.length - 1].id;
      if (!isRecordId(lastId)) {
        return stopped('the page was indexed, but its last row carries no id, so the walk cannot continue after it.');
      }
      if (lastId === cursor) {
        return stopped("the page was indexed, but its last row's id did not move past the cursor, so the walk cannot continue.");
      }
      cursor = lastId;
    }

    // The purge runs only after a COMPLETE walk: a `limit` walk saw part of
    // the source, so "not seen" there means nothing (a failed page returned
    // above; `dryRun` returned before the walk).
    const failedNote = failed === 0
      ? undefined
      : `${failed} document(s) cannot be indexed under the source's split and were removed from the index ` +
        `(${failures.length === failed ? 'each' : `the first ${failures.length}`} named in failures).`;
    const done: KnowledgeReindexResult = {
      ok: true,
      object,
      discovered,
      indexed,
      skipped,
      purged: null,
      failed,
      failures,
      ...(failedNote === undefined ? {} : { message: failedNote }),
    };
    if (listingNote) return { ...done, message: failedNote === undefined ? listingNote : `${listingNote} ${failedNote}` };
    if (listed === undefined || cap !== undefined || (source.refresh?.onRecordChange ?? true) === false) {
      return build ? this.completeBuild(source, adapter, ctx, done) : done;
    }

    const candidates = [...listed.keys()].filter((id) => !seen.has(id));
    const purge = await purgeDocuments({
      source,
      objSource,
      adapter,
      engine,
      candidates,
      serialize: (documentId, task) => chainAfter(this.recordSyncTails, documentId, task),
      index: plan.index,
    });
    if (purge.failure !== undefined) {
      return {
        ...done,
        ok: false,
        purged: purge.purged,
        message:
          `reindex of source '${source.id}' walked every page, but its purge stopped after ${purge.purged} ` +
          `deletion(s): ${purge.failure}${failedNote === undefined ? '' : ` ${failedNote}`}`,
      };
    }
    if (purge.foreign > 0) {
      return this.completeBuild(source, adapter, ctx, {
        ...done,
        purged: purge.purged,
        message:
          `${purge.foreign} listed document(s) carry an id that is not one this source derives from a record ` +
          `('${source.id}:' and the record id); they were kept, because no row can confirm them.` +
          (failedNote === undefined ? '' : ` ${failedNote}`),
      });
    }
    return this.completeBuild(source, adapter, ctx, { ...done, purged: purge.purged });
  }

  /**
   * The end of a complete build (ADR-0161 K8, item 8 c): the adapter's
   * `completeBuild`, once, with the fingerprint and recipe hash the walk
   * carried. An adapter without it records nothing. One that throws turns the
   * walk's result into `ok: false`: every page was written, but the adapter
   * did not record what it holds, so the next complete walk builds again.
   */
  private async completeBuild(
    source: KnowledgeSource,
    adapter: IKnowledgeAdapter,
    ctx: AdapterContext,
    done: KnowledgeReindexResult,
  ): Promise<KnowledgeReindexResult> {
    if (typeof adapter.completeBuild !== 'function') return done;
    try {
      await adapter.completeBuild(ctx);
      return done;
    } catch (err) {
      return {
        ...done,
        ok: false,
        message:
          `reindex of source '${source.id}' walked every page, but the adapter did not complete the build ` +
          `(${operatorText(err)}).${done.message === undefined ? '' : ` ${done.message}`}`,
      };
    }
  }

  // ── The `search_knowledge` AI tool (ADR-0149 D2) ──────────────────

  /**
   * The `search_knowledge` tool's one definition and executor, bound to this
   * service ({@link createKnowledgeTools}). The MCP door finds it here, by
   * structure, on the `knowledge` service the kernel holds, and registers the
   * tool only where a service carries it.
   */
  knowledgeTools(): KnowledgeTools {
    return createKnowledgeTools(this);
  }

  // ── Permission-aware search ───────────────────────────────────────

  /**
   * Search every source the caller is admitted to, re-check each object-source
   * hit as the caller ({@link applyPermissionFilter}), and answer the best
   * `topK` hits by score — passages, or records under `granularity: 'record'`.
   *
   * ## The record scope (`scope`, ADR-0161 K8, item 17)
   *
   * A scope is held to its bounds before anything else is done
   * ({@link readSearchScope}: a coded refusal past them), then turned into the
   * terms of each admitted source ({@link sourcesInScope}). A source no entry
   * reaches is not searched, so an empty scope answers no hits and asks no
   * adapter. Each searched adapter is handed its source's terms, and every hit
   * it answers is checked against them, whatever the adapter did
   * ({@link searchRound}). The refill below counts the hits that passed both
   * that check and the re-check; whether a source may hold more is still judged
   * on how many hits its adapter answered.
   *
   * ## The refill after the permission filter
   *
   * The re-check runs AFTER ranking, so a caller who may read few of the
   * matching rows would be answered from what is left of `topK` ranked hits —
   * the fewer rows a caller may read, the closer to empty. So when the re-check
   * can remove hits (a caller who is not the system identity, with an engine to
   * re-check with), each `object` source is asked for
   * `topK × SEARCH_FIRST_ROUND_FACTOR` hits. When the survivors name fewer
   * than `topK` records ({@link distinctGroups}: several passages of one
   * record count once),
   * the sources that answered as many hits as they were asked — the only ones
   * that may hold more — are asked once more, for
   * `topK × SEARCH_REFILL_FACTOR`; that round's hits replace the source's
   * first-round hits (a source that fails it keeps them). At most two rounds,
   * and each embeds the query once per source it asks. An adapter that caps
   * `topK` below what it was asked answers fewer than asked, so it is never
   * asked again.
   *
   * A `file` / `http` source is asked for `topK` once: the re-check never
   * removes its hits. The system identity, and a caller the service cannot
   * re-check (no context, no engine — object sources are then not searched at
   * all), get one round of `topK`.
   *
   * ## Records, not chunks (`granularity: 'record'`, `groupBy`)
   *
   * Several passages of one record would fill `topK` with one record, so
   * under record granularity EVERY source — `file` / `http` too, and for every
   * caller — is asked `topK × SEARCH_FIRST_ROUND_FACTOR` passages, and the
   * sources that answered all they were asked are refilled once, at
   * `topK × SEARCH_REFILL_FACTOR`, when the survivors name fewer than `topK`
   * groups. That refill is the cap: a search reads at most
   * `topK × SEARCH_REFILL_FACTOR` passages per source, and answers fewer than
   * `topK` records when fewer groups lie within it (logged at `debug`). The
   * answer is then one hit per group ({@link answerByRecord}): the best
   * passage of the record — or of the `groupBy` value — each checked against
   * the record as it reads now. A caller's hit carries the record's title as
   * the permission re-check read it; the system identity is not re-checked,
   * so its hits keep the indexed title.
   *
   * The answer is at most `topK` hits (`KnowledgeSearchOptions.topK`). How
   * many hits the re-check removed is logged at `debug`, never returned: the
   * count is an oracle on rows the caller may not read.
   *
   * ## A refused source is never an empty answer (ADR-0161 K7, rule 5)
   *
   * Each source is searched under the fingerprint the service expects of its
   * index ({@link planIndex}). An adapter whose index holds another — the
   * source needs a rebuild, or is being rebuilt — refuses with an ADR-0112
   * coded error, and so may any adapter for a reason it codes. A coded refusal
   * is not logged and dropped like a failure: the sources that can be searched
   * answer, and when NONE can, the call is refused whole — this method throws
   * a coded error naming each refused source with its code. When some answer,
   * the hits are theirs. A source that answers the first round and refuses the
   * refill is refused for the whole search, its first-round hits dropped: no
   * source is both answered and named as refused. A refused source is named
   * with its code and the adapter's one-sentence message; the adapter's
   * `remedy`, operator text such as the SQL to run, goes to the `warn` log
   * with it and never to the caller. The
   * return type of `IKnowledgeService.search` has no place to name them, so a
   * caller that must name them to its own caller (the `search_knowledge` tool)
   * reads {@link searchWithRefusals}.
   */
  async search(query: string, opts: KnowledgeSearchOptions = {}): Promise<KnowledgeHit[]> {
    return (await this.searchWithRefusals(query, opts)).hits;
  }

  /**
   * {@link search}, answering the refused sources beside the hits: each
   * source whose adapter refused with an ADR-0112 coded error, with its code.
   * Throws a coded error when no source could be searched and at least one
   * refused (the call refused whole, ADR-0161 K7, rule 5); the thrown error's
   * `refused` lists them all.
   */
  async searchWithRefusals(query: string, opts: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchReport> {
    const scope = readSearchScope(opts.scope);
    const topK = opts.topK ?? this.defaultTopK;
    const groupBy = opts.groupBy;
    if (groupBy !== undefined) {
      if (typeof groupBy !== 'string' || groupBy.length === 0) {
        throw refusal('VALIDATION_ERROR', 400, '[knowledge] search groupBy must name a metadata field (a non-empty string).');
      }
      if (opts.granularity === 'chunk') {
        throw refusal(
          'VALIDATION_ERROR',
          400,
          `[knowledge] search groupBy ${quotedName(groupBy)} groups records, so it cannot be combined with granularity 'chunk'. ` +
            "Drop granularity, or pass granularity 'record'.",
        );
      }
    }
    if (opts.granularity !== undefined && opts.granularity !== 'chunk' && opts.granularity !== 'record') {
      throw refusal(
        'VALIDATION_ERROR',
        400,
        `[knowledge] search granularity must be 'chunk' or 'record', got '${String(opts.granularity)}'.`,
      );
    }
    const byRecord = opts.granularity === 'record' || groupBy !== undefined;
    const ctx = opts.executionContext;
    let admitted: Array<{ source: KnowledgeSource; organizationIds?: string[]; scope?: AdapterScopeTerm[] }> =
      await this.admitSources(this.resolveSearchTargets(opts.sourceIds), ctx);
    if (scope !== undefined) admitted = this.sourcesInScope(admitted, scope);
    if (groupBy !== undefined) admitted = this.sourcesGroupableBy(admitted, groupBy);
    if (admitted.length === 0) return { hits: [], refused: [] };
    const sources = await this.planSearches(admitted);

    const filtered = ctx !== undefined && ctx.isSystem !== true && this.options.dataEngine !== undefined;
    const widened = (source: KnowledgeSource): boolean =>
      byRecord || (filtered && source.source.kind === 'object');
    const firstAsk = (source: KnowledgeSource): number =>
      widened(source) ? topK * SEARCH_FIRST_ROUND_FACTOR : topK;
    const groupOf = byRecord
      ? (hit: KnowledgeHit): string | undefined => this.groupKeyOf(hit, groupBy)
      : recordKeyOf;
    const refused: KnowledgeSearchRefusal[] = [];
    const first = await this.searchRound(query, sources, firstAsk, opts.filter, refused);
    if (first.size === 0 && refused.length > 0) throw wholeRefusal(refused);
    const raw = [...first.values()].flatMap((answer) => answer.hits);
    let kept = await this.applyPermissionFilter(raw, ctx, byRecord);
    let removed = raw.length - kept.length;

    if ((filtered || byRecord) && distinctGroups(kept, groupOf) < topK) {
      const saturated = sources.filter(({ source }) => {
        const answer = first.get(source.id);
        return widened(source) && answer !== undefined && answer.answered >= firstAsk(source);
      });
      if (saturated.length > 0) {
        const refusedBefore = refused.length;
        const refill = await this.searchRound(query, saturated, () => topK * SEARCH_REFILL_FACTOR, opts.filter, refused);
        // A refilled source's second answer is a superset of its first: its
        // first-round survivors are dropped and the whole answer re-checked.
        const refilledHits = [...refill.values()].flatMap((answer) => answer.hits);
        const refilledKept = await this.applyPermissionFilter(refilledHits, ctx, byRecord);
        const firstRaw = raw.filter((hit) => refill.has(hit.sourceId)).length;
        const firstKept = kept.filter((hit) => refill.has(hit.sourceId)).length;
        kept = [...kept.filter((hit) => !refill.has(hit.sourceId)), ...refilledKept];
        removed += refilledHits.length - refilledKept.length - (firstRaw - firstKept);
        // A source that refused the refill (its index changed between the two
        // rounds) is refused for the whole search: its first-round hits are
        // dropped, so no source is both answered and named as refused.
        const refusedInRefill = new Set(refused.slice(refusedBefore).map((r) => r.sourceId));
        if (refusedInRefill.size > 0) {
          kept = kept.filter((hit) => !refusedInRefill.has(hit.sourceId));
          if ([...first.keys()].every((id) => refusedInRefill.has(id))) throw wholeRefusal(refused);
        }
      }
    }

    if (removed > 0) {
      this.options.logger?.debug?.(
        `[knowledge] the permission re-check removed ${removed} hit(s) this caller may not read; ` +
          `${Math.min(byRecord ? distinctGroups(kept, groupOf) : kept.length, topK)} of topK=${topK} answered.`,
      );
    }
    kept.sort((a, b) => b.score - a.score);
    if (!byRecord) return { hits: kept.slice(0, topK), refused };
    const { hits: answer, capped } = await this.answerByRecord(kept, topK, groupOf);
    if (answer.length < topK && !capped) {
      this.options.logger?.debug?.(
        `[knowledge] record-level search answered ${answer.length} of topK=${topK} ` +
          `${groupBy === undefined ? 'records' : `${quotedName(groupBy)} groups`}: no more within the refill cap ` +
          `(topK × ${SEARCH_REFILL_FACTOR} passages per source).`,
      );
    }
    return { hits: answer, refused };
  }

  /**
   * The sources a `groupBy` search asks: every `file` / `http` source (it
   * groups by document), and each `object` source that lists `groupBy` in its
   * `metadataFields`. Any other object source answers no hits for this search
   * — its hits carry no group value, and a hit is never answered ungrouped.
   */
  private sourcesGroupableBy<T extends { source: KnowledgeSource }>(sources: T[], groupBy: string): T[] {
    return sources.filter(({ source }) => {
      if (source.source.kind !== 'object') return true;
      if (((source.source as ObjectKnowledgeSource).metadataFields ?? []).includes(groupBy)) return true;
      this.options.logger?.debug?.(
        `[knowledge] source '${source.id}' not searched for groupBy ${quotedName(groupBy)}: ` +
          'the field is not one of its metadataFields.',
      );
      return false;
    });
  }

  /**
   * The group a hit falls in under record granularity: with `groupBy`, an
   * object-source hit's `metadata[groupBy]` value (`undefined` — no group,
   * never answered — when the hit carries none); without it, the hit's record.
   * A `file` / `http` hit is its document either way.
   */
  private groupKeyOf(hit: KnowledgeHit, groupBy: string | undefined): string | undefined {
    const source = this.sources.get(hit.sourceId);
    if (source?.source.kind !== 'object') return `document:${hit.sourceId}#${hit.documentId}`;
    if (groupBy === undefined) return recordKeyOf(hit);
    const value = hit.metadata?.[groupBy];
    if (value === undefined || value === null || value === '') return undefined;
    return `value:${stableJson(value)}`;
  }

  /**
   * The record-level answer: one hit per group, the group's best passage,
   * best group first, at most `topK`. `hits` is sorted best first.
   *
   * ## The freshness check
   *
   * The index is a copy, and a record may have changed since it was indexed.
   * So each `object`-source hit about to be answered is checked against its
   * record as it reads now — one system-context read per source, of the hits'
   * records only (at most `topK`), `{ $and: [where, { id: { $in } }] }`
   * projected to the fields assembly reads. A record that no longer exists or
   * no longer matches `where`, or whose recomputed `docHash` differs from the
   * hit's (the stored hash), is dropped — all of its passages — and its
   * document repaired in the background ({@link repairStale}) unless the source
   * opted out of the event sync (`refresh.onRecordChange: false`: an external
   * indexer owns that index, so the service writes nothing to it and the hit
   * is only dropped). A group whose
   * lead was dropped falls back to its next passage, and the next groups move
   * up; that is checked again, at most `SEARCH_FRESHNESS_ROUNDS` times, after
   * which a hit still unchecked is not answered (`capped`, logged at `debug`
   * by its own line). A hit whose adapter stores no
   * hash is checked for membership only. A read that fails drops that
   * source's checked hits (fail-closed), reported at `warn`.
   *
   * Not checked: a `file` / `http` hit (no record to read), an object hit
   * without a record id, and every hit when no data engine is bound.
   */
  private async answerByRecord(
    hits: KnowledgeHit[],
    topK: number,
    groupOf: (hit: KnowledgeHit) => string | undefined,
  ): Promise<{ hits: KnowledgeHit[]; capped: boolean }> {
    const groups = new Map<string, KnowledgeHit[]>();
    for (const hit of hits) {
      const key = groupOf(hit);
      if (key === undefined) continue;
      const members = groups.get(key);
      if (members) members.push(hit);
      else groups.set(key, [hit]);
    }
    const engine = this.options.dataEngine;
    const checkKey = (hit: KnowledgeHit): string | undefined =>
      engine !== undefined && hit.sourceRecordId !== undefined && this.sources.get(hit.sourceId)?.source.kind === 'object'
        ? `${hit.sourceId}#${hit.sourceRecordId}`
        : undefined;
    const fresh = new Set<string>();
    const stale = new Set<string>();
    const leads = (): KnowledgeHit[] => {
      const out: KnowledgeHit[] = [];
      for (const members of groups.values()) {
        const lead = members.find((hit) => {
          const key = checkKey(hit);
          return key === undefined || !stale.has(key);
        });
        if (lead) out.push(lead);
      }
      return out.sort((a, b) => b.score - a.score).slice(0, topK);
    };
    for (let round = 0; ; round++) {
      const top = leads();
      const unchecked = top.filter((hit) => {
        const key = checkKey(hit);
        return key !== undefined && !fresh.has(key);
      });
      if (unchecked.length === 0) return { hits: top, capped: false };
      if (round === SEARCH_FRESHNESS_ROUNDS) {
        this.options.logger?.debug?.(
          `[knowledge] record-level search stopped checking freshness after ${SEARCH_FRESHNESS_ROUNDS} rounds; ` +
            `${unchecked.length} unchecked hit(s) not answered.`,
        );
        return { hits: top.filter((hit) => !unchecked.includes(hit)), capped: true };
      }
      await this.checkFreshness(unchecked, fresh, stale);
    }
  }

  /**
   * One round of the freshness check ({@link answerByRecord}): read the
   * records `hits` name, one system-context read per source, and sort each
   * record into `fresh` or `stale` (`sourceId#recordId`).
   */
  private async checkFreshness(hits: KnowledgeHit[], fresh: Set<string>, stale: Set<string>): Promise<void> {
    const engine = this.options.dataEngine;
    if (!engine) return;
    const bySource = new Map<string, Map<string, KnowledgeHit>>();
    for (const hit of hits) {
      const records = bySource.get(hit.sourceId) ?? new Map<string, KnowledgeHit>();
      if (!records.has(hit.sourceRecordId!)) records.set(hit.sourceRecordId!, hit);
      bySource.set(hit.sourceId, records);
    }
    let posture: { value: TenancyPosture | undefined } | null | undefined;
    for (const [sourceId, records] of bySource) {
      const source = this.sources.get(sourceId)!;
      const objSource = source.source as ObjectKnowledgeSource;
      const ids = [...records.keys()];
      const byId = { id: { $in: ids } };
      const schema = this.schemaFor(objSource.object);
      let rows: unknown;
      try {
        if (posture === undefined) {
          try {
            posture = { value: await this.readTenancyPosture() };
          } catch (err) {
            posture = null;
            this.options.logger?.warn?.(
              `[knowledge] the tenancy posture could not be read (${errorText(err)}); the freshness check of this ` +
                'search compares no document hash, only whether each record still belongs to its source.',
            );
          }
        }
        const fields = freshnessFields(objSource, schema, posture?.value);
        rows = await engine.find(
          objSource.object,
          {
            where: objSource.where !== undefined ? { $and: [objSource.where, byId] } : byId,
            ...(fields === undefined ? {} : { fields }),
          },
          { context: systemContext() },
        );
        if (!Array.isArray(rows)) {
          throw new Error(`the read answered ${describeValue(rows)} instead of a list of rows`);
        }
      } catch (err) {
        this.options.logger?.warn?.(
          `[knowledge] the freshness check of source '${sourceId}' could not read its records ` +
            `(${errorText(err)}); its hits are not answered.`,
        );
        for (const id of ids) stale.add(`${sourceId}#${id}`);
        continue;
      }
      const byRow = new Map<string, Record<string, unknown>>();
      for (const row of rows as Array<Record<string, unknown> | null | undefined>) {
        if (row && isRecordId(row.id)) byRow.set(String(row.id), row);
      }
      for (const [recordId, hit] of records) {
        const key = `${sourceId}#${recordId}`;
        const docId = documentIdFor(sourceId, recordId);
        const row = byRow.get(recordId);
        const changed =
          row !== undefined &&
          hit.docHash !== undefined &&
          posture !== null &&
          recordToDocument(source, objSource, row, schema, posture?.value).docHash !== hit.docHash;
        if (row === undefined || changed) {
          stale.add(key);
          this.repairStale(source, objSource, recordId);
        } else {
          fresh.add(key);
          if (hit.docHash !== undefined && posture !== null) this.freshnessRepairs.delete(docId);
        }
      }
    }
  }

  /**
   * Repair the document of a record the freshness check found stale: the
   * event sync's own path ({@link syncRecord}, serialized per document), run
   * in system context, in this process and NOT awaited — the search that found
   * it answers without it. Single-flight per document, and at most once per
   * document until a later search finds its hash matching. Never throws into
   * the search. Moves to the scheduled reconcile's queue when that lands.
   *
   * A source with `refresh.onRecordChange: false` is never repaired: it is
   * asked through {@link objectSourcesFor}, the one predicate that keeps the
   * service's writes out of a source an external indexer owns, so the stale
   * hit is dropped from the answer and its index entry left to that indexer.
   */
  private repairStale(source: KnowledgeSource, objSource: ObjectKnowledgeSource, recordId: string): void {
    if (objectSourcesFor([source], objSource.object).length === 0) return;
    const docId = documentIdFor(source.id, recordId);
    if (this.freshnessRepairs.has(docId)) return;
    this.freshnessRepairs.add(docId);
    void this.serializeRecordSync(docId, () => this.syncRecord(source, objSource.object, recordId, { id: recordId }));
  }

  /**
   * Each admitted source paired with the fingerprint its search carries
   * ({@link planIndex}); a source whose adapter is not registered carries none
   * (the round skips it, as before).
   */
  private async planSearches(
    admitted: Array<{ source: KnowledgeSource; organizationIds?: string[]; scope?: AdapterScopeTerm[] }>,
  ): Promise<SearchTarget[]> {
    const out: SearchTarget[] = [];
    // The settings page's chunk target, read at most once for the whole search.
    let target: Promise<number | undefined> | undefined;
    const chunkTarget = (): Promise<number | undefined> => (target ??= this.readChunkTarget());
    for (const entry of admitted) {
      const adapter = this.adapters.get(entry.source.adapter);
      if (!adapter) {
        out.push(entry);
        continue;
      }
      const plan = await this.planIndex(entry.source, adapter, chunkTarget);
      out.push({ ...entry, fingerprint: plan.index.fingerprint });
    }
    return out;
  }

  /**
   * One round of {@link search}: ask each source's adapter for `ask(source)`
   * hits. Answers, per source that answered, the hits it serves and how many
   * the adapter returned (`answered`, before a hit naming another source or
   * outside the scope is dropped — what decides whether the adapter may hold
   * more). A source whose adapter is unknown or throws is absent from the
   * answer: a coded refusal (ADR-0112 `code` and `status`) is added to
   * `refused`, anything else is logged.
   *
   * Under a scope, the adapter is handed the source's terms, and every hit it
   * answers is checked against them ({@link scopeCheck}, fail closed). The first
   * time the check drops a hit of an adapter, that is reported once for the
   * adapter, at `warn`: it does not apply the scope before ranking, or answers
   * hits without the document's metadata, so its scoped searches may answer
   * fewer than `topK` (ADR-0161 K8, rule 2). How many hits were dropped is
   * logged, never returned.
   */
  private async searchRound(
    query: string,
    sources: SearchTarget[],
    ask: (source: KnowledgeSource) => number,
    filter: Record<string, unknown> | undefined,
    refused: KnowledgeSearchRefusal[],
  ): Promise<Map<string, { hits: KnowledgeHit[]; answered: number }>> {
    const out = new Map<string, { hits: KnowledgeHit[]; answered: number }>();
    for (const { source, organizationIds, fingerprint, scope } of sources) {
      const adapter = this.adapters.get(source.adapter);
      if (!adapter) {
        // Refused like an adapter that cannot serve: the caller is told which
        // source was not searched and why; the boot said so at `error`
        // (`reportUnmountedAdapters`), so no line per search.
        const coded = codedRefusalOf(unmountedAdapterError(source.adapter, this.listAdapters()));
        if (coded !== undefined) refused.push({ sourceId: source.id, ...coded });
        continue;
      }
      try {
        const hits = await adapter.search(query, {
          source,
          topK: ask(source),
          filter,
          ...(organizationIds === undefined ? {} : { organizationIds }),
          ...(fingerprint === undefined ? {} : { index: { fingerprint } }),
          ...(scope === undefined ? {} : { scope: scope.map((term) => ({ ...term, ids: [...term.ids] })) }),
        });
        // A hit is served as the source it was searched for. One whose
        // `sourceId` names another source (an adapter answering from a store
        // two sources share) is dropped: that source's admission was never
        // asked for this hit, so serving it would skip the gates above.
        const served: KnowledgeHit[] = [];
        for (const hit of hits) if (hit.sourceId === source.id) served.push(hit);
        const foreign = hits.length - served.length;
        if (foreign > 0) {
          this.options.logger?.warn?.(
            `[knowledge] adapter '${source.adapter}' answered ${foreign} hit(s) for source '${source.id}' that name ` +
              'another source; dropped — a hit is served only as the source it was searched for.',
          );
        }
        out.set(source.id, {
          hits: scope === undefined ? served : this.checkScope(served, scope, source),
          answered: hits.length,
        });
      } catch (err) {
        const coded = codedRefusalOf(err);
        if (coded !== undefined) {
          // The caller reads the code and the adapter's one-sentence message;
          // the operator reads its remedy (the SQL to run, say) here.
          refused.push({ sourceId: source.id, ...coded });
          this.options.logger?.warn?.(
            `[knowledge] source '${source.id}' refused this search and was not searched (${coded.code}): ${operatorText(err)}`,
          );
          continue;
        }
        this.options.logger?.error?.(
          `[knowledge] adapter '${source.adapter}' search failed for source '${source.id}': ${(err as Error).message}`,
        );
      }
    }
    return out;
  }

  /**
   * [ADR-0161 K8, item 17] Pair each admitted source with the terms `scope`
   * gives it ({@link scopeTermsFor}): a `record` term for an entry naming the
   * object the source indexes, a `metadata` term for an entry naming a parent
   * object the source reaches through the one parent link it lists in
   * `metadataFields`, read from the object's registered definition. A source
   * no entry reaches — every `file` / `http` source among them — is not
   * searched, logged at `debug`. A source that lists two or more parent links
   * to an entry's object is not reached by that entry, reported once per
   * source and object at `warn`, naming the fields.
   */
  private sourcesInScope<T extends { source: KnowledgeSource }>(
    sources: T[],
    scope: readonly SearchScopeEntry[],
  ): Array<T & { scope: AdapterScopeTerm[] }> {
    const out: Array<T & { scope: AdapterScopeTerm[] }> = [];
    for (const entry of sources) {
      const { terms, ambiguous } = scopeTermsFor(entry.source, scope, (object) => this.schemaFor(object));
      for (const { object, fields } of ambiguous) {
        const key = `${entry.source.id}\u0000${object}`;
        if (this.scopeAmbiguousReported.has(key)) continue;
        this.scopeAmbiguousReported.add(key);
        this.options.logger?.warn?.(
          `[knowledge] source '${entry.source.id}' lists ${fields.length} fields pointing at '${object}' ` +
            `(${fields.join(', ')}); a search scoped to '${object}' records does not reach it — ` +
            'it is not told which field the scope means.',
        );
      }
      if (terms.length === 0) {
        this.options.logger?.debug?.(
          `[knowledge] source '${entry.source.id}' not searched: no entry of the search's scope reaches it.`,
        );
        continue;
      }
      out.push({ ...entry, scope: terms });
    }
    return out;
  }

  /**
   * The hits of `source` that some scope term holds for ({@link scopeCheck});
   * the rest are dropped, and the first time an adapter's answer loses a hit
   * here it is reported once, at `warn` ({@link searchRound}).
   */
  private checkScope(hits: KnowledgeHit[], terms: readonly AdapterScopeTerm[], source: KnowledgeSource): KnowledgeHit[] {
    const inScope = scopeCheck(terms);
    const kept = hits.filter(inScope);
    const dropped = hits.length - kept.length;
    if (dropped > 0 && !this.scopeIgnoredReported.has(source.adapter)) {
      this.scopeIgnoredReported.add(source.adapter);
      this.options.logger?.warn?.(
        `[knowledge] adapter '${source.adapter}' answered ${dropped} hit(s) for source '${source.id}' outside the ` +
          "search's scope; dropped. The adapter does not apply AdapterSearchOptions.scope before ranking, or answers " +
          "hits without the document's metadata, so its scoped searches may answer fewer than topK. " +
          'Reported once for this adapter.',
      );
    }
    return kept;
  }

  // ── Sync entrypoints (called by the host plugin's event bridge) ───

  /**
   * Apply an ObjectQL `data.record.created`, `data.record.updated` or
   * `data.record.restored` event to every `object` source bound to the
   * matching object. `record` is the event payload's `after`; its `id` names
   * the row. Failures are logged but never thrown — sync must not block writes.
   *
   * ## What decides a document (ADR-0049: a declared key holds on every path)
   *
   * A source's `where` decides which rows it indexes, on the event path as on
   * the reindex walk. So with a data engine bound, each source RE-READS the row
   * under the system context — `find(object, { where: where AND id, limit: 1 })`
   * — and the database answers, not the payload:
   *
   * - a row comes back → the document is built from THAT row, through the same
   *   {@link recordToDocument} gate as the reindex walk: the fields the source
   *   lists and the record `title`, never a credential-class or `internal`
   *   field. A payload
   *   missing a field (a projected write result, a formula the write did not
   *   return) therefore cannot leave the document short;
   * - nothing comes back → the row does not match (a draft, or a row that
   *   stopped matching) and its document is deleted; deleting an absent
   *   document is a no-op.
   *
   * With NO data engine nothing can be re-read: a source without `where` keeps
   * building from `record`, and a source WITH `where` is skipped — its key
   * cannot be judged against a payload — reported once per source at `warn`.
   *
   * ## When this runs, measured against the engine
   *
   * The engine publishes `data.record.created` / `data.record.updated` from
   * inside the write's engine body (`insert` / `update`), after its `after*`
   * hooks, and so BEFORE any unit of work around the write commits — the
   * write's own unit (opened when a metadata hook can abort it) or a caller's
   * `engine.transaction(…)`. The in-process realtime service awaits each
   * subscriber in turn, so this handler runs inside the write's async context,
   * and its system-context re-read rides the same open transaction through the
   * engine's ambient transaction store: it sees the row the write just made.
   * If that unit then rolls back, the index is wrong in one of two ways: on a
   * match, the document stays built from a row that never committed; on a
   * miss, the uncommitted row did not match and the document was deleted, so
   * the committed row — which may still match — is missing from the index.
   * The row's next event or a `reindexSource` repairs a row that still exists;
   * a document built from an INSERT that rolled back has no row left to
   * repair it from — it stays until a complete `reindexSource` purges it.
   * `data.record.restored` is published after the restore's own unit has
   * committed. Bulk events (`data.records.*`) carry a count, not records, and
   * are not synced here — see the plugin's event bridge.
   *
   * Syncs of one document are serialized in this process
   * ({@link serializeRecordSync}), so two opposite events for one row cannot
   * interleave: each sync re-reads after the previous one finished, and the
   * last one leaves the index agreeing with the database. The chain is awaited
   * inline, so a write's sync can wait behind an earlier in-flight sync of the
   * same document (on a single-connection pool, up to the pool's acquire
   * timeout); the index still ends consistent.
   */
  async handleRecordUpsert(object: string, record: Record<string, unknown>): Promise<void> {
    const recordId = record.id;
    for (const source of this.sourcesForObject(object)) {
      const sync = (): Promise<void> => this.syncRecord(source, object, recordId, record);
      await (isRecordId(recordId)
        ? this.serializeRecordSync(documentIdFor(source.id, String(recordId)), sync)
        : sync());
    }
  }

  /**
   * One source's sync of one row — see {@link handleRecordUpsert}. Never throws.
   */
  private async syncRecord(
    source: KnowledgeSource,
    object: string,
    recordId: unknown,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const objSource = source.source as ObjectKnowledgeSource;
    try {
      const adapter = this.getAdapter(source.adapter);
      const engine = this.options.dataEngine;
      if (!engine) {
        if (objSource.where !== undefined) {
          this.reportWhereUnenforceable(source);
          return;
        }
        const doc = recordToDocument(source, objSource, payload, this.schemaFor(object), await this.readTenancyPosture());
        await this.writeSynced(source, adapter, doc, recordId);
        return;
      }
      if (!isRecordId(recordId)) {
        this.options.logger?.warn?.(
          `[knowledge] event-sync skipped for source '${source.id}': the event's record names no id, ` +
            'so the row cannot be re-read against the source.',
        );
        return;
      }
      const row = await rereadRow(engine, objSource, recordId);
      if (row) {
        const doc = recordToDocument(source, objSource, row, this.schemaFor(object), await this.readTenancyPosture());
        await this.writeSynced(source, adapter, doc, recordId);
      } else {
        const plan = await this.planIndex(source, adapter);
        await adapter.delete([documentIdFor(source.id, String(recordId))], plan.context('event-sync'));
      }
    } catch (err) {
      this.options.logger?.warn?.(
        `[knowledge] event-sync failed for source '${source.id}': ${(err as Error).message}`,
      );
    }
  }

  /**
   * The event sync's write of one document: split as every path splits
   * ({@link prepareDocuments}) and upserted. A document the split cannot
   * index (a `whole` document over the embedder's budget) is removed from the
   * index and reported at `error`: the write that triggered the sync
   * succeeded and search keeps answering, so nothing else shows that this
   * record is no longer findable.
   */
  private async writeSynced(
    source: KnowledgeSource,
    adapter: IKnowledgeAdapter,
    doc: KnowledgeDocument,
    recordId: unknown,
  ): Promise<void> {
    const plan = await this.planIndex(source, adapter);
    const ctx = plan.context('event-sync');
    const prepared = this.prepareDocuments(plan, [doc]);
    if (prepared.ready.length > 0) await adapter.upsert(prepared.ready, ctx);
    for (const f of prepared.failed) {
      await adapter.delete([f.documentId], ctx);
      const limit = adapter.embedding?.maxInputTokens;
      const message =
        `[knowledge] record '${String(recordId)}' of source '${source.id}' is no longer in the index and search ` +
          `will not find it: its whole document estimates ${f.estimate} tokens, over the budget of ${f.budget} ` +
          `(80% of the embedder's ${String(limit)}-token input limit), and split 'whole' does not truncate. ` +
          `Fix: give source '${source.id}' split strategy 'recursive' or 'markdown', or shorten the record.`;
      // `warn` is the guaranteed channel when a host injects no `error`.
      const logger = this.options.logger;
      if (logger?.error) logger.error(message);
      else logger?.warn?.(message);
    }
  }

  /** The no-engine path cannot judge `where`: say so once per source, never once per event. */
  private reportWhereUnenforceable(source: KnowledgeSource): void {
    if (this.whereUnenforceableReported.has(source.id)) return;
    this.whereUnenforceableReported.add(source.id);
    this.options.logger?.warn?.(
      `[knowledge] source '${source.id}' declares a where filter and no data engine is bound: record events ` +
        'for it are not synced, because the filter cannot be judged without re-reading the row. ' +
        'Bind a data engine (the objectql service) to sync it.',
    );
  }

  /**
   * Run `task` after every earlier sync of the same document (`key`) has
   * finished — an in-process promise chain per document, dropped once idle.
   * Only the ORDER of syncs is held; each still re-reads the row itself, so a
   * later sync never acts on what an earlier one read. A task that rejects
   * does not break the chain (the sync paths never throw; this is a backstop).
   */
  private serializeRecordSync(key: string, task: () => Promise<void>): Promise<void> {
    return chainAfter(this.recordSyncTails, key, task).catch(() => undefined);
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

  /**
   * Apply an ObjectQL `data.record.deleted` event (the id is the payload's
   * `recordId`). Serialized with the upserts of the same document
   * ({@link serializeRecordSync}), so a delete cannot land between another
   * sync's re-read and its write.
   */
  async handleRecordDelete(object: string, recordId: string): Promise<void> {
    const targets = this.sourcesForObject(object);
    for (const source of targets) {
      const docId = documentIdFor(source.id, recordId);
      await this.serializeRecordSync(docId, async () => {
        try {
          const adapter = this.getAdapter(source.adapter);
          await adapter.delete([docId], (await this.planIndex(source, adapter)).context('event-sync'));
        } catch (err) {
          this.options.logger?.warn?.(
            `[knowledge] event-sync delete failed for source '${source.id}': ${(err as Error).message}`,
          );
        }
      });
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
   *
   * Each admitted source carries the organizations its search hands the
   * adapter ({@link scopeByOrganization}, ADR-0161 K8, item 9). The system
   * context's bypass above covers that scope too: the system identity's
   * search is handed no organization filter.
   */
  private async admitSources(
    sources: KnowledgeSource[],
    ctx: ExecutionContext | undefined,
  ): Promise<Array<{ source: KnowledgeSource; organizationIds?: string[] }>> {
    if (ctx?.isSystem) return sources.map((source) => ({ source }));
    const engine = this.options.dataEngine;
    if (!ctx || !engine) {
      const kept = sources.filter((source) => source.source.kind !== 'object').map((source) => ({ source }));
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
    return this.scopeByOrganization(out, ctx);
  }

  /** A gate lookup threw: every source over `object` is refused (fail-closed), reported once at `error`, `warn` as the fallback. */
  private reportGateFailure(object: string, err: Error): void {
    const report =
      `[knowledge] the exposure or field-level read rules of object '${object}' could not be resolved ` +
      `(${err.message}); no source over it is searched for this caller (fail-closed).`;
    if (this.options.logger?.error) this.options.logger.error(report);
    else this.options.logger?.warn?.(report);
  }

  /** The deployment's effective tenancy posture, or `undefined` when no resolver is wired. Throws what the resolver throws. */
  private async readTenancyPosture(): Promise<TenancyPosture | undefined> {
    return this.options.resolveTenancyPosture ? await this.options.resolveTenancyPosture() : undefined;
  }

  /**
   * [ADR-0161 K8, item 9] Pair each source {@link admitSources} admitted for
   * a caller that is NOT the system identity (admission's own bypass answers
   * that one before this runs) with the organizations its search hands the
   * adapter (`searchOrganizationIds`): computed here, from the caller's
   * execution context and the deployment's posture, never from anything the
   * caller passes. A `file` / `http` source gets none — its documents carry no
   * organization, and the adapter owns its ACL.
   *
   * The posture is read once per search, and only when an `object` source is
   * admitted. A posture that cannot be read leaves every `object` source
   * unsearched for this call (fail-closed: whether a wall stands is unknown),
   * reported at `error`, `warn` as the fallback.
   */
  private async scopeByOrganization(
    sources: KnowledgeSource[],
    ctx: ExecutionContext,
  ): Promise<Array<{ source: KnowledgeSource; organizationIds?: string[] }>> {
    if (!sources.some((source) => source.source.kind === 'object')) {
      return sources.map((source) => ({ source }));
    }
    let posture: TenancyPosture | undefined;
    try {
      posture = await this.readTenancyPosture();
    } catch (err) {
      const report =
        `[knowledge] the tenancy posture could not be read (${errorText(err)}); no object source is searched ` +
        'for this caller (fail-closed).';
      if (this.options.logger?.error) this.options.logger.error(report);
      else this.options.logger?.warn?.(report);
      return sources.filter((source) => source.source.kind !== 'object').map((source) => ({ source }));
    }
    return sources.map((source) => {
      if (source.source.kind !== 'object') return { source };
      const organizationIds = searchOrganizationIds(
        ctx,
        posture,
        this.schemaFor((source.source as ObjectKnowledgeSource).object),
      );
      return organizationIds === undefined ? { source } : { source, organizationIds };
    });
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
   *
   * With `liveTitles` (record granularity), the same read — as the caller, in
   * the same query — also reads the object's display field
   * (`documentTitleField`, the field assembly takes the title from), and a
   * surviving hit's `title` is the record's title as it reads now, not as it
   * was indexed. The field gate (`admitSourceFields`) already asked that the
   * caller may query that field.
   */
  private async applyPermissionFilter(
    hits: KnowledgeHit[],
    ctx: ExecutionContext | undefined,
    liveTitles = false,
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
    const titles = new Map<string, string>(); // `${object}#${recordId}` → the title as it reads now
    for (const [object, group] of byObject) {
      const ids = [...new Set(group.map((h) => h.sourceRecordId!).filter(Boolean))];
      if (ids.length === 0) continue;
      const schema = liveTitles ? this.schemaFor(object) : undefined;
      const withheld = new Set<string>([
        ...collectCredentialWriteResponseFields(schema),
        ...collectInternalWriteResponseFields(schema),
      ]);
      const titleField = liveTitles ? documentTitleField(schema) : undefined;
      const readsTitle = titleField !== undefined && titleField !== 'id' && !withheld.has(titleField);
      try {
        const rows = (await this.options.dataEngine.find(object, {
          where: { id: { $in: ids } } as Record<string, unknown>,
          fields: readsTitle ? ['id', titleField] : ['id'],
          context: ctx,
        } as never)) as Array<Record<string, unknown> & { id?: string }>;
        for (const row of rows) {
          if (!row?.id) continue;
          allowed.add(`${object}#${row.id}`);
          if (!readsTitle) continue;
          const title = documentTitle(row, schema, withheld);
          if (title !== undefined) titles.set(`${object}#${row.id}`, title);
        }
      } catch (err) {
        this.options.logger?.warn?.(
          `[knowledge] RLS lookup failed for object='${object}': ${(err as Error).message}; ` +
            'dropping that object\'s hits to stay safe.',
        );
      }
    }

    const out: KnowledgeHit[] = [];
    for (const hit of hits) {
      if (this.isNonObjectSourceHit(hit)) {
        out.push(hit); // file / http hit
        continue;
      }
      // An object-source hit the re-check cannot place — no record id, or a
      // source nobody registered — is not provably readable: dropped.
      const source = this.sources.get(hit.sourceId);
      if (!source || !hit.sourceRecordId) continue;
      const key = `${(source.source as ObjectKnowledgeSource).object}#${hit.sourceRecordId}`;
      if (!allowed.has(key)) continue;
      const title = titles.get(key);
      out.push(title === undefined ? hit : { ...hit, title });
    }
    return out;
  }

  /** A hit of a REGISTERED source that is not an `object` source (file / http): the adapter owns its ACL. */
  private isNonObjectSourceHit(hit: KnowledgeHit): boolean {
    const source = this.sources.get(hit.sourceId);
    return source !== undefined && source.source.kind !== 'object';
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * A source that refused a search (ADR-0161 K7, rule 5): its adapter answered
 * an ADR-0112 coded error — `KNOWLEDGE_REBUILD_REQUIRED` when its index holds
 * another fingerprint than the one the search carried.
 */
export interface KnowledgeSearchRefusal {
  sourceId: string;
  /** The adapter's error code. */
  code: string;
  /** The adapter's HTTP-shaped status. */
  status: number;
  /** The adapter's message, which says what to do. */
  message: string;
}

/** What {@link KnowledgeService.searchWithRefusals} answers. */
export interface KnowledgeSearchReport {
  /** The hits of the sources that answered, as {@link KnowledgeService.search} returns them. */
  hits: KnowledgeHit[];
  /** The sources that refused, each with its code; empty when none did. */
  refused: KnowledgeSearchRefusal[];
}

/**
 * One source a search round asks: its organizations scope, the fingerprint its
 * search carries, and the record scope's terms for it (ADR-0161 K8, item 17).
 */
interface SearchTarget {
  source: KnowledgeSource;
  organizationIds?: string[];
  fingerprint?: string;
  scope?: AdapterScopeTerm[];
}

/** An ADR-0112 coded refusal's code, status and message, or `undefined` for any other thrown value. */
/** The code an index or search of a source whose adapter is not mounted answers. */
const UNMOUNTED_ADAPTER_CODE = 'SERVICE_UNAVAILABLE';

/**
 * The refusal of a source whose adapter is not mounted: ADR-0112
 * `SERVICE_UNAVAILABLE` (503), naming the adapter and the ones that are.
 */
function unmountedAdapterError(id: string, mounted: readonly string[]): Error {
  return Object.assign(
    new Error(
      `[knowledge] adapter '${id}' is not mounted (mounted: ${mounted.length === 0 ? 'none' : mounted.join(', ')}). ` +
        `Name one of those as the source's adapter, or mount the '${id}' store.`,
    ),
    { code: UNMOUNTED_ADAPTER_CODE, status: 503 },
  );
}

function codedRefusalOf(err: unknown): Omit<KnowledgeSearchRefusal, 'sourceId'> | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const { code, status } = err as { code?: unknown; status?: unknown };
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(code)) return undefined;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599) return undefined;
  return { code, status, message: errorText(err) };
}

/**
 * The refusal of a search no source could answer (ADR-0161 K7, rule 5): the
 * first refusal's code and status — the one every refusal shares, when they
 * share one — and a message naming each refused source with its code. The
 * thrown error carries `refused`.
 */
function wholeRefusal(refused: KnowledgeSearchRefusal[]): Error {
  const [first] = refused;
  const message =
    `[knowledge] no source could be searched: ` +
    refused.map((r) => `source '${r.sourceId}' refused (${r.code}): ${r.message}`).join('; ');
  return Object.assign(new Error(message), { code: first.code, status: first.status, refused: [...refused] });
}

/** What {@link KnowledgeService.planIndex} resolves for one call against one source's adapter. */
interface IndexPlan {
  source: KnowledgeSource;
  adapter: IKnowledgeAdapter;
  /** The split applied for an adapter that takes chunks; absent for one that does not. */
  split?: ResolvedSplit;
  /** The fingerprint and recipe hash every adapter call carries. */
  index: AdapterIndexExpectation;
  /** The adapter context of a call made for `reason`, carrying `index`. */
  context(reason: NonNullable<AdapterContext['reason']>): AdapterContext;
}

/**
 * Rows one reindex page reads, and so the most documents one reindex `upsert`
 * carries. A memory and request-size bound for the walk, not an embedder
 * limit: an embedder that caps inputs per request splits a larger upsert into
 * several requests itself (`OpenAIEmbedder` does).
 */
export const REINDEX_PAGE_SIZE = 100;

/**
 * The most documents one reindex result names in `failures`; `failed` counts
 * them all. A source whose every document fails its split (a `whole` source
 * over a small model's limit) answers a bounded result, not one entry per row.
 */
export const MAX_REINDEX_FAILURES = 20;

/**
 * Run `task` after every earlier task chained on the same `key` has settled —
 * an in-process promise chain per key, dropped from `tails` once idle.
 * Answers `task`'s own outcome (rejection included); the chain itself never
 * rejects, so a failed task does not break the tasks queued behind it.
 */
function chainAfter<T>(
  tails: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const outcome = previous.then(task);
  const tail: Promise<void> = outcome.then(() => undefined, () => undefined).finally(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  tails.set(key, tail);
  return outcome;
}

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

/**
 * The RLS-bypassing system context of the service's own reads: the reindex
 * walk, the event sync's re-read and the purge's, which decide index
 * MEMBERSHIP (`where`), never what a caller may read — search re-checks every
 * hit as the caller.
 */
function systemContext(): ExecutionContext {
  return { positions: [], permissions: [], systemPermissions: [], isSystem: true };
}

/**
 * THE membership re-read: the row `recordId` names, read under the system
 * context and the source's `where` — `find(object, { where: where AND id,
 * limit: 1 })` — so the database answers whether the row belongs in the
 * index, never an event payload or an earlier read. `undefined` when no row
 * matches (none exists, or it does not match `where`). Throws what `find`
 * throws, and throws when `find` answers no list: "no row" is a verdict the
 * purge deletes on, so a malformed answer is never read as one.
 *
 * One definition for both of its readers, the event sync
 * ({@link KnowledgeService.handleRecordUpsert}) and the purge
 * ({@link purgeDocuments}): they decide the same question, and a second copy
 * is how they would drift into answering it differently.
 */
async function rereadRow(
  engine: IDataEngine,
  objSource: ObjectKnowledgeSource,
  recordId: string | number,
): Promise<Record<string, unknown> | undefined> {
  const byId = { id: recordId };
  const rows = await engine.find(
    objSource.object,
    { where: objSource.where !== undefined ? { $and: [objSource.where, byId] } : byId, limit: 1 },
    { context: systemContext() },
  );
  if (!Array.isArray(rows)) {
    throw new Error(`the re-read of record '${String(recordId)}' answered ${describeValue(rows)} instead of a list of rows`);
  }
  return rows[0] as Record<string, unknown> | undefined;
}

/**
 * Entries one `listDocuments` call asks for. A memory bound per call, not a
 * contract limit: the adapter may answer fewer.
 */
export const LIST_DOCUMENTS_PAGE_SIZE = 500;

/**
 * How many times `topK` a search asks each `object` source for in its first
 * round, when the permission re-check can remove hits ({@link
 * KnowledgeService.search}).
 */
export const SEARCH_FIRST_ROUND_FACTOR = 5;

/**
 * How many times `topK` the one refill round asks a source for, when the
 * survivors of the re-check name fewer than `topK` records — the cap on what a
 * search reads: a caller who may read fewer than `topK` of the rows within the
 * cap gets fewer than `topK` hits.
 */
export const SEARCH_REFILL_FACTOR = 20;

/**
 * How many times a record-level search re-runs the freshness check when hits
 * it was about to answer turned out stale and others moved up
 * ({@link KnowledgeService.search}). A hit still unchecked after the last
 * round is not answered.
 */
export const SEARCH_FRESHNESS_ROUNDS = 3;

/** What {@link listAdapterDocuments} learned: every listed id → its stored hash, or why there is no listing. */
type AdapterListing =
  | { ok: true; documents: Map<string, string | undefined> }
  /** `reason` is absent when the adapter has no `listDocuments`; present when the listing failed. */
  | { ok: false; reason?: string };

/**
 * Read every page of the adapter's `listDocuments` for `source`. Never throws:
 * an adapter without the method answers `{ ok: false }` with no reason, and a
 * listing that throws or answers a malformed page or a cursor it already gave
 * (a listing that would never end) answers `{ ok: false, reason }`.
 */
async function listAdapterDocuments(
  source: KnowledgeSource,
  adapter: IKnowledgeAdapter,
  index: AdapterIndexExpectation,
): Promise<AdapterListing> {
  if (typeof adapter.listDocuments !== 'function') return { ok: false };
  const documents = new Map<string, string | undefined>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  try {
    for (;;) {
      const page = await adapter.listDocuments(
        { source, reason: 'reindex', index },
        cursor === undefined ? { limit: LIST_DOCUMENTS_PAGE_SIZE } : { cursor, limit: LIST_DOCUMENTS_PAGE_SIZE },
      );
      if (!page || !Array.isArray(page.documents)) return { ok: false, reason: 'a page carried no documents list' };
      for (const entry of page.documents) {
        if (typeof entry?.documentId !== 'string') return { ok: false, reason: 'an entry carried no documentId' };
        documents.set(entry.documentId, typeof entry.docHash === 'string' ? entry.docHash : undefined);
      }
      if (page.nextCursor === undefined) return { ok: true, documents };
      if (cursors.has(page.nextCursor)) {
        return { ok: false, reason: `the cursor '${page.nextCursor}' came back twice, so the listing would never end` };
      }
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  } catch (err) {
    return { ok: false, reason: operatorText(err) };
  }
}

/** Input of {@link purgeDocuments}. */
export interface PurgeDocumentsInput {
  source: KnowledgeSource;
  objSource: ObjectKnowledgeSource;
  adapter: IKnowledgeAdapter;
  engine: IDataEngine;
  /** Document ids believed stale: listed by the adapter, not produced from a current row. */
  candidates: Iterable<string>;
  /**
   * Runs one candidate's confirm-and-delete after every earlier sync of that
   * document has finished, answering the task's own outcome — the service
   * passes its per-document record-sync chain, so an event sync of the same
   * row can never land between the purge's re-read and its delete.
   */
  serialize: <T>(documentId: string, task: () => Promise<T>) => Promise<T>;
  /** Diagnostics tag on the adapter's `delete`. @default 'reindex' */
  reason?: string;
  /** The fingerprint and recipe hash the adapter's `delete` carries (ADR-0161 K8, item 8 a). */
  index?: AdapterIndexExpectation;
}

/** Outcome of {@link purgeDocuments}. */
export interface PurgeDocumentsOutcome {
  /** Candidates deleted. */
  purged: number;
  /** Candidates whose row the re-read found: kept. */
  kept: number;
  /** Candidates whose id this source does not derive from a record id: kept, nothing can confirm them. */
  foreign: number;
  /** Why the purge stopped early (a re-read or a delete that threw); absent when it went through every candidate. */
  failure?: string;
}

/**
 * The index purge (ADR-0161 K8, item 1): delete the candidates whose row is
 * gone. Each candidate is confirmed by {@link rereadRow} — the event sync's
 * own re-read, `where` AND id under the system context — and deleted only
 * when that finds no row, so a document whose row was created, restored or
 * came back into `where` since the candidates were computed is kept. Stops at
 * the first re-read or delete that throws (a re-read that answers no list
 * included), counting what it did before.
 *
 * KNOWN LIMIT — numeric record ids. The record id is recovered from the
 * document id as text, and the re-read asks for that text. A driver that does
 * not equate `'5'` with `5` (driver-mongodb, driver-memory) does not find a
 * row stored under a caller-supplied NUMERIC id, so if such a row's document
 * is a candidate while the row exists (it was restored, or came back into
 * `where`, after the walk read past it), the document is deleted. The row is
 * untouched; its document returns at the row's next event or the next complete
 * reindex. Asking again by the number is not done: on driver-sql the number
 * is bound against the text `id` column, which MySQL compares numerically
 * (`'05'` matches `5`) and SQL Server and Oracle reject outright, and the
 * object schema does not say which ids are numeric. Platform-minted ids are
 * text on every driver, so the limit needs a caller-supplied numeric id.
 *
 * The caller decides when a purge may run at all (a complete reindex walk;
 * the scheduled reconcile reuses this function) and computes the candidates.
 */
export async function purgeDocuments(input: PurgeDocumentsInput): Promise<PurgeDocumentsOutcome> {
  const { source, objSource, adapter, engine } = input;
  const prefix = `${source.id}:`;
  const outcome: PurgeDocumentsOutcome = { purged: 0, kept: 0, foreign: 0 };
  for (const documentId of input.candidates) {
    const recordId = documentId.startsWith(prefix) ? documentId.slice(prefix.length) : '';
    if (recordId === '') {
      outcome.foreign++;
      continue;
    }
    try {
      const deleted = await input.serialize(documentId, async () => {
        if (await rereadRow(engine, objSource, recordId)) return false;
        await adapter.delete([documentId], {
          source,
          reason: input.reason ?? 'reindex',
          ...(input.index === undefined ? {} : { index: input.index }),
        });
        return true;
      });
      if (deleted) outcome.purged++;
      else outcome.kept++;
    } catch (err) {
      outcome.failure = `document '${documentId}': ${operatorText(err)}`;
      return outcome;
    }
  }
  return outcome;
}

/**
 * The version of the {@link computeDocHash} recipe, the hash's prefix. Bump it
 * when what the hash covers or how it serializes changes: every stored hash
 * then reads as changed, and the next complete reindex writes every document
 * once.
 *
 * Not bumped for `organizationId` (ADR-0161 K8, item 9): the organization
 * enters the hashed body only when the document carries one, so a document
 * without one hashes as it did before, and only the documents that gained an
 * organization read as changed — exactly the ones a complete reindex must
 * write again for a walled search to rank them.
 */
export const DOC_HASH_VERSION = 'v1';

/**
 * A document's `docHash` (ADR-0161 K8, item 2): SHA-256 over its content,
 * title and metadata — and its organization, when it carries one (item 9) —
 * serialized with object keys in a stable order, behind
 * the {@link DOC_HASH_VERSION} prefix. The same assembled document gives the
 * same hash on every machine, whatever order its metadata keys were built in.
 */
export function computeDocHash(doc: Pick<KnowledgeDocument, 'content' | 'title' | 'metadata' | 'organizationId'>): string {
  const body = stableJson({
    content: doc.content,
    title: doc.title ?? null,
    metadata: doc.metadata ?? {},
    ...(doc.organizationId === undefined ? {} : { organizationId: doc.organizationId }),
  });
  return `${DOC_HASH_VERSION}:${createHash('sha256').update(body).digest('hex')}`;
}

/** `JSON.stringify` with every plain object's keys sorted, and a bigint as its decimal text. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

/** How a non-list answer is named in a refusal: `null`, `undefined`, or its `typeof`. */
function describeValue(value: unknown): string {
  return value === null ? 'null' : value === undefined ? 'undefined' : `a value of type ${typeof value}`;
}

/** A thrown value's text: an `Error`'s message, anything else as a string. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * An adapter error as an operator reads it: its message, then its `remedy`
 * when it carries one — operator text such as the SQL to run, which an adapter
 * keeps out of the message (ADR-0161 K7, rule 5). For a reindex result and the
 * log; a search caller reads the message alone.
 */
function operatorText(err: unknown): string {
  const remedy = err !== null && typeof err === 'object' ? (err as { remedy?: unknown }).remedy : undefined;
  return typeof remedy === 'string' && remedy !== '' ? `${errorText(err)} ${remedy}` : errorText(err);
}

/** A record id the event sync can re-read by: a non-empty string or a finite number. */
function isRecordId(value: unknown): value is string | number {
  return (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * A document's `title` (ADR-0161 K5): the value of the object's display field
 * ({@link documentTitleField}), read from the record when it is non-empty text
 * or a finite number. `undefined` when the field is withheld (credential-class
 * or `internal`), empty, or not one of those values. Not
 * `resolveRecordDisplayName`: its `Record #<id>` floor is a UI label, not
 * index content.
 */
function documentTitle(
  record: Record<string, unknown>,
  schema: unknown,
  withheld: ReadonlySet<string>,
): string | undefined {
  const field = documentTitleField(schema);
  if (field === undefined || withheld.has(field)) return undefined;
  const value = record[field];
  if (typeof value === 'string') return value.trim().length > 0 ? value : undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * How many groups `hits` name, by `groupOf` — what {@link KnowledgeService.search}
 * counts toward `topK` when it decides whether to refill: several passages of
 * one record (or of one `groupBy` value) count once. A hit with no group
 * counts for nothing.
 */
function distinctGroups(hits: KnowledgeHit[], groupOf: (hit: KnowledgeHit) => string | undefined): number {
  const keys = new Set<string>();
  for (const hit of hits) {
    const key = groupOf(hit);
    if (key !== undefined) keys.add(key);
  }
  return keys.size;
}

/** A hit's record: an object-source hit is its source and record id; any other hit is its document. */
function recordKeyOf(hit: KnowledgeHit): string {
  return hit.sourceRecordId !== undefined ? `record:${hit.sourceId}#${hit.sourceRecordId}` : `document:${hit.documentId}`;
}

/**
 * The projection of the freshness check's read: every field
 * {@link recordToDocument} reads for `objSource` — `id`, the content and
 * metadata fields, the title field, and `organization_id` under a walled
 * posture. `undefined` (read the whole row, as the walk and the event sync
 * do) when the content list is `'*'`, when the object's fields cannot be
 * enumerated, or when a field the source names is not one the object declares:
 * assembly reads such a field off the whole row, and a projection that left it
 * out would recompute a different hash and read every record as stale.
 */
function freshnessFields(
  objSource: ObjectKnowledgeSource,
  schema: unknown,
  posture: TenancyPosture | undefined,
): string[] | undefined {
  const declared = declaredFields(schema);
  if (declared === undefined || objSource.contentFields.includes('*')) return undefined;
  const names = new Set(declared.map(([name]) => name));
  const wanted = new Set<string>(['id', ...objSource.contentFields, ...(objSource.metadataFields ?? [])]);
  const titleField = documentTitleField(schema);
  if (titleField !== undefined) wanted.add(titleField);
  if (posture !== undefined && postureEnforcesWall(posture)) wanted.add('organization_id');
  for (const name of wanted) if (name !== 'id' && !names.has(name)) return undefined;
  return [...wanted];
}

/**
 * A caller-supplied field name as a log line or refusal shows it: JSON-quoted
 * (so a quote or line break in it cannot forge text around it) and cut at 64
 * characters.
 */
function quotedName(name: string): string {
  return JSON.stringify(name.length > 64 ? `${name.slice(0, 64)}…` : name);
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
 *
 * The `title` is the value of the object's display field ({@link
 * documentTitle}); with no schema, of a field named `title`.
 *
 * `posture` (the deployment's effective tenancy posture) decides the
 * document's `organizationId` (ADR-0161 K8, item 9): the record's
 * `organization_id` under `group` and `isolated`, none under `single` or with
 * no posture — `documentOrganizationId`. The organization enters `docHash`
 * only when the document carries one.
 */
export function recordToDocument(
  source: KnowledgeSource,
  objSource: ObjectKnowledgeSource,
  record: Record<string, unknown>,
  schema?: unknown,
  posture?: TenancyPosture,
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
  const doc: KnowledgeDocument = {
    id: documentIdFor(source.id, recordId || `unknown-${Date.now()}`),
    sourceId: source.id,
    sourceRecordId: recordId || undefined,
    content: contentParts.join('\n\n'),
    title: documentTitle(record, schema, withheld),
    metadata,
  };
  const organizationId = documentOrganizationId(record, posture);
  if (organizationId !== undefined) doc.organizationId = organizationId;
  doc.docHash = computeDocHash(doc);
  return doc;
}
