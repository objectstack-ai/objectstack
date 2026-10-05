// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — under an organization wall, the install-local listing's
// `withSampleData` is the CALLER'S organization's answer, read from that
// organization's rows, and a restart keeps it (#21775).
//
// ## What was measured before the fix
//
// On a walled boot with a restart (`databaseFile`), the CRM package installed
// in organization A and reseeded in organization B (28 seed rows each), then a
// purge in A. `GET /api/v1/marketplace/install-local` read as B answered
// `withSampleData: false` for the package while B held all 28 of its seed
// rows; after the restart A held 0 and B held 28, and B's answer stayed false.
// The listing read the ledger's `withSampleData`, ONE value per install, which
// the purge in A had flipped for every organization.
//
// ## What this file pins, on two real boots over one database file and one ledger
//
//   1. PRECONDITIONS: the wall is in force; after A's purge, A holds 0 seed
//      rows and B holds 28; the ledger's install-wide record says false.
//   2. The listing read as B answers true; read as A, false.
//   3. After the restart, the rows are where they were and both answers hold.
//
// Boots a walled fixture stack of its own, twice, so it stays out of
// `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { LocalManifestSource, MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true } as ExecutionContext;
const CRM = 'com.example.crm';
const BASE = '/marketplace/install-local';
const ORG_A = 'org_21775_a';
const ORG_B = 'org_21775_b';
/** The CRM example's seeded objects and their seed-row counts (3 + 3 + 12 + 5 + 5). */
const SEEDED: Record<string, number> = {
  crm_account: 3, crm_contact: 3, crm_opportunity: 12, crm_lead: 5, crm_activity: 5,
};
const SEED_TOTAL = Object.values(SEEDED).reduce((a, b) => a + b, 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

/** The install body `os package install <artifact>.json` sends. */
function installBody(): { manifest: Record<string, unknown> } {
  const { artifact } = buildShapedArtifact(crmStack as unknown as Record<string, unknown>);
  const manifest = artifact.manifest as { id?: string; version?: string };
  return { manifest: { ...artifact, id: manifest.id, version: manifest.version } };
}

/** Seed-object rows in one organization, read as the system. */
async function countRows(ql: IObjectQLEngine, organizationId: string): Promise<number> {
  let total = 0;
  for (const object of Object.keys(SEEDED)) {
    total += rowsOf(await ql.find(object, { where: { organization_id: organizationId }, context: SYS })).length;
  }
  return total;
}

async function json(res: Response): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** One organization's view: the listing's answer for the CRM package, and the rows it holds. */
type View = { status: number; listed: number; withSampleData: unknown; rows: number };

describe('dogfood: the install-local listing answers withSampleData per organization, across a restart', () => {
  let stack: VerifyStack | undefined;
  let storageDir: string;
  let dbDir: string;
  let tenancy: { posture?: string; isolationActive?: boolean } | undefined;
  let installSeeded: unknown;
  let reseedB: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let purgeA: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let recordAfterPurge: { withSampleData?: boolean; sampleDataPurged?: boolean } | null | undefined;
  const beforeRestart: Record<'A' | 'B', View> = {} as never;
  const afterRestart: Record<'A' | 'B', View> = {} as never;

  const boot = (databaseFile: string) => bootStack(showcaseStack, {
    // `posture-only` requests the `isolated` posture — the wall is ACTIVE —
    // without the organizations runtime; the memberships are written by hand.
    multiTenant: 'posture-only',
    databaseFile,
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  });

  async function setActive(s: VerifyStack, token: string, organizationId: string): Promise<void> {
    const res = await s.apiAs(token, 'POST', '/auth/organization/set-active', { organizationId });
    expect(res.status, `set-active ${organizationId}: ${await res.clone().text()}`).toBe(200);
  }

  /** The listing read as `organizationId`, beside that organization's seed rows. */
  async function viewAs(s: VerifyStack, token: string, organizationId: string): Promise<View> {
    await setActive(s, token, organizationId);
    const listing = await json(await s.apiAs(token, 'GET', BASE));
    const items: Array<{ manifestId?: string; withSampleData?: unknown }> = listing.body?.data?.items ?? [];
    const crm = items.find((i) => i.manifestId === CRM);
    const ql = s.kernel.getService<IObjectQLEngine>('objectql');
    return { status: listing.status, listed: items.length, withSampleData: crm?.withSampleData, rows: await countRows(ql, organizationId) };
  }

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-listing-ledger-'));
    dbDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-listing-db-'));
    const databaseFile = join(dbDir, 'verify.db');

    // ── boot 1: install in A, reseed in B, purge in A ──────────────────────
    stack = await boot(databaseFile);
    const ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean }>('tenancy');
    await stack.signIn();
    const [admin] = rowsOf(await ql.find('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }));
    for (const org of [ORG_A, ORG_B]) {
      await ql.insert('sys_organization', { id: org, name: org, slug: org }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${org}`, organization_id: org, user_id: admin.id, role: 'owner' }, { context: SYS });
    }
    // A fresh session, so it is minted with the memberships above.
    let token = await stack.signIn();

    await setActive(stack, token, ORG_A);
    const install = await json(await stack.apiAs(token, 'POST', BASE, installBody()));
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    installSeeded = install.body?.data?.seeded;
    await setActive(stack, token, ORG_B);
    reseedB = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    await setActive(stack, token, ORG_A);
    purgeA = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    recordAfterPurge = new LocalManifestSource(storageDir).read(CRM).entry;

    beforeRestart.B = await viewAs(stack, token, ORG_B);
    beforeRestart.A = await viewAs(stack, token, ORG_A);
    await stack.stop();
    stack = undefined;

    // ── boot 2: the same database file and the same ledger, nothing written ─
    stack = await boot(databaseFile);
    token = await stack.signIn();
    afterRestart.B = await viewAs(stack, token, ORG_B);
    afterRestart.A = await viewAs(stack, token, ORG_A);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  it('PRECONDITION: the organization wall is in force on this boot', () => {
    expect(tenancy?.posture, 'tenancy posture in force').toBe('isolated');
    expect(tenancy?.isolationActive, 'the wall is enforced').toBe(true);
  });

  it('PRECONDITION: A and B each held the 28 seed rows, the purge in A removed A\'s, and the install-wide record says false', () => {
    expect(installSeeded).toMatchObject({ mode: 'inline', inserted: SEED_TOTAL });
    expect(reseedB.status, JSON.stringify(reseedB.body)).toBe(200);
    expect(reseedB.body?.data).toMatchObject({ inserted: SEED_TOTAL, errors: 0 });
    expect(purgeA.status, JSON.stringify(purgeA.body)).toBe(200);
    expect(purgeA.body?.data).toMatchObject({ deleted: SEED_TOTAL, skipped: 0, errors: 0 });
    expect(beforeRestart.A.rows).toBe(0);
    expect(beforeRestart.B.rows).toBe(SEED_TOTAL);
    // The record the listing used to serve to every organization.
    expect(recordAfterPurge).toMatchObject({ withSampleData: false, sampleDataPurged: true });
  });

  it('after the purge in A, the listing read as B answers withSampleData: true and read as A answers false', () => {
    expect(beforeRestart.B).toEqual({ status: 200, listed: 1, withSampleData: true, rows: SEED_TOTAL });
    expect(beforeRestart.A).toEqual({ status: 200, listed: 1, withSampleData: false, rows: 0 });
  });

  it('a restart keeps both answers, over the same rows', () => {
    expect(afterRestart.B).toEqual({ status: 200, listed: 1, withSampleData: true, rows: SEED_TOTAL });
    expect(afterRestart.A).toEqual({ status: 200, listed: 1, withSampleData: false, rows: 0 });
  });
});
