// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5261] `bootStack({ multiTenant: 'posture-only' })` — the stand-in that
// activates the tenancy POSTURE without the cloud-private enterprise runtime.
//
// Why it exists: since #5261 the `organization/create` gate reads the EFFECTIVE
// tenancy posture (the `tenancy` service's answer), not the operator's env
// request, so a deployment with no organization wall can no longer be talked
// into minting organizations by any env combination. That deliberately closed
// the trick `org-create-default-team.dogfood.test.ts` (#3624's e2e half) used to
// open the route with — flipping `OS_MULTI_ORG_ENABLED` after boot — and the
// enterprise `@objectstack/organizations` package is not installable in this
// workspace, so the fixture needed an honest way to be a walled deployment
// rather than a single-tenant stack lying to one gate.
//
// ⚠️ Deliberately NO `vi.mock('@objectstack/organizations')` here — unlike
// `harness.posture.test.ts`, which fakes the module to exercise the REAL
// `multiTenant: true` path. The whole claim under test is that this option needs
// no enterprise package at all, and a mocked one standing by would make that
// claim untestable: green whether or not the option actually stands alone.

import { describe, it, expect, afterEach } from 'vitest';
import { bootStack } from './harness';

const app = {
  manifest: {
    id: 'com.example.posture-only',
    namespace: 'postureonly',
    version: '0.0.1',
    type: 'app',
    name: 'Posture-Only Fixture',
  },
  objects: [],
};

interface TenancyShape {
  posture: string;
  requestedPosture: string;
  isolationActive: boolean;
  degraded: boolean;
}

afterEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
});

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

describe("bootStack multiTenant: 'posture-only' (#5261)", () => {
  it(
    'resolves a real, NON-DEGRADED isolated posture with no enterprise package installed',
    async () => {
      const stack = await bootStack(app, { multiTenant: 'posture-only' });
      try {
        const tenancy = await stack.kernel.getServiceAsync<TenancyShape>('tenancy');
        expect(tenancy.requestedPosture).toBe('isolated');
        expect(tenancy.posture).toBe('isolated');
        expect(tenancy.isolationActive).toBe(true);
        // The load-bearing assertion. `degraded` is exactly "a wall was asked
        // for and could not be stood up" — the ADR-0093 D5 state #5261 refuses
        // to create organizations in. If the stand-in ever stopped registering
        // `org-scoping`, the posture would fall back to `single` + degraded and
        // every fixture booting this way would 403 with no explanation.
        expect(tenancy.degraded).toBe(false);
      } finally {
        await stack.stop();
      }
    },
    BOOT_TIMEOUT,
  );

  it(
    'registers the `org-scoping` service — the one fact the open core probes',
    async () => {
      const stack = await bootStack(app, { multiTenant: 'posture-only' });
      try {
        // Named explicitly because it is a CONTRACT with the enterprise package,
        // not an implementation detail: `TenancyService.probeIsolation`,
        // SecurityPlugin's RLS-strip decision and `requiresService` nav gating
        // all key on this exact service name. A stand-in registering it under
        // any other name would satisfy none of them.
        const orgScoping = await stack.kernel.getServiceAsync('org-scoping');
        expect(orgScoping).toBeTruthy();
      } finally {
        await stack.stop();
      }
    },
    BOOT_TIMEOUT,
  );

  it(
    'restores OS_TENANCY_POSTURE on stop(), like the real multiTenant path',
    async () => {
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
      const stack = await bootStack(app, { multiTenant: 'posture-only' });
      expect(process.env.OS_TENANCY_POSTURE).toBe('isolated');
      await stack.stop();
      // A leaked posture would silently change the NEXT boot in this worker —
      // the failure mode that makes env-driven fixtures order-dependent.
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );

  it(
    'never overrides an explicit caller-provided OS_TENANCY_POSTURE',
    async () => {
      process.env.OS_TENANCY_POSTURE = 'group';
      const stack = await bootStack(app, { multiTenant: 'posture-only' });
      try {
        const tenancy = await stack.kernel.getServiceAsync<TenancyShape>('tenancy');
        // The stand-in declares `supportedPostures: ['group', 'isolated']`
        // (ADR-0105 D12), so `group` is entitled and stands up as itself.
        expect(tenancy.requestedPosture).toBe('group');
        expect(tenancy.posture).toBe('group');
        expect(tenancy.degraded).toBe(false);
      } finally {
        await stack.stop();
      }
      expect(process.env.OS_TENANCY_POSTURE).toBe('group');
    },
    BOOT_TIMEOUT,
  );

  it(
    'a default boot stays single — the stand-in is opt-in and nothing else changed',
    async () => {
      // The other half of the contract: `multiTenant` unset must not drift into
      // a walled posture just because the option now has a second spelling.
      const stack = await bootStack(app, {});
      try {
        const tenancy = await stack.kernel.getServiceAsync<TenancyShape>('tenancy');
        expect(tenancy.posture).toBe('single');
        expect(tenancy.isolationActive).toBe(false);
        expect(tenancy.degraded).toBe(false);
      } finally {
        await stack.stop();
      }
    },
    BOOT_TIMEOUT,
  );
});
