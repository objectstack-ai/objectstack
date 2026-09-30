// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20648 — a deployment ledger this driver instance did not create is read
 * without the nondeterministic-paging warning, and the warning still fires for
 * a read that really is an unsorted page.
 *
 * ## The measured defect
 *
 * A SQLite database created by 17.4.0 and booted on 17.5.0 printed
 * "Paged read of 'sys_migration' is NOT deterministic" on every boot and every
 * `os migrate plan`. The reader was `ObjectQL.readMigrationFlagVerified`
 * (reached through `haveFileColumnsMoved`), which runs BEFORE the schema pass
 * registers `sys_migration` with the driver: at that moment the driver has no
 * column it can trust to order by, and a `find` carrying `limit: 1` is,
 * to the driver, page one of a walk. The read was a primary-key lookup that can
 * never return two rows.
 *
 * ## The construction
 *
 * Two driver instances over one SQLite file, which is the upgrade's shape: a
 * previous process created the table and wrote a flag row; this process's
 * engine knows the object (the registry is filled at init) while its driver
 * has not been told about it yet. Every platform reader of the ledger then runs
 * against that driver — the engine's gate read, `platform-objects`'
 * `readDataMigrationFlag`, and the engine `findOne` the seed-tenancy receipt's
 * ledger resolves to.
 *
 * The control is the other half of the ruling: the check is NOT taught which
 * column is unique. An unsorted `limit` read on the same table must still warn,
 * and it runs LAST — the warning is once per object per driver, so a reader
 * above that had warned would leave the control nothing to say.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMigration, readDataMigrationFlag } from '@objectstack/platform-objects/system';
import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';

const PAGING_WARNING = /Paged read of 'sys_migration' is NOT deterministic/;

const openDrivers: SqlDriver[] = [];
const tempDirs: string[] = [];

function sqliteDriver(filename: string): SqlDriver {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
  openDrivers.push(driver);
  return driver;
}

afterEach(async () => {
  while (openDrivers.length) {
    try {
      await openDrivers.pop()?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('#20648 — sys_migration point lookups on a table this driver did not create', () => {
  it('reads the ledger without the paging warning; an unsorted page on it still warns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-20648-'));
    tempDirs.push(dir);
    const file = join(dir, 'ledger.sqlite');

    // ── the previous process: it created the table and certified a migration.
    const creator = sqliteDriver(file);
    await creator.initObjects([SysMigration as any]);
    const now = new Date().toISOString();
    await creator.create('sys_migration', {
      id: FILE_REFERENCES_MIGRATION_ID,
      last_run_at: now,
      verified_at: now,
      applied_at: now,
      blocking: 0,
      advisory: 0,
    });
    await creator.disconnect();

    // ── this process, at the moment the boot's first ledger read runs.
    const driver = sqliteDriver(file);
    const warn = vi.spyOn((driver as any).logger, 'warn').mockImplementation(() => {});
    const engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(SysMigration as any, '#20648');
    // The precondition, asserted rather than assumed: this driver has no column
    // it trusts to order `sys_migration` by, so an unsorted page WOULD warn.
    expect((driver as any).paginationTieBreaker('sys_migration')).toBeNull();

    // The engine's gate read — the one a measured boot and `os migrate plan` hit.
    expect(await engine.haveFileColumnsMoved()).toBe(false);
    expect(await engine.isFileReferencesMigrationVerified()).toBe(true);
    // `platform-objects`' reader, through the real engine.
    expect(await readDataMigrationFlag(engine as any, FILE_REFERENCES_MIGRATION_ID)).toMatchObject({
      id: FILE_REFERENCES_MIGRATION_ID,
      blocking: 0,
    });
    // The seed-tenancy receipt's existence check, spelled as it reaches the engine.
    expect(
      await engine.findOne('sys_migration', {
        where: { id: 'seed-tenancy-backfill' },
        context: { isSystem: true },
      }),
    ).toBeNull();

    const pagingWarnings = () => warn.mock.calls.filter(([message]) => PAGING_WARNING.test(String(message)));
    expect(pagingWarnings()).toEqual([]);

    // ── the control: a real unsorted page on the same table still warns.
    const page = await engine.find('sys_migration', { limit: 1 });
    expect(page).toHaveLength(1);
    expect(pagingWarnings()).toHaveLength(1);
  });
});
