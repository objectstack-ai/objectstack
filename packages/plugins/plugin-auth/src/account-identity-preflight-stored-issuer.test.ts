// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25030] The `sys_account.issuer` retirement pre-flight names each colliding
 * row's STORED issuer, on both doors that run it, over a real driver.
 *
 * ## The defect this pins against
 *
 * `os migrate apply`'s drop gate hands the probe the `objectql` service it
 * booted, and the probe used to read through that engine's `find`. The shipped
 * `sys_account` no longer declares `issuer` (#17440) and the engine answers
 * declared columns only, so the gate's report labelled every colliding row's
 * issuer `(none)`, while `os migrate account-issuer`, reading the driver,
 * printed the real values for the same database. The probe now reads the
 * driver itself, for both doors.
 *
 * ## The fixture
 *
 * One SQLite file per case. The driver builds `sys_account` from the object
 * that ships today, then the legacy shape is applied by hand: the `issuer`
 * column, and the `(provider_id, account_id)` unique index absent, which is
 * the only population that can hold the collision class (commit 61821e54c /
 * #15479). The no-column cases leave the `issuer` column out.
 *
 * Each file is read through two compositions and one reference:
 *
 *  - `apply`'s: an engine where `sys_account` is registered as it ships, with
 *    no `issuer` field;
 *  - `account-issuer`'s: an engine where it is not registered at all (that
 *    boot composes no auth plugin);
 *  - the reference, the read the probe made BEFORE this change: the engine's
 *    own `find` under the system context, handed to the probe as its storage.
 *    The verdict pins compare against it, so "unchanged" means unchanged from
 *    the read the gate used to make, not from a number written down here.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  probeAccountIdentityCollisions,
  assertNoAccountIdentityCollisions,
  formatAccountIdentityPreflightReport,
  AccountIdentityPreflightRefusal,
  SYS_ACCOUNT_OBJECT,
  type AccountIdentityPreflightReport,
  type AccountTableStorage,
} from './account-identity-preflight.js';
import { authIdentityObjects } from './manifest.js';

const SYSTEM = { context: { isSystem: true } } as never;

/** `sys_account` exactly as it ships: no `issuer` field. */
const SHIPPED_SYS_ACCOUNT = authIdentityObjects.find((o: { name?: string }) => o?.name === SYS_ACCOUNT_OBJECT);

interface AccountRow {
  id: string;
  provider_id: string;
  account_id: string;
  user_id: string;
  issuer: string | null;
}

/** The card's shape: one key held by two people's rows under two IdPs, beside one clean row. */
const COLLIDING: AccountRow[] = [
  { id: 'acc_alice', provider_id: 'okta', account_id: 'sub-7', user_id: 'usr_alice', issuer: 'https://idp-a.example' },
  { id: 'acc_bob', provider_id: 'okta', account_id: 'sub-7', user_id: 'usr_bob', issuer: 'https://idp-b.example' },
  { id: 'acc_carol', provider_id: 'credential', account_id: 'usr_carol', user_id: 'usr_carol', issuer: 'local:credential' },
];

const engines: ObjectQL[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

function newDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-25030-issuer-'));
  dirs.push(dir);
  return join(dir, 'identity.sqlite');
}

const rowsOfRaw = (r: unknown): Array<Record<string, unknown>> =>
  Array.isArray(r) ? r : ((r as { rows?: Array<Record<string, unknown>> })?.rows ?? []);

/**
 * Rows per seeding statement. knex compiles a multi-row SQLite insert as one
 * `select … union all select …`, so a chunk is bounded by SQLite's
 * compound-select limit (500 terms) and its bound-variable limit; 200 rows of
 * five columns clear both.
 */
const SEED_CHUNK_ROWS = 200;

/** Build the legacy `sys_account` on `file`, independently of the code under test. */
async function arrangeAccountTable(
  file: string,
  { issuerColumn, rows }: { issuerColumn: boolean; rows: AccountRow[] },
): Promise<void> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  try {
    await driver.initObjects([SHIPPED_SYS_ACCOUNT as never]);
    const knex = driver.getKnex();
    let dropped = 0;
    for (const index of rowsOfRaw(await knex.raw(`PRAGMA index_list('${SYS_ACCOUNT_OBJECT}')`))) {
      if (!index.unique || index.origin === 'pk') continue;
      const columns = rowsOfRaw(await knex.raw(`PRAGMA index_info('${String(index.name)}')`)).map((c) => c.name);
      if (columns.join(',') !== 'provider_id,account_id') continue;
      await knex.raw(`DROP INDEX "${String(index.name)}"`);
      dropped++;
    }
    expect(dropped, 'fixture: the declared (provider_id, account_id) unique was built, then removed').toBe(1);
    if (issuerColumn) await knex.raw(`ALTER TABLE ${SYS_ACCOUNT_OBJECT} ADD COLUMN issuer TEXT`);
    // One transaction, in multi-row chunks. Inserted one at a time, each row is
    // its own autocommit on this file, and its own fsync: the 1,200-row case
    // spent its budget there under the full battery's load.
    await knex.batchInsert(
      SYS_ACCOUNT_OBJECT,
      rows.map(({ issuer, ...rest }) => (issuerColumn ? { ...rest, issuer } : rest)),
      SEED_CHUNK_ROWS,
    );
    const columns = rowsOfRaw(await knex.raw(`PRAGMA table_info('${SYS_ACCOUNT_OBJECT}')`)).map((c) => c.name);
    expect(columns.includes('issuer'), 'fixture: the issuer column is as the case asks').toBe(issuerColumn);
  } finally {
    await driver.disconnect();
  }
}

async function bootEngine(file: string, objects: unknown[]): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of objects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  return engine;
}

/** `os migrate apply`'s composition: `sys_account` registered as it ships. */
const applyComposition = (file: string) => bootEngine(file, [SHIPPED_SYS_ACCOUNT]);

/** `os migrate account-issuer`'s composition: no auth plugin, so `sys_account` is unregistered. */
const accountIssuerComposition = (file: string) => bootEngine(file, []);

/** The read the probe made before this change: the engine's own `find`, under the system context. */
const engineFindRead = (engine: ObjectQL): AccountTableStorage => ({
  getDriverForObject: () => ({
    find: (object, query) => engine.find(object, query as never, SYSTEM),
  }),
});

/** Everything the report decides with: the whole report minus the issuers it names. */
const verdictOf = (report: AccountIdentityPreflightReport) => ({
  ...report,
  collisions: report.collisions.map(({ issuers: _issuers, ...rest }) => rest),
});

function refusalOf(report: AccountIdentityPreflightReport): AccountIdentityPreflightRefusal | undefined {
  try {
    assertNoAccountIdentityCollisions(report);
  } catch (e) {
    return e as AccountIdentityPreflightRefusal;
  }
  return undefined;
}

describe('#25030 the report names each colliding row\'s STORED issuer', () => {
  it('apply\'s composition, where sys_account is registered without issuer: the stored values, in the report and its text', async () => {
    const file = newDbFile();
    await arrangeAccountTable(file, { issuerColumn: true, rows: COLLIDING });
    const engine = await applyComposition(file);

    // PREMISE: on this composition the engine's own read cuts `issuer` away,
    // so the fixture holds the defect. Without this, the pin below could be
    // green over a database the old reader also read correctly.
    const before = await probeAccountIdentityCollisions(engineFindRead(engine));
    expect(before.collisions[0]?.issuers, 'the engine read labels every row (none)').toEqual(['(none)']);

    const report = await probeAccountIdentityCollisions(engine as never);
    expect(report).toEqual({
      scanned: 3,
      keys: 2,
      collisions: [
        {
          providerId: 'okta',
          accountId: 'sub-7',
          issuers: ['https://idp-a.example', 'https://idp-b.example'],
          rowIds: ['acc_alice', 'acc_bob'],
          userIds: ['usr_alice', 'usr_bob'],
          crossUser: true,
        },
      ],
      crossUser: 1,
      ok: false,
    });
    const text = formatAccountIdentityPreflightReport(report);
    expect(text).toContain('issuers [https://idp-a.example, https://idp-b.example]');
    expect(text).not.toContain('(none)');
  });

  it('one reader: account-issuer\'s composition, where sys_account is unregistered, answers the same report and the same text', async () => {
    const file = newDbFile();
    await arrangeAccountTable(file, { issuerColumn: true, rows: COLLIDING });
    const viaApply = await probeAccountIdentityCollisions((await applyComposition(file)) as never);
    const viaAccountIssuer = await probeAccountIdentityCollisions((await accountIssuerComposition(file)) as never);

    expect(viaAccountIssuer.collisions[0]?.issuers).toEqual(['https://idp-a.example', 'https://idp-b.example']);
    expect(viaAccountIssuer).toEqual(viaApply);
    expect(formatAccountIdentityPreflightReport(viaAccountIssuer)).toBe(formatAccountIdentityPreflightReport(viaApply));
  });
});

describe('#25030 the verdict does not move', () => {
  it('everything but the issuers equals what the engine read reported, and the refusal is the same refusal', async () => {
    const file = newDbFile();
    await arrangeAccountTable(file, { issuerColumn: true, rows: COLLIDING });
    const engine = await applyComposition(file);
    const before = await probeAccountIdentityCollisions(engineFindRead(engine));
    const after = await probeAccountIdentityCollisions(engine as never);

    expect(after.ok).toBe(false);
    expect(after.collisions.map((c) => [c.providerId, c.accountId])).toEqual([['okta', 'sub-7']]);
    expect(verdictOf(after)).toEqual(verdictOf(before));

    const refusedBefore = refusalOf(before);
    const refusedAfter = refusalOf(after);
    expect(refusedAfter).toBeInstanceOf(AccountIdentityPreflightRefusal);
    expect(refusedAfter!.code).toBe('RESOURCE_CONFLICT');
    expect(refusedAfter!.status).toBe(409);
    expect(refusedAfter!.message).toBe(refusedBefore!.message);
  });

  it('over a walk of several pages, with the colliding rows on its first and last page', async () => {
    const file = newDbFile();
    const rows: AccountRow[] = [];
    for (let i = 0; i < 1_200; i++) {
      const id = `acc_${String(i).padStart(4, '0')}`;
      const colliding = i === 0 || i === 1_199;
      rows.push({
        id,
        provider_id: colliding ? 'okta' : 'credential',
        account_id: colliding ? 'sub-7' : `usr_${i}`,
        user_id: colliding ? `usr_edge_${i}` : `usr_${i}`,
        issuer: colliding ? `https://idp-${i}.example` : 'local:credential',
      });
    }
    await arrangeAccountTable(file, { issuerColumn: true, rows });
    const engine = await applyComposition(file);
    const before = await probeAccountIdentityCollisions(engineFindRead(engine));
    const after = await probeAccountIdentityCollisions(engine as never);

    expect(after.scanned, 'the walk reached the end of the table').toBe(1_200);
    expect(after.collisions.map((c) => c.rowIds)).toEqual([['acc_0000', 'acc_1199']]);
    expect(after.collisions[0]!.issuers).toEqual(['https://idp-0.example', 'https://idp-1199.example']);
    expect(verdictOf(after)).toEqual(verdictOf(before));
  });

  it('CONTROL: a clean table stays clean through both reads', async () => {
    const file = newDbFile();
    await arrangeAccountTable(file, {
      issuerColumn: true,
      rows: COLLIDING.map((r) => (r.id === 'acc_bob' ? { ...r, account_id: 'sub-8' } : r)),
    });
    const engine = await applyComposition(file);
    const before = await probeAccountIdentityCollisions(engineFindRead(engine));
    const after = await probeAccountIdentityCollisions(engine as never);
    expect(after).toMatchObject({ scanned: 3, keys: 3, collisions: [], crossUser: 0, ok: true });
    expect(after).toEqual(before);
    expect(refusalOf(after)).toBeUndefined();
  });
});

describe('#25030 a database with no issuer column answers as it did', () => {
  it('the report the engine read gave, on both compositions: every row (none), the same verdict', async () => {
    const file = newDbFile();
    await arrangeAccountTable(file, { issuerColumn: false, rows: COLLIDING });
    const applyEngine = await applyComposition(file);
    const viaApply = await probeAccountIdentityCollisions(applyEngine as never);
    const viaAccountIssuer = await probeAccountIdentityCollisions((await accountIssuerComposition(file)) as never);
    expect(viaApply).toMatchObject({ scanned: 3, keys: 2, crossUser: 1, ok: false });
    expect(viaApply.collisions).toEqual([
      expect.objectContaining({ providerId: 'okta', accountId: 'sub-7', issuers: ['(none)'], rowIds: ['acc_alice', 'acc_bob'] }),
    ]);

    const before = await probeAccountIdentityCollisions(engineFindRead(applyEngine));
    expect(viaApply).toEqual(before);
    expect(viaAccountIssuer).toEqual(before);
  });
});

describe('#21552 a missing sys_account table, through the shared reader', () => {
  it('a caller that asks reads it as no rows and is told once', async () => {
    const file = newDbFile();
    const engine = await accountIssuerComposition(file);
    let told = 0;
    const report = await probeAccountIdentityCollisions(engine as never, { onTableAbsent: () => { told++; } });
    expect(report).toEqual({ scanned: 0, keys: 0, collisions: [], crossUser: 0, ok: true });
    expect(told).toBe(1);
  });

  it('a caller that does not ask is refused: an absence nobody is told about is not a clean read', async () => {
    const file = newDbFile();
    const engine = await accountIssuerComposition(file);
    let refusal: AccountIdentityPreflightRefusal | undefined;
    try {
      await probeAccountIdentityCollisions(engine as never);
    } catch (e) {
      refusal = e as AccountIdentityPreflightRefusal;
    }
    expect(refusal).toBeInstanceOf(AccountIdentityPreflightRefusal);
    expect(refusal!.code).toBe('RESOURCE_CONFLICT');
    expect(refusal!.status).toBe(409);
    expect(refusal!.message).toContain('Cannot enumerate sys_account');
  });

  it('CONTROL: a table that is there is read, and nobody is told it is absent', async () => {
    const file = newDbFile();
    await arrangeAccountTable(file, { issuerColumn: true, rows: COLLIDING });
    let told = 0;
    const report = await probeAccountIdentityCollisions((await accountIssuerComposition(file)) as never, {
      onTableAbsent: () => { told++; },
    });
    expect(report.scanned).toBe(3);
    expect(told).toBe(0);
  });

  it('no driver for the table refuses, naming it, and never falls back to the source\'s own find', async () => {
    const engineFind = vi.fn(async () => COLLIDING);
    let refusal: AccountIdentityPreflightRefusal | undefined;
    try {
      await probeAccountIdentityCollisions(
        { getDriverForObject: () => undefined, find: engineFind } as AccountTableStorage,
        { onTableAbsent: () => {} },
      );
    } catch (e) {
      refusal = e as AccountIdentityPreflightRefusal;
    }
    expect(refusal).toBeInstanceOf(AccountIdentityPreflightRefusal);
    expect(refusal!.code).toBe('RESOURCE_CONFLICT');
    expect(refusal!.status).toBe(409);
    expect(refusal!.message).toContain('no driver serves sys_account');
    expect(engineFind).not.toHaveBeenCalled();
  });
});
