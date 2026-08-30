// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13491 — the `[tenant-audit]` control's SCOPE is declared, and the position
// of the scope gate ahead of the posture read is load-bearing.
//
// ## What was ruled, and what this file holds it to
//
// `auditMissingTenant` reads `options.bypassTenantAudit` as its second guard,
// and the ObjectQL engine sets that flag for every `ExecutionContext.isSystem`
// write. For its whole life that exclusion existed as one code comment —
// "unscoped by design" — which was a declaration, never an adjudicated
// decision, and nothing anywhere held the code to it.
//
// It is adjudicated now: maintainer ruling 2026-08-30 (第 5 场总监席决裁批 #9,
// verbatim「同意」), option A —
//
//   > 追认「`isSystem` 写入不在本控制范围内」为正式裁定(系统写入系平台自写、
//   > 合法跨租户;控制目标是应用面调用点)。
//
// ⚠️ The ruling carries its own condition for return (回头条款): if a system
// write is ever measured landing a NULL-tenant row on a walled deployment
// (#13497), the scoping goes back to the maintainer. These pins describe the
// scope as it is ruled TODAY; they are not a claim that it is permanent.
//
// ## Why the ORDER needs a pin of its own, and what it is
//
// The census that produced the ruling called the control self-inconsistent
// because its largest silencing gate sits ahead of its applicability
// condition. Under the ruling that ordering is correct — a scope exclusion is
// not a posture question and does not wait on one — so the pressure to "repair"
// it by moving the scope gate below `isMultiTenantMode()` is real and needs
// something in the way of it.
//
// Order among the guards cannot change WHICH writes are audited: every step
// before the throttle is a pure predicate, so the set that reaches the warning
// is their conjunction. But it does change something, and the second describe()
// measures it: `isMultiTenantMode()` calls `resolveTenancyPosture()`, which
// THROWS on a malformed `OS_TENANCY_POSTURE` rather than guessing a posture. A
// write the control does not cover therefore completes today and would start
// throwing if the scope gate moved below the posture read — a diagnostics
// helper turned into a failing write, on the platform's own paths.
//
// Real `SqlDriver` over real in-memory SQLite throughout, exactly as
// `sql-driver-tenant-audit-posture.test.ts` (#5262) drives the same guard
// chain. The only substitution is the logger, which is the assertion surface.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;

const objects = [
  {
    name: 'account',
    fields: {
      organization_id: { type: 'string' },
      name: { type: 'string' },
    },
  },
];

let driver: SqlDriver;
let warns: Array<{ msg: string; meta: any }>;

const bootDriver = async () => {
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  warns = [];
  (driver as any).logger = { warn: (msg: string, meta: any) => warns.push({ msg, meta }) };
  await driver.initObjects(objects);
};

const tenantAuditWarned = () => warns.some((w) => w.msg.includes('[tenant-audit]'));

/**
 * An APPLICATION-SURFACE write: no tenant threaded, no elevation declared.
 * This is the population the control speaks about — roughly 40 of the 175
 * service write call sites the tenant-audit census counted against a
 * tenancy-enabled object.
 */
const applicationSurfaceWrite = (id: string) =>
  driver.create('account', { id, organization_id: 'org_a', name: id });

/**
 * What the engine emits for `ExecutionContext.isSystem` — see the `isSystem`
 * branch of `buildDriverOptions` in `objectql/src/engine.ts`, which carries the
 * ruling. Spelled as the driver sees it, because the driver is what is under
 * test here; the engine end is pinned in
 * `objectql/src/engine-issystem-tenant-audit-scope.test.ts`.
 */
const outOfScopeWrite = (id: string) =>
  driver.create('account', { id, organization_id: 'org_a', name: id }, { bypassTenantAudit: true });

beforeEach(async () => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
  await bootDriver();
});
afterEach(async () => {
  await driver.disconnect();
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
});

// ───────────────────────────────────────────────────────────────────────────
describe('#13491 — the control covers the application surface, and says so', () => {
  it('an application-surface write on a walled deployment IS the control’s subject', async () => {
    // The other half of every assertion below: without it, "the elevated write
    // stayed quiet" would also pass against a control that says nothing to
    // anyone.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    await applicationSurfaceWrite('a1');
    expect(tenantAuditWarned()).toBe(true);
  });

  it('the same write declared OUT OF SCOPE is silent — `isolated`', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    await outOfScopeWrite('a1');
    expect(tenantAuditWarned()).toBe(false);
  });

  it('and on `group`, the other walled posture', async () => {
    process.env.OS_TENANCY_POSTURE = 'group';
    await outOfScopeWrite('a1');
    expect(tenantAuditWarned()).toBe(false);
  });

  it('the exclusion is a SCOPE verdict, not a posture verdict — it holds on every posture', async () => {
    // Scope does not depend on how the deployment is configured. Pinned because
    // the two facts are adjacent in the guard chain and easy to conflate.
    for (const posture of ['isolated', 'group', 'single']) {
      await driver.disconnect();
      await bootDriver();
      process.env.OS_TENANCY_POSTURE = posture;
      await outOfScopeWrite('a1');
      expect(tenantAuditWarned()).toBe(false);
    }
  });

  it('the write itself is unchanged by being out of scope — diagnostics only', async () => {
    // `DriverOptionsSchema.bypassTenantAudit`: it "never changes what the write
    // touches". A scope exclusion that quietly moved rows would be a different
    // and much larger thing than the one that was ruled on.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    await outOfScopeWrite('a1');
    const rows = await driver.find('account', { where: { id: 'a1' } } as any);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'a1', organization_id: 'org_a' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#13491 — the scope gate is consulted BEFORE the posture read', () => {
  // `resolveTenancyPosture()` refuses a malformed posture rather than guessing
  // one, so "did this write reach the posture read?" is directly observable.
  const MALFORMED = 'isolated-ish';

  it('the instrument works: an in-scope write DOES reach the posture read', async () => {
    process.env.OS_TENANCY_POSTURE = MALFORMED;
    await expect(applicationSurfaceWrite('a1')).rejects.toThrow(/OS_TENANCY_POSTURE/);
  });

  it('an out-of-scope write never reaches it, so a malformed posture cannot fail it', async () => {
    // ⛔ This is what breaks if the scope gate is moved below
    // `isMultiTenantMode()`. Reordering pure predicates cannot change which
    // writes are audited — but it can turn this platform write into a throw.
    process.env.OS_TENANCY_POSTURE = MALFORMED;
    await expect(outOfScopeWrite('a1')).resolves.toBeDefined();
    expect(tenantAuditWarned()).toBe(false);
  });

  it('and neither can a write that already carried its tenant', async () => {
    // The #5262 early-out, same shape: the third guard also short-circuits
    // ahead of the posture read, and that is what makes the live read
    // affordable.
    process.env.OS_TENANCY_POSTURE = MALFORMED;
    await expect(
      driver.create('account', { id: 'a1', name: 'A1' }, { tenantId: 'org_a' } as any),
    ).resolves.toBeDefined();
    expect(tenantAuditWarned()).toBe(false);
  });
});
