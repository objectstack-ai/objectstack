// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — install-local `purge-sample-data` removes exactly the
// seed rows an installed package put in the database, THROUGH THE ENGINE, in
// the install's own scope (#21728).
//
// ## What was measured before the fix
//
// The showcase booted with `OS_CLOUD_URL=off`, the CRM example installed from
// its built artifact (`os package install examples/app-crm/dist/objectstack.json`,
// 28 seed rows landed), then, as the admin:
//
//   POST …/install-local/com.example.crm/purge-sample-data {}
//     -> 500 {"code":"DRIVER_UNAVAILABLE","message":"driver service unavailable — cannot purge."}
//   the 28 rows still there
//   POST …/install-local/com.example.crm/reseed-sample-data {}
//     -> 422 RESEED_NO_ROWS (nothing to write: the rows never left)
//
// Three defects stacked: the purge asked for a bare `driver` service no kernel
// registers (drivers register as `driver.<name>`); behind it, it matched seed
// records by `rec.id`, which none of the CRM's 28 records carries (they key by
// `name` / `email` / `subject`), so fixing the lookup alone would have answered
// 28 skipped / 0 deleted; and it deleted through the driver, past every engine
// hook. The unit suites stayed green because they mocked a bare `driver`.
//
// ## What this file pins, on a real boot
//
//   1. the install lands the 28 rows (precondition — measured, not assumed);
//   2. the purge answers `{ deleted: 28, skipped: 0, errors: 0 }`, a
//      user-authored row in a seeded object survives, and every seeded object
//      is otherwise empty;
//   3. every delete passed through the engine: `beforeDelete` and `afterDelete`
//      fired once per seed row, and the audit plugin wrote one `delete` row each;
//   4. the reseed then succeeds (28 inserted);
//   5. under an organization wall, a purge in one organization leaves another
//      organization's 28 seed rows exactly where they were.
//
// Boots fixture stacks of its own (custom plugins, a walled posture), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true } as ExecutionContext;
const CRM = 'com.example.crm';
const BASE = '/marketplace/install-local';
/** The CRM example's seeded objects and their seed-row counts (3 + 3 + 12 + 5 + 5). */
const SEEDED: Record<string, number> = {
  crm_account: 3, crm_contact: 3, crm_opportunity: 12, crm_lead: 5, crm_activity: 5,
};
const SEED_TOTAL = Object.values(SEEDED).reduce((a, b) => a + b, 0);
const OBSERVER = 'dogfood.install-local-purge-observer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

/**
 * The install body `os package install <artifact>.json` sends: the whole
 * artifact, with the manifest's id and version lifted to the top level
 * (`packages/cli/src/commands/package/install.ts`).
 */
function installBody(): { manifest: Record<string, unknown> } {
  const { artifact } = buildShapedArtifact(crmStack as unknown as Record<string, unknown>);
  const manifest = artifact.manifest as { id?: string; version?: string };
  return { manifest: { ...artifact, id: manifest.id, version: manifest.version } };
}

/** Seed-row counts per CRM object, read as the system, optionally in one organization. */
async function countSeeded(ql: IObjectQLEngine, organizationId?: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const object of Object.keys(SEEDED)) {
    const rows = rowsOf(await ql.find(object, {
      ...(organizationId ? { where: { organization_id: organizationId } } : {}),
      context: SYS,
    }));
    out[object] = rows.length;
  }
  return out;
}

/** Records every engine delete on a CRM object, by phase, from the engine's own hook bus. */
function observeDeletes(ql: IObjectQLEngine): { before: string[]; after: string[] } {
  const seen = { before: [] as string[], after: [] as string[] };
  const objects = Object.keys(SEEDED);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idOf = (ctx: any) => String(ctx?.input?.id ?? ctx?.previous?.id ?? '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ql.registerHook('beforeDelete', (ctx: any) => { seen.before.push(`${ctx.object}#${idOf(ctx)}`); }, { object: objects, packageId: OBSERVER });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ql.registerHook('afterDelete', (ctx: any) => { seen.after.push(`${ctx.object}#${idOf(ctx)}`); }, { object: objects, packageId: OBSERVER });
  return seen;
}

/** `object#id` for every current seed-object row matching `where`. */
async function rowKeys(ql: IObjectQLEngine, where?: Record<string, unknown>): Promise<string[]> {
  const keys: string[] = [];
  for (const object of Object.keys(SEEDED)) {
    for (const row of rowsOf(await ql.find(object, { ...(where ? { where } : {}), context: SYS }))) {
      keys.push(`${object}#${row.id}`);
    }
  }
  return keys.sort();
}

async function json(res: Response): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('dogfood: install-local purge on the single-tenant posture — the card\'s own boot', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let ql: IObjectQLEngine;
  let install: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let purge: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let reseed: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let afterInstall: Record<string, number>;
  let afterPurge: Record<string, number>;
  let afterReseed: Record<string, number>;
  let seedRowKeys: string[];
  let survivors: string[];
  let seen: { before: string[]; after: string[] };
  let auditedDeletes: string[];

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-purge-'));
    stack = await bootStack(showcaseStack, {
      extraPlugins: [new AuditPlugin(), new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    const token = await stack.signIn();

    install = await json(await stack.apiAs(token, 'POST', BASE, installBody()));
    afterInstall = await countSeeded(ql);
    seedRowKeys = await rowKeys(ql);

    // A user-authored row in a seeded object, written through the REST door.
    const user = await stack.apiAs(token, 'POST', '/data/crm_account', { name: 'User Authored Co', industry: 'technology' });
    expect(user.status, await user.clone().text()).toBeLessThan(300);

    seen = observeDeletes(ql);
    purge = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    ql.unregisterHooksByPackage(OBSERVER);
    afterPurge = await countSeeded(ql);
    survivors = rowsOf(await ql.find('crm_account', { context: SYS })).map((r) => r.name);
    auditedDeletes = rowsOf(await ql.find('sys_audit_log', { where: { action: 'delete' }, context: SYS }))
      .filter((r) => r.object_name in SEEDED)
      .map((r) => `${r.object_name}#${r.record_id}`)
      .sort();

    reseed = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    afterReseed = await countSeeded(ql);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('PRECONDITION: the install landed all 28 seed rows', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.seeded).toMatchObject({ mode: 'inline', inserted: SEED_TOTAL });
    expect(afterInstall).toEqual(SEEDED);
    expect(seedRowKeys).toHaveLength(SEED_TOTAL);
  });

  it('the purge answers { deleted: 28, skipped: 0, errors: 0 } and keeps the user-authored row', () => {
    expect(purge.status, JSON.stringify(purge.body)).toBe(200);
    expect(purge.body).toEqual({
      success: true,
      data: { manifestId: CRM, deleted: SEED_TOTAL, skipped: 0, errors: 0, withSampleData: false },
    });
    expect(afterPurge).toEqual({ ...Object.fromEntries(Object.keys(SEEDED).map((o) => [o, 0])), crm_account: 1 });
    expect(survivors).toEqual(['User Authored Co']);
  });

  it('every delete passed through the engine: both hook phases and the audit trail saw each seed row once', () => {
    expect([...seen.before].sort()).toEqual(seedRowKeys);
    expect([...seen.after].sort()).toEqual(seedRowKeys);
    expect(auditedDeletes).toEqual(seedRowKeys);
  });

  it('the reseed then succeeds', () => {
    expect(reseed.status, JSON.stringify(reseed.body)).toBe(200);
    expect(reseed.body?.data).toMatchObject({ inserted: SEED_TOTAL, errors: 0, withSampleData: true });
    expect(afterReseed).toEqual({ ...SEEDED, crm_account: SEEDED.crm_account + 1 });
  });
});

describe('dogfood: install-local purge under an organization wall — one organization at a time', () => {
  const ORG_A = 'org_21728_a';
  const ORG_B = 'org_21728_b';
  let stack: VerifyStack;
  let storageDir: string;
  let ql: IObjectQLEngine;
  let token: string;
  let purge: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let reseedA: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let orgARowsBefore: Record<string, number>;
  let orgBKeysBefore: string[];
  let orgBKeysAfter: string[];
  let orgAAfter: Record<string, number>;
  let orgASurvivors: string[];
  let orgAKeys: string[];
  let seen: { before: string[]; after: string[] };

  async function setActive(organizationId: string): Promise<void> {
    const res = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationId });
    expect(res.status, `set-active ${organizationId}: ${await res.clone().text()}`).toBe(200);
  }

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-purge-walled-'));
    // `posture-only` requests the `isolated` posture — the wall is ACTIVE —
    // without the organizations runtime; the memberships are written by hand
    // (the shape `no-active-organization-write-refusal.dogfood.test.ts` uses).
    stack = await bootStack(showcaseStack, {
      multiTenant: 'posture-only',
      extraPlugins: [new AuditPlugin(), new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    await stack.signIn();
    const [admin] = rowsOf(await ql.find('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }));
    for (const org of [ORG_A, ORG_B]) {
      await ql.insert('sys_organization', { id: org, name: org, slug: org }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${org}`, organization_id: org, user_id: admin.id, role: 'owner' }, { context: SYS });
    }
    // A fresh session, so it is minted with the memberships above.
    token = await stack.signIn();

    // Install in A, then the same package's seed in B through the reseed door.
    await setActive(ORG_A);
    const install = await json(await stack.apiAs(token, 'POST', BASE, installBody()));
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.seeded).toMatchObject({ mode: 'inline', inserted: SEED_TOTAL });
    await setActive(ORG_B);
    const reseedB = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    expect(reseedB.status, JSON.stringify(reseedB.body)).toBe(200);
    expect(reseedB.body?.data).toMatchObject({ inserted: SEED_TOTAL });

    await setActive(ORG_A);
    const user = await stack.apiAs(token, 'POST', '/data/crm_account', { name: 'User Authored Co', industry: 'technology' });
    expect(user.status, await user.clone().text()).toBeLessThan(300);

    orgARowsBefore = await countSeeded(ql, ORG_A);
    orgAKeys = await rowKeys(ql, { organization_id: ORG_A });
    orgBKeysBefore = await rowKeys(ql, { organization_id: ORG_B });

    seen = observeDeletes(ql);
    purge = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    ql.unregisterHooksByPackage(OBSERVER);

    orgAAfter = await countSeeded(ql, ORG_A);
    orgASurvivors = rowsOf(await ql.find('crm_account', { where: { organization_id: ORG_A }, context: SYS })).map((r) => r.name);
    orgBKeysAfter = await rowKeys(ql, { organization_id: ORG_B });

    reseedA = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('PRECONDITION: both organizations hold the 28 seed rows, and A also holds a user row', () => {
    expect(orgARowsBefore).toEqual({ ...SEEDED, crm_account: SEEDED.crm_account + 1 });
    expect(orgBKeysBefore).toHaveLength(SEED_TOTAL);
  });

  it('a purge in organization A deletes A\'s 28 seed rows, each through both hook phases, and keeps A\'s user row', () => {
    expect(purge.status, JSON.stringify(purge.body)).toBe(200);
    expect(purge.body?.data).toEqual({ manifestId: CRM, deleted: SEED_TOTAL, skipped: 0, errors: 0, withSampleData: false });
    expect(orgAAfter).toEqual({ ...Object.fromEntries(Object.keys(SEEDED).map((o) => [o, 0])), crm_account: 1 });
    expect(orgASurvivors).toEqual(['User Authored Co']);
    // A's seed rows are A's rows minus the one user row: exactly what the hooks saw.
    const seedKeysA = orgAKeys.filter((k) => seen.after.includes(k));
    expect(seedKeysA).toHaveLength(SEED_TOTAL);
    expect([...seen.after].sort()).toEqual(seedKeysA);
    expect([...seen.before].sort()).toEqual(seedKeysA);
  });

  it('organization B\'s seed rows are untouched — and no hook ever saw one of them', () => {
    expect(orgBKeysAfter).toEqual(orgBKeysBefore);
    expect(orgBKeysAfter).toHaveLength(SEED_TOTAL);
    for (const k of orgBKeysBefore) {
      expect(seen.before).not.toContain(k);
      expect(seen.after).not.toContain(k);
    }
  });

  it('the reseed in A then succeeds', () => {
    expect(reseedA.status, JSON.stringify(reseedA.body)).toBe(200);
    expect(reseedA.body?.data).toMatchObject({ inserted: SEED_TOTAL, errors: 0 });
  });
});
