import { afterEach, describe, it, expect, vi } from 'vitest';
import { offerClusterDriverConnection } from '@objectstack/service-cluster';
import { HttpDispatcher, type HttpDispatcherResult } from './http-dispatcher.js';

function kernel(state: string, dataService?: unknown): any {
  return {
    getState: () => state,
    getService: (name: string) => (name === 'data' ? dataService : undefined),
    getServiceAsync: async () => undefined,
  };
}
const ctx: any = {};

/**
 * `HttpDispatcherResult.response` is OPTIONAL, so every read of it is a
 * `possibly undefined` in a type-checked program — and this package's test
 * layer IS type-checked, by `check:type-check-debt --re-measure` against a
 * shrink-only ledger, even though `pnpm test` never sees it. That asymmetry is
 * exactly how 19 fresh errors got in here behind a green `pnpm --filter
 * @objectstack/runtime typecheck`: the package's own tsconfig excludes every
 * `.test.ts` file, so the program that reported zero had never read this one.
 *
 * Narrow once, and narrow LOUDLY — the shape is lifted from the #8287 suite in
 * `http-dispatcher.keys.test.ts`, deliberately rather than invented again.
 * `expect(res.response).toBeDefined()` would satisfy a reader and narrow
 * nothing (vitest's matchers are not assertion signatures), and a `!` would
 * silence the compiler while leaving the failure to surface as `undefined is
 * not an object` three lines later. A probe that answered no response at all is
 * a different defect from one that answered the wrong status; this keeps them
 * distinguishable.
 *
 * Applied to the WHOLE file, not just the #13408 suite: the reads are identical
 * in kind, the repair is one call each, and leaving the older ones would bank a
 * green while knowingly holding fixable errors in a file already open.
 */
function responseOf(res: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
  const { response } = res;
  if (!response) throw new Error('GET /ready answered no response at all');
  return response;
}

/** An engine whose `checkDriversHealth` reports the given verdicts. */
function engine(results: Array<{ driverName: string; healthy: boolean }>) {
  return { checkDriversHealth: vi.fn(async () => results) };
}

/**
 * An engine that ALSO answers the #13408 primary-datasource criterion.
 *
 * Deliberately a second helper: `engine()` above stays the engine that predates
 * the criterion, which is itself one of the drain cases pinned below. Folding
 * the two would delete that control.
 */
function engineWithPrimary(
  results: Array<{ driverName: string; healthy: boolean }>,
  verdict: unknown,
) {
  return {
    checkDriversHealth: vi.fn(async () => results),
    resolvePrimaryDatasource: vi.fn(() => verdict),
  };
}

const primary = (datasource: string) => ({ resolved: true, datasource, witnesses: 3 });

describe('HttpDispatcher — GET /ready readiness probe', () => {
  it('returns 200 when the kernel is running', async () => {
    const res = await new HttpDispatcher(kernel('running')).dispatch('GET', '/ready', undefined, undefined, ctx);
    expect(res.handled).toBe(true);
    expect(responseOf(res).status).toBe(200);
    expect(responseOf(res).body.data.state).toBe('running');
  });

  it('returns 503 while booting or shutting down', async () => {
    for (const state of ['idle', 'initializing', 'stopping', 'stopped']) {
      const res = await new HttpDispatcher(kernel(state)).dispatch('GET', '/ready', undefined, undefined, ctx);
      expect(responseOf(res).status).toBe(503);
    }
  });

  // framework#3756 — a running kernel whose driver is down fails 100% of its
  // requests; readiness is what takes it out of the load-balancer rotation.
  describe('data-driver gating', () => {
    it('returns 200 when every driver is healthy', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engine([{ driverName: 'sql', healthy: true }])),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(200);
    });

    it('returns 503 naming the driver when one is down, even though the kernel runs', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engine([
          { driverName: 'sql', healthy: false },
          { driverName: 'memory', healthy: true },
        ])),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
      expect(responseOf(res).body.error.message).toBe('Data driver unavailable');
      expect(responseOf(res).body.error.details).toEqual({ state: 'running', drivers: ['sql'] });
    });

    it('does not re-probe within the memo TTL — k8s polls every few seconds', async () => {
      const e = engine([{ driverName: 'sql', healthy: true }]);
      const dispatcher = new HttpDispatcher(kernel('running', e));

      await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);
      await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);
      await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(e.checkDriversHealth).toHaveBeenCalledTimes(1);
    });

    it('stays ready when the probe itself throws — inconclusive is not unhealthy', async () => {
      const res = await new HttpDispatcher(
        kernel('running', {
          checkDriversHealth: async () => { throw new Error('engine exploded'); },
        }),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(200);
    });

    it('stays ready on an engine predating checkDriversHealth', async () => {
      const res = await new HttpDispatcher(kernel('running', { find: async () => [] }))
        .dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(200);
    });
  });
});

// #13408 — ruled 2026-08-31 (第 6 场总监席决裁批 #12, maintainer verbatim
// 「同意」), Option B: only the PRIMARY/default datasource's failure drains the
// node. A secondary/tenant datasource's failure is REPORTED and drains nothing.
//
//   「主/默认」判据必须是一条读得出来的事实 … ⛔ 不得用「第一个注册的」之类启发式。
//   错向红钉为交付要件:判据解析失败或歧义时 ⇒ fail toward draining(宁可误摘不可
//   静默保留),并有钉断言这个方向。
//
// framework#3756 is NOT overturned: its quantified reason ("a replica that would
// fail 100% of its requests") still holds in the single-datasource deployment it
// was measured on, and the first suite below pins that that deployment's answer
// is unchanged down to the response body.
describe('HttpDispatcher — GET /ready primary-vs-secondary drain (#13408)', () => {
  describe('the single-datasource deployment is unchanged', () => {
    it('the primary going down still drains, with the pre-#13408 envelope', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary([{ driverName: 'pg', healthy: false }], primary('pg'))),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
      expect(responseOf(res).body.error.message).toBe('Data driver unavailable');
      // Byte-identical to the shape #3756 shipped — an operator's alerting on
      // this body must not be able to tell that the handler changed.
      expect(responseOf(res).body.error.details).toEqual({ state: 'running', drivers: ['pg'] });
    });

    it('the all-healthy 200 body carries NO degraded key', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary([{ driverName: 'pg', healthy: true }], primary('pg'))),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(200);
      expect(responseOf(res).body.data).toEqual({ status: 'ready', state: 'running' });
      expect(responseOf(res).body.data).not.toHaveProperty('degraded');
    });

    it('does not even ASK which datasource is primary while everything is healthy', () => {
      // The carve-out is strict: a deployment with no unhealthy driver takes
      // the identical path it took before, so the new criterion cannot
      // introduce a way to LOSE a 200.
      const e = engineWithPrimary([{ driverName: 'pg', healthy: true }], primary('pg'));
      return new HttpDispatcher(kernel('running', e))
        .dispatch('GET', '/ready', undefined, undefined, ctx)
        .then(() => {
          expect(e.resolvePrimaryDatasource).not.toHaveBeenCalled();
        });
    });
  });

  describe('a SECONDARY datasource failure is reported, not drained', () => {
    it('returns 200 and names the failed driver in degraded.drivers', async () => {
      // The card's own shape: one tenant mongo datasource whose driver cannot
      // start, while Postgres and the app are healthy. Before #13408 this
      // answered 503 on every replica and drained the whole deployment.
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary(
          [{ driverName: 'pg', healthy: true }, { driverName: 'tenant_mongo', healthy: false }],
          primary('pg'),
        )),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(200);
      expect(responseOf(res).body.data.status).toBe('ready');
      // ⛔ The rejected fourth option — filtering the bad driver out so it
      // becomes invisible — would show an EMPTY degraded list here.
      expect(responseOf(res).body.data.degraded).toEqual({
        drivers: ['tenant_mongo'],
        primaryDatasource: 'pg',
      });
    });

    it('still drains when the primary is down TOO, even beside a healthy secondary', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary(
          [{ driverName: 'pg', healthy: false }, { driverName: 'tenant_mongo', healthy: true }],
          primary('pg'),
        )),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
      expect(responseOf(res).body.error.details.drivers).toEqual(['pg']);
    });

    it('drains when BOTH are down — the primary is in the unhealthy set', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary(
          [{ driverName: 'pg', healthy: false }, { driverName: 'tenant_mongo', healthy: false }],
          primary('pg'),
        )),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
      expect(responseOf(res).body.error.details.drivers).toEqual(['pg', 'tenant_mongo']);
    });
  });

  // ⭐ The delivery requirement of the ruling. Every way of NOT knowing which
  // datasource is primary must drain, because staying in rotation requires a
  // POSITIVE reading — never the absence of a negative one. Each case here is a
  // deployment where a real secondary IS down and the node drains anyway.
  describe('fail toward DRAINING when the criterion cannot be resolved', () => {
    const secondaryDown = [
      { driverName: 'pg', healthy: true },
      { driverName: 'tenant_mongo', healthy: false },
    ];

    it('an engine that cannot name a primary datasource at all drains', async () => {
      // `engine()` — no `resolvePrimaryDatasource`. An older engine, a lite
      // kernel, a non-ObjectQL data service.
      const res = await new HttpDispatcher(kernel('running', engine(secondaryDown)))
        .dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
      expect(responseOf(res).body.error.details).toEqual({
        state: 'running',
        drivers: ['tenant_mongo'],
      });
    });

    it('a criterion probe that THROWS drains', async () => {
      const res = await new HttpDispatcher(kernel('running', {
        checkDriversHealth: async () => secondaryDown,
        resolvePrimaryDatasource: () => { throw new Error('registry exploded'); },
      })).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
    });

    it.each([
      ['system-objects-split', { resolved: false, reason: 'system-objects-split' }],
      ['no-system-objects-registered', { resolved: false, reason: 'no-system-objects-registered' }],
      ['no-driver-registered', { resolved: false, reason: 'no-driver-registered' }],
      ['system-object-unbound', { resolved: false, reason: 'system-object-unbound' }],
    ])('an unresolved verdict (%s) drains', async (_reason, verdict) => {
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary(secondaryDown, verdict)),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a bare truthy object', { resolved: true }],
      ['an empty datasource name', { resolved: true, datasource: '' }],
      ['a non-string datasource', { resolved: true, datasource: 42 }],
    ])('a malformed verdict (%s) drains rather than being coerced into a name', async (_d, verdict) => {
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary(secondaryDown, verdict)),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(503);
    });

    it('NON-VACUITY: the same fixture returns 200 the moment the criterion resolves', async () => {
      // Without this control every assertion above would still pass if the
      // handler had simply stopped serving 200 at all.
      const res = await new HttpDispatcher(
        kernel('running', engineWithPrimary(secondaryDown, primary('pg'))),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(responseOf(res).status).toBe(200);
    });
  });

  it('the criterion is memoized with the health reading, not re-resolved per poll', async () => {
    const e = engineWithPrimary(
      [{ driverName: 'pg', healthy: true }, { driverName: 'tenant_mongo', healthy: false }],
      primary('pg'),
    );
    const dispatcher = new HttpDispatcher(kernel('running', e));

    await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);
    await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);
    await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);

    expect(e.checkDriversHealth).toHaveBeenCalledTimes(1);
    expect(e.resolvePrimaryDatasource).toHaveBeenCalledTimes(1);
  });
});

// #31601 (child of cloud epic #3814) — a declared multi-node deployment on the
// redis cluster driver reports the cluster store's reachability on `/ready`.
//
//   R3 「同意：每张卡都只在"声明多副本并接上 Redis 驱动"时才生效」
//   PM decision D4: an unreachable store answers 200 `status: degraded`, not
//   503 — every replica loses the store together, so a 503 would turn a
//   degraded cluster into a total outage while the database can still serve.
describe('HttpDispatcher — GET /ready cluster driver health (#31601)', () => {
  /** A `cluster` service on the redis driver, offering a client whose ping is `ping`. */
  function redisCluster(ping: () => Promise<unknown>) {
    const cluster = { driver: 'redis', nodeId: 'web-1' };
    offerClusterDriverConnection(cluster, { driver: 'redis', client: { ping }, keyPrefix: 'os:' });
    return cluster;
  }
  const redisDown = () => vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.7:6379'); });
  const redisUp = () => vi.fn(async () => 'PONG');

  /** A host kernel serving `data` and `cluster`. */
  function clusterKernel(state: string, cluster: unknown, dataService?: unknown): any {
    return {
      getState: () => state,
      getService: (name: string) => (name === 'data' ? dataService : name === 'cluster' ? cluster : undefined),
      getServiceAsync: async () => undefined,
    };
  }
  const ready = (k: any) => new HttpDispatcher(k).dispatch('GET', '/ready', undefined, undefined, ctx);

  afterEach(() => { vi.unstubAllEnvs(); });

  describe('declared multi-node on the redis driver', () => {
    it('Redis down: 200 — not 503 — with status degraded and a cluster entry naming the driver unreachable', async () => {
      vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
      const ping = redisDown();
      const res = await ready(clusterKernel('running', redisCluster(ping)));

      expect(responseOf(res).status).toBe(200);
      expect(responseOf(res).body.data).toEqual({
        status: 'degraded',
        state: 'running',
        cluster: { driver: 'redis', reachable: false, reason: 'ping-failed' },
      });
      // The reading is served anonymously: the store's address stays out.
      expect(JSON.stringify(responseOf(res).body)).not.toContain('10.0.0.7');
      expect(ping).toHaveBeenCalledTimes(1);
    });

    it('Redis up: 200 with status ready and a reachable cluster entry', async () => {
      vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
      const res = await ready(clusterKernel('running', redisCluster(redisUp())));

      expect(responseOf(res).status).toBe(200);
      expect(responseOf(res).body.data).toEqual({
        status: 'ready',
        state: 'running',
        cluster: { driver: 'redis', reachable: true },
      });
    });

    it('Redis down beside a degraded SECONDARY datasource: both are reported, still 200', async () => {
      vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
      const res = await ready(clusterKernel(
        'running',
        redisCluster(redisDown()),
        engineWithPrimary([{ driverName: 'pg', healthy: true }, { driverName: 'tenant_mongo', healthy: false }], primary('pg')),
      ));

      expect(responseOf(res).status).toBe(200);
      expect(responseOf(res).body.data).toEqual({
        status: 'degraded',
        state: 'running',
        degraded: { drivers: ['tenant_mongo'], primaryDatasource: 'pg' },
        cluster: { driver: 'redis', reachable: false, reason: 'ping-failed' },
      });
    });

    it('the primary datasource going down still answers the byte-identical 503, and never probes Redis', async () => {
      vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
      const ping = redisDown();
      const res = await ready(clusterKernel(
        'running',
        redisCluster(ping),
        engineWithPrimary([{ driverName: 'pg', healthy: false }], primary('pg')),
      ));

      expect(responseOf(res).status).toBe(503);
      expect(responseOf(res).body.error.message).toBe('Data driver unavailable');
      expect(responseOf(res).body.error.details).toEqual({ state: 'running', drivers: ['pg'] });
      expect(ping).not.toHaveBeenCalled();
    });

    it('the cluster probe is memoized with the same TTL — k8s polls must not each round-trip to Redis', async () => {
      vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
      const ping = redisDown();
      const dispatcher = new HttpDispatcher(clusterKernel('running', redisCluster(ping)));

      await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);
      await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);
      await dispatcher.dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(ping).toHaveBeenCalledTimes(1);
    });
  });

  // ⛔ The stopping (SIGTERM) / booting 503 — the graceful-drain path — is
  // reached before any probe, so a declared deployment with Redis down answers
  // it exactly as a single node does.
  it.each(['idle', 'initializing', 'stopping', 'stopped'])(
    'kernel %s: the 503 envelope is identical to the single-node one, and Redis is never probed',
    async (state) => {
      const single = responseOf(await ready(kernel(state)));
      vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
      const ping = redisDown();
      const declared = responseOf(await ready(clusterKernel(state, redisCluster(ping))));

      expect(declared.status).toBe(503);
      expect(declared.body.error.message).toBe('Service not ready');
      expect(declared.body).toEqual(single.body);
      expect(declared.body.error.details).toEqual({ state });
      expect(ping).not.toHaveBeenCalled();
    },
  );

  // ⛔ R3: nothing changes unless BOTH halves hold — the declaration AND the
  // redis driver. Each case below is missing one half; its body must be the
  // pre-#31601 body to the byte, and its cluster store is never pinged.
  describe('single node, or no redis driver: body and status unchanged', () => {
    it('single node (no declaration) with a redis cluster whose store is DOWN: the old body, no ping', async () => {
      const ping = redisDown();
      const res = await ready(clusterKernel('running', redisCluster(ping)));

      expect(responseOf(res).status).toBe(200);
      expect(JSON.stringify(responseOf(res).body.data)).toBe(JSON.stringify({ status: 'ready', state: 'running' }));
      expect(ping).not.toHaveBeenCalled();
    });

    it('single node: OS_CLUSTER_REPLICAS=1 is not a declaration', async () => {
      vi.stubEnv('OS_CLUSTER_REPLICAS', '1');
      const ping = redisDown();
      const res = await ready(clusterKernel('running', redisCluster(ping)));

      expect(responseOf(res).body.data).toEqual({ status: 'ready', state: 'running' });
      expect(ping).not.toHaveBeenCalled();
    });

    it('declared, but the cluster runs the in-process memory driver (guard escape hatch): the old body', async () => {
      vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
      const res = await ready(clusterKernel('running', { driver: 'memory', nodeId: 'web-1' }));

      expect(responseOf(res).status).toBe(200);
      expect(responseOf(res).body.data).toEqual({ status: 'ready', state: 'running' });
    });

    it('declared, but no cluster service at all — or a lookup that throws: the old body', async () => {
      vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
      const none = await ready(clusterKernel('running', undefined));
      expect(responseOf(none).body.data).toEqual({ status: 'ready', state: 'running' });

      const throwing = await ready({
        getState: () => 'running',
        getService: (name: string) => { if (name === 'cluster') throw new Error('not registered'); return undefined; },
        getServiceAsync: async () => undefined,
      });
      expect(responseOf(throwing).status).toBe(200);
      expect(responseOf(throwing).body.data).toEqual({ status: 'ready', state: 'running' });
    });

    it('single node with a degraded secondary: the #13408 body, no cluster key', async () => {
      const res = await ready(clusterKernel(
        'running',
        redisCluster(redisDown()),
        engineWithPrimary([{ driverName: 'pg', healthy: true }, { driverName: 'tenant_mongo', healthy: false }], primary('pg')),
      ));

      expect(responseOf(res).body.data).toEqual({
        status: 'ready',
        state: 'running',
        degraded: { drivers: ['tenant_mongo'], primaryDatasource: 'pg' },
      });
    });
  });
});

describe('HttpDispatcher — GET /health liveness probe', () => {
  // framework#3756: liveness must NOT check the database. Its failure makes the
  // orchestrator restart the pod, which cannot fix an unreachable database but
  // would put every replica into a restart storm during the outage.
  it('stays 200 while the data driver is down', async () => {
    const e = engine([{ driverName: 'sql', healthy: false }]);
    const res = await new HttpDispatcher(kernel('running', e))
      .dispatch('GET', '/health', undefined, undefined, ctx);

    expect(responseOf(res).status).toBe(200);
    expect(responseOf(res).body.data.status).toBe('ok');
    expect(e.checkDriversHealth).not.toHaveBeenCalled();
  });
});
