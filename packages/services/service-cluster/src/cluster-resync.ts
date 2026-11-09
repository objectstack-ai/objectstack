// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A remote cluster driver's connection health, and the `cluster.resync` event
 * it emits when its connection comes back after an outage.
 *
 * ## Why this exists
 *
 * Every cross-node cache-invalidation lane in this repository rides `IPubSub`,
 * whose delivery is at-most-once (`cluster.mdx` §4.2): a hint published while
 * the store is unreachable is simply gone. Before this module a replica that
 * missed hints during an outage kept serving what it had cached until its next
 * restart — the outage was over, the staleness was not. A remote driver now
 * reports its connection's transitions here, and on the transition back to
 * healthy this module emits ONE local `cluster.resync` event; every cache that
 * holds cross-node state subscribes and flushes or re-reads on it, so a write
 * whose hint was lost during the outage converges without a restart.
 *
 * The same transitions are where the outage is logged — ONE warning when it
 * starts, one info line when it ends, never a line per failed command and
 * never a credential — and {@link readClusterDriverHealth} reads them back.
 *
 * ## Passive reading vs. active probe
 *
 * {@link readClusterDriverHealth} is PASSIVE: it reports what the driver's
 * connections last said (`error` / `close` / `ready`), costs nothing, and
 * sends nothing to the store. It cannot see a black-holed store whose socket
 * never errors. `probeClusterDriverHealth()` (`driver-health.ts`, #31601) is
 * the ACTIVE check `/ready` uses: a bounded `PING` against the store, which
 * does see that case. Its `ClusterDriverHealth` (`reachable`, `reason`) is a
 * different shape from this module's {@link ClusterDriverLivenessHealth}.
 *
 * ## The single-node path is untouched
 *
 * Only a remote driver offers a liveness. The in-process `memory` driver never
 * loses a connection and offers none, so on it {@link onClusterResync} hands
 * back a disposer that does nothing and the handler never runs, and
 * {@link readClusterDriverHealth} answers `undefined`.
 *
 * ## Why a `Symbol.for` key on the cluster instance
 *
 * The same reason `driver-connection.ts` gives: a process has been measured
 * holding two instances of this module (its ESM and CJS builds), so a module
 * registry would let the driver offer into one copy while a consumer read the
 * other. The offer lives on the cluster instance, under a key from the global
 * symbol registry.
 */

import type { Unsubscribe } from '@objectstack/spec/contracts';

/** The event's name: one local event per recovered outage, never published to peers. */
export const CLUSTER_RESYNC_EVENT = 'cluster.resync' as const;

/** What a {@link onClusterResync} handler receives. */
export interface ClusterResyncEvent {
    readonly event: typeof CLUSTER_RESYNC_EVENT;
    /** The driver whose connection came back (`'redis'`). */
    readonly driver: string;
    /** This node's cluster id. */
    readonly nodeId: string;
    /** How long the connection was down, in ms. */
    readonly outageMs: number;
    /** When the connection came back (epoch ms). */
    readonly at: number;
}

/** A {@link onClusterResync} handler. A returned promise is awaited for its rejection only. */
export type ClusterResyncHandler = (event: ClusterResyncEvent) => void | Promise<void>;

/**
 * The driver's connection health, as {@link readClusterDriverHealth} reports it.
 *
 * `state` is `unknown` until the driver has connected or failed once (the
 * driver connects lazily, on first use), `up` while every connection it
 * watches is ready, and `down` from the first connection failure until every
 * failed connection is ready again.
 */
export interface ClusterDriverLivenessHealth {
    readonly driver: string;
    readonly nodeId: string;
    readonly state: 'unknown' | 'up' | 'down';
    /** When `state` last changed (epoch ms); construction time while `unknown`. */
    readonly since: number;
    /** Outages begun since construction, the current one included. */
    readonly outages: number;
    /** The current outage's first failure, credential-free; absent while not `down`. */
    readonly lastError?: string;
}

/** Where the liveness writes its two lines. Defaults to `console`. */
export interface ClusterDriverLivenessLogger {
    warn(message: string): void;
    info?(message: string): void;
}

export interface ClusterDriverLivenessOptions {
    driver: string;
    nodeId: string;
    /**
     * What the driver connects to, credential-free (`host:port`) — named in the
     * outage line so an operator knows which store is gone.
     */
    target?: string;
    logger?: ClusterDriverLivenessLogger;
    /** Clock, for tests. */
    now?: () => number;
}

/**
 * The connection state machine a remote driver feeds. The driver reports each
 * connection it holds by a stable `source` name (`'command'`, `'subscriber'`):
 * {@link reportDown} on an error or an unexpected close, {@link reportUp} when
 * that connection is ready. The outage begins at the first `reportDown` and
 * ends when every source that went down is up again; that end is when the
 * resync handlers run, once.
 */
export class ClusterDriverLiveness {
    private readonly driver: string;
    private readonly nodeId: string;
    private readonly target: string | undefined;
    private readonly logger: ClusterDriverLivenessLogger;
    private readonly now: () => number;
    private readonly handlers = new Set<ClusterResyncHandler>();
    /** Sources currently failed. Non-empty ⇔ `down`. */
    private readonly downSources = new Set<string>();
    private state: ClusterDriverLivenessHealth['state'] = 'unknown';
    private since: number;
    private outages = 0;
    private outageStartedAt = 0;
    private lastError: string | undefined;
    private closed = false;

    constructor(options: ClusterDriverLivenessOptions) {
        this.driver = options.driver;
        this.nodeId = options.nodeId;
        this.target = options.target;
        this.logger = options.logger ?? console;
        this.now = options.now ?? Date.now;
        this.since = this.now();
    }

    /** A connection failed or closed unexpectedly. The first one in an outage logs; the rest are silent. */
    reportDown(source: string, error?: unknown): void {
        if (this.closed) return;
        this.downSources.add(source);
        if (this.state === 'down') return;
        this.state = 'down';
        this.since = this.now();
        this.outageStartedAt = this.since;
        this.outages += 1;
        this.lastError = describeConnectionError(error);
        this.logger.warn(
            `[cluster] ${this.driver} driver lost its connection${this.target ? ` to ${this.target}` : ''} ` +
                `(node=${this.nodeId}): ${this.lastError}. Cluster locks, counters and cross-node cache hints fail ` +
                'until it returns; scheduled fires are skipped and retried on their next tick, and every cache ' +
                `re-reads on the "${CLUSTER_RESYNC_EVENT}" event when it does. Further failures during this outage are not logged.`,
        );
    }

    /** A connection is ready. Ends the outage once every failed source is ready, and runs the resync handlers then. */
    reportUp(source: string): void {
        if (this.closed) return;
        this.downSources.delete(source);
        if (this.state === 'up') return;
        if (this.state === 'unknown') {
            this.state = 'up';
            this.since = this.now();
            return;
        }
        if (this.downSources.size > 0) return;
        const at = this.now();
        const outageMs = Math.max(0, at - this.outageStartedAt);
        this.state = 'up';
        this.since = at;
        this.lastError = undefined;
        this.logger.info?.(
            `[cluster] ${this.driver} driver reconnected${this.target ? ` to ${this.target}` : ''} ` +
                `(node=${this.nodeId}) after ${outageMs} ms; emitting "${CLUSTER_RESYNC_EVENT}" so caches re-read what they may have missed.`,
        );
        this.emitResync({ event: CLUSTER_RESYNC_EVENT, driver: this.driver, nodeId: this.nodeId, outageMs, at });
    }

    /** Stop reporting: a deliberate close is not an outage. Idempotent. */
    close(): void {
        this.closed = true;
        this.handlers.clear();
    }

    /** The current reading. */
    health(): ClusterDriverLivenessHealth {
        return {
            driver: this.driver,
            nodeId: this.nodeId,
            state: this.state,
            since: this.since,
            outages: this.outages,
            ...(this.state === 'down' && this.lastError !== undefined ? { lastError: this.lastError } : {}),
        };
    }

    /** Run `handler` on every `cluster.resync`. */
    onResync(handler: ClusterResyncHandler): Unsubscribe {
        if (this.closed) return () => {};
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    private emitResync(event: ClusterResyncEvent): void {
        for (const handler of [...this.handlers]) {
            try {
                const result = handler(event);
                if (result && typeof (result as Promise<void>).then === 'function') {
                    (result as Promise<void>).catch((err) => this.reportHandlerFailure(err));
                }
            } catch (err) {
                this.reportHandlerFailure(err);
            }
        }
    }

    private reportHandlerFailure(err: unknown): void {
        this.logger.warn(
            `[cluster] a "${CLUSTER_RESYNC_EVENT}" handler failed (node=${this.nodeId}): ${describeConnectionError(err)}. ` +
                'That cache keeps what it held until its own TTL or the next resync.',
        );
    }
}

/**
 * One line describing a connection failure, with any credential removed. A
 * driver's error text can carry the URL it dialled, and a URL can carry a
 * password (`redis://user:secret@host`): the userinfo part is masked whatever
 * the scheme.
 */
export function describeConnectionError(error: unknown): string {
    if (error === undefined) return 'connection closed';
    const raw =
        error instanceof Error
            ? `${(error as { code?: unknown }).code ? `${String((error as { code?: unknown }).code)}: ` : ''}${error.message}`
            : String(error);
    return redactCredentials(raw);
}

/** Mask the userinfo of every `scheme://user:pass@` in `text`. */
export function redactCredentials(text: string): string {
    return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1***@');
}

// ---------------------------------------------------------------------------
// The offer on the cluster instance
// ---------------------------------------------------------------------------

/** The global-registry key the liveness is offered under. */
const DRIVER_LIVENESS_KEY = Symbol.for('@objectstack/service-cluster:driver-liveness');

/**
 * Offer `liveness` on `cluster`. Called once by a remote driver's factory, on
 * the instance it returns. A second offer on the same instance throws — one
 * cluster instance has one driver.
 */
export function offerClusterDriverLiveness(cluster: object, liveness: ClusterDriverLiveness): void {
    if (Object.prototype.hasOwnProperty.call(cluster, DRIVER_LIVENESS_KEY)) {
        throw new Error('offerClusterDriverLiveness: this cluster instance already offers a driver liveness.');
    }
    Object.defineProperty(cluster, DRIVER_LIVENESS_KEY, {
        value: liveness,
        enumerable: false,
        writable: false,
        configurable: false,
    });
}

function readLiveness(cluster: unknown): ClusterDriverLiveness | undefined {
    if (!cluster || (typeof cluster !== 'object' && typeof cluster !== 'function')) return undefined;
    const value = (cluster as Record<symbol, unknown>)[DRIVER_LIVENESS_KEY];
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Partial<ClusterDriverLiveness>;
    if (typeof candidate.onResync !== 'function' || typeof candidate.health !== 'function') return undefined;
    return value as ClusterDriverLiveness;
}

/**
 * Run `handler` each time `cluster`'s driver reconnects after an outage — the
 * `cluster.resync` event. A cache that holds cross-node state flushes or
 * re-reads in it. The event is local: it is never published to peers, and
 * each replica emits its own when its own connection returns.
 *
 * On a cluster whose driver offers no liveness (the in-process `memory`
 * driver, which cannot lose a connection) this returns a disposer that does
 * nothing, and `handler` never runs.
 */
export function onClusterResync(cluster: unknown, handler: ClusterResyncHandler): Unsubscribe {
    const liveness = readLiveness(cluster);
    if (!liveness) return () => {};
    return liveness.onResync(handler);
}

/**
 * `cluster`'s driver connection health, or `undefined` when its driver offers
 * none (the in-process `memory` driver). Read it per probe: it is a snapshot.
 */
export function readClusterDriverHealth(cluster: unknown): ClusterDriverLivenessHealth | undefined {
    return readLiveness(cluster)?.health();
}
