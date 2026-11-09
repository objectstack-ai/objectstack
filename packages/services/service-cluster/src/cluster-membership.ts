// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cluster membership: which replicas are alive right now (cloud#3814, the
 * membership registry).
 *
 * ## What it does
 *
 * Under a declared multi-replica deployment on the Redis driver
 * ({@link declaresMultiReplicaOnRedis}, rule R3), every replica runs one
 * {@link ClusterMembershipHeartbeat}. Each beat writes this replica's record to
 * `cluster:member:NODE_ID` in the cluster KV with a TTL, and makes sure the
 * node id is listed in the `cluster:members` roster. A replica that stops
 * beating — killed, partitioned, hung — drops out when its key expires, within
 * the TTL. A replica that shuts down cleanly deletes its key at once.
 *
 * {@link readClusterMembers} answers the question for any caller holding the
 * `cluster` service.
 *
 * ## Why a roster key
 *
 * `IKV` (the spec contract) has `get` / `set` / `delete` / `cas` and no way to
 * list keys, so nothing can enumerate `cluster:member:*` through it. The roster
 * is one KV value holding the node ids that ever beat; a reader gets the roster,
 * then each id's member key, and an id whose key is gone is not alive. The
 * roster is changed only by compare-and-set, and only by heartbeats: each beat
 * adds its own id when missing and removes ids whose member key has expired, so
 * restarts (a new node id per process) do not grow it. The reader writes
 * nothing.
 *
 * ## A store outage is a degraded reading, never a crash
 *
 * A failed beat is swallowed (one `debug` line; the outage itself is the
 * driver's to log, once — `cluster-resync.ts`), and the next beat retries. A
 * failed read answers `state: 'degraded'` with the last good reading and that
 * reading's own `asOf`, or with this replica alone when there was none. Nothing
 * here throws to a caller, delays the boot, or touches a request.
 *
 * ## The single-node path is untouched
 *
 * Without the declaration no heartbeat is created and nothing is written.
 * {@link readClusterMembers} then answers `state: 'single-node'` with this
 * replica alone, without reading the store.
 *
 * ## Why a `Symbol.for` key on the cluster instance
 *
 * The same reason `cluster-resync.ts` gives: a process can hold this module
 * twice (its ESM and CJS builds), so the heartbeat is offered on the cluster
 * instance under a key from the global symbol registry, not in a module map.
 */

import { hostname } from 'node:os';

import type { IKV } from '@objectstack/spec/contracts';

import { describeConnectionError } from './cluster-resync.js';

/** KV key prefix of one replica's heartbeat record; the node id follows. */
const CLUSTER_MEMBER_KEY_PREFIX = 'cluster:member:';

/** KV key of the roster: the node ids heartbeats have listed. */
const CLUSTER_MEMBERS_ROSTER_KEY = 'cluster:members';

/** Default beat interval, in ms. */
const DEFAULT_HEARTBEAT_MS = 5000;

/** Default member-key TTL, in ms: three beats, the same ratio the cluster lock uses. */
const DEFAULT_TTL_MS = 15000;

/** The longest a clean shutdown waits for its own key's delete. */
const SHUTDOWN_DELETE_BOUND_MS = 1000;

/** CAS attempts on the roster per beat before leaving it to the next beat. */
const ROSTER_CAS_ATTEMPTS = 3;

/** One replica, as its last heartbeat recorded it. Times are epoch ms. */
export interface ClusterMember {
    /** The replica's `cluster.nodeId`. */
    readonly nodeId: string;
    /** The replica's host name (the pod name on Kubernetes). */
    readonly host: string;
    /** The replica's process id. */
    readonly pid: number;
    /** When the replica's process started. */
    readonly startedAt: number;
    /**
     * When the replica last beat. Where no beat exists to report — the
     * single-node answer, and a degraded answer with no earlier good reading —
     * it is the time this replica was read.
     */
    readonly lastBeatAt: number;
}

/** What {@link readClusterMembers} answers. */
export interface ClusterMembership {
    /**
     * `single-node`: no multi-replica declaration (or no remote driver), so no
     * heartbeat runs and `members` is this replica alone; a declared deployment
     * reads it too before `kernel:ready` and after shutdown. `live`: `members` was
     * read from the store just now. `degraded`: the store could not be read;
     * `members` is the last good reading (or this replica alone) and `asOf` is
     * when that reading was taken.
     */
    readonly state: 'single-node' | 'live' | 'degraded';
    /** This replica's `cluster.nodeId`. */
    readonly self: string;
    /** The live members, sorted by `nodeId`. */
    readonly members: readonly ClusterMember[];
    /** When `members` was read (epoch ms). */
    readonly asOf: number;
    /** Why the reading is degraded, credential-free. Present only when `degraded`. */
    readonly reason?: string;
}

/** Where a heartbeat writes its one kind of line. */
export interface ClusterMembershipLogger {
    debug?(message: string): void;
}

export interface ClusterMembershipHeartbeatOptions {
    /** The cluster this replica belongs to: its `nodeId` and its `kv`. */
    cluster: { readonly nodeId: string; readonly kv: IKV };
    /** Beat interval in ms. Default 5000; anything but a finite positive number takes the default. */
    heartbeatMs?: number;
    /**
     * Member-key TTL in ms. Default 15000; anything but a finite positive
     * number takes the default; never below two beats. The store receives it
     * rounded up to whole seconds.
     */
    ttlMs?: number;
    logger?: ClusterMembershipLogger;
    /** Clock, for tests. */
    now?: () => number;
}

/**
 * One replica's heartbeat. {@link start} offers it on the cluster instance and
 * begins beating; {@link stop} ends the timer and deletes this replica's key.
 * Created by `ClusterServicePlugin` only under the multi-replica declaration.
 */
export class ClusterMembershipHeartbeat {
    readonly nodeId: string;
    private readonly kv: IKV;
    private readonly cluster: object;
    private readonly heartbeatMs: number;
    private readonly ttlMs: number;
    private readonly logger: ClusterMembershipLogger;
    private readonly now: () => number;
    private readonly self: Omit<ClusterMember, 'lastBeatAt'>;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private inFlight: Promise<void> | undefined;
    private stopped = false;
    private lastGood: { members: ClusterMember[]; asOf: number } | undefined;

    constructor(options: ClusterMembershipHeartbeatOptions) {
        this.cluster = options.cluster;
        this.nodeId = options.cluster.nodeId;
        this.kv = options.cluster.kv;
        this.heartbeatMs = positiveOr(options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
        this.ttlMs = Math.max(2 * this.heartbeatMs, positiveOr(options.ttlMs, DEFAULT_TTL_MS));
        this.logger = options.logger ?? {};
        this.now = options.now ?? Date.now;
        this.self = {
            nodeId: this.nodeId,
            host: hostname(),
            pid: process.pid,
            startedAt: processStartedAt(this.now),
        };
    }

    /**
     * Offer this heartbeat on its cluster instance and begin beating. The first
     * beat is not awaited: an unreachable store never delays the boot.
     */
    start(): void {
        if (this.stopped || this.timer) return;
        offerMembership(this.cluster, this);
        this.tick();
    }

    /**
     * Withdraw this heartbeat from its cluster instance, stop beating and
     * delete this replica's member key (bounded; best-effort). After it, the
     * instance reads `single-node` again and can run a new heartbeat — a host
     * that hands the same cluster to a second kernel in this process.
     */
    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        withdrawMembership(this.cluster, this);
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        await this.inFlight;
        await withinBound(
            this.kv.delete(memberKey(this.nodeId)).catch((err: unknown) => {
                this.logger.debug?.(
                    `[cluster] membership: could not delete this replica's key on shutdown (node=${this.nodeId}): ` +
                        `${describeConnectionError(err)}; it expires within ${this.ttlMs} ms.`,
                );
            }),
            SHUTDOWN_DELETE_BOUND_MS,
        );
    }

    /** The members alive now, read from the store; never throws. */
    async read(): Promise<ClusterMembership> {
        try {
            const roster = await this.readRoster();
            const entries = await Promise.all(
                roster.ids.map((id) => this.kv.get<ClusterMember>(memberKey(id))),
            );
            const members = entries
                .map((entry) => entry?.value)
                .filter((m): m is ClusterMember => isMember(m))
                .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
            const asOf = this.now();
            this.lastGood = { members, asOf };
            return { state: 'live', self: this.nodeId, members, asOf };
        } catch (err) {
            const reason = describeConnectionError(err);
            if (this.lastGood) {
                return {
                    state: 'degraded',
                    self: this.nodeId,
                    members: this.lastGood.members,
                    asOf: this.lastGood.asOf,
                    reason,
                };
            }
            const asOf = this.now();
            return { state: 'degraded', self: this.nodeId, members: [{ ...this.self, lastBeatAt: asOf }], asOf, reason };
        }
    }

    private tick(): void {
        if (this.stopped) return;
        this.inFlight = this.beat()
            .catch((err: unknown) => {
                this.logger.debug?.(
                    `[cluster] membership: heartbeat skipped (node=${this.nodeId}): ${describeConnectionError(err)}.`,
                );
            })
            .finally(() => {
                this.inFlight = undefined;
                if (this.stopped) return;
                this.timer = setTimeout(() => this.tick(), this.heartbeatMs);
                this.timer.unref?.();
            });
    }

    private async beat(): Promise<void> {
        const record: ClusterMember = { ...this.self, lastBeatAt: this.now() };
        await this.kv.set(memberKey(this.nodeId), record, { ttl: Math.ceil(this.ttlMs / 1000) });
        for (let attempt = 0; attempt < ROSTER_CAS_ATTEMPTS && !this.stopped; attempt++) {
            const roster = await this.readRoster();
            const alive = await Promise.all(
                roster.ids.map(async (id) => id === this.nodeId || (await this.kv.get(memberKey(id))) !== undefined),
            );
            const next = roster.ids.filter((_, i) => alive[i]);
            if (!next.includes(this.nodeId)) next.push(this.nodeId);
            if (sameIds(next, roster.ids)) return;
            if (await this.kv.cas(CLUSTER_MEMBERS_ROSTER_KEY, roster.version, next)) return;
        }
    }

    private async readRoster(): Promise<{ ids: string[]; version: bigint }> {
        const entry = await this.kv.get<unknown>(CLUSTER_MEMBERS_ROSTER_KEY);
        if (!entry) return { ids: [], version: 0n };
        const ids = Array.isArray(entry.value) ? entry.value.filter((v): v is string => typeof v === 'string') : [];
        return { ids, version: entry.version };
    }
}

/**
 * The replicas alive now, as `cluster`'s membership heartbeat reads them from
 * the store. Never throws. Without a heartbeat (no multi-replica declaration,
 * or the in-process driver) the answer is `single-node`: this replica alone,
 * no store read. A declared deployment also reads `single-node` until its
 * heartbeat starts at `kernel:ready`, and again after it stops at shutdown.
 */
export async function readClusterMembers(cluster: { readonly nodeId: string }): Promise<ClusterMembership> {
    const heartbeat = readMembership(cluster);
    if (heartbeat) return heartbeat.read();
    const asOf = Date.now();
    return {
        state: 'single-node',
        self: cluster.nodeId,
        members: [
            {
                nodeId: cluster.nodeId,
                host: hostname(),
                pid: process.pid,
                startedAt: processStartedAt(Date.now),
                lastBeatAt: asOf,
            },
        ],
        asOf,
    };
}

// ---------------------------------------------------------------------------
// The offer on the cluster instance
// ---------------------------------------------------------------------------

const MEMBERSHIP_KEY = Symbol.for('@objectstack/service-cluster:membership');

function offerMembership(cluster: object, heartbeat: ClusterMembershipHeartbeat): void {
    if (Object.prototype.hasOwnProperty.call(cluster, MEMBERSHIP_KEY)) {
        throw new Error('ClusterMembershipHeartbeat: this cluster instance already runs a membership heartbeat.');
    }
    Object.defineProperty(cluster, MEMBERSHIP_KEY, {
        value: heartbeat,
        enumerable: false,
        writable: false,
        configurable: true,
    });
}

function withdrawMembership(cluster: object, heartbeat: ClusterMembershipHeartbeat): void {
    if ((cluster as Record<symbol, unknown>)[MEMBERSHIP_KEY] === heartbeat) {
        delete (cluster as Record<symbol, unknown>)[MEMBERSHIP_KEY];
    }
}

function readMembership(cluster: unknown): ClusterMembershipHeartbeat | undefined {
    if (cluster === null || (typeof cluster !== 'object' && typeof cluster !== 'function')) return undefined;
    const offered = (cluster as Record<symbol, unknown>)[MEMBERSHIP_KEY];
    return offered instanceof ClusterMembershipHeartbeat ? offered : undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function positiveOr(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function memberKey(nodeId: string): string {
    return `${CLUSTER_MEMBER_KEY_PREFIX}${nodeId}`;
}

function processStartedAt(now: () => number): number {
    return Math.round(now() - process.uptime() * 1000);
}

function isMember(value: unknown): value is ClusterMember {
    const m = value as Partial<ClusterMember> | undefined;
    return (
        typeof m === 'object' &&
        m !== null &&
        typeof m.nodeId === 'string' &&
        typeof m.host === 'string' &&
        typeof m.pid === 'number' &&
        typeof m.startedAt === 'number' &&
        typeof m.lastBeatAt === 'number'
    );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

async function withinBound(work: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        work,
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
            timer.unref?.();
        }),
    ]);
    if (timer) clearTimeout(timer);
}
