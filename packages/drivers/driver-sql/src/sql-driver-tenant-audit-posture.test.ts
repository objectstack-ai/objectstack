// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5262 — the SQL driver's tenant-audit gate reads the AUTHORITATIVE tenancy
// posture, never the demoted `OS_MULTI_ORG_ENABLED` boolean, and reads it LIVE.
//
// ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
// `OS_MULTI_ORG_ENABLED` to a back-compat INPUT of `resolveTenancyPosture()`.
// `isMultiTenantMode()` kept calling `resolveMultiOrgEnabled()`, so on a
// deployment configured the documented way (posture knob only) the tenant-audit
// warning was silently off — on exactly the walled deployments it exists for.
// That warning is the one signal that catches a system/seed/sudo write landing
// outside its tenant, which is "easy to miss in code review and impossible to
// find after a breach", in the words of the function it gates.
//
// The judge is the REQUESTED posture. The driver is constructed from connection
// config with no kernel or service registry, so the `tenancy` service's
// effective answer is not reachable here at all — and the asymmetry runs the
// right way for a WARNING anyway: a spurious line on a degraded stack costs a
// log entry, a suppressed one on a walled stack is this defect.
//
// The second half of the file pins the LIVENESS of that read. The gate used to
// memoise into `_multiTenantMode` on whichever write happened to land first —
// a startup reading recorded as a permanent judgment — which made it unable to
// see anything a later boot phase established.
//
// Real `SqlDriver` against a real in-memory SQLite throughout: real
// `initObjects`, real `create`/`update`, real env resolution. The only
// substitution is the driver's logger, which is the assertion surface.

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

/**
 * Writes WITHOUT a tenantId — the case the audit exists to catch. A delete:
 * an insert whose row carries its organization is not audited (ADR-0131 8c-1,
 * pinned in `sql-driver-tenant-audit-insert-carries-tenant.test.ts`), and one
 * whose row does not is refused by the NOT NULL organization column after the
 * audit has run. The row need not exist: the audit precedes the statement.
 */
const writeWithoutTenant = async (id: string) => {
  await driver.delete('account', id);
};

const tenantAuditWarned = () => warns.some((w) => w.msg.includes('[tenant-audit]'));

const setEnv = (env: { posture?: string; legacy?: string }) => {
  if (env.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = env.posture;
  if (env.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = env.legacy;
};

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
describe('#5262 — tenant-audit fires on a posture-only walled deployment', () => {
  it('OS_TENANCY_POSTURE=isolated with the legacy boolean UNSET warns', async () => {
    // THE regression: before the fix this deployment got NO tenant-audit
    // warning at all, because the demoted boolean read false.
    setEnv({ posture: 'isolated' });
    await writeWithoutTenant('x1');

    expect(tenantAuditWarned()).toBe(true);
    expect(warns[0].meta).toMatchObject({ object: 'account', op: 'delete', tenantField: 'organization_id' });
  });

  it('`group` is a walled posture too', async () => {
    setEnv({ posture: 'group' });
    await writeWithoutTenant('x1');
    expect(tenantAuditWarned()).toBe(true);
  });

  it('legacy-boolean-only deployment keeps working — back-compat', async () => {
    setEnv({ legacy: 'true' });
    await writeWithoutTenant('x1');
    expect(tenantAuditWarned()).toBe(true);
  });

  it('an explicit legacy `false` does not veto the authoritative posture', async () => {
    setEnv({ posture: 'isolated', legacy: 'false' });
    await writeWithoutTenant('x1');
    expect(tenantAuditWarned()).toBe(true);
  });

  it('single-org deployments stay quiet — intent unchanged', async () => {
    // Single-tenant stacks still get an `organization_id` column but no
    // isolation, so every sudo write would otherwise spam a meaningless warning.
    setEnv({ posture: 'single' });
    await writeWithoutTenant('x1');
    expect(tenantAuditWarned()).toBe(false);

    setEnv({});
    await writeWithoutTenant('x2');
    expect(tenantAuditWarned()).toBe(false);
  });

  it('a write that DOES carry its tenant is never audited, on any posture', async () => {
    // The early-out this fix moved ahead of the posture read. Reordering two
    // pure guards must not change the answer for anyone.
    setEnv({ posture: 'isolated' });
    await driver.create(
      'account',
      { id: 'x1', name: 'X1' },
      { tenantId: 'org_a' } as any,
    );
    expect(tenantAuditWarned()).toBe(false);
  });

  it('bypassTenantAudit still silences a walled deployment', async () => {
    setEnv({ posture: 'isolated' });
    await driver.delete('account', 'x1', { bypassTenantAudit: true });
    expect(tenantAuditWarned()).toBe(false);
  });

  it('OS_TENANT_AUDIT=0 still silences a walled deployment', async () => {
    setEnv({ posture: 'isolated' });
    process.env.OS_TENANT_AUDIT = '0';
    try {
      await writeWithoutTenant('x1');
      expect(tenantAuditWarned()).toBe(false);
    } finally {
      delete process.env.OS_TENANT_AUDIT;
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5262 — the verdict is taken LIVE, never frozen at first write', () => {
  it('a posture established AFTER the first write is still seen', async () => {
    // The `_multiTenantMode` memo this replaced was filled by whichever write
    // landed first and never re-read. A driver constructed during boot could
    // therefore record "single-org" from a pre-boot environment and keep
    // answering that for the life of the process — the recorded-verdict shape
    // AGENTS.md's startup-registry rule names.
    setEnv({ posture: 'single' });
    await writeWithoutTenant('before');
    expect(tenantAuditWarned()).toBe(false);

    // Same driver instance, same connection.
    setEnv({ posture: 'isolated' });
    await writeWithoutTenant('after');
    expect(tenantAuditWarned()).toBe(true);
  });

  it('and the reverse — a posture relaxed after a warning stops warning', async () => {
    setEnv({ posture: 'isolated' });
    await writeWithoutTenant('first');
    expect(tenantAuditWarned()).toBe(true);

    warns = [];
    setEnv({ posture: 'single' });
    // A DIFFERENT object:op, so the per-key throttle cannot be what quiets it.
    await driver.update('account', 'first', { name: 'renamed' });
    expect(tenantAuditWarned()).toBe(false);
  });

  it('no cached field survives on the instance', async () => {
    // Direct tombstone for the memo: if someone reintroduces `_multiTenantMode`
    // (or any sibling cache) the liveness assertions above would keep passing
    // only by luck of ordering, so pin its absence explicitly.
    setEnv({ posture: 'isolated' });
    await writeWithoutTenant('x1');
    expect((driver as any)._multiTenantMode).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [ADR-0131 D8 / D13] What the line PRESCRIBES. Under a wall, an exempt
// platform admin's cross-organization predicate update or delete reaches this
// driver with no `tenantId` on purpose — the wall lifted the scope — and so
// does a write that simply lost its organization. The driver cannot tell the
// two apart, so the line must name the remedy for each and must not tell the
// first to "pass tenantId", the one change that would break it.
describe('the [tenant-audit] line names both readings and the remedy for each', () => {
  it('a wall-exempt cross-organization updateMany is not told to pass tenantId', async () => {
    setEnv({ posture: 'isolated' });
    await driver.create('account', { id: 'x1', organization_id: 'org_a', name: 'x1' });
    warns = [];
    // The exempt admin's shape: a predicate update with no tenantId.
    await driver.updateMany('account', { where: { name: 'x1' } } as any, { name: 'renamed' });

    const line = warns.find((w) => w.msg.includes('[tenant-audit] updateMany'));
    expect(line, 'positive control: the unscoped updateMany must warn').toBeDefined();
    expect(line!.msg).not.toMatch(/pass tenantId/i);
    // The deliberate reading and its declaration.
    expect(line!.msg).toContain('crosses organizations on purpose');
    expect(line!.msg).toContain('a platform admin the organization wall exempts');
    expect(line!.msg).toContain('bypassTenantAudit:true');
    // The lost-organization reading and its remedy.
    expect(line!.msg).toContain("run it in that organization's context");
    expect(line!.meta).toMatchObject({ object: 'account', op: 'updateMany', tenantField: 'organization_id' });
  });
});
