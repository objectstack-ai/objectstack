// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `waitForServedApp` on an upgrade (objectui#12098).
 *
 * While the runtime rebuilds after an upgrade, the stale kernel still serves the
 * OLD version's app, under the same `_packageId` as the new one. Matching the
 * id alone settles on the first read, and the caller persists the pre-upgrade
 * list. The runtime stamps each app it registers from a package with
 * `_packageVersion` (objectstack#22689), so the wait also matches the version
 * the install answer names. An app that wears no `_packageVersion` (a runtime
 * from before the stamp) still counts on the id alone. A virtual clock: `sleep`
 * advances `now`, so nothing waits in real time.
 */

import { describe, it, expect } from 'vitest';
import { waitForServedApp, SERVED_APP_POLL_INTERVAL_MS, SERVED_APP_WAIT_CAP_MS } from '../waitForServedApp';

const PKG = 'com.acme.crm';
const SETUP = { name: 'setup', _packageId: 'com.objectstack.setup', _packageVersion: '9.0.0' };
const OLD = { name: 'crm_enterprise', _packageId: PKG, _packageVersion: '1.0.0' };
const NEW = { name: 'crm_enterprise', _packageId: PKG, _packageVersion: '1.1.0' };

/** A runtime that serves `before` for `staleReads` reads, then `after`. */
function runtime(staleReads: number, before: unknown[], after: unknown[]) {
  let reads = 0;
  return {
    get reads() { return reads; },
    readApps: async () => (reads++ < staleReads ? before : after),
  };
}

function virtualClock() {
  let t = 0;
  const sleeps: number[] = [];
  return { sleeps, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
}

describe('waitForServedApp names the upgraded version (objectui#12098)', () => {
  it('an upgrade from 1.0.0 to 1.1.0 keeps waiting while 1.0.0 is served, and settles once 1.1.0 is', async () => {
    const rt = runtime(3, [SETUP, OLD], [SETUP, NEW]);
    const clock = virtualClock();
    const wait = await waitForServedApp({ manifestId: PKG, version: '1.1.0', readApps: rt.readApps, ...clock });
    expect(wait).toEqual({ served: true, apps: [NEW] });
    expect(rt.reads).toBe(4);
    expect(clock.sleeps).toEqual([SERVED_APP_POLL_INTERVAL_MS, SERVED_APP_POLL_INTERVAL_MS, SERVED_APP_POLL_INTERVAL_MS]);
  });

  it('an old version served for the whole bound is not the upgrade: served: false', async () => {
    const rt = runtime(Number.POSITIVE_INFINITY, [SETUP, OLD], [SETUP, NEW]);
    const clock = virtualClock();
    const wait = await waitForServedApp({ manifestId: PKG, version: '1.1.0', readApps: rt.readApps, ...clock });
    expect(wait).toEqual({ served: false });
    expect(rt.reads).toBe(Math.floor(SERVED_APP_WAIT_CAP_MS / SERVED_APP_POLL_INTERVAL_MS) + 1);
  });

  it('CONTROL: an app with no `_packageVersion` is accepted on the id, as before, on the first read', async () => {
    const unstamped = { name: 'crm_enterprise', _packageId: PKG };
    const rt = runtime(0, [], [SETUP, unstamped]);
    const clock = virtualClock();
    const wait = await waitForServedApp({ manifestId: PKG, version: '1.1.0', readApps: rt.readApps, ...clock });
    expect(wait).toEqual({ served: true, apps: [unstamped] });
    expect(rt.reads).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });
});
