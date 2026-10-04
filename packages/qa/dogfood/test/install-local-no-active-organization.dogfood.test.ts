// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — under an organization wall, a session with NO active
// organization is refused at the three install-local doors that seed or purge
// sample data, and the refusal names what is missing (ADR-0123 D1 / D2 / D4).
//
// ## What was measured before the fix
//
// The showcase booted walled (`multiTenant: 'posture-only'`, posture
// `isolated`, the wall enforced), the admin signed in BEFORE holding any
// membership, then given a `sys_member` row. Their session's
// `activeOrganizationId` stayed null. With that session:
//
//   POST …/install-local                                     -> 200, seeded {mode: "skipped", reason: "multi-tenant-no-active-org"}
//   POST …/install-local/com.example.crm/reseed-sample-data  -> 400 RESEED_SKIPPED "Reseed did not run: multi-tenant-no-active-org"
//   POST …/install-local/com.example.crm/purge-sample-data   -> 400 RESEED_SKIPPED
//
// and the resolver's "first membership" fallback read `sys_organization_member`,
// an object no package defines: the engine answered "Object
// 'sys_organization_member' not found", the `try` swallowed it, and the fallback
// never once fired.
//
// ## What this file pins, on one real boot
//
//   1. PRECONDITIONS: the wall is in force; the session carries no active
//      organization; its user is a member of two organizations.
//   2. With that session: the install registers the package and its `seeded`
//      block is `{mode: "refused"}` with a `reason` naming the missing active
//      organization; the reseed and the purge answer `403 PERMISSION_DENIED`
//      naming it; no seed row lands in either organization (nothing guessed).
//   3. The SAME session once it selects organization B: reseed, purge and a
//      reinstall all act in B, as they always have. One fact differs between
//      2 and 3: the active organization.
//
// Boots a walled fixture stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true } as ExecutionContext;
const CRM = 'com.example.crm';
const BASE = '/marketplace/install-local';
const ORG_A = 'org_21774_a';
const ORG_B = 'org_21774_b';
/** The CRM example's seeded objects and their seed-row counts (3 + 3 + 12 + 5 + 5). */
const SEEDED: Record<string, number> = {
  crm_account: 3, crm_contact: 3, crm_opportunity: 12, crm_lead: 5, crm_activity: 5,
};
const SEED_TOTAL = Object.values(SEEDED).reduce((a, b) => a + b, 0);
/** The words ADR-0123 D4 requires the refusal to carry. */
const NAMES_THE_MISSING_ORGANIZATION = 'this session has no active organization';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

/** The install body `os package install <artifact>.json` sends. */
function installBody(): { manifest: Record<string, unknown> } {
  const { artifact } = buildShapedArtifact(crmStack as unknown as Record<string, unknown>);
  const manifest = artifact.manifest as { id?: string; version?: string };
  return { manifest: { ...artifact, id: manifest.id, version: manifest.version } };
}

/** Seed-object rows, read as the system, in one organization or (none given) across all of them. */
async function countRows(ql: IObjectQLEngine, organizationId?: string): Promise<number> {
  let total = 0;
  for (const object of Object.keys(SEEDED)) {
    total += rowsOf(await ql.find(object, {
      ...(organizationId ? { where: { organization_id: organizationId } } : {}),
      context: SYS,
    })).length;
  }
  return total;
}

async function json(res: Response): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('dogfood: install-local under an organization wall, with a session that has no active organization', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let ql: IObjectQLEngine;
  let token: string;
  let tenancy: { posture?: string; isolationActive?: boolean } | undefined;
  let sessionOrgBefore: unknown;
  let sessionOrgAfter: unknown;
  let memberships: number;
  type Answer = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const orgless: Record<'install' | 'reseed' | 'purge', Answer> = {} as never;
  const inOrgB: Record<'reseed' | 'purge' | 'reinstall', Answer> = {} as never;
  let rowsAfterOrgless: number;
  let orgBAfterReseed: number;
  let orgBAfterPurge: number;
  let orgBAfterReinstall: number;
  let orgAAtEnd: number;

  async function activeOrganization(): Promise<unknown> {
    const res = await stack.apiAs(token, 'GET', '/auth/get-session');
    const body = await res.json().catch(() => null);
    expect(body?.session, `get-session: ${JSON.stringify(body)}`).toBeTruthy();
    return body.session.activeOrganizationId ?? null;
  }

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-no-active-org-'));
    // `posture-only` requests the `isolated` posture — the wall is ACTIVE —
    // without the organizations runtime; the memberships are written by hand.
    stack = await bootStack(showcaseStack, {
      multiTenant: 'posture-only',
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean }>('tenancy');

    // The session is minted BEFORE any membership exists, so it carries no
    // active organization; the memberships land after it.
    token = await stack.signIn();
    const [admin] = rowsOf(await ql.find('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }));
    for (const org of [ORG_A, ORG_B]) {
      await ql.insert('sys_organization', { id: org, name: org, slug: org }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${org}`, organization_id: org, user_id: admin.id, role: 'owner' }, { context: SYS });
    }
    memberships = rowsOf(await ql.find('sys_member', { where: { user_id: admin.id }, context: SYS })).length;
    sessionOrgBefore = await activeOrganization();

    orgless.install = await json(await stack.apiAs(token, 'POST', BASE, installBody()));
    orgless.reseed = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    orgless.purge = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    rowsAfterOrgless = await countRows(ql);

    // The same session, once it selects organization B.
    const set = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationId: ORG_B });
    expect(set.status, `set-active: ${await set.clone().text()}`).toBe(200);
    sessionOrgAfter = await activeOrganization();
    inOrgB.reseed = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    orgBAfterReseed = await countRows(ql, ORG_B);
    inOrgB.purge = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    orgBAfterPurge = await countRows(ql, ORG_B);
    inOrgB.reinstall = await json(await stack.apiAs(token, 'POST', BASE, installBody()));
    orgBAfterReinstall = await countRows(ql, ORG_B);
    orgAAtEnd = await countRows(ql, ORG_A);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('PRECONDITION: the organization wall is in force on this boot', () => {
    expect(tenancy?.posture, 'tenancy posture in force').toBe('isolated');
    expect(tenancy?.isolationActive, 'the wall is enforced').toBe(true);
  });

  it('PRECONDITION: the session has no active organization, and its user is a member of two', () => {
    expect(sessionOrgBefore).toBeNull();
    expect(memberships).toBe(2);
  });

  it('install: the package is installed, and `seeded` reports the refusal naming the missing active organization', () => {
    expect(orgless.install.status, JSON.stringify(orgless.install.body)).toBe(200);
    expect(orgless.install.body?.success).toBe(true);
    expect(orgless.install.body?.data?.manifestId).toBe(CRM);
    expect(orgless.install.body?.data?.seeded?.mode).toBe('refused');
    expect(orgless.install.body?.data?.seeded?.reason).toContain(NAMES_THE_MISSING_ORGANIZATION);
  });

  it('reseed: 403 PERMISSION_DENIED naming the missing active organization', () => {
    expect(orgless.reseed.status, JSON.stringify(orgless.reseed.body)).toBe(403);
    expect(orgless.reseed.body?.success).toBe(false);
    expect(orgless.reseed.body?.error?.code).toBe('PERMISSION_DENIED');
    expect(orgless.reseed.body?.error?.message).toContain(NAMES_THE_MISSING_ORGANIZATION);
  });

  it('purge: 403 PERMISSION_DENIED naming the missing active organization', () => {
    expect(orgless.purge.status, JSON.stringify(orgless.purge.body)).toBe(403);
    expect(orgless.purge.body?.success).toBe(false);
    expect(orgless.purge.body?.error?.code).toBe('PERMISSION_DENIED');
    expect(orgless.purge.body?.error?.message).toContain(NAMES_THE_MISSING_ORGANIZATION);
  });

  it('no organization was guessed: not one seed row landed, in either organization or in none', () => {
    expect(rowsAfterOrgless).toBe(0);
  });

  it('CONTROL: the same session with organization B active — reseed, purge and reinstall act in B, as before', () => {
    expect(sessionOrgAfter).toBe(ORG_B);
    expect(inOrgB.reseed.status, JSON.stringify(inOrgB.reseed.body)).toBe(200);
    expect(inOrgB.reseed.body?.data).toMatchObject({ inserted: SEED_TOTAL, errors: 0, withSampleData: true });
    expect(orgBAfterReseed).toBe(SEED_TOTAL);
    expect(inOrgB.purge.status, JSON.stringify(inOrgB.purge.body)).toBe(200);
    expect(inOrgB.purge.body?.data).toMatchObject({ deleted: SEED_TOTAL, skipped: 0, errors: 0, withSampleData: false });
    expect(orgBAfterPurge).toBe(0);
    expect(inOrgB.reinstall.status, JSON.stringify(inOrgB.reinstall.body)).toBe(200);
    expect(inOrgB.reinstall.body?.data?.seeded).toMatchObject({ mode: 'inline', inserted: SEED_TOTAL });
    expect(orgBAfterReinstall).toBe(SEED_TOTAL);
    expect(orgAAtEnd).toBe(0);
  });
});
