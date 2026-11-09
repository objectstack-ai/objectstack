// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readClusterDriverConnection } from './driver-connection.js';

/**
 * Whether a remote cluster driver can reach its shared store right now.
 *
 * The reading a readiness probe reports for a declared multi-node deployment
 * (cloud epic #3814): every replica coordinates its locks, counters and
 * pub/sub through ONE store, so "this replica's database answers" is no longer
 * the whole readiness story — a replica whose cluster store is gone keeps
 * serving requests while it has silently stopped coordinating with its peers.
 *
 * `reason` is a closed vocabulary on purpose. The probe's own error text names
 * hosts and ports (`connect ECONNREFUSED 10.0.0.7:6379`), and the reading is
 * served on an endpoint that answers anonymous callers; the operator learns the
 * address from the deployment's own configuration, never from this body.
 */
export interface ClusterDriverHealth {
    /** The driver probed (`'redis'`). Matches `IClusterService.driver`. */
    readonly driver: string;
    /** `true` only when the store answered the probe with the expected reply. */
    readonly reachable: boolean;
    /** Why it is unreachable; absent when `reachable` is `true`. */
    readonly reason?: ClusterDriverUnreachableReason;
}

/**
 * Why a probe read the store as unreachable:
 * - `timeout` — no answer within the probe's bound;
 * - `ping-failed` — the client rejected the probe (connection refused, closed,
 *   retries exhausted);
 * - `unexpected-reply` — the store answered, but not with the probe's reply;
 * - `no-probe` — the driver offers a connection whose client has no `ping()`,
 *   so its reachability cannot be read at all.
 */
export type ClusterDriverUnreachableReason = 'timeout' | 'ping-failed' | 'unexpected-reply' | 'no-probe';

/** Options for {@link probeClusterDriverHealth}. */
export interface ProbeClusterDriverHealthOptions {
    /**
     * Upper bound on one probe, in ms (default {@link DEFAULT_CLUSTER_PROBE_TIMEOUT_MS}).
     * A store that is down can leave a client queueing the command while it
     * reconnects, so the probe never waits on the client's own give-up.
     */
    readonly timeoutMs?: number;
}

/**
 * Half of the one-second default Kubernetes readiness `timeoutSeconds`, so a
 * probe that has to wait out a silent store still answers the orchestrator.
 */
export const DEFAULT_CLUSTER_PROBE_TIMEOUT_MS = 500;

const TIMED_OUT = Symbol('cluster-probe-timed-out');

/**
 * Ping the store behind `cluster`'s `driver` connection, bounded by `timeoutMs`.
 *
 * Answers `undefined` — not a reading — when `cluster` offers no connection for
 * `driver` (`readClusterDriverConnection`): the in-process `memory` driver, a
 * different driver, or no cluster at all. A caller reports nothing then, which
 * is what keeps a deployment without the remote driver byte-identical.
 *
 * Never throws: every failure of the probe is a reading (`reachable: false`
 * with its `reason`), because the caller is a readiness handler that must
 * answer every poll.
 *
 * The probe is `PING` and the expected reply `PONG` — the Redis protocol's own
 * liveness command, which the ioredis client the redis driver offers exposes as
 * `client.ping()`. A driver whose client answers `PING` the same way is probed
 * the same way; any other client reads as `no-probe` rather than as healthy.
 */
export async function probeClusterDriverHealth(
    cluster: unknown,
    driver: string,
    options: ProbeClusterDriverHealthOptions = {},
): Promise<ClusterDriverHealth | undefined> {
    const connection = readClusterDriverConnection<{ ping?: () => Promise<unknown> }>(cluster, driver);
    if (!connection) return undefined;

    const client = connection.client;
    if (!client || typeof client.ping !== 'function') {
        return { driver, reachable: false, reason: 'no-probe' };
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_CLUSTER_PROBE_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
        // Never hold the process open for a probe nobody is waiting on.
        (timer as { unref?: () => void }).unref?.();
    });

    try {
        // `.then` inside the race so a ping that settles AFTER the timeout is
        // still observed — a late rejection must not surface as unhandled.
        const ping = Promise.resolve()
            .then(() => client.ping!())
            .then(
                (reply) => ({ ok: true as const, reply }),
                () => ({ ok: false as const }),
            );
        const outcome = await Promise.race([ping, timeout]);
        if (outcome === TIMED_OUT) return { driver, reachable: false, reason: 'timeout' };
        if (!outcome.ok) return { driver, reachable: false, reason: 'ping-failed' };
        if (outcome.reply !== 'PONG') return { driver, reachable: false, reason: 'unexpected-reply' };
        return { driver, reachable: true };
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
