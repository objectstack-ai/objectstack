// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os secret orphans` (the report) against a real SQLite file still on a
 * rollback journal, through the real read-only boot: what the report says
 * about the database stays true for that file.
 *
 * The boot is read-only (no DDL, no seed, reads only), but the SQL driver's
 * connect switches a file still on a rollback journal to WAL — its rule for
 * every connect, read-only boots included — which rewrites the file header and
 * no row. So the report says that no row or table was written or deleted and
 * names the journal-mode switch (`JOURNAL_MODE_SWITCH_NOTE`); it never says
 * that nothing was written.
 *
 * One command stands for the family here because the family shares the
 * mechanism and the test: `os migrate security-catalog-overlays`, `recorded-by`
 * and `resume`, `os secret orphans` and `rewrap` and `os storage orphans` all
 * boot through `bootSchemaStack` onto the same `SqlDriver` connect, and the
 * four that print on any dialect ask the same question of the booted primary
 * (`describeDriverSqliteFile(stack.driver?.config)`). This case is where that
 * question meets a real driver's config; each command's own sentence is pinned
 * beside it against a replaced boot.
 *
 * The header is read before and after, so the case cannot pass over a file
 * that was never switched. If a read-only boot ever stops switching it, the
 * header assertion goes red: the note is then no longer needed, and this pin
 * goes with it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Config } from '@oclif/core';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from '../../utils/format.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

// Pay the first transform of the dist-resolved workspace deps the boot and the
// report reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/service-settings';
import '@objectstack/platform-objects/plugin';

type Command = (typeof import('./orphans.js'))['default'];
let SecretOrphans: Command;
let oclifConfig: Config;

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// The command's module graph is large, and oclif reads the package's config
// (its whole command table) on a first run: both are paid here, outside the
// case, which then clocks the boot and the report alone.
beforeAll(async () => {
  ({ default: SecretOrphans } = await import('./orphans.js'));
  oclifConfig = await Config.load({ root: CLI_ROOT });
}, 60_000);

/**
 * Env that would point the boot elsewhere, ask the driver for another journal
 * mode, or hand the settings service a key from this runner's own key home.
 * `OS_HOME` is pointed at the case directory instead: an empty key home.
 */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_DATABASE_SQLITE_JOURNAL_MODE',
  'OS_SECRET_KEY', 'OS_DEV_CRYPTO_KEY', 'OBJECTSTACK_DEV_CRYPTO_KEY', 'OS_HOME', 'OBJECTSTACK_HOME', 'OS_CRYPTO_AUTOKEY',
] as const;

let dir: string;
let file: string;
let savedCwd: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedCwd = process.cwd();
  for (const key of OVERRIDING_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'os-secret-orphans-journal-mode-'));
  process.env.OS_HOME = dir;
  file = join(dir, 'fixture.db');
  const seed = new Database(file);
  seed.pragma('journal_mode = delete');
  seed.exec(`
    CREATE TABLE fixture_note (id TEXT PRIMARY KEY, body TEXT);
    INSERT INTO fixture_note VALUES ('n1', 'kept');
  `);
  seed.close();
  // A project directory with no config and no `.env`: the boot reads the fixture alone.
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const key of OVERRIDING_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

/** The file format's read and write version bytes: 1 and 1 on a rollback journal, 2 and 2 in WAL. */
function journalBytes(): [number, number] {
  const header = readFileSync(file).subarray(0, 100);
  return [header[18], header[19]];
}

/** The schema and every row, read on a connection of our own. */
function state(): unknown {
  const db = new Database(file, { readonly: true });
  try {
    return {
      schema: db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(),
      rows: db.prepare('SELECT * FROM fixture_note ORDER BY id').all(),
    };
  } finally {
    db.close();
  }
}

/** Run the command with its output captured and its exit trapped. */
async function run(argv: string[]): Promise<{ lines: string; exitCode: number }> {
  const savedExit = process.exitCode;
  vi.spyOn(process.stdout, 'write').mockImplementation(((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let thrownExit: number | undefined;
  try {
    try {
      await SecretOrphans.run(argv, oclifConfig);
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    return {
      lines: log.mock.calls.map((c) => c.map(String).join(' ')).join('\n'),
      exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0,
    };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

describe('os secret orphans (report) on a SQLite file still on a rollback journal', () => {
  it('the boot switches the header to WAL and no row; the report says no row or table and names the switch', async () => {
    expect(journalBytes(), 'the fixture is not on a rollback journal: nothing here could be switched').toEqual([1, 1]);
    const before = state();

    const { lines, exitCode } = await run(['--no-declared-datasources', '--database-url', `file:${file}`]);

    expect(exitCode, lines).toBe(0);
    expect(journalBytes()).toEqual([2, 2]);
    expect(state()).toEqual(before);
    const closing = lines.split('\n').find((line) => line.includes('Report only'));
    expect(closing, lines).toBeDefined();
    expect(closing).toContain(`Report only — no row or table was written or deleted. ${JOURNAL_MODE_SWITCH_NOTE}`);
    expect(lines).not.toContain('nothing was written');
  }, CASE_TIMEOUT_MS);
});
