import { describe, it, expect, vi } from 'vitest';
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
