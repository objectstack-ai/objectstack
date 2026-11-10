// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A deployment that already has an owner, as `GET /api/v1/auth/bootstrap-status`
 * answers it — for the console's login and register page tests that are not
 * about the first owner.
 *
 * objectstack#32021: those pages ask whether the deployment has an owner on
 * every posture that offers a sign-up form to a visitor not invited (app-shell's
 * `needsOwnerProbe`), so a deployment nobody has an account on leads with
 * creating the owner account. The probe is the global `fetch`
 * (`useBootstrapProbe`), which a test built on a mocked auth client never
 * served; under happy-dom it reached a real socket at localhost:3000 and the
 * network-escape guard turned the file red.
 *
 * Call it once from a test file's top level. The double stays up for the whole
 * file, as the network-escape guard's fix text prescribes for a read that can
 * land after a test body returns (the probe is fire-and-forget), and is handed
 * back in `afterAll` so it never crosses into another file. It answers only the
 * probe; any other global `fetch` throws, so a new escape still names itself.
 */

import { afterAll, vi } from 'vitest';

export function serveDeploymentWithOwner(): void {
  vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/bootstrap-status')) {
      return new Response(JSON.stringify({ hasOwner: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`serveDeploymentWithOwner: no double for ${url}`);
  }) as typeof fetch);
  afterAll(() => {
    vi.unstubAllGlobals();
  });
}
