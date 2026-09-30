// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20768 — the first and second boot of a new SQLite database print no
 * `sys_migration` `DATABASE_ERROR`, and a real refusal still warns.
 *
 * ## The measured defect
 *
 * `objectstack dev --database file:NEW.sqlite` on `examples/app-crm` printed
 * one line on the FIRST boot of a new database, on the SQL driver's warn
 * channel (stderr), and nothing on the second boot:
 *
 * ```text
 * [sql-driver] DATABASE_ERROR — the backend refused a read on 'sys_migration' (SQLITE_ERROR) ...
 * select * from `sys_migration` where `id` = 'adr-0104-file-references' limit 1 - no such table: sys_migration
 * ```
 *
 * A stack captured at the read named its caller: `ObjectQL.haveFileColumnsMoved`,
 * called by the resolver the engine hands the driver at `registerDriver`, which
 * `SqlDriver.initObjects` asks before its schema pass has created any table.
 * Nothing was wrong. The table did not exist yet, the gate answered "not
 * verified" and "not moved", and that is the right answer for a new store.
 *
 * ## The construction
 *
 * The boot's own chain, without a kernel: a real `ObjectQL` engine and a real
 * `SqlDriver` over a SQLite file that does not exist yet, `sys_migration`
 * registered, and the engine's schema pass (`syncSchemas`), which reaches the
 * same `driver.syncSchema` → `initObjects` → resolver → gate read. The driver's
 * log is captured on every channel, so a line that moved to `debug` is still
 * counted: the fix demotes the line, it does not delete it.
 *
 * The gate answers are asserted on both boots, so the change is to a log level
 * and to nothing a gate decides.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMigration } from '@objectstack/platform-objects/system';
import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';

type Level = 'warn' | 'debug' | 'info' | 'error';
type Line = { level: Level; message: string };

const openDrivers: SqlDriver[] = [];
const tempDirs: string[] = [];

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

/** One boot of the engine over `file`, up to and including the schema pass. */
async function boot(file: string): Promise<{ driver: SqlDriver; engine: ObjectQL; lines: Line[] }> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  openDrivers.push(driver);
  const lines: Line[] = [];
  const sink = (level: Level) => (message: string) => {
    lines.push({ level, message: String(message) });
  };
  (driver as unknown as { logger: Record<Level, (message: string) => void> }).logger = {
    warn: sink('warn'),
    debug: sink('debug'),
    info: sink('info'),
    error: sink('error'),
  };
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registry.registerObject(SysMigration as never, '#20768');
  await engine.syncSchemas();
  return { driver, engine, lines };
}

/** Every captured line on `level` that names `object` as the read's target. */
function linesAbout(lines: Line[], level: Level, object: string): string[] {
  return lines.filter((l) => l.level === level && l.message.includes(`'${object}'`)).map((l) => l.message);
}

function newDatabaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-20768-'));
  tempDirs.push(dir);
  return join(dir, 'new.sqlite');
}

describe('#20768 — the first boot of a new SQLite database reads the migration gate without a DATABASE_ERROR', () => {
  it('first and second boot: no sys_migration DATABASE_ERROR on the warn channel; the gate answers are unchanged', async () => {
    const file = newDatabaseFile();
    expect(existsSync(file)).toBe(false);

    // ── boot 1: the database does not exist when the gate is read.
    const first = await boot(file);
    expect(linesAbout(first.lines, 'warn', 'sys_migration')).toEqual([]);
    expect(first.lines.filter((l) => l.level === 'warn' && l.message.includes('DATABASE_ERROR'))).toEqual([]);
    // Lit: the gate WAS read before the table existed, and the refusal is
    // still on record one level down.
    const demoted = linesAbout(first.lines, 'debug', 'sys_migration');
    expect(demoted).toHaveLength(1);
    expect(demoted[0]).toContain('no such table');
    // The answers, unchanged: not moved (the JSON arm), not verified.
    expect((first.driver as unknown as { mediaColumnIsJson(): boolean }).mediaColumnIsJson()).toBe(true);
    expect(await first.engine.haveFileColumnsMoved()).toBe(false);
    expect(await first.engine.isFileReferencesMigrationVerified()).toBe(false);
    expect(existsSync(file)).toBe(true);

    // The ledger records a verified migration between the boots, so the second
    // boot can only answer "verified" if its gate read reached the row.
    const now = new Date().toISOString();
    await first.driver.create(
      'sys_migration',
      { id: FILE_REFERENCES_MIGRATION_ID, last_run_at: now, verified_at: now, applied_at: now, blocking: 0, advisory: 0 },
      { bypassTenantAudit: true },
    );
    await first.driver.disconnect();

    // ── boot 2: the same file.
    const second = await boot(file);
    expect(second.lines.filter((l) => l.message.includes('DATABASE_ERROR'))).toEqual([]);
    expect(linesAbout(second.lines, 'debug', 'sys_migration')).toEqual([]);
    expect(await second.engine.isFileReferencesMigrationVerified()).toBe(true);
    expect(await second.engine.haveFileColumnsMoved()).toBe(false);
  });

  it('CONTROL a malformed read on an existing table still warns, and so does a missing table read after boot', async () => {
    const { driver, lines } = await boot(newDatabaseFile());
    // Count only what the reads below log. The boot's own lines are the first
    // test's subject, and this control must not move with them.
    lines.length = 0;

    // More bound variables than SQLite takes in one statement, on a table that
    // exists: the backend refuses it, and that is a real refusal.
    const tooMany = Array.from({ length: 40_000 }, (_, i) => `k${i}`);
    const malformed = await driver.find('sys_migration', { where: { id: { $in: tooMany } } }).then(
      () => expect.fail('expected the backend to refuse the statement'),
      (e: { code?: string; status?: number }) => e,
    );
    expect(malformed.code).toBe('DATABASE_ERROR');
    expect(malformed.status).toBe(500);
    const warned = linesAbout(lines, 'warn', 'sys_migration');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('DATABASE_ERROR');

    // A table nobody created, read once the boot is done: still a warn.
    const missing = await driver.find('os20768_never_provisioned', {}).then(
      () => expect.fail('expected the read of a table that was never created to fail'),
      (e: { code?: string; status?: number }) => e,
    );
    expect(missing.code).toBe('DATABASE_ERROR');
    expect(missing.status).toBe(500);
    expect(linesAbout(lines, 'warn', 'os20768_never_provisioned')).toHaveLength(1);
    expect(linesAbout(lines, 'debug', 'os20768_never_provisioned')).toEqual([]);
  });
});
