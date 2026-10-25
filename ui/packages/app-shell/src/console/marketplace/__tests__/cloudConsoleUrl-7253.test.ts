// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7253 — the paywall exit's destination.
 *
 * The AI quota refusal's "Upgrade plan" CTA used to open
 * `${cloudBase}/apps/cloud-control/sys_environment`, a path this repo composed
 * from three guesses about the CONTROL PLANE's console — its mount (`/_console`,
 * injected by that host), its app slug (`cloud_control`, not `cloud-control`)
 * and its route. All three were wrong, so the button landed on the control
 * plane's API 404 — `{"success":false,"error":{"code":"ENDPOINT_NOT_FOUND"}}` —
 * measured on the local rig.
 *
 * The fix is negative and that is the point: the only thing the runtime tells a
 * tenant SPA about the control plane is its ORIGIN, so the origin is all we may
 * name. These assertions pin the absence of a composed path, not a particular
 * page — a future "improvement" that appends one is the bug coming back.
 */

import { describe, it, expect, vi } from 'vitest';

// `vi.hoisted`, not a plain const: `vi.mock` is hoisted above module-body
// statements, so a bare const is still in TDZ when the factory runs. The
// default is a CANARY, not '': a case that forgets to set a base then fails
// loudly instead of agreeing with the "no cloud configured" assertion.
const { cloudBase } = vi.hoisted(() => ({ cloudBase: vi.fn(() => 'MOCK_UNSET') }));
vi.mock('../../../runtime-config', () => ({
  getCloudBase: () => cloudBase(),
}));

/**
 * Import the helper FRESH under the mock.
 *
 * The `unit` project runs with `isolate: false` (one module graph per worker),
 * so a sibling file that imported `marketplaceApi` unmocked — `readApiError`
 * does — leaves a cached copy bound to the REAL `getCloudBase`, and a
 * top-of-file import here silently reads through to it. Measured: the same
 * assertions passed alone and returned `''` in a multi-file run. `resetModules`
 * + a dynamic import inside the test is the supported way to re-evaluate under
 * this file's own mock.
 */
async function urlFor(base: string): Promise<string> {
  cloudBase.mockReturnValue(base);
  vi.resetModules();
  const { cloudConsoleUrl } = await import('../marketplaceApi');
  return cloudConsoleUrl();
}

describe('cloudConsoleUrl (objectui#7253)', () => {
  it('is the runtime-supplied cloud origin, verbatim', async () => {
    expect(await urlFor('https://cloud.objectos.app')).toBe('https://cloud.objectos.app');
  });

  it('appends no control-plane path — not the app slug, not an object route', async () => {
    const url = await urlFor('https://cloud.objectos.app');
    // The exact shape that produced the dead link.
    expect(url).not.toContain('/apps/');
    expect(url).not.toContain('cloud-control');
    expect(url).not.toContain('sys_environment');
    expect(url).not.toContain('sys_package');
    // …and nothing else either: path-free, so the console mount's own root
    // redirect (`/` → `/_console/`) decides where the user lands.
    expect(new URL(url).pathname).toBe('/');
  });

  it('honours a base that already carries a prefix (reverse-proxied control plane)', async () => {
    expect(await urlFor('https://acme.example/cloud')).toBe('https://acme.example/cloud');
  });

  it('is empty when the runtime named no upstream cloud — callers render no link', async () => {
    // NOT the former `|| 'https://cloud.objectos.app'` fallback: a self-hosted
    // or air-gapped runtime has no control plane, and sending its users to the
    // vendor's SaaS is worse than showing nothing.
    expect(await urlFor('')).toBe('');
  });
});
