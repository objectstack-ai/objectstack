// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — an install-local reseed over an INTACT baseline is a
// success that says why nothing changed, not a refusal naming a false cause
// (#21776).
//
// ## What was measured before the fix
//
// The showcase booted, the CRM example installed from its built artifact (its
// 28 seed rows landed), then, as the admin, with every one of them in place:
//
//   POST …/install-local/com.example.crm/reseed-sample-data {}
//     -> 422 RESEED_NO_ROWS "Reseed wrote no rows. The package declares no
//        seedable records for this runtime."
//
// The package declares 28 seed records; the loader skipped all 28 as already
// present. The handler counted only `inserted + updated`, so an idempotent
// reseed over the state it exists to reach was reported as a broken package.
//
// ## What this file pins, on a real boot
//
//   1. over the intact baseline the reseed answers 200 with
//      `{ inserted: 0, updated: 0, skipped: 28, errors: 0 }`, and no row moved;
//   2. after a purge the reseed answers 200 with `inserted: 28`;
//   3. a package whose seed datasets all apply to another environment — the
//      loader has no record to process for this runtime — still answers
//      `422 RESEED_NO_ROWS` with its existing text, which is then true.
//
// Boots fixture stacks of its own (an extra plugin, a ledger directory), so it
// stays out of `SHARED_SHOWCASE`.

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
/** The CRM example's seeded objects and their seed-row counts (3 + 3 + 12 + 5 + 5). */
const SEEDED: Record<string, number> = {
  crm_account: 3, crm_contact: 3, crm_opportunity: 12, crm_lead: 5, crm_activity: 5,
};
const SEED_TOTAL = Object.values(SEEDED).reduce((a, b) => a + b, 0);
const EMPTY = Object.fromEntries(Object.keys(SEEDED).map((o) => [o, 0]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

type Dataset = { object: string; records: unknown[]; env?: string[] };

/**
 * The install body `os package install <artifact>.json` sends: the whole
 * artifact, with the manifest's id and version lifted to the top level
 * (`packages/cli/src/commands/package/install.ts`). `mapData` rewrites the
 * artifact's seed datasets.
 */
function installBody(mapData: (d: Dataset) => Dataset = (d) => d): { manifest: Record<string, unknown> } {
  const { artifact } = buildShapedArtifact(crmStack as unknown as Record<string, unknown>);
  const manifest = artifact.manifest as { id?: string; version?: string };
  const data = (artifact.data as Dataset[]).map(mapData);
  return { manifest: { ...artifact, data, id: manifest.id, version: manifest.version } };
}

/** Seed-row counts per CRM object, read as the system. */
async function countSeeded(ql: IObjectQLEngine): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const object of Object.keys(SEEDED)) out[object] = rowsOf(await ql.find(object, { context: SYS })).length;
  return out;
}

/** `object#id@updated_at` for every seed-object row: a reseed that rewrote a row moves its stamp. */
async function rowStamps(ql: IObjectQLEngine): Promise<string[]> {
  const stamps: string[] = [];
  for (const object of Object.keys(SEEDED)) {
    for (const row of rowsOf(await ql.find(object, { context: SYS }))) {
      stamps.push(`${object}#${row.id}@${String(row.updated_at)}`);
    }
  }
  return stamps.sort();
}

async function json(res: Response): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('dogfood: install-local reseed over an intact baseline, then after a purge', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let ql: IObjectQLEngine;
  let install: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let intact: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let purge: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let afterPurge: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let afterInstall: Record<string, number>;
  let stampsBefore: string[];
  let stampsAfterIntact: string[];
  let afterIntactCounts: Record<string, number>;
  let purgedCounts: Record<string, number>;
  let reseededCounts: Record<string, number>;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-reseed-intact-'));
    stack = await bootStack(showcaseStack, {
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    const token = await stack.signIn();

    install = await json(await stack.apiAs(token, 'POST', BASE, installBody()));
    afterInstall = await countSeeded(ql);
    stampsBefore = await rowStamps(ql);

    intact = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    afterIntactCounts = await countSeeded(ql);
    stampsAfterIntact = await rowStamps(ql);

    purge = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    purgedCounts = await countSeeded(ql);

    afterPurge = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    reseededCounts = await countSeeded(ql);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('PRECONDITION: the install landed all 28 seed rows', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.seeded).toMatchObject({ mode: 'inline', inserted: SEED_TOTAL });
    expect(afterInstall).toEqual(SEEDED);
    expect(stampsBefore).toHaveLength(SEED_TOTAL);
  });

  it('over the intact baseline the reseed answers 200 { inserted: 0, skipped: 28 } and no row moved', () => {
    expect(intact.status, JSON.stringify(intact.body)).toBe(200);
    expect(intact.body).toEqual({
      success: true,
      data: { manifestId: CRM, inserted: 0, updated: 0, skipped: SEED_TOTAL, errors: 0, withSampleData: true },
    });
    expect(afterIntactCounts).toEqual(SEEDED);
    expect(stampsAfterIntact).toEqual(stampsBefore);
  });

  it('after a purge the reseed answers 200 with inserted: 28', () => {
    expect(purge.status, JSON.stringify(purge.body)).toBe(200);
    expect(purge.body?.data).toMatchObject({ deleted: SEED_TOTAL, errors: 0 });
    expect(purgedCounts).toEqual(EMPTY);

    expect(afterPurge.status, JSON.stringify(afterPurge.body)).toBe(200);
    expect(afterPurge.body).toEqual({
      success: true,
      data: { manifestId: CRM, inserted: SEED_TOTAL, updated: 0, skipped: 0, errors: 0, withSampleData: true },
    });
    expect(reseededCounts).toEqual(SEEDED);
  });
});

describe('dogfood: install-local reseed of a package with no seed record for this runtime', () => {
  /**
   * Every seed environment except this runtime's: `bootStack` forces
   * `NODE_ENV=development` (`packages/verify/src/harness.ts`), which the seed
   * loader reads as `dev`.
   */
  const ELSEWHERE = ['prod', 'test'];
  let stack: VerifyStack;
  let storageDir: string;
  let ql: IObjectQLEngine;
  let body: { manifest: Record<string, unknown> };
  let install: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let reseed: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let counts: Record<string, number>;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-reseed-none-'));
    stack = await bootStack(showcaseStack, {
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    const token = await stack.signIn();

    body = installBody((d) => ({ ...d, env: ELSEWHERE }));
    install = await json(await stack.apiAs(token, 'POST', BASE, body));
    reseed = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    counts = await countSeeded(ql);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('PRECONDITION: the package declares its 28 records, every dataset for another environment', () => {
    expect(process.env.NODE_ENV).toBe('development');
    const data = body.manifest.data as Dataset[];
    expect(data.reduce((n, d) => n + d.records.length, 0)).toBe(SEED_TOTAL);
    expect(data.every((d) => !d.env?.includes('dev'))).toBe(true);
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.seeded).toMatchObject({ mode: 'inline', inserted: 0, updated: 0, skipped: 0, errors: 0 });
  });

  it('the reseed answers 422 RESEED_NO_ROWS with its existing text, and writes nothing', () => {
    expect(reseed.status, JSON.stringify(reseed.body)).toBe(422);
    expect(reseed.body?.success).toBe(false);
    expect(reseed.body?.error?.code).toBe('RESEED_NO_ROWS');
    expect(reseed.body?.error?.message).toBe(
      'Reseed wrote no rows. The package declares no seedable records for this runtime.',
    );
    expect(counts).toEqual(EMPTY);
  });
});
