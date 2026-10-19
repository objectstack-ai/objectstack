// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * C3 (ADR-0131 D3) epic acceptance for stage 7a: no writer of
 * `sys_permission_set` remains. On a fresh database, a package-door publish
 * of a `permission`, a writable base's direct publish of one, and the boot
 * over the stored definitions leave ZERO rows in that table.
 *
 * ## Why it is measured this way
 *
 * The last writer was the ADR-0094 projector (`projectPermissionMutation` →
 * `upsertEnvPermissionSet`). Stage 6b-2 deleted the seeders and the publish
 * materializer, after which the projector alone wrote an `admin` row on every
 * publish and re-projected stored sets at boot; stage 8 unwired it and retired
 * the row object; stage 7a deletes it. A row could only come back through a
 * writer someone wires again, so the count is taken from the FILE, through a
 * connection of this test's own, after real publishes through the real
 * protocol and a real second boot — not from the engine, whose answer for an
 * unregistered object would be an error rather than a count. A table that
 * does not exist counts as zero rows: that is the expected state on a fresh
 * database, and it is the same answer the authorization path gets (none).
 *
 * The counter's own control writes one row the way a writer would and reads
 * it back as one, so "zero" is never a reader that cannot see a row.
 *
 * Both kernel shapes run: the host (`os serve`) shape, and the environment
 * kernel a hosted tenant runs, whose protocol is delegated to
 * `createMetadataProtocolPlugin`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectKernel, AppPlugin, DefaultDatasourcePlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { createMetadataProtocolPlugin } from '@objectstack/metadata-protocol';
import { MetadataPlugin } from '@objectstack/metadata';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';

const ENV = 'env_zero_row';
const TABLE = 'sys_permission_set';
/** A package whose drafts the package door publishes. */
const DRAFT_PKG = 'app.zero_row_drafts';
/** A writable base that publishes its set directly (ADR-0070). */
const BASE_PKG = 'app.zero_row_base';

const stack: any = {
  manifest: { id: 'com.example.zero_row', name: 'zero_row', version: '0.0.1', type: 'app' },
  objects: [{ name: 'zero_doc', label: 'Zero Doc', fields: { title: { type: 'text', label: 'Title' } } }],
  permissions: [{ name: 'zero_declared_reader', label: 'Declared reader', objects: { zero_doc: { allowRead: true } } }],
};

type Kind = 'environment' | 'host';

async function boot(kind: Kind, dbFile: string, rootDir: string): Promise<any> {
  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin(kind === 'environment' ? { environmentId: ENV, registerProtocol: false } : {}) as any);
  await kernel.use(new (DefaultDatasourcePlugin as any)({ driver: 'sqlite', config: { filename: dbFile } }, { dev: false }));
  if (kind === 'environment') await kernel.use(createMetadataProtocolPlugin({ environmentId: ENV }) as any);
  await kernel.use(new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' }, rootDir }) as any);
  await kernel.use(new AppPlugin(stack) as any);
  await kernel.use(new PlatformObjectsPlugin() as any);
  await kernel.use(new AuthPlugin({ secret: 'zero-row-secret-zero-row-secret-zero' }) as any);
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(stack)) as any);
  await kernel.bootstrap();
  return kernel;
}

/** Rows in `sys_permission_set`, read from the file; a missing table is zero rows. */
async function rowsInFile(dbFile: string): Promise<number> {
  const probe = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  const knex = (probe as any).knex;
  try {
    if (!(await knex.schema.hasTable(TABLE))) return 0;
    const [{ n }] = await knex(TABLE).count({ n: '*' });
    return Number(n);
  } finally {
    await knex.destroy();
  }
}

/** Stored, active, env-wide `permission` definitions — the publishes really landed. */
async function storedPermissionNames(dbFile: string): Promise<string[]> {
  const probe = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  const knex = (probe as any).knex;
  try {
    const rows = await knex('sys_metadata').select('name').where({ type: 'permission', state: 'active' }); // every row is the environment's (ADR-0131 D7)
    return rows.map((r: any) => String(r.name)).sort();
  } finally {
    await knex.destroy();
  }
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const fresh = (label: string) => {
  const dir = mkdtempSync(join(tmpdir(), `zero-row-${label}-`));
  dirs.push(dir);
  return { dir, dbFile: join(dir, 'zero.db') };
};

for (const kind of ['host', 'environment'] as Kind[]) {
  describe(`${kind} kernel: no writer of sys_permission_set remains (C3 stage 7a acceptance)`, () => {
    it('a package-door publish, a writable base\'s direct publish and the boot over them leave zero rows', async () => {
      const { dir, dbFile } = fresh(kind);
      expect(await rowsInFile(dbFile), 'a fresh database').toBe(0);

      let kernel = await boot(kind, dbFile, dir);
      try {
        const protocol = await kernel.getServiceAsync('protocol');
        const set = (name: string) => ({ name, label: name, isDefault: true, objects: { zero_doc: { allowRead: true } } });

        // The package door: a draft into the package, then its atomic publish.
        await protocol.saveMetaItem({ type: 'permission', name: 'zero_pkg_default', item: set('zero_pkg_default'), packageId: DRAFT_PKG, mode: 'draft' });
        const published = await protocol.publishPackageDrafts({ packageId: DRAFT_PKG, actor: 'system' });
        expect(published, JSON.stringify(published)).toMatchObject({ outcome: 'published', failed: [] });

        // A writable base's direct publish.
        await protocol.saveMetaItem({ type: 'permission', name: 'zero_base_set', item: set('zero_base_set'), packageId: BASE_PKG, mode: 'publish' });
      } finally {
        await kernel.shutdown();
      }

      // Non-vacuity: both publishes landed as stored definitions.
      expect(await storedPermissionNames(dbFile)).toEqual(expect.arrayContaining(['zero_base_set', 'zero_pkg_default']));
      expect(await rowsInFile(dbFile), 'after the two publishes').toBe(0);

      // The boot over the stored definitions — where the retired reconcile
      // re-projected every stored set into a row.
      kernel = await boot(kind, dbFile, dir);
      await kernel.shutdown();
      expect(await rowsInFile(dbFile), 'after a boot over the stored definitions').toBe(0);
    }, 180_000);
  });
}

describe('control: the counter sees a row a writer leaves', () => {
  it('one row written into sys_permission_set reads back as one', async () => {
    const { dbFile } = fresh('control');
    const writer = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
    const knex = (writer as any).knex;
    try {
      await knex.schema.createTable(TABLE, (t: any) => {
        t.string('id').primary();
        t.string('name');
        t.string('managed_by');
      });
      await knex(TABLE).insert({ id: 'ps_1', name: 'zero_pkg_default', managed_by: 'admin' });
    } finally {
      await knex.destroy();
    }
    expect(await rowsInFile(dbFile)).toBe(1);
  });
});
