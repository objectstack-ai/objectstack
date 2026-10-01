// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20821] `os migrate plan` against a database that does not exist yet prints
 * no `DATABASE_ERROR` for the tables whose DDL it deferred.
 *
 * ## The measured defect
 *
 * The plan boots with the SQL driver's DDL deferred, so every table is listed
 * as `create_table` and none is created. The same boot then reads the tables
 * it just listed: `sys_metadata` four times (the overlay restore, the authored
 * translation, hook and action re-syncs), `sys_metadata_activation` once (the
 * packaged-action ledger probe) and `sys_migration` once (the ADR-0104 gate
 * announcement). Every reader already answered from the refusal; the driver
 * still printed a `[sql-driver] DATABASE_ERROR` line on stderr for each, six
 * alarms on a dry run where nothing was wrong. This fixture reproduced exactly
 * those six on the base.
 *
 * ## What is pinned, and what is deliberately not
 *
 *  - Zero `DATABASE_ERROR` lines naming those three tables, in human mode and
 *    under `--json`, on an absent file.
 *  - The reads really happened and were really refused, so the zero is not a
 *    boot that skipped them: the open value-shape gate is still announced (the
 *    `sys_migration` read answered "not verified"), and the activation ledger
 *    still reports itself unreadable (that stdout warning is kept on purpose;
 *    it is the reader's own functional line, not the driver's).
 *  - The plan's own answer: the three tables are still pending `create_table`,
 *    and nothing is written to disk.
 *
 * ⛔ Only those three tables are counted. A host hook that reads a table the
 * plan's composition never declares is a different door with its own card;
 * its lines are not this pin's to forbid, and not its to excuse either.
 *
 * The driver-side conditions (deferred, in the driver's own deferred set, the
 * shared missing-table predicate) and their controls are pinned in
 * `@objectstack/driver-sql` (`sql-driver-20821-deferred-ddl-missing-table.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The source entry (tsx), as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

/**
 * This process's environment for the child, minus the two families
 * `test/helpers/serve-process.ts` `childEnv()` strips (its header says why):
 * the vitest runner's own variables, and `NODE_PATH`, which moves the child's
 * module resolution base. An `undefined` override unsets a variable.
 */
function childEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

/** The tables whose DDL the plan defers and whose boot readers it still runs. */
const DEFERRED_READ_TABLES = ['sys_metadata', 'sys_metadata_activation', 'sys_migration'] as const;

const RUN_BUDGET_MS = 90_000;

interface PlanRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

let dir: string;
let dbFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-20821-'));
  dbFile = join(dir, 'absent.sqlite');
  // A lookup field makes the value-shape gate applicable, so the boot reads
  // `sys_migration` exactly as a real app's boot does.
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os20821', name: 'Deferred reads', version: '0.0.0', type: 'app' },",
      '  objects: [',
      "    { name: 'os20821_account', fields: { name: { type: 'text' } } },",
      "    { name: 'os20821_contact', fields: { name: { type: 'text' }, account: { type: 'lookup', reference: 'os20821_account' } } },",
      '  ],',
      '};',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runPlan(extra: string[]): Promise<PlanRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI, 'migrate', 'plan', ...extra, '--database-url', `file:${dbFile}`],
      {
        cwd: dir,
        env: childEnv({
          // No compiled artifact: the host config is the deployment.
          OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
          OS_DATABASE_URL: undefined,
          DATABASE_URL: undefined,
          TURSO_DATABASE_URL: undefined,
          OS_DATABASE_DRIVER: undefined,
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`os migrate plan did not finish within ${RUN_BUDGET_MS}ms\n${stderr}`));
    }, RUN_BUDGET_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Every driver `DATABASE_ERROR` line, on either stream, that names one of the three tables. */
function deferredTableDatabaseErrors(run: PlanRun): string[] {
  return `${run.stdout}\n${run.stderr}`
    .split('\n')
    .filter((line) => line.includes('DATABASE_ERROR'))
    .filter((line) => DEFERRED_READ_TABLES.some((t) => line.includes(`'${t}'`)));
}

describe('[#20821] os migrate plan on an absent database: no DATABASE_ERROR for the tables it deferred', () => {
  it('human mode: zero lines for the three tables, the reads still answered, the plan unchanged', async () => {
    expect(existsSync(dbFile)).toBe(false);

    const run = await runPlan([]);

    expect(run.code, run.stderr).toBe(0);
    expect(deferredTableDatabaseErrors(run)).toEqual([]);

    // The reads happened and were refused: the readers' own answers are here.
    const lines = run.stdout.split('\n');
    expect(lines.some((l) => l.includes('[value-shape]') && l.includes('NOT enforced'))).toBe(true);
    expect(lines.some((l) => l.includes('WARN') && l.includes('sys_metadata_activation'))).toBe(true);

    // The plan's own answer: each of the three is still pending creation.
    for (const table of DEFERRED_READ_TABLES) {
      expect(lines.some((l) => l.includes(`+ ${table} [create_table`))).toBe(true);
    }
    expect(existsSync(dbFile)).toBe(false);
  }, 120_000);

  it('--json: zero lines for the three tables, and the payload still lists them as pending creates', async () => {
    const run = await runPlan(['--json']);

    expect(run.code, run.stderr).toBe(0);
    expect(deferredTableDatabaseErrors(run)).toEqual([]);

    const payload = JSON.parse(run.stdout) as {
      total: number;
      changes: unknown[];
      pending: Array<{ table: string; kind: string }>;
    };
    expect(payload.total).toBe(0);
    expect(payload.changes).toEqual([]);
    for (const table of DEFERRED_READ_TABLES) {
      expect(payload.pending.filter((p) => p.table === table).map((p) => p.kind)).toEqual(['create_table']);
    }
    expect(existsSync(dbFile)).toBe(false);
  }, 120_000);
});
