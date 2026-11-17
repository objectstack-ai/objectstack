// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34206, ADR-0156] The compiled metadata answer cache: the served item read
 * (`getMetaItem`) of an app, object, view, page or dashboard, kept per engine
 * and answered again while every source it was compiled from is unchanged.
 *
 * ## What is cached, and what is not (ADR-0156 D3)
 *
 * The value is `getMetaItem`'s envelope for one `(type, name)` read with no
 * package, member, state or draft preview: the merge of the stored rows, the
 * schema registry and the metadata service, governed, decorated and locked.
 * That read takes no caller: it reads the store as the system and the
 * registries in memory, so every caller of the environment is answered the
 * same envelope. The per-caller gate, the field mask, the translation and the
 * `ETag` are the REST door's, applied over this envelope on every request,
 * as before.
 *
 * Three members of the envelope are NOT cached: `registration`,
 * `disabledActions` and `cascadeDeleteObjects` ({@link LIVE_ITEM_TRAILER_KEYS}).
 * They read the automation engine, the action-activation ledger and the
 * cascade closure, which have no counter here; a hit reads them again through
 * the one function the miss used ({@link liveItemTrailers}).
 *
 * ## The sources and their counters (ADR-0156 D1 (a), D2)
 *
 * | source | counter |
 * |:--|:--|
 * | `sys_metadata` rows | the overlay cache generation ({@link readOverlayCacheGeneration}): every engine-seam write to the table, and every non-write epoch move (a peer's write through the cluster bridge, a metadata or manual bump) |
 * | schema registry: objects | `registry.objectRevision` |
 * | schema registry: items, artifacts, packages and enablement, navigation contributions, namespaces, claims | `registry.revision` (objectql `registry-revision.ts`) |
 * | metadata service | `revision` on the service registered as `'metadata'`, and the service's identity |
 *
 * A source without its counter makes the cache DECLINE: the read runs
 * uncached, exactly as before. A registry without `revision` or
 * `objectRevision`, an engine without the overlay seam, a metadata service
 * without `revision`: each declines. ⛔ No counter is guessed, and none is
 * borrowed from another source.
 *
 * ## The time bound and the confirmation (ADR-0156 D1 (b), D5)
 *
 * `OS_METADATA_COMPILE_CACHE_TTL_MS` (default {@link META_COMPILE_CACHE_DEFAULT_TTL_MS};
 * `0` is off and the read is the uncached one, the same reads in the same
 * order). The bound covers what this process cannot see: another node's
 * write with no cluster bridge, a write that bypasses the engine.
 *
 * When the bound passes, the cache confirms before it recompiles: the
 * counters above at their stamp, and a reading of everything outside this
 * process that the bound exists for ({@link readConfirmationMark}):
 *
 *  - the stored rows: a digest of every `sys_metadata` row's identity,
 *    binding, layering, state, `version`, `checksum` and `updated_at`
 *    ({@link readStoreMark}), never the stored bodies. It moves on another
 *    writer's insert or delete and on any move of those columns, also an
 *    `updated_at` older than the newest from a node whose clock is behind.
 *    One read of those columns per bound per engine, in place of recompiling
 *    every entry. A bypassing write that changes a body and leaves all three
 *    bookkeeping columns as they were is the one row change it cannot see;
 *    the age cap below bounds it;
 *  - the metadata service's loaders: `loaderChangeMark()` on the service
 *    (`@objectstack/metadata`), each loader's own reading of its backing
 *    store (the file loader stats the directories and files its reads
 *    touched, so a file a deployment creates, removes or edits under a
 *    running process moves it).
 *
 * Nothing moved: the entries are kept for another bound, as long as that
 * bound ends within {@link META_COMPILE_CACHE_MAX_AGE_BOUNDS} bounds of when
 * each was compiled. The age cap is the backstop for what no reading sees: a
 * body rewritten by a bypassing writer that left the bookkeeping columns
 * alone, a file edited in place to the same size within the file system's
 * time granularity, and an object the schema registry handed out that a
 * caller then edited in place (`registry-revision.ts`). Anything moved: every
 * entry goes. Either way the overlay row
 * cache is retired (`retireMetaOverlayCache`), so a recompile under the new
 * reading reads rows at least as new as the reading, never rows that cache
 * filled before another writer's change.
 *
 * One confirmation runs per bound per engine: the readers that cross the
 * bound while it runs wait for it, and its failure reaches all of them. A
 * bucket opened by a counter move takes no reading: its first bound ends at
 * a confirmation that drops its entries and takes the reading later bounds
 * renew on, so a local change costs no store read. Its first bound ends no
 * later than one bound after the overlay row cache's current generation
 * began (`readOverlayCacheGenerationSince`): every row set that cache holds
 * was read since then, so no entry carries a row more than one bound old,
 * and the row sets are kept. When that generation began more than a bound
 * ago, opening the bucket retires the row cache, as a confirmation does. A
 * counter move cannot make a stored row stale, so keeping the rows is what
 * stops a list read that registers what is already registered (it moves
 * `registry.revision`) from sending the list and item reads after it to
 * the store (#34554).
 *
 * ⛔ A renewal is a claim about what was looked at (ADR-0156 D5). When the
 * confirmation cannot read one of those (the store cannot be read, the
 * service keeps no `loaderChangeMark`, a loader keeps no mark), nothing is
 * renewed: every entry is dropped at its bound and compiled again, so the
 * cache answers repeats within one bound and never across two.
 *
 * ## Invalidation is coarse, by construction
 *
 * The stamp is the whole tuple of counters, held per engine. Any counter
 * moving retires EVERY entry of that engine at once: metadata changes are
 * rare, and a per-entry dependency graph would be the call-site list ADR-0127
 * D2 forbids in another shape. A read in flight across a change is stamped
 * with the counters it STARTED under and is not stored when they moved
 * before it settled. A confirmation moves the stamp too (it retires the
 * overlay row cache and rebases the bucket on the new generation), so a read
 * that spans one is never stored: it may have compiled from what the
 * confirmation found moved, and storing it under the new reading would renew
 * that old answer for as long as nothing moves again.
 *
 * ## Values are cloned in both directions
 *
 * An envelope is cloned when stored and again when served, so a caller that
 * edits its answer (the REST door spreads and translates it) cannot reach the
 * entry, and a hit is byte-equivalent to a miss. An envelope that cannot be
 * cloned is not stored. The served row's change time
 * (`servedRowChangedAtOf`, a non-enumerable symbol member) is kept beside the
 * clone and put back on every served copy. The other non-enumerable marks a
 * compile can leave on an item (`markResolvedPicklistOptions`,
 * `bindStoredRow`) do not travel on the clone. Each is read inside the
 * compile, before the store (the diagnostics), or from the registry, never
 * from a served answer (the flow binding), and each module states that a copy
 * reads as unmarked and fails toward the safe side.
 *
 * ## Hydration (ADR-0156 D4)
 *
 * The served item read registers nothing in the schema registry; the list
 * read (`getMetaItems`) does, and is not cached here. A hit therefore leaves
 * the registry exactly as a miss does.
 */

import { createHash } from 'node:crypto';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { readOverlayCacheGeneration, readOverlayCacheGenerationSince, retireMetaOverlayCache } from './meta-overlay-cache.js';
import { metadataReadFailureError } from './protocol-client-failures.js';
import { servedRowChangedAtOf, withServedRowChangedAt } from './served-row-changed-at.js';

/** Env var naming the compile cache's time bound, in milliseconds. `0` turns the cache off. */
export const META_COMPILE_CACHE_TTL_ENV = 'OS_METADATA_COMPILE_CACHE_TTL_MS';

/**
 * The default bound: 30 s, the overlay row cache's. On a single node with the
 * engine seam every local change is seen at once and the bound only paces the
 * confirmation; across nodes with no cluster bridge it is how long another
 * node's write can stay unseen, as it already is for the row cache.
 */
export const META_COMPILE_CACHE_DEFAULT_TTL_MS = 30_000;

/**
 * How many bounds an entry may stand, renewals included, before it is
 * compiled again whatever the confirmation read. A backstop for the one
 * change a reading cannot tell apart: one made and undone between two
 * confirmations, with a compile in between that read the middle state.
 */
export const META_COMPILE_CACHE_MAX_AGE_BOUNDS = 10;

/** The types whose served item read is cached: the app bundle's member types. */
export const META_COMPILE_CACHE_TYPES: ReadonlySet<string> = new Set(['app', 'object', 'view', 'page', 'dashboard']);

/** The time bound, read from {@link META_COMPILE_CACHE_TTL_ENV}. Unset or blank: the default. Not a non-negative number: `0`. */
export function metaCompileCacheTtlMs(
    env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): number {
    const raw = env[META_COMPILE_CACHE_TTL_ENV];
    if (raw === undefined || raw.trim() === '') return META_COMPILE_CACHE_DEFAULT_TTL_MS;
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}

/** The request shape this cache answers: a served read naming only a type and a name. */
export interface MetaCompileCacheRequest {
    type: string;
    name: string;
    packageId?: string;
    state?: 'active' | 'draft';
    previewDrafts?: boolean;
    member?: string;
}

/** What the cache reads from the protocol: the engine, the services, and the live trailers. */
export interface MetaCompileCacheHost {
    readonly engine: unknown;
    readonly getServicesRegistry?: (() => { get(name: string): unknown } | undefined) | undefined;
    /** The live members of a served envelope, as the miss computed them. */
    liveTrailers(type: string, name: string, item: unknown): Record<string, unknown>;
    /** The keys {@link liveTrailers} may answer; stripped from a stored envelope. */
    readonly liveTrailerKeys: readonly string[];
}

/** The counters an entry was compiled under. Compared member by member, never interpreted. */
interface CompileStamp {
    readonly overlay: number;
    readonly objectRevision: number;
    readonly registryRevision: number;
    readonly metadataService: object | undefined;
    readonly metadataServiceRevision: number | undefined;
}

interface CompileEntry {
    /** A private clone of the envelope, the live trailers removed. Never handed out un-cloned. */
    readonly envelope: Record<string, unknown>;
    readonly changedAt: string | undefined;
    /** When it was compiled: no entry is renewed past {@link META_COMPILE_CACHE_MAX_AGE_BOUNDS} bounds. */
    readonly compiledAt: number;
}

interface CompileBucket {
    /** Rebased only by a confirmation's own retirement of the overlay row cache ({@link confirm}). */
    stamp: CompileStamp;
    /** The confirmation reading ({@link readConfirmationMark}) the entries were last confirmed at; `undefined` until the first. */
    mark: string | undefined;
    /** Until when the entries stand without a confirmation. */
    confirmedUntil: number;
    /** The confirmation in flight, shared by every reader that crosses the bound while it runs. */
    confirming: Promise<void> | undefined;
    readonly entries: Map<string, CompileEntry>;
}

/** One bucket per engine: the engine owns the rows and the registry every entry was compiled from. */
const buckets = new WeakMap<object, CompileBucket>();

/** The metadata service the protocol reads, or `undefined` when there is none. */
function metadataServiceOf(host: MetaCompileCacheHost): object | undefined {
    try {
        const service = host.getServicesRegistry?.()?.get('metadata');
        return service !== null && typeof service === 'object' ? service : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Every source's counter, now — or `undefined` when a source the read can
 * reach exposes none, which makes the cache decline (ADR-0156 D2).
 */
export function readCompileStamp(host: MetaCompileCacheHost): CompileStamp | undefined {
    const engine = host.engine;
    if (!engine || typeof engine !== 'object') return undefined;
    const overlay = readOverlayCacheGeneration(engine);
    if (overlay === undefined) return undefined;
    const registry = (engine as { registry?: { objectRevision?: unknown; revision?: unknown } }).registry;
    if (!registry || typeof registry.objectRevision !== 'number' || typeof registry.revision !== 'number') return undefined;
    const metadataService = metadataServiceOf(host);
    let metadataServiceRevision: number | undefined;
    if (metadataService !== undefined) {
        const revision = (metadataService as { revision?: unknown }).revision;
        if (typeof revision !== 'number') return undefined;
        metadataServiceRevision = revision;
    }
    return {
        overlay,
        objectRevision: registry.objectRevision,
        registryRevision: registry.revision,
        metadataService,
        metadataServiceRevision,
    };
}

function sameStamp(a: CompileStamp, b: CompileStamp): boolean {
    return a.overlay === b.overlay
        && a.objectRevision === b.objectRevision
        && a.registryRevision === b.registryRevision
        && a.metadataService === b.metadataService
        && a.metadataServiceRevision === b.metadataServiceRevision;
}

/**
 * The confirmation's reading of everything outside this process the bound
 * exists for: the stored rows ({@link readStoreMark}) and the metadata
 * service's loaders (`loaderChangeMark()`), or `undefined` when either
 * cannot be read, which forbids a renewal (ADR-0156 D5).
 */
export async function readConfirmationMark(engine: unknown, metadataService: object | undefined): Promise<string | undefined> {
    const read = (metadataService as { loaderChangeMark?: unknown } | undefined)?.loaderChangeMark;
    if (metadataService !== undefined && typeof read !== 'function') return undefined;
    const [store, loaders] = await Promise.all([
        readStoreMark(engine),
        metadataService === undefined
            ? Promise.resolve('')
            : (read as () => Promise<unknown>).call(metadataService).then(
                (mark) => (typeof mark === 'string' ? mark : undefined),
                () => undefined,
            ),
    ]);
    if (store === undefined || loaders === undefined) return undefined;
    return JSON.stringify([store, loaders]);
}

/**
 * The `sys_metadata` columns the store reading digests: identity, binding,
 * layering, state and the bookkeeping columns every engine write moves. ⛔ Not
 * the stored body: the reading must not carry every body through the process
 * at each bound (contract review 6933112344 S3).
 */
export const STORE_MARK_FIELDS: readonly string[] = Object.freeze([
    'id', 'type', 'name', 'namespace', 'package_id', 'bundle_member', 'extends', 'strategy',
    'state', 'version', 'checksum', 'updated_at',
]);

/**
 * The store reading the confirmation compares (ADR-0156 D5): a digest of
 * every `sys_metadata` row's {@link STORE_MARK_FIELDS}, read as the system,
 * sorted. It moves on any insert or delete, on a change of a row's identity,
 * binding, layering or state, and on any change of `version`, `checksum` or
 * `updated_at` whichever way it goes: a node whose clock writes an older
 * `updated_at` than the newest already stored, or an import that preserves
 * timestamps but stamps its own checksum. Only the digest is kept; no row
 * leaves this function.
 *
 * What it cannot see: a writer that bypasses the engine and changes a stored
 * body while leaving `version`, `checksum` and `updated_at` exactly as they
 * were. That class is bounded by the age cap alone
 * ({@link META_COMPILE_CACHE_MAX_AGE_BOUNDS}); a column every write moves
 * would close it (#34522).
 *
 * `undefined` when there is nothing to read it with (an engine without
 * `find`) or no store yet (`sys_metadata` not provisioned, by error type):
 * the bucket's entries then go, and nothing is renewed. Any other failure is
 * thrown as the uncached read throws it
 * (`rethrowUnlessMetadataStoreUnprovisioned`): an outage is never read as
 * "nothing moved", and never served from the entries it could not confirm.
 */
export async function readStoreMark(engine: unknown): Promise<string | undefined> {
    const ql = engine as { find?: (object: string, query: unknown) => Promise<unknown> };
    if (typeof ql?.find !== 'function') return undefined;
    let rows: unknown;
    try {
        rows = await ql.find('sys_metadata', { where: {}, fields: [...STORE_MARK_FIELDS], context: { isSystem: true } });
    } catch (error) {
        if (isMissingTableError(error, 'sys_metadata')) return undefined;
        throw metadataReadFailureError(error);
    }
    if (!Array.isArray(rows)) return undefined;
    const lines = rows.map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return JSON.stringify(STORE_MARK_FIELDS.map((field) => {
            const value = r[field];
            return value instanceof Date ? value.toISOString() : value ?? null;
        }));
    }).sort();
    const digest = createHash('sha1');
    for (const line of lines) digest.update(line).update('\n');
    return `${rows.length}:${digest.digest('hex')}`;
}

/** Whether this request is one the cache answers. */
function cacheableRequest(request: MetaCompileCacheRequest): boolean {
    return META_COMPILE_CACHE_TYPES.has(request.type)
        && typeof request.name === 'string' && request.name !== ''
        && request.packageId === undefined
        && request.member === undefined
        && request.state === undefined
        && request.previewDrafts === undefined;
}

function entryKey(request: MetaCompileCacheRequest): string {
    return JSON.stringify([request.type, request.name]);
}

/** A clone of `value`, or `undefined` when it cannot be cloned. */
function cloned<T>(value: T): T | undefined {
    try {
        return structuredClone(value);
    } catch {
        return undefined;
    }
}

/** The served copy of an entry: a fresh clone, the live trailers read now, the row change time put back. */
function serve(host: MetaCompileCacheHost, request: MetaCompileCacheRequest, entry: CompileEntry): unknown {
    const envelope = structuredClone(entry.envelope);
    const served = { ...envelope, ...host.liveTrailers(request.type, request.name, envelope.item) };
    return withServedRowChangedAt(served, entry.changedAt);
}

/**
 * Confirm `bucket` at its bound (ADR-0156 D5) and open the next one: its
 * entries stand for another bound only when the reading of everything outside
 * this process is the one they were last confirmed at. A moved reading drops
 * them all. An unreadable one drops them all too, and leaves no reading to
 * compare at the next bound, so nothing compiled under it is ever renewed:
 * it is a cache for one bound at a time.
 */
async function confirm(engine: object, bucket: CompileBucket, ttlMs: number, now: number): Promise<void> {
    const mark = await readConfirmationMark(engine, bucket.stamp.metadataService);
    if (mark === undefined || bucket.mark !== mark) {
        bucket.entries.clear();
    } else {
        // Renewed only when the bound it opens still ends within the cap.
        const maxAge = META_COMPILE_CACHE_MAX_AGE_BOUNDS * ttlMs;
        for (const [key, entry] of bucket.entries) if (now + ttlMs - entry.compiledAt > maxAge) bucket.entries.delete(key);
    }
    // What is compiled under this reading must read rows at least as new as
    // it: retire the overlay row cache, which may hold rows filled before
    // another writer's change. Only when no write moved its generation while
    // the reading was taken: a moved one has retired it already, and resets
    // this bucket at the stamp check.
    const overlay = readOverlayCacheGeneration(engine);
    if (overlay !== undefined && overlay === bucket.stamp.overlay) {
        const next = retireMetaOverlayCache(engine);
        if (next !== undefined) bucket.stamp = { ...bucket.stamp, overlay: next };
    }
    bucket.mark = mark;
    bucket.confirmedUntil = now + ttlMs;
}

/**
 * Answer a served item read through the cache, or by `compute` (the uncached
 * read) when the cache is off, the request is not one it answers, a source
 * exposes no counter, or the entry is missing. See the module header.
 */
export async function readThroughMetaCompileCache<T>(
    host: MetaCompileCacheHost,
    request: MetaCompileCacheRequest,
    compute: () => Promise<T>,
): Promise<T> {
    const ttlMs = metaCompileCacheTtlMs();
    if (ttlMs <= 0 || !cacheableRequest(request)) return compute();
    let stamp = readCompileStamp(host);
    if (stamp === undefined) return compute();
    const engine = host.engine as object;

    let bucket = buckets.get(engine);
    if (bucket === undefined || !sameStamp(bucket.stamp, stamp)) {
        // A new bucket opens its first bound without a reading: the first
        // confirmation drops its entries and takes the reading later bounds
        // are renewed on, so a counter move costs no store read. What it
        // compiles must carry no row more than one bound old. Every row set
        // the overlay row cache holds was read since its generation began, so
        // the bound ends one bound after that and the rows are kept; when
        // that is already past, the row cache is retired, as a confirmation
        // retires it, and the bound is a full one from now. [#34554] A counter
        // move never makes a stored row stale: retiring here on every move
        // sent the list read and the item reads after each hydration to the
        // store.
        const now = Date.now();
        const since = readOverlayCacheGenerationSince(engine);
        let confirmedUntil = now + ttlMs;
        if (since !== undefined && since + ttlMs > now) {
            confirmedUntil = since + ttlMs;
        } else {
            const overlay = retireMetaOverlayCache(engine);
            if (overlay !== undefined) stamp = { ...stamp, overlay };
        }
        bucket = { stamp, mark: undefined, confirmedUntil, confirming: undefined, entries: new Map() };
        buckets.set(engine, bucket);
    }
    if (Date.now() >= bucket.confirmedUntil) {
        // One confirmation per bound per engine: a reader crossing the bound
        // while one runs waits for it, and a failure reaches every waiter.
        const open = bucket;
        open.confirming ??= confirm(engine, open, ttlMs, Date.now()).finally(() => { open.confirming = undefined; });
        await open.confirming;
        stamp = open.stamp;
    }

    const key = entryKey(request);
    const hit = bucket.entries.get(key);
    // The stamp is read again: the confirmation awaited the store.
    const current = readCompileStamp(host);
    if (hit !== undefined && current !== undefined && sameStamp(current, stamp) && buckets.get(engine) === bucket) {
        return serve(host, request, hit) as T;
    }

    const answer = await compute();
    const after = readCompileStamp(host);
    if (after === undefined || !sameStamp(after, stamp) || buckets.get(engine) !== bucket) return answer;
    const item = (answer as { item?: unknown } | null | undefined)?.item;
    if (item === null || typeof item !== 'object') return answer;
    const copy = cloned(answer) as Record<string, unknown> | undefined;
    if (copy === undefined) return answer;
    for (const trailer of host.liveTrailerKeys) delete copy[trailer];
    bucket.entries.set(key, { envelope: copy, changedAt: servedRowChangedAtOf(answer), compiledAt: Date.now() });
    return answer;
}

/** Test seam: drop every entry this process holds for `engine`. */
export function clearMetaCompileCache(engine: object): void {
    buckets.delete(engine);
}
