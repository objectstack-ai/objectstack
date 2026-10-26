// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7762] `bootStack({ orgContext: true })` — the harness's assertion that the
// admin's RESOLVED execution context carries an `organizationId`. Since
// ADR-0131 D3 every `single` boot binds the admin (see the default-boot case
// below); the flag keeps the guard that refuses a boot where it did not.
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

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
// `.js` extension deliberately: this package resolves NodeNext, so an
// extensionless relative import is a TS2835 the type-check-debt ratchet counts
// (the sibling test files predate the gate and carry theirs in the ledger — a
// NEW one would raise it, which is not something a test file gets to do).
import { bootStack, type BootOptions, type VerifyStack } from './harness.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

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

// The boot's first load, paid during collection rather than in the first
// boot's clock (see `boot-warm-up.testkit.ts`). The first boot below uses the
// default options.
await warmUpBoot();

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

function rowsOf(r: any): any[] {
  return Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : [];
}

/** The org id the admin's SESSION carries — the one wire field a real login sets. */
async function sessionOrgId(stack: VerifyStack): Promise<string | null> {
  await stack.signIn();
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

/** What one boot of `app` answered, read while it was live. */
interface BootReading {
  posture: TenancyShape;
  orgs: any[];
  sessionOrgId: string | null;
  /** The roles of the admin's `sys_member` rows in the first organization. */
  adminRoles: unknown[];
}

/**
 * Boot `app` with `opts`, read the posture, the organizations, the org id the
 * admin's session carries and the admin's membership roles, and stop. Each
 * read is one the cases below used to make on a boot of their own with the
 * same options.
 */
async function bootAndRead(opts: BootOptions): Promise<BootReading> {
  const stack = await bootStack(app, opts);
  try {
    const shape = await posture(stack);
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const orgs = rowsOf(await ql.find('sys_organization', { limit: 10, context: SYS }));
    const orgId = await sessionOrgId(stack);
    const users = rowsOf(
      await ql.find('sys_user', { where: { email: 'admin@objectos.ai' }, limit: 1, context: SYS }),
    );
    const memberships = rowsOf(
      await ql.find('sys_member', {
        where: { user_id: users[0]?.id, organization_id: orgs[0]?.id },
        limit: 10,
        context: SYS,
      }),
    );
    return { posture: shape, orgs, sessionOrgId: orgId, adminRoles: memberships.map((m) => m.role) };
  } finally {
    await stack.stop();
  }
}

describe('bootStack orgContext (#7762)', () => {
  // Two boots for the three cases that read one: the flag off (the default
  // boot) and on, in that order, each stopped before the next starts — the
  // order the ruling case always booted them in. Every case only reads what a
  // boot answered, so no case depends on another's run or on their order.
  let off: BootReading;
  let on: BootReading;
  beforeAll(async () => {
    off = await bootAndRead({});
    on = await bootAndRead({ orgContext: true });
  }, BOOT_TIMEOUT * 2);

  it(
    'THE RULING: the tenancy posture and `degraded` are IDENTICAL with the flag off vs on',
    async () => {
      // The load-bearing proof of issue #7762's ruling. `probeIsolation` is
      // `() => !!ctx.getService('org-scoping')` — nothing about the effective
      // posture reads whether a resolved context carries an `organizationId`,
      // so binding the admin to an organization must not move it. If this ever
      // fails, `orgContext` is making the open core claim a wall it does not
      // have and the option must not ship in that shape.
      const baseline = off.posture;
      const withOrg = on.posture;

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
      const { orgs } = on;
      expect(orgs.length, 'the default-org bootstrap minted an organization').toBeGreaterThan(0);

      // `session.activeOrganizationId` is the ONE field `resolveAuthzContext`
      // reads into `tenantId` → `ExecutionContext`. Without it on the session
      // row, every org-scoped read downstream is org-less no matter how many
      // organizations exist in the table.
      const orgId = on.sessionOrgId;
      expect(orgId, "the admin's session carries an active organization").toBeTruthy();
      expect(orgs.map((o) => o.id)).toContain(orgId);
    },
    BOOT_TIMEOUT,
  );

  it(
    '[ADR-0131 D3] the DEFAULT boot is the production `single` shape — the Default Organization, carried by the admin\'s session',
    async () => {
      // The flag is now only the vacuity guard: every `single` boot has the
      // Default Organization (a boot invariant), and the admin is bound to it
      // without asking — the shape `objectstack dev` / `serve` boot. There is
      // no org-less `single` boot left to keep a fixture on (ADR-0131 D11).
      const { orgs } = off;
      expect(orgs.map((o) => o.slug)).toEqual(['default']);
      expect(off.sessionOrgId).toBe(orgs[0].id);
      // The harness line this case pins is the owner bind (ADR-0093 D7), on
      // for every boot: the admin OWNS the Default Organization. The two
      // assertions above hold without it (the boot invariant creates the
      // organization and the membership reconciler binds the admin), but as
      // `member` — which is what an `objectstack dev` admin never is.
      expect(off.adminRoles).toEqual(['owner']);
    },
    BOOT_TIMEOUT,
  );

  it(
    "REFUSES to compose with multiTenant: 'posture-only' rather than no-op silently",
    async () => {
      // The dangerous half. `'posture-only'` requests the `isolated` posture,
      // and the open default-org bootstrap abstains under every walled posture
      // (cloud ADR-0081 D1), so the combination would hand back an org-LESS admin
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
