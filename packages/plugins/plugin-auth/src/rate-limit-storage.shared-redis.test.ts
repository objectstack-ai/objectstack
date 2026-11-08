// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D2, end to end: a deployment that DECLARES multiple replicas and
 * runs the redis cluster driver enforces ONE sign-in limit across replicas —
 * not `declared × replicas`.
 *
 * Every leg counts through the seam `AuthPlugin` hands better-auth
 * (`rateLimit.customStorage` = `createLazyCacheRateLimitStorage` over
 * `resolveKernelCache`), over a kernel composed the way a replica is: the
 * cluster plugin with the redis driver, then `CacheServicePlugin`, which picks
 * its adapter from the replica's own `OS_CLUSTER_REPLICAS`. ⛔ Never
 * better-auth's `secondaryStorage` — that moves the session of record into the
 * cache (see `secondary-storage.ts`).
 *
 * Each leg runs its CONTROL beside it: the same replicas without the
 * declaration count per replica and admit `max` EACH. The control is what
 * shows the shared leg's number is the store's doing and not the harness's.
 *
 *  1. In-process (runs everywhere, CI included): two kernels on two
 *     `ioredis-mock` clients sharing one keyspace.
 *  2. Two OS processes against a real `redis-server` (runs where the binary is
 *     on PATH, and says so when skipped): the replicas share nothing but the
 *     Redis — not the module-level per-key queue that orders every in-process
 *     limiter, not a client, not a keyspace double.
 *
 * Requests alternate between replicas one at a time, so the expected count is
 * exact. Two replicas counting the SAME key in the same instant can still both
 * be admitted at the boundary — `ICacheService` has no atomic increment — and
 * that bounded imprecision is the trade ADR-0069 D2 states; this file pins the
 * order-of-magnitude property (one limit, not N), not an atomic one.
 */

import { fork, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error — ioredis-mock publishes no type declarations
import RedisMock from 'ioredis-mock';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { CacheServicePlugin, MemoryCacheAdapter, RedisCacheAdapter } from '@objectstack/service-cache';
import { ClusterServicePlugin } from '@objectstack/service-cluster';
// Registers the `redis` cluster driver with `defineCluster()`.
import '@objectstack/service-cluster-redis';

import { resolveKernelCache } from './kernel-cache.js';
import { createLazyCacheRateLimitStorage } from './rate-limit-storage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const FIXTURE = resolve(HERE, 'rate-limit-storage.shared-redis.fixture.ts');

const RULE = { window: 60, max: 5 } as const;
const ATTEMPTS = 10;

type Replica = { consume(key: string): Promise<boolean> };

/** Alternate `ATTEMPTS` sign-in attempts on one key across the replicas, one at a time; answer how many were admitted. */
async function admittedAcross(replicas: Replica[], key: string): Promise<number> {
  let admitted = 0;
  for (let i = 0; i < ATTEMPTS; i++) {
    if (await replicas[i % replicas.length]!.consume(key)) admitted++;
  }
  return admitted;
}

let keySeq = 0;
const uniqueKey = (): string => `sign-in:ip:203.0.113.${process.pid % 200}:${++keySeq}:${Date.now()}`;

describe('one sign-in limit across replicas — in-process kernels over ioredis-mock', () => {
  const kernels: ObjectKernel[] = [];
  const clients: Array<{ quit(): Promise<unknown> }> = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(kernels.splice(0).map((k) => k.shutdown()));
    await Promise.all(clients.splice(0).map((c) => c.quit().catch(() => undefined)));
  });

  async function replica(nodeId: string): Promise<{ replica: Replica; kernel: ObjectKernel }> {
    // Each replica its own client; ioredis-mock instances share one keyspace,
    // the way two replicas' clients share one Redis.
    const client = new RedisMock();
    clients.push(client);
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, skipSystemValidation: true } as never);
    await kernel.use(new ClusterServicePlugin({ config: { driver: 'redis', nodeId, driverOptions: { client } } }));
    await kernel.use(new CacheServicePlugin());
    await kernel.bootstrap();
    kernels.push(kernel);
    const ctx = {
      getKernel: () => kernel,
      getService: <T>(name: string): T => kernel.getService<T>(name),
    } as unknown as Parameters<typeof resolveKernelCache>[0];
    const storage = createLazyCacheRateLimitStorage({ resolveCache: () => resolveKernelCache(ctx) });
    return { kernel, replica: { consume: async (key) => (await storage.consume(key, RULE)).allowed } };
  }

  it('declared multi-node (OS_CLUSTER_REPLICAS=2) over redis: both replicas count in Redis and admit `max` IN TOTAL', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const a = await replica('replica-a');
    const b = await replica('replica-b');
    expect(a.kernel.getService('cache')).toBeInstanceOf(RedisCacheAdapter);
    expect(b.kernel.getService('cache')).toBeInstanceOf(RedisCacheAdapter);
    expect(await admittedAcross([a.replica, b.replica], uniqueKey())).toBe(RULE.max);
  });

  it('CONTROL — no declaration: each replica keeps a per-process cache and admits `max` on its own', async () => {
    const a = await replica('replica-a');
    const b = await replica('replica-b');
    expect(a.kernel.getService('cache')).toBeInstanceOf(MemoryCacheAdapter);
    expect(await admittedAcross([a.replica, b.replica], uniqueKey())).toBe(ATTEMPTS);
  });
});

const REDIS_SERVER = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;

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

/** One PING to 127.0.0.1:`port`; true on `+PONG`. */
function pongs(port: number): Promise<boolean> {
  return new Promise((answer) => {
    const conn = connect(port, '127.0.0.1');
    let reply = '';
    const done = (ok: boolean): void => { conn.destroy(); answer(ok); };
    conn.setTimeout(500, () => done(false));
    conn.once('error', () => done(false));
    conn.once('connect', () => conn.write('PING\r\n'));
    conn.on('data', (chunk: Buffer) => {
      reply += chunk.toString();
      if (reply.includes('\r\n')) done(reply.startsWith('+PONG'));
    });
  });
}

describe.skipIf(!REDIS_SERVER)(
  'one sign-in limit across replicas — two OS processes, one real redis-server (skipped when redis-server is not on PATH)',
  () => {
    let dir = '';
    let port = 0;
    let redisUrl = '';
    let server: ChildProcess | undefined;
    const children: ChildProcess[] = [];

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), 'os-shared-limit-'));
      // A URL, as `OS_REDIS_URL` is in production — the cluster config schema
      // accepts nothing else (a unix-socket path is refused as `url`).
      port = await freePort();
      redisUrl = `redis://127.0.0.1:${port}`;
      server = spawn(
        'redis-server',
        ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', dir],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      server.stdout!.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      server.stderr!.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      // Ready = it answers PING. Not a log line: its wording differs across
      // Redis versions.
      const deadline = Date.now() + 10_000;
      while (!(await pongs(port))) {
        if (server.exitCode !== null) throw new Error(`redis-server exited (${server.exitCode}):\n${out}`);
        if (Date.now() > deadline) throw new Error(`redis-server did not answer PING within 10s:\n${out}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    }, 15_000);

    afterAll(async () => {
      for (const child of children.splice(0)) child.kill('SIGKILL');
      if (server && server.exitCode === null) {
        server.kill('SIGTERM');
        await new Promise((r) => server!.once('exit', r));
      }
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    /** Fork one replica process; resolve once its kernel is up, with the adapter backing its `cache`. */
    async function startReplica(nodeId: string, env: Record<string, string>): Promise<Replica & { cache: string; stop(): Promise<void> }> {
      const childEnv = { ...process.env, ...env };
      if (!('OS_CLUSTER_REPLICAS' in env)) delete childEnv.OS_CLUSTER_REPLICAS;
      delete childEnv.OS_EXPECT_MULTI_NODE;
      const child = fork(FIXTURE, [redisUrl, nodeId], {
        cwd: PKG,
        execArgv: ['--import', 'tsx'],
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      children.push(child);
      let stderr = '';
      child.stderr!.on('data', (c: Buffer) => { stderr += c.toString(); });

      const pending = new Map<number, { done(allowed: boolean): void; fail(err: Error): void }>();
      let seq = 0;
      const cache = await new Promise<string>((ready, fail) => {
        const timer = setTimeout(() => fail(new Error(`replica ${nodeId} did not boot:\n${stderr}`)), 20_000);
        child.on('message', (m: { type: string; cache?: string; message?: string; id?: number; allowed?: boolean; error?: string }) => {
          if (m.type === 'ready') { clearTimeout(timer); ready(m.cache!); }
          else if (m.type === 'failed') { clearTimeout(timer); fail(new Error(`replica ${nodeId} failed to boot: ${m.message}\n${stderr}`)); }
          else if (m.type === 'decision') {
            const waiter = pending.get(m.id!);
            pending.delete(m.id!);
            if (m.error) waiter?.fail(new Error(`replica ${nodeId} consume failed: ${m.error}`));
            else waiter?.done(m.allowed === true);
          }
        });
        child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`replica ${nodeId} exited (${code}):\n${stderr}`)); });
      });

      return {
        cache,
        consume: (key) => new Promise<boolean>((done, fail) => {
          const id = ++seq;
          pending.set(id, { done, fail });
          child.send({ type: 'consume', id, key, window: RULE.window, max: RULE.max });
        }),
        stop: () => new Promise<void>((done) => {
          if (child.exitCode !== null) return done();
          child.removeAllListeners('exit');
          child.once('exit', () => done());
          child.send({ type: 'exit' });
        }),
      };
    }

    it('declared multi-node over redis: two replica PROCESSES admit `max` IN TOTAL; without the declaration, `max` EACH', async () => {
      const [a, b, soloA, soloB] = await Promise.all([
        startReplica('replica-a', { OS_CLUSTER_REPLICAS: '2' }),
        startReplica('replica-b', { OS_CLUSTER_REPLICAS: '2' }),
        startReplica('solo-a', {}),
        startReplica('solo-b', {}),
      ]);
      try {
        expect([a.cache, b.cache]).toEqual(['redis', 'redis']);
        expect(await admittedAcross([a, b], uniqueKey())).toBe(RULE.max);

        // CONTROL — same driver, same Redis, no declaration.
        expect([soloA.cache, soloB.cache]).toEqual(['memory', 'memory']);
        expect(await admittedAcross([soloA, soloB], uniqueKey())).toBe(ATTEMPTS);
      } finally {
        await Promise.all([a.stop(), b.stop(), soloA.stop(), soloB.stop()]);
      }
    }, 30_000);
  },
);
