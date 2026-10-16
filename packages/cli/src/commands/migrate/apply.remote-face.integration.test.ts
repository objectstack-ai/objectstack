// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23848 — `os migrate plan` and `os migrate apply` (its plan arm and its
 * `--allow-destructive` arm) run on a Turso REMOTE database: a real `sqld`
 * reached as `libsql://127.0.0.1:<port>?tls=0`, the transport every hosted
 * tenant uses. The apply applies the destructive entries that transport can
 * express and names, by table, column and kind, the ones it cannot.
 *
 * ## What used to happen
 *
 * Both commands booted with deferred schema DDL armed, and the remote face
 * refuses that (`Deferred schema DDL is not supported by the Turso REMOTE
 * transport`), so each exited 1 at its boot. The drift report and the
 * artifact-pinned boot gate name `os migrate apply --allow-destructive` as the
 * remedy for destructive drift; on this transport it could not run at all.
 *
 * ## The case
 *
 * One fixture, built twice — on the server and, as the control, on a local
 * SQLite file. A declared object's table is created by hand first, carrying
 * three kinds of drift against its declaration:
 *
 *  - `legacy_23848`, a column nothing declares: a `drop_column` (destructive),
 *    which the remote face can express (`ALTER TABLE … DROP COLUMN`);
 *  - `code`, nullable, under a field declaring `storage: { notNull: true }`: a
 *    `tighten_not_null` (destructive), which needs the SQLite table rebuild;
 *  - `memo`, NOT NULL, under a field declaring no constraint: a
 *    `relax_not_null` (needs confirm), which needs the rebuild too.
 *
 * The table is made by hand so the drift does not depend on what the remote
 * schema sync creates. Then the environment's own syncing boot, then the real
 * commands, and every claim about the server is read back through a SECOND
 * libSQL connection.
 *
 * [#23925] The human plan says the same thing up front, read from the driver's
 * declaration (`TursoDriver.driftApplyLimit`): the tightening and the relax
 * are listed with the transport's limit instead of a remedy it cannot run, and
 * the drop keeps `--allow-destructive`. So does the apply's own listing before
 * its prompt, whose held-back count offers a re-run only for the drop. The
 * local file is the control: its plan and its apply read as they always have.
 *
 * ## How to run it
 *
 * It needs a `sqld` binary (libsql-server), so the remote cases are skipped
 * unless `OS_TEST_SQLD_BIN` names one, as in
 * `organization-ownership.remote-face.integration.test.ts` (whose header says
 * how to get one). CI has no `sqld`: there the remote cases skip, and the
 * posture and the verdict are pinned without a database by
 * `apply.remote-posture.test.ts`.
 *
 *     OS_TEST_SQLD_BIN=/path/to/sqld pnpm --filter @objectstack/cli exec \
 *       vitest run --project integration src/commands/migrate/apply.remote-face.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { TursoDriver } from '@objectstack/driver-turso';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { isExitSignal } from '../../utils/format.js';
import { isStdoutReserved } from '../../utils/json-stdout.js';
import MigrateApply from './apply.js';
import MigratePlan from './plan.js';

// Paid at module load, not inside a clocked case (`check:test-source-alias`).
import '@objectstack/runtime';
import '@objectstack/objectql';

const SQLD = process.env.OS_TEST_SQLD_BIN;
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;

/** Env that would point a boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'OS_DATABASE_AUTH_TOKEN',
  'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH', 'OS_TELEMETRY_DB', 'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED', 'OS_SKIP_SCHEMA_SYNC', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET',
] as const;

const TABLE = 'os23848_note';

/** The declared object: `code` declares the physical constraint, `memo` declares none. */
const HOST_CONFIG = [
  'export default {',
  "  manifest: { id: 'com.example.os23848', name: 'os23848', version: '0.0.0', type: 'app' },",
  `  objects: [{ name: '${TABLE}', fields: {`,
  "    title: { type: 'text' },",
  "    code: { type: 'text', storage: { notNull: true } },",
  "    memo: { type: 'text' },",
  '  } }],',
  '};',
  '',
].join('\n');

/** The hand-made table and its row: the three drifts the header names. */
const SEED_SQL = [
  `CREATE TABLE "${TABLE}" ("id" TEXT PRIMARY KEY, "title" TEXT, "code" TEXT, "memo" TEXT NOT NULL, "legacy_23848" TEXT)`,
  `INSERT INTO "${TABLE}" ("id", "title", "code", "memo", "legacy_23848") VALUES ('n1', 'a', 'c1', 'm1', 'x')`,
];

type Rows = Array<Record<string, unknown>>;
type Exec = (sql: string, args?: unknown[]) => Promise<Rows>;

let dir: string;
let projectDir: string;
let server: ChildProcess | undefined;
let url: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

const freePort = (): Promise<number> =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

/**
 * A second connection to the server, separate from every driver the commands
 * boot: a remote-mode driver of its own, so its own libSQL client.
 */
async function remote<T>(read: (exec: Exec) => Promise<T>): Promise<T> {
  const driver = new TursoDriver({ url });
  await driver.connect();
  try {
    return await read(async (sql, args = []) => (await driver.execute(sql, args)) as Rows);
  } finally {
    await driver.disconnect();
  }
}

/** The same reads on a local SQLite file, through a connection of their own. */
async function local<T>(file: string, read: (exec: Exec) => Promise<T>): Promise<T> {
  const db = new Database(file);
  try {
    return await read(async (sql, args = []) => {
      const statement = db.prepare(sql);
      if (statement.reader) return statement.all(...(args as unknown[])) as Rows;
      statement.run(...(args as unknown[]));
      return [];
    });
  } finally {
    db.close();
  }
}

/** Every catalog row and every table's rows, hashed: equal means nothing moved. */
const logicalDump = () =>
  remote(async (exec) => {
    const hash = createHash('sha256');
    const master = await exec('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name');
    hash.update(JSON.stringify(master));
    for (const t of master.filter((r) => r.type === 'table' && !String(r.name).startsWith('sqlite_'))) {
      hash.update(String(t.name));
      hash.update(JSON.stringify(await exec(`SELECT * FROM "${String(t.name)}" ORDER BY rowid`)));
    }
    return hash.digest('hex');
  });

/** The fixture table's columns as the database holds them: name → NOT NULL. */
const columnsOf = (exec: Exec) =>
  exec(`SELECT name, "notnull" AS nn FROM pragma_table_info('${TABLE}') ORDER BY cid`).then((rows) =>
    Object.fromEntries(rows.map((r) => [String(r.name), Number(r.nn) === 1])));

/** Seed the hand-made table, then the environment's own syncing boot over it. */
async function buildFixture(databaseUrl: string, exec: (run: (exec: Exec) => Promise<void>) => Promise<void>): Promise<void> {
  await exec(async (e) => { for (const sql of SEED_SQL) await e(sql); });
  const stack = await bootSchemaStack({
    jsonOutput: false,
    databaseUrl,
    projectRoot: projectDir,
    composeHostStack: true,
    composeServedPlatform: true,
  });
  await stack.shutdown();
}

/** The real command, with its output captured: the JSON document, or the human lines. */
async function run(
  command: typeof MigrateApply | typeof MigratePlan,
  args: string[],
): Promise<{ payload: any; lines: string; exitCode: number }> {
  // A `--json` boot that FAILED keeps stdout reserved for the document it never
  // wrote, and nothing in this process lifts it: every later case's document
  // would go unread. Say so, rather than fail on a missing key.
  expect(isStdoutReserved(), 'an earlier case\'s --json boot failed and left stdout reserved: this case cannot read its output').toBe(false);
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  const said: string[] = [];
  const capture = (...parts: unknown[]) => { said.push(parts.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  process.chdir(projectDir);
  let thrownExit: number | undefined;
  try {
    try {
      await (command === MigrateApply ? MigrateApply.run(args, { root: CLI_ROOT }) : MigratePlan.run(args, { root: CLI_ROOT }));
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any = null;
    if (args.includes('--json')) {
      try { payload = JSON.parse(out); } catch { payload = { unparsed: out.slice(-600) }; }
    }
    return {
      payload,
      lines: said.join('\n'),
      exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0,
    };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

/** `table.column op` for each entry, sorted: the comparison every case reads. */
const kinds = (entries: Array<{ table: string; column?: string; op: { type: string } }> | undefined) =>
  (entries ?? []).filter((e) => e.table === TABLE).map((e) => `${e.table}.${e.column} ${e.op.type}`).sort();

const DROP = `${TABLE}.legacy_23848 drop_column`;
const TIGHTEN = `${TABLE}.code tighten_not_null`;
const RELAX = `${TABLE}.memo relax_not_null`;

/**
 * [#23925] The line the human plan prints under an entry's `[op]` heading on
 * the fixture table: the entry's finding and its remedy.
 */
function planEntryLine(lines: string, op: string): string {
  const all = lines.split('\n');
  const at = all.findIndex((l) => l.includes(`${TABLE}.`) && l.includes(`[${op}]`));
  expect(at, `no ${TABLE} [${op}] entry in:\n${lines.slice(-3000)}`).toBeGreaterThanOrEqual(0);
  return all[at + 1]!;
}

/** [#23925] The plan's closing lines: what to apply with, and what this database cannot apply. */
const planFooter = (lines: string) =>
  lines.split('\n').filter((l) => /Apply with:|cannot be applied on this database/.test(l)).join('\n');

/** [#23925] The apply's held-back lines before its prompt: what a re-run would apply, and what it would not. */
const heldBackLines = (lines: string) =>
  lines.split('\n').filter((l) => /will be SKIPPED|re-run with --allow-destructive cannot/.test(l));

beforeAll(() => {
  for (const key of OVERRIDING_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'os-23848-apply-remote-'));
  projectDir = join(dir, 'project');
  mkdirSync(join(projectDir, 'dist'), { recursive: true });
  writeFileSync(join(projectDir, 'objectstack.config.ts'), HOST_CONFIG);
  process.env.OS_ARTIFACT_PATH = join(projectDir, 'dist', 'objectstack.json'); // deliberately absent
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
});

afterAll(() => {
  server?.kill();
  for (const key of OVERRIDING_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// The control runs FIRST, on purpose: a `--json` boot that FAILS keeps stdout
// reserved for the document it never wrote (`bootSchemaStack`'s `jsonOutput`),
// which is right for a one-command process and, in this one, would swallow the
// control's document whenever a remote case before it failed at its boot (the
// positive control and the ablation are exactly such runs).
describe('CONTROL: the same apply on a local SQLite file applies all three, as it always has', () => {
  // [#23925] The local face declares no limit, so its plan reads as it always
  // has: the tightening keeps the differ's remedy, and the footer offers
  // --allow-destructive for drops and tightenings.
  it('plan on a file, human face: the tightening keeps "--allow-destructive", the footer is unchanged', async () => {
    const file = join(dir, 'local-plan.db');
    await buildFixture(`file:${file}`, (seed) => local(file, seed));

    const plan = await run(MigratePlan, ['--database-url', `file:${file}`]);
    expect(plan.exitCode, plan.lines.slice(-1500)).toBe(0);
    expect(planEntryLine(plan.lines, 'tighten_not_null')).toContain(
      `${TABLE}.code: metadata declares \`storage.notNull\` but the column is nullable — existing nulls must be backfilled. `
      + 'Run "os migrate apply --allow-destructive".',
    );
    expect(planEntryLine(plan.lines, 'drop_column')).toContain('"os migrate apply --allow-destructive" to drop it.');
    expect(plan.lines).not.toContain('cannot apply it on this database');
    expect(planFooter(plan.lines)).toBe('  Apply with: os migrate apply (add --allow-destructive for drops / tightenings)');
  }, CASE_TIMEOUT_MS);

  // [#23925] …and so does its apply's listing before the prompt.
  it('apply --yes on a file, human face: the tightening keeps "--allow-destructive", both destructive entries are offered a re-run', async () => {
    const file = join(dir, 'local-apply.db');
    await buildFixture(`file:${file}`, (seed) => local(file, seed));

    const apply = await run(MigrateApply, ['--database-url', `file:${file}`, '--yes']);
    expect(apply.exitCode, apply.lines.slice(-1500)).toBe(0);
    expect(planEntryLine(apply.lines, 'tighten_not_null')).toContain(
      `${TABLE}.code: metadata declares \`storage.notNull\` but the column is nullable — existing nulls must be backfilled. `
      + 'Run "os migrate apply --allow-destructive".',
    );
    expect(apply.lines).not.toContain('cannot apply it on this database');
    expect(heldBackLines(apply.lines)).toEqual(['  ⚠ 2 destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).']);
  }, CASE_TIMEOUT_MS);

  it('apply --allow-destructive on a file: exit 0, every entry applied, nothing skipped', async () => {
    const file = join(dir, 'local.db');
    await buildFixture(`file:${file}`, (seed) => local(file, seed));
    expect(await local(file, columnsOf)).toMatchObject({ code: false, memo: true, legacy_23848: false });

    const apply = await run(MigrateApply, ['--database-url', `file:${file}`, '--allow-destructive', '--yes', '--json']);
    expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 800)).toBeUndefined();
    // Only keys this payload carried before #23848: the control is the unchanged behaviour.
    const said = JSON.stringify(apply.payload).slice(0, 1500);
    expect(apply.exitCode, said).toBe(0);
    expect(kinds(apply.payload.applied), said).toEqual([DROP, TIGHTEN, RELAX].sort());
    expect(kinds(apply.payload.skipped), said).toEqual([]);

    const columns = await local(file, columnsOf);
    expect(columns).not.toHaveProperty('legacy_23848');
    expect(columns).toMatchObject({ code: true, memo: false });
  }, CASE_TIMEOUT_MS);
});

describe.skipIf(!SQLD)('os migrate plan / apply on a Turso REMOTE database (sqld)', () => {
  beforeAll(async () => {
    const port = await freePort();
    url = `libsql://127.0.0.1:${port}?tls=0`;
    server = spawn(SQLD!, ['--http-listen-addr', `127.0.0.1:${port}`, '--db-path', join(dir, 'sqld')], { stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try {
        await remote((exec) => exec('SELECT 1'));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await buildFixture(url, (seed) => remote(seed));
    expect(await remote(columnsOf)).toMatchObject({ code: false, memo: true, legacy_23848: false });
  }, CASE_TIMEOUT_MS);

  it('plan: runs, lists the three drifts, says additive work was not examined, and moves nothing', async () => {
    const before = await logicalDump();
    const plan = await run(MigratePlan, ['--database-url', url, '--json']);
    expect(plan.payload.error, JSON.stringify(plan.payload).slice(0, 800)).toBeUndefined();
    expect(plan.exitCode).toBe(0);
    expect(plan.payload.database).toBe(`libsql://127.0.0.1:${new URL(url).port}`);
    expect(plan.payload.schemaSync).toBe('skipped');
    expect(plan.payload.pending).toEqual([]);
    expect(kinds(plan.payload.changes)).toEqual([DROP, TIGHTEN, RELAX].sort());
    expect(await logicalDump()).toBe(before);
  }, CASE_TIMEOUT_MS);

  // [#23925] Before the apply below names them as not applied, the plan says so:
  // read from the driver's declaration, never from the dialect or the URL.
  it('plan, human face: the tightening and the relax name the transport\'s limit, never --allow-destructive; the drop keeps it', async () => {
    const before = await logicalDump();
    const plan = await run(MigratePlan, ['--database-url', url]);
    expect(plan.exitCode, plan.lines.slice(-1500)).toBe(0);

    const tighten = planEntryLine(plan.lines, 'tighten_not_null');
    expect(tighten).not.toContain('--allow-destructive');
    expect(tighten).toContain(
      `${TABLE}.code: metadata declares \`storage.notNull\` but the column is nullable — existing nulls must be backfilled. `
      + '"os migrate apply" cannot apply it on this database: it needs the SQLite table rebuild, which the Turso REMOTE '
      + 'transport does not run.',
    );
    expect(planEntryLine(plan.lines, 'relax_not_null')).toContain('"os migrate apply" cannot apply it on this database');
    const drop = planEntryLine(plan.lines, 'drop_column');
    expect(drop).toContain('"os migrate apply --allow-destructive" to drop it.');
    expect(drop).not.toContain('cannot apply it on this database');

    const footer = planFooter(plan.lines);
    expect(footer).not.toContain('drops / tightenings');
    expect(footer).toContain('Apply with: os migrate apply (add --allow-destructive for the 1 destructive change(s) it can apply on this database)');
    expect(footer).toMatch(/2 change\(s\) above cannot be applied on this database by "os migrate apply"/);
    expect(await logicalDump()).toBe(before);
  }, CASE_TIMEOUT_MS);

  // [#23925] The apply's own listing says the same before its prompt, and offers
  // a re-run with --allow-destructive only for the drop that re-run could apply.
  it('apply --yes, human face: the listing names the limit, and only the drop is offered a re-run', async () => {
    const apply = await run(MigrateApply, ['--database-url', url, '--yes']);
    expect(apply.exitCode, apply.lines.slice(-1500)).toBe(0);
    const tighten = planEntryLine(apply.lines, 'tighten_not_null');
    expect(tighten).not.toContain('--allow-destructive');
    expect(tighten).toContain(
      '"os migrate apply" cannot apply it on this database: it needs the SQLite table rebuild, which the Turso REMOTE '
      + 'transport does not run.',
    );
    expect(planEntryLine(apply.lines, 'relax_not_null')).toContain('"os migrate apply" cannot apply it on this database');
    expect(planEntryLine(apply.lines, 'drop_column')).toContain('"os migrate apply --allow-destructive" to drop it.');
    expect(heldBackLines(apply.lines)).toEqual([
      '  ⚠ 1 destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).',
      '  ⚠ 1 destructive change(s) remain drift that a re-run with --allow-destructive cannot apply on this database either (each says why above).',
    ]);
    // Unchanged after the prompt: the relax the driver could not apply is still named.
    expect(apply.lines).toContain(`${TABLE}.memo — relax_not_null`);
    expect(await remote(columnsOf)).toMatchObject({ code: false, memo: true, legacy_23848: false });
  }, CASE_TIMEOUT_MS);

  it('apply without --allow-destructive: names the entry it could not apply, keeps the destructive two back, exits 0', async () => {
    const apply = await run(MigrateApply, ['--database-url', url, '--yes', '--json']);
    expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 800)).toBeUndefined();
    expect(apply.exitCode).toBe(0);
    expect(apply.payload.schemaSync).toBe('skipped');
    expect(apply.payload.created).toEqual([]);
    expect(kinds(apply.payload.applied)).toEqual([]);
    expect(kinds(apply.payload.notApplied)).toEqual([RELAX]);
    expect(kinds(apply.payload.skipped)).toEqual([DROP, TIGHTEN, RELAX].sort());
    expect(apply.payload.message).toBeUndefined();
    expect(await remote(columnsOf)).toMatchObject({ code: false, memo: true, legacy_23848: false });
  }, CASE_TIMEOUT_MS);

  it('apply --allow-destructive: the drop lands on the server, the two it cannot express are named, the verdict is partial', async () => {
    const apply = await run(MigrateApply, ['--database-url', url, '--allow-destructive', '--yes', '--json']);
    expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 800)).toBeUndefined();
    expect(apply.exitCode).toBe(1);
    expect(apply.payload.message).toBe('partial');
    expect(kinds(apply.payload.applied)).toEqual([DROP]);
    expect(kinds(apply.payload.notApplied)).toEqual([TIGHTEN, RELAX].sort());

    const after = await remote(async (exec) => ({
      columns: await columnsOf(exec),
      rows: (await exec(`SELECT id, code, memo FROM "${TABLE}" ORDER BY id`)).map((r) => ({ ...r })),
    }));
    expect(after.columns).not.toHaveProperty('legacy_23848');
    expect(after.columns).toMatchObject({ code: false, memo: true });
    expect(after.rows).toEqual([{ id: 'n1', code: 'c1', memo: 'm1' }]);
  }, CASE_TIMEOUT_MS);

  it('apply --allow-destructive, human face: each entry it could not apply is named by table, column and kind, and the run says PARTIAL', async () => {
    const apply = await run(MigrateApply, ['--database-url', url, '--allow-destructive', '--yes']);
    expect(apply.exitCode, apply.lines.slice(-1500)).toBe(1);
    expect(apply.lines).toMatch(/additive schema work was NOT examined/i);
    // [#23925] The listing before the prompt already said it could not apply the tightening.
    expect(planEntryLine(apply.lines, 'tighten_not_null')).toContain('"os migrate apply" cannot apply it on this database');
    expect(planEntryLine(apply.lines, 'tighten_not_null')).not.toContain('--allow-destructive');
    expect(apply.lines).toContain(`${TABLE}.code — tighten_not_null`);
    expect(apply.lines).toContain(`${TABLE}.memo — relax_not_null`);
    expect(apply.lines).toMatch(/PARTIAL/);
  }, CASE_TIMEOUT_MS);
});
