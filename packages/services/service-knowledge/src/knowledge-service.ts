// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type {
  AdapterContext,
  AdapterIndexExpectation,
  AdapterIndexStatus,
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
  KnowledgeSourceRegistry,
  codedError,
  packageIdOfItem,
  parseKnowledgeSource,
  type KnowledgeSourceEntry,
  type KnowledgeSourceHolder,
} from './knowledge-source-registry.js';
import {
  documentOrganizationId,
  searchOrganizationIds,
  type KnowledgeTenancyPostureResolver,
} from './knowledge-organization-scope.js';
import {
  admitObject,
  admitSourceFields,
  mayServeEarlierRuleTitle,
  declaredFields,
  documentTitleField,
  type KnowledgeAdmissionDeps,
  type KnowledgeFieldSecurity,
  type KnowledgeSourceAdmission,
  type ObjectAdmission,
} from './knowledge-source-admission.js';
import {
  narrowToVisible,
  readSearchScope,
  scopeCheck,
  scopeTermsFor,
  SEARCH_VISIBLE_IDS_MAX,
  type SearchScopeEntry,
} from './knowledge-search-scope.js';
import {
  BUILD_LEASE_MS,
  BUILD_PROGRESS_LOG_INTERVAL_MS,
  BUILD_STALL_LIMIT_MS,
  buildLockKey,
  emptyBuildProgress,
  fencedCall,
  RECONCILE_MAX_WAIT_MS,
  RECONCILE_QUIET_MS,
  startBuildFence,
  type KnowledgeBuildFence,
  type KnowledgeBuildLock,
  type KnowledgeBuildLockHandle,
  type KnowledgeBuildProgress,
  type KnowledgeBuildRecord,
  type KnowledgeBuildTrigger,
  type KnowledgeIndexReading,
  type KnowledgeReconcileEntry,
  type KnowledgeReconcileReport,
  type KnowledgeReconcileRequest,
} from './knowledge-build.js';
import {
  readRecordSyncMessage,
  type KnowledgeRecordSyncMessage,
  type KnowledgeRecordSyncOutcome,
  type KnowledgeRecordSyncReason,
} from './knowledge-record-sync-queue.js';

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
   * [ADR-0161 K4 ◆] The deployment's adapter: the id of the store the
   * runtime mounted beside this service for the `knowledge` capability
   * (`pgvector` on PostgreSQL, `turso` otherwise — `resolveCapabilityArgument`
   * in `@objectstack/core` sets it on the plugin it constructs). A source
   * that names no `adapter` binds to it while an adapter of that id is
   * registered. Only the runtime that mounts the store sets it: an adapter
   * application code registers is never the deployment's by registering
   * (`registerAdapter` takes no such mark). A service option, not an
   * adapter-contract member (ADR-0161 K8, "What counts as a member").
   * Omitted (a host that mounts the service itself), a source that names
   * no adapter binds to the only adapter registered.
   */
  deploymentAdapter?: string;
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
   * The cluster lock a build runs under (`knowledge-build.ts`, "One node
   * builds a source"), resolved each time a build starts. Answers `undefined`
   * where no cluster service is composed: the composition is one node and the
   * build runs without a lease. `KnowledgeServicePlugin` wires it to the
   * `cluster` service's `lock`.
   */
  resolveBuildLock?: () => KnowledgeBuildLock | undefined;
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
 * - Searches a source for a caller only when the caller's exposure
 *   decision serves its object and every field it serves is one the caller
 *   may query (`knowledge-source-admission.ts`), so field-level security and
 *   the object's API exposure hold for passages too.
 * - Walks ObjectQL when reindexing a source.
 * - Holds the registry of sources, one per `(package, name)`
 *   (`knowledge-source-registry.ts`): every by-name member reads a caller's
 *   `sourceId` by the one rule (a source's face, else a bare name resolved by
 *   ADR-0150 D3), and every answer names a source by its face.
 *
 * No member pushes a document: an index holds what the service assembled from
 * the records of a source's object, and nothing else (ADR-0161 K1).
 *
 * Non-responsibilities (the parts plugins own):
 * - Chunking, embedding, vector storage, hybrid retrieval, rerank.
 */
export class KnowledgeService implements IKnowledgeService {
  private readonly adapters = new Map<string, IKnowledgeAdapter>();
  private readonly registry = new KnowledgeSourceRegistry();
  private readonly defaultTopK: number;
  /** Adapters whose answer the scope check has already dropped a hit from — reported once each ({@link searchRound}). */
  private readonly scopeIgnoredReported = new Set<string>();
  /** `${source id}\u0000${object}` pairs a scope entry did not reach for two or more parent links — reported once each. */
  private readonly scopeAmbiguousReported = new Set<string>();
  /**
   * The tail of each document's record-sync chain, keyed by document id
   * (the source's index key, `:`, the record id) — see {@link serializeRecordSync}. A key
   * lives only while a sync for it is pending.
   */
  private readonly recordSyncTails = new Map<string, Promise<void>>();
  /**
   * The tail of each source's reindex chain, keyed by its index key — see
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
  /** The last build of each source on this node (`knowledge-build.ts`), by index key. */
  private readonly builds = new Map<string, KnowledgeBuildRecord>();
  /** Set by {@link stopBuilds}: the boot pass and the reconcile start no further build. */
  private buildsStopped = false;
  /** Sources the reconcile has said, once, it cannot walk because their store lists no documents (by index key). */
  private readonly reconcileUnlistedReported = new Set<string>();
  /** The reconcile each predicate write asked for, pending its quiet period ({@link requestReconcile}), by index key. */
  private readonly pendingReconciles = new Map<string, { timer: ReturnType<typeof setTimeout>; firstAt: number }>();
  /** The tail of the reconcile passes on this node: one pass runs at a time ({@link reconcileSources}). */
  private reconcileTail: Promise<void> = Promise.resolve();
  /** Told after the set of registered sources changed ({@link onSourcesChanged}). */
  private readonly sourceListeners = new Set<() => void>();
  /**
   * Where record syncs are published while they run through the queue
   * ({@link routeRecordSyncs}); `undefined` while they run inline.
   */
  private recordSyncPublisher: ((message: KnowledgeRecordSyncMessage) => Promise<unknown>) | undefined;

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
   * The id of the adapter `source` binds to, read now (ADR-0161 K4 ◆):
   *
   * 1. the `adapter` the source names — mounted or not: a named adapter that
   *    is not mounted is {@link getAdapter}'s refusal;
   * 2. else the deployment's adapter ({@link KnowledgeServiceOptions.deploymentAdapter}),
   *    while an adapter of that id is registered;
   * 3. else the only adapter registered.
   *
   * With none registered, throws `503 SERVICE_UNAVAILABLE`; with several and
   * none the deployment's, `400 VALIDATION_ERROR` naming them, as the source's
   * registration is refused ({@link refuseUnplacedSource}). Never cached:
   * adapters register in their plugins' `start()`, after a source registered
   * in code at `init()`, so the answer is taken where it is used.
   */
  adapterIdFor(source: KnowledgeSource): string {
    if (source.adapter !== undefined) return source.adapter;
    const deployment = this.options.deploymentAdapter;
    if (deployment !== undefined && this.adapters.has(deployment)) return deployment;
    const registered = this.listAdapters();
    if (registered.length === 1) return registered[0]!;
    if (registered.length === 0) throw noAdapterMountedError(this.label(source), deployment);
    throw unplacedSourceError(this.label(source), registered);
  }

  /** The adapter `source` binds to ({@link adapterIdFor}), registered; throws the coded refusal otherwise. */
  adapterFor(source: KnowledgeSource): IKnowledgeAdapter {
    return this.getAdapter(this.adapterIdFor(source));
  }

  /** {@link adapterIdFor}, or `undefined` where it refuses: for a log line or a status answer. */
  boundAdapterId(source: KnowledgeSource): string | undefined {
    try {
      return this.adapterIdFor(source);
    } catch {
      return undefined;
    }
  }

  /**
   * Refuse, at registration, a source that names no adapter where the answer
   * cannot become one: several adapters are registered and the runtime marked
   * none the deployment's (ADR-0161 K4 ◆). With a mark, or with one adapter
   * or none registered yet, the source is taken and placed where it is used:
   * a store registers in its own `start()`, after a source registered at
   * `init()`, so "none yet" is no verdict (AGENTS.md, startup registry reads).
   */
  private refuseUnplacedSource(source: KnowledgeSource, door: string): void {
    if (source.adapter !== undefined || this.options.deploymentAdapter !== undefined) return;
    const registered = this.listAdapters();
    if (registered.length < 2) return;
    throw unplacedSourceError(source.name, registered, ` ${door} did not register it.`);
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
    const named: string[] = [];
    for (const { id, source } of this.describeSources()) {
      if (source.adapter === undefined) {
        // [ADR-0161 K4 ◆] A source that names no adapter, which this boot
        // cannot place: no adapter at all, or several and none the deployment's.
        try {
          this.adapterIdFor(source);
        } catch (err) {
          this.options.logger?.error?.(`${errorText(err)} Indexing and searching it answer that refusal.`);
          named.push(id);
        }
        continue;
      }
      if (this.adapters.has(source.adapter)) continue;
      this.options.logger?.error?.(
        `[knowledge] source '${id}' names adapter '${source.adapter}', which is not mounted ` +
          `(mounted: ${mounted.length === 0 ? 'none' : mounted.join(', ')}). Indexing and searching it answer ` +
          `${UNMOUNTED_ADAPTER_CODE} until its adapter is one of those, or the '${source.adapter}' store is mounted.`,
      );
      named.push(id);
    }
    return named;
  }

  listAdapters(): string[] {
    return [...this.adapters.keys()];
  }

  // ── Source registry ───────────────────────────────────────────────

  /**
   * The code door: register a source that belongs to no package. It takes the
   * one package-less slot of its name (`knowledge-source-registry.ts`).
   *
   * The source is parsed with `KnowledgeSourceSchema`, the schema every door
   * parses with, and no conversion is run: a registration that still writes a
   * retired key (`id`, `source.contentFields`, …), an unknown key, a `file` or
   * `http` kind or a `'*'` content member is refused `400 VALIDATION_ERROR`
   * with the schema's own prescription. A registration naming a package
   * (`_packageId`) is refused the same way: a package ships its source in its
   * `knowledgeSources` collection.
   *
   * Registering a name this door already registered replaces the earlier
   * registration, reported at `warn`. A name the metadata door holds in the
   * package-less slot is refused `409 RESOURCE_CONFLICT`, naming both doors.
   */
  registerSource(source: KnowledgeSource): void {
    const parsed = parseKnowledgeSource(source);
    if (!parsed.ok) {
      throw codedError(
        'VALIDATION_ERROR',
        400,
        `[knowledge] registerSource refused the source${describeName(source)}: ${parsed.message}`,
      );
    }
    this.refuseUnplacedSource(parsed.source, 'registerSource');
    const packageId = packageIdOfItem(parsed.source);
    if (packageId !== undefined) {
      throw codedError(
        'VALIDATION_ERROR',
        400,
        `[knowledge] registerSource refused source '${parsed.source.name}': it names package "${packageId}" ` +
          '(`_packageId`), and a source registered in code belongs to no package. Ship the source in that ' +
          "package's `knowledgeSources` collection, or drop the key.",
      );
    }
    const { entry, replaced } = this.registry.register(parsed.source, 'code');
    if (replaced) this.options.logger?.warn?.(`[knowledge] source overwritten: ${entry.face}`);
    this.options.logger?.info?.(`[knowledge] source registered: ${entry.face} (adapter=${this.adapterLabel(entry.authored)})`);
    this.sourcesChanged();
  }

  /**
   * The metadata door: register the source of one published `knowledge_source`
   * item, already parsed ({@link parseKnowledgeSource}), for its holder. An
   * item that reloads replaces its own earlier version; a package-less item
   * under a name the code door holds is refused `409 RESOURCE_CONFLICT`,
   * naming both doors. Called by `KnowledgeServicePlugin`'s loader, never by a
   * caller holding `IKnowledgeService`.
   */
  registerMetadataSource(source: KnowledgeSource, holder: KnowledgeSourceHolder = {}): KnowledgeSourceEntry {
    this.refuseUnplacedSource(source, 'The knowledge_source loader');
    const { entry, replaced } = this.registry.register(source, 'metadata', holder);
    this.options.logger?.info?.(
      `[knowledge] source ${replaced ? 'reloaded' : 'registered'}: ${entry.face} (adapter=${this.adapterLabel(entry.authored)}` +
        `${entry.packageId === undefined ? '' : `, package=${entry.packageId}`})`,
    );
    this.sourcesChanged();
    return entry;
  }

  /** The sources that arrived through the metadata door, for the loader that owns them. */
  metadataSources(): KnowledgeSourceEntry[] {
    return this.registry.entries().filter((entry) => entry.door === 'metadata');
  }

  /**
   * Be told after a source is registered, replaced or removed, through either
   * door. The lifecycle reap guard's object set follows the sources through
   * it (ADR-0161 K3, item 2). A listener that throws is reported at `warn` and
   * does not stop the others. Answers the unsubscribe.
   */
  onSourcesChanged(listener: () => void): () => void {
    this.sourceListeners.add(listener);
    return () => {
      this.sourceListeners.delete(listener);
    };
  }

  private sourcesChanged(): void {
    for (const listener of [...this.sourceListeners]) {
      try {
        listener();
      } catch (err) {
        this.options.logger?.warn?.(`[knowledge] a source-change listener failed (${errorText(err)}).`);
      }
    }
  }

  /**
   * Remove a source the code door registered. The index it built stays with
   * its adapter. A source that is a metadata item is not this door's to
   * remove: refused `409 RESOURCE_CONFLICT`, naming the item to delete. A
   * `sourceId` that names no source is a no-op.
   */
  unregisterSource(sourceId: string): void {
    const entry = this.registry.resolve(sourceId);
    if (!entry) return;
    if (entry.door === 'metadata') {
      throw codedError(
        'RESOURCE_CONFLICT',
        409,
        `[knowledge] source '${entry.face}' is a knowledge_source metadata item, so unregisterSource does not remove ` +
          'it: delete the item (Studio, the metadata API, or its package), and the knowledge service unregisters it ' +
          'and drops its index.',
      );
    }
    this.forget(entry);
  }

  /**
   * The metadata door's removal: unregister the source held under `key`, and
   * drop what its adapter holds for it (`IKnowledgeAdapter.dropSource`,
   * ADR-0161 K8 item 4). An adapter without `dropSource`, or one that is not
   * mounted, keeps what it holds, said once at `warn` naming the source; a
   * `dropSource` that throws is reported the same way. Never throws. Answers
   * the removed entry, or `undefined` when the key held none.
   */
  async dropMetadataSource(key: string): Promise<KnowledgeSourceEntry | undefined> {
    const entry = this.registry.byIndexKey(key);
    if (!entry || entry.door !== 'metadata') return undefined;
    // Placed before the entry is forgotten: an unnamed adapter is placed
    // among the adapters registered now, as every other use places it.
    const adapterId = this.boundAdapterId(entry.handed);
    this.forget(entry);
    const kept = (why: string): void => {
      this.options.logger?.warn?.(
        `[knowledge] source '${entry.face}' was removed, and its index was not dropped: ${why} ` +
          `What adapter '${adapterId ?? this.adapterLabel(entry.authored)}' holds under the key '${entry.key}' stays until it is removed there.`,
      );
    };
    const adapter = adapterId === undefined ? undefined : this.adapters.get(adapterId);
    if (!adapter) {
      kept(
        adapterId === undefined
          ? 'it names no adapter, and none could be placed for it.'
          : `adapter '${adapterId}' is not mounted.`,
      );
      return entry;
    }
    if (typeof adapter.dropSource !== 'function') {
      kept(`adapter '${adapterId}' has no dropSource.`);
      return entry;
    }
    try {
      await adapter.dropSource({ source: entry.handed, reason: 'manual' });
      this.options.logger?.info?.(`[knowledge] source '${entry.face}' was removed and its index dropped.`);
    } catch (err) {
      kept(`dropSource failed (${operatorText(err)}).`);
    }
    return entry;
  }

  /** Remove `entry` and what this node remembers of it. */
  private forget(entry: KnowledgeSourceEntry): void {
    this.registry.remove(entry.key);
    this.builds.delete(entry.key);
    this.whereUnenforceableReported.delete(entry.key);
    this.reconcileUnlistedReported.delete(entry.key);
    this.cancelPendingReconcile(entry.key);
    this.sourcesChanged();
  }

  /** Every registered source, as its author wrote it (a package's source carries its `_packageId`). */
  listSources(): KnowledgeSource[] {
    return this.registry.entries().map((entry) => entry.authored);
  }

  /**
   * Every registered source with how a caller names it: its face
   * (`NAMESPACE-NAME` for a package's source, the bare name otherwise) and
   * its holder. What `search_knowledge` lists and the operator's actions name.
   */
  describeSources(): KnowledgeSourceDescription[] {
    return this.registry.entries().map(describeEntry);
  }

  /**
   * Every registered source as its adapter is handed it: `name` is the
   * source's index key. For the callers that write to an index on a row's
   * behalf (the event sync, the lifecycle reap guard).
   */
  indexedSources(): KnowledgeSource[] {
    return this.handedSources();
  }

  /** The source `sourceId` names (a face, or a bare name by ADR-0150 D3), as its author wrote it. */
  getSource(sourceId: string): KnowledgeSource | undefined {
    return this.registry.resolve(sourceId)?.authored;
  }

  /** {@link getSource}, with the source's face and holder. */
  describeSource(sourceId: string): KnowledgeSourceDescription | undefined {
    const entry = this.registry.resolve(sourceId);
    return entry ? describeEntry(entry) : undefined;
  }

  /** The handed source held under an index key. */
  private handed(key: string): KnowledgeSource | undefined {
    return this.registry.byIndexKey(key)?.handed;
  }

  private handedSources(): KnowledgeSource[] {
    return this.registry.entries().map((entry) => entry.handed);
  }

  /** How a log line names a source's adapter: the one it names, else the one it is placed on now. */
  private adapterLabel(source: KnowledgeSource): string {
    if (source.adapter !== undefined) return source.adapter;
    const placed = this.boundAdapterId(source);
    return placed === undefined ? "the deployment's, not placed yet" : `${placed}, the deployment's`;
  }

  /** How a log line or an answer names a handed source: its face. */
  private label(source: KnowledgeSource): string {
    return this.faceOfKey(source.name);
  }

  private faceOfKey(key: string): string {
    return this.registry.byIndexKey(key)?.face ?? key;
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
        split: source.source.split,
        chunkTarget: await chunkTarget(),
        maxInputTokens: adapter.embedding?.maxInputTokens,
      })
      : undefined;
    const index = indexExpectation(
      { source, embedding: adapter.embedding, ...(split === undefined ? {} : { split }) },
      { source, schema: this.schemaFor(source.source.object) },
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
   * this call: the source's `split`, the settings page's `knowledge.chunk_target`, and the
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

  // ── Reindex ───────────────────────────────────────────────────────

  /**
   * Walk a source's object and push its documents to the adapter.
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
    return this.reindexWith(this.requireEntry(sourceId).handed, opts);
  }

  /**
   * {@link reindexSource}, with a sink a build's progress is reported to after
   * each page, and the build's fence (`knowledge-build.ts`) the walk asks
   * before each page.
   */
  private async reindexWith(
    source: KnowledgeSource,
    opts: KnowledgeReindexOptions,
    progress?: (step: KnowledgeBuildProgress) => void,
    fence?: KnowledgeBuildFence,
  ): Promise<KnowledgeReindexResult> {
    const adapter = this.adapterFor(source);

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
        message: 'KnowledgeService has no IDataEngine bound; cannot walk the source.',
      };
    }

    return chainAfter(this.reindexTails, source.name, () =>
      this.walkObjectSource(source, source.source, adapter, engine, opts, progress, fence),
    );
  }

  /**
   * The paged walk of {@link reindexSource}; runs inside that source's chain.
   * Under a build's `fence` it stops before a page once the fence says so
   * (and before `beginBuild`, before each purge deletion, and before its
   * purge and completion), and stops waiting on a read, a
   * write, the listing, the purge or `beginBuild` once the build is
   * cancelled, so the source's chain is not held by such a call that never
   * answers. Each page and each purge deletion restarts the fence's bound.
   * The completion is not raced: the chain stays held until it settles (see
   * {@link completeBuild}).
   */
  private async walkObjectSource(
    source: KnowledgeSource,
    objSource: ObjectKnowledgeSource,
    adapter: IKnowledgeAdapter,
    engine: IDataEngine,
    opts: KnowledgeReindexOptions,
    progress?: (step: KnowledgeBuildProgress) => void,
    fence?: KnowledgeBuildFence,
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
        message: `reindex of source '${this.label(source)}' refused: limit must be a non-negative finite number, got ${String(opts.limit)}.`,
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
        message: `reindex of source '${this.label(source)}' refused: the tenancy posture could not be read (${errorText(err)}); nothing was written.`,
      };
    }

    // One plan for the whole walk: the split every page is cut by, and the
    // fingerprint and recipe hash every adapter call carries.
    const plan = await this.planIndex(source, adapter);
    const ctx = plan.context('reindex');

    // A complete walk is a build (K7, rule 3): the adapter is told before the
    // first write, and may open a generation for a new fingerprint — or refuse.
    const build = cap === undefined;
    // A build cancelled, or whose lease was lost, while its walk waited its
    // turn in the source's queue does not begin: `beginBuild` is where a store
    // that keeps generations takes its builder lock (K7, rule 2).
    const unbegun = fence?.stop();
    if (unbegun !== undefined) {
      return {
        ok: false,
        object,
        discovered: 0,
        indexed: 0,
        skipped: 0,
        purged: null,
        failed: 0,
        failures: [],
        message: `reindex of source '${source.id}' stopped before its build began, and nothing was written: ${unbegun.message}`,
      };
    }
    if (build && typeof adapter.beginBuild === 'function') {
      try {
        await fencedCall(fence, adapter.beginBuild(ctx));
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
          message: `reindex of source '${this.label(source)}' refused: the adapter did not begin the build, and nothing was written. ${operatorText(err)}`,
        };
      }
    }

    // What the adapter holds before the walk: the skip's hashes, and the
    // purge's candidates once the walk is complete.
    // Raced against the build's bound like every call of the walk, so a store
    // that never answers frees the source's chain.
    let listing: Awaited<ReturnType<typeof listAdapterDocuments>>;
    try {
      listing = await fencedCall(fence, listAdapterDocuments(source, adapter, plan.index));
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
        message: `reindex of source '${this.label(source)}' stopped before its first page: ${errorText(err)}`,
      };
    }
    const listed = listing.ok ? listing.documents : undefined;
    const listingNote = listing.ok || listing.reason === undefined
      ? undefined
      : `the adapter's document listing failed (${listing.reason}), so no document was skipped and none was purged.`;
    if (listingNote) this.options.logger?.warn?.(`[knowledge] reindex of source '${this.label(source)}': ${listingNote}`);

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
        message: `reindex of source '${this.label(source)}' stopped at page ${page}${after}: ${what}`,
      });
      // A build that lost its lease, or was cancelled, reads and embeds no
      // further page (the fence, `knowledge-build.ts`).
      const halt = fence?.stop();
      if (halt !== undefined) return stopped(halt.message);

      const byCursor = cursor === undefined ? undefined : { id: { $gt: cursor } };
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await fencedCall(fence, engine.find(
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
        ));
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
          await fencedCall(fence, adapter.upsert(prepared.ready, ctx));
        } catch (err) {
          return stopped(`the adapter upsert failed: ${operatorText(err)}`);
        }
      }
      // A document the split cannot index is removed — an older passage of it
      // must not keep answering for text the index no longer holds — and
      // reported, never truncated.
      if (prepared.failed.length > 0) {
        try {
          await fencedCall(fence, adapter.delete(prepared.failed.map((f) => f.documentId), ctx));
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
      progress?.({ pages: page, discovered, indexed, skipped, failed });

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

    // A build that lost its lease after its last page neither purges nor
    // completes: another node may be building the source.
    const halted = fence?.stop();
    if (halted !== undefined) {
      return {
        ok: false,
        object,
        discovered,
        indexed,
        skipped,
        purged: null,
        failed,
        failures: [...failures],
        message: `reindex of source '${this.label(source)}' read every page, and stopped before its purge and completion: ${halted.message}`,
      };
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
      return build ? this.completeBuild(source, adapter, ctx, done, fence) : done;
    }

    const candidates = [...listed.keys()].filter((id) => !seen.has(id));
    let purge: PurgeDocumentsOutcome;
    try {
      purge = await fencedCall(fence, purgeDocuments({
        source,
        objSource,
        adapter,
        engine,
        candidates,
        // Each settled deletion (or confirmed keep) is progress: a large,
        // healthy purge restarts the fence's bound as it goes. A build that
        // lost its lease, or was cancelled, re-reads and deletes no further
        // candidate: the fence is asked once the candidate's turn comes.
        serialize: async (documentId, task) => {
          const outcome = await chainAfter(this.recordSyncTails, documentId, () => {
            const halt = fence?.stop();
            return halt === undefined ? task() : Promise.reject(new Error(halt.message));
          });
          fence?.progressed();
          return outcome;
        },
        index: plan.index,
      }));
    } catch (err) {
      return {
        ...done,
        ok: false,
        message: `reindex of source '${this.label(source)}' walked every page, and stopped during its purge: ${errorText(err)}`,
      };
    }
    if (purge.failure !== undefined) {
      const purgeHalt = fence?.stop();
      if (purgeHalt !== undefined) {
        return {
          ...done,
          ok: false,
          purged: purge.purged,
          message:
            `reindex of source '${source.id}' walked every page, and stopped during its purge after ` +
            `${purge.purged} deletion(s): ${purgeHalt.message}`,
        };
      }
      return {
        ...done,
        ok: false,
        purged: purge.purged,
        message:
          `reindex of source '${this.label(source)}' walked every page, but its purge stopped after ${purge.purged} ` +
          `deletion(s): ${purge.failure}${failedNote === undefined ? '' : ` ${failedNote}`}`,
      };
    }
    if (purge.foreign > 0) {
      return this.completeBuild(source, adapter, ctx, {
        ...done,
        purged: purge.purged,
        message:
          `${purge.foreign} listed document(s) carry an id that is not one this source derives from a record ` +
          `('${source.name}:' and the record id); they were kept, because no row can confirm them.` +
          (failedNote === undefined ? '' : ` ${failedNote}`),
      }, fence);
    }
    return this.completeBuild(source, adapter, ctx, { ...done, purged: purge.purged }, fence);
  }

  /**
   * The end of a complete build (ADR-0161 K8, item 8 c): the adapter's
   * `completeBuild`, once, with the fingerprint and recipe hash the walk
   * carried. An adapter without it records nothing. One that throws turns the
   * walk's result into `ok: false`: every page was written, but the adapter
   * did not record what it holds, so the next complete walk builds again.
   * Under a build's `fence`, a build that must stop (its lease lost during
   * the purge, or its bound passed) completes nothing. Once the completion
   * begins it is not a page: the fence's bound is disarmed
   * (`fence.completing()`) and the call is awaited however long it takes, so
   * a switch that began still commits and the record never reads
   * `timed-out` over it. The source's walk chain stays held until it settles,
   * so no rebuild on this node begins a build beside it.
   */
  private async completeBuild(
    source: KnowledgeSource,
    adapter: IKnowledgeAdapter,
    ctx: AdapterContext,
    done: KnowledgeReindexResult,
    fence?: KnowledgeBuildFence,
  ): Promise<KnowledgeReindexResult> {
    const halt = fence?.stop();
    if (halt !== undefined) {
      return {
        ...done,
        ok: false,
        message: `reindex of source '${this.label(source)}' walked every page, and stopped before its completion: ${halt.message}`,
      };
    }
    if (typeof adapter.completeBuild !== 'function') return done;
    fence?.completing();
    try {
      await adapter.completeBuild(ctx);
      return done;
    } catch (err) {
      return {
        ...done,
        ok: false,
        message:
          `reindex of source '${this.label(source)}' walked every page, but the adapter did not complete the build ` +
          `(${operatorText(err)}).${done.message === undefined ? '' : ` ${done.message}`}`,
      };
    }
  }

  // ── The first build and the operator's rebuild (ADR-0161 K7) ──────

  /**
   * What `sourceId`'s adapter holds, against what the service expects of it
   * now, and whether a complete build is due (ADR-0161 K7, "What starts a
   * rebuild"; the states are {@link KnowledgeIndexReading}'s). Reads the
   * adapter's `indexStatus` against the fingerprint and recipe hash
   * {@link planIndex} computes; an adapter without it is asked for one entry
   * of `listDocuments`. Never throws for a registered source: a failed read
   * is the `unreadable` state. Writes nothing.
   */
  async readIndexState(sourceId: string): Promise<KnowledgeIndexReading> {
    return this.readIndexStateOf(this.requireEntry(sourceId));
  }

  /** {@link readIndexState} of one registered source; the reading names it by its face. */
  private async readIndexStateOf(entry: KnowledgeSourceEntry): Promise<KnowledgeIndexReading> {
    const source = entry.handed;
    const reading = (state: KnowledgeIndexReading['state'], due: boolean, detail: string, held?: KnowledgeIndexReading['held']): KnowledgeIndexReading => ({
      sourceId: entry.face,
      state,
      due,
      detail,
      ...(held === undefined ? {} : { held }),
    });
    if (!this.options.dataEngine) {
      return reading('not-built-here', false, 'no data engine is bound, so the source cannot be walked.');
    }
    try {
      const adapter = this.adapterFor(source);
      const plan = await this.planIndex(source, adapter);
      const ctx = plan.context('reindex');
      if (typeof adapter.indexStatus === 'function') {
        const held = await adapter.indexStatus(ctx);
        const expected = plan.index;
        if (held.fingerprint === undefined && held.recipeHash === undefined && held.building !== true) {
          return reading('nothing', true, 'the adapter holds nothing for the source: it has never been built.', held);
        }
        // A first build opened a generation and has not completed it (it is
        // still running on some node, or it stopped part-way): there is no
        // active generation yet, so no other fingerprint to speak of.
        if (held.fingerprint === undefined) {
          return reading(
            'nothing',
            true,
            'a first build was started and has not completed (it is still running, or it stopped part-way): the adapter holds no complete index for the source.',
            held,
          );
        }
        if (held.fingerprint !== expected.fingerprint) {
          return reading(
            'new-fingerprint',
            true,
            'the index was built under another fingerprint (embedding model, dimensions or split): it is built anew.',
            held,
          );
        }
        if (held.recipeHash === undefined) {
          return typeof adapter.completeBuild === 'function'
            ? reading('no-recipe-hash', true, 'the index records no recipe hash: one complete rebuild records it.', held)
            : reading(
              'no-recipe-hash',
              false,
              `the adapter '${adapter.id}' records no recipe hash and has no completeBuild, so a changed recipe ` +
                "(the source's where, metadataFields, title rule or withheld fields) cannot be seen for it; nothing is rebuilt automatically.",
              held,
            );
        }
        if (held.recipeHash !== expected.recipeHash) {
          return reading(
            'recipe-changed',
            true,
            "the source's recipe changed since the last build (its where, metadataFields, title rule or withheld fields): it is rebuilt.",
            held,
          );
        }
        return reading('current', false, 'the index is current: same fingerprint, same recipe hash.', held);
      }
      if (typeof adapter.listDocuments === 'function') {
        const page = await adapter.listDocuments(ctx, { limit: 1 });
        const documents = Array.isArray(page?.documents) ? page.documents : undefined;
        if (documents === undefined) {
          return reading('unreadable', false, "the adapter's document listing answered no list of documents.");
        }
        return documents.length === 0
          ? reading('listed-empty', true, 'the adapter lists no document for the source: it has never been built.')
          : reading(
            'listed-documents',
            false,
            `the adapter '${adapter.id}' holds documents and reports no index status, so whether they are current cannot be read; nothing is rebuilt automatically.`,
          );
      }
      return reading(
        'unknown',
        false,
        `the adapter '${adapter.id}' has neither indexStatus nor listDocuments, so whether the source was ever built cannot be read; ` +
          'nothing is built automatically, and an operator rebuild (os knowledge rebuild) is the way.',
      );
    } catch (err) {
      return reading('unreadable', false, `what the adapter holds could not be read (${operatorText(err)}).`);
    }
  }

  /** The last build of `sourceId` on this node, or `undefined` when it ran none. */
  buildRecord(sourceId: string): KnowledgeBuildRecord | undefined {
    const entry = this.registry.resolve(sourceId);
    const record = entry === undefined ? undefined : this.builds.get(entry.key);
    return record === undefined ? undefined : cloneBuildRecord(record);
  }

  /**
   * Build `sourceId` once, completely, under the cluster lock
   * (`knowledge-build.ts`), and answer the build's record.
   *
   * - A build of the source already running on this node is not doubled: its
   *   record is answered.
   * - The lock held by another node, or not answering, starts nothing
   *   (`not-run`).
   * - A `boot` or `reload` build re-reads the adapter once it holds the lock
   *   and builds only when a build is still due; an `operator` or `reconcile`
   *   build always walks (the reconcile's walk is what keeps a current index
   *   correct: it skips what is unchanged and purges what is stale).
   * - The walk is {@link reindexSource} with no `limit` and no `dryRun`: a
   *   complete build, with `beginBuild` and `completeBuild`.
   * - The walk runs under the build's fence (`knowledge-build.ts`): a lost
   *   lease stops it before its next page (`lease-lost`), and a build that
   *   finishes no page for {@link BUILD_STALL_LIMIT_MS} is cancelled
   *   (`timed-out`); either way the lease is released and nothing is purged
   *   or completed. The completion is not bounded: once it has begun the
   *   build waits for it, so a switch that began before the bound passed
   *   still commits, and the record reads `done` or `failed`.
   *
   * Progress is logged at `info` when the build starts (with what it costs),
   * at most every {@link BUILD_PROGRESS_LOG_INTERVAL_MS} while it walks, and
   * when it ends; a build that does not finish is logged at `warn` — nothing
   * claims it finished, the adapter keeps what it held and the next build
   * starts again. Never rejects for a registered source; throws for an
   * unknown one, as {@link reindexSource} does.
   */
  async rebuildSource(sourceId: string, opts: { trigger: KnowledgeBuildTrigger }): Promise<KnowledgeBuildRecord> {
    return this.rebuildOf(this.requireEntry(sourceId), opts);
  }

  /**
   * {@link rebuildSource} of one registered source. The record names the
   * source by its face; the build's lock and this node's record of it are
   * held under its index key, which no two sources share.
   */
  private async rebuildOf(entry: KnowledgeSourceEntry, opts: { trigger: KnowledgeBuildTrigger }): Promise<KnowledgeBuildRecord> {
    const source = entry.handed;
    const running = this.builds.get(entry.key);
    if (running?.status === 'running') return cloneBuildRecord(running);
    const record: KnowledgeBuildRecord = {
      sourceId: entry.face,
      trigger: opts.trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: emptyBuildProgress(),
    };
    this.builds.set(entry.key, record);
    const logger = this.options.logger;
    const label = `[knowledge] build of source '${entry.face}' (${opts.trigger})`;
    const finish = (
      status: Exclude<KnowledgeBuildRecord['status'], 'running'>,
      message: string | undefined,
      result?: KnowledgeReindexResult,
    ): KnowledgeBuildRecord => {
      record.status = status;
      record.finishedAt = new Date().toISOString();
      if (message !== undefined) record.message = message;
      if (result !== undefined) record.result = result;
      return cloneBuildRecord(record);
    };

    let lock: KnowledgeBuildLock | undefined;
    try {
      lock = this.options.resolveBuildLock?.();
    } catch (err) {
      const message = `the cluster service could not be read (${errorText(err)}), so no node can prove it alone builds the source; nothing was built.`;
      logger?.warn(`${label}: ${message}`);
      return finish('not-run', message);
    }
    let handle: KnowledgeBuildLockHandle | null = null;
    if (lock) {
      try {
        handle = await lock.acquire(buildLockKey(entry.key), { ttlMs: BUILD_LEASE_MS, waitMs: 0 });
      } catch (err) {
        const message = `the cluster lock did not answer (${errorText(err)}), so no node can prove it alone builds the source; nothing was built.`;
        logger?.warn(`${label}: ${message}`);
        return finish('not-run', message);
      }
      if (!handle) {
        const message = 'another node holds the build of this source; this node built nothing.';
        logger?.info?.(`${label}: ${message}`);
        return finish('not-run', message);
      }
    }
    const fence = startBuildFence({
      handle,
      leaseMs: BUILD_LEASE_MS,
      stallMs: BUILD_STALL_LIMIT_MS,
      onRenewFailure: (err, held) => {
        logger?.warn(
          `${label}: the cluster lease could not be renewed (${errorText(err)}). ` +
            (held
              ? 'Renewal is retried; the build stops before its next page if the lease lapses.'
              : 'The lease is lost; the build stops before its next page.'),
        );
      },
    });
    try {
      if (opts.trigger === 'boot' || opts.trigger === 'reload') {
        const reading = await this.readIndexStateOf(entry);
        if (!reading.due) {
          const message = `nothing to build once the lock was held: ${reading.detail}`;
          logger?.info?.(`${label}: ${message}`);
          return finish('not-run', message);
        }
      }
      logger?.info?.(
        `${label} started: every row the source's where matches is read, and the content fields of each one the ` +
          'adapter does not already hold unchanged are sent to the embedding provider, which bills for them.',
      );
      let lastLogged = Date.now();
      const walk = this.reindexWith(source, {}, (step) => {
        // A walk the build stopped waiting on writes no progress into its ended record.
        if (record.status !== 'running') return;
        fence.progressed();
        record.progress = { ...step };
        const now = Date.now();
        if (now - lastLogged < BUILD_PROGRESS_LOG_INTERVAL_MS) return;
        lastLogged = now;
        logger?.info?.(
          `${label}: page ${step.pages}, ${step.discovered} row(s) read, ${step.indexed} written, ` +
            `${step.skipped} unchanged, ${step.failed} cannot be indexed.`,
        );
      }, fence);
      // Cancelled at the stall bound: the walk is no longer waited on (it
      // stops at its next page if the call it waits on ever answers).
      walk.catch(() => undefined);
      const raced = await Promise.race([walk, fence.cancelled.then((stop) => ({ stop }))]);
      if ('stop' in raced) {
        logger?.warn(
          `${label} was cancelled: ${raced.stop.message} The adapter keeps what it held; ` +
            'the next reconcile, boot or operator rebuild builds again.',
        );
        return finish(raced.stop.reason, raced.stop.message);
      }
      const result = raced;
      record.progress = {
        pages: record.progress.pages,
        discovered: result.discovered,
        indexed: result.indexed,
        skipped: result.skipped ?? 0,
        failed: result.failed ?? 0,
      };
      const totals =
        `${result.discovered} row(s) read, ${result.indexed} written, ${result.skipped ?? 0} unchanged, ` +
        `${result.purged ?? 'none'} purged, ${result.failed ?? 0} cannot be indexed`;
      const stop = result.ok ? undefined : fence.stop();
      if (!result.ok) {
        logger?.warn(
          `${label} did not finish (${totals}): ${result.message ?? 'no reason given'} ` +
            'The adapter keeps what it held; the next reconcile, boot or operator rebuild builds again.',
        );
        return finish(stop?.reason ?? 'failed', result.message, result);
      }
      logger?.info?.(`${label} finished: ${totals}.${result.message === undefined ? '' : ` ${result.message}`}`);
      return finish('done', result.message, result);
    } catch (err) {
      const message = `the build threw: ${operatorText(err)}`;
      logger?.warn(`${label} did not finish: ${message} The adapter keeps what it held; the next reconcile, boot or operator rebuild builds again.`);
      return finish('failed', message);
    } finally {
      fence.close();
      if (handle) {
        try {
          await handle.release();
        } catch (err) {
          // The lease still frees itself on its TTL; the build itself ran.
          logger?.warn(`${label}: the cluster lock could not be released (${errorText(err)}); it frees itself when its lease ends.`);
        }
      }
    }
  }

  /**
   * The boot's first-build pass (ADR-0161 K7, "What starts a rebuild"): read
   * every registered source's index ({@link readIndexState}) and build, one
   * source at a time, each one a build is due for ({@link rebuildSource},
   * trigger `boot`). A source with `refresh.onRecordChange: false` is left
   * alone — an external indexer owns its index — and so is one whose state
   * builds nothing; a state that cannot be read or seen is logged at `warn`,
   * once. A source whose adapter is not mounted is skipped without a line:
   * {@link reportUnmountedAdapters} names it at boot, so it is said once.
   * Resolves when the pass is done; never rejects. Run in the
   * background by `KnowledgeServicePlugin`, so the boot never waits for it.
   */
  async buildSourcesAtBoot(): Promise<void> {
    let entries: KnowledgeSourceEntry[];
    try {
      entries = this.registry.entries();
    } catch (err) {
      this.options.logger?.warn(`[knowledge] the boot build pass could not list the sources (${operatorText(err)}); none is built at boot.`);
      return;
    }
    for (const entry of entries) {
      if (this.buildsStopped) return;
      await this.buildIfDue(entry, 'boot');
    }
  }

  /**
   * Build the metadata item's source held under `key` when a build is due for
   * it — what the boot pass does for each source, done for one: the loader
   * calls it when a `knowledge_source` item is added or changed while the
   * process runs (ADR-0161 K7, "What starts a rebuild": a source reload).
   * Never rejects; a key that holds no source is a no-op.
   */
  async buildReloadedSource(key: string): Promise<void> {
    const entry = this.registry.byIndexKey(key);
    if (entry && !this.buildsStopped) await this.buildIfDue(entry, 'reload');
  }

  /** One source of {@link buildSourcesAtBoot}. Never rejects. */
  private async buildIfDue(entry: KnowledgeSourceEntry, trigger: KnowledgeBuildTrigger): Promise<void> {
    const logger = this.options.logger;
    const when = trigger === 'boot' ? 'at boot' : 'on reload';
    try {
      if ((entry.authored.refresh?.onRecordChange ?? true) === false) {
        logger?.debug?.(`[knowledge] source '${entry.face}': refresh.onRecordChange is false, so an external indexer owns its index; it is not built ${when}.`);
        return;
      }
      // A source whose adapter is not mounted is named once at boot, at
      // `error`, by the boot's reading (`reportUnmountedAdapters`); the pass
      // adds no second line for it. On reload no reading runs, so the line
      // below is the one that names it. A source that names no adapter and
      // cannot be placed is named by the same reading.
      if (trigger === 'boot') {
        const adapterId = this.boundAdapterId(entry.handed);
        if (adapterId === undefined || !this.adapters.has(adapterId)) return;
      }
      const reading = await this.readIndexStateOf(entry);
      if (reading.due) {
        logger?.info?.(`[knowledge] source '${entry.face}' is built now: ${reading.detail}`);
        await this.rebuildOf(entry, { trigger });
        return;
      }
      const line = `[knowledge] source '${entry.face}' is not built ${when}: ${reading.detail}`;
      // What cannot be seen or read is said once, at `warn` (K7: "the
      // service says so once"); a source that is current, or whose adapter
      // holds documents it reports no status for, is ordinary.
      if (reading.state === 'unknown' || reading.state === 'unreadable' || reading.state === 'no-recipe-hash') {
        logger?.warn(line);
      } else {
        logger?.info?.(line);
      }
    } catch (err) {
      logger?.warn(`[knowledge] source '${entry.face}': the build pass failed for it (${operatorText(err)}).`);
    }
  }

  /**
   * Stop the boot pass and the reconcile from starting another build, and
   * drop every reconcile a predicate write asked for that has not started. A
   * build already walking runs to its end.
   */
  stopBuilds(): void {
    this.buildsStopped = true;
    for (const key of [...this.pendingReconciles.keys()]) this.cancelPendingReconcile(key);
  }

  // ── The reconcile (ADR-0161 K1, K3 item 3) ───────────────────────

  /**
   * Reconcile the registered sources: walk each one the reconcile covers,
   * completely, so its index ends equal to its source (ADR-0161 K1: "Events
   * keep an index fresh; a reconcile pass keeps it correct").
   *
   * The walk is the complete build ({@link rebuildSource}, trigger
   * `reconcile`): the same cluster lease and fence, the same skip of what the
   * store holds unchanged, the same purge of what it holds stale and the same
   * `completeBuild`. Nothing else walks or purges. So a reconcile writes the
   * documents of rows inserted or changed since the index last saw them (a
   * lost event, a sync that failed, a row changed while the embedder was
   * down), and removes those of rows deleted or moved out of `where` (a
   * predicate write, an insert that rolled back) — and embeds nothing for a
   * row whose document is unchanged.
   *
   * Which sources it walks: an `object` source whose `refresh.onRecordChange`
   * is not `false` (an external indexer owns that index), with a data engine
   * bound, on an adapter that has `listDocuments`. An adapter without it can
   * neither skip nor purge, so a walk would re-embed every document and remove
   * nothing: the source is left alone, said once per source at `warn`, naming
   * the operator's rebuild.
   *
   * It is the third moment the service reads a source's index state
   * ({@link readIndexState}), beside the boot and a source reload: a source
   * whose state reads `nothing`, `new-fingerprint`, `recipe-changed` or
   * `no-recipe-hash` is built exactly as the boot pass would build it (a new
   * generation for a new fingerprint), so a split or embedder setting saved
   * while the server runs is picked up by the next reconcile. The build's
   * start line says what it costs, as every build's does.
   *
   * Sources are walked one after another, and one pass runs at a time on a
   * node (a second pass waits for the first). A build of the source another
   * node holds is `not-run` here, as for every build. `sources` names the
   * sources to consider (faces or bare names, as {@link rebuildSource} takes
   * them); a name that resolves to no source is skipped. Never rejects; the
   * report names every walk that did not finish.
   */
  reconcileSources(opts: { sources?: string[] } = {}): Promise<KnowledgeReconcileReport> {
    const names = opts.sources;
    return this.enqueueReconcile(() =>
      names === undefined
        ? this.registry.entries()
        : names.map((name) => this.registry.resolve(name)).filter((e): e is KnowledgeSourceEntry => e !== undefined),
    );
  }

  /** Queue one reconcile pass over the entries `select` answers when its turn comes. */
  private enqueueReconcile(select: () => KnowledgeSourceEntry[]): Promise<KnowledgeReconcileReport> {
    const pass = this.reconcileTail.then(() => this.reconcilePass(select));
    this.reconcileTail = pass.then(() => undefined, () => undefined);
    return pass;
  }

  /** One pass of {@link reconcileSources}; runs after the pass before it. */
  private async reconcilePass(select: () => KnowledgeSourceEntry[]): Promise<KnowledgeReconcileReport> {
    const startedAt = new Date().toISOString();
    const report: KnowledgeReconcileReport = { startedAt, finishedAt: startedAt, sources: [], unfinished: [] };
    let entries: KnowledgeSourceEntry[];
    try {
      entries = select();
    } catch (err) {
      this.options.logger?.warn(`[knowledge] the reconcile could not list the sources (${operatorText(err)}); none was reconciled.`);
      report.unfinished.push({ sourceId: '*', status: 'failed', message: `the sources could not be listed (${operatorText(err)})` });
      report.finishedAt = new Date().toISOString();
      return report;
    }
    for (const entry of entries) {
      if (this.buildsStopped) break;
      // A source removed while the pass ran is not walked.
      if (this.registry.byIndexKey(entry.key) !== entry) continue;
      const done = await this.reconcileOf(entry);
      report.sources.push(done);
      const status = done.record?.status;
      if (status === 'failed' || status === 'lease-lost' || status === 'timed-out') {
        report.unfinished.push({ sourceId: entry.face, status, ...(done.record?.message === undefined ? {} : { message: done.record.message }) });
      }
    }
    report.finishedAt = new Date().toISOString();
    return report;
  }

  /** One source of a reconcile pass. Never rejects. */
  private async reconcileOf(entry: KnowledgeSourceEntry): Promise<KnowledgeReconcileEntry> {
    const logger = this.options.logger;
    const left = (why: string): KnowledgeReconcileEntry => ({ sourceId: entry.face, left: why });
    try {
      const why = this.reconcileExclusion(entry);
      if (why !== undefined) {
        if (why.unlisted) {
          if (!this.reconcileUnlistedReported.has(entry.key)) {
            this.reconcileUnlistedReported.add(entry.key);
            logger?.warn(`[knowledge] source '${entry.face}' is not reconciled: ${why.text}`);
          }
        } else {
          logger?.debug?.(`[knowledge] source '${entry.face}' is not reconciled: ${why.text}`);
        }
        return left(why.text);
      }
      const reading = await this.readIndexStateOf(entry);
      logger?.info?.(
        reading.due
          ? `[knowledge] source '${entry.face}' is built by the reconcile now: ${reading.detail}`
          : `[knowledge] source '${entry.face}' is reconciled now (${reading.state}): ${reading.detail}`,
      );
      return { sourceId: entry.face, record: await this.rebuildOf(entry, { trigger: 'reconcile' }) };
    } catch (err) {
      const message = `the reconcile failed for it (${operatorText(err)}).`;
      logger?.warn(`[knowledge] source '${entry.face}': ${message}`);
      const now = new Date().toISOString();
      return {
        sourceId: entry.face,
        record: { sourceId: entry.face, trigger: 'reconcile', status: 'failed', startedAt: now, finishedAt: now, progress: emptyBuildProgress(), message },
      };
    }
  }

  /**
   * Why the reconcile does not walk `entry`, or `undefined` when it does.
   * `unlisted` marks the one exclusion said at `warn`: a store that lists no
   * documents. An adapter that is not mounted is walked, so its build fails
   * and names it.
   */
  private reconcileExclusion(entry: KnowledgeSourceEntry): { text: string; unlisted: boolean } | undefined {
    if ((entry.authored.refresh?.onRecordChange ?? true) === false) {
      return { text: 'refresh.onRecordChange is false, so an external indexer owns its index.', unlisted: false };
    }
    if (!this.options.dataEngine) {
      return { text: 'no data engine is bound, so the source cannot be walked.', unlisted: false };
    }
    const adapterId = this.boundAdapterId(entry.handed);
    const adapter = adapterId === undefined ? undefined : this.adapters.get(adapterId);
    if (adapter && typeof adapter.listDocuments !== 'function') {
      return {
        text:
          `its adapter '${adapter.id}' does not list its documents (no listDocuments), so a walk could neither skip ` +
          'an unchanged document nor purge a stale one: it would send every document to the embedding provider again ' +
          'and remove nothing. Rows deleted or changed without an event stay as they are in its index until an ' +
          'operator rebuild (os knowledge rebuild).',
        unlisted: true,
      };
    }
    return undefined;
  }

  /**
   * Ask for a reconcile of every source over `object` that the reconcile
   * covers ({@link reconcileSources}): what a predicate write (`multi: true`)
   * asks, since its aggregate event names no record. One request per source
   * however many predicate writes arrive: the reconcile starts once no further
   * request for the source arrived for {@link RECONCILE_QUIET_MS}, and at the
   * latest {@link RECONCILE_MAX_WAIT_MS} after the first one it gathers. A
   * reconcile that comes due while a build of the source is running waits one
   * more quiet period, so the walk it starts begins after the write. Answers
   * the sources asked for and those over the object no reconcile can repair
   * (no `listDocuments`, or no data engine); a source an external indexer
   * owns is in neither.
   */
  requestReconcile(object: string): KnowledgeReconcileRequest {
    const request: KnowledgeReconcileRequest = { scheduled: [], unreconcilable: [] };
    if (this.buildsStopped) return request;
    for (const entry of this.registry.entries()) {
      if (entry.handed.source.object !== object) continue;
      const why = this.reconcileExclusion(entry);
      if (why !== undefined) {
        // An external indexer's index is not this service's to call stale.
        if (why.unlisted || !this.options.dataEngine) request.unreconcilable.push(entry.face);
        continue;
      }
      this.armReconcile(entry.key, Date.now());
      request.scheduled.push(entry.face);
    }
    return request;
  }

  /** (Re)arm the pending reconcile of the source under `key`; `now` is when the request arrived. */
  private armReconcile(key: string, now: number): void {
    const pending = this.pendingReconciles.get(key);
    const firstAt = pending?.firstAt ?? now;
    if (pending) clearTimeout(pending.timer);
    const wait = Math.max(0, Math.min(RECONCILE_QUIET_MS, firstAt + RECONCILE_MAX_WAIT_MS - now));
    const timer = setTimeout(() => {
      this.pendingReconciles.delete(key);
      const entry = this.registry.byIndexKey(key);
      if (!entry || this.buildsStopped) return;
      // A build of the source running now may have read past the rows the
      // write changed: wait for it, then walk again.
      if (this.builds.get(key)?.status === 'running') {
        this.armReconcile(key, Date.now());
        return;
      }
      void this.enqueueReconcile(() => {
        const current = this.registry.byIndexKey(key);
        return current === undefined ? [] : [current];
      }).catch(() => undefined);
    }, wait);
    (timer as { unref?: () => void }).unref?.();
    this.pendingReconciles.set(key, { timer, firstAt });
  }

  /** Drop the pending reconcile of the source under `key`, if any. */
  private cancelPendingReconcile(key: string): void {
    const pending = this.pendingReconciles.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingReconciles.delete(key);
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
   * Search every source the caller is admitted to, re-check each
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
   * re-check with), each source is asked for
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
   * The system identity gets one round of `topK`. A caller the service cannot
   * re-check (no context, no engine) is served no source at all.
   *
   * ## Ranking only what the caller may read
   *
   * The refill is a cap: a caller whose readable rows all rank below
   * `topK × SEARCH_REFILL_FACTOR` would get none of them. So before the first
   * round, each source of a caller who is re-checked is narrowed to the records
   * that caller may read ({@link sourcesNarrowedToVisible}): when they number
   * no more than `SEARCH_VISIBLE_IDS_MAX`, their ids become the source's
   * `record` term — intersected with the caller's own scope, never added to
   * it — and the adapter ranks only those rows. More than that, a parent term
   * in the caller's scope, or a read that fails, and the source is searched as
   * above. The rounds, the refill and the re-check are the same either way.
   *
   * ## Records, not chunks (`granularity: 'record'`, `groupBy`)
   *
   * Several passages of one record would fill `topK` with one record, so
   * under record granularity every source — for every caller — is asked `topK × SEARCH_FIRST_ROUND_FACTOR` passages, and the
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
    const report = await this.searchByKey(query, opts);
    return {
      hits: report.hits.map((hit) => ({ ...hit, sourceId: this.faceOfKey(hit.sourceId) })),
      refused: this.facedRefusals(report.refused),
    };
  }

  /** The refusals of a search, each source named by its face. */
  private facedRefusals(refused: KnowledgeSearchRefusal[]): KnowledgeSearchRefusal[] {
    return refused.map((r) => ({ ...r, sourceId: this.faceOfKey(r.sourceId) }));
  }

  /**
   * {@link searchWithRefusals} with every source named by its index key, as
   * an adapter's hit names it; the public member translates each to its face.
   * A whole refusal thrown from here already names the sources by face.
   */
  private async searchByKey(query: string, opts: KnowledgeSearchOptions): Promise<KnowledgeSearchReport> {
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
    let admitted: Array<AdmittedSource & { scope?: AdapterScopeTerm[] }> =
      await this.admitSources(this.resolveSearchTargets(opts.sourceIds), ctx);
    if (scope !== undefined) admitted = this.sourcesInScope(admitted, scope);
    if (groupBy !== undefined) admitted = this.sourcesGroupableBy(admitted, groupBy);
    const engine = this.options.dataEngine;
    const filtered = ctx !== undefined && ctx.isSystem !== true && engine !== undefined;
    // A caller the re-check can remove hits for: each source ranks only the
    // records they may read, when those are few enough to name.
    if (filtered && admitted.length > 0) admitted = await this.sourcesNarrowedToVisible(admitted, ctx, engine);
    if (admitted.length === 0) return { hits: [], refused: [] };
    const refused: KnowledgeSearchRefusal[] = [];
    const sources = await this.planSearches(admitted, refused);
    // The sources whose every hit is checked against its live record before
    // it is served: the ones the earlier title rule could serve a field for.
    const verified = new Set(sources.filter((target) => target.verifyHits === true).map((target) => target.source.name));
    const served = async (hits: KnowledgeHit[]): Promise<KnowledgeHit[]> =>
      verified.size === 0 ? hits : this.dropUnverifiedHits(hits, verified);

    const widened = byRecord || filtered;
    const firstAsk = (_source: KnowledgeSource): number =>
      widened ? topK * SEARCH_FIRST_ROUND_FACTOR : topK;
    const groupOf = byRecord
      ? (hit: KnowledgeHit): string | undefined => this.groupKeyOf(hit, groupBy)
      : recordKeyOf;
    const first = await this.searchRound(query, sources, firstAsk, opts.filter, refused);
    if (first.size === 0 && refused.length > 0) throw wholeRefusal(this.facedRefusals(refused));
    const raw = [...first.values()].flatMap((answer) => answer.hits);
    let kept = await served(await this.applyPermissionFilter(raw, ctx, byRecord));
    let removed = raw.length - kept.length;

    if ((filtered || byRecord) && distinctGroups(kept, groupOf) < topK) {
      const saturated = sources.filter(({ source }) => {
        const answer = first.get(source.name);
        return widened && answer !== undefined && answer.answered >= firstAsk(source);
      });
      if (saturated.length > 0) {
        const refusedBefore = refused.length;
        const refill = await this.searchRound(query, saturated, () => topK * SEARCH_REFILL_FACTOR, opts.filter, refused);
        // A refilled source's second answer is a superset of its first: its
        // first-round survivors are dropped and the whole answer re-checked.
        const refilledHits = [...refill.values()].flatMap((answer) => answer.hits);
        const refilledKept = await served(await this.applyPermissionFilter(refilledHits, ctx, byRecord));
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
          if ([...first.keys()].every((id) => refusedInRefill.has(id))) throw wholeRefusal(this.facedRefusals(refused));
        }
      }
    }

    if (removed > 0) {
      this.options.logger?.debug?.(
        `[knowledge] the permission re-check and the per-hit record check removed ${removed} hit(s); ` +
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
   * The sources a `groupBy` search asks: each source that lists `groupBy` in
   * its `metadataFields`. Any other source answers no hits for this search —
   * its hits carry no group value, and a hit is never answered ungrouped.
   */
  private sourcesGroupableBy<T extends { source: KnowledgeSource }>(sources: T[], groupBy: string): T[] {
    return sources.filter(({ source }) => {
      if ((source.source.metadataFields ?? []).includes(groupBy)) return true;
      this.options.logger?.debug?.(
        `[knowledge] source '${this.label(source)}' not searched for groupBy ${quotedName(groupBy)}: ` +
          'the field is not one of its metadataFields.',
      );
      return false;
    });
  }

  /**
   * The group a hit falls in under record granularity: with `groupBy`, the
   * hit's `metadata[groupBy]` value (`undefined` — no group, never answered —
   * when the hit carries none); without it, the hit's record.
   */
  private groupKeyOf(hit: KnowledgeHit, groupBy: string | undefined): string | undefined {
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
   * Not checked: a hit without a record id, and every hit when no data engine
   * is bound.
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
      engine !== undefined && hit.sourceRecordId !== undefined && this.handed(hit.sourceId) !== undefined
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
      const source = this.handed(sourceId)!;
      const objSource = source.source;
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
   * The hits of `verified` sources whose stored document is the one the
   * current recipe assembles from the record as it reads now; every other hit
   * of those sources is dropped. A hit of any other source passes untouched.
   *
   * Why: a source the earlier title rule could serve a field for
   * (`mayServeEarlierRuleTitle`) is searched without the field gate's former
   * `title` arm, and its index may still hold a document assembled under
   * another recipe: one a build walked past and did not purge (a store with
   * no `listDocuments`, `refresh.onRecordChange: false`, a purge candidate
   * kept or listed under a foreign id), or one written between two builds
   * while the object's display field was another field. The recipe hash
   * cannot see either; this check reads the record. A hit survives only when
   * its record still belongs to the source (one system read per source,
   * `{ $and: [where, { id: { $in } }] }`, projected to the fields assembly
   * reads), its document id is the one the source derives from that record,
   * and the `docHash` the store holds equals the one {@link recordToDocument}
   * computes from the row under the current object definition (the title is
   * part of it). Strict, unlike {@link checkFreshness}: a hit with no record
   * id or no stored hash, a read that fails or answers no list, a posture
   * that cannot be read and a hash that cannot be computed each drop the hit.
   *
   * The read decides only whether a hit survives: a surviving hit is returned
   * as the store answered it, and nothing the read returned is put on it. A
   * stale record's document is repaired in the background ({@link
   * repairStale}), as the record-level check repairs it.
   */
  private async dropUnverifiedHits(hits: KnowledgeHit[], verified: ReadonlySet<string>): Promise<KnowledgeHit[]> {
    const engine = this.options.dataEngine;
    const checked = hits.filter((hit) => verified.has(hit.sourceId));
    if (checked.length === 0) return hits;
    const passed = new Set<KnowledgeHit>();
    const dropped = (sourceId: string, count: number, why: string): void => {
      if (count > 0) {
        this.options.logger?.debug?.(
          `[knowledge] ${count} hit(s) of source '${this.faceOfKey(sourceId)}' not served: ${why}`,
        );
      }
    };
    let posture: TenancyPosture | undefined;
    let postureRead = true;
    try {
      posture = await this.readTenancyPosture();
    } catch (err) {
      postureRead = false;
      this.options.logger?.warn?.(
        `[knowledge] the tenancy posture could not be read (${errorText(err)}); no hit of a source checked against its ` +
          'record is served this search (fail-closed).',
      );
    }
    const bySource = new Map<string, KnowledgeHit[]>();
    for (const hit of checked) bySource.set(hit.sourceId, [...(bySource.get(hit.sourceId) ?? []), hit]);
    for (const [sourceId, sourceHits] of bySource) {
      const source = this.handed(sourceId);
      if (!engine || !postureRead || !source || source.source.kind !== 'object') {
        dropped(sourceId, sourceHits.length, 'their records cannot be read to check them.');
        continue;
      }
      const objSource = source.source;
      const usable = sourceHits.filter(
        (hit) => isRecordId(hit.sourceRecordId) && typeof hit.docHash === 'string' && hit.docHash !== '',
      );
      dropped(sourceId, sourceHits.length - usable.length, 'a hit names no record or carries no stored hash.');
      if (usable.length === 0) continue;
      const ids = [...new Set(usable.map((hit) => String(hit.sourceRecordId)))];
      const byId = { id: { $in: ids } };
      const schema = this.schemaFor(objSource.object);
      let rows: unknown;
      try {
        const fields = freshnessFields(objSource, schema, posture);
        rows = await engine.find(
          objSource.object,
          {
            where: objSource.where !== undefined ? { $and: [objSource.where, byId] } : byId,
            ...(fields === undefined ? {} : { fields }),
          },
          { context: systemContext() },
        );
        if (!Array.isArray(rows)) throw new Error(`the read answered ${describeValue(rows)} instead of a list of rows`);
      } catch (err) {
        this.options.logger?.warn?.(
          `[knowledge] the records of source '${this.faceOfKey(sourceId)}' could not be read to check its hits ` +
            `(${errorText(err)}); none is served (fail-closed).`,
        );
        continue;
      }
      const byRow = new Map<string, Record<string, unknown>>();
      for (const row of rows as Array<Record<string, unknown> | null | undefined>) {
        if (row && isRecordId(row.id)) byRow.set(String(row.id), row);
      }
      const current = new Map<string, string | undefined>();
      for (const hit of usable) {
        const recordId = String(hit.sourceRecordId);
        if (hit.documentId !== documentIdFor(sourceId, recordId)) continue;
        if (!current.has(recordId)) {
          const row = byRow.get(recordId);
          let hash: string | undefined;
          if (row !== undefined) {
            try {
              hash = recordToDocument(source, objSource, row, schema, posture).docHash;
            } catch {
              hash = undefined;
            }
          }
          current.set(recordId, hash);
          if (row === undefined || (hash !== undefined && hash !== hit.docHash)) this.repairStale(source, objSource, recordId);
        }
        const hash = current.get(recordId);
        if (hash !== undefined && hash === hit.docHash) {
          passed.add(hit);
          this.freshnessRepairs.delete(documentIdFor(sourceId, recordId));
        }
      }
      dropped(
        sourceId,
        usable.filter((hit) => !passed.has(hit)).length,
        'the record no longer belongs to the source, or the stored document is not the one the current recipe assembles from it.',
      );
    }
    return hits.filter((hit) => !verified.has(hit.sourceId) || passed.has(hit));
  }

  /**
   * Repair the document of a record the freshness check found stale: the
   * event sync's own path ({@link syncRecord}, serialized per document), run
   * in system context, in this process and NOT awaited — the search that found
   * it answers without it. Single-flight per document, and at most once per
   * document until a later search finds its hash matching. Never throws into
   * the search. The scheduled reconcile does not take it over: the reconcile
   * walks whole sources, and this repairs one document now. That is the
   * inline path.
   *
   * While record syncs run through the queue ({@link routeRecordSyncs}) the
   * repair is a record-sync message with reason `freshness`, for this source
   * alone: it survives a restart of the process that searched and is retried
   * like any other sync. A message that could not be published is reported
   * at `error` and the document is left to the next search that finds it
   * stale.
   *
   * A source with `refresh.onRecordChange: false` is never repaired: it is
   * asked through {@link objectSourcesFor}, the one predicate that keeps the
   * service's writes out of a source an external indexer owns, so the stale
   * hit is dropped from the answer and its index entry left to that indexer.
   */
  private repairStale(source: KnowledgeSource, objSource: ObjectKnowledgeSource, recordId: string): void {
    if (objectSourcesFor([source], objSource.object).length === 0) return;
    const docId = documentIdFor(source.name, recordId);
    if (this.freshnessRepairs.has(docId)) return;
    this.freshnessRepairs.add(docId);
    if (this.recordSyncPublisher) {
      this.publishRecordSyncs([source], objSource.object, recordId, 'freshness', () => this.freshnessRepairs.delete(docId));
      return;
    }
    void this.serializeRecordSync(docId, () => this.syncRecord(source, objSource.object, recordId, { id: recordId }));
  }

  /**
   * Each admitted source paired with the adapter it binds to, resolved here
   * once for the whole search, and the fingerprint its search carries
   * ({@link planIndex}); a source whose adapter does not resolve carries the
   * coded refusal instead and is refused by the round, never searched.
   *
   * A source admitted with `proveIndex` ({@link admitSources}) is searched
   * only when its index is proven built under the current recipe
   * ({@link unprovenIndex}); otherwise it is not searched and is added to
   * `refused` as `KNOWLEDGE_REBUILD_REQUIRED` (409), the operator told why at
   * `warn`. Each says whether a rebuild ends the refusal: for a source no
   * build can prove, neither promises one. The boot's build pass, a reload,
   * the reconcile and the operator's rebuild are what build a source; a
   * search never starts a build.
   */
  private async planSearches(
    admitted: Array<AdmittedSource & { scope?: AdapterScopeTerm[] }>,
    refused: KnowledgeSearchRefusal[],
  ): Promise<SearchTarget[]> {
    const out: SearchTarget[] = [];
    // The settings page's chunk target, read at most once for the whole search.
    let target: Promise<number | undefined> | undefined;
    const chunkTarget = (): Promise<number | undefined> => (target ??= this.readChunkTarget());
    for (const { proveIndex, ...entry } of admitted) {
      // The adapter is resolved here, once per search: the proof below is read
      // from this instance and both rounds search this instance, so a source
      // cannot change binding between the check and the use.
      let adapterId: string;
      let adapter: IKnowledgeAdapter;
      try {
        adapterId = this.adapterIdFor(entry.source);
        adapter = this.getAdapter(adapterId);
      } catch (err) {
        // Refused like an adapter that cannot serve, as the round refuses it; a
        // source that needs the index proof is never searched without it.
        out.push({ ...entry, binding: { refusal: codedRefusalOf(err) } });
        continue;
      }
      const plan = await this.planIndex(entry.source, adapter, chunkTarget);
      if (proveIndex === true) {
        const unproven = await this.unprovenIndex(plan);
        if (unproven !== undefined) {
          const label = this.label(entry.source);
          refused.push({
            sourceId: entry.source.name,
            code: INDEX_NOT_PROVEN_CODE,
            status: 409,
            message: `Knowledge source '${label}' is not searched: its index is not proven built under the current recipe. ` +
              UNPROVEN_CALLER_TEXT[unproven.ends],
          });
          this.options.logger?.warn?.(
            `[knowledge] source '${label}' not searched (${INDEX_NOT_PROVEN_CODE}): ${unproven.why} Its object declares ` +
              "a field named 'title' the source does not serve, and a document indexed under the earlier title rule " +
              "carries that field's value, so the source is searched only once its index is proven built under the " +
              `current recipe. ${UNPROVEN_OPERATOR_TEXT[unproven.ends]}`,
          );
          continue;
        }
      }
      out.push({
        ...entry,
        binding: { adapterId, adapter },
        fingerprint: plan.index.fingerprint,
        ...(proveIndex === true ? { verifyHits: true as const } : {}),
      });
    }
    return out;
  }

  /**
   * Why `plan`'s source is not proven built under the current recipe, and
   * what ends it, or `undefined` when it is proven: its adapter's
   * `indexStatus` reports the fingerprint AND the recipe hash
   * {@link planIndex} computes now, and the builds that record that hash
   * purge what they did not walk.
   *
   * The recipe hash names the title rule (ADR-0161 K7), and an adapter
   * records it only at `completeBuild`, the end of a complete build. A
   * complete build rewrites every document whose title changed (`docHash`
   * covers the title) and, when it purges, removes every document it did not
   * walk. It does not purge, and still records the hash, for a source with
   * `refresh.onRecordChange: false` and on an adapter with no
   * `listDocuments` ({@link walkObjectSource}): a document it did not walk,
   * such as one whose row left the source's `where`, keeps what it was
   * assembled with. So those two shapes are never proven, before any read,
   * whatever the hash reads; nor is an adapter with no `indexStatus` (nothing
   * to read) or no `completeBuild` (nothing ever records a hash).
   *
   * The proof covers what the last complete build walked and purged. Read on
   * every search that needs it, never cached: another node may rebuild, or
   * drop, the index. Fails closed: a status that throws is not proven.
   */
  private async unprovenIndex(plan: IndexPlan): Promise<{ why: string; ends: UnprovenEnd } | undefined> {
    const { adapter, index, source } = plan;
    if ((source.refresh?.onRecordChange ?? true) === false) {
      return {
        ends: 'never',
        why:
          'refresh.onRecordChange is false, so an external indexer owns its index: a build of it purges nothing, ' +
          'so a recorded recipe hash does not prove the index holds no document assembled under an earlier recipe.',
      };
    }
    if (typeof adapter.indexStatus !== 'function') {
      return {
        ends: 'never',
        why: `the adapter '${adapter.id}' reports no index status (no indexStatus), so what its index was built under cannot be read.`,
      };
    }
    if (typeof adapter.completeBuild !== 'function') {
      return {
        ends: 'never',
        why: `the adapter '${adapter.id}' has no completeBuild, so no build records a recipe hash for its index.`,
      };
    }
    if (typeof adapter.listDocuments !== 'function') {
      return {
        ends: 'never',
        why:
          `the adapter '${adapter.id}' does not list its documents (no listDocuments), so a complete build cannot purge a ` +
          'document it did not walk, and a recorded recipe hash does not prove the index holds none assembled under an ' +
          'earlier recipe.',
      };
    }
    let held: AdapterIndexStatus;
    try {
      held = await adapter.indexStatus(plan.context('search'));
    } catch (err) {
      return { ends: 'unreadable', why: `the adapter's index status could not be read (${operatorText(err)}).` };
    }
    if (held?.fingerprint !== index.fingerprint) {
      return { ends: 'rebuild', why: 'the index holds no complete build under the current fingerprint.' };
    }
    if (held.recipeHash !== index.recipeHash) {
      return {
        ends: 'rebuild',
        why: held.recipeHash === undefined
          ? 'the index records no recipe hash: no complete build of it has completed.'
          : "the index was last completed under another recipe (the source's where, metadataFields, title rule or withheld fields).",
      };
    }
    return undefined;
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
    for (const { source, organizationIds, fingerprint, scope, binding } of sources) {
      // Refused like an adapter that cannot serve: the caller is told which
      // source was not searched and why; the boot said so at `error`
      // (`reportUnmountedAdapters`), so no line per search. The adapter was
      // resolved once for the whole search ({@link planSearches}); a round
      // searches that instance and never looks it up again.
      if ('refusal' in binding) {
        if (binding.refusal !== undefined) refused.push({ sourceId: source.name, ...binding.refusal });
        continue;
      }
      const { adapterId, adapter } = binding;
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
        for (const hit of hits) if (hit.sourceId === source.name) served.push(hit);
        const foreign = hits.length - served.length;
        if (foreign > 0) {
          this.options.logger?.warn?.(
            `[knowledge] adapter '${adapterId}' answered ${foreign} hit(s) for source '${this.label(source)}' that name ` +
              'another source; dropped — a hit is served only as the source it was searched for.',
          );
        }
        out.set(source.name, {
          hits: scope === undefined ? served : this.checkScope(served, scope, source, adapterId),
          answered: hits.length,
        });
      } catch (err) {
        const coded = codedRefusalOf(err);
        if (coded !== undefined) {
          // The caller reads the code and the adapter's one-sentence message;
          // the operator reads its remedy (the SQL to run, say) here.
          refused.push({ sourceId: source.name, ...coded });
          this.options.logger?.warn?.(
            `[knowledge] source '${this.label(source)}' refused this search and was not searched (${coded.code}): ${operatorText(err)}`,
          );
          continue;
        }
        this.options.logger?.error?.(
          `[knowledge] adapter '${adapterId}' search failed for source '${this.label(source)}': ${(err as Error).message}`,
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
   * no entry reaches is not
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
        const key = `${entry.source.name}\u0000${object}`;
        if (this.scopeAmbiguousReported.has(key)) continue;
        this.scopeAmbiguousReported.add(key);
        this.options.logger?.warn?.(
          `[knowledge] source '${this.label(entry.source)}' lists ${fields.length} fields pointing at '${object}' ` +
            `(${fields.join(', ')}); a search scoped to '${object}' records does not reach it — ` +
            'it is not told which field the scope means.',
        );
      }
      if (terms.length === 0) {
        this.options.logger?.debug?.(
          `[knowledge] source '${this.label(entry.source)}' not searched: no entry of the search's scope reaches it.`,
        );
        continue;
      }
      out.push({ ...entry, scope: terms });
    }
    return out;
  }

  /**
   * Narrow each source's search to the records a non-system caller may read
   * ({@link narrowToVisible}). Per source, the ids of the records it indexes
   * that the caller may read are read first — as the caller, under the
   * source's `where`, ids only, at most {@link SEARCH_VISIBLE_IDS_MAX} + 1 —
   * once per object and `where` the search asks. When the caller may read no
   * more than {@link SEARCH_VISIBLE_IDS_MAX}, the source is handed them as a
   * `record` term, intersected with the caller's own scope, so its adapter
   * ranks only those rows and a narrow caller's answers are not crowded out of
   * the refill cap by rows they could never be served.
   *
   * A source is searched as before — on the caller's own scope, its hits
   * re-checked within the refill cap — when the caller may read more than
   * that, when the caller's scope holds a parent (`metadata`) term, when the
   * narrowing names no record (the caller may read none of what the source
   * could answer: answered as before, no hit or the source's refusal, never a
   * new kind of empty), or when the read fails (logged at `warn`). Nothing here decides access: every hit is
   * still re-checked as the caller ({@link applyPermissionFilter}), and the
   * organization filter each source carries is not touched.
   */
  private async sourcesNarrowedToVisible<T extends { source: KnowledgeSource; scope?: AdapterScopeTerm[] }>(
    sources: T[],
    ctx: ExecutionContext,
    engine: IDataEngine,
  ): Promise<T[]> {
    const reads = new Map<string, Promise<string[] | undefined>>();
    const visibleOf = (objSource: ObjectKnowledgeSource): Promise<string[] | undefined> => {
      const key = JSON.stringify([objSource.object, objSource.where ?? null]);
      let read = reads.get(key);
      if (read === undefined) {
        read = this.readVisibleIds(objSource, ctx, engine);
        reads.set(key, read);
      }
      return read;
    };
    const visible = sources.map((entry) =>
      entry.scope?.some((term) => term.kind !== 'record') === true
        ? Promise.resolve(undefined)
        : visibleOf(entry.source.source));
    const out: T[] = [];
    for (const [i, entry] of sources.entries()) {
      const ids = await visible[i];
      const narrowed = ids === undefined ? undefined : narrowToVisible(entry.scope, ids);
      // A narrowing that names no record is not applied: the source is
      // searched as before, so a caller who may read none of its records is
      // answered as before too — no hit, or the source's refusal.
      if (narrowed === undefined || narrowed.every((term) => term.ids.length === 0)) {
        out.push(entry);
        continue;
      }
      out.push({ ...entry, scope: narrowed });
    }
    return out;
  }

  /**
   * The ids of the records of `objSource` the caller may read, read as the
   * caller under the source's `where`; `undefined` when there are more than
   * {@link SEARCH_VISIBLE_IDS_MAX} or the read fails.
   */
  private async readVisibleIds(
    objSource: ObjectKnowledgeSource,
    ctx: ExecutionContext,
    engine: IDataEngine,
  ): Promise<string[] | undefined> {
    let rows: unknown;
    try {
      // As the caller, in the query, as the permission re-read asks.
      rows = await engine.find(objSource.object, {
        ...(objSource.where === undefined ? {} : { where: objSource.where }),
        fields: ['id'],
        limit: SEARCH_VISIBLE_IDS_MAX + 1,
        context: ctx,
      } as never);
      if (!Array.isArray(rows)) throw new Error(`the read answered ${describeValue(rows)} instead of a list of rows`);
    } catch (err) {
      this.options.logger?.warn?.(
        `[knowledge] the caller's readable records of object='${objSource.object}' could not be read ` +
          `(${errorText(err)}); its sources are searched unnarrowed, every hit re-checked.`,
      );
      return undefined;
    }
    if (rows.length > SEARCH_VISIBLE_IDS_MAX) return undefined;
    const ids: string[] = [];
    for (const row of rows as Array<{ id?: unknown } | null | undefined>) {
      const id = row?.id;
      if ((typeof id === 'string' && id.length > 0) || typeof id === 'number') ids.push(String(id));
    }
    return ids;
  }

  /**
   * The hits of `source` that some scope term holds for ({@link scopeCheck});
   * the rest are dropped, and the first time an adapter's answer loses a hit
   * here it is reported once, at `warn` ({@link searchRound}).
   */
  private checkScope(
    hits: KnowledgeHit[],
    terms: readonly AdapterScopeTerm[],
    source: KnowledgeSource,
    adapterId: string,
  ): KnowledgeHit[] {
    const inScope = scopeCheck(terms);
    const kept = hits.filter(inScope);
    const dropped = hits.length - kept.length;
    if (dropped > 0 && !this.scopeIgnoredReported.has(adapterId)) {
      this.scopeIgnoredReported.add(adapterId);
      this.options.logger?.warn?.(
        `[knowledge] adapter '${adapterId}' answered ${dropped} hit(s) for source '${this.label(source)}' outside the ` +
          "search's scope; dropped. The adapter does not apply AdapterSearchOptions.scope before ranking, or answers " +
          "hits without the document's metadata, so its scoped searches may answer fewer than topK. " +
          'Reported once for this adapter.',
      );
    }
    return kept;
  }

  // ── Sync entrypoints (called by the host plugin's triggers and worker) ───

  /**
   * Run record syncs through a queue (ADR-0161 K1): from now on
   * {@link enqueueRecordSync} and the freshness repair publish one
   * {@link KnowledgeRecordSyncMessage} per source through `publish`, and the
   * host's worker hands each message to {@link processRecordSync}.
   * `undefined` returns to the inline sync. `KnowledgeServicePlugin` calls it
   * in `kernel:ready`, when the composed `queue` service is durable and a
   * data engine is bound (the worker re-reads the row, so it needs one).
   */
  routeRecordSyncs(publish: ((message: KnowledgeRecordSyncMessage) => Promise<unknown>) | undefined): void {
    this.recordSyncPublisher = publish;
  }

  /** Whether record syncs run through the queue ({@link routeRecordSyncs}). */
  get recordSyncQueued(): boolean {
    return this.recordSyncPublisher !== undefined;
  }

  /**
   * A record of `object` was created, updated, restored or deleted: ask for
   * the sync of its document in every source that indexes `object` on record
   * change ({@link objectSourcesFor}) — one message per source, carrying the
   * source's index key, the object, the record id and the reason, never a
   * field value. Nothing is synced here: the worker re-reads the row when it
   * processes the message, so a create, an update and a delete ask for the
   * same thing (the document follows the row as it is then, or leaves the
   * index when no row matches).
   *
   * The messages are published once the unit of work open here commits, and
   * never when it rolls back (`runAfterOpenUnitsCommit` of the ObjectQL
   * engine): a trigger runs inside the write, before the write's own unit or
   * a caller's `transaction()` commits, so a message published at once could
   * be processed before the commit, and one for a write that rolls back would
   * be processed at all. With no unit open they are published at once,
   * outside every unit. Never awaited and never throws: a publish that fails
   * is reported at `error` (the save stands, its document is stale until the
   * record's next save, a search that finds it stale, or the reconcile).
   *
   * Requires {@link routeRecordSyncs}; inline, the triggers call
   * {@link handleRecordUpsert} / {@link handleRecordDelete} instead.
   */
  enqueueRecordSync(object: string, recordId: string | number, reason: KnowledgeRecordSyncReason = 'event'): void {
    if (!isRecordId(recordId)) return;
    const sources = this.sourcesForObject(object);
    if (sources.length === 0) return;
    this.publishRecordSyncs(sources, object, String(recordId), reason);
  }

  /**
   * Publish one record-sync message per source in `sources`, once the unit
   * open here commits ({@link enqueueRecordSync}). `onFailed` runs for each
   * message that could not be published.
   */
  private publishRecordSyncs(
    sources: KnowledgeSource[],
    object: string,
    recordId: string,
    reason: KnowledgeRecordSyncReason,
    onFailed?: () => void,
  ): void {
    const publish = this.recordSyncPublisher;
    if (!publish) return;
    const send = (): void => {
      for (const source of sources) {
        const message: KnowledgeRecordSyncMessage = { source: source.name, object, recordId, reason };
        void Promise.resolve()
          .then(() => publish(message))
          .catch((err: unknown) => {
            onFailed?.();
            const report =
              `[knowledge] the sync of record '${recordId}' of source '${this.label(source)}' could not be queued ` +
              `(${errorText(err)}): the write stands, and the record's document stays as it was until the record's ` +
              'next save, a search that finds it stale, or the reconcile.';
            if (this.options.logger?.error) this.options.logger.error(report);
            else this.options.logger?.warn?.(report);
          });
      }
    };
    const engine = this.options.dataEngine as { runAfterOpenUnitsCommit?(body: () => void): void } | undefined;
    if (typeof engine?.runAfterOpenUnitsCommit === 'function') engine.runAfterOpenUnitsCommit(send);
    else send();
  }

  /**
   * The worker's body: sync the document one {@link KnowledgeRecordSyncMessage}
   * names. The source is resolved by its index key now, at processing time,
   * and the row re-read under the source's `where` as the system identity
   * ({@link handleRecordUpsert}, "What decides a document"): a row comes back →
   * its document is written; none → its document is deleted. Serialized with
   * every other sync of the same document in this process.
   *
   * A failure that a retry can change — the re-read, the split, the
   * embedding call, the store write — is THROWN, so the queue retries the
   * message on its backoff and, once its attempts are spent, keeps it as a
   * dead letter. Every other outcome completes the message and is answered
   * ({@link KnowledgeRecordSyncOutcome}).
   */
  async processRecordSync(data: unknown): Promise<KnowledgeRecordSyncOutcome> {
    const message = readRecordSyncMessage(data);
    if (!message) {
      this.options.logger?.warn?.(
        `[knowledge] a message on the record-sync queue is not a record-sync message (${describeValue(data)}); completed without a sync.`,
      );
      return 'malformed';
    }
    const source = this.handed(message.source);
    if (!source) {
      this.options.logger?.debug?.(
        `[knowledge] record sync of '${message.recordId}' skipped: source '${message.source}' is no longer registered.`,
      );
      return 'source-gone';
    }
    if (objectSourcesFor([source], message.object).length === 0) return 'not-synced';
    const engine = this.options.dataEngine;
    if (!engine) {
      this.options.logger?.warn?.(
        `[knowledge] record sync of '${message.recordId}' for source '${this.label(source)}' skipped: no data engine is ` +
          'bound to re-read the row.',
      );
      return 'not-synced';
    }
    // The source's adapter is resolved now ({@link adapterFor}): the one it
    // names, else the deployment's store, else the only one registered. Where
    // none can be resolved it throws its coded refusal — the named adapter is
    // not mounted, no adapter is mounted (`503 SERVICE_UNAVAILABLE`), or
    // several are and none is the deployment's (`400 VALIDATION_ERROR`) — so
    // the message is retried: a store that registers late is met by a later
    // attempt, and one that never does leaves a dead letter naming the source
    // and the record.
    const adapter = this.adapterFor(source);
    await chainAfter(this.recordSyncTails, documentIdFor(source.name, message.recordId), () =>
      this.syncRow(source, adapter, message.object, message.recordId, engine),
    );
    return 'synced';
  }

  /**
   * Apply an ObjectQL `data.record.created`, `data.record.updated` or
   * `data.record.restored` event to every source bound to the
   * matching object, inline. `record` is the event payload's `after`; its `id` names
   * the row. Failures are logged but never thrown — sync must not block writes.
   * The plugin calls this only where record syncs do not run through the
   * queue ({@link routeRecordSyncs}).
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
   * Only on the inline path: a kernel whose `queue` service is not durable
   * (the kernel's own fallback queue), or a service with no data engine.
   * There the realtime subscription calls this from inside the write: the
   * engine publishes `data.record.created` / `data.record.updated` from the
   * write's engine body, after its `after*` hooks and BEFORE any unit of work
   * around the write commits — the write's own unit (opened when a metadata
   * hook can abort it) or a caller's `engine.transaction(…)` — and the
   * in-process realtime service awaits each subscriber, so the save waits for
   * the re-read, the split, the embedding call and the store write, and the
   * re-read rides the open transaction through the engine's ambient store.
   * If that unit then rolls back, the index is wrong in one of two ways: on a
   * match, the document stays built from a row that never committed; on a
   * miss, the document was deleted although the committed row may still
   * match. The reconcile, a later event of the row or a `reindexSource`
   * repairs it. The after-write hooks (the trigger on a kernel with no
   * `realtime` service) start this once the unit commits and never on a
   * rollback, off the write's response (`knowledge-record-hooks.ts`).
   * `data.record.restored` is published after the restore's own unit has
   * committed; with no `realtime` service an engine middleware hears the
   * restore instead and starts the sync of its rows the same way as the hooks. Bulk events (`data.records.*`) carry a count, not records, and
   * are not synced here — see the plugin's event bridge.
   *
   * Through the queue none of this holds: the triggers publish a message once
   * the write's unit commits and nothing for one that rolls back, the save
   * does not wait for the sync, and a failed sync is retried
   * ({@link enqueueRecordSync}, {@link processRecordSync}).
   *
   * Syncs of one document are serialized in this process
   * ({@link serializeRecordSync}), so two opposite events for one row cannot
   * interleave: each sync re-reads after the previous one finished, and the
   * last one leaves the index agreeing with the database. Inline, the chain
   * is awaited, so a write's sync can wait behind an earlier in-flight sync
   * of the same document; the index still ends consistent.
   */
  async handleRecordUpsert(object: string, record: Record<string, unknown>): Promise<void> {
    const recordId = record.id;
    for (const source of this.sourcesForObject(object)) {
      const sync = (): Promise<void> => this.syncRecord(source, object, recordId, record);
      await (isRecordId(recordId)
        ? this.serializeRecordSync(documentIdFor(source.name, String(recordId)), sync)
        : sync());
    }
  }

  /**
   * One source's inline sync of one row — see {@link handleRecordUpsert}.
   * Never throws: a failure is one `warn` line.
   */
  private async syncRecord(
    source: KnowledgeSource,
    object: string,
    recordId: unknown,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const objSource = source.source;
    try {
      const adapter = this.adapterFor(source);
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
          `[knowledge] event-sync skipped for source '${this.label(source)}': the event's record names no id, ` +
            'so the row cannot be re-read against the source.',
        );
        return;
      }
      await this.syncRow(source, adapter, object, recordId, engine);
    } catch (err) {
      this.options.logger?.warn?.(
        `[knowledge] event-sync failed for source '${this.label(source)}': ${(err as Error).message}`,
      );
    }
  }

  /**
   * THE sync of one row's document, both paths' ({@link syncRecord} inline,
   * {@link processRecordSync} from the queue): re-read the row under the
   * source's `where` as the system identity ({@link rereadRow}) and write its
   * document, or delete the document when no row matches. Throws what the
   * re-read, the split, the embedding call or the store throws.
   */
  private async syncRow(
    source: KnowledgeSource,
    adapter: IKnowledgeAdapter,
    object: string,
    recordId: string | number,
    engine: IDataEngine,
  ): Promise<void> {
    const objSource = source.source;
    const row = await rereadRow(engine, objSource, recordId);
    if (row) {
      const doc = recordToDocument(source, objSource, row, this.schemaFor(object), await this.readTenancyPosture());
      await this.writeSynced(source, adapter, doc, recordId);
    } else {
      const plan = await this.planIndex(source, adapter);
      await adapter.delete([documentIdFor(source.name, String(recordId))], plan.context('event-sync'));
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
        `[knowledge] record '${String(recordId)}' of source '${this.label(source)}' is no longer in the index and search ` +
          `will not find it: its whole document estimates ${f.estimate} tokens, over the budget of ${f.budget} ` +
          `(80% of the embedder's ${String(limit)}-token input limit), and split 'whole' does not truncate. ` +
          `Fix: give source '${this.label(source)}' split strategy 'recursive' or 'markdown', or shorten the record.`;
      // `warn` is the guaranteed channel when a host injects no `error`.
      const logger = this.options.logger;
      if (logger?.error) logger.error(message);
      else logger?.warn?.(message);
    }
  }

  /** The no-engine path cannot judge `where`: say so once per source, never once per event. */
  private reportWhereUnenforceable(source: KnowledgeSource): void {
    if (this.whereUnenforceableReported.has(source.name)) return;
    this.whereUnenforceableReported.add(source.name);
    this.options.logger?.warn?.(
      `[knowledge] source '${this.label(source)}' declares a where filter and no data engine is bound: record events ` +
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
      const docId = documentIdFor(source.name, recordId);
      await this.serializeRecordSync(docId, async () => {
        try {
          const adapter = this.adapterFor(source);
          await adapter.delete([docId], (await this.planIndex(source, adapter)).context('event-sync'));
        } catch (err) {
          this.options.logger?.warn?.(
            `[knowledge] event-sync delete failed for source '${this.label(source)}': ${(err as Error).message}`,
          );
        }
      });
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  /**
   * The registered source `sourceId` names, read by the one rule
   * (`KnowledgeSourceRegistry.resolve`): its face, else a bare name by
   * ADR-0150 D3. Throws for a name no source has, listing the registered
   * faces, and `409 RESOURCE_CONFLICT` for one that names several.
   */
  private requireEntry(sourceId: string): KnowledgeSourceEntry {
    const entry = this.registry.resolve(sourceId);
    if (!entry) {
      throw new Error(
        `[knowledge] unknown source '${sourceId}'. Registered: [${this.registry.entries().map((e) => e.face).join(', ')}]`,
      );
    }
    return entry;
  }

  /**
   * The sources a search asks: every source whose `aiExposed` is not `false`,
   * or the ones `sourceIds` names — each read by the one rule, so a name
   * several sources have refuses the search (`409 RESOURCE_CONFLICT`) and a
   * name none has is skipped, reported at `warn`.
   */
  private resolveSearchTargets(sourceIds?: string[]): KnowledgeSource[] {
    if (!sourceIds || sourceIds.length === 0) {
      return this.handedSources().filter((s) => s.aiExposed !== false);
    }
    const out = new Map<string, KnowledgeSource>();
    for (const id of sourceIds) {
      const entry = this.registry.resolve(id);
      if (entry) out.set(entry.key, entry.handed);
      else this.options.logger?.warn?.(`[knowledge] search target '${id}' not registered; skipping.`);
    }
    return [...out.values()];
  }

  /**
   * [ADR-0090 D10 rule 1] The sources this caller's search may reach: a
   * source over an object the caller's exposure decision refuses, or one
   * serving a field the caller may not query, is not searched for that
   * caller — see `knowledge-source-admission.ts` for the gates and why they are
   * asked at source granularity. Computed once per (caller, object) per search.
   *
   * The system context bypasses, as it bypasses the row re-check. A caller
   * with NO context, or a service with no data engine bound, cannot be judged
   * and is served no source at all — never searched, so no passage of one can
   * reach the caller through a hit the row re-check cannot place (a hit with
   * no `sourceRecordId`). Fails CLOSED: a gate that throws refuses
   * every source over that object, reported once at `error`. The objects'
   * admissions are asked concurrently.
   *
   * An admitted source over which an index built under the earlier title
   * rule could serve a field the gate does not ask about
   * (`mayServeEarlierRuleTitle`) carries `proveIndex`: {@link planSearches}
   * searches it only once its index is proven built under the current recipe.
   *
   * Each admitted source carries the organizations its search hands the
   * adapter ({@link scopeByOrganization}, ADR-0161 K8, item 9). The system
   * context's bypass above covers that scope too: the system identity's
   * search is handed no organization filter.
   */
  private async admitSources(
    sources: KnowledgeSource[],
    ctx: ExecutionContext | undefined,
  ): Promise<AdmittedSource[]> {
    if (ctx?.isSystem) return sources.map((source) => ({ source }));
    const engine = this.options.dataEngine;
    if (!ctx || !engine) {
      if (sources.length > 0) {
        this.options.logger?.warn?.(
          !ctx
            ? '[knowledge] retrieval with no ExecutionContext — no source is searched: a missing ' +
                'identity is not a grant of authority, so retrieval fails closed rather than searching the whole corpus unscoped. ' +
                'Pass the caller identity (or an explicit system context) to retrieve knowledge.'
            : '[knowledge] no IDataEngine bound — no source is searched, to stay safe.',
        );
      }
      return [];
    }
    const deps = this.admissionDeps(engine);
    const byObject = new Map<string, Promise<ObjectAdmission | undefined>>();
    for (const source of sources) {
      const object = source.source.object;
      if (byObject.has(object)) continue;
      byObject.set(
        object,
        admitObject(object, ctx, deps).catch((err: unknown) => {
          this.reportGateFailure(object, err instanceof Error ? err : new Error(String(err)));
          return undefined;
        }),
      );
    }
    const out: AdmittedSource[] = [];
    for (const source of sources) {
      const objSource = source.source;
      const objectAdmission = await byObject.get(objSource.object);
      if (!objectAdmission) continue; // the gate threw: reported once, refused.
      const verdict: KnowledgeSourceAdmission = objectAdmission.refused
        ? { admitted: false, reason: objectAdmission.refused, object: objSource.object }
        : admitSourceFields(objSource, objectAdmission);
      if (verdict.admitted) {
        // An index built under the earlier title rule could serve a field
        // the gate no longer asks about: searched only once its index is
        // proven built under the current recipe ({@link planSearches}).
        out.push(mayServeEarlierRuleTitle(objSource, objectAdmission.schema) ? { source, proveIndex: true } : { source });
      } else {
        this.options.logger?.debug?.(
          `[knowledge] source '${this.label(source)}' not searched for this caller: ${verdict.reason} ` +
            `(object='${verdict.object}'${verdict.field ? `, field='${verdict.field}'` : ''}).`,
        );
      }
    }
    return this.scopeByOrganization(out, ctx);
  }

  /** What the source-admission gates read of the engine and the security service. */
  private admissionDeps(engine: IDataEngine): KnowledgeAdmissionDeps {
    return {
      readSchema: (object: string): unknown => {
        const getSchema = (engine as { getSchema?: (name: string) => unknown }).getSchema;
        return typeof getSchema === 'function' ? getSchema.call(engine, object) : undefined;
      },
      isObjectPackageDisabled: (object: string): boolean =>
        registryObjectPackageDisabled((engine as { registry?: unknown }).registry)(object),
      resolveSecurity: (): KnowledgeFieldSecurity | undefined => this.options.resolveSecurity?.(),
    };
  }

  /**
   * [ADR-0161 K4, guard two] Source admission at save: may `ctx`, the author
   * saving this `knowledge_source` item, themselves search what it would
   * index? The gates a search asks per caller ({@link admitSources}: the
   * object's package is not disabled, the API serves the object for `search`,
   * a system object opts into AI reads, every served field is queryable by
   * the caller) are asked once for the author, before the item is written.
   * Asked by every door that saves an item (`authoredKnowledgeSourceRefusal`,
   * `@objectstack/metadata-core`), never by the metadata protocol.
   *
   * `item` is the body as the door hands it to the protocol, not yet parsed.
   * What is read of it is `source.object`, `source.content`,
   * `source.metadataFields` and the fields `source.where` reads (and `source.contentFields`, the spelling the
   * ADR-0087 kit renames to `content`, so a converted save is judged on the
   * fields it will index). An item with no object to judge is admitted here:
   * the protocol's parse refuses it with the schema's own prescription.
   *
   * A refusal is coded (ADR-0112) and names the object, and the field for the
   * field gate: `403 PERMISSION_DENIED`. A source whose `adapter` names no
   * adapter this deployment mounts is refused `400 VALIDATION_ERROR`, naming
   * the source, the adapter and the mounted ones; an omitted `adapter` is not
   * (it is placed by {@link adapterIdFor}). That check is this door's only:
   * a package install (`isSystem`), a source registered in code and
   * `os validate` are not judged here, and for them the boot's reading
   * ({@link reportUnmountedAdapters}) and the `503` at index and search stay
   * the signal. Fails closed: with no data engine, a
   * gate that throws, or a security service that answers neither field
   * question, the save is refused `503 SERVICE_UNAVAILABLE`. The system
   * context is admitted, as it bypasses the gates at search.
   */
  async admitAuthoredSource(
    item: unknown,
    ctx: ExecutionContext | undefined,
  ): Promise<{ admitted: true } | { admitted: false; status: number; code: string; message: string; object: string; field?: string }> {
    if (ctx?.isSystem) return { admitted: true };
    const body = (item as { name?: unknown; source?: unknown } | null | undefined) ?? {};
    const declared = body.source as
      | { object?: unknown; content?: unknown; contentFields?: unknown; metadataFields?: unknown; where?: unknown }
      | null
      | undefined;
    const object = declared && typeof declared === 'object' ? declared.object : undefined;
    if (typeof object !== 'string' || object === '') return { admitted: true };
    const names = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
    const listed = declared as { content?: unknown; contentFields?: unknown; metadataFields?: unknown; where?: unknown };
    const where = listed.where;
    const objSource: ObjectKnowledgeSource = {
      kind: 'object',
      object,
      content: [...names(listed.content), ...names(listed.contentFields)],
      metadataFields: names(listed.metadataFields),
      ...(where !== null && typeof where === 'object' && !Array.isArray(where)
        ? { where: where as Record<string, unknown> }
        : {}),
    };
    const named = `The knowledge source${describeName(body)} was not saved`;
    const refuse = (status: number, code: string, message: string, field?: string) =>
      ({ admitted: false as const, status, code, message, object, ...(field === undefined ? {} : { field }) });
    const unavailable = (why: string) =>
      refuse(
        503,
        'SERVICE_UNAVAILABLE',
        `${named}: whether you may search object '${object}' could not be judged (${why}), and an author must be ` +
          'allowed to search what their source indexes. Nothing was written; try again.',
      );
    if (!ctx) return refuse(403, 'PERMISSION_DENIED', `${named}: the save carries no identity, and a missing identity is not a grant of authority.`);
    // [ADR-0161 K4 ◆] A source that names no adapter where this deployment
    // cannot place one is refused at its save as at its registration, so the
    // author hears it: several adapters registered, none the deployment's.
    const authoredAdapter = (item as { adapter?: unknown } | null | undefined)?.adapter;
    const registeredAdapters = this.listAdapters();
    if (authoredAdapter === undefined && this.options.deploymentAdapter === undefined && registeredAdapters.length > 1) {
      return refuse(400, 'VALIDATION_ERROR', `${named}: it ${unplacedSourceText(registeredAdapters)}`);
    }
    // [ADR-0161 K4] A source that names an adapter this deployment does not
    // mount is refused at its save, so the author hears it there and not from
    // the boot log or a search's 503. A save is served after every store's
    // `start()`, so the adapters registered now are the deployment's.
    if (typeof authoredAdapter === 'string' && !registeredAdapters.includes(authoredAdapter)) {
      return refuse(400, 'VALIDATION_ERROR', `${named}: ${this.unmountedAdapterSaveText(authoredAdapter, registeredAdapters)}`);
    }
    const engine = this.options.dataEngine;
    if (!engine) return unavailable('the knowledge service has no data engine');

    let admission: ObjectAdmission;
    try {
      admission = await admitObject(object, ctx, this.admissionDeps(engine));
    } catch (err) {
      this.reportGateFailure(object, err instanceof Error ? err : new Error(String(err)));
      return unavailable(operatorText(err));
    }
    const verdict: KnowledgeSourceAdmission = admission.refused
      ? { admitted: false, reason: admission.refused, object }
      : admitSourceFields(objSource, admission);
    if (verdict.admitted) return { admitted: true };
    switch (verdict.reason) {
      case 'object-package-disabled':
        return refuse(
          403,
          'PERMISSION_DENIED',
          `${named}: its object '${object}' belongs to a disabled package, and a disabled package's records are ` +
            'not indexed or searched. Enable the package, or index another object.',
        );
      case 'object-api-not-served':
        return refuse(
          403,
          'PERMISSION_DENIED',
          `${named}: the API does not serve object '${object}' for \`search\` (\`enable.apiEnabled\` is false, its ` +
            '`enable.apiMethods` list does not grant `list`, from which search derives, or it grants `list` beside ' +
            "`enable.searchable: false`), and a knowledge search is a search over the object's records. " +
            `Serve '${object}' for search: keep \`enable.apiEnabled\` true and, where it declares ` +
            '`enable.apiMethods`, include `list` with `enable.searchable` not false; or index another object.',
        );
      case 'system-object-not-ai-readable':
        return refuse(
          403,
          'PERMISSION_DENIED',
          `${named}: '${object}' is a system object that does not opt into AI reads (\`enable.aiReadable: true\`), ` +
            'so its records are not indexed for retrieval.',
        );
      case 'field-not-queryable': {
        const field = verdict.field ?? '';
        if (verdict.use === 'where') {
          return refuse(
            403,
            'PERMISSION_DENIED',
            `${named}: its \`where\` reads field '${field}' of object '${object}', which you may not query (it is ` +
              'hidden from you, or served to you masked), and the source would select its records by that field. ' +
              'Remove the field from `where`, or have someone who may query it save the source.',
            field,
          );
        }
        const listedByAuthor = objSource.content.includes(field) || (objSource.metadataFields ?? []).includes(field);
        return refuse(
          403,
          'PERMISSION_DENIED',
          `${named}: you may not query field '${field}' of object '${object}' (it is hidden from you, or served ` +
            'to you masked), and the index would hold its text unmasked. ' +
            (listedByAuthor
              ? 'Remove the field from `content` and `metadataFields`, or have someone who may query it save the source.'
              : "The source does not list it: it is the object's display field, which every document carries as its " +
                'title. Have someone who may query it save the source.'),
          field,
        );
      }
      default:
        return unavailable(`the security service did not answer which fields of '${object}' you may read`);
    }
  }

  /**
   * Why a saved source naming `adapter`, which `mounted` does not hold, is
   * refused, and what to write: the rule, then the remedies this deployment
   * can take. Leaving `adapter` out is offered only where an omitted adapter
   * would be placed ({@link adapterIdFor}).
   */
  private unmountedAdapterSaveText(adapter: string, mounted: readonly string[]): string {
    const deployment = this.options.deploymentAdapter;
    const placeable = (deployment !== undefined && mounted.includes(deployment)) || mounted.length === 1;
    const remedies = [
      ...(mounted.length === 0 ? [] : [`name one of ${mounted.map((id) => `'${id}'`).join(', ')} as its \`adapter\``]),
      ...(placeable ? ["leave `adapter` out, and the deployment's store holds it"] : []),
      `mount the '${adapter}' store and save it again`,
    ];
    return (
      `it names adapter '${adapter}', which this deployment does not mount ` +
      `(mounted: ${mounted.length === 0 ? 'none' : mounted.join(', ')}), and a source's \`adapter\` must name a ` +
      `mounted store. ${remedies.join(', or ').replace(/^./, (c) => c.toUpperCase())}.`
    );
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
   * caller passes.
   *
   * The posture is read once per search, and only when a source is admitted.
   * A posture that cannot be read leaves every source unsearched for this call (fail-closed: whether a wall stands is unknown),
   * reported at `error`, `warn` as the fallback.
   */
  private async scopeByOrganization(
    sources: AdmittedSource[],
    ctx: ExecutionContext,
  ): Promise<AdmittedSource[]> {
    if (sources.length === 0) return [];
    let posture: TenancyPosture | undefined;
    try {
      posture = await this.readTenancyPosture();
    } catch (err) {
      const report =
        `[knowledge] the tenancy posture could not be read (${errorText(err)}); no source is searched ` +
        'for this caller (fail-closed).';
      if (this.options.logger?.error) this.options.logger.error(report);
      else this.options.logger?.warn?.(report);
      return [];
    }
    return sources.map((entry) => {
      const organizationIds = searchOrganizationIds(ctx, posture, this.schemaFor(entry.source.source.object));
      return organizationIds === undefined ? entry : { ...entry, organizationIds };
    });
  }

  private sourcesForObject(object: string): KnowledgeSource[] {
    return objectSourcesFor(this.handedSources(), object);
  }

  /**
   * Drop hits whose underlying ObjectQL record the caller can't read. A hit
   * with no `sourceRecordId`, or of a source nobody registered, cannot be
   * re-checked and is dropped.
   *
   * Identity handling (#2981): an **explicit** `isSystem` context (indexing /
   * trusted server jobs) passes every hit through — it is a deliberate,
   * authored elevation. A **missing** context, however, is NOT a grant of
   * authority: with no identity we cannot prove the caller may read the
   * rows, so we FAIL CLOSED and drop every hit (the
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
    // No identity, or no engine to re-check with → no hit can be proven
    // readable. `admitSources` already kept every source out of the search;
    // this holds the same line for any hit that reached here anyway.
    if (!ctx || !this.options.dataEngine) return [];

    // Group hits by object so we make one query per object.
    const byObject = new Map<string, KnowledgeHit[]>();
    for (const hit of hits) {
      if (!hit.sourceRecordId) continue;
      const source = this.handed(hit.sourceId);
      if (!source) continue;
      const objName = source.source.object;
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
      // A hit the re-check cannot place — no record id, or a source nobody
      // registered — is not provably readable: dropped.
      const source = this.handed(hit.sourceId);
      if (!source || !hit.sourceRecordId) continue;
      const key = `${source.source.object}#${hit.sourceRecordId}`;
      if (!allowed.has(key)) continue;
      const title = titles.get(key);
      out.push(title === undefined ? hit : { ...hit, title });
    }
    return out;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/** A registered source with how a caller names it (`KnowledgeService.describeSources`). */
export interface KnowledgeSourceDescription {
  /** The source's face: `NAMESPACE-NAME` for a package's source, the bare name otherwise. */
  id: string;
  /** The source as its author wrote it. */
  source: KnowledgeSource;
  /** The package that holds it; absent for a source no package holds. */
  packageId?: string;
  /** Which door it arrived through: a registration in code, or a `knowledge_source` metadata item. */
  door: KnowledgeSourceEntry['door'];
}

function describeEntry(entry: KnowledgeSourceEntry): KnowledgeSourceDescription {
  return {
    id: entry.face,
    source: entry.authored,
    ...(entry.packageId === undefined ? {} : { packageId: entry.packageId }),
    door: entry.door,
  };
}

/** ` 'NAME'` for a refusal about an input that carries a usable name (or its retired `id`), else nothing. */
function describeName(input: unknown): string {
  const { name, id } = (input ?? {}) as { name?: unknown; id?: unknown };
  const shown = typeof name === 'string' && name !== '' ? name : typeof id === 'string' && id !== '' ? id : undefined;
  return shown === undefined ? '' : ` ${quotedName(shown)}`;
}

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
/** A source {@link KnowledgeService.admitSources} admitted for a caller. */
interface AdmittedSource {
  source: KnowledgeSource;
  organizationIds?: string[];
  /** Searched only once its index is proven built under the current recipe (`mayServeEarlierRuleTitle`). */
  proveIndex?: true;
}

/** What ends a refusal for want of a proof ({@link KnowledgeService.unprovenIndex}). */
type UnprovenEnd = 'rebuild' | 'never' | 'unreadable';

/** The second sentence of the caller's refusal, by what ends it. */
const UNPROVEN_CALLER_TEXT: Readonly<Record<UnprovenEnd, string>> = {
  rebuild: 'It answers again once a complete rebuild of the source has completed.',
  never: 'No rebuild changes that for this source; an administrator can say why.',
  unreadable: 'What its index holds could not be read; it is asked again on the next search.',
};

/** The last sentence of the operator's `warn` line, by what ends the refusal. */
const UNPROVEN_OPERATOR_TEXT: Readonly<Record<UnprovenEnd, string>> = {
  rebuild:
    'The boot pass, a source reload or the reconcile builds it where they run; os knowledge rebuild builds it now.',
  never:
    'No rebuild can prove it for this source as it is configured, so nothing is rebuilt for it; it stays refused to ' +
    'every caller but the system context.',
  unreadable: 'It is asked again on the next search.',
};

/**
 * The code of a source refused because its index is not proven built under
 * the current recipe: the one a generation-keeping adapter answers for an
 * index built under another fingerprint, as the remedy is the same rebuild.
 */
const INDEX_NOT_PROVEN_CODE = 'KNOWLEDGE_REBUILD_REQUIRED';

interface SearchTarget {
  source: KnowledgeSource;
  /**
   * The adapter the source binds to, resolved once per search
   * ({@link KnowledgeService.planSearches}), or the coded refusal its
   * resolution answered (`undefined`: an uncoded failure, skipped unsearched).
   */
  binding: { adapterId: string; adapter: IKnowledgeAdapter } | { refusal: Omit<KnowledgeSearchRefusal, 'sourceId'> | undefined };
  organizationIds?: string[];
  fingerprint?: string;
  scope?: AdapterScopeTerm[];
  /** Each hit is checked against its live record before it is served ({@link KnowledgeService.dropUnverifiedHits}). */
  verifyHits?: true;
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

/**
 * [ADR-0161 K4 ◆] The refusal of a source that names no adapter where no
 * adapter is registered: ADR-0112 `SERVICE_UNAVAILABLE` (503), as for a named
 * adapter that is not mounted. Names the deployment's store when the runtime
 * marked one.
 */
function noAdapterMountedError(source: string, deployment: string | undefined): Error {
  return Object.assign(
    new Error(
      `[knowledge] source '${source}' names no adapter, and no adapter is mounted` +
        `${deployment === undefined ? '' : ` (the deployment's store '${deployment}' is not mounted)`}. ` +
        "Mount a knowledge store — `requires: ['knowledge']` mounts the deployment's — or name the source's adapter.",
    ),
    { code: UNMOUNTED_ADAPTER_CODE, status: 503 },
  );
}

/**
 * [ADR-0161 K4 ◆] The refusal of a source that names no adapter where several
 * are registered and none is the deployment's: ADR-0112 `VALIDATION_ERROR`
 * (400), naming the choices. The source must say which store holds it.
 */
function unplacedSourceError(source: string, registered: readonly string[], tail = ''): Error {
  return Object.assign(new Error(`[knowledge] source '${source}' ${unplacedSourceText(registered)}${tail}`), {
    code: 'VALIDATION_ERROR',
    status: 400,
  });
}

/** Why a source that names no adapter cannot be placed among `registered`, and what to write. */
function unplacedSourceText(registered: readonly string[]): string {
  return (
    `names no adapter, and ${registered.length} adapters are registered (${registered.join(', ')}) with none the ` +
    "deployment's store, so which one holds its index cannot be told. Name one of " +
    `${registered.map((id) => `'${id}'`).join(', ')} as the source's \`adapter\`.`
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

/** A copy of a build record, so a caller never holds the live one. */
function cloneBuildRecord(record: KnowledgeBuildRecord): KnowledgeBuildRecord {
  return { ...record, progress: { ...record.progress } };
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
 * The sources whose per-record projection of `object` is kept in step
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
      source.source.object === object &&
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
 * How many times `topK` a search asks each source for in its first
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
 * Record ids are text. The knowledge service treats a record id as text: the
 * record id is recovered from the document id as text, and the re-read asks
 * for that text. A caller-supplied NUMERIC record id on driver-memory or
 * driver-mongodb, which keep the id as given and do not equate `'5'` with
 * `5`, is not supported. The re-read does not find such a row, so if its
 * document is a candidate while the row exists (it was restored, or came back
 * into `where`, after the walk read past it), the document is deleted; the row
 * is untouched, and its document returns at the row's next event or the next
 * complete reindex. Ids the platform mints are text on every driver. Asking
 * again by the number is not done: on driver-sql the number is bound against
 * the text `id` column, which MySQL compares numerically (`'05'` matches `5`)
 * and SQL Server and Oracle reject outright, and the object schema does not
 * say which ids are numeric.
 *
 * The caller decides when a purge may run at all (a complete reindex walk,
 * which is also what the reconcile runs) and computes the candidates.
 */
export async function purgeDocuments(input: PurgeDocumentsInput): Promise<PurgeDocumentsOutcome> {
  const { source, objSource, adapter, engine } = input;
  const prefix = `${source.name}:`;
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

/** A hit's record: its source and record id; a hit that names no record is its document. */
function recordKeyOf(hit: KnowledgeHit): string {
  return hit.sourceRecordId !== undefined ? `record:${hit.sourceId}#${hit.sourceRecordId}` : `document:${hit.documentId}`;
}

/**
 * The projection of the freshness check's read: every field
 * {@link recordToDocument} reads for `objSource` — `id`, the content and
 * metadata fields, the title field, and `organization_id` under a walled
 * posture. `undefined` (read the whole row, as the walk and the event sync
 * do) when the object's fields cannot be enumerated, or when a field the source names is not one the object declares:
 * assembly reads such a field off the whole row, and a projection that left it
 * out would recompute a different hash and read every record as stale.
 */
function freshnessFields(
  objSource: ObjectKnowledgeSource,
  schema: unknown,
  posture: TenancyPosture | undefined,
): string[] | undefined {
  const declared = declaredFields(schema);
  if (declared === undefined) return undefined;
  const names = new Set(declared.map(([name]) => name));
  const wanted = new Set<string>(['id', ...objSource.content, ...(objSource.metadataFields ?? [])]);
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
 * source's `content` / `metadataFields` config. Pure function.
 *
 * `schema` (the record's registered object definition) names the fields an
 * index never carries: credential-class fields (the set the engine masks on
 * read) and `internal: true` fields (the set it omits), asked through the same
 * collectors the write-response helper uses (`@objectstack/core`). They are
 * SKIPPED when a source names one as content or metadata, rather than
 * indexed masked: an index document is searchable text
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
  for (const field of objSource.content) {
    if (withheld.has(field)) continue;
    const v = record[field];
    if (v != null) contentParts.push(String(v));
  }
  const metadata: Record<string, unknown> = {};
  for (const field of objSource.metadataFields ?? []) {
    if (withheld.has(field)) continue;
    if (record[field] !== undefined) metadata[field] = record[field];
  }
  const doc: KnowledgeDocument = {
    id: documentIdFor(source.name, recordId || `unknown-${Date.now()}`),
    sourceId: source.name,
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
