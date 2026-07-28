import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

function kernel(state: string, dataService?: unknown): any {
  return {
    getState: () => state,
    getService: (name: string) => (name === 'data' ? dataService : undefined),
    getServiceAsync: async () => undefined,
  };
}
const ctx: any = {};

/** An engine whose `checkDriversHealth` reports the given verdicts. */
function engine(results: Array<{ driverName: string; healthy: boolean }>) {
  return { checkDriversHealth: vi.fn(async () => results) };
}

describe('HttpDispatcher — GET /ready readiness probe', () => {
  it('returns 200 when the kernel is running', async () => {
    const res = await new HttpDispatcher(kernel('running')).dispatch('GET', '/ready', undefined, undefined, ctx);
    expect(res.handled).toBe(true);
    expect(res.response.status).toBe(200);
    expect(res.response.body.data.state).toBe('running');
  });

  it('returns 503 while booting or shutting down', async () => {
    for (const state of ['idle', 'initializing', 'stopping', 'stopped']) {
      const res = await new HttpDispatcher(kernel(state)).dispatch('GET', '/ready', undefined, undefined, ctx);
      expect(res.response.status).toBe(503);
    }
  });

  // framework#3756 — a running kernel whose driver is down fails 100% of its
  // requests; readiness is what takes it out of the load-balancer rotation.
  describe('data-driver gating', () => {
    it('returns 200 when every driver is healthy', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engine([{ driverName: 'sql', healthy: true }])),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(res.response.status).toBe(200);
    });

    it('returns 503 naming the driver when one is down, even though the kernel runs', async () => {
      const res = await new HttpDispatcher(
        kernel('running', engine([
          { driverName: 'sql', healthy: false },
          { driverName: 'memory', healthy: true },
        ])),
      ).dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(res.response.status).toBe(503);
      expect(res.response.body.error.message).toBe('Data driver unavailable');
      expect(res.response.body.error.details).toEqual({ state: 'running', drivers: ['sql'] });
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

      expect(res.response.status).toBe(200);
    });

    it('stays ready on an engine predating checkDriversHealth', async () => {
      const res = await new HttpDispatcher(kernel('running', { find: async () => [] }))
        .dispatch('GET', '/ready', undefined, undefined, ctx);

      expect(res.response.status).toBe(200);
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

    expect(res.response.status).toBe(200);
    expect(res.response.body.data.status).toBe('ok');
    expect(e.checkDriversHealth).not.toHaveBeenCalled();
  });
});
