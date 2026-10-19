// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership` (the plan) against a real SQLite file
 * still on a rollback journal, through the real read-only boot: what the plan
 * arm says about the database stays true for that file.
 *
 * The boot is read-only (no DDL, no seed, SELECT statements only), but the SQL
 * driver's connect switches a file still on a rollback journal to WAL — its
 * rule for every connect, read-only boots included — which rewrites the file
 * header and no row. So the arm says that no row or table was changed and names
 * the journal-mode switch (`JOURNAL_MODE_SWITCH_NOTE`); it never says that
 * nothing in the database was changed.
 *
 * The header is read before and after, so the case cannot pass over a file
 * that was never switched. If a read-only boot ever stops switching it, the
 * header assertion goes red: the note is then no longer needed, and this pin
 * goes with it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from '../../utils/format.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

// Pay the first transform of the dist-resolved workspace deps the boot and the
// plan reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

// The command's module graph is large, and oclif reads the package's config on
// the first run: both are paid outside the case timeout.
beforeAll(async () => {
  ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The driver's journal-mode opt-out: unset, so the driver asks for its default, WAL. */
const JOURNAL_MODE_ENV = 'OS_DATABASE_SQLITE_JOURNAL_MODE';

let dir: string;
let file: string;
let savedCwd: string;
let savedJournalMode: string | undefined;

beforeEach(() => {
  savedCwd = process.cwd();
  savedJournalMode = process.env[JOURNAL_MODE_ENV];
  delete process.env[JOURNAL_MODE_ENV];
  dir = mkdtempSync(join(tmpdir(), 'os-ownership-journal-mode-'));
  file = join(dir, 'fixture.db');
  const seed = new Database(file);
  seed.pragma('journal_mode = delete');
  seed.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default');
  `);
  seed.close();
  // A project directory with no config and no `.env`: the boot reads the fixture alone.
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(savedCwd);
  if (savedJournalMode === undefined) delete process.env[JOURNAL_MODE_ENV];
  else process.env[JOURNAL_MODE_ENV] = savedJournalMode;
  rmSync(dir, { recursive: true, force: true });
});

/** The file format's read and write version bytes: 1 and 1 on a rollback journal, 2 and 2 in WAL. */
function journalBytes(): [number, number] {
  const header = readFileSync(file).subarray(0, 100);
  return [header[18], header[19]];
}

function rows(): unknown {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT * FROM sys_organization ORDER BY id').all();
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
      await MigrateOrganizationOwnership.run(argv, { root: CLI_ROOT });
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

describe('os migrate organization-ownership (plan) on a SQLite file still on a rollback journal', () => {
  it('the boot switches the header to WAL and no row; the plan says no row or table changed and names the switch', async () => {
    expect(journalBytes(), 'the fixture is not on a rollback journal: nothing here could be switched').toEqual([1, 1]);
    const before = rows();
    const out = join(dir, 'plan.json');

    const { lines, exitCode } = await run(['--out', out, '--database-url', `file:${file}`]);

    expect(exitCode, lines).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(journalBytes()).toEqual([2, 2]);
    expect(rows()).toEqual(before);
    const success = lines.split('\n').find((line) => line.includes(`Plan written to ${out}`));
    expect(success, lines).toBeDefined();
    expect(success).toContain('no row or table in the database was changed.');
    expect(success).toContain(JOURNAL_MODE_SWITCH_NOTE);
    expect(lines).not.toContain('nothing in the database was changed');
  }, CASE_TIMEOUT_MS);
});
