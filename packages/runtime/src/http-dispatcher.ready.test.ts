import { describe, it, expect } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

function kernel(state: string): any {
  return {
    getState: () => state,
    getService: () => undefined,
    getServiceAsync: async () => undefined,
  };
}
const ctx: any = {};

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
});
