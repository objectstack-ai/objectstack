// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A Redis outage under two running kernels, against a real `redis-server`
 * (skipped, and saying so, where the binary is not on PATH — the in-process
 * pins of every piece below run everywhere: `cluster-resync.test.ts` and the
 * bridge tests in `@objectstack/service-cluster`, the lock latch in
 * `@objectstack/service-job`'s `cron-job-adapter.leader.test.ts`).
 *
 * Two replicas — two kernels, each a cluster plugin on the redis driver and a
 * cron job service whose scheduled fire is leader-elected on the cluster lock —
 * share one password-protected Redis. Redis is stopped and started again
 * under them. Pinned:
 *
 *   - no unhandled rejection (before the fix: an unhandled lock rejection at
 *     the next tick, which ends the process), and one outage warning per
 *     replica, with no credential in it;
 *   - the next scheduled fire after Redis returns runs;
 *   - a cache hint published DURING the outage is lost (at-most-once), and the
 *     peer converges anyway, on the one `cluster.resync` its driver emits;
 *   - a hint published after Redis returns reaches the peer (resubscribed).
 *
 * And the scope-note pin: against a black-holed Redis (a socket that accepts
 * and never answers) a command on the connection the shared cache derives
 * from the driver's (`client.duplicate()`, as `CacheServicePlugin` does) fails
 * within the driver's command bound instead of hanging.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { IClusterService, IJobService } from '@objectstack/spec/contracts';
import {
    ClusterServicePlugin,
    defineCluster,
    onClusterResync,
    readClusterDriverConnection,
    readClusterDriverHealth,
} from '@objectstack/service-cluster';
import { JobServicePlugin } from '@objectstack/service-job';
// Registers the `redis` cluster driver with `defineCluster()`.
import { REDIS_COMMAND_TIMEOUT_MS } from './index.js';

const REDIS_SERVER = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;
const PASSWORD = 'outage-pin-s3cret';

/** A TCP port nothing on 127.0.0.1 is listening on right now. */
function freePort(): Promise<number> {
    return new Promise((answer, fail) => {
        const probe = createServer();
        probe.once('error', fail);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address() as AddressInfo;
            probe.close(() => answer(port));
        });
    });
}

/** One authenticated PING to 127.0.0.1:`port`; true on `+PONG`. */
function pongs(port: number): Promise<boolean> {
    return new Promise((answer) => {
        const conn = connect(port, '127.0.0.1');
        let reply = '';
        const done = (ok: boolean): void => { conn.destroy(); answer(ok); };
        conn.setTimeout(500, () => done(false));
        conn.once('error', () => done(false));
        conn.once('connect', () => conn.write(`AUTH ${PASSWORD}\r\nPING\r\n`));
        conn.on('data', (chunk: Buffer) => {
            reply += chunk.toString();
            if (reply.includes('PONG')) done(true);
            else if (reply.includes('-')) done(false);
        });
    });
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 25));
    }
}

describe.skipIf(!REDIS_SERVER)(
    'a Redis outage under two running kernels — real redis-server (skipped when redis-server is not on PATH)',
    () => {
        let dir = '';
        let port = 0;
        let server: ChildProcess | undefined;

        async function startRedis(): Promise<void> {
            server = spawn(
                'redis-server',
                ['--port', String(port), '--bind', '127.0.0.1', '--requirepass', PASSWORD,
                    '--save', '', '--appendonly', 'no', '--dir', dir],
                { stdio: ['ignore', 'ignore', 'ignore'] },
            );
            const deadline = Date.now() + 10_000;
            while (!(await pongs(port))) {
                if (server.exitCode !== null) throw new Error(`redis-server exited (${server.exitCode})`);
                if (Date.now() > deadline) throw new Error('redis-server did not answer PING within 10s');
                await new Promise((r) => setTimeout(r, 25));
            }
        }

        async function stopRedis(): Promise<void> {
            const proc = server;
            server = undefined;
            if (!proc || proc.exitCode !== null) return;
            const exited = new Promise((r) => proc.once('exit', r));
            proc.kill('SIGKILL');
            await exited;
        }

        beforeAll(async () => {
            dir = mkdtempSync(join(tmpdir(), 'os-redis-outage-'));
            port = await freePort();
            await startRedis();
        }, 15_000);

        afterAll(async () => {
            await stopRedis();
            if (dir) rmSync(dir, { recursive: true, force: true });
        });

        it('replicas stay up, warn once, resume firing, and converge a hint lost during the outage', async () => {
            const url = `redis://:${PASSWORD}@127.0.0.1:${port}`;
            const unhandled: unknown[] = [];
            const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
            process.on('unhandledRejection', onUnhandled);

            // What the kernels' logger writes (the cron adapter's lines).
            const written: string[] = [];
            const write = process.stdout.write.bind(process.stdout);
            const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
                written.push(String(chunk));
                return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
            }) as typeof process.stdout.write);

            const driverLines: Record<string, string[]> = { A: [], B: [] };
            let runs = 0;
            const kernels: LiteKernel[] = [];
            const boot = async (nodeId: 'A' | 'B') => {
                const kernel = new LiteKernel({ logger: { level: 'warn', format: 'text' } });
                kernel.use(new ClusterServicePlugin({
                    config: {
                        driver: 'redis',
                        url,
                        nodeId,
                        driverOptions: {
                            logger: {
                                warn: (m: string) => driverLines[nodeId]!.push(m),
                                info: (m: string) => driverLines[nodeId]!.push(m),
                            },
                        },
                    },
                }));
                kernel.use(new JobServicePlugin({ adapter: 'cron' }));
                await kernel.bootstrap();
                kernels.push(kernel);
                const job = kernel.getService<IJobService>('job');
                await job.schedule('probe', { type: 'interval', intervalMs: 100 }, async () => { runs += 1; });
                return kernel.getService<IClusterService>('cluster');
            };

            try {
                const a = await boot('A');
                const b = await boot('B');

                // The peer's cache: it holds what it last read from the shared
                // source of truth, re-reads on a hint, and on a resync.
                let truth = 'v1';
                let peerView = truth;
                const resyncs = { A: 0, B: 0 };
                b.pubsub.subscribe('cache.hint', () => { peerView = truth; });
                onClusterResync(a, () => { resyncs.A += 1; });
                onClusterResync(b, () => { resyncs.B += 1; peerView = truth; });

                await waitFor('a first scheduled fire', () => runs > 0);
                // Both connections of both replicas are up before the outage.
                await a.pubsub.publish('cache.hint', {});
                await waitFor('replica health up', () =>
                    readClusterDriverHealth(a)?.state === 'up' && readClusterDriverHealth(b)?.state === 'up');

                // ── Outage ───────────────────────────────────────────────
                await stopRedis();
                await waitFor('replica A to see the outage', () => readClusterDriverHealth(a)?.state === 'down');
                truth = 'v2';
                await expect(a.pubsub.publish('cache.hint', {})).rejects.toThrow();
                const runsDuringOutage = runs;
                // Several ticks of every job against the dead lock.
                await new Promise((r) => setTimeout(r, 800));
                expect(runs).toBe(runsDuringOutage);
                expect(peerView).toBe('v1');

                // ── Redis returns ────────────────────────────────────────
                await startRedis();
                await waitFor('both replicas to resync', () => resyncs.A === 1 && resyncs.B === 1);
                // The hint published during the outage was lost; the peer converged on the resync.
                expect(peerView).toBe('v2');
                expect(readClusterDriverHealth(b)).toMatchObject({ state: 'up', outages: 1 });

                // The next scheduled fire runs.
                const runsAtReturn = runs;
                await waitFor('a scheduled fire after Redis returned', () => runs > runsAtReturn);

                // A hint published now reaches the peer (the subscriber resubscribed).
                await waitFor('the subscriber to be back', () => readClusterDriverHealth(b)?.state === 'up');
                truth = 'v3';
                await a.pubsub.publish('cache.hint', {});
                await waitFor('the peer to receive the hint', () => peerView === 'v3');

                // ── What was said ────────────────────────────────────────
                expect(unhandled).toEqual([]);
                for (const node of ['A', 'B'] as const) {
                    const lost = driverLines[node]!.filter((l) => l.includes('lost its connection'));
                    expect(lost, `replica ${node}'s outage lines`).toHaveLength(1);
                    expect(lost[0]).toContain(`127.0.0.1:${port}`);
                    expect(driverLines[node]!.filter((l) => l.includes('reconnected'))).toHaveLength(1);
                    for (const line of driverLines[node]!) expect(line).not.toContain(PASSWORD);
                }
                const cronWarnings = written.filter((l) => l.includes('CronJobAdapter: the cluster lock could not'));
                // At most one per replica (a replica whose ticks all landed between
                // health flips may have none), never one per tick.
                expect(cronWarnings.length).toBeLessThanOrEqual(2);
                for (const line of written) expect(line).not.toContain(PASSWORD);
                expect(resyncs).toEqual({ A: 1, B: 1 });
            } finally {
                stdoutSpy.mockRestore();
                process.off('unhandledRejection', onUnhandled);
                await Promise.all(kernels.map((k) => k.shutdown()));
            }
        }, 30_000);
    },
);

describe('a black-holed Redis fails a cache call within the command bound', () => {
    let blackHole: Server | undefined;
    const sockets: Socket[] = [];

    afterAll(async () => {
        for (const s of sockets) s.destroy();
        await new Promise<void>((r) => (blackHole ? blackHole.close(() => r()) : r()));
    });

    it(`a GET on the cache's derived connection rejects within ${REDIS_COMMAND_TIMEOUT_MS} ms (+ slack), not ~30 s`, async () => {
        // Accepts the TCP connection and never answers a byte: the
        // network-partition shape, where connection refused never arrives.
        blackHole = createServer((socket) => { sockets.push(socket); socket.on('data', () => {}); });
        await new Promise<void>((r) => blackHole!.listen(0, '127.0.0.1', () => r()));
        const { port } = blackHole.address() as AddressInfo;

        const cluster = defineCluster({ driver: 'redis', url: `redis://:${PASSWORD}@127.0.0.1:${port}`, nodeId: 'bh' });
        try {
            const offered = readClusterDriverConnection<Redis>(cluster, 'redis');
            expect(offered).toBeDefined();
            // Exactly how `CacheServicePlugin` derives the shared cache's connection.
            const derived = offered!.client.duplicate();
            // The handshake times out too, and ioredis reports that as a
            // connection `error`; the cache's own derived connection is the
            // cache plugin's to listen on. Here only the command's bound is
            // under test.
            derived.on('error', () => {});
            try {
                const started = Date.now();
                await expect(derived.get('os:cache:probe')).rejects.toThrow(/timed out/i);
                const elapsed = Date.now() - started;
                expect(elapsed).toBeGreaterThanOrEqual(REDIS_COMMAND_TIMEOUT_MS - 100);
                expect(elapsed).toBeLessThan(REDIS_COMMAND_TIMEOUT_MS + 1_500);
            } finally {
                derived.disconnect();
            }
        } finally {
            await cluster.close();
        }
    }, 10_000);
});
