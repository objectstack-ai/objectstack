// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — an unmanaged copy takes the package's sample data when
// the install door is asked to (`seedSampleData: true`, #30808), on the real
// showcase composition, across restarts of one database file.
//
// The copy writes each dataset as a `seed` item of the new base — the seed
// receipt, in the environment's metadata — and the door loads the rows from
// that receipt as the installer. The purge reads the same receipt.
//
// ## What this file pins, on a real boot (`single`)
//
//   1. the unmanaged install answers 200 with `seeded` inline: the CRM
//      example's 28 rows, each object's count exact, and the five datasets
//      copied as `seed` items of the new base;
//   2. every copied row is owned by the person who installed it: `owner_id`
//      and `created_by` are the signed-in user's id (the same id a row that
//      person writes through the REST door carries);
//   3. a lookup between copied rows resolves to the copied row it names: an
//      activity's `account` is the id of the account the seed names;
//   4. a restart on the same database inserts no row (the receipt is not a
//      boot-time load);
//   5. the purge deletes exactly the 28 copied rows and keeps a row the
//      person wrote; a second restart inserts none of them back;
//   6. the door's record of the copy is tied to the base's row in the
//      package store (`version` and `created_at`), and a restart keeps that
//      row's `created_at`, so the purge in boot 2 still reaches the copy.
//
// Boots fixture stacks of its own (a database file across restarts), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true } as ExecutionContext;
const BASE_ID = 'com.example.crm-copy';
const ROUTE = '/marketplace/install-local';
/** The CRM example's seeded objects and their seed-row counts (3 + 3 + 12 + 5 + 5). */
const SEEDED: Record<string, number> = {
  crm_account: 3, crm_contact: 3, crm_opportunity: 12, crm_lead: 5, crm_activity: 5,
};
const SEED_TOTAL = Object.values(SEEDED).reduce((a, b) => a + b, 0);
const NONE = Object.fromEntries(Object.keys(SEEDED).map((o) => [o, 0]));

type Answer = { status: number; body: any };

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The body `os package install <artifact>.json --install-mode unmanaged` sends, asking for the sample data. */
function installBody(): Record<string, unknown> {
  const { artifact } = buildShapedArtifact(crmStack as unknown as Record<string, unknown>);
  const manifest: Record<string, unknown> = {
    ...(artifact.manifest as Record<string, unknown>),
    installModes: ['managed', 'unmanaged'],
  };
  return {
    manifest: { ...artifact, manifest, id: manifest.id, version: manifest.version },
    installMode: 'unmanaged',
    seedSampleData: true,
  };
}

async function countRows(ql: IObjectQLEngine): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const object of Object.keys(SEEDED)) out[object] = rowsOf(await ql.find(object, { context: SYS })).length;
  return out;
}

describe('dogfood: an unmanaged copy with its sample data (#30808)', () => {
  let stack: VerifyStack | undefined;
  let storageDir: string;
  let dbDir: string;

  let install: Answer;
  let record: any;
  let afterInstall: Record<string, number>;
  let owners = new Set<string>();
  let creators = new Set<string>();
  let personId: unknown;
  let activityAccount: { named: unknown; resolved: unknown };
  let afterRestart: Record<string, number>;
  let purge: Answer;
  let afterPurge: Record<string, number>;
  let afterSecondRestart: Record<string, number>;
  let survivorsAfterSecondRestart: unknown[];

  const boot = (databaseFile: string) => bootShowcase({
    databaseFile,
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  });

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-unmanaged-seed-ledger-'));
    dbDir = mkdtempSync(join(tmpdir(), 'dogfood-unmanaged-seed-db-'));
    const databaseFile = join(dbDir, 'verify.db');

    // ── boot 1: the copy, with its sample data ─────────────────────────────
    stack = await boot(databaseFile);
    let token = await stack.signIn();
    let ql = stack.kernel.getService<IObjectQLEngine>('objectql');

    install = await json(await stack.apiAs(token, 'POST', ROUTE, installBody()));
    afterInstall = await countRows(ql);
    record = JSON.parse(readFileSync(join(storageDir, 'unmanaged-copies', `${BASE_ID}.json`), 'utf8'));
    for (const object of Object.keys(SEEDED)) {
      for (const row of rowsOf(await ql.find(object, { context: SYS }))) {
        owners.add(String(row.owner_id));
        creators.add(String(row.created_by));
      }
    }
    const acme = rowsOf(await ql.find('crm_account', { where: { name: 'Acme Corp' }, context: SYS }))[0];
    const call = rowsOf(await ql.find('crm_activity', {
      where: { subject: 'Discovery Call — Acme Platform Renewal' }, context: SYS,
    }))[0];
    activityAccount = { named: acme?.id, resolved: call?.account };

    // A row the same person writes through the REST door: its owner is the person's id.
    const own = await json(await stack.apiAs(token, 'POST', '/data/crm_account', { name: 'User Authored Co', industry: 'technology' }));
    expect(own.status, JSON.stringify(own.body)).toBeLessThan(300);
    personId = rowsOf(await ql.find('crm_account', { where: { name: 'User Authored Co' }, context: SYS }))[0]?.created_by;
    await stack.stop();
    stack = undefined;

    // ── boot 2: the same database — nothing re-inserted; then the purge ────
    stack = await boot(databaseFile);
    token = await stack.signIn();
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    afterRestart = await countRows(ql);
    purge = await json(await stack.apiAs(token, 'POST', `${ROUTE}/${BASE_ID}/purge-sample-data`, {}));
    afterPurge = await countRows(ql);
    await stack.stop();
    stack = undefined;

    // ── boot 3: the same database after the purge — still nothing back ─────
    stack = await boot(databaseFile);
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    afterSecondRestart = await countRows(ql);
    survivorsAfterSecondRestart = rowsOf(await ql.find('crm_account', { context: SYS })).map((r) => r.name);
  }, 600_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  it('the copy answers 200, loads the 28 rows inline and copies the five datasets as `seed` items', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.seeded, JSON.stringify(install.body?.data?.seeded)).toMatchObject({ mode: 'inline', inserted: SEED_TOTAL, errors: 0 });
    expect(afterInstall).toEqual(SEEDED);
    const seeds = (install.body?.data?.copied ?? []).filter((i: any) => i.type === 'seed').map((i: any) => i.name).sort();
    expect(seeds, JSON.stringify(install.body?.data?.copied)).toEqual(Object.keys(SEEDED).map((o) => `${o}_seed`).sort());
  });

  it('the door\'s record of the copy is tied to the base\'s package-store row, and the answer carries no `copyRecord`', () => {
    expect(install.body?.data).not.toHaveProperty('copyRecord');
    expect(record).toMatchObject({ baseId: BASE_ID, seeded: true, instance: { version: expect.any(String), createdAt: expect.any(String) } });
    expect(record.instance.createdAt).not.toBe('');
  });

  it('every copied row is owned by the person who installed it', () => {
    expect(typeof personId).toBe('string');
    expect([...owners]).toEqual([personId]);
    expect([...creators]).toEqual([personId]);
  });

  it('a lookup between copied rows resolves to the copied row it names', () => {
    expect(typeof activityAccount.named).toBe('string');
    expect(activityAccount.resolved).toBe(activityAccount.named);
  });

  it('a restart after the copy inserts no row', () => {
    expect(afterRestart).toEqual({ ...SEEDED, crm_account: SEEDED.crm_account + 1 });
  });

  it('the purge deletes exactly the copied rows, and a restart after it inserts none back', () => {
    expect(purge.status, JSON.stringify(purge.body)).toBe(200);
    expect(purge.body?.data).toMatchObject({ manifestId: BASE_ID, deleted: SEED_TOTAL, skipped: 0, errors: 0 });
    expect(afterPurge).toEqual({ ...NONE, crm_account: 1 });
    expect(afterSecondRestart).toEqual({ ...NONE, crm_account: 1 });
    expect(survivorsAfterSecondRestart).toEqual(['User Authored Co']);
  });
});
