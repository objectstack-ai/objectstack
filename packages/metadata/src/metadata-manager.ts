// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Manager
 * 
 * Main orchestrator for metadata loading, saving, and persistence.
 * Implements the IMetadataService contract from @objectstack/spec.
 * Browser-compatible (Pure).
 */

import type {
  MetadataManagerConfig,
  MetadataLoadOptions,
  MetadataSaveOptions,
  MetadataSaveResult,
  MetadataWatchEvent,
  MetadataFormat,
  PackagePublishResult,
  MetadataHistoryQueryOptions,
  MetadataHistoryQueryResult,
  MetadataDiffResult,
} from '@objectstack/spec/system';
import type {
  IMetadataService,
  MetadataWatchCallback,
  MetadataWatchHandle,
  MetadataExportOptions,
  MetadataImportOptions,
  MetadataImportResult,
  MetadataTypeInfo,
  MetadataWriteOptions,
  IRealtimeService,
  RealtimeEventPayload,
  IPubSub,
  Unsubscribe,
} from '@objectstack/spec/contracts';
import type {
  MetadataQuery,
  MetadataQueryResult,
  MetadataValidationResult,
  MetadataBulkResult,
  MetadataDependency,
  MetadataTypeRegistryEntryParsed,
} from '@objectstack/spec/kernel';
import type { MetadataOverlay } from '@objectstack/spec/kernel';
import { getMetadataTypeActions } from '@objectstack/spec/kernel';
import {
  MetadataEventType,
  MetadataEventSchema,
  type MetadataEvent as RealtimeMetadataEvent,
} from '@objectstack/spec/api';
// [#5189, #5040 E7b] The endpoint publish gates, reused verbatim — see
// `gateApiItemsForPublish`.
import {
  ApiEndpointSchema,
  validateApiEndpointDeclarations,
  type ApiEndpoint,
} from '@objectstack/spec/api';
import { createLogger, type Logger } from '@objectstack/core';
import { JSONSerializer } from './serializers/json-serializer.js';
import { YAMLSerializer } from './serializers/yaml-serializer.js';
import { TypeScriptSerializer } from './serializers/typescript-serializer.js';
import type { MetadataSerializer } from './serializers/serializer-interface.js';
import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';
import type { MetadataLoader } from './loaders/loader-interface.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import { generateSimpleDiff, generateDiffSummary } from './utils/metadata-history-utils.js';
import type {
  MetadataRepository,
  MetadataEvent,
  MetaRef,
} from '@objectstack/metadata-core';
import { EndpointMatcher } from './endpoint-matcher.js';
// [#5309] The stored ENVELOPE / authored BODY split — peeled before any spec
// schema parses a stored row. See `stored-envelope.ts`.
import { peelStoredEnvelope } from './stored-envelope.js';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';

/**
 * Watch callback function (legacy)
 */
export type WatchCallback = (event: MetadataWatchEvent) => void | Promise<void>;

/**
 * [#5654] The two methods `capabilities.write` promises on a `datasource:`
 * loader, in the order an item meets them: written by
 * {@link MetadataManager.register}, taken back out by
 * {@link MetadataManager.unregister}. Both are `?` on {@link MetadataLoader}
 * because the other protocols legitimately have neither.
 */
export type WritableLoaderMethod = 'save' | 'delete';

const WRITABLE_LOADER_METHODS: readonly WritableLoaderMethod[] = ['save', 'delete'];

/** How the message names each method, and what the author has to write. */
const WRITABLE_LOADER_METHOD_SIGNATURE: Record<WritableLoaderMethod, string> = {
  save: 'save(type: string, name: string, data: any, options?: MetadataSaveOptions): Promise<MetadataSaveResult>',
  delete: 'delete(type: string, name: string): Promise<void>',
};

/**
 * [#5276, #5654] The registration gate's message for a loader that declares it
 * can be written to but cannot actually carry out one (or both) halves of that
 * write.
 *
 * Built here rather than inline so the gate and its tests quote one text, in the
 * shape AGENTS.md → "Degradation log levels" asks of a loud failure: the
 * **consequence** (concretely, and that the system keeps looking healthy) and
 * the **fix** (both ways out, so the author does not have to guess which one
 * their loader wants).
 *
 * `missing` is the subset of {@link WRITABLE_LOADER_METHODS} the loader does not
 * implement; each one contributes its own consequence sentence, because the two
 * failures are durability failures in opposite directions — a `save`-less loader
 * loses the row that was never written, a `delete`-less one keeps the row that
 * was supposed to go.
 */
export function buildWritableLoaderMissingMethodsMessage(
  loaderName: string,
  missing: readonly WritableLoaderMethod[],
): string {
  const missingPhrase =
    missing.length === 2
      ? 'implements neither a `save()` nor a `delete()` method'
      : `implements no \`${missing[0]}()\` method`;

  const consequences = missing.map((method) =>
    method === 'save'
      ? 'Registered as-is, every write would be a silent lie: `register()` skips a loader that cannot save, then ' +
        'writes the in-memory registry, invalidates the list cache, announces a `created`/`updated` event and ' +
        'notifies watchers, so the caller (Studio/Setup, REST PUT, the CLI, a package publish) is told the write ' +
        `succeeded while nothing ever reaches \`${loaderName}\` — the item reads back correctly for the life of ` +
        'this process and is gone at the next restart, with nothing to retry it. '
      : 'Registered as-is, every deletion would be a silent lie: `unregister()` skips a loader that cannot delete, ' +
        'then drops the registry entry, invalidates the list cache and announces a `deleted` event, so the caller ' +
        '(Studio/Setup, REST DELETE, the CLI, a package teardown) is told the delete succeeded while the row stays ' +
        `in \`${loaderName}\` and is read straight back out by the very next \`list()\`/\`get()\` — across ` +
        'restarts, with nothing to retry it. ',
  );

  const repair = missing
    .map((method) => `\`${WRITABLE_LOADER_METHOD_SIGNATURE[method]}\``)
    .join(' and ');

  return (
    `[MetadataManager] Refusing to register metadata loader \`${loaderName}\`: it declares ` +
    `\`protocol: 'datasource:'\` with \`capabilities.write: true\` but ${missingPhrase}. ` +
    'A write-capable datasource loader is written to AND deleted from — `register()` persists every item into it, ' +
    'and `unregister()` has to take those rows back out again. ' +
    consequences.join('') +
    `Fix: either implement ${repair} on \`${loaderName}\` ` +
    '(`DatabaseLoader` in this package is the reference implementation), or, if the loader is genuinely read-only, ' +
    "declare `capabilities.write: false` — a read-only `datasource:` loader registers without complaint and is " +
    'never written to in the first place.'
  );
}

/**
 * [#5276, #5654] Registration gate: a `datasource:` loader that declares
 * `capabilities.write` MUST implement **both** `save()` and `delete()`.
 *
 * `capabilities.write` used to mean three different things at the three places
 * it is read — "persist into me" to {@link MetadataManager.register}, which
 * duck-typed `save` and **silently skipped** a loader that had none; nothing at
 * all to {@link MetadataManager.unregister}, which did the same with `delete`;
 * and, on the contract, a flat promise that the store can be written. That is
 * the declared ≠ enforced shape (Prime Directive #10), and the cure it
 * prescribes is to enforce the declaration, not to tolerate the gap: the loader
 * is rejected at registration, where the author is standing, instead of losing a
 * row at write or delete time in a deployment nobody is watching.
 *
 * #5276 closed the `delete` half; #5654 closed the `save` half, which was the
 * same shape one direction over — and leaving it open meant one declaration was
 * binding at one end of an item's life and decorative at the other.
 *
 * Scope is deliberately exactly the combination `register()`/`unregister()` act
 * on. Other protocols (`file:`, `memory:`, `http:`, `s3:`) are never written to
 * by the manager at runtime — both loops filter on `datasource:` too — so they
 * have neither a write nor a deletion of their own to lose and are not gated. A
 * `datasource:` loader with `capabilities.write: false` is likewise untouched by
 * both paths.
 */
function assertWritableLoaderContract(loader: MetadataLoader): void {
  const { name, protocol, capabilities } = loader.contract;
  if (protocol !== 'datasource:' || capabilities.write !== true) return;
  const missing = WRITABLE_LOADER_METHODS.filter((method) => typeof loader[method] !== 'function');
  if (missing.length === 0) return;
  throw new Error(buildWritableLoaderMissingMethodsMessage(name, missing));
}

/**
 * [#5189] Appended to the namespace gate's message when `publishPackage` was
 * called without one, because the gate's own text ("declare an explicit
 * `manifest.namespace`") describes a stack file this caller may not have.
 */
const PUBLISH_NAMESPACE_REMEDY =
  'From `MetadataManager.publishPackage` specifically: this method indexes items by `packageId` and '
  + 'carries no manifest, so it cannot prove a namespace on its own and will not infer one from the '
  + 'items being published (an author-supplied value would make the carve-out gate vacuous). Pass the '
  + "package's explicit namespace as `publishPackage(id, { namespace })`, or publish the endpoints as "
  + 'part of a stack artifact (`defineStack` → compile → artifact ingest), which carries the manifest '
  + 'and runs these same gates at parse time.';

/**
 * RFC-4122 v4 uuid for realtime `MetadataEvent.id` (#4602).
 * Prefers `crypto.randomUUID`; the fallback keeps browser-compatible (Pure)
 * environments without WebCrypto working while still satisfying
 * `MetadataEventSchema`'s `z.string().uuid()`.
 */
function generateEventUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Payload format for cluster-wide metadata change broadcasts.
 *
 * Published on channel `metadata.changed` by any node mutating metadata
 * and consumed by peers to invalidate their local caches. Aligns with
 * `MetadataChangedEventPayload` in `cluster-semantics.mdx` §5.
 */
export interface ClusterMetadataChangedPayload {
  /** Origin nodeId — used for loopback suppression. */
  originNode?: string;
  /** Metadata type (object, view, dashboard, …). */
  type: string;
  /** The legacy watch event replayed verbatim on peer nodes. */
  event: MetadataWatchEvent;
}

/**
 * [#5184] One entry of {@link MetadataManager}'s short-TTL `list()` cache.
 *
 * Deliberately NOT exported: this is an internal caching-policy detail, not
 * part of the `IMetadataService` contract. See the `listCache` field comment
 * for the policy this shape encodes.
 */
interface ListCacheEntry {
  /** When the entry was written (`Date.now()`). */
  ts: number;
  /** The `list()` result being memoized. */
  items: unknown[];
  /**
   * True when at least one loader threw while `items` was being assembled, so
   * this answer is known to be a partial view of what is declared. Degraded
   * entries expire after `DEGRADED_LIST_CACHE_TTL_MS` instead of
   * `LIST_CACHE_TTL_MS`, and any future consumer of the cache can branch on
   * this rather than having to guess.
   */
  degraded: boolean;
  /**
   * [#6504] The messages of the loaders that could not be read, in the order
   * they failed — empty whenever `degraded` is false.
   *
   * Memoized with the entry rather than recomputed, so a consumer served from
   * the cache learns the same thing as one served by the read that filled it.
   * Without this the cache could say *that* the answer is partial but never
   * *why*, which is the half `listDiagnosed` needs to be as informative as
   * `getDiagnosed` already is.
   */
  errors: string[];
}

/**
 * [#6504] What one `list()` read actually produced: the best-effort set, plus
 * whether assembling it lost a loader.
 *
 * The return of {@link MetadataManager.readListUncached}, the value shared
 * through `inflightListReads`, and — minus the cache bookkeeping — what
 * {@link MetadataManager.listDiagnosed} hands to a caller. One shape for all
 * three on purpose: the verdict used to be dropped at each hop outward
 * (`readListUncached` computed it, the in-flight promise kept only `items`,
 * `list()` returned only that), and a single carried record is what makes
 * losing it again take an edit rather than an omission.
 */
interface ListReadResult {
  items: unknown[];
  degraded: boolean;
  errors: string[];
}

export interface MetadataManagerOptions extends MetadataManagerConfig {
  loaders?: MetadataLoader[];
  /** Optional IDataDriver instance. When provided alongside config.datasource, auto-configures DatabaseLoader. */
  driver?: IDataDriver;
}

/**
 * Main metadata manager class.
 * Implements IMetadataService contract for unified metadata management.
 */
export class MetadataManager implements IMetadataService {
  private loaders: Map<string, MetadataLoader> = new Map();
  // Protected so subclasses can access serializers if needed
  protected serializers: Map<MetadataFormat, MetadataSerializer>;
  protected logger: Logger;
  protected watchCallbacks = new Map<string, Set<WatchCallback>>();
  protected config: MetadataManagerOptions;

  // In-memory metadata registry: type -> name -> data
  private registry = new Map<string, Map<string, unknown>>();

  // Overlay storage: "type:name:scope" -> MetadataOverlay
  private overlays = new Map<string, MetadataOverlay>();

  // Type registry for metadata type info
  private typeRegistry: MetadataTypeRegistryEntryParsed[] = [];

  // Dependency tracking: "type:name" -> dependencies
  private dependencies = new Map<string, MetadataDependency[]>();

  // Short-lived cache for list() results. Built primarily to break the
  // deadlock that occurs when security/permission middleware calls
  // `list('permission')` from inside a user-initiated DB transaction: the
  // DatabaseLoader's `engine.find('sys_metadata', ...)` would then try to
  // acquire a fresh knex connection while the transaction is still holding
  // SQLite's single connection — knex waits the full `acquireConnectionTimeout`
  // (60s) before returning []. The cache absorbs the repeated lookups so the
  // loader is only hit once per TTL window — for CONCURRENT callers as well as
  // sequential ones, since #5253. The cache on its own could only ever deliver
  // the sequential half of that promise: nothing is written until a read
  // completes, so everything issued before the first read returned used to miss
  // and walk every loader — N callers, N × 60s on the very stall described
  // above. The concurrent half is delivered by `inflightListReads` below, which
  // is why the two fields are one policy and are documented together.
  //
  // [#5184; re-measured under #7708 on 2026-08-11] That hazard is NOT
  // historical — and the re-measurement NARROWED it rather than retiring it.
  // Measured on the current stack: real `ObjectQL` + real `SqlDriver`
  // (better-sqlite3), a real `DatabaseLoader.list()` with the loader's own
  // cache off, `knex.client.pool.max === 1` confirmed for the SQLite dialect
  // and `acquireConnectionTimeout` left at the knex default of 60s.
  //
  //   • Transaction opened DIRECTLY on the driver (`driver.beginTransaction()`)
  //     → the read STALLS for the full timeout and then throws knex's "Timeout
  //     acquiring a connection" (measured: 60_085ms). `DatabaseLoader._find()`
  //     forwards no options, so nothing threads the caller's transaction, and
  //     `driver-sql` still models SQLite as a single-connection pool
  //     (`activeTransactions`, `assertBareKnexSafe` — the latter a dev/test
  //     guard that is a no-op in production, so production still waits the
  //     timeout out). `list()` catches that throw and degrades, which is
  //     precisely the entry whose TTL this policy is choosing.
  //   • Transaction opened through `engine.transaction()` / `ScopedContext`
  //     → returns immediately (measured: 12ms, with `activeTransactions === 1`
  //     and the driver observably receiving the handle on the call). Those
  //     publish the transaction into the engine's ambient `txStore` (ADR-0034)
  //     and `buildDriverOptions` threads it onto the read for the loader.
  //
  // So the stall shape is live but CONDITIONAL: it needs an open transaction
  // that the engine's ambient store cannot see. `SqlDriver.ensureSequencesTable()`
  // is the live witness that this is worth designing against — it takes
  // `parentTrx` and runs its DDL on the caller's transaction for exactly this
  // reason, with `assertBareKnexSafe` as the tripwire for callers that forget;
  // `sql-driver-sqlite-tx-guard.test.ts` pins both halves. (Until #7708 the
  // witness cited here was `plugin-audit`'s `captureBefore`, retired by #6656.
  // It was REPLACED rather than dropped: the example died, the hazard did not.)
  //
  // Hence the policy below keeps caching degraded reads rather than skipping
  // them: "don't cache a degraded read" would trade one 30s silent window for
  // a fresh 60s stall per call on every caller in the first bullet.
  //
  // [#5184] WHAT IS ACTUALLY CACHED, AND FOR HOW LONG — this paragraph is the
  // contract, and it describes `cacheListResult()` / `readCachedList()` below.
  // (An earlier version of this comment claimed the cache kept "only positive
  // (non-empty) hits or repeated hits with a stable miss signature". No such
  // condition ever existed in the code. Comment is contract; a comment that
  // describes a policy nothing implements is a declared ≠ enforced defect in
  // its own right, so it is replaced rather than patched.)
  //
  //   • EVERY completed `list()` is cached, empty results included. There is
  //     no non-empty test and no "miss signature" concept.
  //   • An entry assembled while at least one loader THREW is a known-partial
  //     answer: it is cached with `degraded: true` and expires after
  //     `DEGRADED_LIST_CACHE_TTL_MS`, not `LIST_CACHE_TTL_MS`. So the burst of
  //     repeated lookups the knex path above depends on is still absorbed,
  //     while the window in which the manager serves a known-short set without
  //     re-asking anyone shrinks from 30s to ~2s. Recovery is therefore also
  //     noticed (and `reportLoaderReadRecovered` logged) within ~2s of storage
  //     healing instead of up to 30s later.
  //   • `degraded` lives ON the entry, not in a side table, so every consumer
  //     of the cache can tell a complete answer from a partial one. Read
  //     entries through `readCachedList()` rather than `listCache.get()`, so
  //     the flag and its TTL are applied in one place.
  //
  // Invalidated on every `register()` / `unregister()` to keep CRUD writes
  // visible to subsequent reads.
  //
  // [#5259] WHERE in a write the invalidation sits is part of that promise, not
  // an implementation detail. `list()` merges registry ∪ loaders, so an
  // invalidation issued while only ONE of the two has been updated lets the
  // next read memoize the half-applied view for a full TTL. The rule both
  // writers follow: **invalidate last, once every store already holds the state
  // being announced** — `register()` satisfies it by writing the registry
  // first (the registry outranks loaders in the merge, so its save window
  // already shows the post-write value); `unregister()` satisfies it by
  // deleting from storage first and invalidating after, with nothing awaited
  // between the registry drop and the invalidation. See `unregister()`.
  private listCache = new Map<string, ListCacheEntry>();
  private static readonly LIST_CACHE_TTL_MS = 30_000;
  /**
   * [#5184] TTL for an entry produced by a degraded read (≥1 loader threw).
   *
   * Deliberately at the top of the 1–2s band: the point of keeping degraded
   * results cached at all is to absorb a burst of `list()` calls issued from
   * inside one open transaction, and those bursts are milliseconds apart but
   * can be spread by per-row work. Two seconds covers that while still being
   * 15× shorter than the healthy TTL.
   */
  private static readonly DEGRADED_LIST_CACHE_TTL_MS = 2_000;

  /**
   * [#5253] The `list()` read currently in flight for a metadata type — the
   * concurrent half of the `listCache` policy above.
   *
   * `listCache` memoizes an answer only once a read has *finished*, so it can
   * absorb the caller that arrives second in time but never the caller that
   * arrives second in flight. Everything issued while the first read is still
   * walking the loaders used to miss and start its own identical walk; on the
   * knex/SQLite path the field comment above is built for, that is 60s burned
   * per concurrent caller instead of once for all of them. A type is read once
   * at a time: whoever finds a read already running joins it.
   *
   * **Sharers share the outcome. This is a contract, not an accident.** Every
   * caller joining an in-flight read receives that read's exact result — the
   * same array instance, and, when a loader was unreadable, the same
   * known-partial set that gets memoized `degraded: true` on the short TTL.
   * There is no per-caller retry: `list()` is the best-effort listing seam and
   * does not throw (see {@link reportLoaderReadFailure}; the strict
   * counterparts are `listForIndex()` and {@link loadDiagnosed}), so a lost
   * loader is not an error to fail over from — it is the answer. Re-running the
   * read privately for a joiner would walk the same loaders in the same window
   * against the same outage, which is precisely what this map exists to
   * prevent. Should the seam ever acquire a rejecting path, that rejection is
   * shared by the same mechanism and for the same reason.
   *
   * **The registration is also the permission to cache.** An entry here says
   * "this read still describes the current state". {@link invalidateListCache}
   * retracts it, which is what makes a write landing mid-read safe in both
   * directions:
   *   • the retracted read does NOT write its result into `listCache` when it
   *     settles, so an answer assembled before the write cannot outlive the
   *     write it predates (the invalidation wins — it is the later, better
   *     informed fact);
   *   • a `list()` issued after the invalidation starts a FRESH read instead of
   *     joining one that predates the write.
   * That second point is the #5219 / #5229 ordering bar restated for
   * concurrency: a consumer woken by a metadata change must not observe the
   * event and pre-event state together, and handing a woken watcher an
   * in-flight read that began before the event would be exactly that.
   * Callers *already waiting* on the retracted read still receive its (now
   * possibly stale) result — they asked before the write, and restarting the
   * read under them would turn a write burst into an unbounded retry loop on
   * the one path the cache exists to keep off the loaders.
   *
   * Self-cleaning: the entry is dropped when the read settles, by that read
   * only, so a fresh read that already replaced it keeps its slot. Nothing
   * accumulates — a wave of callers arriving after settle finds the cache the
   * settle just wrote, and once that lapses it starts one new read.
   *
   * [#6504] The shared value is the whole {@link ListReadResult}, not just
   * `items`. "Sharers share the outcome" above is stated about the answer *and*
   * its degraded verdict, and while the promise carried only `items` that was
   * true of `list()` alone: a {@link listDiagnosed} caller joining an in-flight
   * read had no way to reach the verdict that read had already computed, and
   * would have had to either re-walk the loaders (defeating this map) or invent
   * a second, unmemoized answer. `list()` narrows to `.items` at its own return
   * instead, so every sharer still receives the same array instance.
   */
  private readonly inflightListReads = new Map<string, Promise<ListReadResult>>();

  // [#5108] Loader names whose read failure has already been reported at
  // `error` by `list()`. AGENTS.md → "Degradation log levels": say it once, at
  // the first degradation — `list()` is hot enough that one line per failed
  // read would bury the one line that matters. Cleared when the loader answers
  // again, so a second outage is reported again. Same once-only discipline as
  // `DatabaseLoader.schemaFailureReported`.
  private readonly loaderReadFailureReported = new Set<string>();

  // Realtime service for event publishing
  private realtimeService?: IRealtimeService;

  // ── Cluster wiring (cluster-semantics.mdx §5) ────────────────────────
  // When attached via `attachClusterPubSub()`, metadata-change events
  // become cluster-wide:
  //   • Local notifyWatchers() publishes on `metadata.changed` so peers
  //     can invalidate their caches.
  //   • A subscribed remote event first invalidates THIS node's caches
  //     (registry entry + listCache, via `invalidateForForeignWrite` —
  //     #5109) and is then replayed into the local watch hub, so existing
  //     consumers (ObjectQLPlugin, Studio HMR, …) see uniform behavior
  //     regardless of which node initiated the change — including when
  //     they answer the event by re-reading through `list()`.
  // `originNode` on the payload prevents loopback; `partitionKey` keeps
  // per-object ordering on partitioned drivers.
  private clusterPubSub?: IPubSub;
  private clusterNodeId?: string;
  private clusterUnsubscribe?: Unsubscribe;
  private static readonly CLUSTER_CHANNEL = 'metadata.changed';

  // ── ADR-0008 PR-6: optional Repository for event-source integration ──
  // When set, the manager streams `repo.watch()` events into the watch
  // callback hub AND invalidates the in-memory registry/listCache so
  // subsequent reads fall through to the source of truth. No write
  // mirroring yet (deferred to PR-10 / overlay migration).
  protected repository?: MetadataRepository;
  private repoWatchIter?: AsyncIterator<MetadataEvent>;
  private repoWatchClosed = false;

  // ── #5089 (#5040 E2): declared-endpoint index ────────────────────────
  // Backs `matchEndpoint`. Lazily built from `api` items on the first call
  // and invalidated by every path that can change them — see
  // `invalidateListCache` (local writes, repo events, HMR/artifact ingest
  // which registers with `notify:false`, and — since #5109 — cluster peer
  // replay) and the `subscribe('api', …)` registration below.
  private static readonly ENDPOINT_METADATA_TYPE = 'api';
  private readonly endpointMatcher: EndpointMatcher;

  constructor(config: MetadataManagerOptions) {
    this.config = config;
    this.logger = createLogger({ level: 'info', format: 'pretty' });

    // [#5089] Endpoint index (see `matchEndpoint`). Two invalidation seams,
    // covering overlapping but non-identical event sets — both are kept:
    //   1. `invalidateListCache('api')` — every mutation of the stored set
    //      this manager learns about, including the `{ notify: false }`
    //      writes the artifact ingest and the HMR reload use, which by
    //      construction never reach a watcher. It is the same invariant the
    //      list cache carries: if the cached list of a type is stale, so is
    //      the index built from it. Since #5109 a CLUSTER peer's write also
    //      passes through here, via `invalidateForForeignWrite`.
    //   2. `subscribe('api', …)` — the watcher seam, which additionally
    //      covers events raised by subclasses / test doubles that call
    //      `notifyWatchers` without a cache mutation of their own.
    //      Double invalidation is idempotent, so the overlap is free.
    this.endpointMatcher = new EndpointMatcher({
      listApiItems: () => this.listForIndex(MetadataManager.ENDPOINT_METADATA_TYPE),
      logger: this.logger,
    });
    this.subscribe(MetadataManager.ENDPOINT_METADATA_TYPE, () => this.endpointMatcher.invalidate());

    // Initialize serializers
    this.serializers = new Map();
    const formats = config.formats || ['typescript', 'json', 'yaml'];

    if (formats.includes('json')) {
      this.serializers.set('json', new JSONSerializer());
    }
    if (formats.includes('yaml')) {
      this.serializers.set('yaml', new YAMLSerializer());
    }
    if (formats.includes('typescript')) {
      this.serializers.set('typescript', new TypeScriptSerializer('typescript'));
    }
    if (formats.includes('javascript')) {
      this.serializers.set('javascript', new TypeScriptSerializer('javascript'));
    }

    // Initialize Loaders
    if (config.loaders && config.loaders.length > 0) {
      config.loaders.forEach(loader => this.registerLoader(loader));
    }

    // Auto-configure DatabaseLoader when datasource + driver are provided
    if (config.datasource && config.driver) {
      this.setDatabaseDriver(config.driver);
    }
    // Note: No default loader in base class. Subclasses (NodeMetadataManager) or caller must provide one.
  }

  /**
   * Set the type registry for metadata type discovery.
   */
  setTypeRegistry(entries: MetadataTypeRegistryEntryParsed[]): void {
    this.typeRegistry = entries;
  }

  /**
   * Configure and register a DatabaseLoader for database-backed metadata persistence.
   * Can be called at any time to enable database storage (e.g. after kernel resolves the driver).
   *
   * @param driver - An IDataDriver instance for database operations
   * @param organizationId - Organization ID for multi-tenant isolation
   * @param environmentId - Project ID (undefined = platform-global)
   */
  setDatabaseDriver(driver: IDataDriver, organizationId?: string, environmentId?: string): void {
    if (environmentId !== undefined) {
      this.logger.info('Project kernel — skipping DatabaseLoader for sys_metadata (control-plane only)', {
        organizationId,
        environmentId,
      });
      return;
    }
    const tableName = this.config.tableName ?? 'sys_metadata';
    const dbLoader = new DatabaseLoader({
      driver,
      tableName,
      organizationId,
      environmentId,
      cache: this.config.cache?.databaseLoader,
    });
    this.registerLoader(dbLoader);
    this.logger.info('DatabaseLoader configured', { datasource: this.config.datasource, tableName });
  }

  /**
   * Configure and register a DatabaseLoader backed by an IDataEngine (ObjectQL).
   * The engine handles datasource routing automatically — sys_metadata will
   * be routed to the correct driver via the standard namespace mapping.
   * No manual driver resolution needed.
   *
   * @param engine - An IDataEngine instance (typically the ObjectQL service)
   * @param organizationId - Organization ID for multi-tenant isolation
   * @param environmentId - Project ID (undefined = platform-global)
   */
  setDataEngine(engine: IDataEngine, organizationId?: string, environmentId?: string): void {
    if (environmentId !== undefined) {
      this.logger.info('Project kernel — skipping DatabaseLoader for sys_metadata (control-plane only)', {
        organizationId,
        environmentId,
      });
      return;
    }
    const tableName = this.config.tableName ?? 'sys_metadata';
    const dbLoader = new DatabaseLoader({
      engine,
      tableName,
      organizationId,
      environmentId,
      cache: this.config.cache?.databaseLoader,
    });
    this.registerLoader(dbLoader);
    this.logger.info('DatabaseLoader configured via DataEngine', { tableName });
  }

  /**
   * Set the realtime service for publishing metadata change events.
   * Should be called after kernel resolves the realtime service.
   *
   * @param service - An IRealtimeService instance for event publishing
   */
  setRealtimeService(service: IRealtimeService): void {
    this.realtimeService = service;
    this.logger.info('RealtimeService configured for metadata events');
  }

  /**
   * Publish a realtime {@link RealtimeMetadataEvent} for a metadata write
   * (#4602 — contract-first).
   *
   * What reaches a `subscribeMetadata` callback must BE the spec's
   * `MetadataEvent` (`@objectstack/spec/api`): `id` (uuid) at the top level,
   * flattened `metadataType`/`name`/`definition`, `userId` when the write
   * carried an actor. The transport keeps its `RealtimeEventPayload`
   * envelope — `payload` carries the complete `MetadataEvent`, and the client
   * SDK unwraps + validates it at the boundary.
   *
   * Two loud-by-design gates:
   *  - `MetadataEventType` is a CLOSED enum. A metadata type outside it has
   *    no declared realtime event contract, so we skip publishing (debug log)
   *    instead of emitting an event every compliant consumer must reject.
   *    Declared = enforced; widening coverage means widening the spec enum,
   *    not producing off-contract events.
   *  - The event body is `MetadataEventSchema.parse`d before publish, so a
   *    malformed producer fails here (warn log, event not published) rather
   *    than delivering a lie downstream.
   */
  private async publishRealtimeMetadataEvent(
    action: 'created' | 'updated' | 'deleted',
    type: string,
    name: string,
    opts: { definition?: unknown; packageId?: unknown; userId?: string } = {},
  ): Promise<void> {
    if (!this.realtimeService) return;

    const eventType = `metadata.${type}.${action}`;
    if (!(MetadataEventType.options as readonly string[]).includes(eventType)) {
      this.logger.debug(
        `Metadata type '${type}' has no declared realtime event type (MetadataEventType) — skipping publish`,
        { eventType, name },
      );
      return;
    }

    try {
      const event: RealtimeMetadataEvent = MetadataEventSchema.parse({
        id: generateEventUuid(),
        type: eventType,
        metadataType: type,
        name,
        ...(typeof opts.packageId === 'string' ? { packageId: opts.packageId } : {}),
        ...(opts.definition !== undefined ? { definition: opts.definition } : {}),
        ...(opts.userId ? { userId: opts.userId } : {}),
        timestamp: new Date().toISOString(),
      });

      const envelope: RealtimeEventPayload = {
        type: event.type,
        object: type,
        payload: { ...event },
        timestamp: event.timestamp,
      };

      await this.realtimeService.publish(envelope);
      this.logger.debug(`Published ${eventType} event`, { name });
    } catch (error) {
      this.logger.warn(`Failed to publish metadata event`, { type, name, error });
    }
  }

  /**
   * Register a new metadata loader (data source)
   *
   * [#5276, #5654] Rejects — loudly, before the loader is stored — a
   * `datasource:` loader that declares `capabilities.write` without
   * implementing `save()` **and** `delete()`. This is the **only** way into
   * `this.loaders` (the constructor's `config.loaders` come through here too),
   * which is what lets every later write-capability guard be defensive rather
   * than load-bearing.
   */
  registerLoader(loader: MetadataLoader) {
    assertWritableLoaderContract(loader);
    this.loaders.set(loader.contract.name, loader);
    this.logger.info(`Registered metadata loader: ${loader.contract.name} (${loader.contract.protocol})`);
  }

  // ==========================================
  // IMetadataService — Core CRUD Operations
  // ==========================================

  /**
   * Register/save a metadata item by type
   * Stores in-memory registry and persists to database-backed loaders only.
   * FilesystemLoader (protocol 'file:') is read-only for static metadata and
   * should not be written to during runtime registration.
   *
   * Announces the write to {@link subscribe} watchers as an `added` /
   * `changed` {@link MetadataWatchEvent}, so consumers that cache metadata
   * (ObjectQL's SchemaRegistry bridge, the HMR SSE stream) refresh instead of
   * serving the pre-write definition until restart. Pass `{ notify: false }`
   * for bulk ingest that announces by other means — read
   * {@link MetadataWriteOptions.notify} before doing so.
   */
  async register(
    type: string,
    name: string,
    data: unknown,
    options?: MetadataWriteOptions,
  ): Promise<void> {
    // Persistence write gate: when `persistence.writable` is explicitly false
    // we treat register() as read-only. Default `true` (or omitted) preserves
    // historical behavior.
    if (this.config.persistence?.writable === false) {
      const msg = `MetadataManager is read-only (persistence.writable=false); refusing to register ${type}/${name}`;
      if (this.config.validation?.throwOnError) {
        throw new Error(msg);
      }
      this.logger.warn(msg);
      return;
    }

    // Captured before the write so the event distinguishes a first
    // registration from an overwrite, matching the repo-watch path's
    // 'added' vs 'changed' split.
    const existed = this.registry.get(type)?.has(name) ?? false;

    if (!this.registry.has(type)) {
      this.registry.set(type, new Map());
    }
    this.registry.get(type)!.set(name, data);
    this.invalidateListCache(type);

    // Persist only to database-backed loaders that declare write capability.
    // FilesystemLoader is read-only at runtime — writing to it can crash in
    // read-only environments (e.g. serverless, containerized deployments).
    for (const loader of this.loaders.values()) {
      if (loader.contract.protocol !== 'datasource:' || !loader.contract.capabilities.write) continue;
      // [#5654] Defensive only — unreachable for a registered loader, and read
      // in this order on purpose: the protocol/capability test is the policy,
      // the method test is the type narrowing. This exact combination
      // (`datasource:` + `capabilities.write`, no `save`) is rejected by
      // `registerLoader()`, the sole writer of `this.loaders`, so reaching this
      // `continue` would mean a loader entered the map without passing the
      // gate. Kept because the alternative is a TypeError on the line below,
      // and because `save?` stays optional on the interface for the protocols
      // the gate does not cover. Mirrors the same guard in `unregister()`.
      if (typeof loader.save !== 'function') continue;
      await loader.save(type, name, data);
    }

    // Publish metadata.{type}.created / .updated event to realtime service.
    // An overwrite is an UPDATE, mirroring the 'added' vs 'changed' split the
    // watcher event below already makes (#4602).
    await this.publishRealtimeMetadataEvent(existed ? 'updated' : 'created', type, name, {
      definition: data,
      packageId: (data as any)?.packageId,
      userId: options?.userId,
    });

    // Announce last, once the write has landed in the registry and every
    // writable loader — a subscriber that re-reads on the event must not
    // race ahead of the data it is meant to observe.
    if (options?.notify !== false) {
      this.notifyWatchers(type, {
        type: existed ? 'changed' : 'added',
        metadataType: type,
        name,
        path: '',
        data,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Register a metadata item into the in-memory registry ONLY, never persisting
   * to a writable loader. Used for GitOps-managed artefacts that must be
   * *listable* (so `list(type)` returns them) but must never leak into the
   * runtime DB store — e.g. code-defined datasources (`origin:'code'`, ADR-0015
   * Addendum) declared in `*.datasource.ts` and owned by source control. Writing
   * them through `register()` would persist them to `sys_metadata` and create
   * drift between the artefact and the DB; this method avoids that.
   *
   * Deliberately silent: it does NOT announce to {@link subscribe} watchers.
   * This is a boot-time seeding primitive for artefacts that source control
   * owns — callers that mutate metadata mid-run want {@link register}, which
   * announces. If you add a mid-run caller here, announce the change yourself
   * (as the artifact reload path does via `metadata:reloaded`) or its
   * consumers will read the pre-write definition until restart.
   */
  registerInMemory(type: string, name: string, data: unknown): void {
    if (!this.registry.has(type)) {
      this.registry.set(type, new Map());
    }
    this.registry.get(type)!.set(name, data);
    this.invalidateListCache(type);
  }

  /**
   * Get a metadata item by type and name.
   * Checks in-memory registry first, then falls back to loaders.
   *
   * Returns `undefined` both when nothing declares the item and when every
   * loader that could have held it FAILED — see {@link getDiagnosed} when the
   * caller must tell those apart. This is the same relationship {@link load}
   * has with {@link loadDiagnosed}, so every existing caller keeps its exact
   * behaviour and only callers that ASK for the verdict pay for it.
   *
   * Not expressed as `(await getDiagnosed(…)).data`, although that is what it
   * computes — and the reason has CHANGED, so do not read the duplication as a
   * standing constraint.
   *
   * [#5840] recorded the delegation as unsafe: it adds one `await` hop, and
   * `register-notifies-watchers.test.ts` went red on the delegating version, so
   * three lines were duplicated to hold the frame count fixed. [#6043] measured
   * that test and found it was pinning this method's microtask depth rather than
   * the ordering guarantee it named — `notifyWatchers` never awaits its handlers,
   * so a subscriber's `await get(…)` had simply been settling inside the
   * microtasks `await register(…)` yields. That case now asserts the ordering
   * synchronously against the registry and does not observe this method's frame
   * count at all; the whole `@objectstack/metadata` suite was re-measured on the
   * delegating version and stayed green.
   *
   * What survives is a plain, local reason: the registry hit is the hot path and
   * answering it without a second async frame is worth three lines. Nothing
   * external depends on the hop count any more. Consolidating the two into one
   * delegation is therefore a viable, deliberately un-taken change (#6043 was
   * test-scoped) — if you take it, note that `get()`'s callers outside this
   * package were never surveyed for timing sensitivity, only this package's
   * tests. Either way the two stay pinned to each other from the other side:
   * `get()` and `getDiagnosed().data` are asserted to agree on every case in
   * `metadata-manager-get-diagnosed.test.ts`.
   */
  async get(type: string, name: string): Promise<unknown | undefined> {
    // Check in-memory registry first
    const typeStore = this.registry.get(type);
    if (typeStore?.has(name)) {
      return typeStore.get(name);
    }

    // Fallback to loaders
    const result = await this.load(type, name);
    return result ?? undefined;
  }

  /**
   * `get`, plus whether the answer can be trusted as complete.
   *
   * [#5840] {@link loadDiagnosed} already computes this verdict — and `get()`
   * threw it away two hops later (`load` kept only `.data`, `get` turned that
   * `null` into `undefined`), so no caller of `get` could reach the one fact
   * ADR-0110 D3 exists to preserve: **a miss and an outage are different facts
   * with opposite security meanings.** A consumer that gates on a declaration
   * MUST NOT read `undefined` as "the author declared nothing" — an
   * availability failure would silently widen access (the REST `/actions`
   * fail-open branch, #3935) or make a positive claim about authorship from a
   * read that never happened (`code: null` in the layered read, #5707/#5532).
   *
   * This is the registry-first counterpart of {@link loadDiagnosed}, and that
   * difference is why callers of `get` cannot simply switch to `loadDiagnosed`:
   * doing so would skip the in-memory registry and change what they resolve.
   *
   * `degraded` is true when at least one loader threw AND nothing answered with
   * the item — never when the in-memory registry answered, because that answer
   * needed no loader. A clean miss (every loader answered, none had it) is NOT
   * degraded. The posture is deliberately conservative: with a loader down we
   * cannot prove the item is absent, so we decline to claim it is.
   */
  async getDiagnosed(
    type: string,
    name: string
  ): Promise<{ data: unknown | undefined; degraded: boolean; errors: string[] }> {
    // Check in-memory registry first — a hit here consulted no loader, so
    // there is nothing to be degraded about.
    const typeStore = this.registry.get(type);
    if (typeStore?.has(name)) {
      return { data: typeStore.get(name), degraded: false, errors: [] };
    }

    // Fallback to loaders, keeping the verdict this time.
    const { data, degraded, errors } = await this.loadDiagnosed(type, name);
    return { data: data ?? undefined, degraded, errors };
  }

  /**
   * List all metadata items of a given type.
   *
   * Best-effort by contract: a loader that cannot be read is reported once and
   * skipped ({@link reportLoaderReadFailure}), so this resolves with what the
   * reachable loaders hold rather than throwing.
   *
   * [#5253] Reads of one type are single-flight — concurrent callers join the
   * read already running instead of each walking every loader. What they are
   * promised, and what happens when a write lands mid-read, is the contract on
   * `inflightListReads`; what is memoized afterwards is the contract on
   * `listCache`.
   */
  async list(type: string): Promise<unknown[]> {
    return (await this.readList(type)).items;
  }

  /**
   * `list`, plus whether the answer can be trusted as complete.
   *
   * [#6504] The plural counterpart of {@link getDiagnosed}, and the same defect
   * one read over: `readListUncached` has computed this verdict since #5184 and
   * `list()` spent it entirely on a cache TTL, so a consumer receiving a short
   * set could not ask whether it was short because that is all anyone declared
   * or because a loader was down. {@link reportLoaderReadFailure}'s own message
   * says what that costs — "every list served from now on is a PARTIAL set
   * presented as a complete one, and the server keeps reporting healthy" — and
   * until this member existed that sentence was addressed to a log reader only,
   * because no caller had a way to ask.
   *
   * Sharper than the singular case rather than merely analogous: `list` is the
   * read whose answer carries a **count**, and a consumer restating
   * `items.length` as "this environment contains N items" makes a positive,
   * numeric claim about what an author declared out of a read that partly did
   * not happen.
   *
   * Reads through exactly the same cache and single-flight machinery `list()`
   * does — same entry, same TTLs, same in-flight join — so asking for the
   * verdict costs no extra loader walk, and `list()` and
   * `listDiagnosed().items` cannot drift: they are the same read, narrowed at
   * different points. `degraded` is true when at least one loader threw while
   * this set was assembled; unlike {@link getDiagnosed} it does NOT additionally
   * require that nothing answered, because a plural read that lost one loader is
   * partial even when the others answered plenty — which is the whole fact.
   */
  async listDiagnosed(type: string): Promise<ListReadResult> {
    const { items, degraded, errors } = await this.readList(type);
    return { items, degraded, errors };
  }

  /**
   * The cached / single-flight read behind {@link list} and
   * {@link listDiagnosed}.
   *
   * [#6504] Extracted so the two members are one read seen at two widths rather
   * than two implementations that have to be kept in agreement — the shape
   * `get`/`getDiagnosed` pay for with a duplicated body and a test pinning them
   * to each other. Everything below is unchanged in behaviour from when it was
   * inlined in `list()`; only the verdict now survives the return.
   */
  private async readList(type: string): Promise<ListReadResult> {
    // Short-TTL cache: see the field comment on `listCache` for what is
    // cached and for how long. Every completed read is memoized; a read that
    // lost a loader is memoized as `degraded` and expires ~15× sooner.
    const cached = this.readCachedList(type);
    if (cached) {
      return cached;
    }

    // [#5253] Cold cache, but not necessarily a cold read: join the walk
    // already in progress for this type rather than starting an identical one.
    const joined = this.inflightListReads.get(type);
    if (joined) {
      return joined;
    }

    // Registering the read is what permits it to memoize its own result —
    // `invalidateListCache()` retracts the registration, and both the cache
    // write and the cleanup below act only while the slot is still ours.
    const shared: Promise<ListReadResult> = this.readListUncached(type).then((result) => {
      // [#5184] The degraded verdict of a SHARED read is the degraded verdict
      // of the read: sharing must not become a back door that lands a
      // known-partial answer on the 30s healthy TTL. Every sharer received
      // this same set, and it is memoized as what it is.
      // [#5253] Skipped when an invalidation crossed this read, so a write
      // that landed mid-read is never re-buried under the pre-write answer.
      if (this.inflightListReads.get(type) === shared) {
        this.cacheListResult(type, result);
      }
      return result;
    });
    this.inflightListReads.set(type, shared);

    try {
      return await shared;
    } finally {
      // Retract only our OWN registration: an invalidation may have already
      // dropped it and a fresh read may own the slot now — deleting that one
      // would let a third read start against the same window.
      if (this.inflightListReads.get(type) === shared) {
        this.inflightListReads.delete(type);
      }
    }
  }

  /**
   * Assemble the `list()` answer for `type` from the in-memory registry plus
   * every loader, reporting (but not rethrowing) loaders that could not be
   * read.
   *
   * The body {@link list} used to inline, extracted so the caching and
   * single-flight bookkeeping around it has one thing to run at most once per
   * type (#5253). Deliberately does NOT touch `listCache` itself: whether this
   * result may be memoized depends on what happened to the read's registration
   * while it ran, which only `list()` can see.
   */
  private async readListUncached(type: string): Promise<ListReadResult> {
    const items = new Map<string, unknown>();

    // From in-memory registry
    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const [name, data] of typeStore) {
        items.set(name, data);
      }
    }

    // From loaders (deduplicate). [#5184] `degraded` records whether this
    // particular read lost a loader, so the memoized answer carries the fact
    // that it is known-partial instead of being indistinguishable from a
    // complete one.
    // [#6504] `errors` records WHICH loaders were lost and why. The messages
    // were already being produced here and handed only to the logger — which
    // speaks once per outage episode, so a consumer arriving mid-outage finds
    // nothing to read. Collected per read (not once per episode) because this
    // describes THIS answer, and it is what {@link listDiagnosed} reports
    // alongside the set.
    let degraded = false;
    const errors: string[] = [];
    for (const loader of this.loaders.values()) {
      try {
        const loaderItems = await loader.loadMany(type);
        for (const item of loaderItems) {
          const itemAny = item as any;
          if (itemAny && typeof itemAny.name === 'string' && !items.has(itemAny.name)) {
            items.set(itemAny.name, item);
          }
        }
        this.reportLoaderReadRecovered(loader.contract.name);
      } catch (e) {
        degraded = true;
        errors.push(`${loader.contract.name}: ${e instanceof Error ? e.message : String(e)}`);
        this.reportLoaderReadFailure(loader.contract.name, type, e);
      }
    }

    return { items: Array.from(items.values()), degraded, errors };
  }

  /**
   * Report — at `error`, once per outage episode — that a loader could not be
   * read while serving {@link list}.
   *
   * [#5108] This branch used to be dead for the loader that matters. Before
   * #5108 `DatabaseLoader` caught its own read failures and answered `[]`, so
   * `list()` received a *successful empty read* and never entered this `catch`
   * at all: an unreachable `sys_metadata` and "this environment declares no
   * `permission`" produced byte-identical results with not one line logged.
   * With the loader rethrowing everything but the benign not-provisioned case,
   * this is where the outage finally becomes speakable.
   *
   * `error`, not `warn`, per AGENTS.md → "Degradation log levels". Apply its
   * one question — *does the system still look normal from outside while
   * something it claims to know has not actually landed?* — and the answer is
   * yes: `list()` still returns, callers still get an array, nothing 500s, and
   * the set they gate on is quietly short. Which way that cuts depends on the
   * consumer, and both ways are silent (#3935 is the fail-open precedent).
   *
   * Said **once** per loader, and un-said on recovery, because `list()` is a
   * hot path — one line per outage, not one per read.
   *
   * [#5184] The once-only guard carries more weight than it used to: a
   * degraded `list()` result is now memoized for `DEGRADED_LIST_CACHE_TTL_MS`
   * rather than `LIST_CACHE_TTL_MS`, so during an outage the loader is
   * re-asked (and this method re-entered) roughly every 2s instead of every
   * 30s. That is the point — the outage stops being a 30s silent window and
   * recovery is noticed within seconds — and it costs nothing in log volume
   * precisely because `loaderReadFailureReported` still speaks only once.
   *
   * Deliberately does NOT rethrow: `list()` is the best-effort listing seam and
   * must keep serving what the reachable loaders hold. The strict counterpart
   * for callers whose answer is a security decision is `listForIndex()` (no
   * `catch`, feeding `matchEndpoint`) and {@link loadDiagnosed} (ADR-0110 D3)
   * for the singular read — both of which only became honest for
   * `DatabaseLoader` with the same #5108 change.
   */
  private reportLoaderReadFailure(loaderName: string, type: string, error: unknown): void {
    if (this.loaderReadFailureReported.has(loaderName)) return;
    this.loaderReadFailureReported.add(loaderName);
    this.logger.error(
      `[MetadataManager] Loader \`${loaderName}\` could NOT be read (first failure seen while listing \`${type}\`) — ` +
        `every list served from now on is a PARTIAL set presented as a complete one, and the server keeps reporting healthy. ` +
        `Consumers that gate on a declared set (permissions, sharing rules, policies, api endpoints) will read the ` +
        `declarations this loader holds as "never declared" — which grants or locks out depending on the consumer, silently either way. ` +
        `Fix: check the datasource behind \`${loaderName}\` — connection, credentials, and that its metadata table exists. ` +
        `The read is retried on the next list once the ${MetadataManager.DEGRADED_LIST_CACHE_TTL_MS}ms degraded-result list cache lapses ` +
        `(a known-partial listing is memoized far more briefly than a complete one — #5184), so a transient cause recovers on its ` +
        `own within seconds and the recovery is logged.`,
      error instanceof Error ? error : undefined,
      { loader: loaderName, type, error },
    );
  }

  /** Un-say {@link reportLoaderReadFailure} once the loader answers again. */
  private reportLoaderReadRecovered(loaderName: string): void {
    if (!this.loaderReadFailureReported.delete(loaderName)) return;
    this.logger.info(
      `[MetadataManager] Loader \`${loaderName}\` is readable again — listings are complete once more.`,
    );
  }

  /**
   * Memoize a completed {@link list} result.
   *
   * [#5184] `degraded` is not optional at the call site by accident — it is the
   * one thing this cache used to throw away. A result assembled while a loader
   * was unreadable is stored, but stored *as* what it is, so it expires on the
   * degraded TTL and any reader can tell it apart from a complete answer.
   *
   * [#6504] Takes the whole read result rather than its parts for the same
   * reason: a signature that spreads the verdict across positional arguments is
   * one a later caller can quietly fill with `false`, which is how the verdict
   * was lost on the way out in the first place.
   */
  private cacheListResult(type: string, result: ListReadResult): void {
    this.listCache.set(type, { ts: Date.now(), ...result });
  }

  /**
   * Read a still-fresh {@link listCache} entry, or `undefined` when there is
   * none / it has expired.
   *
   * [#5184] The single place the TTL policy is applied, so "a degraded entry
   * expires sooner" cannot be forgotten by a second reader. Returns the whole
   * entry rather than just `items` so callers keep access to `degraded`.
   */
  private readCachedList(type: string): ListCacheEntry | undefined {
    const cached = this.listCache.get(type);
    if (!cached) return undefined;
    const ttl = cached.degraded
      ? MetadataManager.DEGRADED_LIST_CACHE_TTL_MS
      : MetadataManager.LIST_CACHE_TTL_MS;
    return Date.now() - cached.ts < ttl ? cached : undefined;
  }

  /**
   * Internal helper: drop every memoized or in-progress `list()` answer for a
   * type, so the next read observes the write that called this.
   *
   * [#5253] Retracting the in-flight read (not just the finished entry) is the
   * whole mid-read story, and it is pinned by test: the read keeps running for
   * the callers already waiting on it, but it loses the right to memoize its
   * pre-write answer, and a caller arriving after this point gets a fresh read
   * instead of joining a pre-write one. The reasoning — including why waiting
   * callers are NOT restarted — is on the `inflightListReads` field.
   *
   * [#5259] Both halves are only as good as WHEN the caller invokes this. This
   * clears what is stale *as of now*; it cannot pre-empt a store the caller has
   * not finished updating yet. Callers must therefore invalidate only once
   * every store already holds the state they are about to announce — see the
   * `listCache` field comment and {@link unregister}, whose pre-#5259 ordering
   * invalidated one await too early and let the next read cache a view in which
   * the registry was empty and the loader was not.
   */
  private invalidateListCache(type: string): void {
    this.listCache.delete(type);
    this.inflightListReads.delete(type);
    // [#5089] The endpoint index is a cache of the same stored set, so it goes
    // stale under exactly the same conditions. Hooking here (rather than only
    // on the watcher) is what covers the `{ notify: false }` writes — artifact
    // ingest and HMR reload — which never announce to a subscriber.
    if (type === MetadataManager.ENDPOINT_METADATA_TYPE) {
      this.endpointMatcher.invalidate();
    }
  }

  /**
   * Enumerate stored items of `type` for an index build — like {@link list},
   * but a store that cannot be read THROWS instead of contributing nothing.
   *
   * [#5089] `list()` deliberately logs a failing loader and skips it so a
   * partially-available metadata plane still serves what it can. That posture
   * is wrong for `matchEndpoint`: its `undefined` becomes an HTTP 404, and a
   * store outage that silently yields "zero declarations" would turn every
   * declared endpoint into a semantic "nothing declares this route". Same
   * distinction {@link loadDiagnosed} draws on the singular read (ADR-0110
   * D3) — a miss and an outage are different facts with opposite meanings.
   *
   * Deliberately private and single-purpose: it is not a second `list()`, it
   * is `list()`'s failure posture inverted for the one caller whose answer is
   * a security/availability decision rather than a best-effort listing.
   *
   * This surfaces only failures a loader actually reports — which, since
   * #5108, includes `DatabaseLoader`: it used to swallow its own read errors
   * into `[]`, making a DB outage invisible even here. It now rethrows every
   * read failure except the benign "table not provisioned yet", so this seam
   * holds against the real datasource-backed loader and not just the memory /
   * remote ones. (`database-loader.test.ts` pins that end to end: a broken
   * driver behind a real `DatabaseLoader` makes `matchEndpoint` reject rather
   * than answer a 404-shaped `undefined`.)
   */
  private async listForIndex(type: string): Promise<unknown[]> {
    const items = new Map<string, unknown>();

    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const [name, data] of typeStore) {
        items.set(name, data);
      }
    }

    for (const loader of this.loaders.values()) {
      // No try/catch, on purpose — see the doc comment above.
      const loaderItems = await loader.loadMany(type);
      for (const item of loaderItems) {
        const itemAny = item as { name?: unknown };
        if (itemAny && typeof itemAny.name === 'string' && !items.has(itemAny.name)) {
          items.set(itemAny.name, item);
        }
      }
    }

    return Array.from(items.values());
  }

  /**
   * Unregister/remove a metadata item by type and name.
   * Deletes from database-backed loaders only (same rationale as register()).
   *
   * Announces the removal to {@link subscribe} watchers as a `deleted`
   * {@link MetadataWatchEvent} — the delete half of the {@link register}
   * contract. Pass `{ notify: false }` only for teardown that announces by
   * other means.
   *
   * ## [#5259] Storage FIRST, in-memory second — the order is the fix
   *
   * This method used to drop the registry entry and call
   * {@link invalidateListCache} *before* awaiting `loader.delete()`. Those two
   * steps are separated by a real await window (one DB round-trip per writable
   * loader), and inside it the manager was in a state that exists nowhere else:
   * **registry already empty, loader not yet empty**. `list()` merges the two,
   * so a read arriving in that window
   *
   *   • missed the cache (it had just been invalidated),
   *   • assembled the still-stored row into its answer, and
   *   • memoized that answer as a COMPLETE read — the full 30s healthy TTL,
   *     because no loader threw, so #5184's 2s degraded TTL never applied.
   *
   * Nothing invalidated again afterwards ({@link notifyWatchers} does not touch
   * `listCache`), so a row that was gone from storage kept being enumerated for
   * up to 30s — and `get()`, which never consulted that cache, disagreed with
   * `list()` the whole time. For a gating type (`permission`, `api`) the two
   * faces of the same manager answered opposite questions about whether a
   * declaration exists.
   *
   * {@link register} never had this defect, and the reason is instructive: it
   * writes the registry *first*, and the registry outranks every loader in the
   * merge, so throughout its own save window the merged view already equals the
   * post-write state. The invariant that makes register correct is not "where
   * the invalidate sits" but **the invalidate must be the last thing after
   * every store already holds the announced state**. Restated for delete, that
   * means storage first:
   *
   *   1. `await loader.delete()` on every writable loader. Throughout this
   *      window registry AND loaders still hold the item, so a concurrent
   *      `list()` observes a coherent pre-delete state — which is the truth,
   *      because the delete has not landed and has not been announced.
   *   2. Drop the registry entry and `invalidateListCache(type)` — with **no
   *      await between them**, so no read can interleave and observe the
   *      half-applied state that produced the bug. Everything cached or
   *      in-flight from step 1 is dropped here, at the moment the final state
   *      becomes true.
   *   3. Publish + announce. #5219's invalidate-before-notify bar, unchanged:
   *      a watcher woken by the `deleted` event and re-reading through `list()`
   *      gets a fresh read of the post-delete state.
   *
   * **Composition with #5253's single-flight (this is the load-bearing half).**
   * A `list()` that is still walking the loaders when step 2 runs cannot be
   * fixed by dropping `listCache` alone — it has not written its entry yet, and
   * it would write the pre-delete answer *after* the invalidation. The
   * mechanism that covers it is `invalidateListCache()` also retracting the
   * read's registration in `inflightListReads`: a retracted read still resolves
   * for the callers already waiting on it (they asked before the delete) but
   * loses the right to memoize, and any caller arriving after step 2 starts a
   * fresh read rather than joining the pre-delete one. So every read is
   * covered: one that FINISHED in the window has its entry deleted, one still
   * IN FLIGHT loses its permission to cache, and one starting later reads the
   * post-delete state. That is why the invalidate must come after the deletes
   * rather than being duplicated on both sides of them — a second invalidate
   * before the await would buy nothing and would re-open step 1's window.
   */
  async unregister(type: string, name: string, options?: MetadataWriteOptions): Promise<void> {
    // ── 1. Storage first ────────────────────────────────────────────────
    // Delete only from database-backed loaders that declare write capability.
    for (const loader of this.loaders.values()) {
      if (loader.contract.protocol !== 'datasource:' || !loader.contract.capabilities.write) continue;
      // [#5276] Defensive only — unreachable for a registered loader. This exact
      // combination (`datasource:` + `capabilities.write`, no `delete`) is
      // rejected by `registerLoader()`, the sole writer of `this.loaders`, so
      // reaching this `continue` would mean a loader entered the map without
      // passing the gate. Kept because the alternative is a TypeError on the
      // line below, and because `delete?` stays optional on the interface for
      // the protocols the gate does not cover.
      if (typeof loader.delete !== 'function') continue;
      try {
        await this.deleteMetaItemFromLoader(loader, type, name);
      } catch (error) {
        this.reportMetaItemDeleteFailure(loader.contract.name, type, name, error);
      }
    }

    // ── 2. In-memory state, then invalidation — nothing awaited between ──
    const typeStore = this.registry.get(type);
    if (typeStore) {
      typeStore.delete(name);
      if (typeStore.size === 0) {
        this.registry.delete(type);
      }
    }
    this.invalidateListCache(type);

    // ── 3. Announce ─────────────────────────────────────────────────────
    // Publish metadata.{type}.deleted event to realtime service
    await this.publishRealtimeMetadataEvent('deleted', type, name, {
      userId: options?.userId,
    });

    // Announce last, once the removal has landed everywhere (see register()).
    if (options?.notify !== false) {
      this.notifyWatchers(type, {
        type: 'deleted',
        metadataType: type,
        name,
        path: '',
        data: undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete one metadata item from one writable loader — the storage half of
   * {@link unregister}.
   *
   * A one-line wrapper on purpose: it gives this durability seam a **name**.
   * `check:durability-log-level` matches by callee name against an explicit
   * vocabulary, and the raw call is `loader.delete(...)` — putting `delete` in
   * that vocabulary would claim every `.delete()` in the monorepo (`Map`,
   * `Set`, cache handles, `URLSearchParams`) and the gate would drown in false
   * positives, which is exactly the failure mode its own header warns about.
   * Named here, `deleteMetaItemFromLoader` is in `DURABILITY_CRITICAL_CALLEES`
   * with a blast radius of precisely this call site, mirroring `saveMetaItem`
   * on the write side (#4754).
   *
   * [#5276] `MetadataLoader` now declares `delete?`, so no cast is left here.
   * It stays *optional* on the interface — `file:`/`memory:`/`http:`/`s3:`
   * loaders legitimately have none — and the guard below is therefore a type
   * narrowing rather than a policy decision. The policy lives at
   * `registerLoader()`: a `datasource:` loader that declares
   * `capabilities.write` cannot be registered without a `delete()`, which is
   * exactly the set of loaders this method is ever called for.
   */
  private async deleteMetaItemFromLoader(
    loader: MetadataLoader,
    type: string,
    name: string,
  ): Promise<void> {
    const del = loader.delete;
    if (typeof del !== 'function') return;
    await del.call(loader, type, name);
  }

  /**
   * Report — at `error` — that a loader refused to delete an item the runtime
   * has already dropped and announced as deleted.
   *
   * [#5259] This used to be a `logger.warn('Failed to delete …')` and continue.
   * AGENTS.md → "Degradation log levels" decides the level with one question:
   * *after the degradation, does the system still look normal from the outside
   * while something it claims is persisted has not actually landed?* Here it is
   * the deletion that did not land, which is the same class and the same
   * silence: `unregister()` resolves normally, the caller is told the delete
   * succeeded, and the surviving row is read straight back out of storage —
   * permanently, since nothing ever retries this. Durability/consistency
   * degradation ⇒ `error`, naming the **consequence** and the **fix**.
   *
   * **Why the registry entry is still dropped when this fires.** The
   * alternative — keep the item registered so runtime state matches storage —
   * looks safer and is not. The loader still holds the row, and `list()`/`get()`
   * merge registry ∪ loaders, so the item is served either way; the only thing
   * the surviving registry entry would change is *which copy wins*, pinning an
   * in-memory definition that outranks the stored row nobody is maintaining
   * anymore. Dropping it makes the very next read fall through to storage,
   * which is the actual truth after a failed delete — the item still exists —
   * and it surfaces that immediately (the item visibly reappears) instead of at
   * the next restart. One truth, read from where it lives; the divergence is
   * reported here rather than papered over with a second in-memory copy.
   *
   * **Said once per un-deleted item, not once per loader.** The once-per-outage
   * discipline of {@link reportLoaderReadFailure} exists because `list()` is hot
   * and its repeats are *identical*; these are not. Each line names a different
   * item that is still in storage and that nothing will ever retry, so
   * collapsing them would hand an operator the first casualty and silently drop
   * the rest of the list — the failure this level was raised to prevent.
   */
  private reportMetaItemDeleteFailure(
    loaderName: string,
    type: string,
    name: string,
    error: unknown,
  ): void {
    this.logger.error(
      `[MetadataManager] Loader \`${loaderName}\` could NOT delete \`${type}/${name}\` — the row is STILL in its store, ` +
        `while the runtime has already dropped the item from its registry and announced it as deleted. ` +
        `Nothing looks broken: \`unregister()\` resolves normally and the caller (Studio/Setup, REST DELETE, the CLI, a package teardown) ` +
        `is told the delete succeeded — but the surviving row is read straight back out of storage by the very next \`list()\`/\`get()\`, ` +
        `so the "deleted" item reappears and keeps reappearing across restarts. Nothing retries this delete. ` +
        `Fix: check the datasource behind \`${loaderName}\` — connection, credentials, and that its metadata table exists and is writable — ` +
        `then re-issue the delete for \`${type}/${name}\`. Until that succeeds the item is NOT deleted, whatever the delete call reported.`,
      error instanceof Error ? error : undefined,
      { loader: loaderName, type, name, error },
    );
  }

  /**
   * Check if a metadata item exists
   */
  async exists(type: string, name: string): Promise<boolean> {
    // Check in-memory registry
    if (this.registry.get(type)?.has(name)) {
      return true;
    }

    // Check loaders
    for (const loader of this.loaders.values()) {
      if (await loader.exists(type, name)) {
        return true;
      }
    }
    return false;
  }

  /**
   * List all names of metadata items of a given type
   */
  async listNames(type: string): Promise<string[]> {
    const names = new Set<string>();

    // From in-memory registry
    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const name of typeStore.keys()) {
        names.add(name);
      }
    }

    // From loaders
    for (const loader of this.loaders.values()) {
      const result = await loader.list(type);
      result.forEach(item => names.add(item));
    }

    return Array.from(names);
  }

  /**
   * Convenience: get an object definition by name
   */
  async getObject(name: string): Promise<unknown | undefined> {
    return this.get('object', name);
  }

  /**
   * Convenience: list all object definitions
   */
  async listObjects(): Promise<unknown[]> {
    return this.list('object');
  }

  // ==========================================
  // Convenience: UI Metadata
  // ==========================================

  /**
   * Convenience: get a view definition by name
   */
  async getView(name: string): Promise<unknown | undefined> {
    return this.get('view', name);
  }

  /**
   * Convenience: list view definitions, optionally filtered by object
   */
  async listViews(object?: string): Promise<unknown[]> {
    const views = await this.list('view');
    if (object) {
      return views.filter((v: any) => v?.object === object);
    }
    return views;
  }

  /**
   * List the independent ViewItems bound to an object, sorted for the runtime
   * view switcher / Studio left rail ("Object has-many View").
   *
   * Returns only expanded ViewItems (those carrying a `viewKind`) — never the
   * legacy aggregated container kept under the bare `<object>` key — so callers
   * get exactly one entry per named view. Sorted by `order`, then `name`.
   *
   * Runtime-authored `shared` / `personal` views (`sys_view_definition`) are
   * merged in by the REST layer; this method returns the `package` layer that
   * was registered from source.
   */
  async getViewsByObject(object: string): Promise<unknown[]> {
    const views = await this.list('view');
    return views
      .filter(
        (v: any) =>
          v && typeof v === 'object' && v.viewKind && v.object === object,
      )
      .sort(
        (a: any, b: any) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          String(a.name).localeCompare(String(b.name)),
      );
  }

  /**
   * Convenience: get a dashboard definition by name
   */
  async getDashboard(name: string): Promise<unknown | undefined> {
    return this.get('dashboard', name);
  }

  /**
   * Convenience: list all dashboard definitions
   */
  async listDashboards(): Promise<unknown[]> {
    return this.list('dashboard');
  }

  // ==========================================
  // Package Management
  // ==========================================

  /**
   * Unregister all metadata items from a specific package
   */
  async unregisterPackage(packageName: string): Promise<void> {
    // Collect all items to delete (type and name pairs)
    const itemsToDelete: Array<{ type: string; name: string }> = [];

    for (const [type, typeStore] of this.registry) {
      for (const [name, data] of typeStore) {
        const meta = data as any;
        if (meta?.packageId === packageName || meta?.package === packageName) {
          itemsToDelete.push({ type, name });
        }
      }
    }

    // Delete each item using unregister() to ensure deletion from both registry and loaders
    for (const { type, name } of itemsToDelete) {
      await this.unregister(type, name);
    }
  }

  /**
   * Publish an entire package:
   * 1. Validate all draft items
   * 2. Snapshot all items in the package (publishedDefinition = clone(metadata))
   * 3. Increment version
   * 4. Set all items state → active
   *
   * [#5189, #5040 E7b] Step 1 additionally runs the **endpoint publish gates**
   * over every `api` item — see {@link gateApiItemsForPublish}. That pass is
   * NOT governed by `options.validate`: the gates are a contract, not a
   * lint (ADR-0121 D6 says publish REJECTS an unmetered anonymous endpoint),
   * and an opt-out flag on a security gate is the bypass this issue closed.
   */
  async publishPackage(packageId: string, options?: {
    changeNote?: string;
    publishedBy?: string;
    validate?: boolean;
    /**
     * [#5189] The package manifest's EXPLICIT `manifest.namespace` (ADR-0121
     * D2), supplied by a caller that holds the manifest.
     *
     * `MetadataManager` has no manifest concept — it indexes items by
     * `packageId` and nothing else — so it cannot prove a namespace on its
     * own, and an `api` item's own `namespace`-ish fields are author-supplied
     * data, not identity (reading them would make the D1/D2 carve-out gate
     * vacuous: an author would simply declare the namespace their path
     * already uses). Absent this option the namespace gate fails and `api`
     * items in the package cannot publish through this path — which is the
     * correct outcome, not a limitation to route around: a publish that
     * cannot prove a namespace must not mint a URL under one.
     */
    namespace?: string;
  }): Promise<PackagePublishResult> {
    const now = new Date().toISOString();
    const shouldValidate = options?.validate !== false;
    const publishedBy = options?.publishedBy;

    // Collect all items belonging to this package
    const packageItems: Array<{ type: string; name: string; data: any }> = [];
    for (const [type, typeStore] of this.registry) {
      for (const [name, data] of typeStore) {
        const meta = data as any;
        if (meta?.packageId === packageId || meta?.package === packageId) {
          packageItems.push({ type, name, data: meta });
        }
      }
    }

    if (packageItems.length === 0) {
      return {
        success: false,
        packageId,
        version: 0,
        publishedAt: now,
        itemsPublished: 0,
        validationErrors: [{ type: '', name: '', message: `No metadata items found for package '${packageId}'` }],
      };
    }

    const validationErrors: Array<{ type: string; name: string; message: string }> = [];

    // [#5189, #5040 E7b] Endpoint publish gates — ALWAYS, `validate: false`
    // included. Every other check in this method is a best-effort quality
    // check whose opt-out is a convenience; these gates decide whether an
    // externally reachable, possibly ANONYMOUS execution entry point comes
    // into existence, and ADR-0121 D6 has no runtime counterpart to catch what
    // slips through. A flag that turns them off would be exactly the bypass
    // #5189 filed.
    validationErrors.push(...this.gateApiItemsForPublish(packageItems, options?.namespace));

    // Validation pass
    if (shouldValidate) {
      // Schema validation
      for (const item of packageItems) {
        const result = await this.validate(item.type, item.data);
        if (!result.valid && result.errors) {
          for (const err of result.errors) {
            validationErrors.push({
              type: item.type,
              name: item.name,
              message: err.message,
            });
          }
        }
      }

      // Dependency validation: referenced items must be in the same package or already published
      const packageItemKeys = new Set(packageItems.map(i => `${i.type}:${i.name}`));
      for (const item of packageItems) {
        const deps = await this.getDependencies(item.type, item.name);
        for (const dep of deps) {
          const depKey = `${dep.targetType}:${dep.targetName}`;
          // Skip if the dependency is within this package
          if (packageItemKeys.has(depKey)) continue;
          // Check if the dependency exists and has been published
          const depItem = await this.get(dep.targetType, dep.targetName);
          if (!depItem) {
            validationErrors.push({
              type: item.type,
              name: item.name,
              message: `Dependency '${dep.targetType}:${dep.targetName}' not found`,
            });
          } else {
            const depMeta = depItem as any;
            if (depMeta.publishedDefinition === undefined && depMeta.state !== 'active') {
              validationErrors.push({
                type: item.type,
                name: item.name,
                message: `Dependency '${dep.targetType}:${dep.targetName}' is not published`,
              });
            }
          }
        }
      }
    }

    if (validationErrors.length > 0) {
      return {
        success: false,
        packageId,
        version: 0,
        publishedAt: now,
        itemsPublished: 0,
        validationErrors,
      };
    }

    // Determine the next version by finding the max current version across items
    let maxVersion = 0;
    for (const item of packageItems) {
      const v = typeof item.data.version === 'number' ? item.data.version : 0;
      if (v > maxVersion) maxVersion = v;
    }
    const newVersion = maxVersion + 1;

    // Snapshot and update all items
    for (const item of packageItems) {
      const updated = {
        ...item.data,
        publishedDefinition: structuredClone(item.data.metadata ?? item.data),
        publishedAt: now,
        publishedBy: publishedBy ?? item.data.publishedBy,
        version: newVersion,
        state: 'active',
      };
      await this.register(item.type, item.name, updated);
    }

    return {
      success: true,
      packageId,
      version: newVersion,
      publishedAt: now,
      itemsPublished: packageItems.length,
    };
  }

  /**
   * [#5189, #5040 E7b] Run the endpoint publish gates over a package's `api`
   * items and report every failure as a publish-blocking validation error.
   *
   * ## Why this exists at all
   *
   * E7 (#5111) hung the five per-endpoint gates on
   * `ObjectStackDefinitionSchema`, which covers every path that parses a
   * STACK — `defineStack`, `os validate`, the lint scorer, artifact ingest,
   * `EnvironmentArtifactSchema.metadata`. It does not cover this one: an `api`
   * item can be minted item-by-item (`metadata.register()`, a Studio write)
   * and published here without a stack ever being parsed. Three of the gates
   * degrade safely when bypassed (the executor answers a structured 501; a
   * mis-namespaced path matches nothing), but **ADR-0121 D6 has no runtime
   * counterpart**: `authRequired: false` is honoured faithfully and an
   * unarmed `rateLimit` meters nothing, so the bypass mints an anonymous,
   * zero-quota execution entry point. Hence a gate here, on the same
   * function, rather than a second set of criteria that would drift.
   *
   * ## What it judges, and on what
   *
   * The registry stores either a raw spec document or a publish envelope
   * (`{ name, packageId, state, metadata: {…spec} }`), and in BOTH shapes the
   * row carries the metadata layer's bookkeeping. [#5309] The envelope is
   * peeled off first (`peelStoredEnvelope`) and the gate judges the authored
   * BODY: the wrapped half of that peel is the `data.metadata ?? data` rule
   * this method used to spell inline — the same document `publishedDefinition`
   * snapshots — and the flat half additionally removes `packageId` / `state` /
   * `version` / `published*`, which are storage identity, never endpoint
   * vocabulary. (What publish SNAPSHOTS is unchanged: `publishedDefinition`
   * still stores `data.metadata ?? data` verbatim, envelope included, because
   * `revertPackage` restores from it.) An item whose body does not satisfy
   * `ApiEndpointSchema` fails here too — not extra strictness but a
   * precondition: an unparsed shape cannot be gated, and it could never be
   * served either (the matcher's own loud skip refuses it at load).
   *
   * @param packageItems every item collected for this package (all types).
   * @param namespace the caller-supplied `manifest.namespace`; `undefined`
   *   fails the namespace gate, deliberately — see `publishPackage`'s option.
   * @returns one entry per gate failure, `[]` when the package declares no
   *   `api` items (a package without endpoints is untouched by this pass).
   */
  private gateApiItemsForPublish(
    packageItems: Array<{ type: string; name: string; data: any }>,
    namespace: string | undefined,
  ): Array<{ type: string; name: string; message: string }> {
    const apiItems = packageItems.filter(i => i.type === MetadataManager.ENDPOINT_METADATA_TYPE);
    if (apiItems.length === 0) return [];

    const errors: Array<{ type: string; name: string; message: string }> = [];
    /** Parsed endpoints, index-aligned with the items that produced them. */
    const endpoints: ApiEndpoint[] = [];
    const gatedItems: Array<{ name: string }> = [];

    for (const item of apiItems) {
      // [#5309] Envelope OFF before the body parse — the same peel the load-time
      // backstop applies (`buildEndpointIndex`), so the two doors judge the same
      // document. The wrapped half of the rule is the `data.metadata ?? data`
      // this line used to spell inline; the flat half additionally takes off the
      // bookkeeping (`packageId`, `state`, …) that shares a level with the body.
      const { body } = peelStoredEnvelope(item.data);
      const parsed = ApiEndpointSchema.safeParse(body);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({
            type: item.type,
            name: item.name,
            message:
              `api item '${item.name}' does not satisfy ApiEndpointSchema and cannot be published: `
              + `${issue.message} (at ${issue.path.join('.') || '<root>'}). An endpoint that does not `
              + `parse cannot be gated and would be excluded from endpoint matching at load anyway.`,
          });
        }
        continue;
      }
      endpoints.push(parsed.data);
      gatedItems.push({ name: item.name });
    }

    for (const issue of validateApiEndpointDeclarations(endpoints, { namespace })) {
      // The gate reports per-endpoint issues at `['apis', <index>, …]` and the
      // namespace PRECONDITION once at `['apis']` — the latter is a property of
      // the publish call, not of any one endpoint, so it is reported once with
      // this path's own remedy appended.
      const index = typeof issue.path[1] === 'number' ? issue.path[1] : undefined;
      if (index === undefined) {
        errors.push({
          type: MetadataManager.ENDPOINT_METADATA_TYPE,
          name: '',
          message: `${issue.message} ${PUBLISH_NAMESPACE_REMEDY}`,
        });
        continue;
      }
      errors.push({
        type: MetadataManager.ENDPOINT_METADATA_TYPE,
        name: gatedItems[index]?.name ?? '',
        message: issue.message,
      });
    }

    return errors;
  }

  /**
   * Revert entire package to last published state.
   * Restores all metadata definitions from their published snapshots.
   */
  async revertPackage(packageId: string): Promise<void> {
    const packageItems: Array<{ type: string; name: string; data: any }> = [];
    for (const [type, typeStore] of this.registry) {
      for (const [name, data] of typeStore) {
        const meta = data as any;
        if (meta?.packageId === packageId || meta?.package === packageId) {
          packageItems.push({ type, name, data: meta });
        }
      }
    }

    // [#7559] ADR-0112 — both refusals below carry a DECLARED `code` + `status`.
    // They are the ordinary answers to an ordinary request (revert a package id
    // that this environment has nothing for, or has never published), and a
    // route that cannot serve the request must answer a declared 4xx.
    //
    // This is the WHOLE cause of the 500 the QA run saw from
    // `POST /packages/:id/revert`, measured rather than assumed: that route's
    // handler already wraps its entire body in one
    // `try { … } catch (e) { errorFromThrown(e, 500) }`, and `errorFromThrown`
    // reads `status` / `code` off the error — falling back to 500 only when it
    // finds neither, which is exactly what a bare `Error` offers. Nothing was
    // wrong with the route; the thrown shape was. (The first reading of #7559
    // was that the route needed its own `catch`; reverse verification showed
    // that change was inert, so it is not in this fix.)
    //
    // Both codes come from the ADR-0112 STANDARD catalog rather than the
    // extension ledger: the ledger's own rule is that a generic condition (not
    // found / conflict) uses the standard catalog instead of registering a
    // synonym.
    if (packageItems.length === 0) {
      const err = new Error(
        `No metadata items found for package '${packageId}'`,
      ) as Error & { code?: string; status?: number };
      err.code = 'RESOURCE_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Check that at least one item has a published snapshot
    const hasPublished = packageItems.some(item => item.data.publishedDefinition !== undefined);
    if (!hasPublished) {
      const err = new Error(
        `Package '${packageId}' has never been published`,
      ) as Error & { code?: string; status?: number };
      err.code = 'RESOURCE_CONFLICT';
      err.status = 409;
      throw err;
    }

    for (const item of packageItems) {
      if (item.data.publishedDefinition !== undefined) {
        const reverted = {
          ...item.data,
          metadata: structuredClone(item.data.publishedDefinition),
          state: 'active',
        };
        await this.register(item.type, item.name, reverted);
      }
    }
  }

  /**
   * Get the published version of any metadata item (for runtime serving).
   * Returns publishedDefinition if exists, else current definition.
   */
  async getPublished(type: string, name: string): Promise<unknown | undefined> {
    const item = await this.get(type, name);
    if (!item) return undefined;

    const meta = item as any;
    if (meta.publishedDefinition !== undefined) {
      return meta.publishedDefinition;
    }

    // Fall back to current definition (metadata field or the item itself)
    return meta.metadata ?? item;
  }

  // ==========================================
  // Query / Search
  // ==========================================

  /**
   * Query metadata items with filtering, sorting, and pagination
   */
  async query(query: MetadataQuery): Promise<MetadataQueryResult> {
    const { types, search, page = 1, pageSize = 50, sortBy = 'name', sortOrder = 'asc' } = query;

    // Collect all items
    const allItems: Array<{
      type: string;
      name: string;
      namespace?: string;
      label?: string;
      scope?: 'system' | 'platform' | 'user';
      state?: 'draft' | 'active' | 'archived' | 'deprecated';
      packageId?: string;
      updatedAt?: string;
    }> = [];

    // Determine which types to scan
    const targetTypes = types && types.length > 0
      ? types
      : Array.from(this.registry.keys());

    for (const type of targetTypes) {
      const items = await this.list(type);
      for (const item of items) {
        const meta = item as any;
        allItems.push({
          type,
          name: meta?.name ?? '',
          namespace: meta?.namespace,
          label: meta?.label,
          scope: meta?.scope,
          state: meta?.state,
          packageId: meta?.packageId,
          updatedAt: meta?.updatedAt,
        });
      }
    }

    // Apply search filter
    let filtered = allItems;
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchLower) ||
        (item.label && item.label.toLowerCase().includes(searchLower))
      );
    }

    // Apply scope filter
    if (query.scope) {
      filtered = filtered.filter(item => item.scope === query.scope);
    }

    // Apply state filter
    if (query.state) {
      filtered = filtered.filter(item => item.state === query.state);
    }

    // Apply namespace filter
    if (query.namespaces && query.namespaces.length > 0) {
      filtered = filtered.filter(item => item.namespace && query.namespaces!.includes(item.namespace));
    }

    // Apply packageId filter
    if (query.packageId) {
      filtered = filtered.filter(item => item.packageId === query.packageId);
    }

    // Apply tags filter
    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter(item => {
        const meta = item as any;
        return meta?.tags && query.tags!.some((t: string) => meta.tags.includes(t));
      });
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = (a as any)[sortBy] ?? '';
      const bVal = (b as any)[sortBy] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    // Paginate
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    return {
      items: paged,
      total,
      page,
      pageSize,
    };
  }

  // ==========================================
  // Bulk Operations
  // ==========================================

  /**
   * Register multiple metadata items in a single batch.
   *
   * Announces one event per item, like {@link register}. Pass
   * `{ notify: false }` when the batch is boot-time ingest or when the caller
   * announces the whole set once — see {@link MetadataWriteOptions.notify}.
   */
  async bulkRegister(
    items: Array<{ type: string; name: string; data: unknown }>,
    options?: { continueOnError?: boolean; validate?: boolean } & MetadataWriteOptions
  ): Promise<MetadataBulkResult> {
    const { continueOnError = false, notify } = options ?? {};
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ type: string; name: string; error: string }> = [];

    for (const item of items) {
      try {
        await this.register(item.type, item.name, item.data, { notify });
        succeeded++;
      } catch (e) {
        failed++;
        errors.push({
          type: item.type,
          name: item.name,
          error: e instanceof Error ? e.message : String(e),
        });
        if (!continueOnError) break;
      }
    }

    return {
      total: items.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Unregister multiple metadata items in a single batch.
   *
   * Announces one `deleted` event per item, like {@link unregister}.
   */
  async bulkUnregister(
    items: Array<{ type: string; name: string }>,
    options?: MetadataWriteOptions,
  ): Promise<MetadataBulkResult> {
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ type: string; name: string; error: string }> = [];

    for (const item of items) {
      try {
        await this.unregister(item.type, item.name, options);
        succeeded++;
      } catch (e) {
        failed++;
        errors.push({
          type: item.type,
          name: item.name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      total: items.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ==========================================
  // Overlay / Customization Management
  // ==========================================

  private overlayKey(type: string, name: string, scope: string = 'platform'): string {
    return `${encodeURIComponent(type)}:${encodeURIComponent(name)}:${scope}`;
  }

  /**
   * Get the active overlay for a metadata item
   */
  async getOverlay(type: string, name: string, scope?: 'platform' | 'user'): Promise<MetadataOverlay | undefined> {
    return this.overlays.get(this.overlayKey(type, name, scope ?? 'platform'));
  }

  /**
   * Save/update an overlay for a metadata item
   */
  async saveOverlay(overlay: MetadataOverlay): Promise<void> {
    // Overlay write gate — independent from base writability so deployments
    // can freeze Studio overlays while still permitting base register().
    if (this.config.persistence?.overlayWritable === false) {
      const msg = `MetadataManager overlays are read-only (persistence.overlayWritable=false); refusing to save overlay for ${overlay.baseType}/${overlay.baseName}`;
      if (this.config.validation?.throwOnError) {
        throw new Error(msg);
      }
      this.logger.warn(msg);
      return;
    }
    const key = this.overlayKey(overlay.baseType, overlay.baseName, overlay.scope);
    this.overlays.set(key, overlay);
  }

  /**
   * Remove an overlay, reverting to the base definition
   */
  async removeOverlay(type: string, name: string, scope?: 'platform' | 'user'): Promise<void> {
    this.overlays.delete(this.overlayKey(type, name, scope ?? 'platform'));
  }

  /**
   * Get the effective (merged) metadata after applying all overlays.
   * Resolution order: system ← merge(platform) ← merge(user)
   */
  async getEffective(type: string, name: string, context?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
  }): Promise<unknown | undefined> {
    const base = await this.get(type, name);
    if (!base) return undefined;

    let effective = { ...(base as Record<string, unknown>) };

    // Apply platform overlay
    const platformOverlay = await this.getOverlay(type, name, 'platform');
    if (platformOverlay?.active && platformOverlay.patch) {
      effective = { ...effective, ...platformOverlay.patch };
    }

    // Apply user overlay (scoped to specific user if context provided)
    if (context?.userId) {
      // Try user-specific key first, then fall back to generic user overlay.
      // The owner check below ensures we never apply another user's overlay.
      const userOverlayKey = this.overlayKey(type, name, 'user') + `:${context.userId}`;
      const userOverlay = this.overlays.get(userOverlayKey) 
        ?? await this.getOverlay(type, name, 'user');
      if (userOverlay?.active && userOverlay.patch) {
        // Apply if: overlay has no owner (generic user-level), or owner matches current user
        if (!userOverlay.owner || userOverlay.owner === context.userId) {
          effective = { ...effective, ...userOverlay.patch };
        }
      }
    } else {
      // No user context — only apply user overlays without an owner restriction
      // (owner-scoped overlays require a userId to resolve)
      const userOverlay = await this.getOverlay(type, name, 'user');
      if (userOverlay?.active && userOverlay.patch && !userOverlay.owner) {
        effective = { ...effective, ...userOverlay.patch };
      }
    }

    return effective;
  }

  // ==========================================
  // Watch / Subscribe (IMetadataService)
  // ==========================================

  /**
   * Watch for metadata changes (IMetadataService contract).
   * Returns a handle for unsubscribing.
   */
  watchService(type: string, callback: MetadataWatchCallback): MetadataWatchHandle {
    const wrappedCallback: WatchCallback = (event) => {
      const mappedType = event.type === 'added' ? 'registered'
        : event.type === 'deleted' ? 'unregistered'
        : 'updated';
      callback({
        type: mappedType,
        metadataType: event.metadataType ?? type,
        name: event.name ?? '',
        data: event.data,
      });
    };
    this.addWatchCallback(type, wrappedCallback);
    return {
      unsubscribe: () => this.removeWatchCallback(type, wrappedCallback),
    };
  }

  /**
   * Subscribe to raw metadata watch events for a given type.
   *
   * Unlike `watchService` (which maps to the IMetadataService contract and
   * drops fields like `path`/`timestamp`), this returns the raw
   * `MetadataWatchEvent` produced by the underlying watcher — useful for
   * developer-facing tooling such as the HMR SSE endpoint that wants the
   * source file path and original timestamp.
   *
   * @returns An unsubscribe function.
   */
  subscribe(type: string, callback: WatchCallback): () => void {
    this.addWatchCallback(type, callback);
    return () => this.removeWatchCallback(type, callback);
  }

  // ==========================================
  // Import / Export
  // ==========================================

  /**
   * Export metadata as a portable bundle
   */
  async exportMetadata(options?: MetadataExportOptions): Promise<unknown> {
    const bundle: Record<string, unknown[]> = {};
    const targetTypes = options?.types ?? Array.from(this.registry.keys());

    for (const type of targetTypes) {
      const items = await this.list(type);
      if (items.length > 0) {
        bundle[type] = items;
      }
    }

    return bundle;
  }

  /**
   * Import metadata from a portable bundle
   */
  async importMetadata(data: unknown, options?: MetadataImportOptions): Promise<MetadataImportResult> {
    const {
      conflictResolution = 'skip',
      validate: _validate = true,
      dryRun = false,
    } = options ?? {};

    const bundle = data as Record<string, unknown[]>;
    let total = 0;
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ type: string; name: string; error: string }> = [];

    for (const [type, items] of Object.entries(bundle)) {
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        total++;
        const meta = item as any;
        const name = meta?.name;

        if (!name) {
          failed++;
          errors.push({ type, name: '(unknown)', error: 'Item missing name field' });
          continue;
        }

        try {
          const itemExists = await this.exists(type, name);

          if (itemExists && conflictResolution === 'skip') {
            skipped++;
            continue;
          }

          if (!dryRun) {
            if (itemExists && conflictResolution === 'merge') {
              const existing = await this.get(type, name);
              const merged = { ...(existing as any), ...(item as any) };
              await this.register(type, name, merged);
            } else {
              await this.register(type, name, item);
            }
          }
          imported++;
        } catch (e) {
          failed++;
          errors.push({
            type,
            name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      total,
      imported,
      skipped,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ==========================================
  // Validation
  // ==========================================

  /**
   * Validate a metadata item against its type schema.
   *
   * NOTE: This is a lightweight structural check (presence of `name`,
   * basic shape). The authoritative spec validation lives in
   * `protocol.saveMetaItem` (write path) and is surfaced on read
   * paths via the `_diagnostics` envelope attached by
   * `protocol.getMetaItems` / `getMetaItem`. Both delegate to
   * `getMetadataTypeSchema()` — the single source of truth. We
   * deliberately do NOT run the full Zod schema here because
   * `MetadataManager`'s registry stores *publish envelopes*
   * (`{name, packageId, state, metadata: {...spec}}`), not raw spec
   * documents — running spec validation against the envelope would
   * yield false negatives.
   */
  async validate(_type: string, data: unknown): Promise<MetadataValidationResult> {
    // Basic structural validation
    if (data === null || data === undefined) {
      return {
        valid: false,
        errors: [{ path: '', message: 'Metadata data cannot be null or undefined' }],
      };
    }

    if (typeof data !== 'object') {
      return {
        valid: false,
        errors: [{ path: '', message: 'Metadata data must be an object' }],
      };
    }

    const meta = data as any;
    const warnings: Array<{ path: string; message: string }> = [];

    if (!meta.name) {
      return {
        valid: false,
        errors: [{ path: 'name', message: 'Metadata item must have a name field' }],
      };
    }

    if (!meta.label) {
      warnings.push({ path: 'label', message: 'Missing label field (recommended)' });
    }

    return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  // ==========================================
  // Type Registry
  // ==========================================

  /**
   * Get all registered metadata types
   */
  async getRegisteredTypes(): Promise<string[]> {
    const types = new Set<string>();

    // From type registry
    for (const entry of this.typeRegistry) {
      types.add(entry.type);
    }

    // From in-memory registry (custom types)
    for (const type of this.registry.keys()) {
      types.add(type);
    }

    return Array.from(types);
  }

  /**
   * Get detailed information about a metadata type
   */
  async getTypeInfo(type: string): Promise<MetadataTypeInfo | undefined> {
    const entry = this.typeRegistry.find(e => e.type === type);
    if (!entry) return undefined;

    // Merge declarative (live registry entry — covers built-ins AND
    // plugin-contributed `additionalTypes`) + plugin-registered type-level
    // actions. Deduped by name; imperatively-registered actions win on
    // collision. Emitted so the metadata-admin engine can render per-type
    // buttons (e.g. datasource "Test connection"). Omit the key entirely
    // when the type has none, to keep the response lean.
    const byName = new Map<string, any>();
    for (const a of (entry.actions ?? [])) byName.set(a.name, a);
    for (const a of getMetadataTypeActions(type)) byName.set(a.name, a);
    const actions = Array.from(byName.values());

    return {
      type: entry.type,
      label: entry.label,
      description: entry.description,
      filePatterns: entry.filePatterns,
      supportsOverlay: entry.supportsOverlay,
      domain: entry.domain,
      ...(actions.length > 0 ? { actions } : {}),
    };
  }

  // ==========================================
  // Dependency Tracking
  // ==========================================

  /**
   * Get metadata items that this item depends on
   */
  async getDependencies(type: string, name: string): Promise<MetadataDependency[]> {
    return this.dependencies.get(`${encodeURIComponent(type)}:${encodeURIComponent(name)}`) ?? [];
  }

  /**
   * Get metadata items that depend on this item
   */
  async getDependents(type: string, name: string): Promise<MetadataDependency[]> {
    const dependents: MetadataDependency[] = [];
    for (const deps of this.dependencies.values()) {
      for (const dep of deps) {
        if (dep.targetType === type && dep.targetName === name) {
          dependents.push(dep);
        }
      }
    }
    return dependents;
  }

  /**
   * Register a dependency between two metadata items.
   * Used internally to track cross-references.
   * Duplicate dependencies (same source, target, and kind) are ignored.
   */
  addDependency(dep: MetadataDependency): void {
    const key = `${encodeURIComponent(dep.sourceType)}:${encodeURIComponent(dep.sourceName)}`;
    if (!this.dependencies.has(key)) {
      this.dependencies.set(key, []);
    }
    const existing = this.dependencies.get(key)!;
    const isDuplicate = existing.some(
      d => d.targetType === dep.targetType && d.targetName === dep.targetName && d.kind === dep.kind
    );
    if (!isDuplicate) {
      existing.push(dep);
    }
  }

  // ==========================================
  // API Endpoint Resolution
  // ==========================================

  /**
   * Resolve a request's `method`+`path` to the declared `api` metadata item
   * that owns it — `IMetadataService.matchEndpoint` (#5080 contract, #5089
   * implementation, #5040 E2).
   *
   * The behaviour is specified by the contract text in
   * `packages/spec/src/contracts/metadata-service.ts`; the mechanics
   * (normalization, lazy index, loud parse-skip, duplicate resolution) live in
   * `./endpoint-matcher.ts` and are documented there.
   *
   * Scope is THIS instance. There is no environment parameter, because callers
   * already resolve the `metadata` service for the environment they serve —
   * adding one here would create a second scoping mechanism.
   *
   * This method is reached over HTTP on a real boot. The dispatcher seam
   * landed as #5090 (`packages/runtime/src/api-endpoint-step.ts`, called from
   * the `setFallbackHandler` the dispatcher plugin installs), and #4936's
   * wholesale publish refusal of a non-empty `apis:` was replaced by the
   * #5040 E7 per-shape gates (`packages/spec/src/api/endpoint-publish-gate.ts`)
   * — so declarations exist and requests arrive here. The showcase's two
   * declared endpoints are matched and executed through this path in
   * `packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`.
   *
   * @throws when the metadata store cannot be read — an outage must never be
   *   reported as a miss, because a miss becomes a 404.
   */
  async matchEndpoint(query: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> {
    return this.endpointMatcher.match(query);
  }

  // ==========================================
  // Legacy Loader API (backward compatible)
  // ==========================================

  /**
   * Load a single metadata item from loaders.
   * Iterates through registered loaders until found.
   *
   * Returns `null` both when no loader HAS the item and when every loader
   * FAILED — see {@link loadDiagnosed} when the caller must tell those apart.
   */
  async load<T = any>(
    type: string,
    name: string,
    options?: MetadataLoadOptions
  ): Promise<T | null> {
    return (await this.loadDiagnosed<T>(type, name, options)).data;
  }

  /**
   * `load`, plus whether the answer can be trusted as complete.
   *
   * [ADR-0110 D3] A miss and an outage are different facts with opposite
   * security meanings, and plain `load` cannot express the difference: a
   * loader that throws is warn-logged and skipped, so a database the metadata
   * plane cannot reach returns the same `null` as a name that was never
   * declared. Callers that gate on a declaration MUST NOT read that `null` as
   * "the author declared no gate" — an availability failure would silently
   * widen access (the REST `/actions` route's fail-open branch, #3935).
   *
   * `degraded` is true when at least one loader threw AND no loader answered
   * with the item. The posture is deliberately conservative: with a loader
   * down we cannot prove the item is absent, so we decline to claim it is.
   * A clean miss (every loader answered, none had it) is NOT degraded.
   */
  async loadDiagnosed<T = any>(
    type: string,
    name: string,
    options?: MetadataLoadOptions
  ): Promise<{ data: T | null; degraded: boolean; errors: string[] }> {
    const errors: string[] = [];
    for (const loader of this.loaders.values()) {
        try {
            const result = await loader.load(type, name, options);
            if (result.data) {
                return { data: result.data as T, degraded: false, errors };
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            errors.push(`${loader.contract.name}: ${message}`);
            this.logger.warn(`Loader ${loader.contract.name} failed to load ${type}:${name}`, { error: e });
        }
    }
    return { data: null, degraded: errors.length > 0, errors };
  }

  /**
   * Load multiple metadata items from loaders.
   * Aggregates results from all loaders.
   */
  async loadMany<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<T[]> {
    const results: T[] = [];

    for (const loader of this.loaders.values()) {
        try {
            const items = await loader.loadMany<T>(type, options);
            for (const item of items) {
                const itemAny = item as any;
                if (itemAny && typeof itemAny.name === 'string') {
                    const exists = results.some((r: any) => r && r.name === itemAny.name);
                    if (exists) continue;
                }
                results.push(item);
            }
            this.reportLoaderReadRecovered(loader.contract.name);
        } catch (e) {
            // [#5108] Same seam, same verdict as `list()` — see
            // {@link reportLoaderReadFailure}. Two adjacent plural reads
            // reporting one storage outage at two different levels is how the
            // wrong one gets copied.
            this.reportLoaderReadFailure(loader.contract.name, type, e);
        }
    }
    return results;
  }

  /**
   * Save metadata item to a loader
   */
  async save<T = any>(
    type: string,
    name: string,
    data: T,
    options?: MetadataSaveOptions
  ): Promise<MetadataSaveResult> {
    const targetLoader = (options as any)?.loader;

    let loader: MetadataLoader | undefined;
    
    if (targetLoader) {
      loader = this.loaders.get(targetLoader);
      if (!loader) {
        throw new Error(`Loader not found: ${targetLoader}`);
      }
    } else {
      for (const l of this.loaders.values()) {
          if (!l.save) continue;
          try {
            if (await l.exists(type, name)) {
                loader = l;
                this.logger.info(`Updating existing metadata in loader: ${l.contract.name}`);
                break;
            }
          } catch (e) {
            // Ignore existence check errors
          }
      }

      if (!loader) {
        const fsLoader = this.loaders.get('filesystem');
        if (fsLoader && fsLoader.save) {
           loader = fsLoader;
        }
      }

      if (!loader) {
        for (const l of this.loaders.values()) {
          if (l.save) {
            loader = l;
            break;
          }
        }
      }
    }

    if (!loader) {
      throw new Error(`No loader available for saving type: ${type}`);
    }

    if (!loader.save) {
      throw new Error(`Loader '${loader.contract?.name}' does not support saving`);
    }

    return loader.save(type, name, data, options);
  }

  /**
   * Register a watch callback for metadata changes
   */
  protected addWatchCallback(type: string, callback: WatchCallback): void {
    if (!this.watchCallbacks.has(type)) {
      this.watchCallbacks.set(type, new Set());
    }
    this.watchCallbacks.get(type)!.add(callback);
  }

  /**
   * Remove a watch callback for metadata changes
   */
  protected removeWatchCallback(type: string, callback: WatchCallback): void {
    const callbacks = this.watchCallbacks.get(type);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.watchCallbacks.delete(type);
      }
    }
  }

  /**
   * Stop all watching
   */
  async stopWatching(): Promise<void> {
    // Override in subclass
  }

  // ─── ADR-0008 PR-6: Repository wiring ───────────────────────────────

  /**
   * Attach a {@link MetadataRepository} as a supplementary event source.
   *
   * The manager subscribes to `repo.watch({})` and re-emits each event
   * through {@link notifyWatchers} as a legacy `MetadataWatchEvent`.
   * Each event also invalidates the in-memory registry entry and the
   * `list()` cache for the affected type so subsequent reads see fresh
   * data.
   *
   * No write-through. `register()` / `unregister()` / `save()` are
   * untouched in this PR (deferred to ADR-0008 M0 PR-10).
   *
   * Call {@link dispose} (or {@link stopRepositoryWatch}) to detach.
   */
  setRepository(repo: MetadataRepository): void {
    if (this.repository === repo) return;
    if (this.repository) {
      void this.stopRepositoryWatch();
    }
    this.repository = repo;
    this.repoWatchClosed = false;
    void this.startRepositoryWatch();
  }

  /** Return the attached repository, if any. */
  getRepository(): MetadataRepository | undefined {
    return this.repository;
  }

  /** Stop the active repo.watch() loop (best-effort). */
  async stopRepositoryWatch(): Promise<void> {
    this.repoWatchClosed = true;
    const iter = this.repoWatchIter;
    this.repoWatchIter = undefined;
    if (iter && typeof iter.return === 'function') {
      try { await iter.return(undefined); } catch { /* noop */ }
    }
  }

  /**
   * Best-effort cleanup. Stops the FS watcher (if any), drains the
   * repository watch loop, and clears registry caches. Safe to call
   * multiple times.
   */
  async dispose(): Promise<void> {
    await this.stopWatching().catch(() => undefined);
    await this.stopRepositoryWatch().catch(() => undefined);
    this.listCache.clear();
    this.endpointMatcher.invalidate();
  }

  private async startRepositoryWatch(): Promise<void> {
    const repo = this.repository;
    if (!repo) return;
    const iterable = repo.watch({});
    const iter = (iterable as AsyncIterable<MetadataEvent>)[Symbol.asyncIterator]();
    this.repoWatchIter = iter;
    try {
      while (!this.repoWatchClosed) {
        const { value, done } = await iter.next();
        if (done) break;
        try {
          this.applyRepoEvent(value);
        } catch (err) {
          this.logger.warn('[MetadataManager] repo event handler failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      if (!this.repoWatchClosed) {
        this.logger.warn('[MetadataManager] repository watch loop exited unexpectedly', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      if (this.repoWatchIter === iter) this.repoWatchIter = undefined;
    }
  }

  /**
   * Drop every local cache of `type` (and of `name` within it) that a change
   * we did not perform ourselves has just invalidated, so the next read falls
   * through to the source of truth.
   *
   * The callers are the manager's *foreign-write* seams — the repository watch
   * loop ({@link applyRepoEvent}), the cluster peer replay in
   * {@link attachClusterPubSub}, and — since #5218 — `NodeMetadataManager`'s
   * chokidar handler, which is why this is `protected` rather than `private`.
   * All three learn about a write that landed somewhere else (the repo head;
   * another node's `sys_metadata`; an editor writing `rootDir/view/x.json`) and
   * hold caches that the write silently aged out. A file event qualifies on
   * exactly the definition that matters here: it did not come through this
   * manager's write API, so nothing has updated the caches on its behalf.
   * Local writes do not come through here: `register()` / `unregister()` /
   * `registerInMemory()` update the registry to the value they just wrote and
   * call `invalidateListCache()` themselves.
   *
   * **Delete, do not pre-fill.** Even when the event carries a body we drop the
   * registry entry rather than writing the body into it: the body reaching us
   * is a snapshot of *someone else's* write, already possibly superseded, and
   * pre-filling would race with the true head and require us to re-canonicalise
   * a definition we did not load. Lazy invalidation is the safer default —
   * `get()` then falls through to the loaders / repository, which is where the
   * truth is. (This paragraph is the rationale `applyRepoEvent` carried since
   * ADR-0008 PR-6; #5109 extended the same choice to the cluster path, #5218 to
   * the filesystem watcher — where "the truth" is the file chokidar just
   * reported, served by the `FilesystemLoader` the registry entry was shadowing.)
   *
   * `name` is optional because `MetadataWatchEvent.name` is: a nameless event
   * cannot address a registry entry, so it invalidates the list cache only.
   * Dropping the whole type store instead would evict `registerInMemory()`
   * artefacts (code-owned datasources, ADR-0015 Addendum) that no loader can
   * restore — an unrecoverable loss in exchange for a guess.
   */
  protected invalidateForForeignWrite(type: string, name?: string): void {
    if (name) {
      const typeStore = this.registry.get(type);
      if (typeStore) {
        typeStore.delete(name);
        if (typeStore.size === 0) this.registry.delete(type);
      }
    }
    this.invalidateListCache(type);
  }

  /** Translate a repo event to the legacy MetadataWatchEvent + invalidate caches. */
  private applyRepoEvent(evt: MetadataEvent): void {
    const ref: MetaRef = evt.ref;
    const type = ref.type;
    const name = ref.name;

    // Invalidate before announcing, so a watcher that re-reads on the event
    // observes the write rather than the pre-write cache. See
    // {@link invalidateForForeignWrite} for why the registry entry is deleted
    // rather than pre-filled.
    this.invalidateForForeignWrite(type, name);

    const legacyType: 'added' | 'changed' | 'deleted' =
      evt.op === 'create' ? 'added'
      : evt.op === 'delete' ? 'deleted'
      : 'changed';

    const legacyEvent: MetadataWatchEvent = {
      type: legacyType,
      metadataType: type,
      name,
      path: '',
      // Repo events carry the hash only; the body is fetched on demand
      // via manager.get(type, name). HMR consumers don't read `data` so
      // this is fine for M0. (See ADR-0008 §12 open question 1.)
      data: undefined,
      timestamp: evt.ts,
    };
    // Carry the canonical server-side `seq` so downstream consumers
    // (HMR SSE route → Studio status badge) can render an accurate
    // "N changes since boot" matching what other replicas observe.
    // Non-typed extra property on purpose — extending MetadataWatchEvent
    // is a spec-package change deferred to a later PR.
    (legacyEvent as Record<string, unknown>).seq = evt.seq;
    this.notifyWatchers(type, legacyEvent);
  }

  protected notifyWatchers(type: string, event: MetadataWatchEvent) {
    this.notifyWatchersLocal(type, event);

    // Cluster fan-out (cluster-semantics.mdx §5). Best-effort: a publish
    // failure must never block the local update.
    if (this.clusterPubSub) {
      const payload: ClusterMetadataChangedPayload = {
        originNode: this.clusterNodeId,
        type,
        event,
      };
      const key = `${type}:${(event as { name?: string }).name ?? ''}`;
      void this.clusterPubSub
        .publish(MetadataManager.CLUSTER_CHANNEL, payload, { partitionKey: key })
        .catch((err) => {
          this.logger.error('Cluster metadata publish failed', undefined, {
            type,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }

  private notifyWatchersLocal(type: string, event: MetadataWatchEvent) {
    const callbacks = this.watchCallbacks.get(type);
    if (!callbacks) return;

    for (const callback of callbacks) {
      try {
        void callback(event);
      } catch (error) {
        this.logger.error('Watch callback error', undefined, {
          type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Attach a cluster pub/sub transport so metadata-change events fan
   * out to peer nodes and remote events replay into local watchers.
   *
   * The bridge plugin in @objectstack/service-cluster calls this once
   * per kernel boot after both cluster and metadata services are
   * registered. Passing the same MetadataManager twice no-ops; passing
   * a different transport replaces the prior subscription.
   *
   * Pass `nodeId` matching the local cluster's nodeId so loopback
   * suppression works.
   *
   * @returns disposer that unsubscribes from cluster events.
   */
  attachClusterPubSub(pubsub: IPubSub, nodeId: string): () => void {
    // Idempotent on (pubsub, nodeId) — re-attaching same pair short-circuits.
    if (this.clusterPubSub === pubsub && this.clusterNodeId === nodeId) {
      return () => this.detachClusterPubSub();
    }
    this.detachClusterPubSub();
    this.clusterPubSub = pubsub;
    this.clusterNodeId = nodeId;
    this.clusterUnsubscribe = pubsub.subscribe<ClusterMetadataChangedPayload>(
      MetadataManager.CLUSTER_CHANNEL,
      (msg) => {
        const p = msg.payload;
        // Loopback guard — never replay events we just emitted.
        if (p?.originNode && p.originNode === this.clusterNodeId) return;
        if (!p?.type || !p.event) return;

        // [#5109] Invalidate FIRST, and SYNCHRONOUSLY on receipt — this is
        // what the channel is for ("consumed by peers to invalidate their
        // local caches", see ClusterMetadataChangedPayload). Until this
        // landed, a peer's write only woke this node's watchers: the registry
        // entry and the `listCache` were left untouched, so every `list(type)`
        // kept serving the pre-write set for up to LIST_CACHE_TTL_MS (30s) —
        // and a watcher that re-read via `list()` in response to the wake-up
        // got the stale set back, an invalidation notice carrying invalidated
        // data.
        //
        // Two deliberate choices, both pinned by tests in
        // `metadata-manager-cluster.test.ts`:
        //
        //   • BEFORE the notify, matching every other write path in this file
        //     (`register` / `unregister` / `applyRepoEvent` all invalidate,
        //     then announce): a watcher must never be able to observe the
        //     event and the pre-event cache at the same time.
        //   • OUTSIDE the `setImmediate`, unlike the notify. The deferral
        //     exists so a slow *watcher callback* — arbitrary consumer code —
        //     cannot back-pressure the pubsub dispatch loop. Invalidation is
        //     two `Map.delete`s and runs no consumer code, so it has nothing
        //     to defer for, while deferring it would leave a window between
        //     receipt and the next tick in which reads still answer stale.
        //     Any `await` in a request handler is enough to lose that race.
        try {
          this.invalidateForForeignWrite(p.type, p.event.name);
        } catch (err) {
          this.logger.error('Cluster remote invalidation failed', undefined, {
            type: p.type,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Defer to setImmediate so a slow local handler can't back-pressure
        // the pubsub dispatch loop on memory drivers.
        setImmediate(() => {
          try {
            this.notifyWatchersLocal(p.type, p.event);
          } catch (err) {
            this.logger.error('Cluster remote replay failed', undefined, {
              type: p.type,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
      },
    );
    this.logger.info('MetadataManager attached to cluster pubsub', {
      nodeId,
      channel: MetadataManager.CLUSTER_CHANNEL,
    });
    return () => this.detachClusterPubSub();
  }

  /** Tear down cluster wiring. Safe to call multiple times. */
  detachClusterPubSub(): void {
    if (this.clusterUnsubscribe) {
      try { this.clusterUnsubscribe(); } catch { /* idempotent */ }
      this.clusterUnsubscribe = undefined;
    }
    this.clusterPubSub = undefined;
    this.clusterNodeId = undefined;
  }

  // ==========================================
  // Version History & Rollback
  // ==========================================

  /**
   * Get the database loader for history operations.
   * Returns undefined if no database loader is configured.
   */
  private getDatabaseLoader(): DatabaseLoader | undefined {
    const dbLoader = this.loaders.get('database');
    if (dbLoader && dbLoader instanceof DatabaseLoader) {
      return dbLoader;
    }
    return undefined;
  }

  /**
   * Get version history for a metadata item.
   * Returns a timeline of all changes made to the item.
   */
  async getHistory(
    type: string,
    name: string,
    options?: MetadataHistoryQueryOptions
  ): Promise<MetadataHistoryQueryResult> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('History tracking requires a database loader to be configured');
    }

    return dbLoader.queryHistory(type, name, {
      operationType: options?.operationType,
      since: options?.since,
      until: options?.until,
      limit: options?.limit,
      offset: options?.offset,
      includeMetadata: options?.includeMetadata,
    });
  }

  /**
   * Rollback a metadata item to a specific version.
   * Restores the metadata definition from the history snapshot.
   */
  async rollback(
    type: string,
    name: string,
    version: number,
    options?: {
      changeNote?: string;
      recordedBy?: string;
    }
  ): Promise<unknown> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('Rollback requires a database loader to be configured');
    }

    // Fetch the target version snapshot directly from the history table
    const targetVersion = await dbLoader.getHistoryRecord(type, name, version);

    if (!targetVersion) {
      throw new Error(`Version ${version} not found in history for ${type}/${name}`);
    }

    if (!targetVersion.metadata) {
      throw new Error(`Version ${version} metadata snapshot not available`);
    }

    // Restore the metadata using the dedicated rollback path so that a single
    // 'revert' history entry is written (instead of a conflicting 'update' entry)
    const restoredMetadata = targetVersion.metadata;
    await dbLoader.registerRollback(
      type,
      name,
      restoredMetadata,
      version,
      options?.changeNote,
      options?.recordedBy
    );

    // Update in-memory registry with the restored metadata
    if (!this.registry.has(type)) {
      this.registry.set(type, new Map());
    }
    this.registry.get(type)!.set(name, restoredMetadata);

    return restoredMetadata;
  }

  /**
   * Compare two versions of a metadata item.
   * Returns a diff showing what changed between versions.
   */
  async diff(
    type: string,
    name: string,
    version1: number,
    version2: number
  ): Promise<MetadataDiffResult> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('Diff requires a database loader to be configured');
    }

    // Fetch the two version snapshots directly from the history table
    const v1 = await dbLoader.getHistoryRecord(type, name, version1);
    const v2 = await dbLoader.getHistoryRecord(type, name, version2);

    if (!v1) {
      throw new Error(`Version ${version1} not found in history for ${type}/${name}`);
    }

    if (!v2) {
      throw new Error(`Version ${version2} not found in history for ${type}/${name}`);
    }

    if (!v1.metadata || !v2.metadata) {
      throw new Error('Version metadata snapshots not available');
    }

    // Generate diff
    const patch = generateSimpleDiff(v1.metadata, v2.metadata);
    const identical = patch.length === 0;
    const summary = generateDiffSummary(patch);

    return {
      type,
      name,
      version1,
      version2,
      checksum1: v1.checksum,
      checksum2: v2.checksum,
      identical,
      patch,
      summary,
    };
  }
}

