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
import { getMetadataTypeActions, getMetadataTypeRedactor } from '@objectstack/spec/kernel';
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
// [ADR-0138 D2b] The cross-item judge beside them, and the refusal it words for
// each direction — see `gateAnonymousElevatedFlowsForPublish`.
import {
  anonymousElevatedFlowPairs,
  anonymousEndpointElevatedFlowMessage,
  elevatedFlowAnonymousEndpointsMessage,
  type AnonymousFlowDoorCandidate,
  type ElevatedFlowCandidate,
} from '@objectstack/spec/api';
import {
  assertMetadataRegisterContract,
  canonicalMetadataServiceType,
  createLogger,
  type Logger,
} from '@objectstack/core';
import { JSONSerializer } from './serializers/json-serializer.js';
import { YAMLSerializer } from './serializers/yaml-serializer.js';
import { TypeScriptSerializer } from './serializers/typescript-serializer.js';
import type { MetadataSerializer } from './serializers/serializer-interface.js';
import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';
import type { MetadataLoader, MetadataKeyedItem } from './loaders/loader-interface.js';
import { DatabaseLoader, type MetadataHistoryAddress } from './loaders/database-loader.js';
import { isAmbiguousMetadataStemError } from './loaders/ambiguous-metadata-stem.js';
import { generateSimpleDiff, generateDiffSummary } from './utils/metadata-history-utils.js';
import type {
  MetadataRepository,
  MetadataEvent,
  MetaRef,
} from '@objectstack/metadata-core';
import { EndpointMatcher } from './endpoint-matcher.js';
import {
  PACKAGE_SLOTTED_STORE_TYPES,
  isPackageCaller,
  bundleEntryKey,
  isBundledStoreType,
  keyIdentityOf,
  latestMemberOf,
  latestMembersFirst,
  memberSuffixOf,
  pluralEntryKeys,
  readStoreEntry,
  inheritStoreWriteOrder,
  judgesLoaderSlots,
  packagelessWriteKeyOf,
  platformSlotsOf,
  recordStoreWrite,
  slotPackageOf,
  slotOfKey,
  slotStoreOf,
  storedItemPackageId as indexedItemPackageId,
  storedNameOf,
  storeKeysNamed,
  storeRemovalKeys,
  storeSlotKey,
  storeWriteKey,
  environmentStoreKey,
} from './package-slotted-store.js';
// [#5309] The stored ENVELOPE / authored BODY split — peeled before any spec
// schema parses a stored row. See `stored-envelope.ts`.
import { peelStoredEnvelope, STORED_ENVELOPE_KEYS } from './stored-envelope.js';
// [#13913] Registry-free expansion of an aggregated view container reached
// through THIS manager's own store — see `getViewsByObject`.
import { expandRuntimeViewContainer } from './view-container-expansion.js';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';

/**
 * Watch callback function (legacy)
 */
export type WatchCallback = (event: MetadataWatchEvent) => void | Promise<void>;

/**
 * [#31699 R5-A; epic ruling 6801410166] {@link MetadataManager.register}'s
 * options: the spec's {@link MetadataWriteOptions}, plus `skipSourceLoader`.
 * With it, an item {@link MetadataManager.loadMany} read from a loader is not
 * persisted back into that same loader; every other loader's write is
 * unchanged. The boot priming pass sets it, so a boot never writes back a row
 * it read from the store it read it from. [R7-A] That loader still binds the
 * empty `package_id` column of the legacy row the item was read from, the
 * column only (`MetadataLoader.bindReadRowPackage`). Class-level, as
 * {@link MetadataUnregisterOptions} is.
 */
export interface MetadataRegisterOptions extends MetadataWriteOptions {
  /** Skip the write-through to the loader `loadMany` read this very item from. */
  skipSourceLoader?: boolean;
}

/**
 * [ADR-0150 D3/D4, #32198] {@link MetadataManager.unregister}'s options: the
 * spec's {@link MetadataWriteOptions}, plus the package whose item is removed.
 *
 * `packageId` matters only for a type stored per `(package, name)`
 * (`PACKAGE_SLOTTED_STORE_TYPES`): it removes that package's slot only, and
 * the storage half deletes only that package's row. Without it, a name two or
 * more packages hold is refused (`PackageScopedNameRefusedError`, `409`)
 * rather than removed from every package. A type outside that set has one
 * item per name, and the option changes nothing for it.
 *
 * Class-level on purpose: the spec's `MetadataWriteOptions` is not widened
 * here (a change to the published contract is the spec lane's), the way
 * {@link MetadataManager.get} already takes a package beyond the spec's
 * signature.
 */
export interface MetadataUnregisterOptions extends MetadataWriteOptions {
  /** The package whose item is removed; see the interface doc. */
  packageId?: string;
}

/**
 * [#22113, #32198] Whether `item` belongs to `packageId`: any of the three
 * keys that name a package on an item names it — `packageId` (the publish
 * envelope's own key, and what a caller that registers an item for a package
 * writes), `package` (the legacy stamp) or `_packageId` (the provenance stamp
 * `applyProtection` writes on every item a code-shipped artifact registers
 * here, and the ONLY key such an item carries). The one membership rule of
 * the package-wide verbs: {@link MetadataManager.unregisterPackage},
 * `publishPackage` and `revertPackage` (`collectPackageMembers`).
 *
 * [#32246] Deliberately not the store's slot rule (`storedItemPackageId`),
 * which differs on three inputs: the legacy `package` key (read only here), a
 * nested envelope's body `_packageId` (read only there), and an item whose
 * keys name two packages (any of them matches here; the envelope's wins
 * there). This is the membership of the package-wide verbs over every type,
 * the legacy key included; for a type stored per `(package, name)`,
 * `unregisterPackage` also takes every item in the package's slot, whatever
 * its body names.
 */
function isPackageMember(item: unknown, packageId: string): boolean {
  const meta = item as { packageId?: unknown; package?: unknown; _packageId?: unknown } | null | undefined;
  return meta?.packageId === packageId || meta?.package === packageId || meta?._packageId === packageId;
}

/**
 * [#5276, #32246, #32353] Whether {@link MetadataManager.unregister}'s storage
 * half deletes from `loader`: a `datasource:` loader that declares write
 * capability, and a `memory:` loader that can delete (the artifact door's
 * store), for every type. A `memory:` loader's copy of a removed item would
 * otherwise keep answering every read once the registry's entry is gone, and
 * a customization removed over a door item would bring the door's body back:
 * a removal removes the item, and the artifact's next load (a reload or a
 * restart) is what restores a door item. For a type stored per
 * `(package, name)` the loader deletes by that key, for every other type by
 * name.
 */
function isRemovalTarget(loader: MetadataLoader): boolean {
  if (loader.contract.protocol === 'datasource:') return Boolean(loader.contract.capabilities.write);
  return isNodeLocalRemovalTarget(loader);
}

/**
 * [#32499] The node-local half of {@link isRemovalTarget}: the `memory:`
 * loader that can delete (the artifact door's store), which every node of a
 * cluster holds on its own. A cluster peer applies a removal it hears of
 * here and nowhere else ({@link MetadataManager.attachClusterPubSub}): the
 * shared `datasource:` store is the origin's to delete from, and a second
 * delete by the peer could take out a row re-written in between.
 */
function isNodeLocalRemovalTarget(loader: MetadataLoader): boolean {
  return loader.contract.protocol === 'memory:' && typeof loader.delete === 'function';
}

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
 * Scope is deliberately exactly the combination `register()` writes to. Other
 * protocols (`file:`, `memory:`, `http:`, `s3:`) are never saved to by the
 * manager at runtime — `register()`'s loop filters on `datasource:` — so they
 * have no write of their own to lose and are not gated. `unregister()` also
 * deletes from a `memory:` loader that implements `delete()`, for every type
 * ({@link isRemovalTarget}, #32246, #32353); one without `delete()` is
 * skipped, which loses nothing the manager wrote. A `datasource:` loader with
 * `capabilities.write: false` is untouched by both paths.
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
/**
 * [ADR-0138 D2b] The names a package item answers to in the anonymous-flow
 * pair gate: its registry key, and the `name` its peeled body declares (the
 * name the judge reports a pair under). The two agree for every item the
 * register contract admits; both are kept so a disagreement cannot hide the
 * item from its own package.
 */
function packageNamesOf(item: { name: string; data: unknown }): string[] {
  const names = [item.name];
  const body = peelStoredEnvelope(item.data).body as { name?: unknown } | null | undefined;
  if (body && typeof body === 'object' && typeof body.name === 'string' && body.name !== '' && body.name !== item.name) {
    names.push(body.name);
  }
  return names;
}

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
 * and consumed by peers to invalidate their local caches
 * (`content/docs/kernel/cluster.mdx` §6.2, lane 1). This shape IS the whole
 * contract: the origin node for loopback suppression, the metadata type, and
 * the local watch event replayed verbatim — an address-only signal. There is
 * no `version`, `name`, `tenantId` or `operation` at the top level and no
 * version comparison on receipt; a peer drops its cache entry and re-reads
 * the shared store. The spec once declared a richer, version-stamped
 * `metadata:changed` payload that this shape was said to align with; it never
 * did, and that schema was retired (ADR-0087 entry
 * `metadata-changed-event-payload-retired`).
 *
 * [#32499] `removal` is the one addition, and it is an address too: it marks
 * the `deleted` event of {@link MetadataManager.unregister} and carries the
 * package that removal named, so a peer deletes its own in-memory copy of the
 * item by the same key the origin deleted its copy by.
 */
export interface ClusterMetadataChangedPayload {
  /** Origin nodeId — used for loopback suppression. */
  originNode?: string;
  /** Metadata type (object, view, dashboard, …). */
  type: string;
  /** The legacy watch event replayed verbatim on peer nodes. */
  event: MetadataWatchEvent;
  /**
   * [#32499] Present only on the `deleted` event `unregister()` announces: the
   * origin removed `(type, event.name)` — one package's item of a type stored
   * per `(package, name)` when `packageId` is set — and deleted its in-memory
   * loaders' copy (the artifact door's store). A peer deletes its own
   * in-memory copy by the same key, so the item stops answering on every
   * node. Absent on every other event (a create or an update, a file or
   * repository event, an origin that predates this field): there the peer
   * keeps its in-memory copy, which no loader could restore once dropped.
   */
  removal?: ClusterMetadataRemoval;
}

/** [#32499] What {@link ClusterMetadataChangedPayload.removal} carries. */
interface ClusterMetadataRemoval {
  /** The package whose item the origin removed; absent for a removal by name. */
  packageId?: string;
  /**
   * [ADR-0150 D4, #31698] The origin removed its registry entry only
   * ({@link MetadataManager.unregisterInMemory}): no loader copy was deleted
   * there, so a peer deletes none either.
   */
  registryOnly?: true;
  /**
   * [ADR-0150 D3, #32560] The origin judged a removal naming no package of an
   * action name to take the environment's own item only: a peer deletes the
   * name's package-less slots from its in-memory copy, never a package's.
   */
  packagelessOnly?: true;
}

/**
 * [#32499] The removal a received payload carries, or `undefined` when it
 * carries none or carries one this node cannot read (a `packageId` that is
 * not a string): a removal read wrongly would delete by name, wider than the
 * origin did, so a malformed one is dropped, as a malformed payload is.
 */
function receivedRemovalOf(payload: ClusterMetadataChangedPayload): ClusterMetadataRemoval | undefined {
  const removal: unknown = payload.removal;
  if (removal === null || typeof removal !== 'object') return undefined;
  const { packageId, registryOnly, packagelessOnly } = removal as { packageId?: unknown; registryOnly?: unknown; packagelessOnly?: unknown };
  if (registryOnly !== undefined && registryOnly !== true) return undefined;
  const only: { registryOnly?: true } = registryOnly === true ? { registryOnly: true } : {};
  // [#32560] Read wrongly, a package-less-only removal would delete by name
  // and take the package's item: one that is not `true` is dropped too.
  if (packagelessOnly !== undefined) return packagelessOnly === true && packageId === undefined ? { packagelessOnly, ...only } : undefined;
  if (packageId !== undefined && typeof packageId !== 'string') return undefined;
  return {
    ...(packageId !== undefined ? { packageId } : {}),
    ...only,
  };
}

/**
 * [ADR-0150 D4, #31698] {@link MetadataManager.unregisterInMemory}'s options.
 *
 * `packageId` names the slot of a type stored per `(package, name)`: a
 * package's own slot, or `null` for the name's package-less slot. Omitted,
 * every slot of the name goes, refused (`PackageScopedNameRefusedError`)
 * when two or more packages hold it, as {@link MetadataManager.unregister}
 * refuses. A type outside that set has one entry per name, and the option
 * changes nothing for it.
 */
export interface MetadataInMemoryRemovalOptions {
  packageId?: string | null;
  /** `false` announces nothing to `subscribe` watchers or cluster peers. */
  notify?: boolean;
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
  /**
   * [#32154] Set by a host that will hand this manager its own logger later,
   * through {@link MetadataManager.useHostLogger}. Until it does, the manager's
   * `debug` / `info` lines are HELD and then replayed through the host's
   * logger, so they follow the host's level (a boot at `warn` prints none of
   * them, `OS_LOG_LEVEL=info` prints them all); `warn` and above print at
   * once, as they always have. `MetadataPlugin` sets it and hands over the
   * kernel's logger in `init()`. Without it, the manager logs through its own
   * `info` logger exactly as before.
   */
  awaitHostLogger?: boolean;
}

/** [#32154] How many `debug` / `info` lines a manager holds while it waits for its host's logger. */
const HELD_CHATTER_CAP = 200;

/**
 * [#32154] The manager's logger: ONE object for the manager's lifetime, so the
 * loaders and the endpoint matcher it is handed to at construction follow the
 * host's logger too once {@link HostFollowingLogger.adopt} switches the target.
 *
 * Why it exists: `MetadataPlugin` builds its manager in its own constructor,
 * before any kernel exists, and `NodeMetadataManager` registers its
 * filesystem loader in ITS constructor, so `Registered metadata loader: …`
 * was written by a logger fixed at `info` before any host level could reach
 * it, and printed into every quiet (`warn`) boot. The host's logger first
 * reaches the manager in `MetadataPlugin.init()`.
 *
 * ⛔ `warn`, `error` and `fatal` are never held: a line that matters prints
 * when it happens, even if no host ever arrives. Only chatter waits, bounded
 * by {@link HELD_CHATTER_CAP}; what overflowed is counted on the replay.
 */
class HostFollowingLogger implements Logger {
  private target: Logger;
  private held: Array<{ level: 'debug' | 'info'; message: string; meta?: Record<string, any> }> | undefined = [];
  private overflowed = 0;

  constructor(initial: Logger) {
    this.target = initial;
  }

  /** Send every later line to `host`, after replaying the held chatter through it. */
  adopt(host: Logger): void {
    this.target = host;
    const held = this.held ?? [];
    this.held = undefined;
    for (const line of held) host[line.level](line.message, line.meta);
    if (this.overflowed > 0) {
      host.debug(`MetadataManager: ${this.overflowed} earlier debug/info line(s) were not kept while waiting for the host logger`);
      this.overflowed = 0;
    }
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.chatter('debug', message, meta);
  }

  info(message: string, meta?: Record<string, any>): void {
    this.chatter('info', message, meta);
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.target.warn(message, meta);
  }

  error(message: string, error?: Error, meta?: Record<string, any>): void {
    this.target.error(message, error, meta);
  }

  fatal(message: string, error?: Error, meta?: Record<string, any>): void {
    if (this.target.fatal) this.target.fatal(message, error, meta);
    else this.target.error(message, error, meta);
  }

  private chatter(level: 'debug' | 'info', message: string, meta?: Record<string, any>): void {
    if (this.held === undefined) {
      this.target[level](message, meta);
    } else if (this.held.length < HELD_CHATTER_CAP) {
      this.held.push({ level, message, meta });
    } else {
      this.overflowed++;
    }
  }
}

/**
 * {@link MetadataManager.redactServedBody}'s walk, for one document and the
 * snapshots nested in its bookkeeping. Returns the input by reference when
 * nothing at any depth is withheld.
 */
function redactServedDocument(
  redactor: NonNullable<ReturnType<typeof getMetadataTypeRedactor>>,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const bookkeeping: Record<string, unknown> = {};
  const authored: Record<string, unknown> = {};
  let bookkeepingChanged = false;
  for (const [key, value] of Object.entries(record)) {
    if (!(STORED_ENVELOPE_KEYS as readonly string[]).includes(key)) {
      authored[key] = value;
    } else if (value === null || typeof value !== 'object') {
      bookkeeping[key] = value;
    } else if (key === 'publishedDefinition' && !Array.isArray(value)) {
      const served = redactServedDocument(redactor, value as Record<string, unknown>);
      if (served !== value) bookkeepingChanged = true;
      bookkeeping[key] = served;
    } else {
      // A non-scalar bookkeeping value that is not a snapshot: not served.
      bookkeepingChanged = true;
    }
  }
  const peeled = Object.keys(bookkeeping).length > 0 || bookkeepingChanged;
  const result = redactor(peeled ? authored : record);
  if (result.redactedKeys.length === 0 && !bookkeepingChanged) return record;
  return peeled ? { ...result.item, ...bookkeeping } : result.item;
}

/**
 * Main metadata manager class.
 * Implements IMetadataService contract for unified metadata management.
 */
export class MetadataManager implements IMetadataService {
  private loaders: Map<string, MetadataLoader> = new Map();
  /** [#31699 R5-A] The loader {@link loadMany} read each item object from ({@link MetadataRegisterOptions}). */
  private readonly loadedFrom = new WeakMap<object, MetadataLoader>();
  /**
   * [ADR-0150 D4, #32791] The items of a type stored per `(package, name)`
   * that {@link loadMany} read from a stored-row loader (`datasource:`) held
   * for no package: the environment's rows. The boot priming pass may stamp
   * one with the host's package before it registers it ({@link slotViewOf}).
   */
  private readonly storedPackagelessRows = new WeakSet<object>();
  /**
   * [ADR-0150 D4, #32791] The {@link storedPackagelessRows} whose registration
   * replaced an item no loader handed out (one registered in memory or by
   * code): that item's package held the name before the row took its slot, so
   * the slot is a holder, not only the row ({@link slotViewOf}).
   */
  private readonly storedRowsOverOwnItems = new WeakSet<object>();
  // Protected so subclasses can access serializers if needed
  protected serializers: Map<MetadataFormat, MetadataSerializer>;
  protected logger: Logger;
  /** [#32154] Under `awaitHostLogger`, the object {@link logger} is built as; {@link useHostLogger} switches its target. */
  private readonly hostFollowingLogger: HostFollowingLogger | undefined;
  protected watchCallbacks = new Map<string, Set<WatchCallback>>();
  protected config: MetadataManagerOptions;

  // In-memory metadata registry: type -> key -> data. The key is the item's
  // name, except for a type stored per `(package, name)` (ADR-0150 D4,
  // `package-slotted-store.ts`), whose key also names the package.
  private registry = new Map<string, Map<string, unknown>>();

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

  // ── Cluster wiring (`content/docs/kernel/cluster.mdx` §6.2, lane 1) ──
  // When attached via `attachClusterPubSub()`, metadata-change events
  // become cluster-wide:
  //   • Local notifyWatchers() publishes on `metadata.changed` so peers
  //     can invalidate their caches.
  //   • A subscribed remote event first invalidates THIS node's caches
  //     (registry entry + listCache, via `invalidateForForeignWrite` —
  //     #5109; a peer's removal also deletes THIS node's in-memory copy,
  //     #32499) and is then replayed into the local watch hub, so existing
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
  /** [ADR-0138 D2b] The type an endpoint of `type: 'flow'` names in its `target`. */
  private static readonly FLOW_METADATA_TYPE = 'flow';
  private readonly endpointMatcher: EndpointMatcher;

  constructor(config: MetadataManagerOptions) {
    this.config = config;
    const ownLogger = createLogger({ level: 'info', format: 'pretty' });
    // [#32154] Under `awaitHostLogger`, a logger that holds the chatter until
    // the host hands over its own (see `HostFollowingLogger`,
    // `useHostLogger`); otherwise its own `info` logger, exactly as before.
    this.hostFollowingLogger = config.awaitHostLogger === true ? new HostFollowingLogger(ownLogger) : undefined;
    this.logger = this.hostFollowingLogger ?? ownLogger;

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
      listApiItems: () => this.listForIndex(MetadataManager.ENDPOINT_METADATA_TYPE, { byPackage: true }),
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

  /**
   * [#32154] Log through the host's logger from now on, so every line of this
   * manager (and of the loaders and matcher it handed its logger to) follows
   * the host's level. The `debug` / `info` lines held since construction
   * under {@link MetadataManagerOptions.awaitHostLogger} are replayed through
   * it first, in order. `MetadataPlugin.init()` calls it with the kernel's
   * logger.
   *
   * On a manager built WITHOUT that option, the manager's own later lines go
   * to `logger`, but a loader or the endpoint matcher handed the earlier
   * logger at construction keeps it: a host that wants those to follow too
   * sets `awaitHostLogger`.
   */
  useHostLogger(logger: Logger): void {
    if (this.hostFollowingLogger) this.hostFollowingLogger.adopt(logger);
    else this.logger = logger;
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
    options?: MetadataRegisterOptions,
  ): Promise<void> {
    // [#7378] The ruled register contract, before anything is touched: refuse
    // a data.name that disagrees with the name argument and refuse a
    // non-document data (rows 1/3 — the guard's header carries the ruling),
    // and key every downstream store, loader write, cache entry and watcher
    // announcement on the CANONICAL type (row 2). A refusal here writes to no
    // store and persists to no loader; it fires even on a read-only manager,
    // because it judges the arguments, not the persistence posture.
    assertMetadataRegisterContract(type, name, data);
    type = canonicalMetadataServiceType(type);

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
    const existed = this.writeRegistryEntry(type, name, data);
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
      // [#31699 R5-A] Never back into the loader this item was read from; [R7-A] only the
      // column-only bind of the legacy row it was read from reaches that loader.
      if (options?.skipSourceLoader && data !== null && typeof data === 'object' && this.loadedFrom.get(data) === loader) {
        await loader.bindReadRowPackage?.(type, name, data);
        continue;
      }
      await loader.save(type, name, data);
    }

    // Publish metadata.{type}.created / .updated event to realtime service.
    // An overwrite is an UPDATE, mirroring the 'added' vs 'changed' split the
    // watcher event below already makes (#4602).
    // [#32246] The package read by the store's rule — the envelope's
    // `packageId`, else the `_packageId` stamp a code-shipped item carries
    // alone — so a `created`/`updated` names the package the way `deleted` does.
    await this.publishRealtimeMetadataEvent(existed ? 'updated' : 'created', type, name, {
      definition: data,
      packageId: indexedItemPackageId(data),
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
    // [#7378 row 2] The canonical fold is a store fact and applies here; the
    // rows-1/3 refusals deliberately do NOT — the ruling names `register`,
    // and this is the boot-time seeding primitive (see
    // assertMetadataRegisterContract's header for the boundary).
    type = canonicalMetadataServiceType(type);
    this.writeRegistryEntry(type, name, data);
    this.invalidateListCache(type);
  }

  /**
   * [ADR-0150 D4, #31698] The removal half of {@link registerInMemory}: drop
   * the in-memory registry entry of `(type, name)`, or one slot of it
   * ({@link MetadataInMemoryRemovalOptions}), and nothing else. ⛔ No loader
   * is asked to delete: a caller that registered a copy of a stored row
   * removes its copy, and the row stays.
   *
   * {@link unregister} is the removal of the ITEM: it deletes from every
   * writable loader first, so a caller that only wants its in-memory copy
   * gone, while the stored row lives on, deletes that row through it.
   *
   * Announced unless `notify: false`: the watcher `deleted` event, and a
   * cluster removal marked registry-only, so each peer drops the same slot
   * and deletes no loader copy of its own.
   *
   * @throws {PackageScopedNameRefusedError} no `packageId` given, and two or
   *   more packages hold the name.
   */
  unregisterInMemory(type: string, name: string, options?: MetadataInMemoryRemovalOptions): void {
    type = canonicalMetadataServiceType(type);
    const store = this.registry.get(type);
    const slot = options?.packageId;
    const keys = slot === null && PACKAGE_SLOTTED_STORE_TYPES.has(type)
      ? storeKeysNamed(store, type, name).filter((key) => slotPackageOf(key) === undefined)
      : storeRemovalKeys(store, type, name, slot).keys;
    if (keys.length === 0) return;
    this.deleteRegistryEntries(type, name, keys);
    this.invalidateListCache(type);
    if (options?.notify === false) return;
    this.notifyWatchers(type, {
      type: 'deleted',
      metadataType: type,
      name,
      path: '',
      data: undefined,
      timestamp: new Date().toISOString(),
    }, { ...(typeof slot === 'string' && PACKAGE_SLOTTED_STORE_TYPES.has(type) ? { packageId: slot } : {}), registryOnly: true });
  }

  /**
   * Put `data` in the in-memory registry under the key the store's write rule
   * gives it ({@link storeWriteKey}: the name, or for a type stored per
   * `(package, name)` the item's package slot), dropping any key the write
   * replaces. Whether an item was replaced — the `added` / `changed` split.
   */
  private writeRegistryEntry(type: string, name: string, data: unknown, slot?: string): boolean {
    let typeStore = this.registry.get(type);
    const { key, replaces } = slot === undefined ? storeWriteKey(typeStore, type, name, data) : { key: slot, replaces: [] };
    if (!typeStore) this.registry.set(type, (typeStore = new Map()));
    const existed = typeStore.has(key) || replaces.length > 0;
    if (data !== null && typeof data === 'object' && this.storedPackagelessRows.has(data)) {
      const before = typeStore.get(key);
      if (before !== null && typeof before === 'object' && before !== data && !this.loadedFrom.has(before)) this.storedRowsOverOwnItems.add(data);
    }
    for (const replaced of replaces) typeStore.delete(replaced);
    typeStore.set(key, data);
    recordStoreWrite(typeStore, key);
    return existed;
  }

  /** Drop every in-memory entry of `(type, name)` — or only `keys`, when given. */
  private deleteRegistryEntries(type: string, name: string, keys?: readonly string[]): void {
    const typeStore = this.registry.get(type);
    if (!typeStore) return;
    for (const key of keys ?? storeKeysNamed(typeStore, type, name)) typeStore.delete(key);
    if (typeStore.size === 0) this.registry.delete(type);
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
   *
   * @param packageId - [ADR-0150 D3/D5] The package the read names. Read only
   *   for a type stored per `(package, name)` ({@link readStoreEntry}): that
   *   package's item, never another package's; omitted, D3 for a caller with
   *   no package. Every other type is read by name, as before.
   * @throws {PackageScopedNameRefusedError} a read naming no package of a name
   *   two or more packages hold, for a type stored per `(package, name)`;
   *   [#32244] for `action`, also a name two or more packages each bind to
   *   its own object, naming each package with its object.
   */
  async get(type: string, name: string, packageId?: string | null): Promise<unknown | undefined> {
    // [#7378 row 2] Read the store `register` wrote: the canonical type.
    type = canonicalMetadataServiceType(type);
    // [ADR-0150 D3, #32560] A read naming no package of an action name a
    // package holds in memory is judged over the registry AND the loaders
    // (`judgesLoaderSlots`): another package's item stored only in a loader
    // is a second holder, the environment's own item stored only in a loader
    // answers first, and a package-less registry slot no loader stores is
    // the platform's, refused beside the package.
    if (judgesLoaderSlots(this.registry.get(type), type, name, packageId)) {
      return (await this.loadSlottedDiagnosed(type, name, packageId)).data ?? undefined;
    }
    // Check in-memory registry first
    const entry = readStoreEntry(this.registry.get(type), type, name, packageId);
    if (entry.found) return entry.data;

    // [ADR-0150 D3, #32246] A by-package type the registry cannot answer (no
    // slot of the name, or a read naming a package where only other packages'
    // slots are registered): the registry's slots and the loaders' stored
    // items of the name, read for the package by the same rule.
    if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) {
      return (await this.loadSlottedDiagnosed(type, name, packageId)).data ?? undefined;
    }
    if (entry.settled) return undefined;

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
    name: string,
    packageId?: string | null,
  ): Promise<{ data: unknown | undefined; degraded: boolean; errors: string[] }> {
    // [#7378 row 2] Same fold as `get` — the two are pinned to agree.
    type = canonicalMetadataServiceType(type);
    // Check in-memory registry first — a hit here consulted no loader, so
    // there is nothing to be degraded about. [ADR-0150 D3] `packageId` as on
    // `get`, read by the same rule. [#32560] …and judged over the loaders
    // too where `get` judges it so.
    if (judgesLoaderSlots(this.registry.get(type), type, name, packageId)) {
      const { data, degraded, errors } = await this.loadSlottedDiagnosed(type, name, packageId);
      return { data: data ?? undefined, degraded, errors };
    }
    const entry = readStoreEntry(this.registry.get(type), type, name, packageId);
    if (entry.found) return { data: entry.data, degraded: false, errors: [] };

    // [#32246] A by-package type the registry cannot answer: read for the
    // package as on `get`, keeping the verdict.
    if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) {
      const { data, degraded, errors } = await this.loadSlottedDiagnosed(type, name, packageId);
      return { data: data ?? undefined, degraded, errors };
    }
    if (entry.settled) return { data: undefined, degraded: false, errors: [] };

    // Fallback to loaders, keeping the verdict this time.
    const { data, degraded, errors } = await this.loadDiagnosed(type, name);
    return { data: data ?? undefined, degraded, errors };
  }

  /**
   * [ADR-0150 D3/D4, #32246] The answer to a read of a type stored per
   * `(package, name)` that the in-memory registry could not answer: the
   * holders of the name as one store ({@link slotViewOf} — the registry's
   * slots, then every loader's stored items), and the store's own rule over
   * them ({@link readStoreEntry}), as for the registry: a read naming a
   * package is that package's item — a loader's even beside another package's
   * registry slot — and ⛔ never another package's; a read naming none is
   * refused when two packages hold the name.
   *
   * `degraded` as on {@link loadDiagnosed}: a loader threw and nothing
   * answered with the item.
   *
   * @throws {PackageScopedNameRefusedError} a read naming no package of a name
   *   two or more packages store.
   */
  private async loadSlottedDiagnosed(
    type: string,
    name: string,
    packageId?: string | null,
  ): Promise<{ data: unknown | null; degraded: boolean; errors: string[] }> {
    const { slots, errors } = await this.loaderSlotsNamed(type, name);
    const loaderStore = slotStoreOf(type, name, slots);
    // [#32560] A package-less registry slot is the platform's when no loader
    // stores it — judged only over loaders that all answered: with one down,
    // the slot is read as the environment's, as before.
    const platformKeys = errors.length === 0 ? platformSlotsOf(this.registry.get(type), type, name, loaderStore) : undefined;
    // [#32791] A read naming none counts a stored row the boot pass stamped
    // with the host's package once, as the loaders store it.
    const view = this.slotViewOf(type, name, loaderStore, !isPackageCaller(packageId));
    const entry = readStoreEntry(view, type, name, packageId, platformKeys);
    return entry.found
      ? { data: entry.data, degraded: false, errors }
      : { data: null, degraded: errors.length > 0, errors };
  }

  /**
   * [ADR-0150 D3/D4, #32246] Every loader's stored items of `name`, a type
   * stored per `(package, name)`, each with the package it is held for
   * ({@link MetadataLoader.loadSlots}; a loader without it answers with its
   * one `load` body, read for the package that body carries), in loader
   * order. A loader that throws is reported in `errors` and skipped.
   */
  private async loaderSlotsNamed(
    type: string,
    name: string,
  ): Promise<{ slots: Array<{ packageId?: string; data: unknown }>; errors: string[] }> {
    const slots: Array<{ packageId?: string; data: unknown }> = [];
    const errors: string[] = [];
    for (const loader of this.loaders.values()) {
      try {
        if (typeof loader.loadSlots === 'function') {
          slots.push(...(await loader.loadSlots(type, name)));
          continue;
        }
        const result = await loader.load(type, name);
        if (result.data) slots.push({ packageId: indexedItemPackageId(result.data), data: result.data });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${loader.contract.name}: ${message}`);
        this.logger.warn(`Loader ${loader.contract.name} failed to load ${type}:${name}`, { error: e });
      }
    }
    return { slots, errors };
  }

  /**
   * [ADR-0150 D3/D4, #32246] The holders of `name` as one store: the
   * registry's slots of the name, then the loaders' stored items keyed as the
   * store keys them ({@link slotStoreOf}), what the registry (then an earlier
   * loader) holds kept over a later item of the same slot. Reads and removals
   * judge a name the registry cannot answer alone over this view.
   *
   * [ADR-0150 D4, #32791] `asStored`, for a read naming no package: a
   * registry slot of a package whose item is a stored package-less row
   * ({@link storedPackagelessRows}) stamped with that same package (the boot
   * pass stamps it with the host's package before it registers it), while a
   * loader still stores the row, is that row, not a holder of its own. It is
   * filed in the view as the store files a write that carries no package
   * ({@link packagelessWriteKeyOf}: the name's one holder's customization,
   * else the environment's own item) in place of the loader's copy of the
   * row, and keeps the write order of the registry slot it came from, so one
   * row is counted once, never as the host's package and as the environment.
   * A package's own item, a host's own item that no stored row is, an
   * unstamped row the registry's own write rule filed in its one holder's
   * slot (that holder's customization), and a row whose registration replaced
   * an item no loader handed out ({@link storedRowsOverOwnItems}: that item's
   * package holds the name) keep their slots. A removal judges
   * the view without `asStored`, so in that composition the read and the
   * removal naming no package do not count the same holders.
   */
  private slotViewOf(
    type: string,
    name: string,
    loaderStore: ReadonlyMap<string, unknown>,
    asStored = false,
  ): Map<string, unknown> {
    const registryStore = this.registry.get(type);
    const view = new Map<string, unknown>();
    const storedRows: Array<{ key: string; data: unknown }> = [];
    const storedKeys = new Set<string>();
    // [#32517] Each slot's member written last first: a slot no key of which
    // came from the registry answers its first member (`latestMemberOf`).
    if (registryStore) {
      for (const key of latestMembersFirst(registryStore, storeKeysNamed(registryStore, type, name))) {
        const data = registryStore.get(key);
        const stampedWith = slotPackageOf(key);
        if (
          asStored && stampedWith !== undefined && data !== null && typeof data === 'object'
          && this.storedPackagelessRows.has(data) && indexedItemPackageId(data) === stampedWith
          && !this.storedRowsOverOwnItems.has(data)
        ) {
          const stored = storeSlotKey(type, name, undefined, data);
          if (loaderStore.has(stored)) {
            storedRows.push({ key, data });
            storedKeys.add(stored);
            continue;
          }
        }
        view.set(key, data);
      }
    }
    for (const [key, data] of loaderStore) {
      if (!view.has(key) && !storedKeys.has(key)) view.set(key, data);
    }
    // [#32791] The row the boot pass primed, over the loader's copy of the
    // slot it fills (its holder's row: the customization shadows it, D4),
    // written when the registry's slot it came from was.
    const aliases = new Map<string, string>();
    for (const { key, data } of storedRows) {
      const at = packagelessWriteKeyOf(view, type, name, data);
      view.set(at, data);
      aliases.set(at, key);
    }
    // [#32560] "Written last" over the view is the registry's own order.
    inheritStoreWriteOrder(view, registryStore, aliases);
    return view;
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
    // [#7378 row 2] Fold before the cache/single-flight machinery, so the
    // two spellings join one read and one cache entry.
    return (await this.readList(canonicalMetadataServiceType(type))).items;
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
    // [#7378 row 2] Same fold as `list` — same read, narrowed differently.
    const { items, degraded, errors } = await this.readList(canonicalMetadataServiceType(type));
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
  /**
   * Merge one loader's answer for `type` into `items`, under the identity that
   * loader holds each item by.
   *
   * ## [#14205] The identity of a loader-held item is its ROW KEY
   *
   * Both plural readers used to key a loader's items by `body.name`, and admit
   * an item only when the body carried a string one:
   *
   * ```ts
   * if (itemAny && typeof itemAny.name === 'string' && !items.has(itemAny.name))
   * ```
   *
   * A body is not required to name itself. `register(type, name, data)` takes
   * the key as its ARGUMENT, and `assertMetadataRegisterContract` says in as
   * many words that "A document with NO `name` of its own is fine — the argument
   * is the key". An aggregated `defineView` container is exactly that: no own
   * `name` by design, identity carried in the row's `name` column.
   *
   * So the old gate dropped every such item the moment the registry went cold
   * and only the loader could answer — a persisted view container vanished from
   * `list('view')` after a restart, and `listDiagnosed()` called the short
   * answer complete because no loader had thrown. Same gate, same effect, in
   * `listForIndex()`: a nameless `api` row fell out of the endpoint index, where
   * a miss reads as "nothing declares this route".
   *
   * The repair is to ask the loader for the key instead of guessing it from the
   * body ({@link MetadataLoader.loadManyKeyed}), and to keep the key BESIDE the
   * body: nothing is written into a body that deliberately has none, so the
   * register contract's refusal of a disagreeing `data.name` still means what it
   * says.
   *
   * Nothing consumers see today changes shape. For any item that went through
   * `register()`, a `data.name` that exists is required to EQUAL the key, so the
   * keyed merge produces the identical map entry; what is new is only the
   * entries the old gate refused. The `loadMany()` fallback below is the
   * pre-#14205 behaviour verbatim, for loaders that cannot produce keys
   * (`RemoteLoader`'s wire format carries bodies only).
   *
   * Read failures are NOT caught here: `readListUncached` warns-and-continues,
   * `listForIndex` deliberately throws, and that difference is each caller's to
   * keep.
   */
  private async admitLoaderItems(
    loader: MetadataLoader,
    type: string,
    items: Map<string, unknown>
  ): Promise<void> {
    // [ADR-0150 D4] A registry entry's key can be a package slot; a loader's
    // item is shadowed by any registry entry of its NAME, as before.
    if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) return this.admitLoaderSlots(loader, type, items);
    const held = new Set([...items.keys()].map(storedNameOf));
    for (const entry of await this.loaderEntries(loader, type)) {
      if (held.has(entry.name)) continue;
      held.add(entry.name);
      items.set(entry.name, entry.data);
    }
  }

  /**
   * [ADR-0150 D4, #32246] {@link admitLoaderItems} for a type stored per
   * `(package, name)`: every item a loader stores ({@link loaderSlotEntries})
   * fills the slot of the package it is held for, keyed as the store keys it,
   * so two packages' stored items of one name are both listed, as the
   * registry lists them. What an earlier source (the registry, an earlier
   * loader) already holds shadows it, as before:
   *
   *  - a package's item, by that package's slot — or by the package-less slot
   *    when no package slot of its identity is held (a package's first item
   *    takes that slot over in the store);
   *  - an item held for no package, by any slot of its identity (D4: under a
   *    package-held name it is that holder's customization, never a second
   *    item).
   *
   * [#32517] A bundled type's member is shadowed by the SAME member only (a
   * slot's member, or the package-less slot's same member), so one package's
   * second locale is listed beside its first, as the store keys them
   * ({@link storeSlotKey}).
   *
   * One loader's own slots do not shadow each other.
   */
  private async admitLoaderSlots(loader: MetadataLoader, type: string, items: Map<string, unknown>): Promise<void> {
    const prior = new Set(items.keys());
    const heldIdentities = new Set<string>();
    const packageHeldIdentities = new Set<string>();
    for (const key of prior) {
      heldIdentities.add(keyIdentityOf(key) + memberSuffixOf(key));
      if (slotPackageOf(key) !== undefined) packageHeldIdentities.add(keyIdentityOf(key));
    }
    for (const entry of await this.loaderSlotEntries(loader, type)) {
      const key = storeSlotKey(type, entry.name, entry.packageId ?? indexedItemPackageId(entry.data), entry.data);
      const identity = keyIdentityOf(key);
      const member = memberSuffixOf(key);
      const shadowed = items.has(key) || (slotPackageOf(key) === undefined
        ? heldIdentities.has(identity + member)
        : prior.has(identity + member) && !packageHeldIdentities.has(identity));
      if (!shadowed) items.set(key, entry.data);
    }
  }

  /**
   * [ADR-0150 D4, #32246] Every item one loader stores for a type stored per
   * `(package, name)`, each with the package it is held for:
   * {@link MetadataLoader.loadManySlots} where the loader offers it, else
   * {@link loaderEntries} (one item per name, read for the package its body
   * carries).
   */
  private async loaderSlotEntries(
    loader: MetadataLoader,
    type: string,
  ): Promise<Array<{ name: string; data: unknown; packageId?: string }>> {
    if (typeof loader.loadManySlots !== 'function') return this.loaderEntries(loader, type);
    const entries: Array<{ name: string; data: unknown; packageId?: string }> = [];
    for (const entry of await loader.loadManySlots(type)) {
      if (!entry || typeof entry.name !== 'string' || entry.name === '') continue;
      entries.push(entry.packageId === undefined
        ? { name: entry.name, data: entry.data }
        : { name: entry.name, data: entry.data, packageId: entry.packageId });
    }
    return entries;
  }

  /**
   * Every named item one loader holds for `type`, in the loader's order, each
   * with its key: {@link MetadataLoader.loadManyKeyed} where the loader offers
   * it, else `loadMany` keyed by each body's own `name` (the pre-#14205
   * reading, for loaders that cannot produce keys). An item with no key is
   * left out, as {@link admitLoaderItems} always left it.
   */
  private async loaderEntries(loader: MetadataLoader, type: string): Promise<Array<{ name: string; data: unknown }>> {
    const entries: Array<{ name: string; data: unknown }> = [];
    if (typeof loader.loadManyKeyed === 'function') {
      for (const entry of await loader.loadManyKeyed(type)) {
        if (!entry || typeof entry.name !== 'string' || entry.name === '') continue;
        entries.push({ name: entry.name, data: entry.data });
      }
      return entries;
    }
    for (const item of await loader.loadMany(type)) {
      const itemAny = item as { name?: unknown } | null;
      if (itemAny && typeof itemAny.name === 'string' && itemAny.name !== '') entries.push({ name: itemAny.name, data: item });
    }
    return entries;
  }

  private async readListUncached(type: string): Promise<ListReadResult> {
    const items = new Map<string, unknown>();

    // From in-memory registry
    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const [key, data] of typeStore) {
        items.set(key, data);
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
        await this.admitLoaderItems(loader, type, items);
        this.reportLoaderReadRecovered(loader.contract.name);
      } catch (e) {
        // [commit c1d274de7] Same discrimination as `listNames`, and needed for the same
        // reason: `admitLoaderItems` refuses an ambiguous stem BEFORE it
        // contributes anything, so absorbing it here would drop every item
        // this loader holds into a `degraded` partial set — an authoring error
        // rendered as a storage outage, which is the one reading it must never
        // get. A real outage still degrades exactly as before.
        if (isAmbiguousMetadataStemError(e)) {
          throw e;
        }
        degraded = true;
        errors.push(`${loader.contract.name}: ${e instanceof Error ? e.message : String(e)}`);
        this.reportLoaderReadFailure(loader.contract.name, type, e);
      }
    }

    return { items: this.listedInSlotOrder(type, items), degraded, errors };
  }

  /**
   * [#32517] The order {@link list} answers `items` in. For a bundled type
   * stored per `(package, name)`, each slot's member a by-name read answers
   * first — the registry's member written last, else the first a loader
   * admitted (`MemoryLoader.loadManySlots` hands a slot's member saved last
   * first) — in the order the slots first appear, then every other member in
   * store order. Those first items are, in that order, the one item per slot
   * this list answered before a bundle's members had keys of their own, so a
   * served read that lays its own layers over this list (`GET /meta`, the
   * execution read) answers in the order it answered then. Every other type:
   * store order.
   */
  private listedInSlotOrder(type: string, items: ReadonlyMap<string, unknown>): unknown[] {
    if (!PACKAGE_SLOTTED_STORE_TYPES.has(type) || !isBundledStoreType(type)) return Array.from(items.values());
    const registryStore = this.registry.get(type);
    const firsts = new Map<string, string>();
    for (const key of items.keys()) {
      const slot = slotOfKey(key);
      if (firsts.has(slot)) continue;
      const latest = registryStore ? latestMemberOf(registryStore, slot) : undefined;
      firsts.set(slot, latest !== undefined && registryStore!.has(latest) && items.has(latest) ? latest : key);
    }
    const first = new Set(firsts.values());
    return [...first, ...[...items.keys()].filter((key) => !first.has(key))].map((key) => items.get(key));
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
        `(a known-partial listing is memoized far more briefly than a complete one), so a transient cause recovers on its ` +
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
  private async listForIndex(type: string, options?: { byPackage?: boolean }): Promise<unknown[]> {
    if (options?.byPackage) return this.listForPackageScopedIndex(type);
    const items = new Map<string, unknown>();

    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const [key, data] of typeStore) {
        items.set(key, data);
      }
    }

    for (const loader of this.loaders.values()) {
      // No try/catch, on purpose — see the doc comment above.
      await this.admitLoaderItems(loader, type, items);
    }

    return Array.from(items.values());
  }

  /**
   * [ADR-0150 D4, child E6] {@link listForIndex} for an index whose items are
   * addressed by `(package, name)` — the `api` endpoint index. Same sources,
   * same precedence (the in-memory registry first, then each loader in turn,
   * the first entry of a slot kept) and the same refusal to swallow a failed
   * read; what changes is the SLOT. A bare-name `Map` lets one package's item
   * overwrite another package's same-named item before the matcher ever sees
   * it, so each slot is `(package, name)` instead:
   *
   *  - an item that carries its package (`packageId` on its stored envelope, or
   *    the registry's `_packageId` stamp) fills that package's slot;
   *  - an item that carries none, under a name exactly one package holds here,
   *    is that holder's customization (ADR-0150 D4: a package-less row bearing
   *    a package-held name is never a second item), so it shares the holder's
   *    slot and the precedence above decides between them, as the bare-name
   *    map did;
   *  - an item that carries none, under a name no package holds, is the
   *    environment's own (D1 bucket 4) and fills the environment's slot;
   *  - [#31700] an item that carries none, under a name TWO or more packages
   *    hold here (packages of different namespaces, since the API narrowed to
   *    one holder per namespace), is a customization of no one holder: none is
   *    picked, so it fills the environment's slot. The store's write rule
   *    puts the same row there ({@link storeWriteKey}: a package-less write of
   *    a name two packages hold lands in the bare slot), so the index and the
   *    store agree on what that row is.
   *
   * Each holder keeps its own slot, so two namespaces' same-named APIs are
   * both indexed. They cannot claim one route between them: the publish gate
   * requires each path under `/api/v1/apps/<namespace>/`, so their paths
   * differ by namespace. Only the environment's row can share a holder's
   * METHOD + path, and the matcher's duplicate-claim rule decides that,
   * announced at `error`. No name is resolved here: a request carries no
   * caller package, and the matcher keys its routes by METHOD + path
   * (bucket 1).
   */
  private async listForPackageScopedIndex(type: string): Promise<unknown[]> {
    // [#32246] Every item a loader stores, each with the package the loader
    // holds it for, else the one its body carries.
    const entries: Array<{ name: string; data: unknown; packageId?: string }> = [];
    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const [key, data] of typeStore) entries.push({ name: storedNameOf(key), data });
    }
    for (const loader of this.loaders.values()) {
      // No try/catch, on purpose — see {@link listForIndex}.
      entries.push(...(await this.loaderSlotEntries(loader, type)));
    }

    const holders = new Map<string, Set<string>>();
    for (const { name, data, packageId: heldFor } of entries) {
      const packageId = heldFor ?? indexedItemPackageId(data);
      if (packageId === undefined) continue;
      let held = holders.get(name);
      if (!held) holders.set(name, (held = new Set()));
      held.add(packageId);
    }

    const slots = new Map<string, unknown>();
    for (const { name, data, packageId: heldFor } of entries) {
      const held = holders.get(name);
      const slotPackage = heldFor ?? indexedItemPackageId(data) ?? (held?.size === 1 ? [...held][0] : '');
      const slot = `${slotPackage}\u0000${name}`;
      if (!slots.has(slot)) slots.set(slot, data);
    }
    return Array.from(slots.values());
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
  async unregister(type: string, name: string, options?: MetadataUnregisterOptions): Promise<void> {
    return this.unregisterAt(type, name, options);
  }

  /**
   * [ADR-0150 D3/D4, #32198, #32246] What {@link unregister} removes, judged
   * before anything is touched: the registry's keys `storeRemovalKeys` picks,
   * and the package a removal names. For a type stored per `(package, name)`
   * removed with no package, the holders are judged over the registry AND the
   * loaders' stored items of the name ({@link slotViewOf}, as a read judges
   * them): a name two packages hold only in the loaders (an empty registry
   * over stored rows, a cluster peer after its replay) is refused here, with
   * the `409` naming every holder, where the storage loop would have caught
   * each loader's own refusal as a failed delete and announced a removal that
   * never happened. Every loader's holders of the name are within this view,
   * so a loader the removal deletes from does not refuse once it has passed.
   * [#32352] That includes an action's object-bound slots: holders are counted
   * by package over every slot of the name, as `DatabaseLoader`'s row key
   * `(package, name)` counts them, so a name two packages hold on one object
   * or on two is refused here rather than by the loader's `delete` after the
   * registry had already dropped it and announced `deleted`.
   *
   * @throws {PackageScopedNameRefusedError} no package named, two or more
   *   packages holding the name in the registry or the loaders.
   */
  private async removalOf(
    type: string,
    name: string,
    packageId?: string | null,
  ): Promise<{ keys: string[]; packageId?: string; packagelessOnly?: true }> {
    const registryStore = this.registry.get(type);
    const removal = storeRemovalKeys(registryStore, type, name, packageId);
    if (!PACKAGE_SLOTTED_STORE_TYPES.has(type) || removal.packageId !== undefined) return removal;
    const { slots, errors } = await this.loaderSlotsNamed(type, name);
    const loaderStore = slotStoreOf(type, name, slots);
    // [#32560] Judged as a read naming none judges it: a package-less
    // registry slot no loader stores is the platform's (refused beside a
    // package), and beside one package the removal takes the package-less
    // slots the read answers — of the registry's, those the view's rule
    // picks. That judgment is carried to every loader's delete and to every
    // peer (`packagelessOnly`): each loader judges by its OWN slots, and one
    // holding the package's item alone (the artifact door's store) would
    // otherwise take it.
    const platformKeys = errors.length === 0 ? platformSlotsOf(registryStore, type, name, loaderStore) : undefined;
    const judged = storeRemovalKeys(this.slotViewOf(type, name, loaderStore), type, name, undefined, platformKeys);
    return {
      keys: judged.keys.filter((key) => registryStore?.has(key) === true),
      ...(judged.packagelessOnly ? { packagelessOnly: true as const } : {}),
    };
  }

  /**
   * {@link unregister}, given what it removes.
   *
   * [ADR-0150 D3/D4, #32198] `removal` is the store keys the in-memory half
   * drops and, for a type stored per `(package, name)` removed by one package,
   * that package: the storage half deletes only its row, and the realtime
   * `deleted` event names it. {@link unregisterPackage} passes the entry it
   * found; {@link unregister} judges it with {@link removalOf} — BEFORE
   * anything is touched, so a refused removal (a name two packages hold, with
   * no package named) deletes nothing from storage or memory and announces
   * nothing.
   */
  private async unregisterAt(
    type: string,
    name: string,
    options?: MetadataUnregisterOptions,
    removal?: { keys: readonly string[]; packageId?: string },
  ): Promise<void> {
    // [#7378 row 2] Remove from the store `register` wrote: the canonical type.
    type = canonicalMetadataServiceType(type);
    const judged: { keys: readonly string[]; packageId?: string; packagelessOnly?: true } =
      removal ?? (await this.removalOf(type, name, options?.packageId));
    const { keys, packageId } = judged;
    // [#32560] How each loader's delete (and each peer's) is scoped.
    const scope: ClusterMetadataRemoval = packageId !== undefined
      ? { packageId }
      : judged.packagelessOnly ? { packagelessOnly: true } : {};
    // ── 1. Storage first ────────────────────────────────────────────────
    // Delete from database-backed loaders that declare write capability, and
    // [ADR-0150 D4, #32246, #32353] from the in-memory loaders (the artifact
    // door's store), for every type: their copy of the removed item would
    // otherwise keep answering every read once the registry's entry is gone.
    for (const loader of this.loaders.values()) {
      if (!isRemovalTarget(loader)) continue;
      // [#5276] Defensive only — unreachable for a registered loader. This exact
      // combination (`datasource:` + `capabilities.write`, no `delete`) is
      // rejected by `registerLoader()`, the sole writer of `this.loaders`, so
      // reaching this `continue` would mean a loader entered the map without
      // passing the gate. Kept because the alternative is a TypeError on the
      // line below, and because `delete?` stays optional on the interface for
      // the protocols the gate does not cover.
      if (typeof loader.delete !== 'function') continue;
      try {
        await this.deleteMetaItemFromLoader(loader, type, name, scope);
      } catch (error) {
        this.reportMetaItemDeleteFailure(loader.contract.name, type, name, error);
      }
    }

    // ── 2. In-memory state, then invalidation — nothing awaited between ──
    // [ADR-0150 D4] Every slot of the name, or only the package's own when
    // one package's item is removed.
    this.deleteRegistryEntries(type, name, keys);
    this.invalidateListCache(type);

    // ── 3. Announce ─────────────────────────────────────────────────────
    // Publish metadata.{type}.deleted event to realtime service.
    // [ADR-0150 D4, #32198] One package's slot removed names that package, so
    // a listener drops that package's item and keeps another package's
    // same-named one. ⛔ The watcher event below carries no package: the
    // spec's `MetadataWatchEvent` declares no such field.
    await this.publishRealtimeMetadataEvent('deleted', type, name, {
      packageId,
      userId: options?.userId,
    });

    // Announce last, once the removal has landed everywhere (see register()).
    // [#32499] The cluster fan-out marks it a removal, with the package it
    // named, so each peer deletes its own in-memory copy by the same key.
    // [#32560] Or with the package-less-only judgment, so a peer's door
    // keeps the package's item the removal did not take.
    if (options?.notify !== false) {
      this.notifyWatchers(type, {
        type: 'deleted',
        metadataType: type,
        name,
        path: '',
        data: undefined,
        timestamp: new Date().toISOString(),
      }, scope);
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
    scope: ClusterMetadataRemoval,
  ): Promise<void> {
    const del = loader.delete;
    if (typeof del !== 'function') return;
    // [ADR-0150 D4, #32198] One package's item of a type stored per
    // `(package, name)`: the loader deletes only that package's row.
    // [ADR-0150 D3, #32560] A removal naming none judged to take the
    // environment's own item only: the loader deletes the name's package-less
    // slots only. Every other delete keeps its by-name call, byte for byte.
    if (scope.packageId !== undefined) await del.call(loader, type, name, { packageId: scope.packageId });
    else if (scope.packagelessOnly) await del.call(loader, type, name, { packagelessOnly: true });
    else await del.call(loader, type, name);
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
    // [#7378 row 2] Same store `get` reads: the canonical type.
    type = canonicalMetadataServiceType(type);
    // Check in-memory registry (any slot of the name)
    if (storeKeysNamed(this.registry.get(type), type, name).length > 0) {
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
   *
   * ## [commit a56baa2bd] One loader's fault does not take the whole enumeration down
   *
   * This loop used to be bare — `const result = await loader.list(type)` with
   * no `try`, while the two sibling plural reads (`list()` via
   * {@link admitLoaderItems}, and {@link loadMany}) have carried a per-loader
   * `catch` since #5108. That asymmetry is the defect, independent of any one
   * caller: the SAME storage outage was swallowed by one plural read and
   * thrown out of the other, so which answer a caller got depended only on
   * which method it happened to call. A caller reading both — the action
   * governance audit is one — saw `loadMany` report a short-but-successful
   * set and `listNames` throw, and had no way to tell that one fact was
   * behind both.
   *
   * Same shape as `loadMany`'s, deliberately, down to the helpers: the outage
   * is spoken once per loader through {@link reportLoaderReadFailure} and
   * un-said through {@link reportLoaderReadRecovered}. ⛔ Not a third spelling
   * for "a loader faulted" — a second vocabulary for one event is how the two
   * reads drifted apart in the first place.
   *
   * The degradation is the same one `list()` documents and is graded the same
   * way (AGENTS.md → "Degradation log levels"): the caller still gets an
   * array, nothing 500s, and the set is quietly short — so it is reported at
   * `error`, by the shared helper, rather than being re-graded here.
   */
  async listNames(type: string): Promise<string[]> {
    // [#7378 row 2] Same store `get` reads: the canonical type.
    type = canonicalMetadataServiceType(type);
    const names = new Set<string>();

    // From in-memory registry
    const typeStore = this.registry.get(type);
    if (typeStore) {
      for (const key of typeStore.keys()) {
        names.add(storedNameOf(key));
      }
    }

    // From loaders
    for (const loader of this.loaders.values()) {
      try {
        const result = await loader.list(type);
        result.forEach(item => names.add(item));
        this.reportLoaderReadRecovered(loader.contract.name);
      } catch (e) {
        // [commit c1d274de7] PROPAGATE, never absorb: an ambiguous metadata stem is an
        // authoring error, not an outage. Degrading it here would answer with
        // a set that silently omits every name this loader holds while the
        // server keeps reporting healthy — precisely the silence the refusal
        // exists to end, moved one layer up. Everything else still degrades.
        if (isAmbiguousMetadataStemError(e)) {
          throw e;
        }
        // [commit a56baa2bd] Parity with `loadMany` and `list()` — see this method's
        // docblock. Same seam, same verdict, same helper.
        this.reportLoaderReadFailure(loader.contract.name, type, e);
      }
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
   * This method returns the `package` layer that was registered from source;
   * runtime-authored views are `view` overlays in `sys_metadata`, served by the
   * protocol's `getMetaItems`, not by this method.
   *
   * ## [#13913] Aggregated containers are expanded inline, per read
   *
   * `this.list('view')` is `MetadataManager`'s OWN loader-based store — the
   * in-memory registry plus every registered loader — and is a completely
   * different store from the `sys_metadata` rows `getMetaItems` reads. #13407
   * taught `getMetaItems` to expand a runtime-authored aggregated container
   * inline; this exit never called it and had no equivalent step, so a
   * container that `GET /meta/view?object=` now serves still answered **empty**
   * here.
   *
   * Merely getting the container into the store would not have helped: the
   * filter also requires `viewKind`, and a container has none. Loosening that
   * requirement is NOT the repair — it would answer with the container itself
   * as a view, the behaviour #7163 ruled wrong — so what is added below is the
   * container's **expansion**, whose items each carry the `viewKind` + `object`
   * pair this filter has always tested. The filter itself is untouched: it
   * reads the top-level `object`, exactly as `ViewSchema.object` declares.
   *
   * Registry-free and per-read, mirroring #13407's choice at the other exit and
   * for the same reason — the registry is process-wide, so a read must not
   * graft rows into it (see `view-container-expansion.ts`'s header, which also
   * records why the protocol's copy of this logic cannot be imported).
   *
   * Already-present items win: an expansion contributes only names the store
   * does not already hold, so a container whose expanded ViewItems were
   * registered by a source registrar (the ObjectQL boot loop, the artifact/HMR
   * loader) still answers with those registered, fully-enriched items and this
   * step adds nothing.
   */
  async getViewsByObject(object: string): Promise<unknown[]> {
    const views = await this.list('view');
    const matches = views.filter(
      (v: any) =>
        v && typeof v === 'object' && v.viewKind && v.object === object,
    );

    // Every name the store already holds — containers included, though a
    // container is keyed by the bare `<object>` and can never collide with the
    // `<object>.<key>` names an expansion mints.
    const known = new Set<string>();
    for (const v of views as any[]) {
      if (v && typeof v === 'object' && typeof v.name === 'string') known.add(v.name);
    }

    for (const v of views) {
      for (const item of expandRuntimeViewContainer(v)) {
        if (!item.viewKind || item.object !== object) continue;
        if (known.has(item.name)) continue;
        known.add(item.name);
        matches.push(item);
      }
    }

    return matches.sort(
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
   *
   * [#32198] A package's items are selected by the one membership rule the
   * package-wide verbs share ({@link isPackageMember}): `packageId`, `package`
   * or `_packageId`. An item a code-shipped artifact registered carries only
   * `_packageId`, and reading the first two alone left every such item behind.
   *
   * [ADR-0150 D4] Each is removed by its store key, so a type stored per
   * `(package, name)` drops this package's slot and keeps another package's
   * same-named item — and, for such a type, the storage half deletes only this
   * package's row and the `deleted` event names this package.
   */
  async unregisterPackage(packageName: string): Promise<void> {
    // Collect all items to delete (type and name pairs). [#32517] One entry
    // per slot: a bundled type's members of one slot are removed together,
    // with the one `deleted` announcement the slot made before.
    const itemsToDelete = new Map<string, { type: string; name: string; keys: string[] }>();

    for (const [type, typeStore] of this.registry) {
      const slotted = PACKAGE_SLOTTED_STORE_TYPES.has(type);
      for (const [key, data] of typeStore) {
        // [#32246] A by-package type: also every item in the package's slot,
        // a package-less customization of its item (D4) included.
        if (isPackageMember(data, packageName) || (slotted && slotPackageOf(key) === packageName)) {
          const slot = `${type}\u0000${slotOfKey(key)}`;
          const entry = itemsToDelete.get(slot);
          if (entry) entry.keys.push(key);
          else itemsToDelete.set(slot, { type, name: storedNameOf(key), keys: [key] });
        }
      }
    }

    // Delete each item using unregister() to ensure deletion from both registry and loaders
    for (const { type, name, keys } of itemsToDelete.values()) {
      await this.unregisterAt(type, name, undefined, {
        keys,
        ...(PACKAGE_SLOTTED_STORE_TYPES.has(type) ? { packageId: packageName } : {}),
      });
    }
  }

  /**
   * [#22113] The registry items that belong to `packageId`, for the two
   * package-wide writes ({@link publishPackage}, {@link revertPackage}).
   *
   * An item belongs to a package when any of three keys names it:
   *
   *  - `packageId` — the publish envelope's own key, and what a caller that
   *    registers an item for a package writes;
   *  - `package` — the legacy package stamp;
   *  - `_packageId` — the private provenance stamp. `applyProtection`
   *    (`@objectstack/spec/shared`, ADR-0010 §3.7) writes it on every item a
   *    code-shipped artifact registers here, and the ObjectQL object bridge
   *    copies it onto every object it registers here. A code-shipped item
   *    carries ONLY this key, and it is the key the metadata protocol scopes
   *    this registry's items by when it serves a package's reads.
   *
   * Reading the first two alone made a package's publish and revert miss
   * every item that carries only the stamp ("No metadata items found" while
   * every read served them).
   *
   * ⛔ Not a writability check. This class has no package-kind concept, so it
   * cannot tell a read-only code package (ADR-0070 D2) from a writable one,
   * and with the stamp read it would publish a code package's items like any
   * other. The refusal belongs to the caller that holds the predicate: the
   * `POST /packages/:id/publish` and `/revert` doors (`@objectstack/runtime`)
   * refuse a non-writable package with `422 WRITABLE_PACKAGE_REQUIRED` before
   * calling either method.
   */
  private collectPackageMembers(packageId: string): Array<{ type: string; name: string; data: any }> {
    const members: Array<{ type: string; name: string; data: any }> = [];
    for (const [type, typeStore] of this.registry) {
      for (const [key, data] of typeStore) {
        if (isPackageMember(data, packageId)) {
          members.push({ type, name: storedNameOf(key), data });
        }
      }
    }
    return members;
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

    // Collect all items belonging to this package — the same membership
    // `revertPackage` reads. A read-only code package never gets here through
    // the publish door, which refuses it first (see `collectPackageMembers`).
    const packageItems = this.collectPackageMembers(packageId);

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
    // [ADR-0138 D2b] …and the one cross-item gate, ALWAYS for the same reason:
    // an anonymous endpoint of `type: 'flow'` that names a `runAs: 'system'`
    // flow is refused, in both directions, whichever of the two this package
    // carries. See `gateAnonymousElevatedFlowsForPublish`.
    validationErrors.push(...await this.gateAnonymousElevatedFlowsForPublish(packageItems));

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
   * [ADR-0138 D2b] The anonymous door × elevated flow refusal, on the package
   * publish — the metadata layer's door for both of its items.
   *
   * The record refuses an `authRequired: false` endpoint of `type: 'flow'`
   * whose target flow declares `runAs: 'system'`, "in both directions, because
   * either item can be the last one edited". This door publishes both kinds of
   * item, so it holds both directions:
   *
   *  - an `api` item of the package that names such a flow — wherever the flow
   *    is, in this package or anywhere else in the index — is refused with the
   *    endpoint's message;
   *  - a `flow` item of the package declaring `runAs: 'system'` that an
   *    anonymous endpoint OUTSIDE the package names is refused with the flow's
   *    message (a pair inside the package is reported once, at the endpoint).
   *
   * The other item is read from the index the endpoint matcher serves from
   * ({@link listForIndex}: the registry and every loader), so the pair is
   * judged against what is declared, not only against this package. Bodies
   * are peeled ({@link peelStoredEnvelope}) as the endpoint gate above peels
   * them, and read structurally by the one judge in `@objectstack/spec/api`:
   * the stack parse and the metadata protocol's flow publish call the same
   * function, so the three doors cannot disagree about the pair. A read that
   * fails propagates (`listForIndex` rethrows), so the publish fails instead
   * of answering "nothing names it" from a read that never happened.
   *
   * Not governed by `options.validate`, like the endpoint gates: a security
   * refusal with an opt-out flag is no refusal.
   */
  private async gateAnonymousElevatedFlowsForPublish(
    packageItems: Array<{ type: string; name: string; data: any }>,
  ): Promise<Array<{ type: string; name: string; message: string }>> {
    /** The package's own `api` and `flow` names: the registry key, and the body's `name`. */
    const packageEndpointNames = new Set<string>();
    const packageFlowNames = new Set<string>();
    for (const item of packageItems) {
      const names = packageNamesOf(item);
      if (item.type === MetadataManager.ENDPOINT_METADATA_TYPE) names.forEach((n) => packageEndpointNames.add(n));
      else if (item.type === MetadataManager.FLOW_METADATA_TYPE) names.forEach((n) => packageFlowNames.add(n));
    }
    if (packageEndpointNames.size === 0 && packageFlowNames.size === 0) return [];

    const bodies = (items: unknown[]) => items.map((item) => peelStoredEnvelope(item).body);
    const endpoints = bodies(
      await this.listForIndex(MetadataManager.ENDPOINT_METADATA_TYPE, { byPackage: true }),
    ) as AnonymousFlowDoorCandidate[];
    const flows = bodies(await this.listForIndex(MetadataManager.FLOW_METADATA_TYPE)) as ElevatedFlowCandidate[];

    const errors: Array<{ type: string; name: string; message: string }> = [];
    /** flow name → the outside endpoints that name it, for the flow-direction message. */
    const outsideEndpointsByFlow = new Map<string, Set<string>>();
    const reportedEndpoints = new Set<string>();
    for (const pair of anonymousElevatedFlowPairs(endpoints, flows)) {
      if (packageEndpointNames.has(pair.endpoint)) {
        const key = `${pair.endpoint} -> ${pair.flow}`;
        if (reportedEndpoints.has(key)) continue;
        reportedEndpoints.add(key);
        errors.push({
          type: MetadataManager.ENDPOINT_METADATA_TYPE,
          name: pair.endpoint,
          message: anonymousEndpointElevatedFlowMessage(pair.endpoint, pair.flow),
        });
        continue;
      }
      if (!packageFlowNames.has(pair.flow)) continue;
      const named = outsideEndpointsByFlow.get(pair.flow) ?? new Set<string>();
      named.add(pair.endpoint);
      outsideEndpointsByFlow.set(pair.flow, named);
    }
    for (const [flow, named] of outsideEndpointsByFlow) {
      errors.push({
        type: MetadataManager.FLOW_METADATA_TYPE,
        name: flow,
        message: elevatedFlowAnonymousEndpointsMessage(flow, [...named]),
      });
    }
    return errors;
  }

  /**
   * Revert entire package to last published state.
   * Restores all metadata definitions from their published snapshots.
   */
  async revertPackage(packageId: string): Promise<void> {
    const packageItems = this.collectPackageMembers(packageId);

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
   *
   * [#20552] SERVED, and so redacted: this is the body both
   * `GET /meta/:type/:name/published` doors answer with when no runtime overlay
   * exists (the REST server's and the dispatcher's), and it was the one
   * metadata exit that handed a stored body out without the per-type
   * credential redaction every protocol read exit applies — a code-published
   * `api` flow served its inbound-hook secret here to any reader of the door.
   * The type's registered redactor (`@objectstack/spec/kernel`) is applied to
   * whichever body is returned; a type with none is returned as-is. The item
   * itself is never mutated — a redactor returns a new object.
   *
   * ⛔ Not caught: a throwing redactor fails the read rather than serving the
   * material it exists to withhold (the metadata protocol's
   * `redactMetadataItem` takes the same position).
   *
   * [#32183] `packageId`, when given, is read as {@link get} reads it: the
   * package's own copy of a type stored per `(package, name)`. Both `/published`
   * doors pass it for a name a disabled package also holds, so the store's own
   * two-holder refusal never names a package the registry does not serve.
   */
  async getPublished(type: string, name: string, packageId?: string | null): Promise<unknown | undefined> {
    const item = await this.get(type, name, packageId);
    if (!item) return undefined;

    const meta = item as any;
    // Fall back to current definition (metadata field or the item itself)
    const body = meta.publishedDefinition !== undefined ? meta.publishedDefinition : (meta.metadata ?? item);
    return this.redactServedBody(type, body);
  }

  /**
   * [#20552] The per-type read-path redaction, applied to one served body.
   *
   * The body can carry this layer's own bookkeeping beside the authored
   * document (`packageId`, `state`, and the publish keys: the fallback serves
   * the stored row itself, and a publish snapshot copies it whole). Those keys
   * are not the type's vocabulary ({@link STORED_ENVELOPE_KEYS}), and a
   * redactor that withholds every key its type does not declare would withhold
   * them too. So the redactor is handed the authored document alone, and the
   * bookkeeping is served beside its answer.
   *
   * Only a SCALAR bookkeeping value is served unchanged. A publish snapshot
   * copies the whole row, so a row published again carries the previous
   * snapshot under `publishedDefinition`: that value is a document of the same
   * type, and it is served through this same redaction, at every depth. Any
   * other bookkeeping value that is not a scalar is not served: no envelope key
   * but `publishedDefinition` holds a document, and nothing here can judge one.
   */
  private redactServedBody(type: string, body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    // Keyed on the singular type name (Prime Directive #3); a plural spelling folds first.
    const redactor = getMetadataTypeRedactor(canonicalMetadataServiceType(type));
    if (!redactor) return body;
    return redactServedDocument(redactor, body as Record<string, unknown>);
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
  // Overlay / Customization Management — REMOVED (commit 9e0ba21a1, ADR-0049)
  // ==========================================
  //
  // The in-memory overlay limb (`getOverlay` / `saveOverlay` / `removeOverlay`
  // / `getEffective`, keyed `type:name:scope`) implemented the paper
  // metadata-customization protocol removed from `@objectstack/spec` in the
  // same change: no route ever served the paper `.../overlay` or
  // `.../effective` endpoints, and the only callers of these methods were this
  // package's own unit tests. ADR-0126 supersedes the protocol on the record.
  // The org-scoped customization that actually ships is ADR-0005's
  // `sys_metadata` overlay (`getMetaItemLayered` in metadata-protocol), which
  // never lived here.

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
    // [#7378 row 2] Announcements are made under the canonical type (register/
    // unregister fold before notifyWatchers), so a subscription under the
    // plural spelling must land on the same key or it would never fire.
    type = canonicalMetadataServiceType(type);
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

    // Merge declarative (live registry entry — the built-in
    // `DEFAULT_METADATA_TYPE_REGISTRY`, the registry's only production writer;
    // the plugin-contributed `additionalTypes` channel this comment used to
    // claim never existed and was retired by #8586) + plugin-registered
    // type-level actions. Deduped by name; imperatively-registered actions win on
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
   * [#32488] The name of the loader {@link loadMany} read `item` — that very
   * object — from; `undefined` for an object it did not hand out. The boot
   * priming pass asks it so that, of two loaders' items stored under one
   * identity once the host's package is stamped, the earlier loader's item
   * keeps the entry (`MetadataPlugin`'s pass).
   */
  sourceLoaderOf(item: object): string | undefined {
    return this.loadedFrom.get(item)?.contract.name;
  }

  /**
   * Load multiple metadata items from loaders.
   * Aggregates results from all loaders.
   */
  async loadMany<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<T[]> {
    // [#31699 R3-B] A bundled type stored per `(package, name)` keeps one item
    // per `(package, name, member)` (`bundleEntryKey`), never one per name.
    // [#32517] An unbundled one keeps one per `(package, name)`
    // (`pluralEntryKeys`): keyed by name alone, two packages' items of one
    // name were folded into the first loader's one. Every other type: one per
    // name, the first loader's, as before.
    const gathered: Array<{ item: T; loader: MetadataLoader }> = [];

    for (const loader of this.loaders.values()) {
        try {
            // [#31699 R4-B; epic ruling 6799056319] A bundled type stored per
            // `(package, name)` reads the loader's keyed entries where it has
            // them: a row bound to its package by the `package_id` column alone
            // (as the metadata protocol writes it) carries no stamp in its body,
            // so only the entry's `packageId` keeps two packages' same member
            // apart. Such a body is handed on stamped with that package
            // (`_packageId`, the column's package and only the column's, as the
            // protocol's own read binds a row), so a caller that registers it
            // back — the boot priming pass — fills that package's slot and its
            // member's row, never a package-less one.
            // [#32458] An unbundled type stored per `(package, name)` (`api`,
            // `agent`, `skill`, `action`, `permission`) keeps every body the
            // loader's `loadMany` answers, a body its keyed read cannot name
            // included, and stamps each one the loader holds for a package the
            // same way ({@link withLoaderEntryPackages}): handed on unstamped,
            // such a row filled the name's package-less slot, and with two
            // holders its save inserted a package-less row.
            const items = PACKAGE_SLOTTED_STORE_TYPES.has(type) && isBundledStoreType(type) && typeof loader.loadManyKeyed === 'function'
                ? (await loader.loadManyKeyed<T>(type, options)).map((entry) => withEntryPackage(entry))
                : PACKAGE_SLOTTED_STORE_TYPES.has(type)
                    ? await withLoaderEntryPackages(loader, type, await loader.loadMany<T>(type, options), options)
                    : await loader.loadMany<T>(type, options);
            for (const item of items) gathered.push({ item, loader });
            this.reportLoaderReadRecovered(loader.contract.name);
        } catch (e) {
            // [#5108] Same seam, same verdict as `list()` — see
            // {@link reportLoaderReadFailure}. Two adjacent plural reads
            // reporting one storage outage at two different levels is how the
            // wrong one gets copied.
            this.reportLoaderReadFailure(loader.contract.name, type, e);
        }
    }
    const keys = pluralEntryKeys(type, gathered.map(({ item }) => ({ name: (item as { name?: unknown } | null)?.name, data: item })));
    const kept = new Set<string>();
    const results: T[] = [];
    gathered.forEach(({ item, loader }, at) => {
        const key = keys[at];
        if (key !== undefined) {
            if (kept.has(key)) return;
            kept.add(key);
        }
        results.push(item);
        if (item !== null && typeof item === 'object') {
          this.loadedFrom.set(item, loader);
          // [#32791] Read here, before any caller stamps it.
          if (PACKAGE_SLOTTED_STORE_TYPES.has(type) && loader.contract.protocol === 'datasource:' && indexedItemPackageId(item) === undefined) {
            this.storedPackagelessRows.add(item);
          }
        }
    });
    return results;
  }

  /**
   * [commit a56baa2bd] {@link loadMany}, read under the identity the STORE holds each
   * item by — the keyed plural read, beside the unkeyed one.
   *
   * ## Why a second method and not a widened `loadMany`
   *
   * `loadMany` keys nothing: it returns bodies, and every consumer that needs
   * an identity reads `body.name` off them. #14205 already ruled what identity
   * IS — the key the store holds the item under (`register(type, name, data)`
   * takes it as the ARGUMENT, and a body is not required to name itself) — so
   * `body.name` is a guess that happens to be right for most items and drops
   * the rest ENTIRELY: an item whose body carries no `name` is served by
   * `load(type, name)` and is not nameable from `loadMany`'s answer at all.
   *
   * Widening `loadMany`'s return would fix that and break every consumer of a
   * published shape (the ones counted on this card all read `body.name` as the
   * identity). So this is additive: `loadMany`'s return shape is untouched,
   * and a caller that needs the key asks for the key.
   *
   * ## What it reads — the same population `loadMany` reads
   *
   * Loaders only, deliberately, so this is `loadMany` keyed and nothing more.
   * It is NOT `list()`/{@link listNames}, which also merge the in-memory
   * `register()` registry; a caller wanting that set has those. Reading the
   * loaders alone is also what makes this the enumerable twin of
   * {@link loadDiagnosed}, which walks the same loaders by name — that pairing
   * is the point on the audit side of commit a56baa2bd, where an enumeration and a
   * by-name read that disagree about a population make one subsystem accuse
   * another of a defect neither has.
   *
   * ## Delegate first, fall back second — and why that order is not a style
   *
   * Per loader: {@link MetadataLoader.loadManyKeyed} where the loader offers
   * one, else its `list()` + a per-name `load()`. Measured, on
   * `DatabaseLoader`: the keyed method shares `loadMany`'s single query
   * (`{find:1, findOne:0}` — zero extra cost), while enumerate-then-read-each
   * on that same loader is a real N+1 (`{find:1, findOne:5}` for five items).
   * The fallback exists for loaders that cannot produce keys at all
   * (`RemoteLoader`'s wire format carries bodies only), and it recovers the
   * nameless item the pre-#14205 `loadMany`-and-key-by-`body.name` fallback
   * drops — which is why it is `list()` + `load()` and not `loadMany()`.
   *
   * ## Failure posture
   *
   * Per-loader `try`/`catch`, the same seam and the same helpers as
   * {@link loadMany} and `list()` — one loader's outage does not take the
   * enumeration down, and it is reported once through
   * {@link reportLoaderReadFailure} rather than in a third vocabulary.
   * Earlier loaders win a key collision, mirroring `list()`.
   */
  async loadManyKeyed<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<MetadataKeyedItem<T>[]> {
    // [#32517] An unbundled type stored per `(package, name)`: one entry per
    // `(package, name)` over every loader (`pluralEntryKeys`), as `loadMany`.
    if (PACKAGE_SLOTTED_STORE_TYPES.has(type) && !isBundledStoreType(type)) return this.loadManyKeyedSlotted<T>(type, options);
    // Keyed by name — or, [#31699 R3-B] for a bundled type stored per
    // `(package, name)`, by `(package, name, member)` (`bundleEntryKey`).
    const items = new Map<string, MetadataKeyedItem<T>>();

    for (const loader of this.loaders.values()) {
      try {
        await this.admitKeyedLoaderItems<T>(loader, type, items, options);
        this.reportLoaderReadRecovered(loader.contract.name);
      } catch (e) {
        // Same seam, same verdict as `loadMany` and `list()`.
        this.reportLoaderReadFailure(loader.contract.name, type, e);
      }
    }

    return Array.from(items.values());
  }

  /**
   * [#32517] {@link loadManyKeyed} for an unbundled type stored per
   * `(package, name)`: every loader's keyed entries (each with the package
   * its loader holds it for), then one entry per `(package, name)`
   * ({@link pluralEntryKeys}): two packages' items of one name are both
   * answered, and a one-holder name answers the first loader's entry, as
   * before. Same failure posture as {@link loadManyKeyed}.
   */
  private async loadManyKeyedSlotted<T = any>(type: string, options?: MetadataLoadOptions): Promise<MetadataKeyedItem<T>[]> {
    const gathered: MetadataKeyedItem<T>[] = [];
    for (const loader of this.loaders.values()) {
      try {
        if (typeof loader.loadManyKeyed === 'function') {
          for (const entry of await loader.loadManyKeyed<T>(type, options)) {
            if (entry && typeof entry.name === 'string' && entry.name !== '') gathered.push(entry);
          }
        } else {
          for (const name of await loader.list(type)) {
            if (typeof name !== 'string' || name === '') continue;
            const result = await loader.load(type, name, options);
            if (result?.data != null) gathered.push({ name, data: result.data as T });
          }
        }
        this.reportLoaderReadRecovered(loader.contract.name);
      } catch (e) {
        this.reportLoaderReadFailure(loader.contract.name, type, e);
      }
    }
    const keys = pluralEntryKeys(type, gathered);
    const kept = new Set<string>();
    const out: MetadataKeyedItem<T>[] = [];
    gathered.forEach((entry, at) => {
      const key = keys[at]!;
      if (kept.has(key)) return;
      kept.add(key);
      out.push({ name: entry.name, data: entry.data });
    });
    return out;
  }

  /**
   * Merge ONE loader's answer for `type` into `items`, keyed by that loader's
   * own key for each item — {@link loadManyKeyed}'s per-loader body.
   *
   * Distinct from {@link admitLoaderItems} on exactly one axis, and that axis
   * is the whole of the defect commit a56baa2bd fixed: the fallback for a loader with no
   * `loadManyKeyed`. `admitLoaderItems` falls back to `loadMany` keyed by
   * `data.name` — the pre-#14205 behaviour, verbatim, which drops a nameless
   * body. Here the fallback is `list()` + a per-name `load()`, so a loader
   * that cannot enumerate keys and bodies together still answers with both.
   *
   * Read failures are NOT caught here — the caller owns that verdict, as in
   * {@link admitLoaderItems}.
   */
  private async admitKeyedLoaderItems<T = any>(
    loader: MetadataLoader,
    type: string,
    items: Map<string, MetadataKeyedItem<T>>,
    options?: MetadataLoadOptions
  ): Promise<void> {
    if (typeof loader.loadManyKeyed === 'function') {
      const keyed = await loader.loadManyKeyed<T>(type, options);
      for (const entry of keyed) {
        if (!entry || typeof entry.name !== 'string' || entry.name === '') continue;
        const key = bundleEntryKey(type, entry.name, entry.data, entry.packageId) ?? entry.name;
        if (items.has(key)) continue;
        items.set(key, { name: entry.name, data: entry.data });
      }
      return;
    }

    for (const name of await loader.list(type)) {
      if (typeof name !== 'string' || name === '' || items.has(name)) continue;
      const result = await loader.load(type, name, options);
      if (result?.data == null) continue;
      const key = bundleEntryKey(type, name, result.data) ?? name;
      if (items.has(key)) continue;
      items.set(key, { name, data: result.data as T });
    }
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
    if (name) this.deleteRegistryEntries(type, name);
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

  /**
   * Wake this node's watchers, then fan the event out to cluster peers.
   * `removal` is {@link unregister}'s alone ({@link ClusterMetadataChangedPayload.removal}).
   */
  protected notifyWatchers(type: string, event: MetadataWatchEvent, removal?: ClusterMetadataRemoval) {
    this.notifyWatchersLocal(type, event);

    // Cluster fan-out (`content/docs/kernel/cluster.mdx` §6.2, lane 1).
    // Best-effort: a publish failure must never block the local update.
    if (this.clusterPubSub) {
      const payload: ClusterMetadataChangedPayload = {
        originNode: this.clusterNodeId,
        type,
        event,
        ...(removal ? { removal } : {}),
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
        //
        // [#32499] A removal deletes this node's in-memory copy first, as
        // `unregister()` deletes from storage before it drops the registry:
        // otherwise the dropped entry hands every read to that copy, and this
        // node keeps serving what the origin removed. Started here, so an
        // in-memory delete that runs no `await` (`MemoryLoader`) has landed
        // before the invalidation below.
        //
        // [ADR-0150 D4, #31698] …and a removal naming a package drops that
        // package's registry slot only. Another package's slot of the name
        // stays: it may hold an item no loader can restore
        // (`registerInMemory`), and the origin did not remove it. A removal
        // the origin made in its registry alone deletes no loader copy here.
        const removal = receivedRemovalOf(p);
        if (removal && p.event.name && !removal.registryOnly) {
          void this.removeNodeLocalCopies(p.type, p.event.name, removal);
        }
        try {
          if (removal?.packageId !== undefined && p.event.name && PACKAGE_SLOTTED_STORE_TYPES.has(p.type)) {
            const store = this.registry.get(p.type);
            this.deleteRegistryEntries(p.type, p.event.name, storeRemovalKeys(store, p.type, p.event.name, removal.packageId).keys);
            this.invalidateListCache(p.type);
          } else {
            this.invalidateForForeignWrite(p.type, p.event.name);
          }
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

  /**
   * [#32499] The peer half of {@link unregister}'s storage step: delete a
   * removal a cluster peer announced from this node's in-memory loaders
   * ({@link isNodeLocalRemovalTarget}), by the key the origin deleted by
   * ({@link deleteMetaItemFromLoader}). The shared `datasource:` store is
   * left alone: the origin already deleted from it.
   *
   * The list cache is dropped again once every delete has settled, for a
   * loader whose delete is really asynchronous and so lands after the
   * receipt's own invalidation.
   */
  private async removeNodeLocalCopies(type: string, name: string, removal: ClusterMetadataRemoval): Promise<void> {
    let removed = false;
    for (const loader of this.loaders.values()) {
      if (!isNodeLocalRemovalTarget(loader)) continue;
      removed = true;
      try {
        await this.deleteMetaItemFromLoader(loader, type, name, removal);
      } catch (error) {
        this.logger.error(
          `[MetadataManager] Loader \`${loader.contract.name}\` could NOT delete \`${type}/${name}\` that a cluster peer ` +
            `removed — this node keeps serving the item from that loader while the node that removed it answers nothing. ` +
            `Nothing looks broken on either node. Fix: re-issue the removal of \`${type}/${name}\` on this node.`,
          error instanceof Error ? error : undefined,
          { loader: loader.contract.name, type, name, packageId: removal.packageId, error },
        );
      }
    }
    if (removed) this.invalidateListCache(type);
  }

  /**
   * The `cluster.resync` answer for this lane: the cluster driver's connection
   * came back after an outage, during which any `metadata.changed` a peer
   * published was lost (the bus is at-most-once). Called by
   * `MetadataClusterBridgePlugin` in `@objectstack/service-cluster` on the
   * driver's local `cluster.resync` event; a no-op until a transport is
   * attached.
   *
   * The receipt of a nameless event, for every type this manager holds a
   * list for: {@link invalidateForForeignWrite} with no name drops the list
   * cache (and the endpoint index), so the next `list()` re-reads the loaders
   * — where a write the lost hint announced already is. Registry ENTRIES are
   * kept, for the reason that method gives: which names a peer wrote is
   * exactly what the lost hints carried, and dropping a whole type store would
   * evict `registerInMemory()` artefacts no loader can restore.
   */
  resyncClusterPubSub(): void {
    if (!this.clusterPubSub) return;
    const types = new Set<string>([
      ...this.listCache.keys(),
      ...this.inflightListReads.keys(),
      MetadataManager.ENDPOINT_METADATA_TYPE,
    ]);
    for (const type of types) this.invalidateForForeignWrite(type);
    this.logger.info('MetadataManager resynced after a cluster outage: list caches dropped', {
      nodeId: this.clusterNodeId,
      types: types.size,
    });
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
   *
   * [ADR-0150 D3/D4, #32351] For a type stored per `(package, name)`,
   * `options.packageId` reads that package's versions only (`null`: the
   * environment's, recorded under no package); naming none, a
   * name more than one row slot holds is refused 409 naming every holder
   * (`PackageScopedNameRefusedError`), and one holder answers as before.
   */
  async getHistory(
    type: string,
    name: string,
    options?: MetadataHistoryQueryOptions & MetadataHistoryAddress
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
      packageId: options?.packageId,
    });
  }

  /**
   * Rollback a metadata item to a specific version.
   * Restores the metadata definition from the history snapshot.
   *
   * [ADR-0150 D3/D4, #32351] For a type stored per `(package, name)`,
   * `options.packageId` names whose row is restored, and the version must be
   * that package's ("not found" otherwise). Naming none, the name's one row is
   * restored; several are refused 409 naming every holder, and so is a version
   * of a package that holds no row of the name (`not-held-by-qualifier`) —
   * ⛔ never written into another package's row.
   */
  async rollback(
    type: string,
    name: string,
    version: number,
    options?: {
      changeNote?: string;
      recordedBy?: string;
    } & MetadataHistoryAddress
  ): Promise<unknown> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('Rollback requires a database loader to be configured');
    }

    // Fetch the target version snapshot directly from the history table
    const address = historyAddressOf(options);
    const targetVersion = await dbLoader.getHistoryRecord(type, name, version, address);

    if (!targetVersion) {
      // [#32351 F1] An addressed read leaves out a version attributed to no
      // package; on a name several row slots hold it is refused naming every
      // holder, not answered "not found".
      if (address !== undefined) await dbLoader.refuseUnattributedVersion(type, name, version);
      throw new Error(`Version ${version} not found in history for ${type}/${name}${historyAddressSuffix(type, address)}`);
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
      options?.recordedBy,
      address,
    );

    // Update in-memory registry with the restored metadata. [#32351] A
    // package's restored version that names no package itself (a package-less
    // customization of that package's row) is filed under that package's slot,
    // as the row it was written to is. [S4] One restored by the environment
    // address is filed under the bare slot, as its row is, even when one
    // package holds the name (the write rule would file it under that package's).
    const slotted = PACKAGE_SLOTTED_STORE_TYPES.has(type);
    if (slotted && isPackageCaller(address?.packageId)) {
      this.writeRegistryEntry(type, name, withEntryPackage({ name, data: restoredMetadata, packageId: address.packageId }));
    } else if (slotted && address !== undefined) {
      this.writeRegistryEntry(type, name, restoredMetadata, environmentStoreKey(type, name, restoredMetadata));
    } else {
      this.writeRegistryEntry(type, name, restoredMetadata);
    }

    return restoredMetadata;
  }

  /**
   * Compare two versions of a metadata item.
   * Returns a diff showing what changed between versions.
   *
   * [ADR-0150 D3/D4, #32351] For a type stored per `(package, name)`,
   * `options.packageId` compares two of that package's versions ("not found"
   * for another's); naming none, a name more than one row slot holds is
   * refused 409 naming every holder.
   */
  async diff(
    type: string,
    name: string,
    version1: number,
    version2: number,
    options?: MetadataHistoryAddress
  ): Promise<MetadataDiffResult> {
    const dbLoader = this.getDatabaseLoader();
    if (!dbLoader) {
      throw new Error('Diff requires a database loader to be configured');
    }

    // Fetch the two version snapshots directly from the history table
    const address = historyAddressOf(options);
    const v1 = await dbLoader.getHistoryRecord(type, name, version1, address);
    const v2 = await dbLoader.getHistoryRecord(type, name, version2, address);

    if (!v1) {
      throw new Error(`Version ${version1} not found in history for ${type}/${name}${historyAddressSuffix(type, address)}`);
    }

    if (!v2) {
      throw new Error(`Version ${version2} not found in history for ${type}/${name}${historyAddressSuffix(type, address)}`);
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

/**
 * [#32351] The package address a history door forwards to the database
 * loader: only `packageId`, so the loader's answer never depends on what else
 * the caller's options carry; `undefined` when none is named.
 */
function historyAddressOf(options?: MetadataHistoryAddress): MetadataHistoryAddress | undefined {
  return options?.packageId === undefined ? undefined : { packageId: options.packageId };
}

/** [#32351] The "not found" message's address, for a by-package type read by address; empty otherwise. */
function historyAddressSuffix(type: string, address?: MetadataHistoryAddress): string {
  if (address?.packageId === undefined || !PACKAGE_SLOTTED_STORE_TYPES.has(type)) return '';
  return isPackageCaller(address.packageId) ? ` (package ${address.packageId})` : ' (environment)';
}

/**
 * [#31699 R4-B] A keyed entry's body, stamped with the entry's package when the
 * body names none itself; the body unchanged otherwise. [#32458] The same stamp
 * for an unbundled type stored per `(package, name)`, through
 * {@link withLoaderEntryPackages}.
 */
function withEntryPackage<T>(entry: MetadataKeyedItem<T>): T {
  const data = entry.data as unknown;
  if (entry.packageId === undefined || indexedItemPackageId(data) !== undefined) return entry.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return entry.data;
  return { ...(data as Record<string, unknown>), _packageId: entry.packageId } as T;
}

/**
 * [#32458] `items`, the bodies `loader.loadMany` answered for an unbundled type
 * stored per `(package, name)`, each stamped with the package the loader holds
 * it for ({@link withEntryPackage}) when the body names none itself. The
 * package is read off the loader's keyed entries, and only from a loader that
 * holds items per package (`loadManySlots`): a body is stamped when its `name`
 * is the key of exactly one keyed entry, that entry carries a package and its
 * own body carries the entry's key as its `name`, and no other body `loadMany`
 * answered carries that `name`. A body whose `name` is another row's key is
 * never stamped with that row's package — a row's key and its body's `name`
 * are two identities (#14205), and a save does not make them agree. Every body
 * is kept, in `loadMany`'s order — a body the keyed read cannot
 * name (a nested or extension-less file, a row whose `name` column is empty)
 * is answered as before, unstamped. A loader that holds nothing per package is
 * not read twice.
 *
 * [#32521; epic #31527 red line 2] A name two or more of the loader's keyed
 * entries carry with their own packages (a name two packages hold, which
 * `DatabaseLoader` now answers a row per package of): each body of that name
 * is stamped with the package of the one keyed entry whose own body it is
 * (the same content, each entry used once), so both holders are handed on
 * stamped and the boot priming pass registers each. A body no such entry's
 * body equals — a package-less row's among them — stays unstamped. Only where
 * the bodies of the name are exactly the rows keyed by it (each of those rows'
 * bodies carries the name, and as many bodies carry it as rows are keyed by
 * it); otherwise none of them is stamped, as above.
 */
async function withLoaderEntryPackages<T>(
  loader: MetadataLoader,
  type: string,
  items: T[],
  options?: MetadataLoadOptions,
): Promise<T[]> {
  if (typeof loader.loadManyKeyed !== 'function' || typeof loader.loadManySlots !== 'function') return items;
  const nameOf = (body: unknown): unknown => (body as { name?: unknown } | null)?.name;
  const packageOf = new Map<string, string | null>();
  const entriesKeyed = new Map<string, { count: number; ownBodies: boolean }>();
  const heldBodies = new Map<string, Array<{ body: string; packageId: string }>>();
  for (const entry of await loader.loadManyKeyed<T>(type, options)) {
    const ownBody = nameOf(entry.data) === entry.name;
    const own = ownBody ? entry.packageId ?? null : null;
    packageOf.set(entry.name, packageOf.has(entry.name) ? null : own);
    const keyed = entriesKeyed.get(entry.name) ?? { count: 0, ownBodies: true };
    entriesKeyed.set(entry.name, { count: keyed.count + 1, ownBodies: keyed.ownBodies && ownBody });
    if (own !== null) heldBodies.set(entry.name, [...(heldBodies.get(entry.name) ?? []), { body: JSON.stringify(entry.data), packageId: own }]);
  }
  const bodiesNamed = new Map<string, number>();
  for (const item of items) {
    const name = nameOf(item);
    if (typeof name === 'string') bodiesNamed.set(name, (bodiesNamed.get(name) ?? 0) + 1);
  }
  // [#32521] Paired by content only where the bodies of the name are exactly
  // the rows keyed by it: every such row's body carries the name, and no other
  // body does.
  const severallyHeld = new Set([...heldBodies]
    .filter(([name, held]) => held.length > 1 && entriesKeyed.get(name)!.ownBodies && entriesKeyed.get(name)!.count === bodiesNamed.get(name))
    .map(([name]) => name));
  return items.map((item) => {
    const name = nameOf(item);
    if (typeof name !== 'string') return item;
    const held = heldBodies.get(name);
    if (held !== undefined && severallyHeld.has(name)) {
      const body = JSON.stringify(item);
      const at = held.findIndex((entry) => entry.body === body);
      return at === -1 ? item : withEntryPackage({ name, data: item, packageId: held.splice(at, 1)[0]!.packageId });
    }
    if (bodiesNamed.get(name) !== 1) return item;
    const packageId = packageOf.get(name);
    return packageId ? withEntryPackage({ name, data: item, packageId }) : item;
  });
}
