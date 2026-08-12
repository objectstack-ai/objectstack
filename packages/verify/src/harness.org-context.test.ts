// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7762] `bootStack({ orgContext: true })` — the harness's only way to mint an
// admin whose RESOLVED execution context carries an `organizationId`.
//
// Why it exists: before this option, `bootStack`'s admin resolved org-less, so
// every `organization_id`-filtered read in the platform was structurally
// untestable at the HTTP layer in the open core. A fixture asserting on the
// difference between a filtered and an unfiltered read saw no difference,
// because the filter never engaged — which is how #7676 escaped both the
// plugin-sharing unit suite and the 579-test dogfood suite and needed a manual
// QA run to find.
//
// What this file pins is the RULING behind the option (issue #7762's claim
// comment): stamping an org id on the caller cannot move the deployment's
// tenancy posture, because `TenancyService.probeIsolation` is
// `() => !!ctx.getService('org-scoping')` — service registration only, reading
// nothing about what any context carries. That is asserted here rather than
// inherited: if the posture ever moves, this file goes red and the option's
// whole doc block is wrong.
//
// The HTTP-layer proof that the org id actually reaches an org-scoped read
// lives in the dogfood suite, against a real app:
// `packages/qa/dogfood/test/org-scoped-sharing-rule-listing.dogfood.test.ts`.

import { describe, it, expect, afterEach } from 'vitest';
// `.js` extension deliberately: this package resolves NodeNext, so an
// extensionless relative import is a TS2835 the type-check-debt ratchet counts
// (the sibling test files predate the gate and carry theirs in the ledger — a
// NEW one would raise it, which is not something a test file gets to do).
import { bootStack, type VerifyStack } from './harness.js';

const app = {
  manifest: {
    id: 'com.example.org-context',
    namespace: 'orgcontext',
    version: '0.0.1',
    type: 'app',
    name: 'Org-Context Fixture',
  },
  objects: [],
};

/** The `tenancy` service's answer — the deployment's effective posture. */
interface TenancyShape {
  posture: string;
  requestedPosture: string;
  isolationActive: boolean;
  degraded: boolean;
}

const SYS = { isSystem: true } as const;

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

afterEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
});

/** Read the tenancy posture as every consumer sees it. */
async function posture(stack: VerifyStack): Promise<TenancyShape> {
  const t = await stack.kernel.getServiceAsync<TenancyShape>('tenancy');
  return {
    posture: t.posture,
    requestedPosture: t.requestedPosture,
    isolationActive: t.isolationActive,
    degraded: t.degraded,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(r: any): any[] {
  return Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : [];
}

/** The org id the admin's SESSION carries — the one wire field a real login sets. */
async function sessionOrgId(stack: VerifyStack): Promise<string | null> {
  await stack.signIn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  const users = rowsOf(
    await ql.find('sys_user', { where: { email: 'admin@objectos.ai' }, limit: 1, context: SYS }),
  );
  const userId = users[0]?.id;
  if (!userId) return null;
  const sessions = rowsOf(
    await ql.find('sys_session', { where: { user_id: userId }, limit: 10, context: SYS }),
  );
  for (const s of sessions) {
    const org = s.active_organization_id ?? s.activeOrganizationId;
    if (typeof org === 'string' && org) return org;
  }
  return null;
}

describe('bootStack orgContext (#7762)', () => {
  it(
    'THE RULING: the tenancy posture and `degraded` are IDENTICAL with the flag off vs on',
    async () => {
      // The load-bearing proof of issue #7762's ruling. `probeIsolation` is
      // `() => !!ctx.getService('org-scoping')` — nothing about the effective
      // posture reads whether a resolved context carries an `organizationId`,
      // so binding the admin to an organization must not move it. If this ever
      // fails, `orgContext` is making the open core claim a wall it does not
      // have and the option must not ship in that shape.
      const off = await bootStack(app, {});
      let baseline: TenancyShape;
      try {
        baseline = await posture(off);
      } finally {
        await off.stop();
      }

      const on = await bootStack(app, { orgContext: true });
      let withOrg: TenancyShape;
      try {
        withOrg = await posture(on);
      } finally {
        await on.stop();
      }

      expect(withOrg).toEqual(baseline);
      // Spelled out too, so a future refactor of `posture()` cannot make the
      // equality above pass by comparing two empty objects.
      expect(baseline.posture).toBe('single');
      expect(baseline.degraded).toBe(false);
      expect(withOrg.posture).toBe('single');
      expect(withOrg.isolationActive).toBe(false);
      expect(withOrg.degraded).toBe(false);
    },
    BOOT_TIMEOUT,
  );

  it(
    'binds the admin to a real organization, and their session carries it',
    async () => {
      const stack = await bootStack(app, { orgContext: true });
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ql = await stack.kernel.getServiceAsync<any>('objectql');
        const orgs = rowsOf(await ql.find('sys_organization', { limit: 10, context: SYS }));
        expect(orgs.length, 'the default-org bootstrap minted an organization').toBeGreaterThan(0);

        // `session.activeOrganizationId` is the ONE field `resolveAuthzContext`
        // reads into `tenantId` → `ExecutionContext`. Without it on the session
        // row, every org-scoped read downstream is org-less no matter how many
        // organizations exist in the table.
        const orgId = await sessionOrgId(stack);
        expect(orgId, "the admin's session carries an active organization").toBeTruthy();
        expect(orgs.map((o) => o.id)).toContain(orgId);
      } finally {
        await stack.stop();
      }
    },
    BOOT_TIMEOUT,
  );

  it(
    'the DEFAULT boot is unchanged — no organization, no active org on the session',
    async () => {
      // The other half of the contract, and the reason the existing 579-test
      // dogfood suite is unaffected: `orgContext` is opt-in, and the org-less
      // admin every current fixture asserts against stays org-less.
      const stack = await bootStack(app, {});
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ql = await stack.kernel.getServiceAsync<any>('objectql');
        expect(rowsOf(await ql.find('sys_organization', { limit: 10, context: SYS }))).toHaveLength(0);
        expect(await sessionOrgId(stack)).toBeNull();
      } finally {
        await stack.stop();
      }
    },
    BOOT_TIMEOUT,
  );

  it(
    "REFUSES to compose with multiTenant: 'posture-only' rather than no-op silently",
    async () => {
      // The dangerous half. `'posture-only'` requests the `isolated` posture,
      // and the open default-org bootstrap abstains under every walled posture
      // (ADR-0081 D1), so the combination would hand back an org-LESS admin
      // from a call that reads as org-bound — vacuity wearing the mask of
      // coverage, which is the entire defect class #7762 exists to close.
      await expect(bootStack(app, { orgContext: true, multiTenant: 'posture-only' })).rejects.toThrow(
        /orgContext:true does not compose with multiTenant/,
      );
      // And it says WHY, so the caller does not have to read the harness.
      await expect(bootStack(app, { orgContext: true, multiTenant: 'posture-only' })).rejects.toThrow(
        /walled posture/,
      );
      // Refused BEFORE any env mutation, so a rejected boot cannot leak a
      // posture into the next boot in this worker.
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );

  it(
    'REFUSES to compose with multiTenant: true — the enterprise package owns that bootstrap',
    async () => {
      await expect(bootStack(app, { orgContext: true, multiTenant: true })).rejects.toThrow(
        /does not compose with multiTenant/,
      );
      expect(process.env.OS_TENANCY_POSTURE).toBeUndefined();
    },
    BOOT_TIMEOUT,
  );
});
