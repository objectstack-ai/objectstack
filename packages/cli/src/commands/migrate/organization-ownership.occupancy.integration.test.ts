// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership` takes the occupancy gate its sibling
 * migrate commands take, BEFORE either arm boots the stack. Beside a process
 * holding the SQLite file open, `--apply` is refused before the boot, inside
 * the command's own refusal envelope, and the refusal names the stop remedy
 * alone: the ceremony takes no `--force`, so a hint prescribing one would send
 * the operator to a flag the command rejects. The plan writes no row or table,
 * so it warns and runs, as every sibling's read-only arm does, and the warning
 * names what its connect can still change on a SQLite file: the journal mode.
 *
 * The holder is the one `plan.reads-env-files.integration.test.ts` uses: a
 * better-sqlite3 connection on a WAL database, attached and idle, which is
 * what a served runtime leaves open between requests. The probe is the real
 * one. The boot is replaced by a recorder (for the plan, a stack over the same
 * fixture), so "refused before the boot" is read off the recorder.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from '../../utils/format.js';
import { OCCUPANCY_STOP_HINT } from '../../utils/migrate-occupancy-gate.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

// Pay the first transform of the dist-resolved workspace deps the probe and
// the plan reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';

const boot = vi.hoisted(() => vi.fn());
vi.mock('../../utils/schema-migrate.js', async (importOriginal) => ({
  // The probe reads the project's `.env*` files through this module's real
  // `loadProjectEnvFiles`; only the boot is replaced.
  ...(await importOriginal<typeof import('../../utils/schema-migrate.js')>()),
  bootSchemaStack: boot,
}));

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

// The command's module graph is large, and oclif reads the package's config on
// the first run: both are paid outside the case timeout.
beforeAll(async () => {
  ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

let dir: string;
let file: string;
let held: Database.Database | undefined;
let savedCwd: string;

beforeEach(() => {
  savedCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'os-ownership-occupancy-'));
  file = join(dir, 'fixture.db');
  const seed = new Database(file);
  seed.pragma('journal_mode = wal');
  seed.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default');
  `);
  seed.close();
  // The plan file a plan run writes (the fields the apply reads).
  writeFileSync(join(dir, 'reviewed-plan.json'), JSON.stringify({
    kind: 'organization-ownership-plan',
    ceremony: 'ADR-0131 D10',
    generatedAt: '2026-10-14T00:00:00Z',
    database: 'fixture.db',
    inventoryDigest: 'f'.repeat(64),
    posture: 'single',
  }));
  // A project directory with no `.env`, so the probe reads this fixture alone.
  process.chdir(dir);
});

afterEach(() => {
  held?.close();
  held = undefined;
  process.chdir(savedCwd);
  boot.mockReset();
  rmSync(dir, { recursive: true, force: true });
});

/** A server between requests: attached, idle. */
function holdTheFile(): Database.Database {
  held = new Database(file);
  held.prepare('SELECT count(*) FROM sys_organization').get();
  return held;
}

/** A stack over the fixture, as the plan arm's boot hands it back. */
function stackOver(db: Database.Database) {
  return {
    driver: {
      config: { client: 'better-sqlite3' },
      execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params),
    },
    dbLabel: 'fixture.db',
    kernel: { getService: () => undefined },
    tableAbsent: () => false,
    composition: { securityPlugin: { composed: false, reason: 'no-secret' } },
    shutdown: async () => {},
  };
}

/** Run the command with its output captured and its exit trapped. */
async function run(argv: string[]): Promise<{ stdout: string; lines: string; exitCode: number }> {
  const savedExit = process.exitCode;
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
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
      stdout: chunks.join('').trim(),
      lines: log.mock.calls.map((c) => c.map(String).join(' ')).join('\n'),
      exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0,
    };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const applyArgv = (...extra: string[]): string[] => [
  '--apply', '--backup-taken', '--plan-file', join(dir, 'reviewed-plan.json'),
  '--out', join(dir, 'apply.json'), '--database-url', `file:${file}`, ...extra,
];

describe('os migrate organization-ownership --apply — the occupancy gate', () => {
  it('beside a holder: refused before the boot, in the command\'s envelope, naming the stop remedy alone', async () => {
    holdTheFile();
    const { stdout, exitCode } = await run(applyArgv('--json'));
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'database-busy', database: file, hint: OCCUPANCY_STOP_HINT });
    expect(typeof payload.signal).toBe('string');
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
    // The ceremony has no override, so the remedy it names must not prescribe one.
    expect(MigrateOrganizationOwnership.flags).not.toHaveProperty('force');
    expect(payload.hint).not.toContain('--force');
  }, CASE_TIMEOUT_MS);

  it('beside a holder, human face: exit 1 before the boot, naming the file and the stop remedy', async () => {
    holdTheFile();
    const { lines, exitCode } = await run(applyArgv());
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
    expect(lines).toContain(file);
    expect(lines).toContain(OCCUPANCY_STOP_HINT);
  }, CASE_TIMEOUT_MS);

  it('control: with nothing holding the file, --apply passes the gate and reaches the boot', async () => {
    boot.mockImplementationOnce(async () => {
      throw new Error('the database was opened');
    });
    const { stdout } = await run(applyArgv('--json'));
    expect(JSON.parse(stdout)).toMatchObject({ error: 'boot_failed', reason: 'boot-failed' });
    expect(boot).toHaveBeenCalledTimes(1);
  }, CASE_TIMEOUT_MS);
});

describe('os migrate organization-ownership (plan) — the occupancy gate', () => {
  it('beside a holder: warns, naming the file, and writes the plan', async () => {
    const db = holdTheFile();
    boot.mockImplementationOnce(async () => stackOver(db));
    const out = join(dir, 'plan.json');
    const { lines, exitCode } = await run(['--out', out, '--database-url', `file:${file}`]);
    expect(exitCode).toBe(0);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(lines).toContain(file);
    expect(existsSync(out)).toBe(true);
    // The warning claims no row or table, and names the journal-mode switch the
    // boot's connect can still make; it never says the plan writes nothing.
    const warning = lines.split('\n').find((line) => line.includes(`${file} is in use`));
    expect(warning, lines).toBeDefined();
    expect(warning).toContain('The plan below writes no row or table');
    expect(warning).toContain(JOURNAL_MODE_SWITCH_NOTE);
    expect(lines).not.toContain('writes nothing');
  }, CASE_TIMEOUT_MS);

  it('beside a holder, --json: the plan document is unchanged — no warning, no occupancy field', async () => {
    const db = holdTheFile();
    boot.mockImplementationOnce(async () => stackOver(db));
    const out = join(dir, 'plan.json');
    const { stdout, exitCode } = await run(['--out', out, '--database-url', `file:${file}`, '--json']);
    expect(exitCode).toBe(0);
    expect(Object.keys(JSON.parse(stdout) as Record<string, unknown>).sort()).toEqual(['file', 'plan']);
  }, CASE_TIMEOUT_MS);
});
