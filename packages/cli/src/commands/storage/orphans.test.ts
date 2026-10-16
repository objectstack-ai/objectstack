// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os storage orphans` — what its help and its report say the inventory writes.
 *
 * The inventory boots read-only (deferred DDL, no seed, no file brought into
 * existence), but the boot's connect can switch a SQLite file's journal mode,
 * which rewrites the file's header and no row (measured on a rollback-journal
 * file: header bytes 18 and 19 from 1,1 to 2,2, the change counter up by one,
 * schema and rows byte-identical). So the help and the report claim no row or
 * table, never that the command writes nothing. The help names no target, so
 * it carries no SQLite note; the report's READ-ONLY line carries it on a
 * SQLite target, and only there.
 *
 * The report case replaces only the boot. The inventory and its formatter
 * (`@objectstack/service-storage`) run for real over an engine with no files.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import StorageOrphans from './orphans.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

const SQLITE_CONFIG = { client: 'better-sqlite3', connection: { filename: '/srv/app/.objectstack/data/objectstack.db' } };
const POSTGRES_CONFIG = { client: 'pg', connection: 'postgres://db.example.com:5432/app' };
const READ_ONLY_LINE = 'This pass is READ-ONLY: no row or table was written, tombstoned or deleted.';

/** Wire the mocked boot to an engine that registers both objects and stores no file. */
function wireBoot(driverConfig: Record<string, unknown>): void {
  const engine = {
    getObject: (name: string) => (name === 'sys_file' || name === 'sys_attachment' ? { name } : undefined),
    find: async () => [],
  };
  vi.mocked(bootSchemaStack).mockResolvedValue({
    // The primary datasource's driver, as `SchemaStack.driver` carries it.
    driver: { config: driverConfig },
    dbLabel: 'test database',
    kernel: { getService: (name: string) => (name === 'objectql' ? engine : undefined) },
    tableAbsent: () => false,
    shutdown: async () => {},
  } as never);
}

/** One human-mode run; every line `console.log` received. */
async function runHuman(): Promise<string[]> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const savedExitCode = process.exitCode;
  try {
    await StorageOrphans.run([], { root: CLI_ROOT });
    return log.mock.calls.map((c) => c.map(String).join(' ')).join('\n').split('\n');
  } finally {
    process.exitCode = savedExitCode;
    log.mockRestore();
  }
}

afterEach(() => {
  vi.mocked(bootSchemaStack).mockReset();
});

describe('os storage orphans --help', () => {
  it('says the inventory writes no row or table, tombstones nothing and deletes nothing', () => {
    expect(StorageOrphans.description).toContain('Writes no row or table, tombstones nothing, deletes nothing.');
    expect(StorageOrphans.description).not.toContain('Writes nothing');
  });
});

describe('os storage orphans — the report names no write it cannot vouch for', () => {
  it('on a SQLite file the READ-ONLY line claims no row or table and names the journal-mode switch', async () => {
    wireBoot(SQLITE_CONFIG);
    const lines = await runHuman();
    const readOnly = lines.find((line) => line.includes('READ-ONLY'));
    expect(readOnly, lines.join('\n')).toBe(`${READ_ONLY_LINE} ${JOURNAL_MODE_SWITCH_NOTE}`);
    expect(lines.join('\n')).not.toContain('nothing was written');
  }, RUN_TIMEOUT);

  it('on a target with no file header (PostgreSQL) the READ-ONLY line claims no row or table and names no switch', async () => {
    wireBoot(POSTGRES_CONFIG);
    const lines = await runHuman();
    const readOnly = lines.find((line) => line.includes('READ-ONLY'));
    expect(readOnly, lines.join('\n')).toBe(READ_ONLY_LINE);
    expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
  }, RUN_TIMEOUT);
});
