// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate unmapped-columns` at the public door: the CLI spawned against a
 * real SQLite database that a field retirement left behind.
 *
 * ## The fixture
 *
 * One boot of release ONE writes records while `um_contact` still declares
 * `mailing_street` and `mailing_city`. Release TWO retires both fields, so
 * their columns stay in the table (the additive sync never drops one) and no
 * runtime door serves them any more. A driver-owned hash-shadow column is
 * added by hand beside them: it exists in no metadata either, and the differ
 * leaves it out because it carries a UNIQUE index, not a retired field's
 * values. `um_account` retires nothing.
 *
 * ## What is pinned
 *
 *  1. an object with retired columns: the door emits them, keyed by record id,
 *     every row, a NULL as a NULL, and nothing declared;
 *  2. ONE column set: the columns are exactly the ones `os migrate plan
 *     --json` reports as `unmapped_column` for the same table, on the same
 *     database, and the hash shadow is out of both;
 *  3. an object with none: empty work, exit 0;
 *  4. an object name the registry does not hold: `OBJECT_NOT_FOUND`, exit 1,
 *     one document;
 *  5. a row cap the table exceeds: refused, exit 1, and no records emitted;
 *  6. a value JSON cannot carry as stored (bytes in a BLOB column added by
 *     hand to `um_blob`; the platform creates no binary column for any field
 *     type): refused in both faces, exit 1, naming the column and the record
 *     id, no record emitted;
 *  7. the door writes nothing: the schema and every row are byte-identical
 *     after it ran.
 *
 * The runtime half, that the engine's data door never serves these columns, is
 * the read narrowing's own pin
 * (`packages/rest/src/data-query-unprojected-declared-fields.test.ts`) and is
 * deliberately not restated here. The PostgreSQL leg of the read was measured
 * by hand on a live server and is recorded on the pull request: the driver
 * call this door issues is one code path for both dialects.
 *
 * Every spawn runs in the hook; a case only reads what a run printed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 480_000;
const RUN_BUDGET_MS = 120_000;

const MANIFEST = { id: 'com.example.os21573', name: 'Unmapped columns', version: '0.0.0', type: 'app' };

/** Release one: the two mailing fields are still declared. */
const RELEASE_ONE = {
  manifest: MANIFEST,
  objects: [
    {
      name: 'um_contact',
      fields: { name: { type: 'text' }, mailing_street: { type: 'text' }, mailing_city: { type: 'text' } },
    },
    { name: 'um_account', fields: { name: { type: 'text' } } },
    { name: 'um_blob', fields: { name: { type: 'text' } } },
  ],
};

/** Release two: both mailing fields retired. Their columns stay in the table. */
const RELEASE_TWO = {
  manifest: MANIFEST,
  objects: [
    { name: 'um_contact', fields: { name: { type: 'text' } } },
    { name: 'um_account', fields: { name: { type: 'text' } } },
    { name: 'um_blob', fields: { name: { type: 'text' } } },
  ],
};

/** The driver-owned hash-shadow spelling the differ skips (`HASH_SHADOW_SUFFIX`). */
const HASH_SHADOW = 'legacy_code__hash';

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

function childEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  const unset: Record<string, undefined> = {};
  for (const key of OVERRIDING_ENV) unset[key] = undefined;
  return { ...env, ...unset, ...overrides };
}

/**
 * Release one, served: DDL performed, three contacts and an account written
 * while the mailing fields are declared. Then, by hand, the hash shadow and a
 * BLOB column on `um_blob` holding three bytes.
 */
const SEED_CHILD = `
const rt = await import('@objectstack/runtime');
const stack = await rt.createStandaloneStack({
  projectRoot: process.env.FIXTURE_PROJECT,
  databaseUrl: 'file:' + process.env.FIXTURE_DB,
  skipSeedData: true,
  armLifecycleSweep: false,
});
const runtime = new rt.Runtime({ cluster: false });
const kernel = runtime.getKernel();
for (const plugin of stack.plugins) await kernel.use(plugin);
await runtime.start();
const ql = kernel.getService('objectql');
const SYSTEM = { context: { isSystem: true } };
await ql.insert('um_contact', { id: 'c1', name: 'Ann', mailing_street: '1 Retired Way', mailing_city: 'Oldtown' }, SYSTEM);
await ql.insert('um_contact', { id: 'c2', name: 'Bob', mailing_street: '2 Retired Way', mailing_city: 'Newtown' }, SYSTEM);
await ql.insert('um_contact', { id: 'c3', name: 'Cy' }, SYSTEM);
await ql.insert('um_account', { id: 'a1', name: 'Acme' }, SYSTEM);
await ql.insert('um_blob', { id: 'b1', name: 'Bin' }, SYSTEM);
await kernel.shutdown();
const { SqlDriver } = await import('@objectstack/driver-sql');
const raw = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_DB }, useNullAsDefault: true });
await raw.knex.raw('ALTER TABLE um_contact ADD COLUMN ${HASH_SHADOW} text');
await raw.knex('um_contact').update({ ${HASH_SHADOW}: 'shadow' });
await raw.knex.raw('ALTER TABLE um_blob ADD COLUMN legacy_bytes blob');
await raw.knex('um_blob').update({ legacy_bytes: Buffer.from([1, 2, 255]) });
await raw.disconnect();
process.stderr.write('[fixture] seeded\\n');
process.exit(0);
`;

/** The schema and every row, read on a connection of our own. */
const READ_STATE_CHILD = `
const { SqlDriver } = await import('@objectstack/driver-sql');
const raw = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_DB }, useNullAsDefault: true });
const k = raw.knex;
const schema = await k.raw('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
const rows = {};
for (const entry of schema) {
  if (entry.type !== 'table' || entry.name.startsWith('sqlite_')) continue;
  rows[entry.name] = await k.raw('SELECT * FROM "' + entry.name + '" ORDER BY rowid');
}
await raw.disconnect();
process.stdout.write(JSON.stringify({ schema, rows }));
process.exit(0);
`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

let dir: string;
let db: string;

function childNode(code: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: CLI_ROOT,
    env: childEnv({ OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'), OS_SECRET_KEY: '0e2e'.repeat(16), ...env }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  return { status: out.status, stdout: String(out.stdout), stderr: String(out.stderr) };
}

function readState(): string {
  const out = childNode(READ_STATE_CHILD, { FIXTURE_DB: db });
  if (out.status !== 0) throw new Error(`could not read the fixture database (status ${out.status})\n${out.stderr}`);
  return out.stdout;
}

/** One `os <argv…> --database-url file:<db>` run, in the fixture project. */
function runCli(argv: string[]): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--database-url', `file:${db}`], {
      cwd: dir,
      env: childEnv({
        NO_COLOR: '1',
        OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
        OS_SECRET_KEY: '0e2e'.repeat(16),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`os ${argv.join(' ')} did not finish within ${RUN_BUDGET_MS}ms\n${stderr}`));
    }, RUN_BUDGET_MS);
    child.on('error', (err) => { clearTimeout(timer); rejectRun(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

const door = (object: string, ...extra: string[]): string[] => ['migrate', 'unmapped-columns', '--object', object, ...extra];

let before: string;
let after: string;
let retiredJson: Run;
let retiredHuman: Run;
let planJson: Run;
let noneJson: Run;
let noneHuman: Run;
let unknownJson: Run;
let cappedJson: Run;
let bytesJson: Run;
let bytesHuman: Run;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-21573-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  db = join(dir, 'data', 'app.db');

  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(RELEASE_ONE));
  const seed = childNode(SEED_CHILD, { FIXTURE_PROJECT: dir, FIXTURE_DB: db });
  if (seed.status !== 0 || !seed.stderr.includes('[fixture] seeded')) {
    throw new Error(`the fixture database was not seeded (status ${seed.status})\n${seed.stderr}`);
  }
  // The upgrade: every run below is against release two.
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(RELEASE_TWO));

  before = readState();
  retiredJson = await runCli(door('um_contact', '--json'));
  retiredHuman = await runCli(door('um_contact'));
  noneJson = await runCli(door('um_account', '--json'));
  noneHuman = await runCli(door('um_account'));
  unknownJson = await runCli(door('um_nope', '--json'));
  cappedJson = await runCli(door('um_contact', '--max-records', '2', '--json'));
  bytesJson = await runCli(door('um_blob', '--json'));
  bytesHuman = await runCli(door('um_blob'));
  after = readState();
  planJson = await runCli(['migrate', 'plan', '--json']);
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os migrate unmapped-columns: an object with retired columns', () => {
  it('--json: emits the retired columns\' values keyed by record id, every row, exit 0', () => {
    expect(retiredJson.code, retiredJson.stderr).toBe(0);
    const doc = JSON.parse(retiredJson.stdout);
    expect(doc).toMatchObject({ object: 'um_contact', table: 'um_contact', count: 3 });
    expect(doc.columns.map((c: { column: string }) => c.column)).toEqual(['mailing_city', 'mailing_street']);
    expect(doc.records).toEqual([
      { id: 'c1', values: { mailing_city: 'Oldtown', mailing_street: '1 Retired Way' } },
      { id: 'c2', values: { mailing_city: 'Newtown', mailing_street: '2 Retired Way' } },
      // Written with the fields declared but left empty: a stored NULL, emitted as one.
      { id: 'c3', values: { mailing_city: null, mailing_street: null } },
    ]);
  });

  it('emits nothing declared and nothing the differ leaves out: no field, no built-in column, no hash shadow', () => {
    const doc = JSON.parse(retiredJson.stdout);
    const emitted = new Set<string>(doc.records.flatMap((r: { values: object }) => Object.keys(r.values)));
    for (const key of ['name', 'id', 'created_at', 'updated_at', HASH_SHADOW]) expect(emitted.has(key), key).toBe(false);
    expect(doc.columns.map((c: { column: string }) => c.column)).not.toContain(HASH_SHADOW);
  });

  it('is ONE column set: exactly what os migrate plan --json reports as unmapped_column for this table', () => {
    expect(planJson.code, planJson.stderr).toBe(0);
    const plan = JSON.parse(planJson.stdout);
    const planned = (plan.changes as Array<{ kind: string; table: string; column: string; actual: string }>)
      .filter((c) => c.kind === 'unmapped_column' && c.table === 'um_contact')
      .map((c) => ({ column: c.column, actual: c.actual }));
    // Non-vacuity: the plan does report the retired columns.
    expect(planned.length).toBe(2);
    expect(JSON.parse(retiredJson.stdout).columns).toEqual(planned);
    // The differ's exclusion holds on both: the shadow is in the table and in neither answer.
    expect(planned.map((c) => c.column)).not.toContain(HASH_SHADOW);
  });

  it('human face: names the columns and the records, exit 0', () => {
    expect(retiredHuman.code, retiredHuman.stderr).toBe(0);
    expect(retiredHuman.stdout).toMatch(/2 unmapped column\(s\)/);
    expect(retiredHuman.stdout).toContain('mailing_street');
    expect(retiredHuman.stdout).toContain('"mailing_city":"Oldtown"');
    expect(retiredHuman.stdout).toMatch(/Read 3 record\(s\)/);
  });

  it('writes nothing: the schema and every row are byte-identical after the door ran', () => {
    expect(JSON.parse(before).rows.um_contact).toHaveLength(3);
    expect(after).toBe(before);
  });
});

describe('os migrate unmapped-columns: the other answers', () => {
  it('an object with none: empty work, exit 0', () => {
    expect(noneJson.code, noneJson.stderr).toBe(0);
    expect(JSON.parse(noneJson.stdout)).toMatchObject({ object: 'um_account', columns: [], count: 0, records: [] });
    expect(noneHuman.code, noneHuman.stderr).toBe(0);
    expect(noneHuman.stdout).toContain('No unmapped column on um_account');
  });

  it('an object the registry does not hold: OBJECT_NOT_FOUND, exit 1, one document', () => {
    expect(unknownJson.code).toBe(1);
    expect(JSON.parse(unknownJson.stdout)).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('a row cap the table exceeds: refused, exit 1, and no records emitted', () => {
    expect(cappedJson.code).toBe(1);
    const doc = JSON.parse(cappedJson.stdout);
    expect(doc.error).toMatch(/stopped at 2 row\(s\)[\s\S]*--max-records/);
    expect(doc).not.toHaveProperty('records');
  });

  it('a value JSON cannot carry as stored: refused in both faces, exit 1, naming the column and the record id', () => {
    const says = /Record b1 of um_blob holds binary bytes in the column legacy_bytes[\s\S]*database's own client/;
    expect(bytesJson.code).toBe(1);
    const doc = JSON.parse(bytesJson.stdout);
    expect(doc.error).toMatch(says);
    expect(doc).not.toHaveProperty('records');
    expect(bytesHuman.code).toBe(1);
    expect(bytesHuman.stdout).toMatch(says);
    // Neither face carries the stand-in a JSON serialisation of the bytes would be.
    for (const out of [bytesJson.stdout, bytesHuman.stdout]) expect(out).not.toContain('"type":"Buffer"');
  });
});
