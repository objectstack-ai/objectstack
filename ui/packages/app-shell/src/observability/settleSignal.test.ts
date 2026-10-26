/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginRequest,
  endRequest,
  getPendingRequests,
  isIdle,
  subscribeSettle,
  whenIdle,
  withSettleSignal,
  installSettleSignalGlobal,
  __resetSettleSignal,
} from './settleSignal';

beforeEach(() => {
  __resetSettleSignal();
});

describe('settleSignal', () => {
  it('counts begin/end and reports idle', () => {
    expect(isIdle()).toBe(true);
    expect(getPendingRequests()).toBe(0);

    beginRequest();
    beginRequest();
    expect(getPendingRequests()).toBe(2);
    expect(isIdle()).toBe(false);

    endRequest();
    expect(getPendingRequests()).toBe(1);
    endRequest();
    expect(getPendingRequests()).toBe(0);
    expect(isIdle()).toBe(true);
  });

  it('clamps the counter at zero on extra end()', () => {
    endRequest();
    expect(getPendingRequests()).toBe(0);
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const seen: number[] = [];
    const off = subscribeSettle((p) => seen.push(p));
    beginRequest();
    endRequest();
    off();
    beginRequest();
    expect(seen).toEqual([1, 0]);
  });

  it('withSettleSignal increments during the request and decrements after success', async () => {
    let pendingDuring = -1;
    const fakeFetch = (async () => {
      pendingDuring = getPendingRequests();
      return new Response('ok');
    }) as unknown as typeof fetch;

    const counted = withSettleSignal(fakeFetch);
    expect(getPendingRequests()).toBe(0);
    await counted('https://example.test');
    expect(pendingDuring).toBe(1);
    expect(getPendingRequests()).toBe(0);
  });

  it('withSettleSignal decrements even when the request rejects', async () => {
    const failing = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const counted = withSettleSignal(failing);
    await expect(counted('https://example.test')).rejects.toThrow('boom');
    expect(getPendingRequests()).toBe(0);
  });

  it('whenIdle resolves immediately when already idle', async () => {
    await expect(whenIdle()).resolves.toBeUndefined();
  });

  it('whenIdle resolves once the last request settles', async () => {
    beginRequest();
    let resolved = false;
    const p = whenIdle().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    endRequest();
    await p;
    expect(resolved).toBe(true);
  });

  it('installSettleSignalGlobal exposes live window.__objectui accessors', () => {
    installSettleSignalGlobal();
    const ns = (window as any).__objectui;
    expect(ns).toBeTruthy();
    expect(ns.idle).toBe(true);
    expect(ns.pendingRequests).toBe(0);
    beginRequest();
    // live getters reflect the current count without re-installing
    expect(ns.pendingRequests).toBe(1);
    expect(ns.idle).toBe(false);
    expect(typeof ns.whenIdle).toBe('function');
    expect(typeof ns.subscribe).toBe('function');
    endRequest();
  });
});
