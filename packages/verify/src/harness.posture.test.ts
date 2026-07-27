// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// bootStack({ multiTenant: true }) must REQUEST the `isolated` tenancy posture
// (ADR-0105 D1). Since #3559, mounting the enterprise organizations plugin only
// ENTITLES a walled posture — activation is an explicit operator request, read
// from env when AuthPlugin registers the `tenancy` service. A harness that
// mounts the plugin without requesting a posture silently boots `single` (no
// wall, default-org write stamping) and every multi-org fixture asserts against
// the wrong posture — the regression this file pins. The enterprise package is
// not installable in this workspace, so a fake stands in for it, registering
// the same `org-scoping` service + entitlement surface; the proof that the REAL
// plugin walls tenants lives in cloud's security-enterprise multi-org
// integration test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { bootStack } from './harness';

class FakeOrganizationsPlugin {
  readonly name = 'fake-organizations';
  readonly version = '0.0.0';
  readonly supportedPostures = ['group', 'isolated'] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async init(ctx: any): Promise<void> {
    ctx.registerService('org-scoping', this);
  }
}

// The factory runs lazily, on the harness's dynamic import — after this module
// body has executed, so referencing the class above is safe.
vi.mock('@objectstack/organizations', () => ({
  OrganizationsPlugin: FakeOrganizationsPlugin,
}));

const app = {
  manifest: {
    id: 'com.example.posture',
    namespace: 'posture',
    version: '0.0.1',
    type: 'app',
    name: 'Posture Fixture',
  },
  objects: [],
};

interface TenancyShape {
  posture: string;
  requestedPosture: string;
  isolationActive: boolean;
}

afterEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
});

// Each case boots the full in-process stack — well beyond the 5s default, and a
// timed-out boot keeps running past its case, so its deferred stop() would race
// the NEXT case's env expectations. Generous per-case timeouts keep the boots
// inside their own cases.
const BOOT_TIMEOUT = 120_000;

describe('bootStack multiTenant — tenancy posture request (ADR-0105 D1)', () => {
  it(
    'requests `isolated` for the boot and restores the env on stop()',
    async () => {
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
      const stack = await bootStack(app, { multiTenant: true });
      try {
        expect(process.env.OS_TENANCY_POSTURE).toBe('isolated');
        const tenancy = await stack.kernel.getServiceAsync<TenancyShape>('tenancy');
        expect(tenancy.requestedPosture).toBe('isolated');
        expect(tenancy.posture).toBe('isolated');
        expect(tenancy.isolationActive).toBe(true);
      } finally {
        await stack.stop();
      }
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );

  it(
    'never overrides an explicit caller-provided OS_TENANCY_POSTURE',
    async () => {
      process.env.OS_TENANCY_POSTURE = 'group';
      const stack = await bootStack(app, { multiTenant: true });
      try {
        const tenancy = await stack.kernel.getServiceAsync<TenancyShape>('tenancy');
        expect(tenancy.requestedPosture).toBe('group');
      } finally {
        await stack.stop();
      }
      // stop() must not clear a posture the harness did not set.
      expect(process.env.OS_TENANCY_POSTURE).toBe('group');
    },
    BOOT_TIMEOUT,
  );

  it(
    'restores the env when the enterprise package is missing and the boot throws',
    async () => {
      // `vi.resetModules()` alone cannot evict a `vi.mock` factory result, so
      // re-mock with `vi.doMock` (re-evaluated on the next import) and clear the
      // module cache: the harness's dynamic import now rejects like a genuinely
      // missing package.
      vi.resetModules();
      vi.doMock('@objectstack/organizations', () => {
        throw new Error("Cannot find module '@objectstack/organizations'");
      });
      await expect(bootStack(app, { multiTenant: true })).rejects.toThrow(
        /requires the enterprise @objectstack\/organizations/,
      );
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );
});
