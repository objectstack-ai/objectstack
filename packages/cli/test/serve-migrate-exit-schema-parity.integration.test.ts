// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22202] A `--no-server` migrate-and-exit run provisions the SAME table set
 * as the same config's server boot.
 *
 * ## The defect
 *
 * `OS_MIGRATE_AND_EXIT=1` runs the whole kernel bootstrap — schema sync
 * included — and exits, so a deploy pipeline can provision the database and
 * then serve with schema sync off. Schema sync creates tables only for the
 * objects registered in THAT boot. `RestApiPlugin.init()` registers
 * `sys_import_job`, and `serve` used to compose the REST plugin only under
 * `--server`, so the documented "kernel only" migration (`--no-server`) never
 * created the import-job table the server boot then reads and writes. Measured
 * on `examples/app-todo` at `fbcbcf12`: 69 tables against 70, `sys_import_job`
 * the only difference.
 *
 * ## Why this spawns the real command, twice
 *
 * The question is about which plugins `serve` COMPOSES for a flag, and the
 * answer only exists in the composed process: an in-process kernel built by a
 * test composes whatever the test says. So this boots `os serve` on ONE config,
 * twice, each against its own fresh SQLite file, with `OS_MIGRATE_AND_EXIT=1`
 * in both and `--no-server` the only difference, and compares the table sets
 * the two runs left on disk.
 *
 * ## Why not `runServe()`
 *
 * The shared helper resolves on a banner match and SIGTERMs the child at that
 * moment, and it does not report the exit code. A migrate-and-exit run is
 * judged by exiting 0 on its own after `kernel.shutdown()`, and a kill landing
 * inside that shutdown could leave the SQLite file mid-close. So this file
 * spawns the same entry (`CLI` + `TSX`) with the same `childEnv()` and waits
 * for the exit, as `artifact-pinned-boot.e2e.test.ts` does for the same reason.
 *
 * ## The controls
 *
 * - Each run must exit 0 AND print the migrate path's completion line, so an
 *   equality between two runs that never reached schema sync cannot pass.
 * - The server boot's set must contain the fixture's own object table (the
 *   config really loaded) and `sys_import_job` (the object this card is about,
 *   so the equality below is not vacuous about it).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { CLI, E2E_SECRET_KEY, TSX, childEnv, randomPort } from './helpers/serve-process.js';

/** The fixture app's own object; its table proves the config was loaded. */
const FIXTURE_OBJECT = 'parity_task';

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.parity',
    namespace: 'parity',
    version: '1.0.0',
    type: 'app',
    name: 'Migrate-and-exit parity probe',
  },
  objects: [{
    name: '${FIXTURE_OBJECT}',
    label: 'Task',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

interface MigrateRun {
  code: number | null;
  output: string;
  tables: string[];
}

let root: string;
let fixtureDir: string;
let server: MigrateRun;
let noServer: MigrateRun;

/** One `os serve … OS_MIGRATE_AND_EXIT=1` run on a fresh SQLite file; the table names it left behind. */
function migrateAndExit(label: string, extraArgs: string[]): Promise<MigrateRun> {
  const runDir = join(root, label);
  const home = join(runDir, 'home');
  mkdirSync(home, { recursive: true });
  const dbFile = join(runDir, 'db.sqlite');

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      TSX,
      [CLI, 'serve', 'objectstack.config.ts', '--port', randomPort(), ...extraArgs],
      {
        cwd: fixtureDir,
        env: childEnv({
          NO_COLOR: '1',
          OS_HOME: home,
          OS_DATABASE_URL: `file:${dbFile}`,
          OS_LOG_LEVEL: '',
          OS_DISABLE_CONSOLE: '1',
          OS_SECRET_KEY: E2E_SECRET_KEY,
          OS_MIGRATE_AND_EXIT: '1',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      let tables: string[] = [];
      try {
        const db = new Database(dbFile, { readonly: true, fileMustExist: true });
        try {
          tables = (
            db
              .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
              .all() as Array<{ name: string }>
          ).map((row) => row.name);
        } finally {
          db.close();
        }
      } catch (err) {
        rejectRun(new Error(`${label}: could not read ${dbFile} (exit ${code}): ${String(err)}\n${output}`));
        return;
      }
      resolveRun({ code, output, tables });
    });
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-22202-parity-'));
  fixtureDir = join(root, 'app');
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, 'objectstack.config.ts'), CONFIG, 'utf8');
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'os-22202-parity-fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  // Sequential on purpose: two concurrent boots would double this file's peak
  // load on a shared runner for no change in what is measured.
  server = await migrateAndExit('server', []);
  noServer = await migrateAndExit('no-server', ['--no-server']);
}, 360_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#22202] serve --no-server with OS_MIGRATE_AND_EXIT=1 provisions the server boot\'s schema', () => {
  it('both runs reach the migrate path\'s end and exit 0 (control)', () => {
    expect(server.output).toContain('Migration complete');
    expect(server.code).toBe(0);
    expect(noServer.output).toContain('Migration complete');
    expect(noServer.code).toBe(0);
  });

  it('the server boot\'s set holds the fixture\'s table and sys_import_job (control)', () => {
    expect(server.tables).toContain(FIXTURE_OBJECT);
    expect(server.tables).toContain('sys_import_job');
  });

  it('the --no-server run creates exactly the server boot\'s table set', () => {
    expect(noServer.tables).toEqual(server.tables);
  });
});
