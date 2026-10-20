// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0131 D1 on the Turso REMOTE face: a table this transport CREATES carries
 * its tenant column NOT NULL, exactly as the local face's `createColumn`
 * builds it (execution record 6285122667 on the v18 step 7 card; ruling record
 * 6269955919, ② A: no declaration says so).
 *
 * ## The instrument
 *
 * As `turso-remote-not-null.test.ts`: the remote face is a `TursoDriver` in
 * remote mode over a real `@libsql/client` `file:` client, so its DDL runs on
 * a real libSQL connection; the local (Knex) face over a file of its own is the
 * reference each remote answer is held equal to. No hosted remote is reached.
 *
 * ## What is pinned
 *
 * 1. Through each of the three remote schema doors, a fresh table's tenant
 *    column is NOT NULL — the local face's answer — while an ordinary field
 *    beside it stays nullable.
 * 2. The database refuses a NULL tenant value: a raw statement on the remote
 *    store's own connection, so nothing above the database stamps the row.
 * 3. Neither face reports drift over it: the declaration says nullable, the
 *    column says NOT NULL, and that difference is the ceremony's.
 * 4. The boundaries: an object opted out of tenancy has no tenant column, so a
 *    field named `organization_id` stays nullable; a tenant column ADDED to a
 *    remote table that already exists stays nullable — an upgraded remote
 *    store keeps what it has (the ceremony reports this face as unable to
 *    tighten it).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { TursoDriver } from './turso-driver.js';

const scratch = mkdtempSync(join(tmpdir(), 'turso-remote-tenant-not-null-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let seq = 0;
const nextFile = () => join(scratch, `db-${++seq}.db`);

const open: Array<{ driver: TursoDriver; client: Client | null }> = [];
afterEach(async () => {
  while (open.length) {
    const { driver, client } = open.pop()!;
    await driver.disconnect().catch(() => {});
    client?.close();
  }
});

type Objects = Parameters<TursoDriver['detectManagedDrift']>[0] & object;

async function remoteOver(file: string): Promise<TursoDriver> {
  const client = createClient({ url: `file:${file}` });
  const driver = new TursoDriver({ url: 'libsql://tenant-not-null.example.turso.io', client });
  open.push({ driver, client });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return driver;
}

async function localOver(file: string): Promise<TursoDriver> {
  const driver = new TursoDriver({ url: `file:${file}` });
  open.push({ driver, client: null });
  await driver.connect();
  expect(driver.transportMode).toBe('local');
  return driver;
}

/** Each column's `notnull` flag as the database reports it, through a connection of its own. */
async function notNullFlags(file: string, table: string): Promise<Record<string, number>> {
  const c = createClient({ url: `file:${file}` });
  try {
    const rows = (await c.execute(`PRAGMA table_info("${table}")`)).rows;
    return Object.fromEntries(rows.map((r) => [String(r.name), Number(r.notnull)]));
  } finally {
    c.close();
  }
}

/** The kernel's injected tenant field, as the driver receives it: nullable by declaration. */
const ORG = { type: 'lookup', reference: 'sys_organization', required: false };

const OWNED = { name: 'tnn_owned', fields: { organization_id: ORG, note: { type: 'text' } } };
const GLOBAL = { name: 'tnn_global', tenancy: { enabled: false }, fields: { organization_id: ORG } };
const GROWN_BEFORE = { name: 'tnn_grown', fields: { note: { type: 'text' } } };
const GROWN_AFTER = { name: 'tnn_grown', fields: { note: { type: 'text' }, organization_id: ORG } };

type Door = 'syncSchemasBatch' | 'syncSchema' | 'initObjects';
const SYNC: Record<Door, (d: TursoDriver, objects: Objects) => Promise<void>> = {
  syncSchemasBatch: (d, objects) => d.syncSchemasBatch(objects.map((o) => ({ object: o.name, schema: o }))),
  syncSchema: async (d, objects) => {
    for (const o of objects) await d.syncSchema(o.name, o);
  },
  initObjects: (d, objects) => d.initObjects(objects as never),
};

describe('CREATE TABLE: a fresh remote table carries its tenant column NOT NULL', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])('synced through %s', async (door) => {
    const referenceFile = nextFile();
    await (await localOver(referenceFile)).initObjects([OWNED] as never);
    const reference = await notNullFlags(referenceFile, OWNED.name);
    expect({ organization_id: reference.organization_id, note: reference.note }).toEqual({ organization_id: 1, note: 0 });

    const file = nextFile();
    const remote = await remoteOver(file);
    await SYNC[door](remote, [OWNED]);

    expect(await notNullFlags(file, OWNED.name)).toEqual(reference);
    expect(await remote.detectManagedDrift([OWNED])).toEqual([]);
    const local = await localOver(file);
    local.registerObjectMetadata([OWNED] as never);
    expect(await local.detectManagedDrift([OWNED])).toEqual([]);
  });

  it('the remote database refuses a NULL tenant value', async () => {
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchema(OWNED.name, OWNED);

    const c = createClient({ url: `file:${file}` });
    try {
      await expect(
        c.execute({ sql: 'INSERT INTO tnn_owned (id, organization_id, note) VALUES (?, NULL, ?)', args: ['r1', 'x'] }),
      ).rejects.toThrow(/NOT NULL constraint failed: tnn_owned\.organization_id/);
      await c.execute({ sql: 'INSERT INTO tnn_owned (id, organization_id, note) VALUES (?, ?, NULL)', args: ['r2', 'org_a'] });
      expect((await c.execute('SELECT id FROM tnn_owned')).rows.map((r) => r.id)).toEqual(['r2']);
    } finally {
      c.close();
    }
  });
});

describe('the boundaries: no tenant column, or a table that already exists', () => {
  it('a tenancy-opted-out object keeps organization_id nullable on both faces', async () => {
    const remoteFile = nextFile();
    await (await remoteOver(remoteFile)).syncSchema(GLOBAL.name, GLOBAL);
    const localFile = nextFile();
    await (await localOver(localFile)).initObjects([GLOBAL] as never);

    expect((await notNullFlags(remoteFile, GLOBAL.name)).organization_id).toBe(0);
    expect((await notNullFlags(localFile, GLOBAL.name)).organization_id).toBe(0);
  });

  it.each<Door>(['syncSchemasBatch', 'syncSchema'])(
    'a tenant column added to an existing remote table stays nullable (%s)',
    async (door) => {
      const file = nextFile();
      const remote = await remoteOver(file);
      await remote.syncSchema(GROWN_BEFORE.name, GROWN_BEFORE);
      await remote.create(GROWN_BEFORE.name, { id: 'before', note: 'pre-existing row' });

      await SYNC[door](remote, [GROWN_AFTER]);

      expect((await notNullFlags(file, GROWN_AFTER.name)).organization_id).toBe(0);
      expect(await remote.detectManagedDrift([GROWN_AFTER])).toEqual([]);
    },
  );
});
