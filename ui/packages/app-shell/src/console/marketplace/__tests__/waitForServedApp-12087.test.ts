// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `waitForServedApp` — the bounded wait behind objectui#12087.
 *
 * After a cloud install the runtime keeps serving the pre-install kernel while
 * it rebuilds. The wait reads `GET /meta/app` until an item wears the
 * installed package's manifest id as `_packageId`, and reports `served: false`
 * once its bound expires. These cases drive it with a virtual clock: `sleep`
 * advances `now`, so the bound is measured exactly and nothing waits in real
 * time.
 */

import { describe, it, expect } from 'vitest';
import {
  waitForServedApp,
  SERVED_APP_POLL_INTERVAL_MS,
  SERVED_APP_WAIT_CAP_MS,
} from '../waitForServedApp';

const PKG = 'com.acme.crm';
const PRE = [{ name: 'setup', _packageId: 'com.objectstack.setup' }];
const CRM = { name: 'crm_enterprise', _packageId: PKG };
const POST = [...PRE, CRM];

/** A runtime that answers the pre-install list for `staleReads` reads, then the post-install one. */
function runtime(staleReads: number) {
  let reads = 0;
  return {
    get reads() { return reads; },
    readApps: async () => (reads++ < staleReads ? PRE : POST),
  };
}

function virtualClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
  };
}

describe('waitForServedApp (objectui#12087)', () => {
  it('CONTROL: an app served on the first read settles at once, with no sleep before it', async () => {
    const rt = runtime(0);
    const clock = virtualClock();
    const wait = await waitForServedApp({ manifestId: PKG, version: undefined, readApps: rt.readApps, ...clock });
    expect(wait).toEqual({ served: true, apps: [CRM] });
    expect(rt.reads).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('keeps reading through the stale window and settles on the first read that serves the app', async () => {
    const rt = runtime(3);
    const clock = virtualClock();
    const wait = await waitForServedApp({ manifestId: PKG, version: undefined, readApps: rt.readApps, ...clock });
    expect(wait).toEqual({ served: true, apps: [CRM] });
    expect(rt.reads).toBe(4);
    expect(clock.sleeps).toEqual([
      SERVED_APP_POLL_INTERVAL_MS,
      SERVED_APP_POLL_INTERVAL_MS,
      SERVED_APP_POLL_INTERVAL_MS,
    ]);
  });

  it('reports served: false once the bound expires, after a bounded number of reads', async () => {
    const rt = runtime(Number.POSITIVE_INFINITY);
    const clock = virtualClock();
    const wait = await waitForServedApp({ manifestId: PKG, version: undefined, readApps: rt.readApps, ...clock });
    expect(wait).toEqual({ served: false });
    // One read at t=0, then one per interval while the next one still fits the bound.
    expect(rt.reads).toBe(Math.floor(SERVED_APP_WAIT_CAP_MS / SERVED_APP_POLL_INTERVAL_MS) + 1);
    expect(clock.now()).toBeLessThanOrEqual(SERVED_APP_WAIT_CAP_MS);
  });

  it('honours an explicit interval and cap', async () => {
    const rt = runtime(Number.POSITIVE_INFINITY);
    const clock = virtualClock();
    const wait = await waitForServedApp({
      manifestId: PKG, version: undefined, readApps: rt.readApps, intervalMs: 10, capMs: 35, ...clock,
    });
    expect(wait).toEqual({ served: false });
    expect(rt.reads).toBe(4);
    expect(clock.sleeps).toEqual([10, 10, 10]);
  });

  it('a failed read is not an answer: the wait keeps going to the next read', async () => {
    let reads = 0;
    const clock = virtualClock();
    const wait = await waitForServedApp({
      manifestId: PKG,
      version: undefined,
      readApps: async () => {
        reads++;
        if (reads === 1) throw new Error('503 while the kernel swaps');
        return POST;
      },
      ...clock,
    });
    expect(wait).toEqual({ served: true, apps: [CRM] });
    expect(reads).toBe(2);
  });

  it('only an item wearing THIS package id counts: another package, or none, does not', async () => {
    const clock = virtualClock();
    const wait = await waitForServedApp({
      manifestId: PKG,
      version: undefined,
      readApps: async () => [
        { name: 'crm_enterprise' },
        { name: 'crm_enterprise', _packageId: 'com.other.crm' },
        null,
        'crm_enterprise',
      ],
      intervalMs: 10,
      capMs: 20,
      ...clock,
    });
    expect(wait).toEqual({ served: false });
  });
});
