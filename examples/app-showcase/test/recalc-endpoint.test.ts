// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { registerRecalcEndpoint } from '../src/server/recalc-endpoint.js';

/**
 * Unit coverage for the custom REST endpoint behind the `showcase_recalc_estimate`
 * **api** action (#2169 sibling: an api action whose endpoint was never mounted
 * 404s on click). Drives the registration + handler with fakes — no live server.
 */
function harness() {
  let kernelReady: (() => Promise<void> | void) | undefined;
  let routeHandler: ((req: unknown, res: unknown) => unknown) | undefined;
  const updates: Array<{ object: string; data: Record<string, unknown> }> = [];
  const ctx = {
    ql: {
      update: async (object: string, data: Record<string, unknown>) => {
        updates.push({ object, data });
        return { id: data.id };
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    hook: (event: string, handler: () => Promise<void> | void) => {
      if (event === 'kernel:ready') kernelReady = handler;
    },
    getService: async (name: string) =>
      name === 'http.server'
        ? { post: (_p: string, h: (req: unknown, res: unknown) => unknown) => { routeHandler = h; } }
        : undefined,
  };
  registerRecalcEndpoint(ctx as never);
  return {
    boot: async () => { await kernelReady?.(); },
    call: async (body: unknown) => {
      let status = 200;
      let json: unknown;
      await routeHandler?.({ body }, { status: (c: number) => { status = c; }, json: (b: unknown) => { json = b; } });
      return { status, json };
    },
    updates,
    hasRoute: () => routeHandler !== undefined,
  };
}

describe('showcase recalc endpoint', () => {
  it('registers the route on kernel:ready', async () => {
    const h = harness();
    expect(h.hasRoute()).toBe(false);
    await h.boot();
    expect(h.hasRoute()).toBe(true);
  });

  it('recomputes estimate from the schedule window (days × 8h) and persists it', async () => {
    const h = harness();
    await h.boot();
    const res = await h.call({ id: 't1', start_date: '2026-06-16', end_date: '2026-07-02' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, data: { id: 't1', estimate_hours: 136 } });
    expect(h.updates).toEqual([{ object: 'showcase_task', data: { id: 't1', estimate_hours: 136 } }]);
  });

  it('falls back to 8h when the window is missing', async () => {
    const h = harness();
    await h.boot();
    const res = await h.call({ id: 't2' });
    expect(res.json).toEqual({ success: true, data: { id: 't2', estimate_hours: 8 } });
  });

  it('rejects a request without a record id', async () => {
    const h = harness();
    await h.boot();
    const res = await h.call({});
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });
});
